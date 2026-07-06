import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  CreateOrgNodeInput,
  MoveOrgNodeInput,
  OrgNode,
  OrgNodeResponse,
  OrgScope,
  OrgTreeResponse,
  SetOrgMembersInput,
  UpdateOrgNodeInput,
} from 'shared';
import { api } from './client';
import { queryKeys } from '../lib/query';

/**
 * Org-tree (团队架构) data hooks. One read surface — the flat, rank-ordered node
 * list for a scope (`'all'` = whole-team tree, or a project id) — plus the
 * create / edit / move / delete / set-members mutations. Every mutation invalidates
 * that scope's tree; SSE (`org` channel) also refreshes peers (§6.5).
 */

export const orgApi = {
  tree: (scope: OrgScope, signal?: AbortSignal): Promise<OrgTreeResponse> =>
    api.get<OrgTreeResponse>('/org/tree', { query: { scope }, signal }),
  create: (input: CreateOrgNodeInput): Promise<OrgNode> =>
    api.post<OrgNodeResponse>('/org/nodes', input).then((r) => r.node),
  update: (id: string, input: UpdateOrgNodeInput): Promise<OrgNode> =>
    api.patch<OrgNodeResponse>(`/org/nodes/${id}`, input).then((r) => r.node),
  move: (id: string, input: MoveOrgNodeInput): Promise<OrgNode> =>
    api.post<OrgNodeResponse>(`/org/nodes/${id}/move`, input).then((r) => r.node),
  remove: (id: string): Promise<void> => api.delete<void>(`/org/nodes/${id}`),
  setMembers: (id: string, input: SetOrgMembersInput): Promise<OrgNode> =>
    api.put<OrgNodeResponse>(`/org/nodes/${id}/members`, input).then((r) => r.node),
};

/** The org tree for a scope, as a flat node list (the page assembles the tree). */
export function useOrgTree(scope: OrgScope): UseQueryResult<OrgNode[]> {
  return useQuery<OrgNode[]>({
    queryKey: queryKeys.orgTree(scope),
    queryFn: async ({ signal }) => {
      const res = await orgApi.tree(scope, signal);
      return res.nodes;
    },
  });
}

/** Invalidate a scope's tree after a mutation. */
function invalidateScope(
  queryClient: ReturnType<typeof useQueryClient>,
  scope: OrgScope,
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.orgTree(scope) });
}

export function useCreateOrgNode(
  scope: OrgScope,
): UseMutationResult<OrgNode, Error, CreateOrgNodeInput> {
  const queryClient = useQueryClient();
  return useMutation<OrgNode, Error, CreateOrgNodeInput>({
    mutationFn: (input) => orgApi.create(input),
    onSuccess: () => invalidateScope(queryClient, scope),
  });
}

export interface UpdateOrgNodeVars {
  id: string;
  input: UpdateOrgNodeInput;
}

export function useUpdateOrgNode(
  scope: OrgScope,
): UseMutationResult<OrgNode, Error, UpdateOrgNodeVars> {
  const queryClient = useQueryClient();
  return useMutation<OrgNode, Error, UpdateOrgNodeVars>({
    mutationFn: ({ id, input }) => orgApi.update(id, input),
    onSuccess: () => invalidateScope(queryClient, scope),
  });
}

export interface MoveOrgNodeVars {
  id: string;
  input: MoveOrgNodeInput;
}

export function useMoveOrgNode(
  scope: OrgScope,
): UseMutationResult<OrgNode, Error, MoveOrgNodeVars> {
  const queryClient = useQueryClient();
  return useMutation<OrgNode, Error, MoveOrgNodeVars>({
    mutationFn: ({ id, input }) => orgApi.move(id, input),
    onSuccess: () => invalidateScope(queryClient, scope),
  });
}

export function useDeleteOrgNode(
  scope: OrgScope,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => orgApi.remove(id),
    onSuccess: () => invalidateScope(queryClient, scope),
  });
}

export interface SetOrgMembersVars {
  id: string;
  input: SetOrgMembersInput;
}

export function useSetOrgMembers(
  scope: OrgScope,
): UseMutationResult<OrgNode, Error, SetOrgMembersVars> {
  const queryClient = useQueryClient();
  return useMutation<OrgNode, Error, SetOrgMembersVars>({
    mutationFn: ({ id, input }) => orgApi.setMembers(id, input),
    onSuccess: () => invalidateScope(queryClient, scope),
  });
}
