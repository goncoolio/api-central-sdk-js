// =============================================================================
// API Central SDK - TypeScript Types
// =============================================================================

// -----------------------------------------------------------------------------
// Common Types
// -----------------------------------------------------------------------------

export interface PaginationQuery {
  page?: number;
  limit?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CursorQuery {
  cursor?: string;
  limit?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface CursorResponse<T> {
  data: T[];
  nextCursor?: string;
  hasMore: boolean;
}

// -----------------------------------------------------------------------------
// Auth Types
// -----------------------------------------------------------------------------

export interface AuthTokenRequest {
  apiKey: string;
  apiSecret: string;
}

export interface AuthTokenResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
  application?: {
    id: string;
    name: string;
    slug: string;
  };
}

export interface UserTokenRequest {
  userId: string;
  externalUserId?: string;
}

export interface UserTokenResponse {
  socketToken: string;
  expiresIn: number;
  user: {
    id: string;
    externalUserId: string;
    displayName?: string;
    avatarUrl?: string;
  };
}

// -----------------------------------------------------------------------------
// User Types
// -----------------------------------------------------------------------------

export interface User {
  id: string;
  applicationId: string;
  externalUserId: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserInfo {
  id: string;
  externalUserId: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface CreateUserRequest {
  externalUserId: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateUserRequest {
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

export type DevicePlatform = 'ios' | 'android' | 'web';

export interface RegisterDeviceRequest {
  deviceToken: string;
  platform: DevicePlatform;
  deviceInfo?: Record<string, unknown>;
}

export interface UserDevice {
  id: string;
  userId: string;
  deviceToken: string;
  platform: DevicePlatform;
  deviceInfo?: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';

export interface UpdatePresenceRequest {
  status: PresenceStatus;
}

export interface PresenceResponse {
  userId: string;
  status: PresenceStatus;
  lastSeenAt?: string;
}

// -----------------------------------------------------------------------------
// Messaging Types
// -----------------------------------------------------------------------------

export type ConversationType = 'direct' | 'group' | 'channel';
export type ContentType = 'text' | 'image' | 'file' | 'audio' | 'video' | 'location' | 'system';
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';
export type ParticipantRole = 'owner' | 'admin' | 'member';

export interface CreateConversationRequest {
  conversationType: ConversationType;
  participantIds: string[];
  name?: string;
  description?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateConversationRequest {
  name?: string;
  description?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  applicationId: string;
  type: ConversationType;
  title?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
  lastMessageAt?: string;
  createdAt: string;
}

export interface ConversationResponse extends Conversation {
  participants: ParticipantInfo[];
  unreadCount?: number;
}

export interface ParticipantInfo {
  id: string;
  user: UserInfo;
  role: ParticipantRole;
  joinedAt: string;
  lastReadAt?: string;
}

export interface ConversationParticipant {
  id: string;
  conversationId: string;
  userId: string;
  role: ParticipantRole;
  isMuted: boolean;
  mutedUntil?: string;
  joinedAt: string;
  lastReadAt?: string;
}

export interface AddParticipantRequest {
  userId: string;
  role?: ParticipantRole;
}

export interface Attachment {
  url: string;
  mimeType: string;
  name?: string;
  size?: number;
}

export interface SendMessageRequest {
  senderId: string;
  clientMessageId?: string;
  content: string;
  contentType?: ContentType;
  attachments?: Attachment[];
  replyToId?: string;
  mentions?: string[];
  metadata?: Record<string, unknown>;
}

export interface EditMessageRequest {
  content: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId?: string;
  clientMessageId?: string;
  content: string;
  contentType: ContentType;
  attachments?: Attachment[];
  replyToId?: string;
  mentions?: string[];
  metadata?: Record<string, unknown>;
  status: MessageStatus;
  isEdited: boolean;
  editedAt?: string;
  deletedAt?: string;
  createdAt: string;
}

export interface MessageResponse {
  id: string;
  conversationId: string;
  clientMessageId?: string;
  sender?: UserInfo;
  content: string;
  contentType: ContentType;
  attachments?: Attachment[];
  replyTo?: MessageResponse;
  reactions: ReactionResponse[];
  isEdited: boolean;
  editedAt?: string;
  isDeleted: boolean;
  createdAt: string;
}

export interface ReactionResponse {
  emoji: string;
  userId: string;
  userName?: string;
}

export interface AddReactionRequest {
  userId: string;
  emoji: string;
}

export interface TypingRequest {
  userId: string;
}

export interface MarkReadRequest {
  userId: string;
  messageId?: string;
}

// -----------------------------------------------------------------------------
// Notification Types
// -----------------------------------------------------------------------------

export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'message' | 'system';

export interface SendNotificationRequest {
  userId: string;
  title: string;
  body: string;
  notificationType?: NotificationType;
  channels?: string[];
  data?: Record<string, unknown>;
}

export interface SendBulkNotificationRequest {
  userIds: string[];
  title: string;
  body: string;
  notificationType?: NotificationType;
  channels?: string[];
  data?: Record<string, unknown>;
}

export interface SendTemplatedNotificationRequest {
  userId: string;
  templateSlug: string;
  variables?: Record<string, string>;
  channels?: string[];
  data?: Record<string, unknown>;
}

export interface MarkNotificationsReadRequest {
  notificationIds: string[];
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  notificationType: NotificationType;
  isRead: boolean;
  readAt?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface NotificationResponse extends Notification {}

// Notification Templates
export interface NotificationTemplate {
  id: string;
  applicationId: string;
  name: string;
  slug: string;
  title: string;
  body: string;
  defaultChannels?: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateRequest {
  name: string;
  slug?: string;
  title: string;
  body: string;
  defaultChannels?: string[];
}

export interface UpdateTemplateRequest {
  name?: string;
  title?: string;
  body?: string;
  defaultChannels?: string[];
  isActive?: boolean;
}

// Alias for compatibility
export type CreateNotificationRequest = SendNotificationRequest;

// -----------------------------------------------------------------------------
// Support Types
// -----------------------------------------------------------------------------

export type TicketStatus = 'open' | 'pending' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type ContentFormat = 'markdown' | 'html' | 'plain';

export interface CreateTicketRequest {
  userId: string;
  subject: string;
  description?: string;
  categoryId?: string;
  priority?: TicketPriority;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateTicketRequest {
  subject?: string;
  description?: string;
  categoryId?: string;
  priority?: TicketPriority;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface AssignTicketRequest {
  assignedToId?: string;
}

export interface ChangeStatusRequest {
  status: TicketStatus;
  note?: string;
}

export interface CategoryInfo {
  id: string;
  name: string;
  slug: string;
}

export interface TicketResponse {
  id: string;
  ticketNumber: string;
  conversationId?: string;
  category?: CategoryInfo;
  user: UserInfo;
  assignedTo?: UserInfo;
  subject: string;
  description?: string;
  status: TicketStatus;
  priority: TicketPriority;
  tags?: string[];
  firstResponseAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryRequest {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  parentId?: string;
  sortOrder?: number;
}

export interface SupportCategory {
  id: string;
  applicationId: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  parentId?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

export interface CreateArticleRequest {
  title: string;
  slug: string;
  content: string;
  contentFormat?: ContentFormat;
  categoryId?: string;
  tags?: string[];
  isPublished?: boolean;
  createdById?: string;
}

export interface UpdateArticleRequest {
  title?: string;
  slug?: string;
  content?: string;
  contentFormat?: ContentFormat;
  categoryId?: string;
  tags?: string[];
  isPublished?: boolean;
}

export interface RateArticleRequest {
  helpful: boolean;
}

export interface KnowledgeBaseArticle {
  id: string;
  applicationId: string;
  title: string;
  slug: string;
  content: string;
  contentFormat: ContentFormat;
  categoryId?: string;
  tags?: string[];
  isPublished: boolean;
  viewCount: number;
  helpfulCount: number;
  notHelpfulCount: number;
  createdById?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type SenderType = 'admin' | 'user' | 'system';

export interface CreateTicketReplyRequest {
  senderId: string;
  content: string;
}

export interface TicketReplyResponse {
  id: string;
  ticketId: string;
  senderId: string;
  senderType: SenderType;
  senderName?: string;
  content: string;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// Live Streaming Types
// -----------------------------------------------------------------------------

export type StreamStatus = 'scheduled' | 'live' | 'paused' | 'ended' | 'archived';

export interface CreateStreamRequest {
  hostId: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  scheduledAt?: string;
  settings?: Record<string, unknown>;
}

export interface UpdateStreamRequest {
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  settings?: Record<string, unknown>;
}

export interface LiveStreamResponse {
  id: string;
  host: UserInfo;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  status: StreamStatus;
  streamKey?: string;
  rtmpUrl?: string;
  playbackUrl?: string;
  viewerCount: number;
  peakViewerCount: number;
  totalReactions: number;
  totalComments: number;
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
}

export interface StreamCommentRequest {
  userId: string;
  content: string;
}

export interface StreamCommentInfo {
  id: string;
  streamId: string;
  user: UserInfo;
  content: string;
  isPinned: boolean;
  isHighlighted: boolean;
  createdAt: string;
}

export interface StreamReactionRequest {
  userId: string;
  emoji: string;
}

export interface ReactionCount {
  emoji: string;
  count: number;
}

export interface StreamViewersResponse {
  streamId: string;
  viewerCount: number;
  viewers: UserInfo[];
}

export interface StreamStats {
  streamId: string;
  viewerCount: number;
  peakViewerCount: number;
  totalReactions: number;
  totalComments: number;
  durationSeconds?: number;
}

// -----------------------------------------------------------------------------
// Calls Types
// -----------------------------------------------------------------------------

export type CallType = 'audio' | 'video' | 'screen_share';
export type CallStatus = 'initiating' | 'ringing' | 'connected' | 'on_hold' | 'ended' | 'failed';
export type ParticipantCallStatus = 'invited' | 'ringing' | 'joined' | 'on_hold' | 'left' | 'declined' | 'missed';

export interface InitiateCallRequest {
  participantIds: string[];
  callType: CallType;
  conversationId?: string;
  encryptionEnabled?: boolean;
}

export interface AddCallParticipantRequest {
  userId: string;
}

export interface MuteRequest {
  muted: boolean;
}

export interface VideoToggleRequest {
  enabled: boolean;
}

export interface SdpRequest {
  toUserId: string;
  sdp: string;
}

export interface IceCandidateRequest {
  toUserId: string;
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}

export interface CallParticipantInfo {
  id: string;
  user: UserInfo;
  status: ParticipantCallStatus;
  role: ParticipantRole;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  joinedAt?: string;
}

export interface CallResponse {
  id: string;
  conversationId?: string;
  initiator: UserInfo;
  callType: CallType;
  status: CallStatus;
  participants: CallParticipantInfo[];
  participantCount: number;
  durationSeconds?: number;
  encryptionEnabled: boolean;
  startedAt?: string;
  connectedAt?: string;
  endedAt?: string;
  createdAt: string;
}

export interface CallHistoryEntry {
  call: CallResponse;
  otherParticipants: UserInfo[];
  yourStatus: ParticipantCallStatus;
}

export interface CallHistoryResponse {
  calls: CallHistoryEntry[];
  total: number;
  hasMore: boolean;
}

// -----------------------------------------------------------------------------
// Encryption Types (Signal Protocol)
// -----------------------------------------------------------------------------

export interface PreKeyUpload {
  prekeyId: number;
  prekey: string; // Base64-encoded
}

export interface RegisterKeysRequest {
  identityKey: string; // Base64-encoded
  signedPrekeyId: number;
  signedPrekey: string; // Base64-encoded
  signedPrekeySignature: string; // Base64-encoded
  prekeys: PreKeyUpload[];
}

export interface RotateSignedPrekeyRequest {
  signedPrekeyId: number;
  signedPrekey: string; // Base64-encoded
  signedPrekeySignature: string; // Base64-encoded
}

export interface UploadPrekeysRequest {
  prekeys: PreKeyUpload[];
}

export interface PreKeyInfo {
  prekeyId: number;
  prekey: string; // Base64-encoded
}

export interface PreKeyBundle {
  userId: string;
  identityKey: string;
  signedPrekeyId: number;
  signedPrekey: string;
  signedPrekeySignature: string;
  prekey?: PreKeyInfo;
}

export interface PreKeyCountResponse {
  userId: string;
  availablePrekeys: number;
}

// -----------------------------------------------------------------------------
// Admin Types
// -----------------------------------------------------------------------------

export interface CreateApplicationRequest {
  name: string;
  slug: string;
  description?: string;
  settings?: Record<string, unknown>;
}

export interface UpdateApplicationRequest {
  name?: string;
  description?: string;
  settings?: Record<string, unknown>;
}

export interface SetActiveRequest {
  isActive: boolean;
}

export interface ApplicationResponse {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isActive: boolean;
  settings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationWithSecretResponse extends ApplicationResponse {
  apiKey: string;
  apiSecret: string;
}

export interface ApplicationStatsResponse {
  applicationId: string;
  userCount: number;
  conversationCount: number;
  messageCount: number;
  notificationCount: number;
  ticketCount: number;
}

// -----------------------------------------------------------------------------
// WebRTC / ICE Server Types
// -----------------------------------------------------------------------------

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceServersResponse {
  iceServers: IceServer[];
}

// -----------------------------------------------------------------------------
// Error Types
// -----------------------------------------------------------------------------

export interface ApiError {
  message: string;
  statusCode: number;
  error?: string;
  details?: Record<string, unknown>;
}
