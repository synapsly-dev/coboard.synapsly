import type { ApiError } from 'shared';

/**
 * Domain error type + the §7 error shape. Services throw `AppError`; the Fastify
 * global error handler (src/index.ts) serializes it to `{ error: { code, message,
 * fields? } }` with a semantic HTTP status.
 */

/** Stable machine-readable error codes (§7: 400/401/403/404/409). */
export const ErrorCode = {
  VALIDATION: 'validation_error', // 400
  UNAUTHORIZED: 'unauthorized', // 401
  FORBIDDEN: 'forbidden', // 403
  NOT_FOUND: 'not_found', // 404
  CONFLICT: 'conflict', // 409
  RATE_LIMITED: 'rate_limited', // 429
  INTERNAL: 'internal_error', // 500
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Field-level validation messages: field path -> list of messages. */
export type FieldErrors = Record<string, string[]>;

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCodeValue;
  readonly fields?: FieldErrors;

  constructor(
    statusCode: number,
    code: ErrorCodeValue,
    message: string,
    fields?: FieldErrors,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (fields) this.fields = fields;
  }

  /** Serialize to the §7 wire shape. */
  toResponse(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
      },
    };
  }
}

// Convenience constructors -------------------------------------------------

export function validationError(message: string, fields?: FieldErrors): AppError {
  return new AppError(400, ErrorCode.VALIDATION, message, fields);
}

export function unauthorized(message = '请先登录'): AppError {
  return new AppError(401, ErrorCode.UNAUTHORIZED, message);
}

export function forbidden(message = '没有权限执行该操作'): AppError {
  return new AppError(403, ErrorCode.FORBIDDEN, message);
}

export function notFound(message = '资源不存在'): AppError {
  return new AppError(404, ErrorCode.NOT_FOUND, message);
}

export function conflict(message = '操作冲突'): AppError {
  return new AppError(409, ErrorCode.CONFLICT, message);
}

/** Type guard for the global error handler. */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
