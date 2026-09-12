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

export interface RouteReply {
  status?: number;
  body?: unknown;
}

/**
 * Répond selon la route « MÉTHODE /chemin » (chemin relatif à `BASE_URL`,
 * sans la query) ; une route absente répond 404. Remplace les réponses
 * programmées une à une : l'ordre des requêtes ne compte plus.
 */
export function routeFetch(mock: Mock, routes: Record<string, RouteReply>): void {
  mock.mockImplementation(async (url: string, init?: RequestInit) => {
    const key = routeKey(url, init?.method);
    const reply = routes[key] ?? { status: 404, body: { message: `Route non simulée : ${key}`, statusCode: 404 } };
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(reply.body === undefined ? '' : JSON.stringify(reply.body)),
    };
  });
}

/** Requêtes reçues, dans l'ordre, sous la forme « MÉTHODE /chemin ». */
export function requestLog(mock: Mock): string[] {
  return allRequests(mock).map((request) => routeKey(request.url, request.method));
}

function routeKey(url: string, method = 'GET'): string {
  const path = url.startsWith(BASE_URL) ? url.slice(BASE_URL.length) : url;
  return `${method} ${path.split('?')[0]}`;
}

/** Réponse d'erreur au format de l'API (`{ message, statusCode }`). */
export function apiError(status: number, message: string): RouteReply {
  return { status, body: { message, statusCode: status } };
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

/** Laisse s'exécuter les promesses et callbacks en attente. */
export function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** RTCPeerConnection simulée : enregistre les connexions créées. */
export class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  connectionState = 'new';
  closed = false;
  ontrack: ((event: unknown) => void) | null = null;
  onicecandidate: ((event: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  readonly tracks: unknown[] = [];

  constructor(readonly configuration?: unknown) {
    FakePeerConnection.instances.push(this);
  }

  addTrack(track: unknown): void {
    this.tracks.push(track);
  }

  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: 'offer', sdp: 'v=0 offer' };
  }

  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: 'answer', sdp: 'v=0 answer' };
  }

  async setLocalDescription(): Promise<void> {}

  async setRemoteDescription(): Promise<void> {}

  async addIceCandidate(): Promise<void> {}

  getSenders(): unknown[] {
    return [];
  }

  close(): void {
    this.closed = true;
  }
}

/** Remplace `RTCPeerConnection` ; renvoie un accès aux connexions créées. */
export function stubPeerConnection(): () => FakePeerConnection[] {
  FakePeerConnection.instances = [];
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
  return () => FakePeerConnection.instances;
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
