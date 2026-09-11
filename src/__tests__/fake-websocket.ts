// =============================================================================
// WebSocket natif simulé : remplace `globalThis.WebSocket` dans les tests pour
// qu'aucune connexion réseau ne soit ouverte.
// =============================================================================

export class FakeBrowserWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** Instances créées depuis le dernier `reset()`. */
  static instances: FakeBrowserWebSocket[] = [];

  readyState = FakeBrowserWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    FakeBrowserWebSocket.instances.push(this);
  }

  static reset(): void {
    FakeBrowserWebSocket.instances = [];
  }

  static last(): FakeBrowserWebSocket {
    const socket = FakeBrowserWebSocket.instances[FakeBrowserWebSocket.instances.length - 1];
    if (!socket) throw new Error('Aucun WebSocket créé');
    return socket;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeBrowserWebSocket.CLOSED;
  }

  /** Simule l'ouverture de la connexion. */
  open(): void {
    this.readyState = FakeBrowserWebSocket.OPEN;
    this.onopen?.();
  }

  /** Simule un message du serveur (JSON snake_case, comme l'API). */
  receive(message: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}
