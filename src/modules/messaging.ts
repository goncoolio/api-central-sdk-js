import type { HttpClient } from '../utils/http-client';
import type {
  Conversation,
  ConversationResponse,
  CreateConversationRequest,
  UpdateConversationRequest,
  AddParticipantRequest,
  ConversationParticipant,
  MessageResponse,
  SendMessageRequest,
  EditMessageRequest,
  AddReactionRequest,
  TypingRequest,
  MarkReadRequest,
  PaginatedResponse,
  PaginationQuery,
  CursorResponse,
  CursorQuery,
} from '../types';

// =============================================================================
// Messaging Module
// =============================================================================

export class MessagingModule {
  constructor(private readonly client: HttpClient) {}

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  /**
   * Create a new conversation
   *
   * @example
   * ```ts
   * // Direct conversation
   * const dm = await sdk.messaging.createConversation({
   *   conversationType: 'direct',
   *   participantIds: ['user-1', 'user-2']
   * });
   *
   * // Group conversation
   * const group = await sdk.messaging.createConversation({
   *   conversationType: 'group',
   *   participantIds: ['user-1', 'user-2', 'user-3'],
   *   name: 'Project Team'
   * });
   * ```
   */
  async createConversation(request: CreateConversationRequest): Promise<ConversationResponse> {
    return this.client.post<ConversationResponse>('/messaging/conversations', request);
  }

  /**
   * List conversations for the application
   *
   * @example
   * ```ts
   * const { data } = await sdk.messaging.listConversations({ page: 1, limit: 20 });
   * ```
   */
  async listConversations(pagination?: PaginationQuery): Promise<PaginatedResponse<ConversationResponse>> {
    return this.client.get<PaginatedResponse<ConversationResponse>>('/messaging/conversations', {
      params: pagination,
    });
  }

  /**
   * List conversations for a specific user
   *
   * @example
   * ```ts
   * const { data } = await sdk.messaging.listUserConversations('user-uuid', { page: 1 });
   * ```
   */
  async listUserConversations(
    userId: string,
    pagination?: PaginationQuery
  ): Promise<PaginatedResponse<ConversationResponse>> {
    return this.client.get<PaginatedResponse<ConversationResponse>>(
      `/messaging/conversations`,
      { params: { ...pagination, userId } }
    );
  }

  /**
   * Get a conversation by ID
   *
   * @example
   * ```ts
   * const conversation = await sdk.messaging.getConversation('conv-uuid', 'user-uuid');
   * ```
   */
  async getConversation(conversationId: string, userId: string): Promise<ConversationResponse> {
    return this.client.get<ConversationResponse>(`/messaging/conversations/${conversationId}`, {
      params: { userId },
    });
  }

  /**
   * Update a conversation
   *
   * @example
   * ```ts
   * const conversation = await sdk.messaging.updateConversation('conv-uuid', {
   *   name: 'New Group Name'
   * });
   * ```
   */
  async updateConversation(
    conversationId: string,
    request: UpdateConversationRequest
  ): Promise<Conversation> {
    return this.client.put<Conversation>(`/messaging/conversations/${conversationId}`, request);
  }

