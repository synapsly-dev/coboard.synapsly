import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  Asset,
  AssetResponse,
  AssetsQuery,
  AssetsResponse,
  CreateAssetInput,
  UpdateAssetInput,
} from 'shared';
import { api } from './client';
import { queryKeys } from '../lib/query';

/**
 * 资产库 hooks (P3 §1, 运营需求 §9) — 内容库/反馈库/资源库/问题清单. Every member can
 * read and create; edit/delete is the author, a global admin, or a 赛道经理 (the
 * server enforces it, the UI just hides the controls). Lists are parameterized by
 * kind/track but all live under the `['assets']` prefix, so mutations invalidate
 * that prefix once and SSE refreshes peers via the `asset` channel (§6.5).
 */

/** Low-level fetchers — shared by hooks and mutation onSuccess refetches. */
export const assetsApi = {
  list: (query: AssetsQuery, signal?: AbortSignal): Promise<AssetsResponse> =>
    api.get<AssetsResponse>('/assets', {
      query: { kind: query.kind, trackId: query.trackId },
      signal,
    }),
  create: (input: CreateAssetInput): Promise<AssetResponse> =>
    api.post<AssetResponse>('/assets', input),
  update: (id: string, input: UpdateAssetInput): Promise<AssetResponse> =>
    api.patch<AssetResponse>(`/assets/${id}`, input),
  remove: (id: string): Promise<void> => api.delete<void>(`/assets/${id}`),
};

/** Assets matching the server-side filters, newest first (P3 §1 GET /assets). */
export function useAssets(query: AssetsQuery = {}): UseQueryResult<Asset[]> {
  return useQuery<Asset[]>({
    queryKey: queryKeys.assets(query.kind, query.trackId),
    queryFn: async ({ signal }) => (await assetsApi.list(query, signal)).assets,
  });
}

/** Create an asset (any member) — POST /assets. */
export function useCreateAsset(): UseMutationResult<Asset, Error, CreateAssetInput> {
  const queryClient = useQueryClient();
  return useMutation<Asset, Error, CreateAssetInput>({
    mutationFn: async (input) => (await assetsApi.create(input)).asset,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

/** Variables for an asset edit. */
export interface UpdateAssetVars {
  id: string;
  input: UpdateAssetInput;
}

/** Edit an asset (author / admin / 赛道经理) — PATCH /assets/:id. */
export function useUpdateAsset(): UseMutationResult<Asset, Error, UpdateAssetVars> {
  const queryClient = useQueryClient();
  return useMutation<Asset, Error, UpdateAssetVars>({
    mutationFn: async ({ id, input }) => (await assetsApi.update(id, input)).asset,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

/** Delete an asset (author / admin / 赛道经理) — DELETE /assets/:id. */
export function useDeleteAsset(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => assetsApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}
