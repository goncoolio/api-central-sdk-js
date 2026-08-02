import type { WebSocketClient } from '../utils/ws-client';

// =============================================================================
// Stream Manager - Real-time live streaming viewer experience
// =============================================================================

export interface StreamEventData {
  streamId: string;
  [key: string]: unknown;
}

export interface StreamCommentEvent {
  streamId: string;
  commentId: string;
  userId: string;
  userName?: string;
  content: string;
}

export interface StreamReactionEvent {
  streamId: string;
  emoji: string;
  count: number;
}

export interface StreamViewerEvent {
  streamId: string;
  userId: string;
  userName?: string;
}

export interface StreamStartedEvent {
  streamId: string;
  hostId: string;
  hostName?: string;
  title: string;
}

type StreamStartedHandler = (data: StreamStartedEvent) => void;
type StreamEndedHandler = (data: { streamId: string }) => void;
type StreamPausedHandler = (data: { streamId: string }) => void;
type ViewerJoinedHandler = (data: StreamViewerEvent) => void;
type ViewerLeftHandler = (data: StreamViewerEvent) => void;
type ViewerCountHandler = (data: { streamId: string; count: number }) => void;
type CommentNewHandler = (data: StreamCommentEvent) => void;
type ReactionBurstHandler = (data: StreamReactionEvent) => void;
type StreamJoinedHandler = (data: { streamId: string; viewerCount: number }) => void;

export class StreamManager {
  private ws: WebSocketClient | null = null;
  private joinedStreams: Set<string> = new Set();
  private wsUnsubs: Array<() => void> = [];

  // Event handlers
  private handlers = {
    onStreamStarted: null as StreamStartedHandler | null,
    onStreamEnded: null as StreamEndedHandler | null,
    onStreamPaused: null as StreamPausedHandler | null,
    onStreamJoined: null as StreamJoinedHandler | null,
    onViewerJoined: null as ViewerJoinedHandler | null,
    onViewerLeft: null as ViewerLeftHandler | null,
    onViewerCount: null as ViewerCountHandler | null,
    onCommentNew: null as CommentNewHandler | null,
    onReactionBurst: null as ReactionBurstHandler | null,
  };

  // ---------------------------------------------------------------------------
  // Event Handlers (setters)
  // ---------------------------------------------------------------------------

  set onStreamStarted(handler: StreamStartedHandler | null) { this.handlers.onStreamStarted = handler; }
  set onStreamEnded(handler: StreamEndedHandler | null) { this.handlers.onStreamEnded = handler; }
  set onStreamPaused(handler: StreamPausedHandler | null) { this.handlers.onStreamPaused = handler; }
  set onStreamJoined(handler: StreamJoinedHandler | null) { this.handlers.onStreamJoined = handler; }
  set onViewerJoined(handler: ViewerJoinedHandler | null) { this.handlers.onViewerJoined = handler; }
  set onViewerLeft(handler: ViewerLeftHandler | null) { this.handlers.onViewerLeft = handler; }
  set onViewerCount(handler: ViewerCountHandler | null) { this.handlers.onViewerCount = handler; }
  set onCommentNew(handler: CommentNewHandler | null) { this.handlers.onCommentNew = handler; }
  set onReactionBurst(handler: ReactionBurstHandler | null) { this.handlers.onReactionBurst = handler; }

  // ---------------------------------------------------------------------------
  // WebSocket Binding
  // ---------------------------------------------------------------------------

  /** Bind to a WebSocket client */
  bindWebSocket(ws: WebSocketClient): void {
    this.unbindWebSocket();
    this.ws = ws;

    this.wsUnsubs.push(
      ws.on('stream_started', (data: any) => {
        this.handlers.onStreamStarted?.(data);
      }),

      ws.on('stream_ended', (data: any) => {
        this.handlers.onStreamEnded?.(data);
        this.joinedStreams.delete(data.streamId);
      }),

      ws.on('stream_paused', (data: any) => {
        this.handlers.onStreamPaused?.(data);
      }),

      ws.on('stream_joined', (data: any) => {
        this.handlers.onStreamJoined?.(data);
      }),

      ws.on('stream_viewer_joined', (data: any) => {
        this.handlers.onViewerJoined?.(data);
      }),

      ws.on('stream_viewer_left', (data: any) => {
        this.handlers.onViewerLeft?.(data);
      }),

      ws.on('stream_viewer_count', (data: any) => {
        this.handlers.onViewerCount?.(data);
      }),

      ws.on('stream_comment_new', (data: any) => {
        this.handlers.onCommentNew?.(data);
      }),

      ws.on('stream_reaction_burst', (data: any) => {
        this.handlers.onReactionBurst?.(data);
      }),
    );

    // Re-join streams on reconnect
    ws.onStateChange((state) => {
      if (state === 'connected' && this.joinedStreams.size > 0) {
        for (const streamId of this.joinedStreams) {
          ws.send('stream_join', { streamId });
        }
      }
    });
  }

  /** Unbind from WebSocket */
  unbindWebSocket(): void {
    for (const unsub of this.wsUnsubs) {
      unsub();
    }
    this.wsUnsubs = [];
    this.ws = null;
  }

  // ---------------------------------------------------------------------------
  // Stream Actions
  // ---------------------------------------------------------------------------

  /** Join a stream as a viewer (receive real-time comments, reactions, etc.) */
  joinStream(streamId: string): void {
    this.joinedStreams.add(streamId);
    this.ws?.send('stream_join', { streamId });
  }

  /** Leave a stream */
  leaveStream(streamId: string): void {
    this.joinedStreams.delete(streamId);
    this.ws?.send('stream_leave', { streamId });
  }

  /** Send a comment in a stream */
  sendComment(streamId: string, content: string): void {
    this.ws?.send('stream_comment', { streamId, content });
  }

  /** Send a reaction in a stream */
  sendReaction(streamId: string, emoji: string): void {
    this.ws?.send('stream_reaction', { streamId, emoji });
  }

  /** Check if currently joined to a stream */
  isJoined(streamId: string): boolean {
    return this.joinedStreams.has(streamId);
  }

  /** Get all joined stream IDs */
  getJoinedStreams(): string[] {
    return Array.from(this.joinedStreams);
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /** Leave all streams and clean up */
  leaveAll(): void {
    for (const streamId of this.joinedStreams) {
      this.ws?.send('stream_leave', { streamId });
    }
    this.joinedStreams.clear();
  }

  /** Destroy the stream manager */
  destroy(): void {
    this.leaveAll();
    this.unbindWebSocket();
    this.handlers = {
      onStreamStarted: null,
      onStreamEnded: null,
      onStreamPaused: null,
      onStreamJoined: null,
      onViewerJoined: null,
      onViewerLeft: null,
      onViewerCount: null,
      onCommentNew: null,
      onReactionBurst: null,
    };
  }
}
