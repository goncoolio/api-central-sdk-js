import type { HttpClient } from '../utils/http-client';
import type {
  CallResponse,
  CallHistoryResponse,
  InitiateCallRequest,
  CallParticipantInfo,
  PaginationQuery,
  IceServersResponse,
  SdpRequest,
  IceCandidateRequest,
  MuteResponse,
  VideoToggleResponse,
  ScreenShareResponse,
} from '../types';

// =============================================================================
// Calls Module (Audio/Video)
// =============================================================================

export class CallsModule {
  constructor(private readonly client: HttpClient) {}

  // ---------------------------------------------------------------------------
  // Call Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initiate a call
   *
   * Exige un jeton utilisateur : l'initiateur est l'utilisateur du jeton,
   * ajouté d'office aux participants. `participantIds` liste les appelés.
   *
   * @example
   * ```ts
   * // 1:1 video call
   * const call = await sdk.calls.initiate({
   *   participantIds: ['other-user-uuid'],
   *   callType: 'video'
   * });
   *
   * // Group audio call attached to a conversation
   * const groupCall = await sdk.calls.initiate({
   *   participantIds: ['user-2-uuid', 'user-3-uuid'],
   *   conversationId: 'conv-uuid',
   *   callType: 'audio'
   * });
   * ```
   */
  async initiate(request: InitiateCallRequest): Promise<CallResponse> {
    return this.client.post<CallResponse>('/calls', request);
  }

  /**
   * Get call details
   *
   * @example
   * ```ts
   * const call = await sdk.calls.get('call-uuid');
   * ```
   */
  async get(callId: string): Promise<CallResponse> {
    return this.client.get<CallResponse>(`/calls/${callId}`);
  }

  /**
   * Answer an incoming call
   *
   * @example
   * ```ts
   * await sdk.calls.answer('call-uuid', { userId: 'user-uuid' });
   * ```
   */
  async answer(callId: string, request: { userId: string }): Promise<CallResponse> {
    return this.client.post<CallResponse>(`/calls/${callId}/answer`, request);
  }

