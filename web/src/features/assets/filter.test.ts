import { describe, expect, it } from 'vitest';
import type { Asset } from 'shared';
import { filterAssets, TRACK_ALL, TRACK_NONE } from './filter';

/**
 * Unit coverage for the client-side asset refinement (P3 §1): the 通用 (no-track)
 * choice — which the API's trackId param can't express — and the title/body search.
 */

function makeAsset(
  overrides: Partial<Asset> & Pick<Asset, 'id' | 'title' | 'body'>,
): Asset {
  return {
    kind: 'content',
    url: null,
    trackId: null,
    trackName: null,
    taskId: null,
    taskTitle: null,
    creator: {
      id: 'user-1',
      displayName: '张三',
      avatarColor: '#3b82f6',
      hasAvatar: false,
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

const ASSETS: Asset[] = [
  makeAsset({ id: 'a1', title: '爆款标题拆解', body: '结构：钩子 + 冲突 + 反转' }),
  makeAsset({
    id: 'a2',
    title: '用户访谈记录',
    body: '用户说导出太难找',
    trackId: 'track-1',
    trackName: '短视频',
  }),
  makeAsset({ id: 'a3', title: '剪辑模板', body: '' , trackId: 'track-1', trackName: '短视频' }),
];

describe('filterAssets', () => {
  it('passes everything through for 全部 with no search', () => {
    expect(filterAssets(ASSETS, { trackFilter: TRACK_ALL, search: '' })).toHaveLength(3);
  });

  it('keeps only no-track assets for the 通用 choice', () => {
    const out = filterAssets(ASSETS, { trackFilter: TRACK_NONE, search: '' });
    expect(out.map((a) => a.id)).toEqual(['a1']);
  });

  it('matches search against title OR body, case-insensitively and trimmed', () => {
    expect(
      filterAssets(ASSETS, { trackFilter: TRACK_ALL, search: ' 模板 ' }).map((a) => a.id),
    ).toEqual(['a3']);
    expect(
      filterAssets(ASSETS, { trackFilter: TRACK_ALL, search: '导出' }).map((a) => a.id),
    ).toEqual(['a2']);
    expect(filterAssets(ASSETS, { trackFilter: TRACK_ALL, search: '不存在' })).toEqual([]);
  });

  it('combines the 通用 choice with search', () => {
    expect(
      filterAssets(ASSETS, { trackFilter: TRACK_NONE, search: '钩子' }).map((a) => a.id),
    ).toEqual(['a1']);
    expect(filterAssets(ASSETS, { trackFilter: TRACK_NONE, search: '导出' })).toEqual([]);
  });
});
