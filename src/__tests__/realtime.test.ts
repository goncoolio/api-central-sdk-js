import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiCentral } from '../index';
import { BASE_URL, fakeJwt } from './test-helpers';
import { FakeBrowserWebSocket } from './fake-websocket';

// Événements temps réel tels que l'API les sérialise (src/ws/events.rs).

const USER_TOKEN = fakeJwt({ sub: 'app-1', slug: 'demo', token_type: 'user', user_id: 'user-1', exp: 1, iat: 0 });

describe('RealtimeModule — présence', () => {
  let sdk: ApiCentral;
  let socket: FakeBrowserWebSocket;

  beforeEach(() => {
    FakeBrowserWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeBrowserWebSocket);
    sdk = new ApiCentral({ baseUrl: BASE_URL, wsUrl: 'wss://api.example.com/events' });
    sdk.connectRealtime(USER_TOKEN);
    socket = FakeBrowserWebSocket.last();
    socket.open();
  });

  afterEach(() => {
    sdk.disconnectRealtime();
    vi.unstubAllGlobals();
  });

  it('subscribePresence envoie presence_subscribe', () => {
    sdk.realtime!.subscribePresence(['user-2', 'user-3']);

    expect(socket.sent.map((raw) => JSON.parse(raw))).toContainEqual({
      type: 'presence_subscribe',
      user_ids: ['user-2', 'user-3'],
    });
  });

  it('onPresenceStatus reçoit l’événement { statuses } de l’API', () => {
    const handler = vi.fn();
    sdk.realtime!.onPresenceStatus(handler);

    socket.receive({
      type: 'presence_status',
      statuses: [
        { user_id: 'user-2', status: 'online' },
        { user_id: 'user-3', status: 'offline' },
      ],
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      statuses: [
        { userId: 'user-2', status: 'online' },
        { userId: 'user-3', status: 'offline' },
      ],
    });
  });

  it('onPresenceStatus reçoit une liste vide si un serveur ancien omet statuses', () => {
    // Avant son correctif, l'API sérialisait cet événement sans la liste.
    const handler = vi.fn();
    sdk.realtime!.onPresenceStatus(handler);

    socket.receive({ type: 'presence_status' });

    expect(handler).toHaveBeenCalledWith({ statuses: [] });
  });
});