  /**
   * Delete a conversation
   *
   * @example
   * ```ts
   * await sdk.messaging.deleteConversation('conv-uuid');
   * ```
   */
  async deleteConversation(conversationId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/messaging/conversations/${conversationId}`);
  }

  // ---------------------------------------------------------------------------
  // Participants
  // ---------------------------------------------------------------------------

  /**
   * Add a participant to a conversation
   *
   * @example
   * ```ts
   * const participant = await sdk.messaging.addParticipant('conv-uuid', {
   *   userId: 'user-uuid',
   *   role: 'member'
   * });
   * ```
   */
  async addParticipant(
    conversationId: string,
    request: AddParticipantRequest
  ): Promise<ConversationParticipant> {
    return this.client.post<ConversationParticipant>(
      `/messaging/conversations/${conversationId}/participants`,
      request
    );
  }

  /**
   * Remove a participant from a conversation
   *
   * @example
   * ```ts
   * await sdk.messaging.removeParticipant('conv-uuid', 'user-uuid');
   * ```
   */
  async removeParticipant(conversationId: string, userId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(
      `/messaging/conversations/${conversationId}/participants/${userId}`
    );
  }

  /**
   * List the participants of a conversation
   *
   * @example
   * ```ts
   * const participants = await sdk.messaging.listParticipants('conv-uuid');
   * ```
   */
  async listParticipants(conversationId: string): Promise<ConversationParticipant[]> {
    return this.client.get<ConversationParticipant[]>(
      `/messaging/conversations/${conversationId}/participants`
    );
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /**
   * Send a message to a conversation
   *
   * @example
   * ```ts
   * // Text message
   * const message = await sdk.messaging.sendMessage('conv-uuid', {
   *   senderId: 'user-uuid',
   *   content: 'Hello world!'
   * });
   *
   * // Audio message
   * const audioMessage = await sdk.messaging.sendMessage('conv-uuid', {
   *   senderId: 'user-uuid',
   *   content: 'Voice message',
   *   contentType: 'audio',
   *   attachments: [{
   *     url: 'https://storage.example.com/audio.mp3',
   *     mimeType: 'audio/mpeg',
   *     name: 'voice-note.mp3',
   *     size: 125000
   *   }]
   * });
   * ```
   */
  async sendMessage(conversationId: string, request: SendMessageRequest): Promise<MessageResponse> {
    return this.client.post<MessageResponse>(
      `/messaging/conversations/${conversationId}/messages`,
      request
    );
  }

  /**
   * List messages in a conversation (cursor-based pagination)
   *
   * @example
   * ```ts
   * const { data, nextCursor, hasMore } = await sdk.messaging.listMessages('conv-uuid', {
   *   limit: 50
   * });
   *
   * // Load more
   * if (hasMore) {
   *   const more = await sdk.messaging.listMessages('conv-uuid', {
   *     cursor: nextCursor
   *   });
   * }
   * ```
   */
  async listMessages(
    conversationId: string,
    query?: CursorQuery
  ): Promise<CursorResponse<MessageResponse>> {
    return this.client.get<CursorResponse<MessageResponse>>(
      `/messaging/conversations/${conversationId}/messages`,
      { params: query }
    );
  }

  /**
   * Get a specific message
   *
   * @example
   * ```ts
   * const message = await sdk.messaging.getMessage('message-uuid');
   * ```
   */
  async getMessage(messageId: string): Promise<MessageResponse> {
    return this.client.get<MessageResponse>(`/messaging/messages/${messageId}`);
  }

  /**
   * Edit a message
   *
   * @example
   * ```ts
   * const message = await sdk.messaging.editMessage('message-uuid', {
   *   content: 'Updated content'
   * });
   * ```
   */
  async editMessage(messageId: string, request: EditMessageRequest): Promise<MessageResponse> {
    return this.client.put<MessageResponse>(`/messaging/messages/${messageId}`, request);
  }

  /**
   * Delete a message (soft delete)
   *
   * @example
   * ```ts
   * await sdk.messaging.deleteMessage('message-uuid');
   * ```
   */
  async deleteMessage(messageId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/messaging/messages/${messageId}`);
  }

  // ---------------------------------------------------------------------------
  // Reactions
  // ---------------------------------------------------------------------------

  /**
   * Add a reaction to a message
   *
   * @example
   * ```ts
   * await sdk.messaging.addReaction('message-uuid', {
   *   userId: 'user-uuid',
   *   emoji: '👍'
   * });
   * ```
   */
  async addReaction(messageId: string, request: AddReactionRequest): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(
      `/messaging/messages/${messageId}/reactions`,
      request
    );
  }

  /**
   * Remove a reaction from a message
   *
   * @example
   * ```ts
   * await sdk.messaging.removeReaction('message-uuid', 'user-uuid', '👍');
   * ```
   */
  async removeReaction(
    messageId: string,
    userId: string,
    emoji: string
  ): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(
      `/messaging/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
      { params: { userId } }
    );
  }

  // ---------------------------------------------------------------------------
  // Typing & Read Receipts
  // ---------------------------------------------------------------------------

  /**
   * Send typing indicator
   *
   * @example
   * ```ts
   * await sdk.messaging.sendTyping('conv-uuid', { userId: 'user-uuid' });
   * ```
   */
  async sendTyping(conversationId: string, request: TypingRequest): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(
      `/messaging/conversations/${conversationId}/typing`,
      request
    );
  }

  /**
   * Mark messages as read
   *
   * @example
   * ```ts
   * await sdk.messaging.markAsRead('conv-uuid', {
   *   userId: 'user-uuid',
   *   messageId: 'last-read-message-uuid'
   * });
   * ```
   */
  async markAsRead(conversationId: string, request: MarkReadRequest): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(
      `/messaging/conversations/${conversationId}/read`,
      request
    );
  }
}
