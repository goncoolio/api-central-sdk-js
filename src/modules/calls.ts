import type { HttpClient } from '../utils/http-client';
import type {
  CallResponse,
  InitiateCallRequest,
  CallType,
  CallStatus,
  CallParticipantInfo,
  PaginatedResponse,
  PaginationQuery,
  IceServersResponse,
  SdpRequest,
  IceCandidateRequest,
} from '../types';

// Alias for consistency
type CallParticipant = CallParticipantInfo;

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
   * @example
   * ```ts
   * // 1:1 video call
   * const call = await sdk.calls.initiate({
   *   initiatorId: 'user-uuid',
   *   participantIds: ['other-user-uuid'],
   *   callType: 'video'
   * });
   *
   * // Group audio call from conversation
   * const groupCall = await sdk.calls.initiate({
   *   initiatorId: 'user-uuid',
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
  async decline(callId: string, request: { userId: string }): Promise<CallResponse> {
    return this.client.post<CallResponse>(`/calls/${callId}/decline`, request);
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
  ): Promise<CallParticipant> {
    return this.client.post<CallParticipant>(`/calls/${callId}/participants`, request);
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
   * @example
   * ```ts
   * const participants = await sdk.calls.getParticipants('call-uuid');
   * ```
   */
  async getParticipants(callId: string): Promise<CallParticipant[]> {
    return this.client.get<CallParticipant[]>(`/calls/${callId}/participants`);
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
  ): Promise<{ success: boolean }> {
    return this.client.put<{ success: boolean }>(
      `/calls/${callId}/participants/${userId}/mute`,
      request
    );
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
  ): Promise<{ success: boolean }> {
    return this.client.put<{ success: boolean }>(
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
  ): Promise<{ screenSharing: boolean }> {
    return this.client.put<{ screenSharing: boolean }>(
      `/calls/${callId}/participants/${userId}/screen`,
      request
    );
  }

  // ---------------------------------------------------------------------------
  // Call History
  // ---------------------------------------------------------------------------

  /**
   * List call history
   *
   * @example
   * ```ts
   * // All calls
   * const { data } = await sdk.calls.listHistory({ page: 1 });
   *
   * // Filter by user
   * const userCalls = await sdk.calls.listHistory({
   *   userId: 'user-uuid',
   *   page: 1
   * });
   *
   * // Filter by status
   * const missedCalls = await sdk.calls.listHistory({
   *   status: 'failed',
   *   page: 1
   * });
   * ```
   */
  async listHistory(
    options?: PaginationQuery & {
      userId?: string;
      callType?: CallType;
      status?: CallStatus;
    }
  ): Promise<PaginatedResponse<CallResponse>> {
    return this.client.get<PaginatedResponse<CallResponse>>('/calls/history', {
      params: options,
    });
  }

  /**
   * Get call history for a specific user
   *
   * @example
   * ```ts
   * const { data } = await sdk.calls.getUserHistory('user-uuid', { page: 1 });
   * ```
   */
  async getUserHistory(
    userId: string,
    pagination?: PaginationQuery
  ): Promise<PaginatedResponse<CallResponse>> {
    return this.client.get<PaginatedResponse<CallResponse>>(`/calls/users/${userId}/history`, {
      params: pagination,
    });
  }

  // ---------------------------------------------------------------------------
  // Active Calls
  // ---------------------------------------------------------------------------

  /**
   * List active calls
   *
   * @example
   * ```ts
   * const activeCalls = await sdk.calls.listActive();
   * ```
   */
  async listActive(): Promise<CallResponse[]> {
    return this.client.get<CallResponse[]>('/calls/active');
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
   * @example
   * ```ts
   * await sdk.calls.sendOffer('call-uuid', {
   *   toUserId: 'user-uuid',
   *   sdp: JSON.stringify(localDescription)
   * });
   * ```
   */
  async sendOffer(callId: string, request: SdpRequest): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/calls/${callId}/offer`, request);
  }

  /**
   * Send an SDP answer to a participant
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
    return this.client.post<{ success: boolean }>(`/calls/${callId}/answer-sdp`, request);
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
  async leave(callId: string, request: { userId: string }): Promise<CallResponse> {
    return this.client.post<CallResponse>(`/calls/${callId}/leave`, request);
  }

  // ---------------------------------------------------------------------------
  // Active Calls
  // ---------------------------------------------------------------------------

  /**
   * Get active call for a user
   *
   * @example
   * ```ts
   * const call = await sdk.calls.getActiveForUser('user-uuid');
   * if (call) {
   *   console.log('User is in a call:', call.id);
   * }
   * ```
   */
  async getActiveForUser(userId: string): Promise<CallResponse | null> {
    return this.client.get<CallResponse | null>(`/calls/users/${userId}/active`);
  }
}
