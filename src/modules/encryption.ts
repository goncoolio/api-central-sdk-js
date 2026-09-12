import type { HttpClient } from '../utils/http-client';
import type {
  PreKeyBundle,
  RotateSignedPrekeyRequest,
  PreKeyCountResponse,
  RegisterKeysRequest,
  UploadPrekeysRequest,
} from '../types';

// =============================================================================
// Encryption Module (E2E Key Management - Signal Protocol)
// =============================================================================

export class EncryptionModule {
  constructor(private readonly client: HttpClient) {}

  // ---------------------------------------------------------------------------
  // Key Registration
  // ---------------------------------------------------------------------------

  /**
   * Register encryption keys for a user (Signal Protocol X3DH)
   *
   * Call this when:
   * - User first sets up E2E encryption
   * - User reinstalls the app (new device)
   *
   * @example
   * ```ts
   * await sdk.encryption.registerKeys({
   *   identityKey: 'base64-encoded-identity-public-key',
   *   signedPrekeyId: 1,
   *   signedPrekey: 'base64-encoded-signed-prekey',
   *   signedPrekeySignature: 'base64-encoded-signature',
   *   prekeys: [
   *     { prekeyId: 1, prekey: 'base64-prekey-1' },
   *     { prekeyId: 2, prekey: 'base64-prekey-2' },
   *     // ... une centaine de prekeys recommandés
   *   ]
   * });
   * ```
   */
  async registerKeys(request: RegisterKeysRequest): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>('/encryption/keys/register', request);
  }

  /**
   * Get a user's PreKey bundle for establishing a session
   *
   * Used by sender to initiate an encrypted session with recipient.
   * The server will consume one of the one-time prekeys.
   *
   * @example
   * ```ts
   * const bundle = await sdk.encryption.getPreKeyBundle('recipient-uuid');
   * // Use bundle to establish Signal Protocol session client-side
   * ```
   */
  async getPreKeyBundle(userId: string): Promise<PreKeyBundle> {
    return this.client.get<PreKeyBundle>(`/encryption/keys/${userId}`);
  }

  /**
   * Upload additional one-time prekeys
   *
   * Call this periodically to replenish the prekey pool.
   * Recommended to maintain 50-100 prekeys on the server.
   *
   * @example
   * ```ts
   * await sdk.encryption.uploadPrekeys({
   *   prekeys: [
   *     { prekeyId: 101, prekey: 'base64-prekey-101' },
   *     { prekeyId: 102, prekey: 'base64-prekey-102' },
   *     // ... d'autres prekeys
   *   ]
   * });
   * ```
   */
  async uploadPrekeys(request: UploadPrekeysRequest): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>('/encryption/keys/prekeys', request);
  }

  /**
   * Rotate the signed prekey
   *
   * Should be called periodically (e.g., every 7-30 days) for security.
   *
   * L'API prend l'utilisateur dans le jeton : le corps ne porte que la clé.
   *
   * @example
   * ```ts
   * await sdk.encryption.rotateSignedPrekey({
   *   signedPrekeyId: 2,
   *   signedPrekey: 'base64-encoded-signed-prekey',
   *   signedPrekeySignature: 'base64-encoded-signature'
   * });
   * ```
   */
  async rotateSignedPrekey(request: RotateSignedPrekeyRequest): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>('/encryption/keys/rotate', request);
  }

  /**
   * Get the count of remaining one-time prekeys for the authenticated user
   *
   * The user is taken from the token, so this requires a user token.
   * Monitor this and upload more prekeys when running low — replenish
   * when the count drops below 25.
   *
   * @example
   * ```ts
   * const { availablePrekeys } = await sdk.encryption.getPrekeysCount();
   * if (availablePrekeys < 25) {
   *   // Generate and upload more prekeys
   * }
   * ```
   */
  async getPrekeysCount(): Promise<PreKeyCountResponse> {
    return this.client.get<PreKeyCountResponse>('/encryption/keys/prekeys/count');
  }
}
