import type { z } from 'zod';
import { validationError, type FieldErrors } from './errors.js';

/**
 * Zod validation helpers for Fastify handlers (§7/§10). On failure they throw an
 * `AppError` (400) carrying field-level messages, which the global error handler
 * renders as `{ error: { code, message, fields } }`.
 */

/** Flatten a ZodError into the §7 `fields` map. */
function toFieldErrors(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

/**
 * Parse `data` with `schema`, throwing a 400 AppError on failure. Use for request
 * bodies, params, and query objects.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw validationError('请求参数校验失败', toFieldErrors(result.error));
  }
  return result.data;
}

/** Validate a request body. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  return parseOrThrow(schema, body);
}

/** Validate route params. */
export function parseParams<T>(schema: z.ZodType<T>, params: unknown): T {
  return parseOrThrow(schema, params);
}

/** Validate a query string object. */
export function parseQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  return parseOrThrow(schema, query);
}
