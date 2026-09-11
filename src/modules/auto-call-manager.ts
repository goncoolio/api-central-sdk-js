import type { CallResponse } from '../types';
import type { CallManager, StartCallParams } from './call-manager';
import type { CallsModule } from './calls';
import type { GroupCallManager } from './group-call-manager';
import type {
  CallConnectedEvent,
  CallEndedEvent,
  CallErrorEvent,
  CallManagerState,
  CallParticipantEvent,
  IncomingCallEvent,
  MuteChangedEvent,
  RemoteStreamEvent,
  ScreenShareChangedEvent,
  VideoChangedEvent,
} from './call-shared';

// =============================================================================
// Auto Call Manager - point d'entrée unique des appels
//
// Le mode de chaque appel est décidé à son démarrage (startCall, answerCall),
// sur l'appel tel que l'API le renvoie : trois participants ou plus,
// initiateur compris, passent par LiveKit (GroupCallManager), les autres par
// le P2P de CallManager. Le mode reste fixé jusqu'à la fin de l'appel : un
// participant ajouté ensuite à un appel P2P à deux n'est pas migré.
//
// Navigateur uniquement, comme les deux gestionnaires qu'il pilote.
// =============================================================================

/** `p2p` : WebRTC via CallManager ; `group` : SFU LiveKit via GroupCallManager. */
export type CallMode = 'p2p' | 'group';

/** Participants, initiateur compris, à partir desquels un appel passe par LiveKit. */
export const GROUP_CALL_MIN_PARTICIPANTS = 3;

/**
 * Politique de mode : LiveKit dès trois participants, initiateur et invités
 * qui ont refusé compris ; P2P sinon. Appelant et appelés appliquent la règle
 * aux mêmes données, l'appel renvoyé par l'API, et aboutissent au même mode.
 */
export function chooseCallMode(call: Pick<CallResponse, 'participants'>): CallMode {
  return (call.participants?.length ?? 0) >= GROUP_CALL_MIN_PARTICIPANTS ? 'group' : 'p2p';
}

/** Levée par toggleScreenShare pendant un appel de groupe. */
const GROUP_SCREEN_SHARE_UNSUPPORTED =
  "Le partage d'écran n'est pas encore pris en charge dans les appels de groupe.";

type IncomingCallHandler = (data: IncomingCallEvent) => void;
type CallConnectedHandler = (data: CallConnectedEvent) => void;
type CallEndedHandler = (data: CallEndedEvent) => void;
type RemoteStreamHandler = (data: RemoteStreamEvent) => void;
type ParticipantHandler = (data: CallParticipantEvent) => void;
type MuteChangedHandler = (data: MuteChangedEvent) => void;
type VideoChangedHandler = (data: VideoChangedEvent) => void;
type ScreenShareChangedHandler = (data: ScreenShareChangedEvent) => void;
type StateChangedHandler = (state: CallManagerState) => void;
type CallErrorHandler = (data: CallErrorEvent) => void;

/**
 * Applique la politique de mode et relaie les événements des deux
 * gestionnaires. Il en prend les gestionnaires d'événements : une application
 * qui l'utilise n'en affecte pas directement à CallManager ni à
 * GroupCallManager.
 */
export class AutoCallManager {
  // Passation d'un appel entrant de CallManager à GroupCallManager : l'état
  // « idle » transitoire de CallManager n'est pas relayé.
  private handingOver = false;

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

