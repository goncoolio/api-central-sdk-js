import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ApiCentral } from '../index';
import { BASE_URL, installFetchMock, requestAt, respondJson } from './test-helpers';

// Contrat des routes de live (src/api/live.rs et src/types/live.rs de l'API).

describe('LiveModule', () => {
  let fetchMock: Mock;
  let sdk: ApiCentral;

  beforeEach(() => {
    fetchMock = installFetchMock();
    sdk = new ApiCentral({ baseUrl: BASE_URL, token: 'app-token' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('listStreams', () => {
    it('ne transmet que les filtres lus par l’API : status, page et limit', async () => {
      respondJson(fetchMock, []);
      // Un appelant JavaScript peut encore passer hostId : il n'est pas envoyé.
      const legacyOptions: Record<string, unknown> = { status: 'ended', page: 2, limit: 10, hostId: 'user-9' };

      await sdk.live.listStreams(legacyOptions as never);

      expect(requestAt(fetchMock, 0).url).toBe(`${BASE_URL}/live/streams?status=ended&page=2&limit=10`);
    });

    it('n’envoie aucun paramètre sans option', async () => {
      respondJson(fetchMock, []);

      await sdk.live.listStreams();

      expect(requestAt(fetchMock, 0).url).toBe(`${BASE_URL}/live/streams`);
    });
  });

  describe('sendReaction', () => {
    it('expose retryAfterMs quand la réaction est limitée par le débit', async () => {
      respondJson(fetchMock, {
        accepted: false,
        message: 'Rate limited. Wait 180ms before trying again',
        retry_after_ms: 180,
      });

      const result = await sdk.live.sendReaction('stream-1', { userId: 'user-1', emoji: '❤️' });

      expect(result).toEqual({
        accepted: false,
        message: 'Rate limited. Wait 180ms before trying again',
        retryAfterMs: 180,
      });
      expect(requestAt(fetchMock, 0)).toMatchObject({
        url: `${BASE_URL}/live/streams/stream-1/reactions`,
        method: 'POST',
        body: { user_id: 'user-1', emoji: '❤️' },
      });
    });

    it('renvoie { accepted, message } quand la réaction est acceptée', async () => {
      respondJson(fetchMock, { accepted: true, message: 'Reaction added' });

      const result = await sdk.live.sendReaction('stream-1', { userId: 'user-1', emoji: '🔥' });

      expect(result).toEqual({ accepted: true, message: 'Reaction added' });
    });
  });

  describe('getStats', () => {
    it('renvoie StreamStats : réactions par emoji, durée nulle avant le démarrage', async () => {
      respondJson(fetchMock, {
        stream_id: 'stream-1',
        viewer_count: 12,
        peak_viewer_count: 30,
        total_comments: 4,
        total_reactions: 7,
        reactions_by_emoji: [
          { emoji: '❤️', count: 5 },
          { emoji: '🔥', count: 2 },
        ],
        duration_seconds: null,
      });

      const stats = await sdk.live.getStats('stream-1');

      expect(requestAt(fetchMock, 0).url).toBe(`${BASE_URL}/live/streams/stream-1/stats`);
      expect(stats).toEqual({
        streamId: 'stream-1',
        viewerCount: 12,
        peakViewerCount: 30,
        totalComments: 4,
        totalReactions: 7,
        reactionsByEmoji: [
          { emoji: '❤️', count: 5 },
          { emoji: '🔥', count: 2 },
        ],
        durationSeconds: null,
      });
    });
  });
});
