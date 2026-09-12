import type { HttpClient } from '../utils/http-client';
import type { WebSocketClient } from '../utils/ws-client';
import type { CallResponse, CallType } from '../types';
import { CallsModule } from './calls';
import type { StartCallParams } from './call-manager';
import { notifyParticipantMedia, toError } from './call-shared';
import type {
  CallConnectedEvent,
  CallEndedEvent,
  CallErrorEvent,
  CallManagerState,
  CallParticipantEvent,
  MuteChangedEvent,
  ParticipantMediaEndpoint,
  RemoteStreamEvent,
  VideoChangedEvent,
} from './call-shared';
import { createLiveKitRoomFactory } from './livekit-room';
import type { GroupCallRoom, GroupCallRoomEvents, GroupCallRoomFactory, GroupCallRoomParticipant } from './livekit-room';

// =============================================================================
// Group Call Manager - appels de groupe via le SFU LiveKit
//
// Navigateur uniquement : livekit-client s'appuie sur WebRTC. Ce paquet est
// une dépendance facultative, chargée à la demande au premier appel.
//
// L'URL du serveur LiveKit vient toujours de l'API (GET /calls/{id}/token).
// Les gestionnaires d'événements reçoivent les mêmes charges que ceux de
// CallManager.
// =============================================================================

export interface GroupCallManagerConfig {
  /**
   * Identifiant (UUID API Central) de l'utilisateur local, pour notifier
   * l'API des bascules micro et caméra. Prime sur les valeurs déduites
   * (jeton utilisateur, événement WebSocket `connected`).
   */
  userId?: string;
  /**
   * Fabrique de la salle LiveKit ; par défaut une Room livekit-client, chargée
   * à la demande.
   */
  roomFactory?: GroupCallRoomFactory;
}

type CallConnectedHandler = (data: CallConnectedEvent) => void;
type CallEndedHandler = (data: CallEndedEvent) => void;
type RemoteStreamHandler = (data: RemoteStreamEvent) => void;
type ParticipantHandler = (data: CallParticipantEvent) => void;
type MuteChangedHandler = (data: MuteChangedEvent) => void;
type VideoChangedHandler = (data: VideoChangedEvent) => void;
type StateChangedHandler = (state: CallManagerState) => void;
type CallErrorHandler = (data: CallErrorEvent) => void;

/** Levée quand l'appel se termine pendant la connexion à la salle. */
const CALL_ENDED_WHILE_JOINING = "L'appel s'est terminé pendant la connexion à la salle LiveKit.";

/** Raison transmise à onCallEnded quand la salle se ferme sans que le client l'ait demandé. */
const SFU_DISCONNECTED = 'sfu_disconnected';

export class GroupCallManager {
  private readonly httpClient: HttpClient;
  private readonly calls: CallsModule;
  private readonly config: GroupCallManagerConfig;
  private readonly roomFactory: GroupCallRoomFactory;
  private wsUnsubs: Array<() => void> = [];

  private _state: CallManagerState = 'idle';
  private _currentCallId: string | null = null;
  // Appel que l'on vient de quitter : sa fin (call_ended) reste transmise.
  private _lastCallId: string | null = null;
  private _localUserId: string | null;
  private _localStream: MediaStream | null = null;
  private _isMuted = false;
  private _isVideoEnabled = false;

  private room: GroupCallRoom | null = null;
  // Change à chaque appel et à chaque libération : les événements d'une
  // salle quittée sont ignorés.
  private session = 0;
  private readonly remoteStreams = new Map<string, MediaStream>();
  private readonly announced = new Set<string>();

  private handlers = {
    onCallConnected: null as CallConnectedHandler | null,
    onCallEnded: null as CallEndedHandler | null,
    onRemoteStream: null as RemoteStreamHandler | null,
    onParticipantJoined: null as ParticipantHandler | null,
    onParticipantLeft: null as ParticipantHandler | null,
    onMuteChanged: null as MuteChangedHandler | null,
    onVideoChanged: null as VideoChangedHandler | null,
    onStateChanged: null as StateChangedHandler | null,
    onError: null as CallErrorHandler | null,
  };

