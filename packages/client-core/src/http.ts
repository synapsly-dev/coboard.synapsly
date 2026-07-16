export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface HttpRequest {
  method: HttpMethod;
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

export interface HttpAdapter {
  request<T>(request: HttpRequest): Promise<T>;
}

export type FieldErrors = Record<string, string[]>;

export class CoboardClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: FieldErrors,
  ) {
    super(message);
    this.name = 'CoboardClientError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isConflict(): boolean {
    return this.status === 409;
  }
}

export function isCoboardClientError(error: unknown): error is CoboardClientError {
  return error instanceof CoboardClientError;
}
