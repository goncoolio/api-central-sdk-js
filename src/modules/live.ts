import type { HttpClient } from '../utils/http-client';
import type {
  LiveStreamResponse,
  CreateStreamRequest,
  UpdateStreamRequest,
  StreamStatus,
  StreamCommentInfo,
  PaginatedResponse,
  PaginationQuery,
  CursorResponse,
  CursorQuery,
} from '../types';

// Aliases for consistency
type StreamResponse = LiveStreamResponse;
type StreamCommentResponse = StreamCommentInfo;

// =============================================================================
// Live Streaming Module
// =============================================================================

export class LiveModule {
  constructor(private readonly client: HttpClient) {}

  // ---------------------------------------------------------------------------
  // Streams
  // ---------------------------------------------------------------------------

  /**
   * Create a new live stream
   *
   * @example
   * ```ts
   * const stream = await sdk.live.createStream({
   *   hostId: 'user-uuid',
   *   title: 'My First Live Stream',
   *   description: 'Join me for some fun!',
   *   scheduledAt: new Date('2024-12-01T18:00:00Z').toISOString()
   * });
   * ```
   */
  async createStream(request: CreateStreamRequest): Promise<StreamResponse> {
    return this.client.post<StreamResponse>('/live/streams', request);
  }

  /**
   * List live streams
   *
   * @example
   * ```ts
   * // List all active streams
   * const { data } = await sdk.live.listStreams({ status: 'live' });
   *
   * // List streams by host
   * const hostStreams = await sdk.live.listStreams({
   *   hostId: 'user-uuid',
   *   page: 1
   * });
   * ```
   */
  async listStreams(
    options?: PaginationQuery & {
      status?: StreamStatus;
      hostId?: string;
    }
  ): Promise<PaginatedResponse<StreamResponse>> {
    return this.client.get<PaginatedResponse<StreamResponse>>('/live/streams', {
      params: options,
    });
  }

  /**
   * Get a stream by ID
   *
   * @example
   * ```ts
   * const stream = await sdk.live.getStream('stream-uuid');
   * ```
   */
  async getStream(streamId: string): Promise<StreamResponse> {
    return this.client.get<StreamResponse>(`/live/streams/${streamId}`);
  }

  /**
   * Update a stream
   *
   * @example
   * ```ts
   * const stream = await sdk.live.updateStream('stream-uuid', {
   *   title: 'Updated Stream Title'
   * });
   * ```
   */
  async updateStream(streamId: string, request: UpdateStreamRequest): Promise<StreamResponse> {
    return this.client.put<StreamResponse>(`/live/streams/${streamId}`, request);
  }

  /**
   * Start a live stream
   *
   * @example
   * ```ts
   * const stream = await sdk.live.startStream('stream-uuid');
   * console.log(stream.rtmpUrl, stream.streamKey);
   * ```
   */
  async startStream(streamId: string): Promise<StreamResponse> {
    return this.client.post<StreamResponse>(`/live/streams/${streamId}/start`);
  }

  /**
   * Pause a live stream
   *
   * @example
   * ```ts
   * await sdk.live.pauseStream('stream-uuid');
   * ```
   */
  async pauseStream(streamId: string): Promise<StreamResponse> {
    return this.client.post<StreamResponse>(`/live/streams/${streamId}/pause`);
  }

  /**
   * Resume a paused stream
   *
   * @example
   * ```ts
   * await sdk.live.resumeStream('stream-uuid');
   * ```
   */
  async resumeStream(streamId: string): Promise<StreamResponse> {
    return this.client.post<StreamResponse>(`/live/streams/${streamId}/resume`);
  }

  /**
   * End a live stream
   *
   * @example
   * ```ts
   * const stream = await sdk.live.endStream('stream-uuid');
   * console.log(`Stream ended. Duration: ${stream.duration}s`);
   * ```
   */
  async endStream(streamId: string): Promise<StreamResponse> {
    return this.client.post<StreamResponse>(`/live/streams/${streamId}/end`);
  }

