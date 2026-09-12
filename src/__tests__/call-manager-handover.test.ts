import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { CallManager } from '../modules/call-manager';
import type { CallResponse } from '../types';
import { HttpClient } from '../utils/http-client';
import {
  BASE_URL,
  FakeMediaStream,
  FakeSocket,
  FakeTrack,
  installFetchMock,
  requestLog,
  routeFetch,
  stubPeerConnection,
  stubUserMedia,
} from './test-helpers';

// Ajouts de CallManager pour AutoCallManager, qui crée l'appel avant d'en
// choisir le mode : démarrer un appel déjà créé, et laisser un appel entrant
// à GroupCallManager sans le refuser.

const CREATED_CALL = { id: 'call-1', callType: 'audio', status: 'ringing', participants: [] } as unknown as CallResponse;

describe('CallManager — passation avec AutoCallManager', () => {
  let fetchMock: Mock;
  let socket: FakeSocket;
  let micro: FakeTrack;
  let media: { getUserMedia: Mock; getDisplayMedia: Mock };
  let manager: CallManager;

  beforeEach(() => {
    fetchMock = installFetchMock();
    micro = new FakeTrack('audio');
    media = stubUserMedia(new FakeMediaStream([micro]));
    stubPeerConnection();
    socket = new FakeSocket();
    manager = new CallManager(new HttpClient({ baseUrl: BASE_URL }), { userId: 'user-1' });
    manager.bindWebSocket(socket.asClient());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('startExistingCall', () => {
    it('démarre un appel déjà créé : média, serveurs ICE et salle, sans POST /calls', async () => {
      routeFetch(fetchMock, {
        'GET /calls/call-1/ice-servers': { body: { ice_servers: [], call_id: 'call-1', ttl: 86400 } },
      });

      await expect(manager.startExistingCall(CREATED_CALL)).resolves.toBe(CREATED_CALL);

      expect(requestLog(fetchMock)).toEqual(['GET /calls/call-1/ice-servers']);
      expect(media.getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
      expect(socket.sentOfType('call_join')).toEqual([{ callId: 'call-1' }]);
      expect(manager.state).toBe('outgoing');
      expect(manager.currentCallId).toBe('call-1');
    });

    it('termine l’appel créé si le micro est refusé', async () => {
      routeFetch(fetchMock, { 'POST /calls/call-1/end': { body: { id: 'call-1', status: 'ended' } } });
      media.getUserMedia.mockRejectedValueOnce(new DOMException('Permission refusée', 'NotAllowedError'));

      await expect(manager.startExistingCall(CREATED_CALL)).rejects.toThrow('Permission refusée');

      expect(requestLog(fetchMock)).toEqual(['POST /calls/call-1/end']);
      expect(manager.state).toBe('idle');
      expect(manager.currentCallId).toBeNull();
    });

    it('termine l’appel créé si le temps réel n’est pas branché', async () => {
      routeFetch(fetchMock, { 'POST /calls/call-1/end': { body: { id: 'call-1', status: 'ended' } } });
      const unbound = new CallManager(new HttpClient({ baseUrl: BASE_URL }), { userId: 'user-1' });

      await expect(unbound.startExistingCall(CREATED_CALL)).rejects.toThrow(/connectRealtime/);

      expect(requestLog(fetchMock)).toEqual(['POST /calls/call-1/end']);
      expect(unbound.state).toBe('idle');
    });

    it('refuse un second appel sans toucher à l’appel créé', async () => {
      socket.emit('call_incoming', { callId: 'call-3', callerId: 'user-2', callType: 'audio' });

      await expect(manager.startExistingCall(CREATED_CALL)).rejects.toThrow('Already in a call');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(manager.currentCallId).toBe('call-3');
    });
  });

  describe('dismissIncomingCall', () => {
    it('oublie l’appel entrant sans le refuser ni quitter de salle', () => {
      socket.emit('call_incoming', { callId: 'call-3', callerId: 'user-2', callType: 'audio' });

      manager.dismissIncomingCall('call-3');

      expect(manager.state).toBe('idle');
      expect(manager.currentCallId).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(socket.sent).toEqual([]);
    });

    it('ignore un autre appel que l’appel entrant géré', () => {
      socket.emit('call_incoming', { callId: 'call-3', callerId: 'user-2', callType: 'audio' });

      manager.dismissIncomingCall('call-4');

      expect(manager.state).toBe('incoming');
      expect(manager.currentCallId).toBe('call-3');
    });

    it('ne touche pas à un appel déjà décroché', async () => {
      routeFetch(fetchMock, {
        'GET /calls/call-1/ice-servers': { body: { ice_servers: [], call_id: 'call-1', ttl: 86400 } },
      });
      await manager.startExistingCall(CREATED_CALL);

      manager.dismissIncomingCall('call-1');

      expect(manager.state).toBe('outgoing');
      expect(micro.stopped).toBe(false);
    });
  });
});
