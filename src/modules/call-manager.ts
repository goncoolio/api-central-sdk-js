import type { HttpClient } from '../utils/http-client';
import type { WebSocketClient } from '../utils/ws-client';
import type { CallType, CallResponse } from '../types';

// =============================================================================
// Call Manager - WebRTC audio/video call orchestration
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

export class CallManager {
  private httpClient: HttpClient;
  private ws: WebSocketClient | null = null;
  private config: CallManagerConfig;

  // Current call state
  private _state: CallManagerState = 'idle';
  private _currentCallId: string | null = null;
  // Appel que l'on vient de quitter : sa fin (call_ended) reste transmise.
  private _lastCallId: string | null = null;
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
          this.createPeerAndOffer(data.userId);
        }
      }),

      ws.on('call_participant_joined', (data: any) => {
        // Le serveur diffuse aussi notre propre arrivée dans la salle d'appel.
        if (!this.isCurrentCall(data.callId) || this.isLocalUser(data.userId)) return;
        this.handlers.onParticipantJoined?.(data);
        // Create peer connection for new participant
        if (this.isNegotiating(data.callId) && data.userId) {
          this.createPeerAndOffer(data.userId);
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
        this.handleRemoteOffer(data.fromUserId, data.sdp);
      }),

      ws.on('call_answer_received', (data: any) => {
        if (!this.isCurrentCall(data.callId)) return;
        this.handleRemoteAnswer(data.fromUserId, data.sdp);
      }),

      ws.on('call_ice_candidate_received', (data: any) => {
        if (!this.isCurrentCall(data.callId)) return;
        this.handleRemoteIceCandidate(data.fromUserId, data.candidate);
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

  /** Start an outgoing call */
  async startCall(params: StartCallParams): Promise<CallResponse> {
    if (this._state !== 'idle') {
      throw new Error('Already in a call');
    }

    this.setState('outgoing');

    // Acquire local media
    const isVideo = params.callType === 'video';
    await this.acquireLocalMedia(true, isVideo);

    // Initiate call via REST API
    const call = await this.httpClient.post<CallResponse>('/calls', params);
    this._currentCallId = call.id;

    // Fetch ICE servers
    await this.fetchIceServers(call.id);

    // Join call room via WebSocket
    this.ws?.send('call_join', { callId: call.id });

    return call;
  }

  /** Answer an incoming call */
  async answerCall(callId?: string): Promise<CallResponse> {
    const id = callId ?? this._currentCallId;
    if (!id) throw new Error('No call to answer');

    this._currentCallId = id;
    this.setState('connecting');

    // Get call details to know if it's audio or video
    const callDetails = await this.httpClient.get<CallResponse>(`/calls/${id}`);
    const isVideo = callDetails.callType === 'video';

    // Acquire local media
    await this.acquireLocalMedia(true, isVideo);

    // Answer via REST
    const call = await this.httpClient.post<CallResponse>(`/calls/${id}/answer`);

    // Fetch ICE servers
    await this.fetchIceServers(id);

    // Join call room via WebSocket
    this.ws?.send('call_join', { callId: id });

    return call;
  }

  /**
   * Decline an incoming call
   *
   * Refuser un autre appel que l'appel géré (reçu pendant un appel) ne touche
   * pas à l'appel en cours.
   */
  async declineCall(callId?: string): Promise<void> {
    const id = callId ?? this._currentCallId;
    if (!id) return;

    await this.httpClient.post(`/calls/${id}/decline`);
    this.finishCall(id);
  }

  /** End the current call */
  async endCall(): Promise<void> {
    const id = this._currentCallId;
    if (!id) return;

    await this.httpClient.post(`/calls/${id}/end`);
    this.finishCall(id);
  }

  /** Leave the current call (call continues for others) */
  async leaveCall(): Promise<void> {
    const id = this._currentCallId;
    if (!id) return;

    this.ws?.send('call_leave', { callId: id });
    await this.httpClient.post(`/calls/${id}/leave`);
    this.finishCall(id);
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

  /** Toggle screen sharing */
  async toggleScreenShare(): Promise<boolean> {
    if (this._isScreenSharing) {
      // Stop screen sharing
      this._screenStream?.getTracks().forEach((t) => t.stop());
      this._screenStream = null;
      this._isScreenSharing = false;

      // Replace screen track with camera video track in all peers
      const videoTrack = this._localStream?.getVideoTracks()[0];
      if (videoTrack) {
        for (const [, peer] of this.peers) {
          const sender = peer.pc.getSenders().find((s) => s.track?.kind === 'video');
          sender?.replaceTrack(videoTrack);
        }
      }
    } else {
      // Start screen sharing
      try {
        this._screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        this._isScreenSharing = true;

        const screenTrack = this._screenStream.getVideoTracks()[0];
        if (!screenTrack) return false;

        // Replace camera video track with screen track in all peers
        for (const [, peer] of this.peers) {
          const sender = peer.pc.getSenders().find((s) => s.track?.kind === 'video');
          sender?.replaceTrack(screenTrack);
        }

        // Auto-stop when user stops sharing from browser UI. Personne
        // n'attend cette promesse : son échec passe par onError.
        screenTrack.onended = () => {
          this.toggleScreenShare().catch((error: unknown) => this.emitError(error));
        };
      } catch {
        return false;
      }
    }

    await this.notifyParticipantState('screen', { sharing: this._isScreenSharing });

    return this._isScreenSharing;
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

  private async fetchIceServers(callId: string): Promise<void> {
    try {
      const response = await this.httpClient.get<{ iceServers: RTCIceServer[] }>(
        `/calls/${callId}/ice-servers`
      );
      this.iceServers = response.iceServers;
    } catch {
      // Fallback to default STUN
      this.iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
    }
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

    // Leave call room — sauf pour un appel entrant jamais décroché, dont on
    // n'a jamais rejoint la salle.
    if (this._currentCallId && this.ws && this._state !== 'incoming') {
      this.ws.send('call_leave', { callId: this._currentCallId });
    }

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
