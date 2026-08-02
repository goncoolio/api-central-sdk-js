import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient, ApiCentralError } from '../utils/http-client';

describe('HttpClient', () => {
  let client: HttpClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new HttpClient({
      baseUrl: 'https://api.example.com',
      timeout: 5000,
      headers: {
        'X-Application-Id': 'test-app-id',
      },
    });

    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET requests', () => {
    it('should make a GET request with correct URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ data: 'test' })),
      });

      await client.get('/users');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Application-Id': 'test-app-id',
          }),
        })
      );
    });

    it('should append query params to URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ data: [] })),
      });

      await client.get('/users', { params: { page: 1, limit: 20 } });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users?page=1&limit=20',
        expect.any(Object)
      );
    });

    it('should return parsed JSON response', async () => {
      const responseData = { id: '123', name: 'Test User' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(responseData)),
      });

      const result = await client.get('/users/123');

      expect(result).toEqual(responseData);
    });
  });

  describe('POST requests', () => {
    it('should make a POST request with body', async () => {
      const requestBody = { name: 'New User', email: 'test@example.com' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: '123' })),
      });

      await client.post('/users', requestBody);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(requestBody),
        })
      );
    });
  });

  describe('PUT requests', () => {
    it('should make a PUT request with body', async () => {
      const requestBody = { name: 'Updated User' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: '123', name: 'Updated User' })),
      });

      await client.put('/users/123', requestBody);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users/123',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(requestBody),
        })
      );
    });
  });

  describe('DELETE requests', () => {
    it('should make a DELETE request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ success: true })),
      });

      await client.delete('/users/123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users/123',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should throw ApiCentralError on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve(JSON.stringify({
          message: 'User not found',
          statusCode: 404,
          error: 'Not Found',
        })),
      });

      await expect(client.get('/users/invalid')).rejects.toThrow(ApiCentralError);
    });

    it('should include error details in ApiCentralError', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({
          message: 'Validation failed',
          statusCode: 400,
          error: 'Bad Request',
          details: { field: 'email', message: 'Invalid format' },
        })),
      });

      try {
        await client.post('/users', { email: 'invalid' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiCentralError);
        const apiError = error as ApiCentralError;
        expect(apiError.statusCode).toBe(400);
        expect(apiError.message).toBe('Validation failed');
        expect(apiError.details).toEqual({ field: 'email', message: 'Invalid format' });
      }
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.get('/users')).rejects.toThrow(ApiCentralError);
    });
  });

  describe('Header management', () => {
    it('should set custom headers', async () => {
      client.setHeader('Authorization', 'Bearer token123');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({})),
      });

      await client.get('/users');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token123',
          }),
        })
      );
    });

    it('should remove headers', async () => {
      client.setHeader('Authorization', 'Bearer token123');
      client.removeHeader('Authorization');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({})),
      });

      await client.get('/users');

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders.Authorization).toBeUndefined();
    });
  });
});
