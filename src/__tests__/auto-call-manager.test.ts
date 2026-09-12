import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ApiCentral } from '../index';
import { AutoCallManager, GROUP_CALL_MIN_PARTICIPANTS, chooseCallMode } from '../modules/auto-call-manager';
import { CallManager } from '../modules/call-manager';
import { CallsModule } from '../modules/calls';
import { GroupCallManager } from '../modules/group-call-manager';
import type { CallResponse, ParticipantCallStatus } from '../types';
import { HttpClient } from '../utils/http-client';
import {
  BASE_URL,
  FakeMediaStream,
  FakeSocket,
  FakeTrack,
  fakeJwt,
  installFetchMock,
  requestLog,
  routeFetch,
  stubPeerConnection,
  stubUserMedia,
} from './test-helpers';
import type { RouteReply } from './test-helpers';
import { fakeRoomFactory } from './fake-group-call-room';
import type { FakeRooms } from './fake-group-call-room';
import { FakeBrowserWebSocket } from './fake-websocket';

// Politique retenue : le mode d'un appel est décidé à son démarrage, sur
// l'appel tel que l'API le renvoie. Trois participants ou plus, initiateur
// compris : LiveKit (GroupCallManager) ; sinon P2P (CallManager).

/** Appel JSON (snake_case, comme l'API) dont les participants ont ces statuts. */
function callJson(statuses: ParticipantCallStatus[], callType = 'audio'): Record<string, unknown> {
  return {
    id: 'call-1',
    call_type: callType,
    status: 'ringing',
    participant_count: statuses.length,
    participants: statuses.map((status, rank) => ({
      id: `participant-${rank}`,
      user: { id: `user-${rank + 1}`, external_user_id: `ext-${rank + 1}` },
      status,
      role: rank === 0 ? 'admin' : 'member',
      is_muted: false,
      is_video_enabled: true,
      is_screen_sharing: false,
    })),
  };
}

/** Appel déjà converti par le SDK, pour la fonction de politique. */
function callWith(statuses: ParticipantCallStatus[]): CallResponse {
  return {
    id: 'call-1',
    participants: statuses.map((status, rank) => ({ id: `p-${rank}`, status })),
  } as unknown as CallResponse;
}

const TWO = callJson(['joined', 'invited']);
const THREE = callJson(['joined', 'invited', 'invited']);
const ICE = { ice_servers: [], call_id: 'call-1', ttl: 86400 };
const TOKEN = { url: 'wss://sfu.example.test', token: 'jeton-sfu', room: 'call:call-1', identity: 'user-1' };

describe('chooseCallMode', () => {
  it('garde le P2P pour un appel à deux', () => {
    expect(chooseCallMode(callWith(['joined', 'invited']))).toBe('p2p');
  });

  it('passe par LiveKit dès trois participants, initiateur compris', () => {
    expect(chooseCallMode(callWith(['joined', 'invited', 'invited']))).toBe('group');
    expect(GROUP_CALL_MIN_PARTICIPANTS).toBe(3);
  });

  it('compte aussi les invités qui ont refusé', () => {
    // L'appelant a choisi LiveKit à trois : un appelé qui décroche après le
    // refus d'un autre invité doit aboutir au même mode, sinon ils ne se
    // retrouvent jamais.
    expect(chooseCallMode(callWith(['joined', 'declined', 'invited']))).toBe('group');
  });

  it('garde le P2P pour un appel sans participant connu', () => {
    expect(chooseCallMode(callWith([]))).toBe('p2p');
    expect(chooseCallMode({ participants: undefined } as unknown as CallResponse)).toBe('p2p');
  });
});

