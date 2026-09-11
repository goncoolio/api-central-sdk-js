import { HttpClient } from './utils/http-client';
import type { HttpClientConfig } from './utils/http-client';
import { readUserIdFromToken } from './utils/jwt';
import { AuthModule } from './modules/auth';
import { UsersModule } from './modules/users';
import { MessagingModule } from './modules/messaging';
import { NotificationsModule } from './modules/notifications';
import { SupportModule } from './modules/support';
import { LiveModule } from './modules/live';
import { CallsModule } from './modules/calls';
import { EncryptionModule } from './modules/encryption';
import { RealtimeModule } from './modules/realtime';
import type { RealtimeConfig } from './modules/realtime';
import { CallManager } from './modules/call-manager';
import type { CallManagerConfig } from './modules/call-manager';
import { StreamManager } from './modules/stream-manager';

// =============================================================================
// API Central SDK
// =============================================================================

export interface ApiCentralConfig {
  /**
   * Base URL of the API Central server
   * @example 'https://api.example.com/s2s/v1'
   */
  baseUrl: string;

  /**
   * API Key for authentication (optional if using token)
   */
  apiKey?: string;

  /**
   * API Secret for authentication (optional if using token)
   */
  apiSecret?: string;

  /**
   * Pre-authenticated token (optional, alternative to apiKey/apiSecret)
   *
   * Un jeton utilisateur renseigne aussi l'identifiant local du CallManager.
   */
  token?: string;

  /**
   * Application ID header value
   */
  applicationId?: string;

  /**
   * Request timeout in milliseconds (default: 30000)
   */
  timeout?: number;

  /**
   * WebSocket URL for real-time features (calls, streaming, messaging)
   * @example 'wss://api.example.com/events'
   */
  wsUrl?: string;

  /**
   * Call manager configuration (media constraints, etc.)
   */
  callManagerConfig?: CallManagerConfig;
}

export class ApiCentral {
  private readonly client: HttpClient;
  private config: ApiCentralConfig;

  /**
   * Authentication module for obtaining tokens
   */
  public readonly auth: AuthModule;

  /**
   * Users module for user management, devices, and presence
   */
  public readonly users: UsersModule;

  /**
   * Messaging module for conversations and messages
   */
  public readonly messaging: MessagingModule;

  /**
   * Notifications module for push and in-app notifications
   */
  public readonly notifications: NotificationsModule;

  /**
   * Support module for tickets and knowledge base
   */
  public readonly support: SupportModule;

  /**
   * Live streaming module for TikTok-style broadcasts
   */
  public readonly live: LiveModule;

  /**
   * Calls module for audio/video calls
   */
  public readonly calls: CallsModule;

  /**
   * Encryption module for E2E key management (Signal Protocol)
   */
  public readonly encryption: EncryptionModule;

  /**
   * Real-time module for WebSocket messaging, typing, presence
   * Available after calling `connectRealtime(token)`
   */
  public realtime: RealtimeModule | null = null;

  /**
   * Call manager for WebRTC audio/video calls
   * Available after calling `connectRealtime(token)`
   */
  public callManager: CallManager;

  /**
   * Stream manager for live streaming viewer experience
   * Available after calling `connectRealtime(token)`
   */
  public streamManager: StreamManager;

  /**
   * Create a new API Central SDK instance
   *
   * @example
   * ```ts
   * // With API credentials (will auto-authenticate)
   * const sdk = new ApiCentral({
   *   baseUrl: 'https://api.example.com/s2s/v1',
   *   apiKey: 'your-api-key',
   *   apiSecret: 'your-api-secret',
   *   applicationId: 'your-app-uuid'
   * });
   *
   * // With pre-existing token
   * const sdk = new ApiCentral({
   *   baseUrl: 'https://api.example.com/s2s/v1',
   *   token: 'your-jwt-token',
   *   applicationId: 'your-app-uuid'
   * });
   * ```
   */
  constructor(config: ApiCentralConfig) {
    this.config = config;

    const clientConfig: HttpClientConfig = {
      baseUrl: config.baseUrl,
      timeout: config.timeout,
      headers: {},
    };

    // Set application ID header if provided
    if (config.applicationId) {
      clientConfig.headers!['X-Application-Id'] = config.applicationId;
    }

    // Set token if provided
    if (config.token) {
      clientConfig.headers!['Authorization'] = `Bearer ${config.token}`;
    }

    this.client = new HttpClient(clientConfig);

    // Initialize modules
    this.auth = new AuthModule(this.client);
    this.users = new UsersModule(this.client);
    this.messaging = new MessagingModule(this.client);
    this.notifications = new NotificationsModule(this.client);
    this.support = new SupportModule(this.client);
    this.live = new LiveModule(this.client);
    this.calls = new CallsModule(this.client);
    this.encryption = new EncryptionModule(this.client);
    this.callManager = new CallManager(this.client, config.callManagerConfig);
    this.streamManager = new StreamManager();

    if (config.token) {
      this.adoptUserIdFromToken(config.token);
    }
  }

