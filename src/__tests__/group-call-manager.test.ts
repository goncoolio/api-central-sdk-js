import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { GroupCallManager } from '../modules/group-call-manager';
import type { CallErrorEvent } from '../modules/call-manager';
import type { CallResponse } from '../types';
import { HttpClient } from '../utils/http-client';
import {
  BASE_URL,
  FakeMediaStream,
  FakeSocket,
  FakeTrack,
  apiError,
  flushAsync,
  installFetchMock,
  requestAt,
  requestLog,
  routeFetch,
} from './test-helpers';
import type { RouteReply } from './test-helpers';
import { fakeRoomFactory } from './fake-group-call-room';
import type { FakeGroupCallRoom, FakeRooms } from './fake-group-call-room';

// La salle LiveKit est simulée : ces tests couvrent ce que décide le
// gestionnaire (jeton, publication, API, états, événements), pas la
// connexion au SFU elle-même, qui exige un navigateur et des appareils.

/** Réponse de GET /calls/call-1/token, telle que l'API la sérialise. */
const TOKEN = { url: 'wss://sfu.example.test', token: 'jeton-sfu', room: 'call:call-1', identity: 'user-1' };

function groupCall(callType: 'audio' | 'video'): CallResponse {
  return { id: 'call-1', callType, status: 'ringing', participants: [], participantCount: 3 } as unknown as CallResponse;
}

