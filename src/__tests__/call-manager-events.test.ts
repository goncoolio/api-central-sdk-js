import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { CallManager } from '../modules/call-manager';
import { HttpClient } from '../utils/http-client';
import {
  BASE_URL,
  FakeMediaStream,
  FakePeerConnection,
  FakeSocket,
  FakeTrack,
  flushAsync,
  installFetchMock,
  respondJson,
  stubPeerConnection,
  stubUserMedia,
} from './test-helpers';

// Un CallManager ne gère qu'un appel à la fois : les événements des autres
// appels (appel refusé pendant qu'on est occupé, appel de groupe LiveKit
// piloté par GroupCallManager…) ne doivent jamais toucher l'appel en cours.

describe('CallManager — événements limités à l’appel géré', () => {
  let fetchMock: Mock;
  let socket: FakeSocket;
  let micro: FakeTrack;
  let peers: () => FakePeerConnection[];
  let manager: CallManager;

  beforeEach(() => {
    fetchMock = installFetchMock();
    micro = new FakeTrack('audio');
    stubUserMedia(new FakeMediaStream([micro]));
    peers = stubPeerConnection();
    socket = new FakeSocket();
    manager = new CallManager(new HttpClient({ baseUrl: BASE_URL }), { userId: 'user-1' });
    manager.bindWebSocket(socket.asClient());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function startCall(callId = 'call-1'): Promise<void> {
    respondJson(fetchMock, { id: callId, call_type: 'audio', status: 'ringing', participants: [] });
    respondJson(fetchMock, { ice_servers: [], call_id: callId, ttl: 86400 });
    await manager.startCall({ participantIds: ['user-2'], callType: 'audio' });
  }

  it('ignore la fin d’un autre appel pendant un appel en cours', async () => {
    const onCallEnded = vi.fn();
    manager.onCallEnded = onCallEnded;
    await startCall();

    socket.emit('call_ended', { callId: 'call-2', reason: 'ended_by_user' });

    expect(onCallEnded).not.toHaveBeenCalled();
    expect(manager.currentCallId).toBe('call-1');
    expect(manager.state).toBe('outgoing');
    expect(micro.stopped).toBe(false);
  });

  it('ignore call_connected d’un appel qu’il ne gère pas', () => {
    const onCallConnected = vi.fn();
    manager.onCallConnected = onCallConnected;

    socket.emit('call_connected', { callId: 'call-9', participantIds: ['user-2', 'user-3'] });

    expect(manager.state).toBe('idle');
    expect(onCallConnected).not.toHaveBeenCalled();
  });

  it('transmet encore la fin de l’appel qu’il vient de terminer lui-même', async () => {
    const onCallEnded = vi.fn();
    manager.onCallEnded = onCallEnded;
    await startCall();
    respondJson(fetchMock, { id: 'call-1', status: 'ended' });
    await manager.endCall();

    socket.emit('call_ended', { callId: 'call-1', reason: 'ended_by_user' });

    expect(onCallEnded).toHaveBeenCalledTimes(1);
    expect(manager.state).toBe('idle');
  });

  it('ne négocie pas tant que l’appel entrant n’est pas décroché', async () => {
    socket.emit('call_incoming', { callId: 'call-3', callerId: 'user-2', callType: 'audio' });

    socket.emit('call_answered', { callId: 'call-3', userId: 'user-4' });
    socket.emit('call_participant_joined', { callId: 'call-3', userId: 'user-4' });
    await flushAsync();

    expect(manager.state).toBe('incoming');
    expect(peers()).toHaveLength(0);
    expect(socket.sentOfType('call_offer')).toHaveLength(0);
  });

  it('ignore son propre call_participant_joined, mais négocie avec les autres', async () => {
    const onParticipantJoined = vi.fn();
    manager.onParticipantJoined = onParticipantJoined;
    await startCall();

    socket.emit('call_participant_joined', { callId: 'call-1', userId: 'user-1' });
    await flushAsync();
    expect(peers()).toHaveLength(0);
    expect(onParticipantJoined).not.toHaveBeenCalled();

    socket.emit('call_participant_joined', { callId: 'call-1', userId: 'user-2' });
    await vi.waitFor(() => expect(socket.sentOfType('call_offer')).toHaveLength(1));
    expect(socket.sentOfType('call_offer')[0]).toMatchObject({ callId: 'call-1', toUserId: 'user-2' });
    expect(onParticipantJoined).toHaveBeenCalledTimes(1);
  });

  it('ignore une offre SDP destinée à un autre appel', async () => {
    await startCall();

    socket.emit('call_offer_received', {
      callId: 'call-2',
      fromUserId: 'user-3',
      sdp: JSON.stringify({ type: 'offer', sdp: 'v=0' }),
    });
    await flushAsync();

    expect(peers()).toHaveLength(0);
    expect(socket.sentOfType('call_answer')).toHaveLength(0);
  });

  it('ignore les changements média d’un autre appel', async () => {
    const onMuteChanged = vi.fn();
    manager.onMuteChanged = onMuteChanged;
    await startCall();

    socket.emit('call_mute_changed', { callId: 'call-2', userId: 'user-3', isMuted: true });
    socket.emit('call_mute_changed', { callId: 'call-1', userId: 'user-2', isMuted: true });

    expect(onMuteChanged).toHaveBeenCalledTimes(1);
    expect(onMuteChanged).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1', userId: 'user-2' }));
  });

  it('refuser un autre appel ne coupe pas l’appel en cours', async () => {
    await startCall();
    respondJson(fetchMock, { success: true });

    await manager.declineCall('call-5');

    expect(manager.currentCallId).toBe('call-1');
    expect(manager.state).toBe('outgoing');
    expect(micro.stopped).toBe(false);
  });

  it('n’envoie pas call_leave pour un appel entrant jamais rejoint', () => {
    const onCallEnded = vi.fn();
    manager.onCallEnded = onCallEnded;
    socket.emit('call_incoming', { callId: 'call-3', callerId: 'user-2', callType: 'audio' });

    socket.emit('call_ended', { callId: 'call-3', reason: 'ended_by_user' });

    expect(onCallEnded).toHaveBeenCalledTimes(1);
    expect(manager.state).toBe('idle');
    expect(socket.sentOfType('call_leave')).toHaveLength(0);
  });
});
