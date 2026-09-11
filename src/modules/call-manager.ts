import type { HttpClient } from '../utils/http-client';
import type { WebSocketClient } from '../utils/ws-client';
import type { CallType, CallResponse, IceServersResponse } from '../types';

// =============================================================================
// Call Manager - WebRTC audio/video call orchestration
//
// Navigateur uniquement : s'appuie sur RTCPeerConnection et
// navigator.mediaDevices, absents de Node.js.
// =============================================================================

export interface CallManagerConfig {
  /** Default media constraints */
  defaultAudioConstraints?: MediaTrackConstraints | boolean;
  defaultVideoConstraints?: MediaTrackConstraints | boolean;
  /**
   * Identifiant (UUID API Central) de l'utilisateur local.
   *
   * Sert à notifier l'API des bascules micro, caméra et partage d'écran
   * (`/calls/{id}/participants/{userId}/...`). Facultatif quand le SDK peut
   * le déduire : jeton utilisateur passé à `connectRealtime`, ou événement
   * WebSocket `connected`. S'il est fourni, il prime sur ces valeurs déduites.
   */
  userId?: string;
}

export interface StartCallParams {
  participantIds: string[];
  callType: CallType;
  conversationId?: string;
  encryptionEnabled?: boolean;
}

export type CallManagerState = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected' | 'ended';

/** Erreur survenue en arrière-plan, hors de toute promesse attendue par l'application. */
export interface CallErrorEvent {
  callId: string | null;
  error: Error;
}

interface PeerState {
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
}

// Event handler types
type IncomingCallHandler = (data: { callId: string; callerId: string; callerName?: string; callType: string }) => void;
type CallConnectedHandler = (data: { callId: string; participantIds: string[] }) => void;
type CallEndedHandler = (data: { callId: string; reason: string; durationSeconds?: number }) => void;
type RemoteStreamHandler = (data: { userId: string; stream: MediaStream }) => void;
type ParticipantHandler = (data: { callId: string; userId: string; userName?: string }) => void;
type MuteChangedHandler = (data: { callId: string; userId: string; isMuted: boolean }) => void;
type VideoChangedHandler = (data: { callId: string; userId: string; isVideoEnabled: boolean }) => void;
type ScreenShareChangedHandler = (data: { callId: string; userId: string; isScreenSharing: boolean }) => void;
type StateChangedHandler = (state: CallManagerState) => void;
type CallErrorHandler = (data: CallErrorEvent) => void;

/** Levée quand l'identifiant local manque pour notifier l'API. */
const MISSING_LOCAL_USER_ID =
  "Identifiant de l'utilisateur local inconnu : impossible de notifier l'API. " +
  'Renseignez callManagerConfig.userId, ou connectez le temps réel avec un jeton utilisateur.';

/** Levée quand le temps réel manque : la signalisation WebRTC serait perdue. */
const MISSING_WEBSOCKET =
  'Temps réel non connecté : appelez connectRealtime() avant de passer ou de décrocher un appel.';