describe('GroupCallManager', () => {
  let fetchMock: Mock;
  let socket: FakeSocket;
  let rooms: FakeRooms;
  let manager: GroupCallManager;

  beforeEach(() => {
    fetchMock = installFetchMock();
    vi.stubGlobal('MediaStream', FakeMediaStream);
    socket = new FakeSocket();
    rooms = fakeRoomFactory();
    manager = new GroupCallManager(new HttpClient({ baseUrl: BASE_URL }), {
      userId: 'user-1',
      roomFactory: rooms.factory,
    });
    manager.bindWebSocket(socket.asClient());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function route(extra: Record<string, RouteReply> = {}): void {
    routeFetch(fetchMock, { 'GET /calls/call-1/token': { body: TOKEN }, ...extra });
  }

  /** Gestionnaire connecté à l'appel `call-1`. */
  async function joined(callType: 'audio' | 'video' = 'video', extra: Record<string, RouteReply> = {}): Promise<FakeGroupCallRoom> {
    route(extra);
    await manager.startExistingCall(groupCall(callType));
    return rooms.last();
  }

  describe('entrelacement', () => {
    it('leaveCall pendant la connexion déconnecte la salle orpheline', async () => {
      route({ 'POST /calls/call-1/leave': { body: {} } });
      const liberer = rooms.holdNextConnect();

      const demarrage = manager.startExistingCall(groupCall('audio'));
      await flushAsync();
      const sortie = manager.leaveCall();
      liberer();
      await Promise.allSettled([demarrage, sortie]);

      expect(rooms.last().journal).toContain('disconnect');
      expect(manager.currentCallId).toBeNull();
    });
  });

  describe('démarrage', () => {
    it('rejoint la salle avec l’URL et le jeton renvoyés par l’API, micro et caméra publiés', async () => {
      const room = await joined('video');

      expect(requestLog(fetchMock)).toEqual(['GET /calls/call-1/token']);
      expect(room.url).toBe('wss://sfu.example.test');
      expect(room.token).toBe('jeton-sfu');
      expect(room.journal).toEqual(['connect', 'micro:true', 'camera:true']);
      expect(manager.state).toBe('connected');
      expect(manager.currentCallId).toBe('call-1');
      expect(manager.localStream?.getTracks()).toEqual([room.microphone, room.camera]);
    });

    it('ne publie pas la caméra pour un appel audio', async () => {
      const room = await joined('audio');

      expect(room.journal).toEqual(['connect', 'micro:true']);
      expect(manager.isVideoEnabled).toBe(false);
    });

    it('passe par connecting puis connected', async () => {
      const states: string[] = [];
      manager.onStateChanged = (state) => states.push(state);

      await joined('audio');

      expect(states).toEqual(['connecting', 'connected']);
    });

    it('startCall crée l’appel puis rejoint sa salle', async () => {
      route({ 'POST /calls': { body: { id: 'call-1', call_type: 'audio', status: 'ringing', participants: [] } } });

      const call = await manager.startCall({ participantIds: ['user-2', 'user-3'], callType: 'audio' });

      expect(call.id).toBe('call-1');
      expect(requestLog(fetchMock)).toEqual(['POST /calls', 'GET /calls/call-1/token']);
      expect(manager.state).toBe('connected');
    });

    it('un échec de connexion libère la salle, termine l’appel créé et rejette', async () => {
      route({ 'POST /calls/call-1/end': { body: {} } });
      rooms.failNextConnect(new Error('SFU injoignable'));

      await expect(manager.startExistingCall(groupCall('audio'))).rejects.toThrow('SFU injoignable');

      expect(rooms.last().journal).toEqual(['connect', 'disconnect']);
      expect(requestLog(fetchMock)).toContain('POST /calls/call-1/end');
      expect(manager.state).toBe('idle');
      expect(manager.currentCallId).toBeNull();
    });

    it('rejette clairement si le serveur n’a pas LiveKit (400), sans créer de salle', async () => {
      route({ 'GET /calls/call-1/token': apiError(400, 'LiveKit is not configured'), 'POST /calls/call-1/end': { body: {} } });

      await expect(manager.startExistingCall(groupCall('audio'))).rejects.toMatchObject({
        statusCode: 400,
        message: 'LiveKit is not configured',
      });

      expect(rooms.all).toHaveLength(0);
      expect(manager.state).toBe('idle');
    });

    it('refuse un second appel sans avoir quitté le premier', async () => {
      await joined('audio');

      await expect(manager.startExistingCall({ ...groupCall('audio'), id: 'call-2' })).rejects.toThrow(
        'Already in a call'
      );
      expect(manager.currentCallId).toBe('call-1');
    });
  });

  describe('answerCall', () => {
    it('décroche en dernier : jeton, salle et média d’abord', async () => {
      route({
        'GET /calls/call-1': { body: { id: 'call-1', call_type: 'audio', status: 'ringing', participants: [] } },
        'POST /calls/call-1/answer': { body: { id: 'call-1', call_type: 'audio', status: 'connected', participants: [] } },
      });

      await manager.answerCall('call-1');

      expect(requestLog(fetchMock)).toEqual([
        'GET /calls/call-1',
        'GET /calls/call-1/token',
        'POST /calls/call-1/answer',
      ]);
      expect(rooms.last().journal).toEqual(['connect', 'micro:true']);
      expect(manager.state).toBe('connected');
    });

    it('si le média échoue, l’appel n’est pas décroché et continue de sonner', async () => {
      route({ 'GET /calls/call-1': { body: { id: 'call-1', call_type: 'audio', status: 'ringing', participants: [] } } });
      rooms.failNextConnect(new Error('SFU injoignable'));

      await expect(manager.answerCall('call-1')).rejects.toThrow('SFU injoignable');

      expect(requestLog(fetchMock)).not.toContain('POST /calls/call-1/answer');
      expect(manager.state).toBe('idle');
    });

    it('declineCall refuse l’appel côté API', async () => {
      routeFetch(fetchMock, { 'POST /calls/call-9/decline': { body: { success: true } } });

      await manager.declineCall('call-9');

      expect(requestLog(fetchMock)).toEqual(['POST /calls/call-9/decline']);
    });
  });

  describe('participants distants', () => {
    it('expose le flux d’un participant dès sa première piste', async () => {
      const room = await joined();
      const onParticipantJoined = vi.fn();
      const onRemoteStream = vi.fn();
      manager.onParticipantJoined = onParticipantJoined;
      manager.onRemoteStream = onRemoteStream;
      const track = new FakeTrack('audio');

      room.events.trackSubscribed('user-2', track as unknown as MediaStreamTrack);

      expect(onParticipantJoined).toHaveBeenCalledWith({ callId: 'call-1', userId: 'user-2' });
      expect(onRemoteStream).toHaveBeenCalledTimes(1);
      const [{ userId, stream }] = onRemoteStream.mock.calls[0] as [{ userId: string; stream: FakeMediaStream }];
      expect(userId).toBe('user-2');
      expect(stream.getTracks()).toEqual([track]);
      expect(manager.getRemoteStream('user-2')).toBe(stream);
      expect(manager.participantIds).toEqual(['user-2']);
    });

    it('annonce chaque participant une seule fois, avec son nom', async () => {
      const room = await joined();
      const onParticipantJoined = vi.fn();
      manager.onParticipantJoined = onParticipantJoined;

      room.events.participantConnected({ userId: 'user-2', userName: 'Bob' });
      room.events.trackSubscribed('user-2', new FakeTrack('video') as unknown as MediaStreamTrack);

      expect(onParticipantJoined).toHaveBeenCalledTimes(1);
      expect(onParticipantJoined).toHaveBeenCalledWith({ callId: 'call-1', userId: 'user-2', userName: 'Bob' });
    });

    it('retire le participant qui quitte la salle', async () => {
      const room = await joined();
      const onParticipantLeft = vi.fn();
      manager.onParticipantLeft = onParticipantLeft;
      room.events.trackSubscribed('user-2', new FakeTrack('audio') as unknown as MediaStreamTrack);

      room.events.participantDisconnected('user-2');

      expect(onParticipantLeft).toHaveBeenCalledWith({ callId: 'call-1', userId: 'user-2' });
      expect(manager.getRemoteStream('user-2')).toBeNull();
      expect(manager.participantIds).toEqual([]);
    });

    it('ignore les événements d’une salle quittée', async () => {
      const room = await joined('audio', { 'POST /calls/call-1/leave': { body: { success: true } } });
      await manager.leaveCall();
      const onRemoteStream = vi.fn();
      manager.onRemoteStream = onRemoteStream;

      room.events.trackSubscribed('user-2', new FakeTrack('audio') as unknown as MediaStreamTrack);

      expect(onRemoteStream).not.toHaveBeenCalled();
    });
  });

  describe('micro et caméra', () => {
    it('coupe le micro dans la salle et le signale à l’API avec l’identifiant réel', async () => {
      const room = await joined('video', { 'PUT /calls/call-1/participants/user-1/mute': { body: { muted: true } } });

      await expect(manager.toggleMute()).resolves.toBe(true);

      expect(room.journal.at(-1)).toBe('micro:false');
      expect(requestAt(fetchMock, 1)).toMatchObject({
        url: `${BASE_URL}/calls/call-1/participants/user-1/mute`,
        method: 'PUT',
        body: { muted: true },
      });
      expect(manager.isMuted).toBe(true);
    });

    it('coupe la caméra dans la salle et le signale à l’API', async () => {
      const room = await joined('video', { 'PUT /calls/call-1/participants/user-1/video': { body: { video_enabled: false } } });

      await expect(manager.toggleVideo()).resolves.toBe(false);

      expect(room.journal.at(-1)).toBe('camera:false');
      expect(requestAt(fetchMock, 1)).toMatchObject({
        url: `${BASE_URL}/calls/call-1/participants/user-1/video`,
        body: { enabled: false },
      });
    });

    it('rejette si l’identifiant local est inconnu, le micro restant coupé', async () => {
      manager = new GroupCallManager(new HttpClient({ baseUrl: BASE_URL }), { roomFactory: rooms.factory });
      const room = await joined('audio');

      await expect(manager.toggleMute()).rejects.toThrow(/utilisateur local inconnu/);

      expect(room.journal.at(-1)).toBe('micro:false');
      expect(manager.isMuted).toBe(true);
    });
  });

  describe('fin d’appel', () => {
    it('leaveCall quitte l’appel côté API puis libère la salle', async () => {
      const room = await joined('audio', { 'POST /calls/call-1/leave': { body: { success: true } } });

      await manager.leaveCall();

      expect(requestLog(fetchMock).at(-1)).toBe('POST /calls/call-1/leave');
      expect(room.journal.at(-1)).toBe('disconnect');
      expect(manager.state).toBe('idle');
      expect(manager.currentCallId).toBeNull();
      expect(manager.localStream).toBeNull();
    });

    it('libère la salle même si l’API échoue, puis rejette', async () => {
      const room = await joined('audio', { 'POST /calls/call-1/leave': apiError(404, 'Call not found') });

      await expect(manager.leaveCall()).rejects.toMatchObject({ statusCode: 404 });

      expect(room.journal.at(-1)).toBe('disconnect');
      expect(manager.state).toBe('idle');
    });

    it('endCall termine l’appel pour tous puis libère la salle', async () => {
      const room = await joined('audio', { 'POST /calls/call-1/end': { body: { id: 'call-1', status: 'ended' } } });

      await manager.endCall();

      expect(requestLog(fetchMock).at(-1)).toBe('POST /calls/call-1/end');
      expect(room.journal.at(-1)).toBe('disconnect');
      expect(manager.state).toBe('idle');
    });

    it('call_ended du serveur libère la salle sans rappeler l’API', async () => {
      const room = await joined('audio');
      const onCallEnded = vi.fn();
      manager.onCallEnded = onCallEnded;

      // Envoyé quand LiveKit signale room_finished, ou quand un participant
      // termine l'appel pour tous : l'API ne ferme pas la salle.
      socket.emit('call_ended', { callId: 'call-1', reason: 'room_closed', durationSeconds: 42 });
      await vi.waitFor(() => expect(room.journal.at(-1)).toBe('disconnect'));

      expect(onCallEnded).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1', reason: 'room_closed' }));
      expect(requestLog(fetchMock)).toEqual(['GET /calls/call-1/token']);
      expect(manager.state).toBe('idle');
    });

    it('ignore la fin d’un autre appel', async () => {
      await joined('audio');

      socket.emit('call_ended', { callId: 'call-2', reason: 'ended_by_user' });

      expect(manager.currentCallId).toBe('call-1');
      expect(manager.state).toBe('connected');
    });

    it('une salle fermée sans que le client le demande termine l’appel, sans l’API, et le signale', async () => {
      const room = await joined('audio');
      const onCallEnded = vi.fn();
      const onError = vi.fn();
      manager.onCallEnded = onCallEnded;
      manager.onError = onError;

      room.events.disconnected('duplicate_identity');

      expect(onCallEnded).toHaveBeenCalledWith({ callId: 'call-1', reason: 'sfu_disconnected' });
      expect(onError).toHaveBeenCalledTimes(1);
      const [event] = onError.mock.calls[0] as [CallErrorEvent];
      expect(event.callId).toBe('call-1');
      expect(event.error.message).toMatch(/duplicate_identity/);
      expect(requestLog(fetchMock)).toEqual(['GET /calls/call-1/token']);
      expect(manager.state).toBe('idle');
    });

    it('une reconnexion du SFU repasse par connecting', async () => {
      const room = await joined('audio');
      const states: string[] = [];
      manager.onStateChanged = (state) => states.push(state);

      room.events.reconnecting();
      room.events.reconnected();

      expect(states).toEqual(['connecting', 'connected']);
    });
  });

  describe('événements de l’appel', () => {
    it('transmet call_connected et les changements média de l’appel géré, pas des autres', async () => {
      await joined('audio');
      const onCallConnected = vi.fn();
      const onMuteChanged = vi.fn();
      manager.onCallConnected = onCallConnected;
      manager.onMuteChanged = onMuteChanged;

      socket.emit('call_connected', { callId: 'call-1', participantIds: ['user-1', 'user-2'] });
      socket.emit('call_mute_changed', { callId: 'call-2', userId: 'user-3', isMuted: true });
      socket.emit('call_mute_changed', { callId: 'call-1', userId: 'user-2', isMuted: true });

      expect(onCallConnected).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1' }));
      expect(onMuteChanged).toHaveBeenCalledTimes(1);
      expect(onMuteChanged).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1', userId: 'user-2' }));
    });

    it('déduit l’identifiant local de l’événement WebSocket connected', () => {
      manager = new GroupCallManager(new HttpClient({ baseUrl: BASE_URL }), { roomFactory: rooms.factory });
      manager.bindWebSocket(socket.asClient());

      socket.emit('connected', { socketId: 'socket-1', user: { id: 'user-9', externalId: 'ext-9' } });

      expect(manager.localUserId).toBe('user-9');
    });
  });
});
