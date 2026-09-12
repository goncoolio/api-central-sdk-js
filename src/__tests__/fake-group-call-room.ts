import type { GroupCallRoom, GroupCallRoomEvents, GroupCallRoomFactory } from '../modules/livekit-room';
import { FakeTrack } from './test-helpers';

// =============================================================================
// Salle LiveKit simulée : journalise ce que GroupCallManager lui demande, et
// laisse le test émettre les événements d'une vraie salle.
// =============================================================================

function asTrack(track: FakeTrack): MediaStreamTrack {
  return track as unknown as MediaStreamTrack;
}

export class FakeGroupCallRoom implements GroupCallRoom {
  /** Opérations demandées, dans l'ordre : `connect`, `micro:true`… */
  readonly journal: string[] = [];
  url: string | null = null;
  token: string | null = null;
  readonly microphone = new FakeTrack('audio');
  readonly camera = new FakeTrack('video');

  constructor(
    /** Événements de la salle, à émettre depuis le test. */
    readonly events: GroupCallRoomEvents,
    private readonly connectError: Error | null,
    private readonly connectGate: Promise<void> | null
  ) {}

  async connect(url: string, token: string): Promise<void> {
    this.journal.push('connect');
    if (this.connectGate) await this.connectGate;
    if (this.connectError) throw this.connectError;
    this.url = url;
    this.token = token;
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<MediaStreamTrack | null> {
    this.journal.push(`micro:${enabled}`);
    return enabled ? asTrack(this.microphone) : null;
  }

  async setCameraEnabled(enabled: boolean): Promise<MediaStreamTrack | null> {
    this.journal.push(`camera:${enabled}`);
    return enabled ? asTrack(this.camera) : null;
  }

  async disconnect(): Promise<void> {
    this.journal.push('disconnect');
  }
}

export interface FakeRooms {
  factory: GroupCallRoomFactory;
  /** Salles créées, dans l'ordre. */
  readonly all: FakeGroupCallRoom[];
  last(): FakeGroupCallRoom;
  /** La prochaine salle créée échouera à se connecter avec cette erreur. */
  failNextConnect(error: Error): void;
  /**
   * Retient la connexion de la prochaine salle : elle n'aboutit qu'à l'appel
   * du libérateur renvoyé. Sert à tester ce qui arrive pendant la connexion.
   */
  holdNextConnect(): () => void;
}

export function fakeRoomFactory(): FakeRooms {
  const all: FakeGroupCallRoom[] = [];
  let nextConnectError: Error | null = null;
  let nextConnectGate: Promise<void> | null = null;

  return {
    all,
    factory: async (events) => {
      const room = new FakeGroupCallRoom(events, nextConnectError, nextConnectGate);
      nextConnectError = null;
      nextConnectGate = null;
      all.push(room);
      return room;
    },
    last() {
      const room = all[all.length - 1];
      if (!room) throw new Error('Aucune salle créée');
      return room;
    },
    failNextConnect(error) {
      nextConnectError = error;
    },
    holdNextConnect() {
      let liberer: () => void = () => {};
      nextConnectGate = new Promise<void>((resolve) => {
        liberer = resolve;
      });
      return liberer;
    },
  };
}
