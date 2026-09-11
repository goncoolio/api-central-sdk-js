import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiCentral } from '../index';
import { readUserIdFromToken } from '../utils/jwt';
import { BASE_URL, fakeJwt } from './test-helpers';
import { FakeBrowserWebSocket } from './fake-websocket';

// Charges utiles calquées sur UserClaims / AppClaims de l'API (src/services/auth.rs).
const USER_TOKEN = fakeJwt({ sub: 'app-1', slug: 'demo', token_type: 'user', user_id: 'user-42', exp: 1, iat: 0 });
const OTHER_USER_TOKEN = fakeJwt({ sub: 'app-1', slug: 'demo', token_type: 'user', user_id: 'user-7', exp: 1, iat: 0 });
const APP_TOKEN = fakeJwt({ sub: 'app-1', slug: 'demo', token_type: 'application', exp: 1, iat: 0 });

describe('readUserIdFromToken', () => {
  it('lit le claim user_id d’un jeton utilisateur', () => {
    expect(readUserIdFromToken(USER_TOKEN)).toBe('user-42');
  });

  it('renvoie null pour un jeton d’application', () => {
    expect(readUserIdFromToken(APP_TOKEN)).toBeNull();
  });

  it.each(['pas-un-jwt', 'a.%%%.c', `a.${Buffer.from('pas du json').toString('base64url')}.c`, 'a..c'])(
    'renvoie null pour un jeton illisible (%s)',
    (token) => {
      expect(readUserIdFromToken(token)).toBeNull();
    }
  );
});

describe('ApiCentral — identifiant local transmis au CallManager', () => {
  beforeEach(() => {
    FakeBrowserWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeBrowserWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('le déduit du jeton utilisateur passé au constructeur', () => {
    const sdk = new ApiCentral({ baseUrl: BASE_URL, token: USER_TOKEN });

    expect(sdk.callManager.localUserId).toBe('user-42');
  });

  it('le met à jour avec setToken, sans l’effacer pour un jeton d’application', () => {
    const sdk = new ApiCentral({ baseUrl: BASE_URL, token: USER_TOKEN });

    sdk.setToken(OTHER_USER_TOKEN);
    expect(sdk.callManager.localUserId).toBe('user-7');

    sdk.setToken(APP_TOKEN);
    expect(sdk.callManager.localUserId).toBe('user-7');
  });

  it('le déduit du jeton passé à connectRealtime', () => {
    const sdk = new ApiCentral({ baseUrl: BASE_URL, wsUrl: 'wss://api.example.com/events' });
    expect(sdk.callManager.localUserId).toBeNull();

    sdk.connectRealtime(USER_TOKEN);

    expect(sdk.callManager.localUserId).toBe('user-42');
    sdk.disconnectRealtime();
  });

  it('laisse primer callManagerConfig.userId', () => {
    const sdk = new ApiCentral({
      baseUrl: BASE_URL,
      token: USER_TOKEN,
      callManagerConfig: { userId: 'user-explicite' },
    });

    expect(sdk.callManager.localUserId).toBe('user-explicite');
  });
});