  constructor(
    private readonly p2p: CallManager,
    private readonly group: GroupCallManager,
    private readonly calls: CallsModule
  ) {
    this.attach();
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  /** Mode de l'appel en cours ; `null` au repos, ou tant qu'un appel entrant sonne. */
  get mode(): CallMode | null {
    if (this.group.state !== 'idle') return 'group';
    if (this.p2p.state !== 'idle' && this.p2p.state !== 'incoming') return 'p2p';
    return null;
  }

  get state(): CallManagerState {
    return this.group.state !== 'idle' ? this.group.state : this.p2p.state;
  }

  get currentCallId(): string | null {
    return this.group.currentCallId ?? this.p2p.currentCallId;
  }

  get localStream(): MediaStream | null { return this.active().localStream; }
  get isMuted(): boolean { return this.active().isMuted; }
  get isVideoEnabled(): boolean { return this.active().isVideoEnabled; }

  getRemoteStream(userId: string): MediaStream | null {
    return this.active().getRemoteStream(userId);
  }

  getRemoteStreams(): Map<string, MediaStream> {
    return this.active().getRemoteStreams();
  }

  // ---------------------------------------------------------------------------
  // Event Handlers : mêmes charges que CallManager et GroupCallManager
  // ---------------------------------------------------------------------------

  set onIncomingCall(handler: IncomingCallHandler | null) { this.handlers.onIncomingCall = handler; }
  set onCallConnected(handler: CallConnectedHandler | null) { this.handlers.onCallConnected = handler; }
  set onCallEnded(handler: CallEndedHandler | null) { this.handlers.onCallEnded = handler; }
  set onRemoteStream(handler: RemoteStreamHandler | null) { this.handlers.onRemoteStream = handler; }
  set onParticipantJoined(handler: ParticipantHandler | null) { this.handlers.onParticipantJoined = handler; }
  set onParticipantLeft(handler: ParticipantHandler | null) { this.handlers.onParticipantLeft = handler; }
  set onMuteChanged(handler: MuteChangedHandler | null) { this.handlers.onMuteChanged = handler; }
  set onVideoChanged(handler: VideoChangedHandler | null) { this.handlers.onVideoChanged = handler; }
  /** Appels P2P seulement : le partage d'écran n'existe pas encore en groupe. */
  set onScreenShareChanged(handler: ScreenShareChangedHandler | null) { this.handlers.onScreenShareChanged = handler; }
  set onStateChanged(handler: StateChangedHandler | null) { this.handlers.onStateChanged = handler; }
  set onError(handler: CallErrorHandler | null) { this.handlers.onError = handler; }

  /**
   * (Ré)installe les relais d'événements sur les deux gestionnaires. Appelé à
   * la création, puis par ApiCentral après chaque connectRealtime : détruire
   * les gestionnaires (disconnectRealtime) efface leurs gestionnaires.
   */
  attach(): void {
    const { p2p, group } = this;
    p2p.onIncomingCall = (data) => this.handleIncomingCall(data);
    p2p.onStateChanged = (state) => this.relayState('p2p', state);
    group.onStateChanged = (state) => this.relayState('group', state);
    p2p.onScreenShareChanged = (data) => this.handlers.onScreenShareChanged?.(data);

    for (const manager of [p2p, group]) {
      manager.onCallConnected = (data) => this.handlers.onCallConnected?.(data);
      manager.onCallEnded = (data) => this.handlers.onCallEnded?.(data);
      manager.onRemoteStream = (data) => this.handlers.onRemoteStream?.(data);
      manager.onParticipantJoined = (data) => this.handlers.onParticipantJoined?.(data);
      manager.onParticipantLeft = (data) => this.handlers.onParticipantLeft?.(data);
      manager.onMuteChanged = (data) => this.handlers.onMuteChanged?.(data);
      manager.onVideoChanged = (data) => this.handlers.onVideoChanged?.(data);
      manager.onError = (data) => this.handlers.onError?.(data);
    }
  }

  // ---------------------------------------------------------------------------
  // Call Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Crée l'appel, puis le confie au gestionnaire que désigne la politique :
   * GroupCallManager dès trois participants, CallManager sinon.
   */
  async startCall(params: StartCallParams): Promise<CallResponse> {
    if (this.state !== 'idle') throw new Error('Already in a call');
    const call = await this.calls.initiate(params);
    return chooseCallMode(call) === 'group'
      ? this.group.startExistingCall(call)
      : this.p2p.startExistingCall(call);
  }

  /**
   * Décroche un appel entrant (par défaut, celui qui sonne). Le mode est
   * choisi sur l'appel relu auprès de l'API ; en mode groupe, l'appel est
   * confié à GroupCallManager sans être refusé côté P2P.
   */
  async answerCall(callId?: string): Promise<CallResponse> {
    const id = callId ?? this.p2p.currentCallId;
    if (!id) throw new Error('No call to answer');

    const call = await this.calls.get(id);
    if (chooseCallMode(call) === 'p2p') return this.p2p.answerCall(id);

    this.handOver(() => this.p2p.dismissIncomingCall(id));
    return this.group.answerCall(id);
  }

  /** Refuse un appel entrant (par défaut, celui qui sonne). */
  declineCall(callId?: string): Promise<void> {
    return this.p2p.declineCall(callId);
  }

  /** Termine l'appel en cours pour tous. */
  endCall(): Promise<void> {
    return this.active().endCall();
  }

  /** Quitte l'appel en cours ; il continue pour les autres. */
  leaveCall(): Promise<void> {
    return this.active().leaveCall();
  }

  // ---------------------------------------------------------------------------
  // Media Controls : ceux du gestionnaire de l'appel en cours
  // ---------------------------------------------------------------------------

  toggleMute(): Promise<boolean> {
    return this.active().toggleMute();
  }

  toggleVideo(): Promise<boolean> {
    return this.active().toggleVideo();
  }

  /** Partage d'écran : appels P2P seulement, pour l'instant. */
  async toggleScreenShare(): Promise<boolean> {
    if (this.mode === 'group') throw new Error(GROUP_SCREEN_SHARE_UNSUPPORTED);
    return this.p2p.toggleScreenShare();
  }

  /** Efface les gestionnaires d'événements de l'application. */
  destroy(): void {
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

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private active(): CallManager | GroupCallManager {
    return this.group.state !== 'idle' ? this.group : this.p2p;
  }

  /** Pendant un appel de groupe, un appel entrant est ignoré, comme par CallManager occupé. */
  private handleIncomingCall(data: IncomingCallEvent): void {
    if (this.group.state !== 'idle') {
      this.handOver(() => this.p2p.dismissIncomingCall(data.callId));
      return;
    }
    this.handlers.onIncomingCall?.(data);
  }

  /** Relaie l'état de l'appel en cours ; ignore CallManager pendant un appel de groupe ou une passation. */
  private relayState(source: CallMode, state: CallManagerState): void {
    if (source === 'p2p' && (this.handingOver || this.group.state !== 'idle')) return;
    this.handlers.onStateChanged?.(state);
  }

  private handOver(action: () => void): void {
    this.handingOver = true;
    try {
      action();
    } finally {
      this.handingOver = false;
    }
  }
}
