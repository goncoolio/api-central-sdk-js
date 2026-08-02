import type { HttpClient } from '../utils/http-client';
import type {
  Notification,
  CreateNotificationRequest,
  NotificationTemplate,
  CreateTemplateRequest,
  UpdateTemplateRequest,
  PaginatedResponse,
  PaginationQuery,
} from '../types';

// =============================================================================
// Notifications Module
// =============================================================================

export class NotificationsModule {
  constructor(private readonly client: HttpClient) {}

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------

  /**
   * Send a notification to a user
   *
   * @example
   * ```ts
   * const notification = await sdk.notifications.send({
   *   userId: 'user-uuid',
   *   title: 'New Message',
   *   body: 'You have a new message from John',
   *   data: { conversationId: 'conv-uuid' }
   * });
   * ```
   */
  async send(request: CreateNotificationRequest): Promise<Notification> {
    return this.client.post<Notification>('/notifications', request);
  }

  /**
   * Send notification to multiple users
   *
   * @example
   * ```ts
   * const results = await sdk.notifications.sendBulk({
   *   userIds: ['user-1', 'user-2', 'user-3'],
   *   title: 'Announcement',
   *   body: 'Important system update'
   * });
   * ```
   */
  async sendBulk(request: {
    userIds: string[];
    title: string;
    body: string;
    data?: Record<string, unknown>;
    templateId?: string;
  }): Promise<{ sent: number; failed: number }> {
    return this.client.post<{ sent: number; failed: number }>('/notifications/bulk', request);
  }

  /**
   * Broadcast notification to ALL users of the application
   *
   * @example
   * ```ts
   * const result = await sdk.notifications.broadcast({
   *   notificationType: 'news:meteo',
   *   title: 'Alerte Météo',
   *   body: 'Pluies intenses prévues...',
   *   data: { news_id: 'uuid' },
   *   channels: ['push', 'in_app']
   * });
   * ```
   */
  async broadcast(request: {
    notificationType: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    channels?: string[];
  }): Promise<{ success: boolean; sent_count: number; total_users: number }> {
    return this.client.post<{ success: boolean; sent_count: number; total_users: number }>(
      '/notifications/broadcast',
      request
    );
  }

  /**
   * List notifications for a user
   *
   * @example
   * ```ts
   * const { data } = await sdk.notifications.list('user-uuid', { page: 1, limit: 20 });
   * ```
   */
  async list(userId: string, pagination?: PaginationQuery): Promise<PaginatedResponse<Notification>> {
    return this.client.get<PaginatedResponse<Notification>>(`/notifications/users/${userId}`, {
      params: pagination,
    });
  }

  /**
   * Get a notification by ID
   *
   * @example
   * ```ts
   * const notification = await sdk.notifications.get('notification-uuid');
   * ```
   */
  async get(notificationId: string): Promise<Notification> {
    return this.client.get<Notification>(`/notifications/${notificationId}`);
  }

  /**
   * Mark notifications as read
   *
   * @example
   * ```ts
   * await sdk.notifications.markAsRead({
   *   userId: 'user-uuid',
   *   notificationIds: ['notif-1', 'notif-2']
   * });
   * ```
   */
  async markAsRead(request: {
    userId: string;
    notificationIds: string[];
  }): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>('/notifications/read', request);
  }

  /**
   * Mark all notifications as read for a user
   *
   * @example
   * ```ts
   * await sdk.notifications.markAllAsRead('user-uuid');
   * ```
   */
  async markAllAsRead(userId: string): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/notifications/users/${userId}/read-all`);
  }

  /**
   * Get unread notification count for a user
   *
   * @example
   * ```ts
   * const { count } = await sdk.notifications.getUnreadCount('user-uuid');
   * ```
   */
  async getUnreadCount(userId: string): Promise<{ count: number }> {
    return this.client.get<{ count: number }>(`/notifications/users/${userId}/unread-count`);
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

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  /**
   * Create a notification template
   *
   * @example
   * ```ts
   * const template = await sdk.notifications.createTemplate({
   *   name: 'new_message',
   *   title: 'New message from {{sender}}',
   *   body: '{{sender}}: {{preview}}'
   * });
   * ```
   */
  async createTemplate(request: CreateTemplateRequest): Promise<NotificationTemplate> {
    return this.client.post<NotificationTemplate>('/notifications/templates', request);
  }

  /**
   * List notification templates
   *
   * @example
   * ```ts
   * const { data } = await sdk.notifications.listTemplates({ page: 1 });
   * ```
   */
  async listTemplates(pagination?: PaginationQuery): Promise<PaginatedResponse<NotificationTemplate>> {
    return this.client.get<PaginatedResponse<NotificationTemplate>>('/notifications/templates', {
      params: pagination,
    });
  }

  /**
   * Get a template by ID
   *
   * @example
   * ```ts
   * const template = await sdk.notifications.getTemplate('template-uuid');
   * ```
   */
  async getTemplate(templateId: string): Promise<NotificationTemplate> {
    return this.client.get<NotificationTemplate>(`/notifications/templates/${templateId}`);
  }

  /**
   * Update a template
   *
   * @example
   * ```ts
   * const template = await sdk.notifications.updateTemplate('template-uuid', {
   *   body: 'Updated body with {{variable}}'
   * });
   * ```
   */
  async updateTemplate(
    templateId: string,
    request: UpdateTemplateRequest
  ): Promise<NotificationTemplate> {
    return this.client.put<NotificationTemplate>(`/notifications/templates/${templateId}`, request);
  }

  /**
   * Delete a template
   *
   * @example
   * ```ts
   * await sdk.notifications.deleteTemplate('template-uuid');
   * ```
   */
  async deleteTemplate(templateId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/notifications/templates/${templateId}`);
  }
}
