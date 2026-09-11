import type { HttpClient } from '../utils/http-client';
import type {
  LiveStreamResponse,
  CreateStreamRequest,
  UpdateStreamRequest,
  StreamStatus,
  StreamCommentInfo,
  StreamViewersResponse,
  StreamViewerCount,
  StreamStats,
  ReactionCount,
  PaginationQuery,
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
  ): Promise<StreamResponse[]> {
    // The API returns a bare array here, not a paginated envelope, unlike the
    // rest of the SDK's list endpoints.
    return this.client.get<StreamResponse[]>('/live/streams', {
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
   * There is no dedicated resume route: the API's start endpoint accepts both
   * `scheduled` and `paused` streams, so resuming is starting again.
   *
   * @example
   * ```ts
   * await sdk.live.resumeStream('stream-uuid');
   * ```
   */
  async resumeStream(streamId: string): Promise<StreamResponse> {
    return this.startStream(streamId);
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

  // ---------------------------------------------------------------------------
  // Viewers
  // ---------------------------------------------------------------------------

  /**
   * Join a stream as a viewer
   *
   * @example
   * ```ts
   * const { viewerCount } = await sdk.live.joinStream('stream-uuid', { userId: 'user-uuid' });
   * ```
   */
  async joinStream(
    streamId: string,
    request: { userId: string }
  ): Promise<StreamViewerCount> {
    return this.client.post<StreamViewerCount>(`/live/streams/${streamId}/join`, request);
  }

  /**
   * Leave a stream
   *
   * @example
   * ```ts
   * await sdk.live.leaveStream('stream-uuid', { userId: 'user-uuid' });
   * ```
   */
  async leaveStream(
    streamId: string,
    request: { userId: string }
  ): Promise<StreamViewerCount> {
    return this.client.post<StreamViewerCount>(`/live/streams/${streamId}/leave`, request);
  }

  /**
   * Get the current viewer count
   *
   * The API has no count-only endpoint: the count comes with the viewer list.
   *
   * @example
   * ```ts
   * const { viewerCount } = await sdk.live.getViewerCount('stream-uuid');
   * ```
   */
  async getViewerCount(streamId: string): Promise<{ viewerCount: number }> {
    const { viewerCount } = await this.getViewers(streamId, { limit: 1 });
    return { viewerCount };
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
  ): Promise<StreamViewersResponse> {
    return this.client.get<StreamViewersResponse>(`/live/streams/${streamId}/viewers`, {
      params: pagination,
    });
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
  ): Promise<StreamCommentResponse[]> {
    // Bare array, not a cursor envelope.
    return this.client.get<StreamCommentResponse[]>(
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
   * // [{ emoji: '❤️', count: 150 }, { emoji: '🔥', count: 89 }]
   * ```
   */
  async getReactionCounts(streamId: string): Promise<ReactionCount[]> {
    return this.client.get<ReactionCount[]>(`/live/streams/${streamId}/reactions`);
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get stream statistics
   *
   * `durationSeconds` vaut `null` tant que le live n'a pas démarré.
   *
   * @example
   * ```ts
   * const stats = await sdk.live.getStats('stream-uuid');
   * console.log(stats.viewerCount, stats.peakViewerCount, stats.totalReactions);
   * for (const { emoji, count } of stats.reactionsByEmoji) console.log(emoji, count);
   * ```
   */
  async getStats(streamId: string): Promise<StreamStats> {
    return this.client.get<StreamStats>(`/live/streams/${streamId}/stats`);
  }
}
