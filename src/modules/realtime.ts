import { WebSocketClient } from '../utils/ws-client';
import type { ConnectionState, WebSocketClientConfig } from '../utils/ws-client';

// =============================================================================
// RealTime Module - High-level API for real-time messaging, presence, typing
// =============================================================================

export interface RealtimeConfig {
  /** WebSocket URL (e.g., 'wss://api.example.com/events') */
  wsUrl: string;
  /** Auto-reconnect (default: true) */
  autoReconnect?: boolean;
  /** Heartbeat interval ms (default: 30000) */
  heartbeatInterval?: number;
}

export interface MessageEvent {
  id: string;
  conversationId: string;
  senderId?: string;
  content: string;
  contentType: string;
  createdAt: string;
  participants?: string[];
}

export interface TypingEvent {
  conversationId: string;
  userIds: string[];
}

export interface PresenceEvent {
  userId: string;
  status: string;
  timestamp?: string;
}

export interface NotificationEvent {
  id: string;
  notificationType: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

/** Read receipt broadcast to a conversation room. */
export interface MessageReadEvent {
  conversationId: string;
  userId: string;
  lastReadMessageId: string;
  readAt: string;
}

/** Delivery receipt broadcast to a conversation room. */
export interface MessageDeliveredEvent {
  conversationId: string;
  userId: string;
  messageIds: string[];
  deliveredAt: string;
}

/** Statut d'un utilisateur dans l'événement `presence_status`. */
export interface PresenceStatusItem {
  userId: string;
  /** `online` ou `offline` : l'API ne produit pas d'autre statut. */
  status: string;
}

/**
 * Réponse à `subscribePresence` : le statut courant de chaque utilisateur
 * demandé (événement `presence_status`).
 */
export interface PresenceStatusEvent {
  statuses: PresenceStatusItem[];
}

export class RealtimeModule {
  private ws: WebSocketClient | null = null;
  private config: RealtimeConfig;
  private joinedConversations: Set<string> = new Set();

  constructor(config: RealtimeConfig) {
    this.config = config;
  }

  /** Get the underlying WebSocket client (for advanced usage) */
  get client(): WebSocketClient | null {
    return this.ws;
  }

  /** Current connection state */
  get state(): ConnectionState {
    return this.ws?.state ?? 'disconnected';
  }

