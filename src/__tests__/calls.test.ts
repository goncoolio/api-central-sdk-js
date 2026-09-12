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

  describe('bascules média (réponses réelles de l’API)', () => {
    it('setMuted renvoie { muted }', async () => {
      respondJson(fetchMock, { muted: true });

      const result = await sdk.calls.setMuted('call-1', 'user-1', { muted: true });

      expect(result).toEqual({ muted: true });
      expect(requestAt(fetchMock, 0)).toMatchObject({
        url: `${BASE_URL}/calls/call-1/participants/user-1/mute`,
        method: 'PUT',
        body: { muted: true },
      });
    });

    it('setVideoEnabled renvoie { videoEnabled } (video_enabled converti)', async () => {
      respondJson(fetchMock, { video_enabled: false });

      const result = await sdk.calls.setVideoEnabled('call-1', 'user-1', { enabled: false });

      expect(result).toEqual({ videoEnabled: false });
      expect(requestAt(fetchMock, 0)).toMatchObject({
        url: `${BASE_URL}/calls/call-1/participants/user-1/video`,
        body: { enabled: false },
      });
    });

    it('setScreenSharing renvoie { screenSharing }', async () => {
      respondJson(fetchMock, { screen_sharing: true });

      const result = await sdk.calls.setScreenSharing('call-1', 'user-1', { sharing: true });

      expect(result).toEqual({ screenSharing: true });
    });
  });

  describe('serveurs ICE', () => {
    it('getIceServers expose iceServers, callId et ttl', async () => {
      respondJson(fetchMock, {
        ice_servers: [
          { urls: ['stun:stun.example.com:3478'] },
          { urls: ['turn:turn.example.com:3478'], username: '1700000000:user-1', credential: 'c2VjcmV0' },
        ],
        call_id: 'call-1',
        ttl: 86400,
      });

      const result = await sdk.calls.getIceServers('call-1');

      expect(result.callId).toBe('call-1');
      expect(result.ttl).toBe(86400);
      expect(result.iceServers[1]).toEqual({
        urls: ['turn:turn.example.com:3478'],
        username: '1700000000:user-1',
        credential: 'c2VjcmV0',
      });
      expect(requestAt(fetchMock, 0).url).toBe(`${BASE_URL}/calls/call-1/ice-servers`);
    });
  });

  describe('LiveKit (appels de groupe)', () => {
    it('getLiveKitToken renvoie url, token, room et identity de GET /calls/{id}/token', async () => {
      respondJson(fetchMock, {
        url: 'wss://livekit.example.com',
        token: 'jeton-sfu',
        room: 'call:call-1',
        identity: 'user-1',
      });

      const result = await sdk.calls.getLiveKitToken('call-1');

      expect(result).toEqual({
        url: 'wss://livekit.example.com',
        token: 'jeton-sfu',
        room: 'call:call-1',
        identity: 'user-1',
      });
      expect(requestAt(fetchMock, 0)).toMatchObject({ url: `${BASE_URL}/calls/call-1/token`, method: 'GET' });
    });

    it('propage le refus (403) d’un utilisateur qui ne participe pas à l’appel', async () => {
      respondJson(fetchMock, { message: 'Forbidden', statusCode: 403 }, 403);

      await expect(sdk.calls.getLiveKitToken('call-1')).rejects.toMatchObject({ statusCode: 403 });
    });

    it('propage le 400 d’un serveur sans LiveKit configuré', async () => {
      respondJson(fetchMock, { message: 'LiveKit is not configured', statusCode: 400 }, 400);

      await expect(sdk.calls.getLiveKitToken('call-1')).rejects.toMatchObject({
        statusCode: 400,
        message: 'LiveKit is not configured',
      });
    });
  });
});
