import type { HttpClient } from '../utils/http-client';
import type {
  User,
  CreateUserRequest,
  UpdateUserRequest,
  RegisterDeviceRequest,
  UserDevice,
  UpdatePresenceRequest,
  PresenceResponse,
  PaginatedResponse,
  PaginationQuery,
} from '../types';

// =============================================================================
// Users Module
// =============================================================================

export class UsersModule {
  constructor(private readonly client: HttpClient) {}

  /**
   * Create or update a user (upsert by externalUserId)
   *
   * @example
   * ```ts
   * const user = await sdk.users.create({
   *   externalUserId: 'user-123',
   *   displayName: 'John Doe',
   *   email: 'john@example.com'
   * });
   * ```
   */
  async create(request: CreateUserRequest): Promise<User> {
    return this.client.post<User>('/users', request);
  }

  /**
   * List all users for the application
   *
   * @example
   * ```ts
   * const { data, total } = await sdk.users.list({ page: 1, limit: 20 });
   * ```
   */
  async list(pagination?: PaginationQuery): Promise<PaginatedResponse<User>> {
    return this.client.get<PaginatedResponse<User>>('/users', {
      params: pagination,
    });
  }

  /**
   * Get a user by ID
   *
   * @example
   * ```ts
   * const user = await sdk.users.get('user-uuid');
   * ```
   */
  async get(userId: string): Promise<User> {
    return this.client.get<User>(`/users/${userId}`);
  }

  /**
   * Get a user by external ID
   *
   * @example
   * ```ts
   * const user = await sdk.users.getByExternalId('external-user-123');
   * ```
   */
  async getByExternalId(externalId: string): Promise<User> {
    return this.client.get<User>(`/users/by-external/${encodeURIComponent(externalId)}`);
  }

  /**
   * Update a user
   *
   * @example
   * ```ts
   * const user = await sdk.users.update('user-uuid', {
   *   displayName: 'Jane Doe'
   * });
   * ```
   */
  async update(userId: string, request: UpdateUserRequest): Promise<User> {
    return this.client.put<User>(`/users/${userId}`, request);
  }

  /**
   * Delete a user
   *
   * @example
   * ```ts
   * await sdk.users.delete('user-uuid');
   * ```
   */
  async delete(userId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/users/${userId}`);
  }

  // ---------------------------------------------------------------------------
  // Devices
  // ---------------------------------------------------------------------------

  /**
   * Register a device for push notifications
   *
   * @example
   * ```ts
   * const device = await sdk.users.registerDevice('user-uuid', {
   *   deviceToken: 'fcm-token-xxx',
   *   platform: 'android',
   *   deviceInfo: { model: 'Pixel 7' }
   * });
   * ```
   */
  async registerDevice(userId: string, request: RegisterDeviceRequest): Promise<UserDevice> {
    return this.client.post<UserDevice>(`/users/${userId}/devices`, request);
  }

  /**
   * List devices for a user
   *
   * @example
   * ```ts
   * const devices = await sdk.users.listDevices('user-uuid');
   * ```
   */
  async listDevices(userId: string): Promise<UserDevice[]> {
    return this.client.get<UserDevice[]>(`/users/${userId}/devices`);
  }

  /**
   * Remove a device
   *
   * @example
   * ```ts
   * await sdk.users.removeDevice('user-uuid', 'device-token');
   * ```
   */
  async removeDevice(userId: string, deviceToken: string): Promise<{ deleted: boolean }> {
    return this.client.delete<{ deleted: boolean }>(
      `/users/${userId}/devices/${encodeURIComponent(deviceToken)}`
    );
  }

  // ---------------------------------------------------------------------------
  // Presence
  // ---------------------------------------------------------------------------

  /**
   * Update user presence status
   *
   * @example
   * ```ts
   * const presence = await sdk.users.updatePresence('user-uuid', {
   *   status: 'online'
   * });
   * ```
   */
  async updatePresence(userId: string, request: UpdatePresenceRequest): Promise<PresenceResponse> {
    return this.client.put<PresenceResponse>(`/users/${userId}/presence`, request);
  }

  /**
   * Get user presence status
   *
   * @example
   * ```ts
   * const presence = await sdk.users.getPresence('user-uuid');
   * console.log(presence.status); // 'online' | 'away' | 'busy' | 'offline'
   * ```
   */
  async getPresence(userId: string): Promise<PresenceResponse> {
    return this.client.get<PresenceResponse>(`/users/${userId}/presence`);
  }
}
