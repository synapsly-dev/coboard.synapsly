import { ApiClientError } from '../api/client';
import type { FileTransferAdapter } from 'client-core';

const API_PREFIX = '/api';

export const webFileTransfer: FileTransferAdapter<File> = {
  async upload<T>(path: string, file: File): Promise<T> {
    const form = new FormData();
    form.append('file', file);
    let response: Response;
    try {
      response = await fetch(`${API_PREFIX}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
        body: form,
      });
    } catch {
      throw new ApiClientError(0, 'network_error', '网络连接失败，请检查网络后重试');
    }
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    if (!response.ok) {
      throw new ApiClientError(
        response.status,
        payload?.error?.code ?? 'upload_failed',
        payload?.error?.message ?? '上传失败，请稍后重试',
      );
    }
    return payload as T;
  },
  downloadUrl(path: string, inline = false): string {
    return `${API_PREFIX}${path}${inline ? '?inline=1' : ''}`;
  },
};
