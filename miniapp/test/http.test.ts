import { beforeEach, describe, expect, it, vi } from 'vitest';

const taro = vi.hoisted(() => ({
  getStorageSync: vi.fn(() => null),
  request: vi.fn(),
}));

vi.mock('@tarojs/taro', () => ({
  default: {
    eventCenter: { off: vi.fn(), on: vi.fn(), trigger: vi.fn() },
    getStorageSync: taro.getStorageSync,
    removeStorageSync: vi.fn(),
    request: taro.request,
    setStorageSync: vi.fn(),
  },
}));

import { taroHttpAdapter } from '../src/platform/http';

describe('taroHttpAdapter', () => {
  beforeEach(() => {
    taro.getStorageSync.mockReturnValue(null);
    taro.request.mockReset();
    taro.request.mockResolvedValue({ statusCode: 200, data: { ok: true } });
  });

  it('sends valid JSON for a bodyless mutation', async () => {
    await taroHttpAdapter.request({ method: 'POST', path: '/tasks/task-id/claim' });

    expect(taro.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        data: {},
        header: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('does not turn a GET query into a request body', async () => {
    await taroHttpAdapter.request({
      method: 'GET',
      path: '/tasks/all',
      query: { projectId: undefined, status: 'open' },
    });

    expect(taro.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', data: { status: 'open' } }),
    );
  });
});
