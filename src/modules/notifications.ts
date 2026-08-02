import type { HttpClient } from '../utils/http-client';
import type {
  Notification,
  SendNotificationRequest,
  SendBulkNotificationRequest,
  BroadcastNotificationRequest,
  SendTemplatedNotificationRequest,
  BulkSendResult,
  BroadcastResult,
  MarkReadResult,
  PaginatedResponse,
  PaginationQuery,
} from '../types';

// =============================================================================
// Notifications Module
// =============================================================================

export class NotificationsModule {
  constructor(private readonly client: HttpClient) {}

  /**
   * Send a notification to a single user
   *
   * `notificationType`, `title` and `body` are required by the API
   * (1-100, 1-255 and 1-1000 characters respectively).
   *
   * @example
   * ```ts
   * const notification = await sdk.notifications.send({
   *   userId: 'user-uuid',
   *   notificationType: 'message',
   *   title: 'New Message',
   *   body: 'You have a new message from John',
   *   data: { conversationId: 'conv-uuid' }
   * });
   * ```
   */
  async send(request: SendNotificationRequest): Promise<Notification> {
    return this.client.post<Notification>('/notifications/send', request);
  }

  /**
   * Send the same notification to several users at once
   *
   * @example
   * ```ts
   * const { sentCount } = await sdk.notifications.sendBulk({
   *   userIds: ['user-1', 'user-2', 'user-3'],
   *   notificationType: 'system',
   *   title: 'Announcement',
   *   body: 'Important system update'
   * });
   * ```
   */
  async sendBulk(request: SendBulkNotificationRequest): Promise<BulkSendResult> {
    return this.client.post<BulkSendResult>('/notifications/send-bulk', request);
  }

  /**
   * Broadcast a notification to ALL users of the application
   *
   * @example
   * ```ts
   * const result = await sdk.notifications.broadcast({
   *   notificationType: 'news:meteo',
   *   title: 'Alerte Météo',
   *   body: 'Pluies intenses prévues...',
   *   data: { newsId: 'uuid' },
   *   channels: ['push', 'in_app']
   * });
   * ```
   */
  async broadcast(request: BroadcastNotificationRequest): Promise<BroadcastResult> {
    return this.client.post<BroadcastResult>('/notifications/broadcast', request);
  }

  /**
   * Send a notification built from a server-side template
   *
   * Templates are managed server-side: the SDK can only send from an
   * existing template slug.
   *
   * @example
   * ```ts
   * const notification = await sdk.notifications.sendTemplate({
   *   userId: 'user-uuid',
   *   templateSlug: 'new_message',
   *   variables: { sender: 'John', preview: 'Hey there' }
   * });
   * ```
   */
  async sendTemplate(request: SendTemplatedNotificationRequest): Promise<Notification> {
    return this.client.post<Notification>('/notifications/send-template', request);
  }

  /**
   * List notifications for a user
   *
   * @example
   * ```ts
   * const { data } = await sdk.notifications.list('user-uuid', { page: 1, limit: 20 });
   * const unread = await sdk.notifications.list('user-uuid', { unreadOnly: true });
   * ```
   */
  async list(
    userId: string,
    options?: PaginationQuery & { unreadOnly?: boolean }
  ): Promise<PaginatedResponse<Notification>> {
    return this.client.get<PaginatedResponse<Notification>>('/notifications', {
      params: { userId, ...options },
    });
  }

  /**
   * Mark specific notifications as read
   *
   * @example
   * ```ts
   * const { updatedCount } = await sdk.notifications.markAsRead({
   *   notificationIds: ['notif-1', 'notif-2']
   * });
   * ```
   */
  async markAsRead(request: { notificationIds: string[] }): Promise<MarkReadResult> {
    return this.client.post<MarkReadResult>('/notifications/mark-read', request);
  }

  /**
   * Mark every notification of a user as read
   *
   * @example
   * ```ts
   * await sdk.notifications.markAllAsRead('user-uuid');
   * ```
   */
  async markAllAsRead(userId: string): Promise<MarkReadResult> {
    return this.client.post<MarkReadResult>('/notifications/mark-all-read', undefined, {
      params: { userId },
    });
  }

  /**
   * Get the unread notification count for a user
   *
   * @example
   * ```ts
   * const { count } = await sdk.notifications.getUnreadCount('user-uuid');
   * ```
   */
  async getUnreadCount(userId: string): Promise<{ count: number }> {
    return this.client.get<{ count: number }>('/notifications/unread-count', {
      params: { userId },
    });
  }

  /**
   * Delete a notification
   *
   * @example
   * ```ts
   * await sdk.notifications.delete('notification-uuid');
   * ```
   */
  async delete(notificationId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/notifications/${notificationId}`);
  }
}