  constructor(httpClient: HttpClient, config?: GroupCallManagerConfig) {
    this.httpClient = httpClient;
    this.calls = new CallsModule(httpClient);
    this.config = config ?? {};
    this.roomFactory = this.config.roomFactory ?? createLiveKitRoomFactory();
    this._localUserId = this.config.userId ?? null;
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  get state(): CallManagerState { return this._state; }
  get currentCallId(): string | null { return this._currentCallId; }
  get localUserId(): string | null { return this._localUserId; }
  /** Pistes locales publiées (micro, caméra), pour l'aperçu. */
  get localStream(): MediaStream | null { return this._localStream; }
  get isMuted(): boolean { return this._isMuted; }
  get isVideoEnabled(): boolean { return this._isVideoEnabled; }
  /** Participants distants présents dans la salle. */
  get participantIds(): string[] { return [...this.announced]; }

  /**
   * Renseigne l'identifiant de l'utilisateur local, déduit du contexte
   * d'authentification. Sans effet si `userId` est fixé dans la configuration.
   */
  setLocalUserId(userId: string): void {
    if (this.config.userId) return;
    this._localUserId = userId;
  }

  getRemoteStream(userId: string): MediaStream | null {
    return this.remoteStreams.get(userId) ?? null;
  }

  getRemoteStreams(): Map<string, MediaStream> {
    return new Map(this.remoteStreams);
  }

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------

  set onCallConnected(handler: CallConnectedHandler | null) { this.handlers.onCallConnected = handler; }
  set onCallEnded(handler: CallEndedHandler | null) { this.handlers.onCallEnded = handler; }
  set onRemoteStream(handler: RemoteStreamHandler | null) { this.handlers.onRemoteStream = handler; }
  set onParticipantJoined(handler: ParticipantHandler | null) { this.handlers.onParticipantJoined = handler; }
  set onParticipantLeft(handler: ParticipantHandler | null) { this.handlers.onParticipantLeft = handler; }
  set onMuteChanged(handler: MuteChangedHandler | null) { this.handlers.onMuteChanged = handler; }
  set onVideoChanged(handler: VideoChangedHandler | null) { this.handlers.onVideoChanged = handler; }
  set onStateChanged(handler: StateChangedHandler | null) { this.handlers.onStateChanged = handler; }
  /** Erreurs survenues en arrière-plan ; les méthodes attendues rejettent leur promesse à la place. */
  set onError(handler: CallErrorHandler | null) { this.handlers.onError = handler; }

  // ---------------------------------------------------------------------------
  // WebSocket Binding : seuls les événements de l'appel géré sont traités.
  // ---------------------------------------------------------------------------

  bindWebSocket(ws: WebSocketClient): void {
    this.unbindWebSocket();

    this.wsUnsubs.push(
      // À la connexion, le serveur annonce l'utilisateur du jeton.
      ws.on('connected', (data: any) => {
        const userId = data.user?.id;
        if (typeof userId === 'string') this.setLocalUserId(userId);
      }),

      ws.on('call_connected', (data: any) => {
        if (this.isCurrentCall(data.callId)) this.handlers.onCallConnected?.(data);
      }),

      ws.on('call_ended', (data: any) => this.handleCallEnded(data)),

      ws.on('call_mute_changed', (data: any) => {
        if (this.isCurrentCall(data.callId)) this.handlers.onMuteChanged?.(data);
      }),

      ws.on('call_video_changed', (data: any) => {
        if (this.isCurrentCall(data.callId)) this.handlers.onVideoChanged?.(data);
      }),
    );
  }

  unbindWebSocket(): void {
    for (const unsub of this.wsUnsubs) unsub();
    this.wsUnsubs = [];
  }

  // ---------------------------------------------------------------------------
  // Call Lifecycle
  // ---------------------------------------------------------------------------

  /** Crée l'appel (POST /calls), puis rejoint sa salle LiveKit. */
  async startCall(params: StartCallParams): Promise<CallResponse> {
    this.assertIdle();
    const call = await this.calls.initiate(params);
    return this.startExistingCall(call);
  }

  /**
   * Rejoint la salle d'un appel que l'on vient de créer : jeton LiveKit,
   * connexion, publication du micro (et de la caméra pour un appel vidéo).
   * En cas d'échec, la salle est libérée et l'appel terminé côté API.
   */
  async startExistingCall(call: CallResponse): Promise<CallResponse> {
    this.assertIdle();
    const session = this.beginCall(call.id);
    try {
      await this.joinRoom(session, call.id, call.callType);
    } catch (error) {
      if (session === this.session) {
        await this.release();
        await this.endAbandonedCall(call.id);
      }
      throw error;
    }
    this.setState('connected');
    return call;
  }

  /**
   * Décroche un appel de groupe. La salle est rejointe et le média publié
   * avant de décrocher : si l'une échoue, l'appel n'est pas décroché et
   * continue de sonner.
   */
  async answerCall(callId: string): Promise<CallResponse> {
    this.assertIdle();
    const session = this.beginCall(callId);
    try {
      const call = await this.calls.get(callId);
      await this.joinRoom(session, callId, call.callType);
      const answered = await this.httpClient.post<CallResponse>(`/calls/${callId}/answer`);
      this.ensureSession(session);
      this.setState('connected');
      return answered;
    } catch (error) {
      if (session === this.session) await this.release();
      throw error;
    }
  }

  /** Refuse un appel entrant. */
  async declineCall(callId: string): Promise<void> {
    await this.httpClient.post(`/calls/${callId}/decline`);
  }

  /**
   * Quitte l'appel (il continue pour les autres), puis la salle. La salle
   * est libérée même si l'API n'a pas pu être prévenue ; la promesse rejette
   * alors.
   */
  async leaveCall(): Promise<void> {
    const id = this._currentCallId;
    if (!id) return;
    try {
      await this.httpClient.post(`/calls/${id}/leave`);
    } finally {
      await this.finishCall(id);
    }
  }

  /** Termine l'appel pour tous, puis quitte la salle ; même garantie que leaveCall. */
  async endCall(): Promise<void> {
    const id = this._currentCallId;
    if (!id) return;
    try {
      await this.httpClient.post(`/calls/${id}/end`);
    } finally {
      await this.finishCall(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Media Controls
  //
  // La salle est pilotée d'abord ; si elle échoue, rien ne change et la
  // promesse rejette. L'état local est ensuite conservé même si l'API n'a pas
  // pu être notifiée : la promesse rejette alors.
  // ---------------------------------------------------------------------------

  async toggleMute(): Promise<boolean> {
    const muted = !this._isMuted;
    this.addLocalTrack((await this.room?.setMicrophoneEnabled(!muted)) ?? null);
    this._isMuted = muted;
    await this.notify('mute', { muted });
    return muted;
  }

  async toggleVideo(): Promise<boolean> {
    const enabled = !this._isVideoEnabled;
    this.addLocalTrack((await this.room?.setCameraEnabled(enabled)) ?? null);
    this._isVideoEnabled = enabled;
    await this.notify('video', { enabled });
    return enabled;
  }

  // ---------------------------------------------------------------------------
  // Salle LiveKit
  // ---------------------------------------------------------------------------

  private async joinRoom(session: number, callId: string, callType: CallType): Promise<void> {
    const { url, token } = await this.calls.getLiveKitToken(callId);
    this.ensureSession(session);

    const room = await this.roomFactory(this.roomEvents(session));
    if (session !== this.session) {
      await room.disconnect();
      throw new Error(CALL_ENDED_WHILE_JOINING);
    }
    this.room = room;

    // Toujours l'URL fournie par l'API, jamais une URL codée en dur.
    await room.connect(url, token);
    this.ensureSession(session);

    this._localStream = new MediaStream();
    this.addLocalTrack(await room.setMicrophoneEnabled(true));
    const withCamera = callType === 'video';
    if (withCamera) this.addLocalTrack(await room.setCameraEnabled(true));
    this.ensureSession(session);
    this._isMuted = false;
    this._isVideoEnabled = withCamera;
  }

  /** Événements de la salle ouverte pendant `session`. */
  private roomEvents(session: number): GroupCallRoomEvents {
    const active = () => session === this.session;
    return {
      participantConnected: (participant) => {
        if (active()) this.announce(participant);
      },
      participantDisconnected: (userId) => {
        if (active()) this.removeParticipant(userId);
      },
      trackSubscribed: (userId, track) => {
        if (active()) this.addRemoteTrack(userId, track);
      },
      trackUnsubscribed: (userId, track) => {
        if (active()) this.remoteStreams.get(userId)?.removeTrack(track);
      },
      reconnecting: () => {
        if (active()) this.setState('connecting');
      },
      reconnected: () => {
        if (active()) this.setState('connected');
      },
      disconnected: (reason) => {
        if (active()) this.handleRoomClosed(reason);
      },
    };
  }

  /** Annonce un participant distant, une seule fois. */
  private announce({ userId, userName }: GroupCallRoomParticipant): void {
    const callId = this._currentCallId;
    if (!callId || this.announced.has(userId)) return;
    this.announced.add(userId);
    this.handlers.onParticipantJoined?.(userName ? { callId, userId, userName } : { callId, userId });
  }

  private addRemoteTrack(userId: string, track: MediaStreamTrack): void {
    this.announce({ userId });
    let stream = this.remoteStreams.get(userId);
    if (!stream) {
      stream = new MediaStream();
      this.remoteStreams.set(userId, stream);
    }
    stream.addTrack(track);
    this.handlers.onRemoteStream?.({ userId, stream });
  }

  private removeParticipant(userId: string): void {
    this.remoteStreams.delete(userId);
    const callId = this._currentCallId;
    if (!this.announced.delete(userId) || !callId) return;
    this.handlers.onParticipantLeft?.({ callId, userId });
  }

  /** Remplace, dans l'aperçu local, la piste de même nature. */
  private addLocalTrack(track: MediaStreamTrack | null): void {
    const stream = this._localStream;
    if (!track || !stream) return;
    for (const existing of stream.getTracks()) {
      if (existing.kind === track.kind && existing !== track) stream.removeTrack(existing);
    }
    stream.addTrack(track);
  }

  /**
   * L'API a clos l'appel (fin pour tous, salle LiveKit fermée) : la salle est
   * quittée sans rappeler l'API. La fin de l'appel que l'on vient de quitter
   * reste transmise, une fois.
   */
  private handleCallEnded(data: CallEndedEvent): void {
    const isCurrent = this.isCurrentCall(data.callId);
    if (!isCurrent && data.callId !== this._lastCallId) return;
    this._lastCallId = null;
    this.handlers.onCallEnded?.(data);
    if (isCurrent) void this.release();
  }

  /**
   * La salle s'est fermée sans que le client le demande : connexion perdue,
   * ou même utilisateur connecté depuis un autre appareil. L'appel se termine
   * ici sans prévenir l'API, qui peut encore compter l'utilisateur ailleurs.
   */
  private handleRoomClosed(reason: string): void {
    const callId = this._currentCallId;
    this.cleanup();
    if (!callId) return;
    this.emitError(new Error(`Salle LiveKit fermée sans demande du client (${reason}).`), callId);
    this.handlers.onCallEnded?.({ callId, reason: SFU_DISCONNECTED });
  }

  // ---------------------------------------------------------------------------
  // State & Cleanup
  // ---------------------------------------------------------------------------

  private isCurrentCall(callId: unknown): boolean {
    return typeof callId === 'string' && callId === this._currentCallId;
  }

  private assertIdle(): void {
    if (this._state !== 'idle') throw new Error('Already in a call');
  }

  private beginCall(callId: string): number {
    this._currentCallId = callId;
    this._lastCallId = null;
    this.setState('connecting');
    this.session += 1;
    return this.session;
  }

  private ensureSession(session: number): void {
    if (session !== this.session) throw new Error(CALL_ENDED_WHILE_JOINING);
  }

  private async notify(endpoint: ParticipantMediaEndpoint, body: Record<string, boolean>): Promise<void> {
    const callId = this._currentCallId;
    if (!callId) return;
    await notifyParticipantMedia(this.httpClient, callId, this._localUserId, endpoint, body);
  }

  /** Libère l'appel `callId` s'il est toujours l'appel géré. */
  private async finishCall(callId: string): Promise<void> {
    if (this._currentCallId !== callId) return;
    await this.release();
    this._lastCallId = callId;
  }

  /**
   * Termine côté API un appel créé qui ne peut pas aboutir, pour que les
   * appelés cessent de sonner. Son échec passe par onError : la promesse
   * attendue par l'application rejette déjà avec la cause première.
   */
  private async endAbandonedCall(callId: string): Promise<void> {
    try {
      await this.httpClient.post(`/calls/${callId}/end`);
    } catch (error) {
      this.emitError(error, callId);
    }
  }

  /** Libère l'état local puis quitte la salle ; un échec de déconnexion passe par onError. */
  private async release(): Promise<void> {
    const room = this.room;
    const callId = this._currentCallId;
    this.cleanup();
    if (!room) return;
    try {
      await room.disconnect();
    } catch (error) {
      this.emitError(error, callId);
    }
  }

  private cleanup(): void {
    this.session += 1;
    this.room = null;
    this._localStream?.getTracks().forEach((track) => track.stop());
    this._localStream = null;
    this.remoteStreams.clear();
    this.announced.clear();
    this._currentCallId = null;
    this._isMuted = false;
    this._isVideoEnabled = false;
    this.setState('idle');
  }

  private setState(state: CallManagerState): void {
    if (this._state === state) return;
    this._state = state;
    this.handlers.onStateChanged?.(state);
  }

  private emitError(error: unknown, callId: string | null = this._currentCallId): void {
    this.handlers.onError?.({ callId, error: toError(error) });
  }

  /** Quitte la salle et libère toutes les ressources, sans prévenir l'API. */
  destroy(): void {
    void this.release();
    this.unbindWebSocket();
    this.handlers = {
      onCallConnected: null,
      onCallEnded: null,
      onRemoteStream: null,
      onParticipantJoined: null,
      onParticipantLeft: null,
      onMuteChanged: null,
      onVideoChanged: null,
      onStateChanged: null,
      onError: null,
    };
  }
}
