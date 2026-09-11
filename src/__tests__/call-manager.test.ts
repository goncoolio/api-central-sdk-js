import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { CallManager } from '../modules/call-manager';
import type { CallManagerConfig } from '../modules/call-manager';
import { ApiCentralError, HttpClient } from '../utils/http-client';
import {
  BASE_URL,
  FakeMediaStream,
  FakeSocket,
  FakeTrack,
  installFetchMock,
  requestAt,
  respondJson,
  stubUserMedia,
} from './test-helpers';

/** Démarre un appel audio sortant : POST /calls puis GET ice-servers. */
async function startAudioCall(manager: CallManager, fetchMock: Mock): Promise<void> {
  respondJson(fetchMock, { id: 'call-1', call_type: 'audio', status: 'ringing', participants: [] });
  respondJson(fetchMock, { ice_servers: [], call_id: 'call-1', ttl: 86400 });
  await manager.startCall({ participantIds: ['user-2'], callType: 'audio' });
}

describe('CallManager — identifiant de l’utilisateur local', () => {
  let fetchMock: Mock;
  let socket: FakeSocket;
  let micro: FakeTrack;
  let screenTrack: FakeTrack;

  beforeEach(() => {
    fetchMock = installFetchMock();
    micro = new FakeTrack('audio');
    screenTrack = new FakeTrack('video');
    stubUserMedia(new FakeMediaStream([micro]), new FakeMediaStream([screenTrack]));
    socket = new FakeSocket();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createManager(config: CallManagerConfig = {}): CallManager {
    const manager = new CallManager(new HttpClient({ baseUrl: BASE_URL }), config);
    manager.bindWebSocket(socket.asClient());
    return manager;
  }

  it('adresse le participant par le userId configuré, et non par "me"', async () => {
    const manager = createManager({ userId: 'user-1' });
    await startAudioCall(manager, fetchMock);
    respondJson(fetchMock, { muted: true });

    await expect(manager.toggleMute()).resolves.toBe(true);

    expect(requestAt(fetchMock, 2)).toMatchObject({
      url: `${BASE_URL}/calls/call-1/participants/user-1/mute`,
      method: 'PUT',
      body: { muted: true },
    });
  });

  it('déduit l’identifiant de l’événement WebSocket connected', async () => {
    const manager = createManager();
    socket.emit('connected', { socketId: 'socket-1', user: { id: 'user-9', externalId: 'ext-9' } });
    await startAudioCall(manager, fetchMock);
    respondJson(fetchMock, { video_enabled: false });

    await manager.toggleVideo();

    expect(manager.localUserId).toBe('user-9');
    expect(requestAt(fetchMock, 2).url).toBe(`${BASE_URL}/calls/call-1/participants/user-9/video`);
  });

  it('accepte un identifiant fourni par setLocalUserId', async () => {
    const manager = createManager();
    manager.setLocalUserId('user-5');
    await startAudioCall(manager, fetchMock);
    respondJson(fetchMock, { muted: true });

    await manager.toggleMute();

    expect(requestAt(fetchMock, 2).url).toBe(`${BASE_URL}/calls/call-1/participants/user-5/mute`);
  });

  it('garde le userId configuré, prioritaire sur les identifiants déduits', async () => {
    const manager = createManager({ userId: 'user-1' });
    socket.emit('connected', { socketId: 'socket-1', user: { id: 'user-9', externalId: 'ext-9' } });
    manager.setLocalUserId('user-5');

    expect(manager.localUserId).toBe('user-1');
  });

  it('rejette sans requête si l’identifiant est inconnu, le micro restant coupé localement', async () => {
    const manager = createManager();
    await startAudioCall(manager, fetchMock);

    await expect(manager.toggleMute()).rejects.toThrow(/utilisateur local inconnu/);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(micro.enabled).toBe(false);
    expect(manager.isMuted).toBe(true);
  });

  it('propage l’échec de l’API au lieu de l’avaler, en conservant l’état local', async () => {
    const manager = createManager({ userId: 'user-1' });
    await startAudioCall(manager, fetchMock);
    respondJson(fetchMock, { message: 'Call not found', statusCode: 404 }, 404);

    await expect(manager.toggleMute()).rejects.toBeInstanceOf(ApiCentralError);

    expect(manager.isMuted).toBe(true);
    expect(micro.enabled).toBe(false);
  });

  it('signale par onError l’échec quand le partage d’écran est arrêté depuis le navigateur', async () => {
    const manager = createManager({ userId: 'user-1' });
    const onError = vi.fn();
    manager.onError = onError;
    await startAudioCall(manager, fetchMock);
    respondJson(fetchMock, { screen_sharing: true });
    await expect(manager.toggleScreenShare()).resolves.toBe(true);
    expect(requestAt(fetchMock, 2).url).toBe(`${BASE_URL}/calls/call-1/participants/user-1/screen`);

    respondJson(fetchMock, { message: 'Internal error', statusCode: 500 }, 500);
    screenTrack.onended?.();

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    const [event] = onError.mock.calls[0] as [{ callId: string | null; error: Error }];
    expect(event.callId).toBe('call-1');
    expect(event.error).toBeInstanceOf(ApiCentralError);
    expect(manager.isScreenSharing).toBe(false);
  });
});
