import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { createLiveKitRoomFactory, loadLiveKitClient } from '../modules/livekit-room';
import type { GroupCallRoomEvents } from '../modules/livekit-room';

// Adaptateur entre livekit-client et GroupCallManager. Le vrai paquet exige un
// navigateur : ces tests lui substituent une doublure qui expose ce que
// l'adaptateur utilise (Room, RoomEvent, DisconnectReason).

const RoomEvent = {
  ParticipantConnected: 'participantConnected',
  ParticipantDisconnected: 'participantDisconnected',
  TrackSubscribed: 'trackSubscribed',
  TrackUnsubscribed: 'trackUnsubscribed',
  Reconnecting: 'reconnecting',
  Reconnected: 'reconnected',
  Disconnected: 'disconnected',
} as const;

// Enum numérique de @livekit/protocol : correspondance dans les deux sens.
const DisconnectReason: Record<string | number, string | number> = {
  UNKNOWN_REASON: 0,
  0: 'UNKNOWN_REASON',
  CLIENT_INITIATED: 1,
  1: 'CLIENT_INITIATED',
  DUPLICATE_IDENTITY: 2,
  2: 'DUPLICATE_IDENTITY',
};

const MIC = { kind: 'audio', id: 'mic' } as unknown as MediaStreamTrack;
const CAM = { kind: 'video', id: 'cam' } as unknown as MediaStreamTrack;

class FakeRoom {
  static instances: FakeRoom[] = [];
  readonly listeners = new Map<string, (...args: unknown[]) => void>();
  readonly connect = vi.fn(async (_url: string, _token: string) => undefined);
  readonly disconnect = vi.fn(async () => undefined);
  readonly remoteParticipants = new Map([['PA_existant', { identity: 'user-3', name: 'Carol' }]]);
  readonly localParticipant = {
    setMicrophoneEnabled: vi.fn(async (enabled: boolean) => (enabled ? { track: { mediaStreamTrack: MIC } } : undefined)),
    setCameraEnabled: vi.fn(async (enabled: boolean) => (enabled ? { track: { mediaStreamTrack: CAM } } : undefined)),
  };

  constructor(readonly options?: Record<string, unknown>) {
    FakeRoom.instances.push(this);
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    this.listeners.set(event, listener);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.(...args);
  }
}

const fakeLiveKit = { Room: FakeRoom, RoomEvent, DisconnectReason };

type SpiedEvents = { [K in keyof GroupCallRoomEvents]: Mock };

function spyEvents(): SpiedEvents {
  return {
    participantConnected: vi.fn(),
    participantDisconnected: vi.fn(),
    trackSubscribed: vi.fn(),
    trackUnsubscribed: vi.fn(),
    reconnecting: vi.fn(),
    reconnected: vi.fn(),
    disconnected: vi.fn(),
  };
}

async function createRoom(events: SpiedEvents) {
  FakeRoom.instances = [];
  const factory = createLiveKitRoomFactory(async () => fakeLiveKit as never);
  const room = await factory(events as unknown as GroupCallRoomEvents);
  const livekitRoom = FakeRoom.instances[0];
  if (!livekitRoom) throw new Error('Aucune Room créée');
  return { room, livekitRoom };
}

describe('loadLiveKitClient', () => {
  it('lève une erreur explicite, en français, si livekit-client est absent', async () => {
    const cause = new Error("Cannot find package 'livekit-client'");

    const error = (await loadLiveKitClient(() => Promise.reject(cause)).catch((e: unknown) => e)) as Error;

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/livekit-client/);
    expect(error.message).toMatch(/installez/i);
    expect(error.cause).toBe(cause);
  });

  it('renvoie le module chargé', async () => {
    await expect(loadLiveKitClient(async () => fakeLiveKit as never)).resolves.toBe(fakeLiveKit);
  });
});

describe('createLiveKitRoomFactory', () => {
  it('se connecte à l’URL et au jeton fournis, puis annonce les participants déjà présents', async () => {
    const events = spyEvents();
    const { room, livekitRoom } = await createRoom(events);

    await room.connect('wss://sfu.example.test', 'jeton-sfu');

    expect(livekitRoom.connect).toHaveBeenCalledWith('wss://sfu.example.test', 'jeton-sfu');
    expect(events.participantConnected).toHaveBeenCalledWith({ userId: 'user-3', userName: 'Carol' });
  });

  it('n’active pas adaptiveStream : les pistes brutes sont exposées sans élément attaché', async () => {
    const { livekitRoom } = await createRoom(spyEvents());

    expect(livekitRoom.options?.['adaptiveStream'] ?? false).toBe(false);
  });

  it('relaie participants, pistes, reconnexions et déconnexion', async () => {
    const events = spyEvents();
    const { livekitRoom } = await createRoom(events);
    const track = { mediaStreamTrack: MIC };
    const participant = { identity: 'user-2', name: '' };

    livekitRoom.emit(RoomEvent.ParticipantConnected, participant);
    livekitRoom.emit(RoomEvent.TrackSubscribed, track, {}, participant);
    livekitRoom.emit(RoomEvent.TrackUnsubscribed, track, {}, participant);
    livekitRoom.emit(RoomEvent.ParticipantDisconnected, participant);
    livekitRoom.emit(RoomEvent.Reconnecting);
    livekitRoom.emit(RoomEvent.Reconnected);
    livekitRoom.emit(RoomEvent.Disconnected, 2);

    expect(events.participantConnected).toHaveBeenCalledWith({ userId: 'user-2' });
    expect(events.trackSubscribed).toHaveBeenCalledWith('user-2', MIC);
    expect(events.trackUnsubscribed).toHaveBeenCalledWith('user-2', MIC);
    expect(events.participantDisconnected).toHaveBeenCalledWith('user-2');
    expect(events.reconnecting).toHaveBeenCalledTimes(1);
    expect(events.reconnected).toHaveBeenCalledTimes(1);
    expect(events.disconnected).toHaveBeenCalledWith('duplicate_identity');
  });

  it('nomme « unknown » une déconnexion sans raison', async () => {
    const events = spyEvents();
    const { livekitRoom } = await createRoom(events);

    livekitRoom.emit(RoomEvent.Disconnected);

    expect(events.disconnected).toHaveBeenCalledWith('unknown');
  });

  it('publie micro et caméra et renvoie leurs pistes ; null une fois coupés', async () => {
    const { room, livekitRoom } = await createRoom(spyEvents());

    await expect(room.setMicrophoneEnabled(true)).resolves.toBe(MIC);
    await expect(room.setCameraEnabled(true)).resolves.toBe(CAM);
    await expect(room.setMicrophoneEnabled(false)).resolves.toBeNull();
    await room.disconnect();

    expect(livekitRoom.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(livekitRoom.disconnect).toHaveBeenCalledTimes(1);
  });
});
