import type { HttpClient } from '../utils/http-client';
import type {
  PreKeyBundle,
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
   *   userId: 'user-uuid',
   *   identityKey: 'base64-encoded-identity-public-key',
   *   signedPrekey: {
   *     keyId: 1,
   *     publicKey: 'base64-encoded-signed-prekey',
   *     signature: 'base64-encoded-signature'
   *   },
   *   prekeys: [
   *     { keyId: 1, publicKey: 'base64-prekey-1' },
   *     { keyId: 2, publicKey: 'base64-prekey-2' },
   *     // ... up to 100 prekeys recommended
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
   *   userId: 'user-uuid',
   *   prekeys: [
   *     { keyId: 101, publicKey: 'base64-prekey-101' },
   *     { keyId: 102, publicKey: 'base64-prekey-102' },
   *     // ... more prekeys
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
   * @example
   * ```ts
   * await sdk.encryption.rotateSignedPrekey({
   *   userId: 'user-uuid',
   *   signedPrekey: {
   *     keyId: 2,
   *     publicKey: 'base64-new-signed-prekey',
   *     signature: 'base64-new-signature'
   *   }
   * });
   * ```
   */
  async rotateSignedPrekey(request: {
    userId: string;
    signedPrekey: {
      keyId: number;
      publicKey: string;
      signature: string;
    };
  }): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>('/encryption/keys/rotate', request);
  }

  /**
   * Get the count of remaining one-time prekeys
   *
   * Monitor this and upload more prekeys when running low.
   * Recommended to replenish when count drops below 25.
   *
   * @example
   * ```ts
   * const { count } = await sdk.encryption.getPrekeysCount('user-uuid');
   * if (count < 25) {
   *   // Generate and upload more prekeys
   * }
   * ```
   */
  async getPrekeysCount(userId: string): Promise<{ count: number }> {
    return this.client.get<{ count: number }>(`/encryption/keys/${userId}/prekeys/count`);
  }

  /**
   * Check if a user has encryption keys registered
   *
   * @example
   * ```ts
   * const { hasKeys } = await sdk.encryption.hasKeys('user-uuid');
   * if (!hasKeys) {
   *   // Prompt user to set up E2E encryption
   * }
   * ```
   */
  async hasKeys(userId: string): Promise<{ hasKeys: boolean }> {
    return this.client.get<{ hasKeys: boolean }>(`/encryption/keys/${userId}/exists`);
  }

  /**
   * Delete all encryption keys for a user
   *
   * WARNING: This will break all E2E encrypted sessions.
   * User will need to re-register keys and establish new sessions.
   *
   * @example
   * ```ts
   * await sdk.encryption.deleteKeys('user-uuid');
   * ```
   */
  async deleteKeys(userId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/encryption/keys/${userId}`);
  }
}
