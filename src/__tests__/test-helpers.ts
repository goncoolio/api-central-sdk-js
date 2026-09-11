import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { WebSocketClient } from '../utils/ws-client';

// =============================================================================
// Outils partagés par les tests unitaires (aucun serveur requis)
// =============================================================================

export const BASE_URL = 'https://api.example.com/s2s/v1';

/** Remplace `fetch` par un simulacre ; les réponses sont consommées dans l'ordre. */
export function installFetchMock(): Mock {
  const mock = vi.fn();
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Programme la prochaine réponse JSON du simulacre de `fetch`. */
export function respondJson(mock: Mock, body: unknown, status = 200): void {
  mock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

export interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

/** Relit la requête n° `index` reçue par le simulacre de `fetch`. */
export function requestAt(mock: Mock, index: number): RecordedRequest {
  const call = mock.mock.calls[index] as [string, RequestInit] | undefined;
  if (!call) {
    throw new Error(`Aucune requête n° ${index} (reçues : ${mock.mock.calls.length})`);
  }
  const [url, init] = call;
  const rawBody = typeof init.body === 'string' ? init.body : undefined;
  return {
    url,
    method: init.method ?? 'GET',
    body: rawBody ? JSON.parse(rawBody) : undefined,
  };
}

/** Toutes les requêtes reçues, dans l'ordre. */
export function allRequests(mock: Mock): RecordedRequest[] {
  return mock.mock.calls.map((_, index) => requestAt(mock, index));
}

/** Construit un JWT non signé dont seule la charge utile compte. */
export function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

// -----------------------------------------------------------------------------
// WebSocket simulé, branché sur les managers via `bindWebSocket`
// -----------------------------------------------------------------------------

type Handler = (data: Record<string, unknown>) => void;

export class FakeSocket {
  readonly sent: Array<{ type: string; data?: Record<string, unknown> }> = [];
  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }

  send(type: string, data?: Record<string, unknown>): void {
    this.sent.push({ type, data });
  }

  onStateChange(): () => void {
    return () => undefined;
  }

  /** Simule un événement serveur (déjà converti en camelCase). */
  emit(event: string, data: Record<string, unknown> = {}): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler({ type: event, ...data });
    }
  }

  sentOfType(type: string): Array<Record<string, unknown> | undefined> {
    return this.sent.filter((message) => message.type === type).map((message) => message.data);
  }

  asClient(): WebSocketClient {
    return this as unknown as WebSocketClient;
  }
}

// -----------------------------------------------------------------------------
// Média simulé (MediaStream / MediaStreamTrack n'existent pas sous Node)
// -----------------------------------------------------------------------------

let trackCounter = 0;

export class FakeTrack {
  enabled = true;
  stopped = false;
  onended: (() => void) | null = null;
  readonly id: string;

  constructor(readonly kind: 'audio' | 'video') {
    trackCounter += 1;
    this.id = `${kind}-${trackCounter}`;
  }

  stop(): void {
    this.stopped = true;
  }
}

export class FakeMediaStream {
  private tracks: FakeTrack[];

  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
  }

  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === 'audio');
  }

  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === 'video');
  }

  addTrack(track: FakeTrack): void {
    if (!this.tracks.includes(track)) this.tracks = [...this.tracks, track];
  }

  removeTrack(track: FakeTrack): void {
    this.tracks = this.tracks.filter((candidate) => candidate !== track);
  }
}

/**
 * Installe `navigator.mediaDevices` : `getUserMedia` renvoie `stream`, et
 * `getDisplayMedia` renvoie `displayStream` s'il est fourni.
 */
export function stubUserMedia(
  stream: FakeMediaStream,
  displayStream?: FakeMediaStream
): { getUserMedia: Mock; getDisplayMedia: Mock } {
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  const getDisplayMedia = vi.fn().mockResolvedValue(displayStream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, getDisplayMedia } });
  vi.stubGlobal('MediaStream', FakeMediaStream);
  return { getUserMedia, getDisplayMedia };
}
