import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { CallManager } from '../modules/call-manager';
import type { CallErrorEvent } from '../modules/call-manager';
import { ApiCentralError, HttpClient } from '../utils/http-client';
import {
  BASE_URL,
  FakeMediaStream,
  FakePeerConnection,
  FakeSocket,
  FakeTrack,
  apiError,
  installFetchMock,
  requestLog,
  routeFetch,
  stubPeerConnection,
  stubUserMedia,
} from './test-helpers';
import type { RouteReply } from './test-helpers';

// Une erreur ne doit jamais disparaître : une méthode attendue rejette sa
// promesse, une erreur survenue en arrière-plan (signalisation WebSocket)
// passe par onError. Et un échec ne laisse jamais le gestionnaire bloqué
// dans un appel : il revient au repos et libère le média.

const CALL = { id: 'call-1', call_type: 'audio', status: 'ringing', participants: [] };
const ICE_SERVERS = { ice_servers: [], call_id: 'call-1', ttl: 86400 };
const START = { participantIds: ['user-2'], callType: 'audio' as const };

describe('CallManager — erreurs remontées, jamais avalées', () => {
  let fetchMock: Mock;
  let socket: FakeSocket;
  let micro: FakeTrack;
  let media: { getUserMedia: Mock; getDisplayMedia: Mock };
  let peers: () => FakePeerConnection[];
  let manager: CallManager;
  let onError: Mock;

  beforeEach(() => {
    fetchMock = installFetchMock();
    micro = new FakeTrack('audio');
    media = stubUserMedia(new FakeMediaStream([micro]));
    peers = stubPeerConnection();
    socket = new FakeSocket();
    manager = new CallManager(new HttpClient({ baseUrl: BASE_URL }), { userId: 'user-1' });
    manager.bindWebSocket(socket.asClient());
    onError = vi.fn();
    manager.onError = onError;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Routes d'un appel sortant qui aboutit, complétées ou remplacées par `extra`. */
  function routeOutgoingCall(extra: Record<string, RouteReply> = {}): void {
    routeFetch(fetchMock, {
      'POST /calls': { body: CALL },
      'GET /calls/call-1/ice-servers': { body: ICE_SERVERS },
      ...extra,
    });
  }

  function firstError(): CallErrorEvent {
    const [event] = onError.mock.calls[0] as [CallErrorEvent];
    return event;
  }

  describe('startCall', () => {
    it('rejette si le micro est refusé, sans créer d’appel, et revient au repos', async () => {
      routeOutgoingCall();
      media.getUserMedia.mockRejectedValueOnce(new DOMException('Permission refusée', 'NotAllowedError'));

      await expect(manager.startCall(START)).rejects.toThrow('Permission refusée');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(manager.state).toBe('idle');
      expect(manager.currentCallId).toBeNull();
    });

    it('rejette si l’API refuse l’appel, et libère le micro', async () => {
      routeOutgoingCall({ 'POST /calls': apiError(404, 'One or more participant users not found') });

      await expect(manager.startCall(START)).rejects.toBeInstanceOf(ApiCentralError);

      expect(manager.state).toBe('idle');
      expect(micro.stopped).toBe(true);
    });

    it('rejette si les serveurs ICE manquent, sans STUN de secours, et termine l’appel créé', async () => {
      routeOutgoingCall({
        'GET /calls/call-1/ice-servers': apiError(403, 'Forbidden'),
        'POST /calls/call-1/end': { body: { ...CALL, status: 'ended' } },
      });

      await expect(manager.startCall(START)).rejects.toMatchObject({ statusCode: 403 });

      expect(requestLog(fetchMock)).toEqual([
        'POST /calls',
        'GET /calls/call-1/ice-servers',
        'POST /calls/call-1/end',
      ]);
      expect(peers()).toHaveLength(0);
      expect(socket.sentOfType('call_join')).toHaveLength(0);
      expect(manager.state).toBe('idle');
      expect(micro.stopped).toBe(true);
      expect(onError).not.toHaveBeenCalled();
    });

    it('signale par onError l’échec de la fin d’un appel abandonné', async () => {
      routeOutgoingCall({
        'GET /calls/call-1/ice-servers': apiError(403, 'Forbidden'),
        'POST /calls/call-1/end': apiError(500, 'Internal error'),
      });

      await expect(manager.startCall(START)).rejects.toMatchObject({ statusCode: 403 });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(firstError().callId).toBe('call-1');
      expect(firstError().error).toMatchObject({ statusCode: 500 });
    });

    it('rejette sans créer d’appel si le temps réel n’est pas branché', async () => {
      routeOutgoingCall();
      const unbound = new CallManager(new HttpClient({ baseUrl: BASE_URL }), { userId: 'user-1' });

      await expect(unbound.startCall(START)).rejects.toThrow(/connectRealtime/);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(unbound.state).toBe('idle');
    });
  });

  describe('answerCall', () => {
    it('rejette si l’API refuse de décrocher, libère le média et ne quitte aucune salle', async () => {
      socket.emit('call_incoming', { callId: 'call-3', callerId: 'user-2', callType: 'audio' });
      routeFetch(fetchMock, {
        'GET /calls/call-3': { body: { ...CALL, id: 'call-3' } },
        'GET /calls/call-3/ice-servers': { body: { ...ICE_SERVERS, call_id: 'call-3' } },
        'POST /calls/call-3/answer': apiError(400, 'Call is not ringing'),
      });

      await expect(manager.answerCall('call-3')).rejects.toBeInstanceOf(ApiCentralError);

      expect(manager.state).toBe('idle');
      expect(manager.currentCallId).toBeNull();
      expect(micro.stopped).toBe(true);
      expect(socket.sentOfType('call_join')).toHaveLength(0);
      expect(socket.sentOfType('call_leave')).toHaveLength(0);
    });
  });

  describe('endCall et leaveCall', () => {
    it('libère le média même si l’API ne peut pas terminer l’appel, puis rejette', async () => {
      routeOutgoingCall({ 'POST /calls/call-1/end': apiError(500, 'Internal error') });
      await manager.startCall(START);

      await expect(manager.endCall()).rejects.toMatchObject({ statusCode: 500 });

      expect(manager.state).toBe('idle');
      expect(manager.currentCallId).toBeNull();
      expect(micro.stopped).toBe(true);
    });

    it('leaveCall quitte la salle de signalisation une seule fois', async () => {
      routeOutgoingCall({ 'POST /calls/call-1/leave': { body: { success: true } } });
      await manager.startCall(START);

      await manager.leaveCall();

      expect(socket.sentOfType('call_leave')).toEqual([{ callId: 'call-1' }]);
      expect(manager.state).toBe('idle');
    });
  });

  describe('signalisation en arrière-plan', () => {
    it('signale par onError une offre SDP illisible, au lieu d’un rejet non géré', async () => {
      routeOutgoingCall();
      await manager.startCall(START);

      socket.emit('call_offer_received', { callId: 'call-1', fromUserId: 'user-2', sdp: 'pas du json' });

      await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(firstError().callId).toBe('call-1');
      expect(firstError().error).toBeInstanceOf(Error);
    });

    it('signale par onError une connexion WebRTC en échec', async () => {
      routeOutgoingCall();
      await manager.startCall(START);
      socket.emit('call_participant_joined', { callId: 'call-1', userId: 'user-2' });
      await vi.waitFor(() => expect(peers()).toHaveLength(1));

      const [peer] = peers();
      peer!.connectionState = 'failed';
      peer!.onconnectionstatechange?.();

      expect(onError).toHaveBeenCalledTimes(1);
      expect(firstError().callId).toBe('call-1');
      expect(firstError().error.message).toMatch(/user-2/);
    });
  });

  describe('toggleScreenShare', () => {
    it('renvoie false, sans erreur, quand l’utilisateur ferme le sélecteur', async () => {
      routeOutgoingCall();
      await manager.startCall(START);
      media.getDisplayMedia.mockRejectedValueOnce(new DOMException('Annulé', 'NotAllowedError'));

      await expect(manager.toggleScreenShare()).resolves.toBe(false);

      expect(manager.isScreenSharing).toBe(false);
      expect(onError).not.toHaveBeenCalled();
    });

    it('rejette les autres échecs de capture d’écran', async () => {
      routeOutgoingCall();
      await manager.startCall(START);
      media.getDisplayMedia.mockRejectedValueOnce(new TypeError('getDisplayMedia indisponible'));

      await expect(manager.toggleScreenShare()).rejects.toThrow('getDisplayMedia indisponible');

      expect(manager.isScreenSharing).toBe(false);
    });
  });

  it('refuse de décrocher un autre appel pendant un appel en cours', async () => {
    routeFetch(fetchMock, {
      'POST /calls': { body: CALL },
      'GET /calls/call-1/ice-servers': { body: ICE_SERVERS },
    });
    await manager.startCall(START);
    const journalAvant = requestLog(fetchMock);

    await expect(manager.answerCall('call-2')).rejects.toThrow('Already in a call');

    expect(manager.currentCallId).toBe('call-1');
    expect(requestLog(fetchMock)).toEqual(journalAvant);
  });
});
