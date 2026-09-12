/**
 * Integration Tests - Real API Server
 *
 * These tests run against the actual API server at localhost:3004
 * Make sure the Rust API server is running before executing these tests.
 *
 * Run with: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApiCentral, ApiCentralError } from '../index';
import type { MessageDeliveredEvent, MessageReadEvent } from '../modules/realtime';

// Configuration lue dans l'environnement : aucun credential n'est versionné.
// Sans API_CENTRAL_API_KEY et API_CENTRAL_API_SECRET, la suite est ignorée.
//
//   API_CENTRAL_API_KEY=… API_CENTRAL_API_SECRET=… \
//   API_CENTRAL_APPLICATION_ID=… npm run test:integration
const TEST_CONFIG = {
  baseUrl: process.env.API_CENTRAL_BASE_URL ?? 'http://localhost:3004/s2s/v1',
  wsUrl: process.env.API_CENTRAL_WS_URL ?? 'ws://localhost:3004/events',
  apiKey: process.env.API_CENTRAL_API_KEY ?? '',
  apiSecret: process.env.API_CENTRAL_API_SECRET ?? '',
  applicationId: process.env.API_CENTRAL_APPLICATION_ID ?? '',
};

const hasCredentials = Boolean(TEST_CONFIG.apiKey && TEST_CONFIG.apiSecret);

/** Reject with a readable message instead of hanging when an event never arrives. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms waiting for ${label}`)), ms)
    ),
  ]);
}

/** Poll a condition until it holds or the deadline passes. */
async function waitFor(condition: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Condition not met within ${ms}ms`);
}

describe.skipIf(!hasCredentials)('Integration Tests - Real API', () => {
  let sdk: ApiCentral;
  let testUserId: string;
  let testUser2Id: string;
  let testConversationId: string;
  let testMessageId: string;
  let testCallId: string;
  const timestamp = Date.now();

  beforeAll(async () => {
    sdk = new ApiCentral({
      baseUrl: TEST_CONFIG.baseUrl,
      apiKey: TEST_CONFIG.apiKey,
      apiSecret: TEST_CONFIG.apiSecret,
      applicationId: TEST_CONFIG.applicationId,
    });

    // Authenticate first
    const authResult = await sdk.auth.getToken({
      apiKey: TEST_CONFIG.apiKey,
      apiSecret: TEST_CONFIG.apiSecret,
    });
    sdk.setToken(authResult.accessToken);
  }, 30000);

  // =========================================================================
  // AUTH MODULE
  // =========================================================================
  describe('Auth Module', () => {
    it('should have authenticated successfully', async () => {
      // Already authenticated in beforeAll
      expect(true).toBe(true);
      console.log('✓ Authenticated successfully');
    });

    it('should fail authentication with wrong credentials', async () => {
      try {
        await sdk.auth.getToken({
          apiKey: 'wrong-key',
          apiSecret: 'wrong-secret',
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiCentralError);
        const apiError = error as ApiCentralError;
        expect(apiError.statusCode).toBe(401);
        console.log('✓ Correctly rejected invalid credentials');
      }
    });
  });

  // =========================================================================
  // USERS MODULE
  // =========================================================================
  describe('Users Module', () => {
    it('should create a new user', async () => {
      const result = await sdk.users.create({
        externalUserId: `test-user-${timestamp}`,
        displayName: 'Test User Integration',
        email: `test-${timestamp}@example.com`,
        metadata: { source: 'integration-test' },
      });

      expect(result.id).toBeDefined();
      expect(result.externalUserId).toBe(`test-user-${timestamp}`);
      expect(result.displayName).toBe('Test User Integration');

      testUserId = result.id;
      console.log('✓ Created user:', testUserId);
    });

    it('should create a second user for conversations', async () => {
      const result = await sdk.users.create({
        externalUserId: `test-user-2-${timestamp}`,
        displayName: 'Test User 2',
        email: `test2-${timestamp}@example.com`,
      });

      expect(result.id).toBeDefined();
      testUser2Id = result.id;
      console.log('✓ Created second user:', testUser2Id);
    });

    it('should get user by ID', async () => {
      const result = await sdk.users.get(testUserId);

      expect(result.id).toBe(testUserId);
      expect(result.displayName).toBe('Test User Integration');
      console.log('✓ Retrieved user by ID');
    });

    it('should get user by external ID', async () => {
      const result = await sdk.users.getByExternalId(`test-user-${timestamp}`);

      expect(result.id).toBe(testUserId);
      console.log('✓ Retrieved user by external ID');
    });

    it('should list users', async () => {
      const result = await sdk.users.list({ page: 1, limit: 10 });

      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.pagination.total).toBeGreaterThan(0);
      console.log('✓ Listed users, total:', result.pagination.total);
    });

    it('should update user', async () => {
      const result = await sdk.users.update(testUserId, {
        displayName: 'Updated Test User',
      });

      expect(result.displayName).toBe('Updated Test User');
      console.log('✓ Updated user');
    });

    it('should update presence', async () => {
      const result = await sdk.users.updatePresence(testUserId, {
        status: 'online',
      });

      expect(result.status).toBe('online');
      console.log('✓ Updated presence to online');
    });

    it('should get presence', async () => {
      const result = await sdk.users.getPresence(testUserId);

      expect(result.status).toBeDefined();
      console.log('✓ Got presence:', result.status);
    });

    it('should register device', async () => {
      const result = await sdk.users.registerDevice(testUserId, {
        deviceToken: `fcm-token-${timestamp}`,
        platform: 'android',
        deviceInfo: { model: 'Test Device', os: 'Android 14' },
      });

      expect(result.deviceToken).toBe(`fcm-token-${timestamp}`);
      expect(result.platform).toBe('android');
      console.log('✓ Registered device');
    });

    it('should list devices', async () => {
      const result = await sdk.users.listDevices(testUserId);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      console.log('✓ Listed devices, count:', result.length);
    });
  });

  // =========================================================================
  // MESSAGING MODULE
  // =========================================================================
  describe('Messaging Module', () => {
    it('should create a direct conversation', async () => {
      const result = await sdk.messaging.createConversation({
        conversationType: 'direct',
        participantIds: [testUserId, testUser2Id],
      });

      expect(result.id).toBeDefined();
      expect(result.type).toBe('direct');

      testConversationId = result.id;
      console.log('✓ Created conversation:', testConversationId);
    });

    it('should get conversation by ID', async () => {
      const result = await sdk.messaging.getConversation(testConversationId, testUserId);

      expect(result.id).toBe(testConversationId);
      expect(result.type).toBe('direct');
      console.log('✓ Retrieved conversation');
    });

    it('should list user conversations', async () => {
      const result = await sdk.messaging.listUserConversations(testUserId, { page: 1 });

      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      console.log('✓ Listed user conversations');
    });

    it('should send a text message', async () => {
      const result = await sdk.messaging.sendMessage(testConversationId, {
        senderId: testUserId,
        content: 'Hello from integration test!',
        contentType: 'text',
      });

      expect(result.id).toBeDefined();
      expect(result.content).toBe('Hello from integration test!');
      expect(result.contentType).toBe('text');

      testMessageId = result.id;
      console.log('✓ Sent text message:', testMessageId);
    });

    it('should list messages', async () => {
      const result = await sdk.messaging.listMessages(testConversationId, { limit: 50 });

      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      console.log('✓ Listed messages, count:', result.data.length);
    });

    it('should get a specific message', async () => {
      const result = await sdk.messaging.getMessage(testMessageId);

      expect(result.id).toBe(testMessageId);
      expect(result.content).toBe('Hello from integration test!');
      console.log('✓ Retrieved specific message');
    });

    it('should edit a message', async () => {
      const result = await sdk.messaging.editMessage(testMessageId, {
        content: 'Hello from integration test! (edited)',
      });

      expect(result.content).toBe('Hello from integration test! (edited)');
      console.log('✓ Edited message');
    });

    it('should add reaction to message', async () => {
      const result = await sdk.messaging.addReaction(testMessageId, {
        userId: testUser2Id,
        emoji: '👍',
      });

      expect(result.success).toBe(true);
      console.log('✓ Added reaction');
    });

    it('should send typing indicator', async () => {
      const result = await sdk.messaging.sendTyping(testConversationId, {
        userId: testUserId,
      });

      expect(result.success).toBe(true);
      console.log('✓ Sent typing indicator');
    });

    it('should mark messages as read', async () => {
      const result = await sdk.messaging.markAsRead(testConversationId, {
        userId: testUser2Id,
        messageId: testMessageId,
      });

      expect(result.success).toBe(true);
      console.log('✓ Marked messages as read');
    });

    it('should list conversation participants', async () => {
      const result = await sdk.messaging.listParticipants(testConversationId);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);

      const userIds = result.map((p) => p.userId ?? p.user?.id);
      expect(userIds).toContain(testUserId);
      expect(userIds).toContain(testUser2Id);
      console.log('✓ Listed conversation participants, count:', result.length);
    });
  });

  // =========================================================================
  // NOTIFICATIONS MODULE
  // =========================================================================
  describe('Notifications Module', () => {
    let notificationId: string;

    it('should send a notification', async () => {
      const result = await sdk.notifications.send({
        userId: testUserId,
        notificationType: 'message',
        title: 'Integration test',
        body: 'Sent from the SDK integration suite',
        channels: ['in_app'],
      });

      expect(result.id).toBeDefined();
      // The API serializes the category as `type`, not `notificationType`
      expect(result.type).toBe('message');
      expect(result.isRead).toBe(false);

      notificationId = result.id;
      console.log('✓ Sent notification:', notificationId);
    });

    it('should reject a notification without a type', async () => {
      try {
        // @ts-expect-error notificationType is required by the API
        await sdk.notifications.send({
          userId: testUserId,
          title: 'Missing type',
          body: 'Should be rejected',
        });
        expect.fail('Should have thrown a validation error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiCentralError);
        expect((error as ApiCentralError).statusCode).toBeGreaterThanOrEqual(400);
        console.log('✓ Correctly rejected notification without type');
      }
    });

    it('should send a bulk notification', async () => {
      const result = await sdk.notifications.sendBulk({
        userIds: [testUserId, testUser2Id],
        notificationType: 'system',
        title: 'Bulk integration test',
        body: 'Sent to two users',
        channels: ['in_app'],
      });

      expect(result.success).toBe(true);
      // camelCase conversion of the API's `sent_count`
      expect(result.sentCount).toBe(2);
      console.log('✓ Sent bulk notification, count:', result.sentCount);
    });

    it('should send a templated notification', async () => {
      const result = await sdk.notifications.sendTemplate({
        userId: testUserId,
        templateSlug: 'sdk_integration_test',
        variables: { sender: 'Alice', preview: 'Hey there' },
      });

      expect(result.id).toBeDefined();
      // Template placeholders must have been rendered server-side
      expect(result.title).toBe('Message de Alice');
      expect(result.body).toBe('Alice : Hey there');
      console.log('✓ Sent templated notification:', result.title);
    });

    it('should return 404 for an unknown template slug', async () => {
      try {
        await sdk.notifications.sendTemplate({
          userId: testUserId,
          templateSlug: 'does_not_exist_slug',
        });
        expect.fail('Should have thrown a 404');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiCentralError);
        expect((error as ApiCentralError).statusCode).toBe(404);
        console.log('✓ Correctly returned 404 for unknown template');
      }
    });

    it('should list notifications for a user', async () => {
      const result = await sdk.notifications.list(testUserId, { page: 1, limit: 50 });

      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      console.log('✓ Listed notifications, count:', result.data.length);
    });

    it('should filter unread notifications', async () => {
      const result = await sdk.notifications.list(testUserId, { unreadOnly: true });

      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.every((n) => n.isRead === false)).toBe(true);
      console.log('✓ Filtered unread notifications, count:', result.data.length);
    });

    it('should get the unread count', async () => {
      const result = await sdk.notifications.getUnreadCount(testUserId);

      expect(typeof result.count).toBe('number');
      expect(result.count).toBeGreaterThan(0);
      console.log('✓ Unread count:', result.count);
    });

    it('should mark a notification as read', async () => {
      const before = await sdk.notifications.getUnreadCount(testUserId);

      const result = await sdk.notifications.markAsRead({
        notificationIds: [notificationId],
      });

      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(1);

      const after = await sdk.notifications.getUnreadCount(testUserId);
      expect(after.count).toBe(before.count - 1);
      console.log('✓ Marked notification as read');
    });

    it('should mark all notifications as read', async () => {
      const result = await sdk.notifications.markAllAsRead(testUserId);

      expect(result.success).toBe(true);

      const after = await sdk.notifications.getUnreadCount(testUserId);
      expect(after.count).toBe(0);
      console.log('✓ Marked all notifications as read');
    });

    it('should delete a notification', async () => {
      const result = await sdk.notifications.delete(notificationId);

      expect(result.success).toBe(true);
      console.log('✓ Deleted notification');
    });
  });

  // =========================================================================
  // USER TOKEN (for WebSocket)
  // =========================================================================
  describe('User Token', () => {
    it('should get user token for WebSocket connection', async () => {
      const result = await sdk.auth.getUserToken({
        userId: testUserId,
      });

      expect(result.socketToken).toBeDefined();
      expect(result.user.id).toBe(testUserId);
      expect(result.expiresIn).toBeGreaterThan(0);
      console.log('✓ Got user token for WebSocket');
    });
  });

  // =========================================================================
  // CALLS MODULE (requires user token)
  // =========================================================================
  describe('Calls Module', () => {
    let userSdk: ApiCentral;
    let originalToken: string;

    beforeAll(async () => {
      // Get user token for calls (calls require user context)
      const userTokenResult = await sdk.auth.getUserToken({
        userId: testUserId,
      });

      // Create a new SDK instance with user token
      userSdk = new ApiCentral({
        baseUrl: TEST_CONFIG.baseUrl,
        token: userTokenResult.socketToken,
        applicationId: TEST_CONFIG.applicationId,
      });

      console.log('✓ Got user token for calls');
    });

    it('should initiate a video call', async () => {
      const result = await userSdk.calls.initiate({
        participantIds: [testUserId, testUser2Id],
        callType: 'video',
        encryptionEnabled: true,
      });

      expect(result.id).toBeDefined();
      expect(result.callType).toBe('video');
      expect(result.status).toBeDefined();
      expect(result.encryptionEnabled).toBe(true);

      testCallId = result.id;
      console.log('✓ Initiated call:', testCallId);
    });

    it('should get call details', async () => {
      const result = await userSdk.calls.get(testCallId);

      expect(result.id).toBe(testCallId);
      expect(result.callType).toBe('video');
      expect(result.participants).toBeDefined();
      expect(result.participants.length).toBeGreaterThan(0);
      console.log('✓ Retrieved call details');
    });

    it('should set mute status', async () => {
      const result = await userSdk.calls.setMuted(testCallId, testUserId, { muted: true });

      expect(result).toBeDefined();
      console.log('✓ Set mute status to true');

      // Unmute
      const result2 = await userSdk.calls.setMuted(testCallId, testUserId, { muted: false });
      expect(result2).toBeDefined();
      console.log('✓ Set mute status to false');
    });

    it('should toggle video status', async () => {
      const result = await userSdk.calls.setVideoEnabled(testCallId, testUserId, { enabled: false });

      expect(result).toBeDefined();
      console.log('✓ Disabled video');

      // Enable video
      const result2 = await userSdk.calls.setVideoEnabled(testCallId, testUserId, { enabled: true });
      expect(result2).toBeDefined();
      console.log('✓ Enabled video');
    });

    it('should toggle screen sharing', async () => {
      // Enable screen sharing
      const result = await userSdk.calls.setScreenSharing(testCallId, testUserId, { sharing: true });

      expect(result).toBeDefined();
      expect(result.screenSharing).toBe(true);
      console.log('✓ Enabled screen sharing');

      // Verify call shows screen sharing enabled
      const call = await userSdk.calls.get(testCallId);
      const participant = call.participants.find(p => p.user.id === testUserId);
      expect(participant?.isScreenSharing).toBe(true);
      console.log('✓ Verified screen sharing is active in call details');

      // Disable screen sharing
      const result2 = await userSdk.calls.setScreenSharing(testCallId, testUserId, { sharing: false });
      expect(result2).toBeDefined();
      expect(result2.screenSharing).toBe(false);
      console.log('✓ Disabled screen sharing');
    });

    it('should end the call', async () => {
      const result = await userSdk.calls.end(testCallId, { userId: testUserId });

      expect(result.id).toBe(testCallId);
      expect(result.status).toBe('ended');
      console.log('✓ Ended call');
    });

    it('should show call in history', async () => {
      const result = await userSdk.calls.listHistory({ page: 1, limit: 10 });

      expect(result).toBeDefined();
      console.log('✓ Retrieved call history');
    });
  });

  // =========================================================================
  // LIVE STREAMING MODULE
  // =========================================================================
  describe('Live Streaming Module', () => {
    let testStreamId: string;
    let testCommentId: string;

    it('should create a live stream', async () => {
      const result = await sdk.live.createStream({
        hostId: testUserId,
        title: 'Integration Test Stream',
        description: 'Testing live streaming functionality',
      });

      expect(result.id).toBeDefined();
      expect(result.title).toBe('Integration Test Stream');
      expect(result.status).toBe('scheduled');

      testStreamId = result.id;
      console.log('✓ Created live stream:', testStreamId);
    });

    it('should get stream by ID', async () => {
      const result = await sdk.live.getStream(testStreamId);

      expect(result.id).toBe(testStreamId);
      expect(result.title).toBe('Integration Test Stream');
      console.log('✓ Retrieved stream details');
    });

    it('should update stream', async () => {
      const result = await sdk.live.updateStream(testStreamId, {
        title: 'Updated Stream Title',
        description: 'Updated description',
      });

      expect(result.title).toBe('Updated Stream Title');
      console.log('✓ Updated stream');
    });

    it('should start the stream', async () => {
      const result = await sdk.live.startStream(testStreamId);

      expect(result.status).toBe('live');
      expect(result.streamKey).toBeDefined();
      console.log('✓ Started stream, status:', result.status);
    });

    it('should get viewers (includes count)', async () => {
      // The API returns viewers with count via /viewers endpoint
      const result = await sdk.live.getViewers(testStreamId, { limit: 10 });

      // Note: API returns StreamViewersResponse with viewer_count, not paginated
      expect(result).toBeDefined();
      console.log('✓ Got viewers response');
    });

    it('should join the stream as a viewer', async () => {
      const before = await sdk.live.getViewerCount(testStreamId);

      const result = await sdk.live.joinStream(testStreamId, { userId: testUser2Id });

      expect(result.streamId).toBe(testStreamId);
      expect(result.viewerCount).toBe(before.viewerCount + 1);
      console.log('✓ Joined stream, viewers:', result.viewerCount);
    });

    it('should leave the stream', async () => {
      const before = await sdk.live.getViewerCount(testStreamId);

      const result = await sdk.live.leaveStream(testStreamId, { userId: testUser2Id });

      expect(result.streamId).toBe(testStreamId);
      expect(result.viewerCount).toBe(before.viewerCount - 1);
      console.log('✓ Left stream, viewers:', result.viewerCount);
    });

    it('should post a comment', async () => {
      const result = await sdk.live.postComment(testStreamId, {
        userId: testUser2Id,
        content: 'This is a test comment!',
      });

      expect(result.id).toBeDefined();
      expect(result.content).toBe('This is a test comment!');

      testCommentId = result.id;
      console.log('✓ Posted comment:', testCommentId);
    });

    it('should pin a comment', async () => {
      const result = await sdk.live.pinComment(testStreamId, testCommentId);

      expect(result.success).toBe(true);
      console.log('✓ Pinned comment');
    });

    it('should unpin a comment', async () => {
      const result = await sdk.live.unpinComment(testStreamId, testCommentId);

      expect(result.success).toBe(true);
      console.log('✓ Unpinned comment');
    });

    // Reactions are rate limited per user (one every 200ms), so we track how
    // many were actually accepted instead of assuming every call lands.
    let acceptedReactions = 0;

    it('should send a reaction', async () => {
      const result = await sdk.live.sendReaction(testStreamId, {
        userId: testUser2Id,
        emoji: '❤️',
      });

      expect(result.accepted).toBe(true);
      acceptedReactions++;
      console.log('✓ Sent reaction');
    });

    it('should send multiple reactions', async () => {
      // Different user: not affected by the previous user's rate limit
      const first = await sdk.live.sendReaction(testStreamId, {
        userId: testUserId,
        emoji: '🔥',
      });
      if (first.accepted) acceptedReactions++;

      // Same user as the first reaction: wait out the 200ms window
      await new Promise((resolve) => setTimeout(resolve, 250));
      const second = await sdk.live.sendReaction(testStreamId, {
        userId: testUser2Id,
        emoji: '👏',
      });
      if (second.accepted) acceptedReactions++;

      expect(acceptedReactions).toBe(3);
      console.log('✓ Sent multiple reactions');
    });

    it('should get stream stats', async () => {
      const result = await sdk.live.getStats(testStreamId);

      expect(result).toBeDefined();
      expect(result.totalReactions).toBeGreaterThanOrEqual(acceptedReactions);
      console.log('✓ Got stream stats, reactions:', result.totalReactions);
    });

    it('should delete a comment', async () => {
      const result = await sdk.live.deleteComment(testStreamId, testCommentId);

      expect(result.success).toBe(true);
      console.log('✓ Deleted comment');
    });

    it('should end the stream', async () => {
      const result = await sdk.live.endStream(testStreamId);

      expect(result.status).toBe('ended');
      console.log('✓ Ended stream');
    });
  });

  // =========================================================================
  // AUDIO CALL TEST
  // =========================================================================
  describe('Audio Call', () => {
    let userSdk: ApiCentral;
    let audioCallId: string;

    beforeAll(async () => {
      // Get user token for calls
      const userTokenResult = await sdk.auth.getUserToken({
        userId: testUserId,
      });

      userSdk = new ApiCentral({
        baseUrl: TEST_CONFIG.baseUrl,
        token: userTokenResult.socketToken,
        applicationId: TEST_CONFIG.applicationId,
      });
    });

    it('should initiate an audio call', async () => {
      const result = await userSdk.calls.initiate({
        participantIds: [testUserId, testUser2Id],
        callType: 'audio',
        encryptionEnabled: true,
      });

      expect(result.id).toBeDefined();
      expect(result.callType).toBe('audio');
      expect(result.status).toBeDefined();
      expect(result.encryptionEnabled).toBe(true);

      audioCallId = result.id;
      console.log('✓ Initiated audio call:', audioCallId);
    });

    it('should get audio call details', async () => {
      const result = await userSdk.calls.get(audioCallId);

      expect(result.id).toBe(audioCallId);
      expect(result.callType).toBe('audio');
      expect(result.participants).toBeDefined();
      console.log('✓ Retrieved audio call details');
    });

    it('should mute/unmute during audio call', async () => {
      // Mute
      const muteResult = await userSdk.calls.setMuted(audioCallId, testUserId, { muted: true });
      expect(muteResult).toBeDefined();
      console.log('✓ Muted in audio call');

      // Unmute
      const unmuteResult = await userSdk.calls.setMuted(audioCallId, testUserId, { muted: false });
      expect(unmuteResult).toBeDefined();
      console.log('✓ Unmuted in audio call');
    });

    it('should end audio call', async () => {
      const result = await userSdk.calls.end(audioCallId, { userId: testUserId });

      expect(result.id).toBe(audioCallId);
      expect(result.status).toBe('ended');
      console.log('✓ Ended audio call');
    });
  });

  // =========================================================================
  // VIDEO CALL WITH SCREEN SHARE TEST
  // =========================================================================
  describe('Video Call with Screen Share', () => {
    let userSdk: ApiCentral;
    let videoCallId: string;

    beforeAll(async () => {
      // Get user token for calls
      const userTokenResult = await sdk.auth.getUserToken({
        userId: testUserId,
      });

      userSdk = new ApiCentral({
        baseUrl: TEST_CONFIG.baseUrl,
        token: userTokenResult.socketToken,
        applicationId: TEST_CONFIG.applicationId,
      });
    });

    it('should initiate a video call', async () => {
      const result = await userSdk.calls.initiate({
        participantIds: [testUserId, testUser2Id],
        callType: 'video',
        encryptionEnabled: true,
      });

      expect(result.id).toBeDefined();
      expect(result.callType).toBe('video');

      videoCallId = result.id;
      console.log('✓ Initiated video call:', videoCallId);
    });

    it('should toggle video during call', async () => {
      // Disable video
      const disableResult = await userSdk.calls.setVideoEnabled(videoCallId, testUserId, { enabled: false });
      expect(disableResult).toBeDefined();
      console.log('✓ Disabled video');

      // Enable video
      const enableResult = await userSdk.calls.setVideoEnabled(videoCallId, testUserId, { enabled: true });
      expect(enableResult).toBeDefined();
      console.log('✓ Enabled video');
    });

    it('should start screen sharing', async () => {
      const result = await userSdk.calls.setScreenSharing(videoCallId, testUserId, { sharing: true });

      expect(result.screenSharing).toBe(true);
      console.log('✓ Started screen sharing');

      // Verify in call details
      const call = await userSdk.calls.get(videoCallId);
      const participant = call.participants.find(p => p.user.id === testUserId);
      expect(participant?.isScreenSharing).toBe(true);
      console.log('✓ Verified screen sharing active');
    });

    it('should stop screen sharing', async () => {
      const result = await userSdk.calls.setScreenSharing(videoCallId, testUserId, { sharing: false });

      expect(result.screenSharing).toBe(false);
      console.log('✓ Stopped screen sharing');
    });

    it('should mute while screen sharing', async () => {
      // Start screen share again
      await userSdk.calls.setScreenSharing(videoCallId, testUserId, { sharing: true });

      // Mute audio while sharing
      const muteResult = await userSdk.calls.setMuted(videoCallId, testUserId, { muted: true });
      expect(muteResult).toBeDefined();
      console.log('✓ Muted while screen sharing');

      // Verify call state
      const call = await userSdk.calls.get(videoCallId);
      const participant = call.participants.find(p => p.user.id === testUserId);
      expect(participant?.isScreenSharing).toBe(true);
      expect(participant?.isMuted).toBe(true);
      console.log('✓ Verified muted + screen sharing state');
    });

    it('should end video call with screen share', async () => {
      const result = await userSdk.calls.end(videoCallId, { userId: testUserId });

      expect(result.id).toBe(videoCallId);
      expect(result.status).toBe('ended');
      console.log('✓ Ended video call with screen share');
    });
  });

  // =========================================================================
  // REALTIME (WebSocket)
  // =========================================================================
  describe('Realtime WebSocket', () => {
    let wsSdk: ApiCentral;

    beforeAll(async () => {
      const userTokenResult = await sdk.auth.getUserToken({ userId: testUserId });

      wsSdk = new ApiCentral({
        baseUrl: TEST_CONFIG.baseUrl,
        applicationId: TEST_CONFIG.applicationId,
      });
      wsSdk.setToken(userTokenResult.socketToken);
      wsSdk.connectRealtime(userTokenResult.socketToken, { wsUrl: TEST_CONFIG.wsUrl });

      // Wait for the socket to be open before joining any room
      await waitFor(() => wsSdk.realtime?.connected === true, 5000);
    }, 30000);

    afterAll(() => {
      wsSdk?.disconnectRealtime();
    });

    it('should connect to the WebSocket server', () => {
      expect(wsSdk.realtime).not.toBeNull();
      expect(wsSdk.realtime!.connected).toBe(true);
      console.log('✓ Connected to WebSocket');
    });

    it('should join a conversation room', async () => {
      const joined = new Promise<{ conversationId: string; success: boolean }>((resolve) => {
        wsSdk.realtime!.onConversationJoined((data) => resolve(data));
      });

      wsSdk.realtime!.joinConversation(testConversationId);

      const event = await withTimeout(joined, 5000, 'conversation_joined');
      expect(event.conversationId).toBe(testConversationId);
      expect(event.success).toBe(true);
      console.log('✓ Joined conversation room over WebSocket');
    });

    it('should receive a message_read event when a participant marks as read', async () => {
      const received = new Promise<MessageReadEvent>((resolve) => {
        wsSdk.realtime!.onMessageRead((data) => resolve(data));
      });

      // The other participant marks the conversation as read over REST.
      // The API only broadcasts the receipt when messageId is provided.
      await sdk.messaging.markAsRead(testConversationId, {
        userId: testUser2Id,
        messageId: testMessageId,
      });

      const event = await withTimeout(received, 8000, 'message_read');

      expect(event.conversationId).toBe(testConversationId);
      expect(event.userId).toBe(testUser2Id);
      expect(event.lastReadMessageId).toBe(testMessageId);
      expect(new Date(event.readAt).toString()).not.toBe('Invalid Date');
      console.log('✓ Received message_read event, readAt:', event.readAt);
    }, 20000);

    it('should receive a message_delivered event after acknowledging', async () => {
      const received = new Promise<MessageDeliveredEvent>((resolve) => {
        wsSdk.realtime!.onMessageDelivered((data) => resolve(data));
      });
      // A server predating the message_delivered support answers with an error
      // instead of relaying the receipt. Detect it so the failure is readable.
      const rejected = new Promise<never>((_, reject) => {
        wsSdk.realtime!.onError((err) => {
          const message = String((err as { message?: string }).message ?? '');
          if (message.includes('message_delivered')) {
            reject(new Error(`Server does not support message_delivered yet: ${message}`));
          }
        });
      });

      // The server cannot know a client received a message: the client says so.
      wsSdk.realtime!.acknowledgeDelivery(testConversationId, [testMessageId]);

      const event = await withTimeout(
        Promise.race([received, rejected]),
        8000,
        'message_delivered'
      );

      expect(event.conversationId).toBe(testConversationId);
      expect(event.messageIds).toContain(testMessageId);
      expect(new Date(event.deliveredAt).toString()).not.toBe('Invalid Date');
      console.log('✓ Received message_delivered event');
    }, 20000);

    it('should receive a message_new event when a message is sent', async () => {
      const received = new Promise<{ content: string }>((resolve) => {
        wsSdk.realtime!.onMessageNew((data) => resolve(data as { content: string }));
      });

      await sdk.messaging.sendMessage(testConversationId, {
        senderId: testUser2Id,
        content: 'Realtime hello',
        contentType: 'text',
      });

      const event = await withTimeout(received, 8000, 'message_new');
      expect(event.content).toBe('Realtime hello');
      console.log('✓ Received message_new event');
    }, 20000);
  });

  // =========================================================================
  // CLEANUP
  // =========================================================================
  describe('Cleanup', () => {
    it('should remove reaction and delete message', async () => {
      // Remove reaction first
      const removeResult = await sdk.messaging.removeReaction(testMessageId, testUser2Id, '👍');
      expect(removeResult.success).toBe(true);
      console.log('✓ Removed reaction');

      // Then delete the message
      const deleteResult = await sdk.messaging.deleteMessage(testMessageId);
      expect(deleteResult.success).toBe(true);
      console.log('✓ Deleted message');
    });

    it('should delete conversation', async () => {
      const result = await sdk.messaging.deleteConversation(testConversationId);
      expect(result.success).toBe(true);
      console.log('✓ Deleted conversation');
    });

    it('should remove device', async () => {
      const result = await sdk.users.removeDevice(testUserId, `fcm-token-${timestamp}`);
      expect(result.deleted).toBe(true);
      console.log('✓ Removed device');
    });

    it('should delete users', async () => {
      const result1 = await sdk.users.delete(testUserId);
      expect(result1.success).toBe(true);
      console.log('✓ Deleted user 1');

      const result2 = await sdk.users.delete(testUser2Id);
      expect(result2.success).toBe(true);
      console.log('✓ Deleted user 2');
    });
  });

  // =========================================================================
  // ERROR HANDLING
  // =========================================================================
  describe('Error Handling', () => {
    it('should return 404 for non-existent user', async () => {
      try {
        await sdk.users.get('00000000-0000-0000-0000-000000000000');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiCentralError);
        const apiError = error as ApiCentralError;
        expect(apiError.statusCode).toBe(404);
        console.log('✓ Correctly returned 404 for non-existent user');
      }
    });

    it('should return 404 for non-existent conversation', async () => {
      // Create a temp user for this test
      const tempUser = await sdk.users.create({
        externalUserId: `temp-user-${Date.now()}`,
        displayName: 'Temp User',
      });

      try {
        await sdk.messaging.getConversation('00000000-0000-0000-0000-000000000000', tempUser.id);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiCentralError);
        const apiError = error as ApiCentralError;
        expect(apiError.statusCode).toBe(404);
        console.log('✓ Correctly returned 404 for non-existent conversation');
      } finally {
        await sdk.users.delete(tempUser.id);
      }
    });
  });
}, 60000);