  /**
   * Authenticate with API credentials and store the token.
   * Also enables automatic token refresh when the token expires.
   *
   * @example
   * ```ts
   * const sdk = new ApiCentral({
   *   baseUrl: 'https://api.example.com/s2s/v1',
   *   apiKey: 'your-api-key',
   *   apiSecret: 'your-api-secret'
   * });
   *
   * await sdk.authenticate();
   * // Now all subsequent requests are authenticated
   * // Token will be automatically refreshed when it expires
   * ```
   */
  async authenticate(): Promise<void> {
    if (!this.config.apiKey || !this.config.apiSecret) {
      throw new Error('API key and secret are required for authentication');
    }

    const { accessToken } = await this.auth.getToken({
      apiKey: this.config.apiKey,
      apiSecret: this.config.apiSecret,
    });

    this.setToken(accessToken);

    // Enable automatic token refresh
    this.enableAutoRefresh();
  }

  /**
   * Enable automatic token refresh when token expires.
   * Requires apiKey and apiSecret to be configured.
   */
  enableAutoRefresh(): void {
    if (!this.config.apiKey || !this.config.apiSecret) {
      console.warn('[ApiCentral SDK] Cannot enable auto-refresh: apiKey and apiSecret required');
      return;
    }

    this.client.setTokenRefreshConfig({
      apiKey: this.config.apiKey,
      apiSecret: this.config.apiSecret,
      onTokenRefreshed: () => {
        console.log('[ApiCentral SDK] Token auto-refreshed successfully');
      },
    });
  }

  /**
   * Set or update the authentication token
   *
   * Un jeton utilisateur met aussi à jour l'identifiant local du CallManager ;
   * un jeton d'application le laisse inchangé.
   *
   * @example
   * ```ts
   * sdk.setToken('new-jwt-token');
   * ```
   */
  setToken(token: string): void {
    this.client.setHeader('Authorization', `Bearer ${token}`);
    this.adoptUserIdFromToken(token);
  }

  /**
   * Remove the authentication token
   */
  clearToken(): void {
    this.client.removeHeader('Authorization');
  }

  // ---------------------------------------------------------------------------
  // Real-time (WebSocket)
  // ---------------------------------------------------------------------------

  /**
   * Connect to the real-time server and bind all managers.
   * This enables WebSocket-based messaging, calls, and streaming.
   *
   * @param token - User socket token (obtained via `sdk.auth.getUserToken()`)
   * @param options - Optional realtime configuration overrides
   *
   * @example
   * ```ts
   * // Get a user token
   * const { socketToken } = await sdk.auth.getUserToken({ userId: 'user-uuid' });
   *
   * // Connect to real-time
   * sdk.connectRealtime(socketToken);
   *
   * // Listen for messages
   * sdk.realtime!.onMessageNew((msg) => {
   *   console.log('New message:', msg.content);
   * });
   *
   * // Start a video call
   * sdk.callManager.onIncomingCall = (data) => {
   *   console.log('Incoming call from:', data.callerName);
   * };
   * const call = await sdk.callManager.startCall({
   *   participantIds: ['other-user'],
   *   callType: 'video'
   * });
   * ```
   */
  connectRealtime(token: string, options?: Partial<RealtimeConfig>): void {
    if (!this.config.wsUrl && !options?.wsUrl) {
      throw new Error('wsUrl is required. Set it in ApiCentralConfig or pass it in options.');
    }

    const wsUrl = options?.wsUrl ?? this.config.wsUrl!;

    // Create and connect the realtime module
    this.realtime = new RealtimeModule({
      wsUrl,
      autoReconnect: options?.autoReconnect ?? true,
      heartbeatInterval: options?.heartbeatInterval ?? 30000,
    });
    this.realtime.connect(token);
    this.adoptUserIdFromToken(token);

    // Bind call manager and stream manager to the WebSocket client
    const wsClient = this.realtime.client;
    if (wsClient) {
      this.callManager.bindWebSocket(wsClient);
      this.streamManager.bindWebSocket(wsClient);
    }
  }

  /**
   * Disconnect from the real-time server and unbind all managers.
   */
  disconnectRealtime(): void {
    this.callManager.destroy();
    this.streamManager.destroy();
    this.realtime?.disconnect();
    this.realtime = null;
  }

  /**
   * Set the application ID header
   *
   * @example
   * ```ts
   * sdk.setApplicationId('new-app-uuid');
   * ```
   */
  setApplicationId(applicationId: string): void {
    this.client.setHeader('X-Application-Id', applicationId);
  }

  /**
   * Transmet au CallManager l'utilisateur représenté par un jeton
   * utilisateur (claim `user_id`) ; sans effet pour un jeton d'application.
   */
  private adoptUserIdFromToken(token: string): void {
    const userId = readUserIdFromToken(token);
    if (userId) {
      this.callManager.setLocalUserId(userId);
    }
  }
}

// Re-export types and utilities
export { ApiCentralError } from './utils/http-client';
export type { HttpClientConfig, RequestConfig } from './utils/http-client';

// Re-export all types
export * from './types';

// Re-export modules for advanced usage
export {
  AuthModule,
  UsersModule,
  MessagingModule,
  NotificationsModule,
  SupportModule,
  LiveModule,
  CallsModule,
  EncryptionModule,
  RealtimeModule,
  CallManager,
  StreamManager,
} from './modules';

// Re-export WebSocket client for advanced usage
export { WebSocketClient } from './utils/ws-client';
export type { WebSocketClientConfig, ConnectionState, WsEventHandler } from './utils/ws-client';

// Re-export realtime types
export type { RealtimeConfig, MessageEvent, TypingEvent, PresenceEvent, NotificationEvent } from './modules/realtime';
export type { CallManagerConfig, CallManagerState, StartCallParams } from './modules/call-manager';

// Default export
export default ApiCentral;
