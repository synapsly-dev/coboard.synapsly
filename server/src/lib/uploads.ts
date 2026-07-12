import type { FastifyReply, FastifyRequest } from 'fastify';
import { isInlinePreviewable } from 'shared';
import { AppError, ErrorCode, validationError } from './errors.js';

/**
 * Shared helpers for the multipart file-upload routes (task / idea / comment
 * attachments). Owns the single-file read with the 5MB cap and the hardened
 * download response (nosniff + attachment-by-default Content-Disposition), so
 * every upload surface enforces identical limits and headers.
 */

/** Single-file upload cap (§7.2): 5 MB. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface UploadedFile {
  filename: string;
  mime: string;
  data: Buffer;
}

/**
 * Read the single uploaded file from a multipart request, enforcing the 5MB cap
 * (busboy hard-caps the stream; the truncated-flag check is belt-and-suspenders)
 * and rejecting empty files. Throws 400/413 AppErrors with friendly messages.
 */
export async function readUploadedFile(request: FastifyRequest): Promise<UploadedFile> {
  if (!request.isMultipart()) {
    throw validationError('请使用 multipart/form-data 上传文件');
  }

  const part = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
  if (!part) {
    throw validationError('未找到上传的文件');
  }

  // With throwFileSizeLimit (the default) `toBuffer()` THROWS once the cap is
  // hit; translate that into a 413 with a friendly message.
  let data: Buffer;
  try {
    data = await part.toBuffer();
  } catch (err) {
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new AppError(413, ErrorCode.VALIDATION, '文件过大，单个文件不能超过 5MB');
    }
    throw err;
  }
  if (part.file.truncated || data.length > MAX_UPLOAD_BYTES) {
    throw new AppError(413, ErrorCode.VALIDATION, '文件过大，单个文件不能超过 5MB');
  }
  if (data.length === 0) {
    throw validationError('文件为空');
  }

  return {
    filename: part.filename || '未命名文件',
    mime: part.mimetype || 'application/octet-stream',
    data,
  };
}

/**
 * Build a Content-Disposition value that survives non-ASCII (e.g. Chinese)
 * filenames. Provides an ASCII fallback plus the RFC 5987 `filename*` form so
 * browsers preserve the original name. `type` is `attachment` (download) by
 * default, or `inline` for an in-app preview of a whitelisted mime.
 */
export function contentDisposition(
  filename: string,
  type: 'attachment' | 'inline' = 'attachment',
): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export interface FileBytes {
  filename: string;
  mime: string;
  bytes: Buffer;
}

/**
 * Send stored file bytes as a hardened download/preview response. Serves inline
 * only when the client asks (?inline=1) AND the mime is on the preview whitelist
 * (images + PDF) — anything else is always a download, so an uploaded HTML/SVG/
 * etc. can never be rendered as a document in our origin. `nosniff` stops the
 * browser sniffing a different (executable) type.
 */
export function sendFileBytes(
  request: FastifyRequest,
  reply: FastifyReply,
  file: FileBytes,
): FastifyReply {
  const wantsInline = (request.query as { inline?: string } | undefined)?.inline === '1';
  const inline = wantsInline && isInlinePreviewable(file.mime);

  reply.header('Content-Type', file.mime);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Content-Disposition', contentDisposition(file.filename, inline ? 'inline' : 'attachment'));
  // A fileId's bytes never change (attachments are create/delete only), so the
  // browser may cache them — thumbnails in comment threads / the 灵感区 grid
  // would otherwise re-download full files on every remount. `private` keeps
  // shared caches out (these URLs are cookie-authorized).
  reply.header('Cache-Control', 'private, max-age=31536000, immutable');
  return reply.send(file.bytes);
}