describe('AutoCallManager', () => {
  let fetchMock: Mock;
  let socket: FakeSocket;
  let rooms: FakeRooms;
  let p2p: CallManager;
  let group: GroupCallManager;
  let auto: AutoCallManager;

  beforeEach(() => {
    fetchMock = installFetchMock();
    stubUserMedia(new FakeMediaStream([new FakeTrack('audio')]));
    stubPeerConnection();
    socket = new FakeSocket();
    rooms = fakeRoomFactory();
    const http = new HttpClient({ baseUrl: BASE_URL });
    p2p = new CallManager(http, { userId: 'user-1' });
    group = new GroupCallManager(http, { userId: 'user-1', roomFactory: rooms.factory });
    p2p.bindWebSocket(socket.asClient());
    group.bindWebSocket(socket.asClient());
    auto = new AutoCallManager(p2p, group, new CallsModule(http));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function route(routes: Record<string, RouteReply>): void {
    routeFetch(fetchMock, routes);
  }

  describe('startCall', () => {
    it('confie un appel à deux à CallManager (P2P)', async () => {
      route({ 'POST /calls': { body: TWO }, 'GET /calls/call-1/ice-servers': { body: ICE } });

      const call = await auto.startCall({ participantIds: ['user-2'], callType: 'audio' });

      expect(call.id).toBe('call-1');
      expect(requestLog(fetchMock)).toEqual(['POST /calls', 'GET /calls/call-1/ice-servers']);
      expect(socket.sentOfType('call_join')).toEqual([{ callId: 'call-1' }]);
      expect(rooms.all).toHaveLength(0);
      expect(auto.mode).toBe('p2p');
      expect(auto.state).toBe('outgoing');
    });

    it('confie un appel à trois à GroupCallManager (LiveKit)', async () => {
      route({ 'POST /calls': { body: THREE }, 'GET /calls/call-1/token': { body: TOKEN } });

      await auto.startCall({ participantIds: ['user-2', 'user-3'], callType: 'audio' });

      expect(requestLog(fetchMock)).toEqual(['POST /calls', 'GET /calls/call-1/token']);
      expect(rooms.last().journal).toEqual(['connect', 'micro:true']);
      expect(socket.sentOfType('call_join')).toHaveLength(0);
      expect(p2p.state).toBe('idle');
      expect(auto.mode).toBe('group');
      expect(auto.state).toBe('connected');
    });

    it('refuse un second appel sans créer d’appel', async () => {
      route({ 'POST /calls': { body: THREE }, 'GET /calls/call-1/token': { body: TOKEN } });
      await auto.startCall({ participantIds: ['user-2', 'user-3'], callType: 'audio' });

      await expect(auto.startCall({ participantIds: ['user-4'], callType: 'audio' })).rejects.toThrow(
        'Already in a call'
      );
      expect(requestLog(fetchMock).filter((request) => request === 'POST /calls')).toHaveLength(1);
    });
  });

  describe('answerCall', () => {
    it('décroche un appel à trois via LiveKit, sans le refuser côté P2P', async () => {
      const states: string[] = [];
      auto.onStateChanged = (state) => states.push(state);
      socket.emit('call_incoming', { callId: 'call-1', callerId: 'user-2', callType: 'audio' });
      route({
        'GET /calls/call-1': { body: THREE },
        'GET /calls/call-1/token': { body: TOKEN },
        'POST /calls/call-1/answer': { body: THREE },
      });

      await auto.answerCall('call-1');

      expect(requestLog(fetchMock)).not.toContain('POST /calls/call-1/decline');
      expect(requestLog(fetchMock)).toContain('POST /calls/call-1/answer');
      expect(p2p.state).toBe('idle');
      expect(group.state).toBe('connected');
      expect(auto.mode).toBe('group');
      // Pas d'état « idle » transitoire pendant la passation.
      expect(states).toEqual(['incoming', 'connecting', 'connected']);
    });

    it('décroche un appel à deux en P2P, l’appel entrant par défaut', async () => {
      socket.emit('call_incoming', { callId: 'call-1', callerId: 'user-2', callType: 'audio' });
      route({
        'GET /calls/call-1': { body: TWO },
        'GET /calls/call-1/ice-servers': { body: ICE },
        'POST /calls/call-1/answer': { body: TWO },
      });

      await auto.answerCall();

      expect(requestLog(fetchMock)).toContain('POST /calls/call-1/answer');
      expect(socket.sentOfType('call_join')).toEqual([{ callId: 'call-1' }]);
      expect(rooms.all).toHaveLength(0);
      expect(auto.mode).toBe('p2p');
    });

    it('rejette sans appel entrant à décrocher', async () => {
      await expect(auto.answerCall()).rejects.toThrow('No call to answer');
    });
  });

  describe('événements', () => {
    async function inGroupCall(): Promise<void> {
      route({
        'POST /calls': { body: THREE },
        'GET /calls/call-1/token': { body: TOKEN },
        'PUT /calls/call-1/participants/user-1/mute': { body: { muted: true } },
      });
      await auto.startCall({ participantIds: ['user-2', 'user-3'], callType: 'audio' });
    }

    it('relaie les flux distants du gestionnaire actif', async () => {
      const onRemoteStream = vi.fn();
      auto.onRemoteStream = onRemoteStream;
      await inGroupCall();

      rooms.last().events.trackSubscribed('user-2', new FakeTrack('audio') as unknown as MediaStreamTrack);

      expect(onRemoteStream).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-2' }));
    });

    it('ignore un appel entrant pendant un appel de groupe, comme CallManager occupé', async () => {
      const onIncomingCall = vi.fn();
      auto.onIncomingCall = onIncomingCall;
      await inGroupCall();

      socket.emit('call_incoming', { callId: 'call-9', callerId: 'user-5', callType: 'audio' });

      expect(onIncomingCall).not.toHaveBeenCalled();
      expect(p2p.state).toBe('idle');
      expect(auto.mode).toBe('group');
    });

    it('transmet un appel entrant au repos', () => {
      const onIncomingCall = vi.fn();
      auto.onIncomingCall = onIncomingCall;

      socket.emit('call_incoming', { callId: 'call-9', callerId: 'user-5', callType: 'video' });

      expect(onIncomingCall).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-9', callerId: 'user-5' }));
      expect(auto.mode).toBeNull();
      expect(auto.state).toBe('incoming');
    });

    it('revient au repos, sans mode, à la fin de l’appel', async () => {
      const onCallEnded = vi.fn();
      auto.onCallEnded = onCallEnded;
      await inGroupCall();

      socket.emit('call_ended', { callId: 'call-1', reason: 'ended_by_user' });

      await vi.waitFor(() => expect(auto.mode).toBeNull());
      expect(onCallEnded).toHaveBeenCalledTimes(1);
      expect(auto.state).toBe('idle');
    });
  });

  describe('média', () => {
    it('toggleMute pilote le gestionnaire actif', async () => {
      route({
        'POST /calls': { body: THREE },
        'GET /calls/call-1/token': { body: TOKEN },
        'PUT /calls/call-1/participants/user-1/mute': { body: { muted: true } },
      });
      await auto.startCall({ participantIds: ['user-2', 'user-3'], callType: 'audio' });

      await expect(auto.toggleMute()).resolves.toBe(true);

      expect(rooms.last().journal.at(-1)).toBe('micro:false');
      expect(requestLog(fetchMock).at(-1)).toBe('PUT /calls/call-1/participants/user-1/mute');
    });

    it('refuse le partage d’écran en appel de groupe, pas encore pris en charge', async () => {
      route({ 'POST /calls': { body: THREE }, 'GET /calls/call-1/token': { body: TOKEN } });
      await auto.startCall({ participantIds: ['user-2', 'user-3'], callType: 'audio' });

      await expect(auto.toggleScreenShare()).rejects.toThrow(/partage d’écran|partage d'écran/);
    });
  });
});

describe('ApiCentral.autoCallManager', () => {
  const USER_TOKEN = fakeJwt({ sub: 'app-1', slug: 'demo', token_type: 'user', user_id: 'user-1', exp: 1, iat: 0 });

  beforeEach(() => {
    installFetchMock();
    FakeBrowserWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeBrowserWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('est unique, et garde ses gestionnaires d’événements après une reconnexion', () => {
    const sdk = new ApiCentral({ baseUrl: BASE_URL, token: USER_TOKEN, wsUrl: 'wss://api.example.com/events' });
    const onIncomingCall = vi.fn();
    expect(sdk.autoCallManager).toBe(sdk.autoCallManager);
    sdk.autoCallManager.onIncomingCall = onIncomingCall;

    sdk.connectRealtime(USER_TOKEN);
    FakeBrowserWebSocket.last().open();
    sdk.disconnectRealtime();
    sdk.connectRealtime(USER_TOKEN);
    const socket = FakeBrowserWebSocket.last();
    socket.open();
    socket.receive({ type: 'call_incoming', call_id: 'call-9', caller_id: 'user-5', call_type: 'audio' });

    expect(onIncomingCall).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-9' }));
    sdk.disconnectRealtime();
  });
});
