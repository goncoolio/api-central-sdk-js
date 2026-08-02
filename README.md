# API Central SDK for JavaScript/TypeScript

Official JavaScript/TypeScript SDK for API Central - a unified backend service for messaging, notifications, support, live streaming, calls, and E2E encryption.

## Installation

```bash
npm install @api-central/sdk
```

## Quick Start

```typescript
import { ApiCentral } from '@api-central/sdk';

// Initialize with API credentials
const sdk = new ApiCentral({
  baseUrl: 'https://api.example.com/s2s/v1',
  apiKey: 'your-api-key',
  apiSecret: 'your-api-secret',
  applicationId: 'your-app-uuid'
});

// Authenticate (obtains and stores JWT token)
await sdk.authenticate();

// Use the SDK
const user = await sdk.users.create({
  externalUserId: 'user-123',
  displayName: 'John Doe',
  email: 'john@example.com'
});
```

## Configuration Options

```typescript
interface ApiCentralConfig {
  baseUrl: string;          // API server URL
  apiKey?: string;          // API key for authentication
  apiSecret?: string;       // API secret for authentication
  token?: string;           // Pre-authenticated JWT token
  applicationId?: string;   // Application ID header
  timeout?: number;         // Request timeout in ms (default: 30000)
}
```

## Modules

### Auth

Authentication and token management.

```typescript
// Get application token
const { token } = await sdk.auth.getToken({
  apiKey: 'your-api-key',
  apiSecret: 'your-api-secret'
});

// Get user token for WebSocket connections
const { socketToken, user } = await sdk.auth.getUserToken({
  userId: 'user-uuid'
});
```

### Users

User management, devices, and presence.

```typescript
// Create/update user
const user = await sdk.users.create({
  externalUserId: 'ext-123',
  displayName: 'John Doe',
  email: 'john@example.com'
});

// Get user
const user = await sdk.users.get('user-uuid');
const userByExternal = await sdk.users.getByExternalId('ext-123');

// List users
const { data, total } = await sdk.users.list({ page: 1, limit: 20 });

// Register device for push notifications
const device = await sdk.users.registerDevice('user-uuid', {
  deviceToken: 'fcm-token-xxx',
  platform: 'android',
  deviceInfo: { model: 'Pixel 7' }
});

// Update presence
await sdk.users.updatePresence('user-uuid', { status: 'online' });
```

### Messaging

Conversations, messages, reactions, and typing indicators.

```typescript
// Create conversation
const dm = await sdk.messaging.createConversation({
  conversationType: 'direct',
  participantIds: ['user-1', 'user-2']
});

const group = await sdk.messaging.createConversation({
  conversationType: 'group',
  participantIds: ['user-1', 'user-2', 'user-3'],
  name: 'Project Team'
});

// Send messages
const message = await sdk.messaging.sendMessage('conv-uuid', {
  senderId: 'user-uuid',
  content: 'Hello world!'
});

// Send audio message
const audioMessage = await sdk.messaging.sendMessage('conv-uuid', {
  senderId: 'user-uuid',
  content: 'Voice message',
  contentType: 'audio',
  attachments: [{
    url: 'https://storage.example.com/audio.mp3',
    mimeType: 'audio/mpeg',
    name: 'voice-note.mp3',
    size: 125000
  }]
});

// List messages (cursor-based pagination)
const { data, nextCursor, hasMore } = await sdk.messaging.listMessages('conv-uuid', {
  limit: 50
});

// Reactions
await sdk.messaging.addReaction('message-uuid', {
  userId: 'user-uuid',
  emoji: '👍'
});

// Typing indicators
await sdk.messaging.sendTyping('conv-uuid', { userId: 'user-uuid' });

// Read receipts
await sdk.messaging.markAsRead('conv-uuid', {
  userId: 'user-uuid',
  messageId: 'last-read-message-uuid'
});
```

### Notifications

Push and in-app notifications.

`notificationType`, `title` and `body` are required (1-100, 1-255 and 1-1000
characters). Any string is accepted as a type, so namespaced values such as
`'news:meteo'` are valid.

```typescript
// Send notification
const notification = await sdk.notifications.send({
  userId: 'user-uuid',
  notificationType: 'message',
  title: 'New Message',
  body: 'You have a new message from John',
  data: { conversationId: 'conv-uuid' }
});

// Bulk send
const { sentCount } = await sdk.notifications.sendBulk({
  userIds: ['user-1', 'user-2', 'user-3'],
  notificationType: 'system',
  title: 'Announcement',
  body: 'Important system update'
});

// Broadcast to every user of the application
const { totalUsers } = await sdk.notifications.broadcast({
  notificationType: 'news:meteo',
  title: 'Alerte Météo',
  body: 'Pluies intenses prévues',
  channels: ['push', 'in_app']
});

// Send from a server-side template
await sdk.notifications.sendTemplate({
  userId: 'user-uuid',
  templateSlug: 'new_message',
  variables: { sender: 'John', preview: 'Hey there' }
});

// List, count and mark as read
const { data } = await sdk.notifications.list('user-uuid', { unreadOnly: true });
const { count } = await sdk.notifications.getUnreadCount('user-uuid');
await sdk.notifications.markAsRead({ notificationIds: ['notif-1', 'notif-2'] });
await sdk.notifications.markAllAsRead('user-uuid');
```

> Templates are managed server-side. The SDK can send from an existing
> template slug but cannot create, update or delete templates.

### Support

Support tickets and knowledge base.