/** L'utilisateur a fermé le sélecteur de partage d'écran : ce n'est pas une erreur. */
function isUserCancellation(error: unknown): boolean {
  return error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

export class CallManager {
  private httpClient: HttpClient;
  private ws: WebSocketClient | null = null;
  private config: CallManagerConfig;

  // Current call state
  private _state: CallManagerState = 'idle';
  private _currentCallId: string | null = null;
  // Appel que l'on vient de quitter : sa fin (call_ended) reste transmise.
  private _lastCallId: string | null = null;
  // Salle de signalisation (call_join) rejointe pour l'appel géré.
  private _joinedRoom = false;
  private _localUserId: string | null;
  private _localStream: MediaStream | null = null;
  private _screenStream: MediaStream | null = null;
  private _isMuted = false;
  private _isVideoEnabled = true;
  private _isScreenSharing = false;

  // Peer connections (userId -> PeerState)
  private peers: Map<string, PeerState> = new Map();
  private iceServers: RTCIceServer[] = [];

  // WebSocket event unsubscribers
  private wsUnsubs: Array<() => void> = [];

  // Event handlers
  private handlers = {
    onIncomingCall: null as IncomingCallHandler | null,
    onCallConnected: null as CallConnectedHandler | null,
    onCallEnded: null as CallEndedHandler | null,
    onRemoteStream: null as RemoteStreamHandler | null,
    onParticipantJoined: null as ParticipantHandler | null,
    onParticipantLeft: null as ParticipantHandler | null,
    onMuteChanged: null as MuteChangedHandler | null,
    onVideoChanged: null as VideoChangedHandler | null,
    onScreenShareChanged: null as ScreenShareChangedHandler | null,
    onStateChanged: null as StateChangedHandler | null,
    onError: null as CallErrorHandler | null,
  };

  constructor(httpClient: HttpClient, config?: CallManagerConfig) {
    this.httpClient = httpClient;
    this.config = config ?? {};
    this._localUserId = this.config.userId ?? null;
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  get state(): CallManagerState { return this._state; }
  get currentCallId(): string | null { return this._currentCallId; }
  get localStream(): MediaStream | null { return this._localStream; }
  get isMuted(): boolean { return this._isMuted; }
  get isVideoEnabled(): boolean { return this._isVideoEnabled; }
  get isScreenSharing(): boolean { return this._isScreenSharing; }

  /** Identifiant de l'utilisateur local, `null` tant qu'il n'est pas connu. */
  get localUserId(): string | null { return this._localUserId; }

  /**
   * Renseigne l'identifiant de l'utilisateur local, déduit du contexte
   * d'authentification. Sans effet si `userId` est fixé dans la configuration.
   */
  setLocalUserId(userId: string): void {
    if (this.config.userId) return;
    this._localUserId = userId;
  }

  /** Get remote stream for a specific participant */
  getRemoteStream(userId: string): MediaStream | null {
    return this.peers.get(userId)?.remoteStream ?? null;
  }

  /** Get all remote streams */
  getRemoteStreams(): Map<string, MediaStream> {
    const streams = new Map<string, MediaStream>();
    for (const [userId, peer] of this.peers) {
      streams.set(userId, peer.remoteStream);
    }
    return streams;
  }

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------

  set onIncomingCall(handler: IncomingCallHandler | null) { this.handlers.onIncomingCall = handler; }
  set onCallConnected(handler: CallConnectedHandler | null) { this.handlers.onCallConnected = handler; }
  set onCallEnded(handler: CallEndedHandler | null) { this.handlers.onCallEnded = handler; }
  set onRemoteStream(handler: RemoteStreamHandler | null) { this.handlers.onRemoteStream = handler; }
  set onParticipantJoined(handler: ParticipantHandler | null) { this.handlers.onParticipantJoined = handler; }
  set onParticipantLeft(handler: ParticipantHandler | null) { this.handlers.onParticipantLeft = handler; }
  set onMuteChanged(handler: MuteChangedHandler | null) { this.handlers.onMuteChanged = handler; }
  set onVideoChanged(handler: VideoChangedHandler | null) { this.handlers.onVideoChanged = handler; }
  set onScreenShareChanged(handler: ScreenShareChangedHandler | null) { this.handlers.onScreenShareChanged = handler; }
  set onStateChanged(handler: StateChangedHandler | null) { this.handlers.onStateChanged = handler; }

  /**
   * Erreurs survenues en arrière-plan, que personne n'attend (par exemple la
   * notification de l'API quand le partage d'écran est arrêté depuis le
   * navigateur). Les méthodes attendues (`toggleMute`…) rejettent leur
   * promesse à la place.
   */
  set onError(handler: CallErrorHandler | null) { this.handlers.onError = handler; }

  // ---------------------------------------------------------------------------
  // WebSocket Binding
  //
  // Seuls les événements de l'appel géré sont traités : ceux d'un autre appel
  // (reçu pendant qu'on est occupé, ou appel de groupe piloté ailleurs) ne
  // doivent jamais toucher à l'appel en cours.
  // ---------------------------------------------------------------------------

  /** Bind to a WebSocket client for signaling */
  bindWebSocket(ws: WebSocketClient): void {
    this.unbindWebSocket();
    this.ws = ws;

    this.wsUnsubs.push(
      // À la connexion, le serveur annonce l'utilisateur du jeton.
      ws.on('connected', (data: any) => {
        const userId = data.user?.id;
        if (typeof userId === 'string') this.setLocalUserId(userId);
      }),

      ws.on('call_incoming', (data: any) => {
        if (this._state !== 'idle') return;
        this.setState('incoming');
        this._currentCallId = data.callId;
        this.handlers.onIncomingCall?.(data);
      }),

      ws.on('call_connected', (data: any) => {
        if (!this.isCurrentCall(data.callId)) return;
        this.setState('connected');
        this.handlers.onCallConnected?.(data);
      }),

      ws.on('call_ended', (data: any) => {
        // La fin de l'appel que l'on vient de quitter arrive souvent après la
        // réponse REST de endCall() : elle reste transmise, une fois.
        const isCurrent = this.isCurrentCall(data.callId);
        if (!isCurrent && data.callId !== this._lastCallId) return;
        this.handlers.onCallEnded?.(data);
        if (isCurrent) this.cleanup();
        this._lastCallId = null;
      }),

      ws.on('call_answered', (data: any) => {
        // Another participant answered - start WebRTC signaling with them
        if (this.isNegotiating(data.callId) && data.userId && !this.isLocalUser(data.userId)) {
          this.inBackground(this.createPeerAndOffer(data.userId));
        }
      }),

      ws.on('call_participant_joined', (data: any) => {
        // Le serveur diffuse aussi notre propre arrivée dans la salle d'appel.
        if (!this.isCurrentCall(data.callId) || this.isLocalUser(data.userId)) return;
        this.handlers.onParticipantJoined?.(data);
        // Create peer connection for new participant
        if (this.isNegotiating(data.callId) && data.userId) {
          this.inBackground(this.createPeerAndOffer(data.userId));
        }
      }),

      ws.on('call_participant_left', (data: any) => {
        if (!this.isCurrentCall(data.callId)) return;
        this.handlers.onParticipantLeft?.(data);
        this.removePeer(data.userId);
      }),

      ws.on('call_declined', (_data: any) => {
        // If all declined, call will end via call_ended event
      }),

      // WebRTC signaling events
      ws.on('call_offer_received', (data: any) => {
        if (!this.isCurrentCall(data.callId)) return;
        this.inBackground(this.handleRemoteOffer(data.fromUserId, data.sdp));
      }),

      ws.on('call_answer_received', (data: any) => {
        if (!this.isCurrentCall(data.callId)) return;
        this.inBackground(this.handleRemoteAnswer(data.fromUserId, data.sdp));
      }),

      ws.on('call_ice_candidate_received', (data: any) => {
        if (!this.isCurrentCall(data.callId)) return;
        this.inBackground(this.handleRemoteIceCandidate(data.fromUserId, data.candidate));
      }),

      // Media state changes
      ws.on('call_mute_changed', (data: any) => {
        if (!this.isCurrentCall(data.callId)) return;
        this.handlers.onMuteChanged?.(data);
      }),

      ws.on('call_video_changed', (data: any) => {
        if (!this.isCurrentCall(data.callId)) return;
        this.handlers.onVideoChanged?.(data);
      }),

      ws.on('call_screen_share_changed', (data: any) => {
        if (!this.isCurrentCall(data.callId)) return;
        this.handlers.onScreenShareChanged?.(data);
      }),
    );
  }

  /** Unbind from WebSocket */
  unbindWebSocket(): void {
    for (const unsub of this.wsUnsubs) {
      unsub();
    }
    this.wsUnsubs = [];
    this.ws = null;
  }

  // ---------------------------------------------------------------------------
  // Call Lifecycle
  // ---------------------------------------------------------------------------

  // En cas d'échec, les méthodes ci-dessous rejettent leur promesse et
  // ramènent le gestionnaire au repos : média libéré, salle quittée. Aucune ne
  // laisse un appel à moitié établi.

  /**
   * Start an outgoing call
   *
   * Rejette si le temps réel n'est pas branché (la signalisation serait
   * perdue), si le média ou l'API échouent, ou si les serveurs ICE sont
   * indisponibles : l'appel déjà créé est alors terminé côté API.
   */
  async startCall(params: StartCallParams): Promise<CallResponse> {
    this.assertCanCall();
    this.setState('outgoing');

    let call: CallResponse | null = null;
    try {
      await this.acquireLocalMedia(true, params.callType === 'video');
      call = await this.httpClient.post<CallResponse>('/calls', params);
      this._currentCallId = call.id;
      await this.fetchIceServers(call.id);
      this.joinCallRoom(call.id);
      return call;
    } catch (error) {
      if (call) await this.endAbandonedCall(call.id);
      this.cleanup();
      throw error;
    }
  }

  /**
   * Answer an incoming call
   *
   * Les serveurs ICE sont récupérés avant de décrocher : si le média ou la
   * configuration échouent, l'appel n'est pas décroché et continue de sonner.
   */
  async answerCall(callId?: string): Promise<CallResponse> {
    const id = callId ?? this._currentCallId;
    if (!id) throw new Error('No call to answer');
    if (!this.ws) throw new Error(MISSING_WEBSOCKET);

    this._currentCallId = id;
    this.setState('connecting');

    try {
      // Get call details to know if it's audio or video
      const callDetails = await this.httpClient.get<CallResponse>(`/calls/${id}`);
      await this.acquireLocalMedia(true, callDetails.callType === 'video');
      await this.fetchIceServers(id);
      const call = await this.httpClient.post<CallResponse>(`/calls/${id}/answer`);
      this.joinCallRoom(id);
      return call;
    } catch (error) {
      this.finishCall(id);
      throw error;
    }
  }

  /**
   * Decline an incoming call
   *
   * Refuser un autre appel que l'appel géré (reçu pendant un appel) ne touche
   * pas à l'appel en cours. L'appel refusé est libéré localement même si l'API
   * n'a pas pu être prévenue ; la promesse rejette alors.
   */
  async declineCall(callId?: string): Promise<void> {
    const id = callId ?? this._currentCallId;
    if (!id) return;

    try {
      await this.httpClient.post(`/calls/${id}/decline`);
    } finally {
      this.finishCall(id);
    }
  }

  /**
   * End the current call
   *
   * Le média est libéré même si l'API n'a pas pu être prévenue ; la promesse
   * rejette alors.
   */
  async endCall(): Promise<void> {
    const id = this._currentCallId;
    if (!id) return;

    try {
      await this.httpClient.post(`/calls/${id}/end`);
    } finally {
      this.finishCall(id);
    }
  }

  /**
   * Leave the current call (call continues for others)
   *
   * Le média est libéré même si l'API n'a pas pu être prévenue ; la promesse
   * rejette alors.
   */
  async leaveCall(): Promise<void> {
    const id = this._currentCallId;
    if (!id) return;

    this.leaveCallRoom();
    try {
      await this.httpClient.post(`/calls/${id}/leave`);
    } finally {
      this.finishCall(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Media Controls
  //
  // L'état local (pistes, drapeaux) est appliqué d'abord et n'est jamais
  // annulé. La promesse rejette si l'API n'a pas pu être notifiée :
  // identifiant local inconnu ou requête en échec.
  // ---------------------------------------------------------------------------

  /** Toggle microphone mute */
  async toggleMute(): Promise<boolean> {
    this._isMuted = !this._isMuted;

    if (this._localStream) {
      for (const track of this._localStream.getAudioTracks()) {
        track.enabled = !this._isMuted;
      }
    }

    await this.notifyParticipantState('mute', { muted: this._isMuted });

    return this._isMuted;
  }

  /** Toggle video */
  async toggleVideo(): Promise<boolean> {
    this._isVideoEnabled = !this._isVideoEnabled;

    if (this._localStream) {
      for (const track of this._localStream.getVideoTracks()) {
        track.enabled = this._isVideoEnabled;
      }
    }

    await this.notifyParticipantState('video', { enabled: this._isVideoEnabled });

    return this._isVideoEnabled;
  }

  /**
   * Toggle screen sharing
   *
   * Renvoie `false` si l'utilisateur ferme le sélecteur de partage ; les
   * autres échecs de capture ou de remplacement de piste rejettent.
   */
  async toggleScreenShare(): Promise<boolean> {
    if (this._isScreenSharing) {
      // Stop screen sharing
      this._screenStream?.getTracks().forEach((t) => t.stop());
      this._screenStream = null;
      this._isScreenSharing = false;

      // Replace screen track with camera video track in all peers
      const videoTrack = this._localStream?.getVideoTracks()[0];
      if (videoTrack) await this.replaceVideoTrack(videoTrack);
    } else {
      // Start screen sharing
      let screenStream: MediaStream;
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } catch (error) {
        if (isUserCancellation(error)) return false;
        throw error;
      }

      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) {
        screenStream.getTracks().forEach((t) => t.stop());
        return false;
      }
      this._screenStream = screenStream;
      this._isScreenSharing = true;

      // Replace camera video track with screen track in all peers
      await this.replaceVideoTrack(screenTrack);

      // Auto-stop when user stops sharing from browser UI. Personne
      // n'attend cette promesse : son échec passe par onError.
      screenTrack.onended = () => this.inBackground(this.toggleScreenShare());
    }

    await this.notifyParticipantState('screen', { sharing: this._isScreenSharing });

    return this._isScreenSharing;
  }

  /** Remplace la piste vidéo envoyée à chaque pair ; rejette si l'un échoue. */
  private async replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    const senders = [...this.peers.values()].map((peer) =>
      peer.pc.getSenders().find((sender) => sender.track?.kind === 'video')
    );
    await Promise.all(senders.map((sender) => sender?.replaceTrack(track)));
  }

  /**
   * Notifie l'API de l'état média du participant local, adressé par son
   * identifiant réel : l'API attend un UUID dans le chemin.
   */
  private async notifyParticipantState(
    endpoint: 'mute' | 'video' | 'screen',
    body: Record<string, boolean>
  ): Promise<void> {
    const callId = this._currentCallId;
    if (!callId) return;

    const userId = this._localUserId;
    if (!userId) throw new Error(MISSING_LOCAL_USER_ID);

    await this.httpClient.put(`/calls/${callId}/participants/${userId}/${endpoint}`, body);
  }

  private emitError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.handlers.onError?.({ callId: this._currentCallId, error: normalized });
  }

  /** Tâche lancée par un événement, que personne n'attend : son échec passe par onError. */
  private inBackground(task: Promise<unknown>): void {
    task.catch((error: unknown) => this.emitError(error));
  }

  // ---------------------------------------------------------------------------
  // WebRTC Internals
  // ---------------------------------------------------------------------------

  private async acquireLocalMedia(audio: boolean, video: boolean): Promise<void> {
    const constraints: MediaStreamConstraints = {
      audio: audio ? (this.config.defaultAudioConstraints ?? true) : false,
      video: video ? (this.config.defaultVideoConstraints ?? true) : false,
    };

    this._localStream = await navigator.mediaDevices.getUserMedia(constraints);
  }

  /**
   * Serveurs STUN/TURN de l'appel, identifiants TURN temporaires compris.
   * Pas de STUN public de secours : un échec rejette, car sans TURN l'appel
   * échouerait plus tard, sans explication, derrière un NAT.
   */
  private async fetchIceServers(callId: string): Promise<void> {
    const response = await this.httpClient.get<IceServersResponse>(`/calls/${callId}/ice-servers`);
    this.iceServers = response.iceServers;
  }

  private createPeerConnection(remoteUserId: string): PeerState {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const remoteStream = new MediaStream();

    const peerState: PeerState = { pc, remoteStream };
    this.peers.set(remoteUserId, peerState);

    // Add local tracks to peer connection
    if (this._localStream) {
      for (const track of this._localStream.getTracks()) {
        pc.addTrack(track, this._localStream);
      }
    }

    // Handle remote tracks
    pc.ontrack = (event) => {
      for (const track of event.streams[0]?.getTracks() ?? []) {
        remoteStream.addTrack(track);
      }
      this.handlers.onRemoteStream?.({ userId: remoteUserId, stream: remoteStream });
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.ws?.send('call_ice_candidate', {
          callId: this._currentCallId,
          toUserId: remoteUserId,
          candidate: JSON.stringify(event.candidate),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.setState('connected');
      } else if (pc.connectionState === 'failed') {
        this.emitError(new Error(`Connexion WebRTC avec ${remoteUserId} en échec`));
      }
    };

    return peerState;
  }

  private async createPeerAndOffer(remoteUserId: string): Promise<void> {
    if (this.peers.has(remoteUserId)) return;

    const { pc } = this.createPeerConnection(remoteUserId);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.ws?.send('call_offer', {
      callId: this._currentCallId,
      toUserId: remoteUserId,
      sdp: JSON.stringify(offer),
    });
  }

  private async handleRemoteOffer(fromUserId: string, sdpJson: string): Promise<void> {
    let peerState = this.peers.get(fromUserId);
    if (!peerState) {
      peerState = this.createPeerConnection(fromUserId);
    }

    const offer = JSON.parse(sdpJson) as RTCSessionDescriptionInit;
    await peerState.pc.setRemoteDescription(offer);

    const answer = await peerState.pc.createAnswer();
    await peerState.pc.setLocalDescription(answer);

    this.ws?.send('call_answer', {
      callId: this._currentCallId,
      toUserId: fromUserId,
      sdp: JSON.stringify(answer),
    });
  }

  private async handleRemoteAnswer(fromUserId: string, sdpJson: string): Promise<void> {
    const peerState = this.peers.get(fromUserId);
    if (!peerState) return;

    const answer = JSON.parse(sdpJson) as RTCSessionDescriptionInit;
    await peerState.pc.setRemoteDescription(answer);
  }

  private async handleRemoteIceCandidate(fromUserId: string, candidateJson: string): Promise<void> {
    const peerState = this.peers.get(fromUserId);
    if (!peerState) return;

    const candidate = JSON.parse(candidateJson) as RTCIceCandidateInit;
    await peerState.pc.addIceCandidate(candidate);
  }

  private removePeer(userId: string): void {
    const peer = this.peers.get(userId);
    if (peer) {
      peer.pc.close();
      this.peers.delete(userId);
    }
  }

  // ---------------------------------------------------------------------------
  // State & Cleanup
  // ---------------------------------------------------------------------------

  /** L'événement concerne-t-il l'appel géré ? */
  private isCurrentCall(callId: unknown): boolean {
    return typeof callId === 'string' && callId === this._currentCallId;
  }

  /** Appel géré et rejoint : la négociation WebRTC est permise. */
  private isNegotiating(callId: unknown): boolean {
    return (
      this.isCurrentCall(callId) &&
      (this._state === 'outgoing' || this._state === 'connecting' || this._state === 'connected')
    );
  }

  private isLocalUser(userId: unknown): boolean {
    return this._localUserId !== null && userId === this._localUserId;
  }

  /** Libère l'appel `callId` s'il est toujours l'appel géré. */
  private finishCall(callId: string): void {
    if (this._currentCallId !== callId) return;
    this.cleanup();
    this._lastCallId = callId;
  }

  /** Un appel ne se lance qu'au repos, et avec la signalisation branchée. */
  private assertCanCall(): void {
    if (this._state !== 'idle') throw new Error('Already in a call');
    if (!this.ws) throw new Error(MISSING_WEBSOCKET);
  }

  private joinCallRoom(callId: string): void {
    this.ws?.send('call_join', { callId });
    this._joinedRoom = true;
  }

  /** Quitte la salle de signalisation : une seule fois, et seulement si on l'a rejointe. */
  private leaveCallRoom(): void {
    if (this._joinedRoom && this._currentCallId) {
      this.ws?.send('call_leave', { callId: this._currentCallId });
    }
    this._joinedRoom = false;
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
      this.emitError(error);
    }
  }

  private setState(state: CallManagerState): void {
    if (this._state === state) return;
    this._state = state;
    this.handlers.onStateChanged?.(state);
  }

  private cleanup(): void {
    // Close all peer connections
    for (const [, peer] of this.peers) {
      peer.pc.close();
    }
    this.peers.clear();

    // Stop local media
    this._localStream?.getTracks().forEach((t) => t.stop());
    this._localStream = null;

    // Stop screen share
    this._screenStream?.getTracks().forEach((t) => t.stop());
    this._screenStream = null;

    // Leave call room — seulement si on l'a rejointe : jamais pour un appel
    // entrant non décroché, ni pour un appel dont le démarrage a échoué.
    this.leaveCallRoom();

    // Reset state
    this._currentCallId = null;
    this._isMuted = false;
    this._isVideoEnabled = true;
    this._isScreenSharing = false;
    this.iceServers = [];
    this.setState('idle');
  }

  /** Destroy the call manager and release all resources */
  destroy(): void {
    this.cleanup();
    this.unbindWebSocket();
    this.handlers = {
      onIncomingCall: null,
      onCallConnected: null,
      onCallEnded: null,
      onRemoteStream: null,
      onParticipantJoined: null,
      onParticipantLeft: null,
      onMuteChanged: null,
      onVideoChanged: null,
      onScreenShareChanged: null,
      onStateChanged: null,
      onError: null,
    };
  }
}
