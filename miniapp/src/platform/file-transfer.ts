import Taro from '@tarojs/taro';
import { CoboardClientError, type FileTransferAdapter } from 'client-core';
import { absoluteApiUrl } from './http';
import { sessionStore } from './session';

export interface MiniappFile {
  path: string;
  name?: string;
}

export const taroFileTransfer: FileTransferAdapter<MiniappFile> = {
  async upload<T>(path: string, file: MiniappFile): Promise<T> {
    const token = sessionStore.token();
    try {
      const response = await Taro.uploadFile({
        url: absoluteApiUrl(path),
        filePath: file.path,
        name: 'file',
        fileName: file.name,
        header: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const payload = JSON.parse(response.data) as T & {
        error?: { code?: string; message?: string };
      };
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new CoboardClientError(
          response.statusCode,
          payload.error?.code ?? 'upload_failed',
          payload.error?.message ?? '上传失败，请稍后重试',
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof CoboardClientError) throw error;
      throw new CoboardClientError(0, 'network_error', '上传失败，请检查网络后重试');
    }
  },
  downloadUrl(path, inline = false): string {
    return `${absoluteApiUrl(path)}${inline ? '?inline=1' : ''}`;
  },
};
