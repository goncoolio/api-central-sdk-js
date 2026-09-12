import type { HttpClient } from '../utils/http-client';

// =============================================================================
// Éléments partagés par les gestionnaires d'appels : CallManager (P2P),
// GroupCallManager (LiveKit) et AutoCallManager. Mêmes états et mêmes charges
// d'événements : une application change de gestionnaire sans réécrire ses
// gestionnaires d'événements.
// =============================================================================

export type CallManagerState = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected' | 'ended';

/** Erreur survenue en arrière-plan, hors de toute promesse attendue par l'application. */
export interface CallErrorEvent {
  callId: string | null;
  error: Error;
}

/** Appel entrant (`call_incoming`). */
export interface IncomingCallEvent {
  callId: string;
  callerId: string;
  callerName?: string;
  callType: string;
}

/** Appel établi côté API (`call_connected`). */
export interface CallConnectedEvent {
  callId: string;
  participantIds: string[];
}

/** Fin d'appel : `call_ended` de l'API, ou salle LiveKit perdue (`sfu_disconnected`). */
export interface CallEndedEvent {
  callId: string;
  reason: string;
  durationSeconds?: number;
}

/** Flux média d'un participant distant. */
export interface RemoteStreamEvent {
  userId: string;
  stream: MediaStream;
}

/** Participant arrivé dans l'appel, ou reparti. */
export interface CallParticipantEvent {
  callId: string;
  userId: string;
  userName?: string;
}

export interface MuteChangedEvent {
  callId: string;
  userId: string;
  isMuted: boolean;
}

export interface VideoChangedEvent {
  callId: string;
  userId: string;
  isVideoEnabled: boolean;
}

export interface ScreenShareChangedEvent {
  callId: string;
  userId: string;
  isScreenSharing: boolean;
}

/** Levée quand l'identifiant local manque pour notifier l'API. */
export const MISSING_LOCAL_USER_ID =
  "Identifiant de l'utilisateur local inconnu : impossible de notifier l'API. " +
  'Renseignez userId dans la configuration du gestionnaire, ou connectez le temps réel avec un jeton utilisateur.';

/** Bascule média du participant local, signalée à l'API. */
export type ParticipantMediaEndpoint = 'mute' | 'video' | 'screen';

/**
 * Notifie l'API de l'état média du participant local, adressé par son
 * identifiant réel : l'API attend un UUID dans le chemin.
 */
export async function notifyParticipantMedia(
  httpClient: HttpClient,
  callId: string,
  userId: string | null,
  endpoint: ParticipantMediaEndpoint,
  body: Record<string, boolean>
): Promise<void> {
  if (!userId) throw new Error(MISSING_LOCAL_USER_ID);
  await httpClient.put(`/calls/${callId}/participants/${userId}/${endpoint}`, body);
}

/** Toute valeur levée devient une `Error`. */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