```typescript
// Create ticket
const ticket = await sdk.support.createTicket({
  userId: 'user-uuid',
  subject: 'Cannot access my account',
  description: 'I forgot my password and cannot reset it',
  category: 'account',
  priority: 'high'
});

// List tickets
const { data } = await sdk.support.listTickets({
  status: 'open',
  page: 1
});

// Close ticket
await sdk.support.closeTicket('ticket-uuid', {
  resolution: 'Issue resolved by resetting password'
});

// Knowledge base
const article = await sdk.support.createArticle({
  title: 'How to reset your password',
  content: '# Password Reset\n\n1. Click on forgot password...',
  category: 'account',
  tags: ['password', 'account', 'security']
});

const results = await sdk.support.listArticles({
  search: 'password reset',
  category: 'account'
});
```

### Live Streaming

TikTok-style live broadcasts.

```typescript
// Create stream
const stream = await sdk.live.createStream({
  hostId: 'user-uuid',
  title: 'My First Live Stream',
  description: 'Join me for some fun!',
  scheduledAt: new Date('2024-12-01T18:00:00Z').toISOString()
});

// Start/end stream
await sdk.live.startStream('stream-uuid');
await sdk.live.endStream('stream-uuid');

// Comments
const comment = await sdk.live.postComment('stream-uuid', {
  userId: 'user-uuid',
  content: 'Great stream!'
});

// Reactions
await sdk.live.sendReaction('stream-uuid', {
  userId: 'user-uuid',
  emoji: '❤️'
});

// Join / leave as a viewer
await sdk.live.joinStream('stream-uuid', { userId: 'user-uuid' });
await sdk.live.leaveStream('stream-uuid', { userId: 'user-uuid' });

// Get viewer count
const { viewerCount } = await sdk.live.getViewerCount('stream-uuid');

// Get stats
const stats = await sdk.live.getStats('stream-uuid');
```

### Calls

Audio/video calls with WebRTC signaling.

```typescript
// Initiate call
const call = await sdk.calls.initiate({
  initiatorId: 'user-uuid',
  participantIds: ['other-user-uuid'],
  callType: 'video'
});

// Answer/decline
await sdk.calls.answer('call-uuid', { userId: 'user-uuid' });
await sdk.calls.decline('call-uuid', { userId: 'user-uuid' });

// End call
await sdk.calls.end('call-uuid', { userId: 'user-uuid' });

// Media controls
await sdk.calls.setMuted('call-uuid', 'user-uuid', { muted: true });
await sdk.calls.setVideoEnabled('call-uuid', 'user-uuid', { enabled: false });
await sdk.calls.setScreenSharing('call-uuid', 'user-uuid', { sharing: true });

// Call history of the authenticated user (pagination only)
const { calls, total, hasMore } = await sdk.calls.listHistory({ page: 1, limit: 20 });
```

### Encryption

E2E encryption key management (Signal Protocol).

```typescript
// Register keys (on user setup)
await sdk.encryption.registerKeys({
  userId: 'user-uuid',
  identityKey: 'base64-encoded-identity-public-key',
  signedPrekey: {
    keyId: 1,
    publicKey: 'base64-encoded-signed-prekey',
    signature: 'base64-encoded-signature'
  },
  prekeys: [
    { keyId: 1, publicKey: 'base64-prekey-1' },
    { keyId: 2, publicKey: 'base64-prekey-2' },
    // ... up to 100 prekeys recommended
  ]
});

// Get recipient's PreKey bundle for session establishment
const bundle = await sdk.encryption.getPreKeyBundle('recipient-uuid');

// Check prekey count and replenish (user taken from the token)
const { availablePrekeys } = await sdk.encryption.getPrekeysCount();
if (availablePrekeys < 25) {
  await sdk.encryption.uploadPrekeys({
    userId: 'user-uuid',
    prekeys: [/* new prekeys */]
  });
}

// Rotate signed prekey periodically
await sdk.encryption.rotateSignedPrekey({
  userId: 'user-uuid',
  signedPrekey: {
    keyId: 2,
    publicKey: 'base64-new-signed-prekey',
    signature: 'base64-new-signature'
  }
});
```

### Realtime

WebSocket events for messaging, typing, presence and notifications.

```typescript
sdk.connectRealtime(socketToken, { wsUrl: 'wss://api.example.com/events' });

const realtime = sdk.realtime!;
realtime.joinConversation('conv-uuid');

realtime.onMessageNew((msg) => console.log(msg.content));
realtime.onTypingUpdate(({ conversationId, userIds }) => { /* ... */ });
realtime.onPresenceUpdate(({ userId, status }) => { /* ... */ });

// Read receipts — switch the delivery indicator from single to double check
realtime.onMessageRead(({ conversationId, userId, lastReadMessageId, readAt }) => {
  markDelivered(conversationId, userId, lastReadMessageId);
});

// Notifications read elsewhere (another device)
realtime.onNotificationRead(({ notificationIds }) => { /* ... */ });
realtime.onNotificationAllRead(() => { /* ... */ });
```

Audio/video call events and live-stream events are handled by the dedicated
`CallManager` and `StreamManager` helpers rather than by `realtime`.

## Error Handling

```typescript
import { ApiCentralError } from '@api-central/sdk';

try {
  await sdk.users.get('invalid-uuid');
} catch (error) {
  if (error instanceof ApiCentralError) {
    console.error('API Error:', error.message);
    console.error('Status Code:', error.statusCode);
    console.error('Error Type:', error.error);
    console.error('Details:', error.details);
  }
}
```

## TypeScript Support

The SDK is written in TypeScript and includes full type definitions:

```typescript
import type {
  User,
  Conversation,
  Message,
  CreateUserRequest,
  SendMessageRequest,
  // ... all types exported
} from '@api-central/sdk';
```

## License

MIT
