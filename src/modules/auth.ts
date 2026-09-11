import type { HttpClient } from '../utils/http-client';
import type {
  AuthTokenRequest,
  AuthTokenResponse,
  UserTokenRequest,
  UserTokenResponse,
} from '../types';

// =============================================================================
// Auth Module
// =============================================================================

export class AuthModule {
  constructor(private readonly client: HttpClient) {}

  /**
   * Get an application token using API credentials
   * This token is used for server-to-server API calls
   *
   * @example
   * ```ts
   * const { accessToken, expiresIn } = await sdk.auth.getToken({
   *   apiKey: 'your-api-key',
   *   apiSecret: 'your-api-secret'
   * });
   * ```
   */
  async getToken(request: AuthTokenRequest): Promise<AuthTokenResponse> {
    // Convert to snake_case for Rust API
    return this.client.post<AuthTokenResponse>('/auth/token', {
      api_key: request.apiKey,
      api_secret: request.apiSecret,
    });
  }

  /**
   * Get a user token for WebSocket connections
   * Requires an authenticated application token
   *
   * @example
   * ```ts
   * const { socketToken, expiresIn, user } = await sdk.auth.getUserToken({
   *   userId: 'user-uuid'
   * });
   * sdk.connectRealtime(socketToken);
   * ```
   */
  async getUserToken(request: UserTokenRequest): Promise<UserTokenResponse> {
    return this.client.post<UserTokenResponse>('/auth/user-token', request);
  }
}
