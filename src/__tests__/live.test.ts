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
