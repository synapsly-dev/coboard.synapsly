import Taro from '@tarojs/taro';
import { CoboardClientError, type HttpAdapter, type HttpRequest } from 'client-core';
import { API_BASE } from '../config';
import { sessionStore } from './session';

function urlFor(path: string): string {
  return `${API_BASE}/api${path.startsWith('/') ? path : `/${path}`}`;
}

function errorFrom(status: number, payload: unknown): CoboardClientError {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (
      payload as { error?: { code?: string; message?: string; fields?: Record<string, string[]> } }
    ).error;
    if (error) {
      return new CoboardClientError(
        status,
        error.code ?? 'unexpected_error',
        error.message ?? '请求失败，请稍后重试',
        error.fields,
      );
    }
  }
  return new CoboardClientError(status, 'unexpected_error', '请求失败，请稍后重试');
}

export const taroHttpAdapter: HttpAdapter = {
  async request<T>(request: HttpRequest): Promise<T> {
    const token = sessionStore.token();
    try {
      const response = await Taro.request<T>({
        url: urlFor(request.path),
        method: request.method,
        data: request.method === 'GET' ? request.query : request.body,
        header: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        if (response.statusCode === 401) sessionStore.clear();
        throw errorFrom(response.statusCode, response.data);
      }
      return response.data;
    } catch (error) {
      if (error instanceof CoboardClientError) throw error;
      throw new CoboardClientError(0, 'network_error', '网络连接失败，请检查网络后重试');
    }
  },
};

export function absoluteApiUrl(path: string): string {
  return urlFor(path);
}
