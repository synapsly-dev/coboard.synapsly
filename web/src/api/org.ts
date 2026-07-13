import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  CreateOrgApplicationInput,
  CreateOrgNodeInput,
  DecideOrgApplicationInput,
  MoveOrgNodeInput,
  OrgApplication,
  OrgApplicationResponse,
  OrgApplicationsResponse,
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
 *
 * 岗位申报 (P1) lives here too: the combined applications read (own applications +
 * decidable pending ones) plus apply / withdraw / approve / reject mutations. An
 * approval writes the org_node_members row, so application mutations invalidate the
 * scope's tree as well as the applications list.
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
  leave: (id: string): Promise<OrgNode> =>
    api.post<OrgNodeResponse>(`/org/nodes/${id}/leave`).then((r) => r.node),
  applications: (scope: OrgScope, signal?: AbortSignal): Promise<OrgApplicationsResponse> =>
    api.get<OrgApplicationsResponse>('/org/applications', { query: { scope }, signal }),
  apply: (nodeId: string, input: CreateOrgApplicationInput): Promise<OrgApplication> =>
    api
      .post<OrgApplicationResponse>(`/org/nodes/${nodeId}/applications`, input)
      .then((r) => r.application),
  withdraw: (id: string): Promise<OrgApplication> =>
    api.delete<OrgApplicationResponse>(`/org/applications/${id}`).then((r) => r.application),
  decide: (
    id: string,
    decision: 'approve' | 'reject',
    input: DecideOrgApplicationInput,
  ): Promise<OrgApplication> =>
    api
      .post<OrgApplicationResponse>(`/org/applications/${id}/${decision}`, input)
      .then((r) => r.application),
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
function invalidateScope(queryClient: ReturnType<typeof useQueryClient>, scope: OrgScope): void {
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

export function useDeleteOrgNode(scope: OrgScope): UseMutationResult<void, Error, string> {
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

/**
 * Self-leave a 部门/小组/岗位 (POST /org/nodes/:id/leave). Removes the caller's own
 * member row; the server rejects a 负责人 and is idempotent for a non-member. Also
 * invalidates the applications list so a re-apply reflects the fresh state.
 */
export function useLeaveOrgNode(scope: OrgScope): UseMutationResult<OrgNode, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<OrgNode, Error, string>({
    mutationFn: (id) => orgApi.leave(id),
    onSuccess: () => {
      invalidateScope(queryClient, scope);
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgApplications(scope) });
    },
  });
}

// ---------------------------------------------------------------------------
// 岗位申报 (P1) — apply to / withdraw from / decide on `position` nodes.
// ---------------------------------------------------------------------------

/**
 * The caller's applications (any status) plus pending ones on nodes they may
 * decide; `canDecideNodeIds` marks where to show approve/reject controls.
 */
export function useOrgApplications(scope: OrgScope): UseQueryResult<OrgApplicationsResponse> {
  return useQuery<OrgApplicationsResponse>({
    queryKey: queryKeys.orgApplications(scope),
    queryFn: ({ signal }) => orgApi.applications(scope, signal),
  });
}

/** Invalidate a scope's applications AND its tree (approvals change node members). */
function invalidateApplications(
  queryClient: ReturnType<typeof useQueryClient>,
  scope: OrgScope,
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.orgApplications(scope) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.orgTree(scope) });
}

export interface ApplyToPositionVars {
  nodeId: string;
  input: CreateOrgApplicationInput;
}

/** POST /org/nodes/:id/applications — 申报 a position. */
export function useApplyToPosition(
  scope: OrgScope,
): UseMutationResult<OrgApplication, Error, ApplyToPositionVars> {
  const queryClient = useQueryClient();
  return useMutation<OrgApplication, Error, ApplyToPositionVars>({
    mutationFn: ({ nodeId, input }) => orgApi.apply(nodeId, input),
    onSuccess: () => invalidateApplications(queryClient, scope),
  });
}

/** DELETE /org/applications/:id — withdraw one's own pending 申报. */
export function useWithdrawApplication(
  scope: OrgScope,
): UseMutationResult<OrgApplication, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<OrgApplication, Error, string>({
    mutationFn: (id) => orgApi.withdraw(id),
    onSuccess: () => invalidateApplications(queryClient, scope),
  });
}

export interface DecideApplicationVars {
  id: string;
  decision: 'approve' | 'reject';
  input: DecideOrgApplicationInput;
}

/** POST /org/applications/:id/approve|reject — 录用 / 婉拒 (approver only). */
export function useDecideApplication(
  scope: OrgScope,
): UseMutationResult<OrgApplication, Error, DecideApplicationVars> {
  const queryClient = useQueryClient();
  return useMutation<OrgApplication, Error, DecideApplicationVars>({
    mutationFn: ({ id, decision, input }) => orgApi.decide(id, decision, input),
    onSuccess: () => invalidateApplications(queryClient, scope),
  });
}