  get connected(): boolean {
    return this.ws?.connected ?? false;
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  /** Connect to the real-time server */
  connect(token: string): void {
    if (this.ws) {
      this.ws.disconnect();
    }

    const wsConfig: WebSocketClientConfig = {
      url: this.config.wsUrl,
      token,
      autoReconnect: this.config.autoReconnect ?? true,
      heartbeatInterval: this.config.heartbeatInterval ?? 30000,
    };

    this.ws = new WebSocketClient(wsConfig);

    // Re-join conversations on reconnect
    this.ws.onStateChange((state) => {
      if (state === 'connected' && this.joinedConversations.size > 0) {
        for (const convId of this.joinedConversations) {
          this.ws!.send('conversation_join', { conversationId: convId });
        }
      }
    });

    this.ws.connect();
  }

  /** Disconnect from the real-time server */
  disconnect(): void {
    this.joinedConversations.clear();
    if (this.ws) {
      this.ws.disconnect();
      this.ws = null;
    }
  }

  /** Update auth token */
  updateToken(token: string): void {
    this.ws?.updateToken(token);
  }

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  /** Join a conversation room to receive messages */
  joinConversation(conversationId: string): void {
    this.joinedConversations.add(conversationId);
    this.ws?.send('conversation_join', { conversationId });
  }

  /** Leave a conversation room */
  leaveConversation(conversationId: string): void {
    this.joinedConversations.delete(conversationId);
    this.ws?.send('conversation_leave', { conversationId });
  }

  // ---------------------------------------------------------------------------
  // Typing
  // ---------------------------------------------------------------------------

  /** Signal that user started typing */
  startTyping(conversationId: string): void {
    this.ws?.send('typing_start', { conversationId });
  }

  /** Signal that user stopped typing */
  stopTyping(conversationId: string): void {
    this.ws?.send('typing_stop', { conversationId });
  }

  /**
   * Acknowledge that these messages reached this client
   *
   * Triggers a `message_delivered` broadcast so senders can render the single
   * check. Call it as soon as a `message_new` is handled — the server cannot
   * know a client received a message unless it says so.
   */
  acknowledgeDelivery(conversationId: string, messageIds: string[]): void {
    this.ws?.send('message_delivered', { conversationId, messageIds });
  }

  // ---------------------------------------------------------------------------
  // Presence
  // ---------------------------------------------------------------------------

  /** Subscribe to presence updates for specific users */
  subscribePresence(userIds: string[]): void {
    this.ws?.send('presence_subscribe', { userIds });
  }

  // ---------------------------------------------------------------------------
  // Event Listeners
  // ---------------------------------------------------------------------------

  /** Listen for connection state changes */
  onStateChange(handler: (state: ConnectionState) => void): () => void {
    return this.ws?.onStateChange(handler) ?? (() => {});
  }

  /** Listen for connected event */
  onConnected(handler: (data: { socketId: string; application: { id: string; slug: string }; user?: { id: string; externalId: string; displayName?: string } }) => void): () => void {
    return this.ws?.on('connected', handler as any) ?? (() => {});
  }

  /** Listen for conversation joined confirmation */
  onConversationJoined(handler: (data: { conversationId: string; success: boolean }) => void): () => void {
    return this.ws?.on('conversation_joined', handler as any) ?? (() => {});
  }

  /** Listen for conversation left confirmation */
  onConversationLeft(handler: (data: { conversationId: string }) => void): () => void {
    return this.ws?.on('conversation_left', handler as any) ?? (() => {});
  }

  /** Listen for new messages */
  onMessageNew(handler: (data: MessageEvent) => void): () => void {
    return this.ws?.on('message_new', handler as any) ?? (() => {});
  }

  /** Listen for updated messages */
  onMessageUpdated(handler: (data: MessageEvent) => void): () => void {
    return this.ws?.on('message_updated', handler as any) ?? (() => {});
  }

  /** Listen for deleted messages */
  onMessageDeleted(handler: (data: { id: string; conversationId: string }) => void): () => void {
    return this.ws?.on('message_deleted', handler as any) ?? (() => {});
  }

  /**
   * Listen for read receipts
   *
   * Emitted when a participant marks a conversation as read, so senders can
   * switch their delivery indicator from single to double check.
   */
  onMessageRead(handler: (data: MessageReadEvent) => void): () => void {
    return this.ws?.on('message_read', handler as any) ?? (() => {});
  }

  /**
   * Listen for delivery receipts
   *
   * Emitted once a recipient's client acknowledges the messages. This is the
   * single check; `onMessageRead` turns it into a double check.
   */
  onMessageDelivered(handler: (data: MessageDeliveredEvent) => void): () => void {
    return this.ws?.on('message_delivered', handler as any) ?? (() => {});
  }

  /** Listen for message reactions */
  onMessageReactionAdded(handler: (data: { messageId: string; conversationId: string; userId: string; emoji: string }) => void): () => void {
    return this.ws?.on('message_reaction_added', handler as any) ?? (() => {});
  }

  /** Listen for message reaction removals */
  onMessageReactionRemoved(handler: (data: { messageId: string; conversationId: string; userId: string; emoji: string }) => void): () => void {
    return this.ws?.on('message_reaction_removed', handler as any) ?? (() => {});
  }

  /** Listen for typing indicator updates */
  onTypingUpdate(handler: (data: TypingEvent) => void): () => void {
    return this.ws?.on('typing_update', handler as any) ?? (() => {});
  }

  /** Listen for presence changes */
  onPresenceUpdate(handler: (data: PresenceEvent) => void): () => void {
    return this.ws?.on('presence_update', handler as any) ?? (() => {});
  }

  /**
   * Listen for presence status responses
   *
   * Répond à `subscribePresence` avec le statut courant de chaque utilisateur
   * demandé.
   */
  onPresenceStatus(handler: (data: PresenceStatusEvent) => void): () => void {
    return (
      this.ws?.on('presence_status', (data) => {
        // Avant son correctif, l'API sérialisait cet événement sans sa liste.
        const statuses = Array.isArray(data.statuses) ? (data.statuses as PresenceStatusItem[]) : [];
        handler({ statuses });
      }) ?? (() => {})
    );
  }

  /** Listen for new notifications */
  onNotificationNew(handler: (data: NotificationEvent) => void): () => void {
    return this.ws?.on('notification_new', handler as any) ?? (() => {});
  }

  /** Listen for notifications marked as read on another device */
  onNotificationRead(handler: (data: { notificationIds: string[] }) => void): () => void {
    return this.ws?.on('notification_read', handler as any) ?? (() => {});
  }

  /** Listen for "mark all as read" performed on another device */
  onNotificationAllRead(handler: () => void): () => void {
    return this.ws?.on('notification_all_read', handler as any) ?? (() => {});
  }

  /** Listen for any event (wildcard) */
  onAny(handler: (data: Record<string, unknown>) => void): () => void {
    return this.ws?.on('*', handler) ?? (() => {});
  }

  /** Listen for errors */
  onError(handler: (data: { code: string; message: string }) => void): () => void {
    return this.ws?.on('error', handler as any) ?? (() => {});
  }
}
