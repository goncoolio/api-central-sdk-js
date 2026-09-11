import type { DisconnectReason, LocalTrackPublication, Participant, Room } from 'livekit-client';

// =============================================================================
// Salle LiveKit d'un appel de groupe, réduite à ce que pilote
// GroupCallManager. livekit-client, dépendance facultative, n'est chargé qu'à
// la demande ; une doublure peut le remplacer (tests, intégration sur mesure).
//
// Navigateur uniquement : livekit-client s'appuie sur WebRTC.
// =============================================================================

/** Participant distant ; son identité LiveKit est son identifiant utilisateur API. */
export interface GroupCallRoomParticipant {
  userId: string;
  userName?: string;
}

/** Événements de la salle exploités par GroupCallManager. */
export interface GroupCallRoomEvents {
  participantConnected(participant: GroupCallRoomParticipant): void;
  participantDisconnected(userId: string): void;
  trackSubscribed(userId: string, track: MediaStreamTrack): void;
  trackUnsubscribed(userId: string, track: MediaStreamTrack): void;
  reconnecting(): void;
  reconnected(): void;
  /** Salle fermée ; `reason` : raison LiveKit (DisconnectReason) en minuscules, `unknown` à défaut. */
  disconnected(reason: string): void;
}

/** Salle LiveKit pilotée par GroupCallManager. */
export interface GroupCallRoom {
  connect(url: string, token: string): Promise<void>;
  /** Active ou coupe le micro ; renvoie la piste locale active, `null` une fois coupé. */
  setMicrophoneEnabled(enabled: boolean): Promise<MediaStreamTrack | null>;
  /** Active ou coupe la caméra ; renvoie la piste locale active, `null` une fois coupée. */
  setCameraEnabled(enabled: boolean): Promise<MediaStreamTrack | null>;
  disconnect(): Promise<void>;
}

/** Crée la salle d'un appel ; elle signale ses événements à `events`. */
export type GroupCallRoomFactory = (events: GroupCallRoomEvents) => Promise<GroupCallRoom>;

type LiveKitClient = typeof import('livekit-client');

/** Levée quand livekit-client n'est pas installé. */
export const LIVEKIT_CLIENT_MISSING =
  'Les appels de groupe exigent le paquet livekit-client : installez-le (npm install livekit-client@^2.22).';

/**
 * Charge livekit-client à la demande, ou lève une erreur explicite s'il
 * manque. `importModule` remplace l'import (tests).
 */
export async function loadLiveKitClient(importModule?: () => Promise<LiveKitClient>): Promise<LiveKitClient> {
  try {
    // L'import reste dans le bloc try : esbuild (Vite) tolère alors un paquet
    // absent au bundling, et l'échec survient ici, au chargement.
    return importModule ? await importModule() : await import('livekit-client');
  } catch (cause) {
    throw new Error(LIVEKIT_CLIENT_MISSING, { cause });
  }
}

/**
 * Fabrique par défaut : une Room livekit-client. `importModule` remplace
 * l'import du paquet (tests).
 */
export function createLiveKitRoomFactory(importModule?: () => Promise<LiveKitClient>): GroupCallRoomFactory {
  return async (events) => {
    const livekit = await loadLiveKitClient(importModule);
    // adaptiveStream reste désactivé (valeur par défaut) : les pistes sont
    // exposées brutes, et LiveKit mettrait en pause une vidéo qu'il ne voit
    // attachée à aucun élément.
    const room = new livekit.Room();
    wireRoomEvents(livekit, room, events);

    return {
      async connect(url, token) {
        await room.connect(url, token);
        // Les participants déjà présents ne déclenchent pas ParticipantConnected.
        for (const participant of room.remoteParticipants.values()) {
          events.participantConnected(toParticipant(participant));
        }
      },
      async setMicrophoneEnabled(enabled) {
        return activeTrack(await room.localParticipant.setMicrophoneEnabled(enabled), enabled);
      },
      async setCameraEnabled(enabled) {
        return activeTrack(await room.localParticipant.setCameraEnabled(enabled), enabled);
      },
      disconnect: () => room.disconnect(),
    };
  };
}

function wireRoomEvents(livekit: LiveKitClient, room: Room, events: GroupCallRoomEvents): void {
  const { RoomEvent } = livekit;
  room
    .on(RoomEvent.ParticipantConnected, (participant) => events.participantConnected(toParticipant(participant)))
    .on(RoomEvent.ParticipantDisconnected, (participant) => events.participantDisconnected(participant.identity))
    .on(RoomEvent.TrackSubscribed, (track, _publication, participant) =>
      events.trackSubscribed(participant.identity, track.mediaStreamTrack)
    )
    .on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) =>
      events.trackUnsubscribed(participant.identity, track.mediaStreamTrack)
    )
    .on(RoomEvent.Reconnecting, () => events.reconnecting())
    .on(RoomEvent.Reconnected, () => events.reconnected())
    .on(RoomEvent.Disconnected, (reason) => events.disconnected(disconnectReasonName(livekit, reason)));
}

function toParticipant(participant: Pick<Participant, 'identity' | 'name'>): GroupCallRoomParticipant {
  return participant.name
    ? { userId: participant.identity, userName: participant.name }
    : { userId: participant.identity };
}

function activeTrack(publication: LocalTrackPublication | undefined, enabled: boolean): MediaStreamTrack | null {
  return enabled ? (publication?.track?.mediaStreamTrack ?? null) : null;
}

/** `DisconnectReason.DUPLICATE_IDENTITY` devient `duplicate_identity`. */
function disconnectReasonName(livekit: LiveKitClient, reason: DisconnectReason | undefined): string {
  if (reason === undefined) return 'unknown';
  const name: unknown = (livekit.DisconnectReason as unknown as Record<number, unknown>)[reason];
  return typeof name === 'string' ? name.toLowerCase() : 'unknown';
}