  /**
   * Delete a stream
   *
   * @example
   * ```ts
   * await sdk.live.deleteStream('stream-uuid');
   * ```
   */
  async deleteStream(streamId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/live/streams/${streamId}`);
  }

  // ---------------------------------------------------------------------------
  // Viewers
  // ---------------------------------------------------------------------------

  /**
   * Get current viewer count
   *
   * @example
   * ```ts
   * const { count, peakCount } = await sdk.live.getViewerCount('stream-uuid');
   * ```
   */
  async getViewerCount(streamId: string): Promise<{ count: number; peakCount: number }> {
    return this.client.get<{ count: number; peakCount: number }>(
      `/live/streams/${streamId}/viewers/count`
    );
  }

  /**
   * Get list of current viewers
   *
   * @example
   * ```ts
   * const result = await sdk.live.getViewers('stream-uuid', { limit: 100 });
   * console.log(result.viewerCount, result.viewers);
   * ```
   */
  async getViewers(
    streamId: string,
    pagination?: PaginationQuery
  ): Promise<{ streamId: string; viewerCount: number; viewers: Array<{ id: string; displayName: string }> }> {
    return this.client.get<{ streamId: string; viewerCount: number; viewers: Array<{ id: string; displayName: string }> }>(
      `/live/streams/${streamId}/viewers`,
      { params: pagination }
    );
  }

  // ---------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------

  /**
   * Get stream comments
   *
   * @example
   * ```ts
   * const { data, nextCursor } = await sdk.live.getComments('stream-uuid', {
   *   limit: 50
   * });
   * ```
   */
  async getComments(
    streamId: string,
    query?: CursorQuery
  ): Promise<CursorResponse<StreamCommentResponse>> {
    return this.client.get<CursorResponse<StreamCommentResponse>>(
      `/live/streams/${streamId}/comments`,
      { params: query }
    );
  }

  /**
   * Post a comment to a stream
   *
   * @example
   * ```ts
   * const comment = await sdk.live.postComment('stream-uuid', {
   *   userId: 'user-uuid',
   *   content: 'Great stream!'
   * });
   * ```
   */
  async postComment(
    streamId: string,
    request: { userId: string; content: string }
  ): Promise<StreamCommentResponse> {
    return this.client.post<StreamCommentResponse>(
      `/live/streams/${streamId}/comments`,
      request
    );
  }

  /**
   * Pin a comment
   *
   * @example
   * ```ts
   * await sdk.live.pinComment('stream-uuid', 'comment-uuid');
   * ```
   */
  async pinComment(streamId: string, commentId: string): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(
      `/live/streams/${streamId}/comments/${commentId}/pin`
    );
  }

  /**
   * Unpin a comment
   *
   * @example
   * ```ts
   * await sdk.live.unpinComment('stream-uuid', 'comment-uuid');
   * ```
   */
  async unpinComment(streamId: string, commentId: string): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(
      `/live/streams/${streamId}/comments/${commentId}/unpin`
    );
  }

  /**
   * Delete a comment
   *
   * @example
   * ```ts
   * await sdk.live.deleteComment('stream-uuid', 'comment-uuid');
   * ```
   */
  async deleteComment(streamId: string, commentId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(
      `/live/streams/${streamId}/comments/${commentId}`
    );
  }

  // ---------------------------------------------------------------------------
  // Reactions
  // ---------------------------------------------------------------------------

  /**
   * Send a reaction to a stream
   *
   * @example
   * ```ts
   * const result = await sdk.live.sendReaction('stream-uuid', {
   *   userId: 'user-uuid',
   *   emoji: '❤️'
   * });
   * console.log(result.accepted); // true if accepted
   * ```
   */
  async sendReaction(
    streamId: string,
    request: { userId: string; emoji: string }
  ): Promise<{ accepted: boolean; message: string }> {
    return this.client.post<{ accepted: boolean; message: string }>(
      `/live/streams/${streamId}/reactions`,
      request
    );
  }

  /**
   * Get reaction counts for a stream
   *
   * @example
   * ```ts
   * const reactions = await sdk.live.getReactionCounts('stream-uuid');
   * // { '❤️': 150, '🔥': 89, '👏': 45 }
   * ```
   */
  async getReactionCounts(streamId: string): Promise<Record<string, number>> {
    return this.client.get<Record<string, number>>(
      `/live/streams/${streamId}/reactions/counts`
    );
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get stream statistics
   *
   * @example
   * ```ts
   * const stats = await sdk.live.getStats('stream-uuid');
   * console.log(stats.totalViews, stats.peakViewers, stats.totalReactions);
   * ```
   */
  async getStats(streamId: string): Promise<{
    totalViews: number;
    uniqueViewers: number;
    peakViewers: number;
    averageWatchTime: number;
    totalComments: number;
    totalReactions: number;
    duration?: number;
  }> {
    return this.client.get(`/live/streams/${streamId}/stats`);
  }
}
