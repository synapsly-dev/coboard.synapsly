import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { Asset, AssetsQuery, CreateAssetInput, UpdateAssetInput } from 'shared';
import { queryKeys } from 'client-core';
import { coboardClient } from '../platform/coboard-client';

/**
 * 资产库 hooks (P3 §1, 运营需求 §9) — 内容库/反馈库/资源库/问题清单. Every member can
 * read and create; edit/delete is the author, a global admin, or a 赛道经理 (the
 * server enforces it, the UI just hides the controls). Lists are parameterized by
 * kind/track but all live under the `['assets']` prefix, so mutations invalidate
 * that prefix once and SSE refreshes peers via the `asset` channel (§6.5).
 */

/** Low-level fetchers — shared by hooks and mutation onSuccess refetches. */
/** Assets matching the server-side filters, newest first (P3 §1 GET /assets). */
export function useAssets(query: AssetsQuery = {}): UseQueryResult<Asset[]> {
  return useQuery<Asset[]>({
    queryKey: queryKeys.assets(query.kind, query.trackId),
    queryFn: async ({ signal }) => (await coboardClient.assets.list(query, signal)).assets,
  });
}

/** Create an asset (any member) — POST /assets. */
export function useCreateAsset(): UseMutationResult<Asset, Error, CreateAssetInput> {
  const queryClient = useQueryClient();
  return useMutation<Asset, Error, CreateAssetInput>({
    mutationFn: async (input) => (await coboardClient.assets.create(input)).asset,
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
    mutationFn: async ({ id, input }) => (await coboardClient.assets.update(id, input)).asset,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

/** Delete an asset (author / admin / 赛道经理) — DELETE /assets/:id. */
export function useDeleteAsset(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => coboardClient.assets.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}
