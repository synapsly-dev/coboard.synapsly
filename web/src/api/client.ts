import type { ApiError } from 'shared';

/**
 * Typed fetch wrapper (§7, §8).
 *
 * - Always sends the session cookie (`credentials: 'include'`).
 * - Adds the `X-Requested-With` header on every request; the server enforces it
 *   on writes as the CSRF guard (§8).
 * - Parses the unified error shape `{ error: { code, message, fields? } }` and
 *   throws a structured {@link ApiClientError} so callers can branch on
 *   `code`/`status`/`fields` (e.g. show field errors, detect 401/409).
 * - Returns parsed JSON typed as the caller's generic, or `undefined` for 204.
 */

const API_PREFIX = '/api';

/** Field-level validation errors: field path -> messages. Mirrors §7. */
export type FieldErrors = Record<string, string[]>;

/**
 * Structured client-side error. Shape mirrors the server's `AppError`
 * (status + machine code + optional field errors) so UI code can react to it.
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: FieldErrors;

  constructor(status: number, code: string, message: string, fields?: FieldErrors) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }

  /** True when the user is not (or no longer) authenticated. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** True for conflicts such as a lost claim race (§6.2 / §10). */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

/** Type guard so `catch (err)` blocks can narrow safely. */
export function isApiClientError(err: unknown): err is ApiClientError {
  return err instanceof ApiClientError;
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestOptions {
  /** Optional JSON-serializable request body. */
  body?: unknown;
  /** Query params; `undefined`/`null` values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Pass an AbortSignal to cancel in-flight requests. */
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = path.startsWith('/') ? `${API_PREFIX}${path}` : `${API_PREFIX}/${path}`;
  if (!query) return base;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    search.append(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Narrow an unknown JSON value to the §7 error shape. */
function parseApiError(payload: unknown): ApiError['error'] | null {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'error' in payload &&
    typeof (payload as { error: unknown }).error === 'object' &&
    (payload as { error: unknown }).error !== null
  ) {
    return (payload as ApiError).error;
  }
  return null;
}

async function request<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    // CSRF guard (§8): server requires this header on writes; harmless on reads.
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const init: RequestInit = {
    method,
    credentials: 'include',
    headers,
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) {
    init.signal = options.signal;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), init);
  } catch {
    // Network failure / aborted request — surface as a generic client error.
    throw new ApiClientError(
      0,
      'network_error',
      '网络连接失败，请检查网络后重试',
    );
  }

  // 204 No Content (e.g. DELETE) — nothing to parse.
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    const apiError = parseApiError(payload);
    if (apiError) {
      throw new ApiClientError(
        response.status,
        apiError.code,
        apiError.message,
        apiError.fields,
      );
    }
    throw new ApiClientError(
      response.status,
      'unexpected_error',
      typeof payload === 'string' && payload ? payload : '请求失败，请稍后重试',
    );
  }

  return payload as T;
}

/** Public, method-specific helpers — the surface downstream hooks build on. */
export const api = {
  get: <T>(path: string, options?: Pick<RequestOptions, 'query' | 'signal'>): Promise<T> =>
    request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> =>
    request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> =>
    request<T>('PATCH', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> =>
    request<T>('PUT', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>('DELETE', path, options),
};
