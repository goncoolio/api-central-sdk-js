import type { ApiError } from '../types';

// =============================================================================
// HTTP Client for API Central SDK
// =============================================================================

// -----------------------------------------------------------------------------
// Case Conversion Utilities
// -----------------------------------------------------------------------------

/**
 * Convert camelCase to snake_case
 */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Convert snake_case to camelCase
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Recursively convert object keys from camelCase to snake_case
 */
function toSnakeCase(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(toSnakeCase);
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[camelToSnake(key)] = toSnakeCase(value);
    }
    return result;
  }

  return obj;
}

/**
 * Recursively convert object keys from snake_case to camelCase
 */
function toCamelCase(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(toCamelCase);
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[snakeToCamel(key)] = toCamelCase(value);
    }
    return result;
  }

  return obj;
}

// -----------------------------------------------------------------------------
// HTTP Client Configuration
// -----------------------------------------------------------------------------

export interface HttpClientConfig {
  baseUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface TokenRefreshConfig {
  apiKey: string;
  apiSecret: string;
  onTokenRefreshed?: (token: string) => void;
}

export interface RequestConfig {
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | undefined>;
  timeout?: number;
}

export class ApiCentralError extends Error {
  public readonly statusCode: number;
  public readonly error?: string;
  public readonly details?: Record<string, unknown>;

  constructor(apiError: ApiError) {
    super(apiError.message);
    this.name = 'ApiCentralError';
    this.statusCode = apiError.statusCode;
    this.error = apiError.error;
    this.details = apiError.details;
  }

  static fromResponse(status: number, body: unknown): ApiCentralError {
    if (typeof body === 'object' && body !== null && 'message' in body) {
      return new ApiCentralError(body as ApiError);
    }
    return new ApiCentralError({
      message: typeof body === 'string' ? body : 'Unknown error',
      statusCode: status,
    });
  }
}

export class HttpClient {
  private baseUrl: string;
  private defaultTimeout: number;
  private defaultHeaders: Record<string, string>;
  private tokenRefreshConfig?: TokenRefreshConfig;
  private isRefreshing: boolean = false;
  private refreshPromise?: Promise<void>;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.defaultTimeout = config.timeout ?? 30000;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...config.headers,
    };
  }

  setHeader(key: string, value: string): void {
    this.defaultHeaders[key] = value;
  }

  removeHeader(key: string): void {
    delete this.defaultHeaders[key];
  }

  /**
   * Configure automatic token refresh
   */
  setTokenRefreshConfig(config: TokenRefreshConfig): void {
    this.tokenRefreshConfig = config;
  }

  /**
   * Refresh the token using stored credentials
   */
  private async refreshToken(): Promise<void> {
    if (!this.tokenRefreshConfig) {
      throw new ApiCentralError({
        message: 'Token refresh not configured',
        statusCode: 401,
        error: 'Unauthorized',
      });
    }

    // If already refreshing, wait for that to complete
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      try {
        // Call auth endpoint directly to get new token
        const response = await fetch(`${this.baseUrl}/auth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: this.tokenRefreshConfig!.apiKey,
            api_secret: this.tokenRefreshConfig!.apiSecret,
          }),
        });

        if (!response.ok) {
          throw new ApiCentralError({
            message: 'Failed to refresh token',
            statusCode: response.status,
          });
        }

        const data = await response.json() as { access_token: string };
        const newToken = data.access_token;

        // Update the authorization header
        this.setHeader('Authorization', `Bearer ${newToken}`);

        // Notify callback if provided
        if (this.tokenRefreshConfig!.onTokenRefreshed) {
          this.tokenRefreshConfig!.onTokenRefreshed(newToken);
        }
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = undefined;
      }
    })();

    return this.refreshPromise;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          // Convert param keys to snake_case for the API
          url.searchParams.append(camelToSnake(key), String(value));
        }
      });
    }

    return url.toString();
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    config?: RequestConfig,
    isRetry: boolean = false
  ): Promise<T> {
    const url = this.buildUrl(path, config?.params);
    const headers = { ...this.defaultHeaders, ...config?.headers };
    const timeout = config?.timeout ?? this.defaultTimeout;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // Convert request body keys to snake_case for the API
      const requestBody = body ? toSnakeCase(body) : undefined;

      const response = await fetch(url, {
        method,
        headers,
        body: requestBody ? JSON.stringify(requestBody) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle empty responses
      const text = await response.text();
      const rawData = text ? JSON.parse(text) : null;

      // Convert response keys to camelCase for the SDK
      const data = toCamelCase(rawData);

      if (!response.ok) {
        const error = ApiCentralError.fromResponse(response.status, data);

        // Check if token expired and we can refresh
        if (
          !isRetry &&
          response.status === 401 &&
          this.tokenRefreshConfig &&
          (error.message.toLowerCase().includes('token expired') ||
           error.message.toLowerCase().includes('expired'))
        ) {
          // Refresh token and retry
          console.log('[ApiCentral SDK] Token expired, refreshing...');
          await this.refreshToken();
          console.log('[ApiCentral SDK] Token refreshed, retrying request...');
          return this.request<T>(method, path, body, config, true);
        }

        throw error;
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof ApiCentralError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new ApiCentralError({
            message: `Request timeout after ${timeout}ms`,
            statusCode: 408,
            error: 'Request Timeout',
          });
        }
        throw new ApiCentralError({
          message: error.message,
          statusCode: 0,
          error: 'Network Error',
        });
      }

      throw new ApiCentralError({
        message: 'Unknown error occurred',
        statusCode: 0,
      });
    }
  }

  async get<T>(path: string, config?: RequestConfig): Promise<T> {
    return this.request<T>('GET', path, undefined, config);
  }

  async post<T>(path: string, body?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>('POST', path, body, config);
  }

  async put<T>(path: string, body?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>('PUT', path, body, config);
  }

  async patch<T>(path: string, body?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>('PATCH', path, body, config);
  }

  async delete<T>(path: string, config?: RequestConfig): Promise<T> {
    return this.request<T>('DELETE', path, undefined, config);
  }
}
