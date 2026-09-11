import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ApiCentral } from '../index';
import { BASE_URL, installFetchMock, respondJson, requestAt } from './test-helpers';

describe('CallsModule', () => {
  let fetchMock: Mock;
  let sdk: ApiCentral;

  beforeEach(() => {
    fetchMock = installFetchMock();
    sdk = new ApiCentral({ baseUrl: BASE_URL, token: 'user-token' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('signalisation SDP', () => {
    it('sendOffer envoie sdp_type = "offer" par défaut, champ exigé par l’API', async () => {
      respondJson(fetchMock, { success: true });

      await sdk.calls.sendOffer('call-1', { toUserId: 'user-2', sdp: 'v=0' });

      const request = requestAt(fetchMock, 0);
      expect(request.url).toBe(`${BASE_URL}/calls/call-1/offer`);
      expect(request.method).toBe('POST');
      expect(request.body).toEqual({ to_user_id: 'user-2', sdp: 'v=0', sdp_type: 'offer' });
    });

    it('sendAnswer envoie sdp_type = "answer" par défaut', async () => {
      respondJson(fetchMock, { success: true });

      await sdk.calls.sendAnswer('call-1', { toUserId: 'user-2', sdp: 'v=0' });

      const request = requestAt(fetchMock, 0);
      expect(request.url).toBe(`${BASE_URL}/calls/call-1/answer-sdp`);
      expect(request.body).toEqual({ to_user_id: 'user-2', sdp: 'v=0', sdp_type: 'answer' });
    });

    it('respecte un sdpType explicite', async () => {
      respondJson(fetchMock, { success: true });

      await sdk.calls.sendAnswer('call-1', { toUserId: 'user-2', sdp: 'v=0', sdpType: 'pranswer' });

      expect(requestAt(fetchMock, 0).body).toMatchObject({ sdp_type: 'pranswer' });
    });
  });
});