  /**
   * Decline an incoming call
   *
   * @example
   * ```ts
   * await sdk.calls.decline('call-uuid', { userId: 'user-uuid' });
   * ```
   */
  // The API acknowledges with { success: true }; it does not return the call.
  async decline(callId: string, request: { userId: string }): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/calls/${callId}/decline`, request);
  }

  /**
   * End a call
   *
   * @example
   * ```ts
   * const call = await sdk.calls.end('call-uuid', { userId: 'user-uuid' });
   * console.log(`Call ended. Duration: ${call.durationSeconds}s`);
   * ```
   */
  async end(callId: string, request: { userId: string }): Promise<CallResponse> {
    return this.client.post<CallResponse>(`/calls/${callId}/end`, request);
  }

  // ---------------------------------------------------------------------------
  // Participants
  // ---------------------------------------------------------------------------

  /**
   * Add a participant to an ongoing call
   *
   * @example
   * ```ts
   * await sdk.calls.addParticipant('call-uuid', {
   *   userId: 'new-user-uuid'
   * });
   * ```
   */
  async addParticipant(
    callId: string,
    request: { userId: string }
  ): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/calls/${callId}/participants`, request);
  }

  /**
   * Remove a participant from a call
   *
   * @example
   * ```ts
   * await sdk.calls.removeParticipant('call-uuid', 'user-uuid');
   * ```
   */
  async removeParticipant(callId: string, userId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(
      `/calls/${callId}/participants/${userId}`
    );
  }

  /**
   * Get call participants
   *
   * The API has no dedicated participants endpoint: the list is read from
   * the call itself.
   *
   * @example
   * ```ts
   * const participants = await sdk.calls.getParticipants('call-uuid');
   * ```
   */
  async getParticipants(callId: string): Promise<CallParticipantInfo[]> {
    const call = await this.get(callId);
    return call.participants ?? [];
  }

  // ---------------------------------------------------------------------------
  // Media Controls
  // ---------------------------------------------------------------------------

  /**
   * Mute/unmute a participant
   *
   * @example
   * ```ts
   * // Mute
   * await sdk.calls.setMuted('call-uuid', 'user-uuid', { muted: true });
   *
   * // Unmute
   * await sdk.calls.setMuted('call-uuid', 'user-uuid', { muted: false });
   * ```
   */
  async setMuted(
    callId: string,
    userId: string,
    request: { muted: boolean }
  ): Promise<MuteResponse> {
    return this.client.put<MuteResponse>(`/calls/${callId}/participants/${userId}/mute`, request);
  }

  /**
   * Enable/disable video for a participant
   *
   * @example
   * ```ts
   * await sdk.calls.setVideoEnabled('call-uuid', 'user-uuid', { enabled: false });
   * ```
   */
  async setVideoEnabled(
    callId: string,
    userId: string,
    request: { enabled: boolean }
  ): Promise<VideoToggleResponse> {
    return this.client.put<VideoToggleResponse>(
      `/calls/${callId}/participants/${userId}/video`,
      request
    );
  }

  /**
   * Start/stop screen sharing
   *
   * @example
   * ```ts
   * await sdk.calls.setScreenSharing('call-uuid', 'user-uuid', { sharing: true });
   * ```
   */
  async setScreenSharing(
    callId: string,
    userId: string,
    request: { sharing: boolean }
  ): Promise<ScreenShareResponse> {
    return this.client.put<ScreenShareResponse>(
      `/calls/${callId}/participants/${userId}/screen`,
      request
    );
  }

  // ---------------------------------------------------------------------------
  // Call History
  // ---------------------------------------------------------------------------

  /**
   * List the call history of the authenticated user
   *
   * The user is taken from the token, so this requires a user token.
   * The API only supports pagination here — there is no server-side
   * filtering by user, call type or status.
   *
   * @example
   * ```ts
   * const { calls, total, hasMore } = await sdk.calls.listHistory({ page: 1, limit: 20 });
   * ```
   */
  async listHistory(pagination?: PaginationQuery): Promise<CallHistoryResponse> {
    return this.client.get<CallHistoryResponse>('/calls/history', {
      params: pagination,
    });
  }

  // ---------------------------------------------------------------------------
  // WebRTC Signaling (REST)
  // ---------------------------------------------------------------------------

  /**
   * Get ICE servers for a call (TURN/STUN configuration)
   *
   * @example
   * ```ts
   * const { iceServers } = await sdk.calls.getIceServers('call-uuid');
   * const pc = new RTCPeerConnection({ iceServers });
   * ```
   */
  async getIceServers(callId: string): Promise<IceServersResponse> {
    return this.client.get<IceServersResponse>(`/calls/${callId}/ice-servers`);
  }

  /**
   * Send an SDP offer to a participant
   *
   * L'API exige `sdp_type` : il vaut `'offer'` sauf si `sdpType` est fourni.
   *
   * @example
   * ```ts
   * await sdk.calls.sendOffer('call-uuid', {
   *   toUserId: 'user-uuid',
   *   sdp: JSON.stringify(localDescription)
   * });
   * ```
   */
  async sendOffer(callId: string, request: SdpRequest): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/calls/${callId}/offer`, {
      ...request,
      sdpType: request.sdpType ?? 'offer',
    });
  }

  /**
   * Send an SDP answer to a participant
   *
   * L'API exige `sdp_type` : il vaut `'answer'` sauf si `sdpType` est fourni.
   *
   * @example
   * ```ts
   * await sdk.calls.sendAnswer('call-uuid', {
   *   toUserId: 'user-uuid',
   *   sdp: JSON.stringify(localDescription)
   * });
   * ```
   */
  async sendAnswer(callId: string, request: SdpRequest): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/calls/${callId}/answer-sdp`, {
      ...request,
      sdpType: request.sdpType ?? 'answer',
    });
  }

  /**
   * Send an ICE candidate to a participant
   *
   * @example
   * ```ts
   * await sdk.calls.sendIceCandidate('call-uuid', {
   *   toUserId: 'user-uuid',
   *   candidate: JSON.stringify(candidate),
   *   sdpMid: candidate.sdpMid,
   *   sdpMLineIndex: candidate.sdpMLineIndex
   * });
   * ```
   */
  async sendIceCandidate(callId: string, request: IceCandidateRequest): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/calls/${callId}/ice-candidate`, request);
  }

  /**
   * Leave a call (the call continues for other participants)
   *
   * @example
   * ```ts
   * await sdk.calls.leave('call-uuid', { userId: 'user-uuid' });
   * ```
   */
  // The API acknowledges with { success: true }; it does not return the call.
  async leave(callId: string, request: { userId: string }): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/calls/${callId}/leave`, request);
  }

}
