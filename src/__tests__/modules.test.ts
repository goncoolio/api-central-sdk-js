import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiCentral } from '../index';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ApiCentral SDK', () => {
  let sdk: ApiCentral;

  beforeEach(() => {
    vi.clearAllMocks();
    sdk = new ApiCentral({
      baseUrl: 'https://api.example.com/s2s/v1',
      token: 'test-token',
      applicationId: 'test-app-id',
    });
  });

  // Helper to mock successful responses
  const mockResponse = (data: unknown) => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(data)),
    });
  };

  describe('Auth Module', () => {
    it('should get application token', async () => {
      // The API returns snake_case; the client converts it to camelCase.
      mockResponse({
        access_token: 'jwt-token',
        expires_in: 3600,
        token_type: 'Bearer',
      });

      const result = await sdk.auth.getToken({
        apiKey: 'api-key',
        apiSecret: 'api-secret',
      });

      expect(result.accessToken).toBe('jwt-token');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/auth/token',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ api_key: 'api-key', api_secret: 'api-secret' }),
        })
      );
    });

    it('should get user token', async () => {
      // Réponse réelle de l'API (UserTokenResponse, src/types/dto.rs)
      mockResponse({
        socket_token: 'user-jwt-token',
        expires_in: 86400,
        user: { id: 'user-123', external_user_id: 'ext-123', display_name: 'Jane' },
      });

      const result = await sdk.auth.getUserToken({ userId: 'user-123' });

      expect(result).toEqual({
        socketToken: 'user-jwt-token',
        expiresIn: 86400,
        user: { id: 'user-123', externalUserId: 'ext-123', displayName: 'Jane' },
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/auth/user-token',
        expect.objectContaining({ method: 'POST' })
      );
    });

  });

  describe('Users Module', () => {
    it('should create a user', async () => {
      const user = {
        id: 'user-uuid',
        applicationId: 'test-app-id',
        externalUserId: 'ext-123',
        displayName: 'John Doe',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      mockResponse(user);

      const result = await sdk.users.create({
        externalUserId: 'ext-123',
        displayName: 'John Doe',
      });

      expect(result).toEqual(user);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/users',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should list users with pagination', async () => {
      const response = {
        data: [{ id: 'user-1' }, { id: 'user-2' }],
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
        hasMore: false,
      };
      mockResponse(response);

      const result = await sdk.users.list({ page: 1, limit: 20 });

      expect(result).toEqual(response);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/users?page=1&limit=20',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should get user by ID', async () => {
      const user = { id: 'user-uuid', displayName: 'John' };
      mockResponse(user);

      const result = await sdk.users.get('user-uuid');

      expect(result).toEqual(user);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/users/user-uuid',
        expect.any(Object)
      );
    });

    it('should get user by external ID', async () => {
      const user = { id: 'user-uuid', externalUserId: 'ext-123' };
      mockResponse(user);

      const result = await sdk.users.getByExternalId('ext-123');

      expect(result).toEqual(user);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/users/by-external/ext-123',
        expect.any(Object)
      );
    });

    it('should register device', async () => {
      const device = {
        id: 'device-uuid',
        userId: 'user-uuid',
        deviceToken: 'fcm-token',
        platform: 'android',
      };
      mockResponse(device);

      const result = await sdk.users.registerDevice('user-uuid', {
        deviceToken: 'fcm-token',
        platform: 'android',
      });

      expect(result).toEqual(device);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/users/user-uuid/devices',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should update presence', async () => {
      mockResponse({ status: 'online', lastSeenAt: '2024-01-01T12:00:00Z' });

      const result = await sdk.users.updatePresence('user-uuid', { status: 'online' });

      expect(result.status).toBe('online');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/users/user-uuid/presence',
        expect.objectContaining({ method: 'PUT' })
      );
    });
  });

  describe('Messaging Module', () => {
    it('should create a direct conversation', async () => {
      const conversation = {
        id: 'conv-uuid',
        conversationType: 'direct',
        participants: [],
      };
      mockResponse(conversation);

      const result = await sdk.messaging.createConversation({
        conversationType: 'direct',
        participantIds: ['user-1', 'user-2'],
      });

      expect(result).toEqual(conversation);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/messaging/conversations',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should send a text message', async () => {
      const message = {
        id: 'msg-uuid',
        conversationId: 'conv-uuid',
        senderId: 'user-uuid',
        content: 'Hello!',
        contentType: 'text',
      };
      mockResponse(message);

      const result = await sdk.messaging.sendMessage('conv-uuid', {
        senderId: 'user-uuid',
        content: 'Hello!',
      });

      expect(result).toEqual(message);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/messaging/conversations/conv-uuid/messages',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should send an audio message', async () => {
      const message = {
        id: 'msg-uuid',
        conversationId: 'conv-uuid',
        contentType: 'audio',
        attachments: [{ url: 'https://storage.example.com/audio.mp3' }],
      };
      mockResponse(message);

      const result = await sdk.messaging.sendMessage('conv-uuid', {
        senderId: 'user-uuid',
        content: 'Voice message',
        contentType: 'audio',
        attachments: [{
          url: 'https://storage.example.com/audio.mp3',
          mimeType: 'audio/mpeg',
          name: 'voice.mp3',
          size: 50000,
        }],
      });

      expect(result.contentType).toBe('audio');
    });

    it('should list messages with cursor pagination', async () => {
      const response = {
        data: [{ id: 'msg-1' }, { id: 'msg-2' }],
        nextCursor: 'cursor-123',
        hasMore: true,
      };
      mockResponse(response);

      const result = await sdk.messaging.listMessages('conv-uuid', { limit: 50 });

      expect(result).toEqual(response);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/messaging/conversations/conv-uuid/messages?limit=50',
        expect.any(Object)
      );
    });

    it('should add reaction to message', async () => {
      mockResponse({ success: true });

      const result = await sdk.messaging.addReaction('msg-uuid', {
        userId: 'user-uuid',
        emoji: '👍',
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/messaging/messages/msg-uuid/reactions',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should send typing indicator', async () => {
      mockResponse({ success: true });

      await sdk.messaging.sendTyping('conv-uuid', { userId: 'user-uuid' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/messaging/conversations/conv-uuid/typing',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should mark messages as read', async () => {
      mockResponse({ success: true });

      await sdk.messaging.markAsRead('conv-uuid', {
        userId: 'user-uuid',
        messageId: 'msg-uuid',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/messaging/conversations/conv-uuid/read',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('Notifications Module', () => {
    it('should send a notification', async () => {
      const notification = {
        id: 'notif-uuid',
        type: 'message',
        title: 'Test',
        body: 'Test notification',
      };
      mockResponse(notification);

      const result = await sdk.notifications.send({
        userId: 'user-uuid',
        notificationType: 'message',
        title: 'Test',
        body: 'Test notification',
      });

      expect(result).toEqual(notification);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/notifications/send',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should send a bulk notification', async () => {
      mockResponse({ success: true, sent_count: 3 });

      const result = await sdk.notifications.sendBulk({
        userIds: ['user-1', 'user-2', 'user-3'],
        notificationType: 'system',
        title: 'Announcement',
        body: 'Important system update',
      });

      expect(result.sentCount).toBe(3);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/notifications/send-bulk',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should send a templated notification', async () => {
      mockResponse({ id: 'notif-uuid', type: 'message', title: 'Hi', body: 'Hello' });

      await sdk.notifications.sendTemplate({
        userId: 'user-uuid',
        templateSlug: 'new_message',
        variables: { sender: 'John' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/notifications/send-template',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should list notifications for a user', async () => {
      mockResponse({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });

      await sdk.notifications.list('user-uuid', { unreadOnly: true });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/notifications?user_id=user-uuid&unread_only=true',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should mark notifications as read', async () => {
      mockResponse({ success: true, updated_count: 2 });

      const result = await sdk.notifications.markAsRead({
        notificationIds: ['notif-1', 'notif-2'],
      });

      expect(result.updatedCount).toBe(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/notifications/mark-read',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should mark all notifications as read', async () => {
      mockResponse({ success: true, updated_count: 7 });

      await sdk.notifications.markAllAsRead('user-uuid');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/notifications/mark-all-read?user_id=user-uuid',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should get the unread count', async () => {
      mockResponse({ count: 4 });

      const result = await sdk.notifications.getUnreadCount('user-uuid');

      expect(result.count).toBe(4);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/notifications/unread-count?user_id=user-uuid',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('Support Module', () => {
    it('should create a support ticket', async () => {
      const ticket = {
        id: 'ticket-uuid',
        subject: 'Help needed',
        status: 'open',
      };
      mockResponse(ticket);

      const result = await sdk.support.createTicket({
        userId: 'user-uuid',
        subject: 'Help needed',
        description: 'I need help with...',
      });

      expect(result).toEqual(ticket);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/support/tickets',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should list tickets with filters', async () => {
      const response = {
        data: [{ id: 'ticket-1', status: 'open' }],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasMore: false,
      };
      mockResponse(response);

      const result = await sdk.support.listTickets({ status: 'open', page: 1 });

      expect(result).toEqual(response);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=open'),
        expect.any(Object)
      );
    });

    it('should create knowledge base article', async () => {
      const article = {
        id: 'article-uuid',
        title: 'How to...',
        content: '# Guide\n\nStep 1...',
      };
      mockResponse(article);

      const result = await sdk.support.createArticle({
        title: 'How to...',
        content: '# Guide\n\nStep 1...',
        category: 'guides',
      });

      expect(result).toEqual(article);
    });
  });

  describe('Live Module', () => {
    it('should create a live stream', async () => {
      const stream = {
        id: 'stream-uuid',
        hostId: 'user-uuid',
        title: 'My Stream',
        status: 'scheduled',
      };
      mockResponse(stream);

      const result = await sdk.live.createStream({
        hostId: 'user-uuid',
        title: 'My Stream',
      });

      expect(result).toEqual(stream);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/live/streams',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should start a stream', async () => {
      const stream = { id: 'stream-uuid', status: 'live', streamKey: 'key-123' };
      mockResponse(stream);

      const result = await sdk.live.startStream('stream-uuid');

      expect(result.status).toBe('live');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/live/streams/stream-uuid/start',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should post a comment', async () => {
      const comment = {
        id: 'comment-uuid',
        streamId: 'stream-uuid',
        content: 'Great stream!',
      };
      mockResponse(comment);

      const result = await sdk.live.postComment('stream-uuid', {
        userId: 'user-uuid',
        content: 'Great stream!',
      });

      expect(result).toEqual(comment);
    });

    it('should send a reaction', async () => {
      mockResponse({ success: true });

      const result = await sdk.live.sendReaction('stream-uuid', {
        userId: 'user-uuid',
        emoji: '❤️',
      });

      expect(result.success).toBe(true);
    });

    it('should get viewer count', async () => {
      mockResponse({ stream_id: 'stream-uuid', viewer_count: 150, viewers: [] });

      const result = await sdk.live.getViewerCount('stream-uuid');

      expect(result.viewerCount).toBe(150);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/live/streams/stream-uuid/viewers?limit=1',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should join a stream', async () => {
      mockResponse({ stream_id: 'stream-uuid', viewer_count: 151 });

      const result = await sdk.live.joinStream('stream-uuid', { userId: 'user-uuid' });

      expect(result.viewerCount).toBe(151);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/live/streams/stream-uuid/join',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should get reaction counts', async () => {
      mockResponse([{ emoji: '❤️', count: 150 }]);

      const result = await sdk.live.getReactionCounts('stream-uuid');

      expect(result[0].emoji).toBe('❤️');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/live/streams/stream-uuid/reactions',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('Calls Module', () => {
    it('should initiate a video call', async () => {
      const call = {
        id: 'call-uuid',
        callType: 'video',
        status: 'initiating',
      };
      mockResponse(call);

      const result = await sdk.calls.initiate({
        initiatorId: 'user-uuid',
        participantIds: ['other-user'],
        callType: 'video',
      });

      expect(result).toEqual(call);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/calls',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should answer a call', async () => {
      const call = { id: 'call-uuid', status: 'connected' };
      mockResponse(call);

      const result = await sdk.calls.answer('call-uuid', { userId: 'user-uuid' });

      expect(result.status).toBe('connected');
    });

    it('should set muted status', async () => {
      // Réponse réelle de l'API : { "muted": true }
      mockResponse({ muted: true });

      const result = await sdk.calls.setMuted('call-uuid', 'user-uuid', { muted: true });

      expect(result.muted).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/calls/call-uuid/participants/user-uuid/mute',
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('should get call history', async () => {
      mockResponse({
        calls: [{ call: { id: 'call-1' } }, { call: { id: 'call-2' } }],
        total: 2,
        has_more: false,
      });

      const result = await sdk.calls.listHistory({ page: 1, limit: 20 });

      expect(result.calls).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/calls/history?page=1&limit=20',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('Encryption Module', () => {
    it('should register encryption keys', async () => {
      mockResponse({ success: true });

      const result = await sdk.encryption.registerKeys({
        userId: 'user-uuid',
        identityKey: 'base64-identity-key',
        signedPrekey: {
          keyId: 1,
          publicKey: 'base64-signed-prekey',
          signature: 'base64-signature',
        },
        prekeys: [
          { keyId: 1, publicKey: 'base64-prekey-1' },
          { keyId: 2, publicKey: 'base64-prekey-2' },
        ],
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/encryption/keys/register',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should get prekey bundle', async () => {
      const bundle = {
        identityKey: 'base64-identity-key',
        signedPrekey: {
          keyId: 1,
          publicKey: 'base64-signed-prekey',
          signature: 'base64-signature',
        },
        prekey: { keyId: 1, publicKey: 'base64-prekey' },
      };
      mockResponse(bundle);

      const result = await sdk.encryption.getPreKeyBundle('user-uuid');

      expect(result).toEqual(bundle);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/encryption/keys/user-uuid',
        expect.any(Object)
      );
    });

    it('should get prekeys count', async () => {
      mockResponse({ user_id: 'user-uuid', available_prekeys: 42 });

      const result = await sdk.encryption.getPrekeysCount();

      expect(result.availablePrekeys).toBe(42);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/s2s/v1/encryption/keys/prekeys/count',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should rotate signed prekey', async () => {
      mockResponse({ success: true });

      const result = await sdk.encryption.rotateSignedPrekey({
        userId: 'user-uuid',
        signedPrekey: {
          keyId: 2,
          publicKey: 'base64-new-signed-prekey',
          signature: 'base64-new-signature',
        },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('SDK Configuration', () => {
    it('should authenticate and set token', async () => {
      const sdkWithCreds = new ApiCentral({
        baseUrl: 'https://api.example.com/s2s/v1',
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
      });

      mockResponse({ access_token: 'new-jwt-token', expires_in: 3600, token_type: 'Bearer' });

      await sdkWithCreds.authenticate();

      // Verify token is set by making a subsequent request
      mockResponse({});
      await sdkWithCreds.users.list();

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[1].headers.Authorization).toBe('Bearer new-jwt-token');
    });

    it('should set and clear token manually', async () => {
      sdk.setToken('manual-token');

      mockResponse({});
      await sdk.users.list();

      let lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[1].headers.Authorization).toBe('Bearer manual-token');

      sdk.clearToken();

      mockResponse({});
      await sdk.users.list();

      lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[1].headers.Authorization).toBeUndefined();
    });

    it('should set application ID', async () => {
      sdk.setApplicationId('new-app-id');

      mockResponse({});
      await sdk.users.list();

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[1].headers['X-Application-Id']).toBe('new-app-id');
    });
  });
});
