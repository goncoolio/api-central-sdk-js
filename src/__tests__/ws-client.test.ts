import { describe, it, expect, afterEach, vi } from 'vitest';
import { ApiCentral } from '../index';
import { WebSocketClient } from '../utils/ws-client';
import { BASE_URL } from './test-helpers';
import { FakeBrowserWebSocket } from './fake-websocket';

// Le temps réel repose sur le WebSocket natif : navigateurs, et Node.js à
// partir de la version 22, où il est global. Sans lui, l'erreur doit dire
// quoi faire, pas « WebSocket is not defined ».

const WS_URL = 'wss://api.example.com/events';

describe('WebSocketClient — WebSocket natif requis', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lève une erreur explicite quand WebSocket est absent (Node.js < 22)', () => {
    vi.stubGlobal('WebSocket', undefined);

    expect(() => new WebSocketClient({ url: WS_URL, token: 'jeton' })).toThrow(/WebSocket.*Node\.js 22/);
  });

  it('connectRealtime échoue sans laisser de module temps réel à moitié créé', () => {
    vi.stubGlobal('WebSocket', undefined);
    const sdk = new ApiCentral({ baseUrl: BASE_URL, wsUrl: WS_URL });

    expect(() => sdk.connectRealtime('jeton')).toThrow(/Node\.js 22/);
    expect(sdk.realtime).toBeNull();
  });

  it('se connecte quand WebSocket est disponible', () => {
    FakeBrowserWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeBrowserWebSocket);

    const client = new WebSocketClient({ url: WS_URL, token: 'jeton' });
    client.connect();

    expect(FakeBrowserWebSocket.last().url).toBe(`${WS_URL}?token=jeton`);
    client.disconnect();
  });
});
