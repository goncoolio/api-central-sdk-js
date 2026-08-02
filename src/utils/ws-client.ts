// =============================================================================
// WebSocket Client for API Central SDK
// =============================================================================

// Case conversion (reuse same logic as http-client)
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function toSnakeCase(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toSnakeCase);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[camelToSnake(key)] = toSnakeCase(value);
    }
    return result;
  }
  return obj;
}

function toCamelCase(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toCamelCase);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[snakeToCamel(key)] = toCamelCase(value);
    }
    return result;
  }
  return obj;
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface WebSocketClientConfig {
  /** WebSocket server URL (ws:// or wss://) */
  url: string;
  /** Authentication token */
  token: string;
  /** Enable auto-reconnect (default: true) */
  autoReconnect?: boolean;
  /** Max reconnect attempts (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
  /** Max reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
}

export type WsEventHandler = (data: Record<string, unknown>) => void;

// -----------------------------------------------------------------------------
// WebSocket Client
// -----------------------------------------------------------------------------

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketClientConfig>;
  private listeners: Map<string, Set<WsEventHandler>> = new Map();
  private onceListeners: Map<string, Set<WsEventHandler>> = new Map();
  private stateListeners: Set<(state: ConnectionState) => void> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private messageQueue: string[] = [];
  private _state: ConnectionState = 'disconnected';
  private intentionalClose = false;

  constructor(config: WebSocketClientConfig) {
    this.config = {
      autoReconnect: true,
      maxReconnectAttempts: Infinity,
      heartbeatInterval: 30000,
      maxReconnectDelay: 30000,
      ...config,
    };
  }

  /** Current connection state */
  get state(): ConnectionState {
    return this._state;
  }

  get connected(): boolean {
    return this._state === 'connected';
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  /** Connect to the WebSocket server */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.intentionalClose = false;
    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    const url = `${this.config.url}?token=${encodeURIComponent(this.config.token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState('connected');
      this.startHeartbeat();
      this.flushQueue();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data as string);
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.setState('disconnected');

      if (!this.intentionalClose && this.config.autoReconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // Error is handled by onclose
    };
  }

  /** Disconnect from the WebSocket server */
  disconnect(): void {
    this.intentionalClose = true;
    this.stopHeartbeat();
    this.clearReconnect();
    this.reconnectAttempts = 0;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setState('disconnected');
  }

  /** Update the authentication token (for reconnection) */
  updateToken(token: string): void {
    this.config.token = token;
  }

  // ---------------------------------------------------------------------------
  // Event Emitter
  // ---------------------------------------------------------------------------

  /** Subscribe to a WebSocket event */
  on(event: string, handler: WsEventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /** Unsubscribe from a WebSocket event */
  off(event: string, handler: WsEventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  /** Subscribe to a WebSocket event once */
  once(event: string, handler: WsEventHandler): () => void {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set());
    }
    this.onceListeners.get(event)!.add(handler);

    return () => this.onceListeners.get(event)?.delete(handler);
  }

  /** Subscribe to connection state changes */
  onStateChange(handler: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(handler);
    return () => this.stateListeners.delete(handler);
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  /** Send a typed event through the WebSocket */
  send(type: string, data?: Record<string, unknown>): void {
    const payload = toSnakeCase({ type, ...data }) as Record<string, unknown>;
    const message = JSON.stringify(payload);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private handleMessage(raw: string): void {
    let data: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw);
      data = toCamelCase(parsed) as Record<string, unknown>;
    } catch {
      return;
    }

    const eventType = data.type as string;
    if (!eventType) return;

    // Emit to regular listeners
    const handlers = this.listeners.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }

    // Emit to once listeners
    const onceHandlers = this.onceListeners.get(eventType);
    if (onceHandlers) {
      for (const handler of onceHandlers) {
        handler(data);
      }
      this.onceListeners.delete(eventType);
    }

    // Emit wildcard
    const wildcardHandlers = this.listeners.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        handler(data);
      }
    }
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    for (const handler of this.stateListeners) {
      handler(state);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send('ping');
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.config.maxReconnectDelay
    );

    this.reconnectAttempts++;
    this.setState('reconnecting');

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(message);
      }
    }
  }
}
