import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { CreateLabelInput, Label, UpdateLabelInput } from 'shared';
import { queryKeys } from 'client-core';
import { coboardClient } from '../platform/coboard-client';

/**
 * Label catalog hooks (task-labels feature). The catalog is GLOBAL — one shared set
 * of `{ name, color }` labels. Reads power the LabelPicker (create dialog + task
 * drawer); any logged-in user may create a label, while rename/delete are
 * admin-only server-side. Creating/renaming/deleting invalidates the labels query;
 * deleting also refreshes the boards/tasks (a removed label detaches from tasks).
 */

/** The global label catalog, ordered by name (§ task-labels). */
export function useLabels(): UseQueryResult<Label[]> {
  return useQuery<Label[]>({
    queryKey: queryKeys.labels(),
    queryFn: async ({ signal }) => {
      const res = await coboardClient.labels.list(signal);
      return res.labels;
    },
  });
}

/** Create a catalog label (any logged-in user). Refreshes the catalog query. */
export function useCreateLabel(): UseMutationResult<Label, Error, CreateLabelInput> {
  const queryClient = useQueryClient();
  return useMutation<Label, Error, CreateLabelInput>({
    mutationFn: (body) => coboardClient.labels.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.labels() });
    },
  });
}

/** Variables for rename/recolor: label id + partial fields. */
export interface UpdateLabelVars {
  id: string;
  patch: UpdateLabelInput;
}

/** Rename / recolor a label (admin only, enforced server-side). */
export function useUpdateLabel(): UseMutationResult<Label, Error, UpdateLabelVars> {
  const queryClient = useQueryClient();
  return useMutation<Label, Error, UpdateLabelVars>({
    mutationFn: ({ id, patch }) => coboardClient.labels.update(id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.labels() });
      // A recolor/rename changes how tasks render their chips.
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/**
 * Delete a label from the catalog (admin only). Detaches it from every task
 * server-side (FK cascade), so the boards and any open task views are refreshed too.
 */
export function useDeleteLabel(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => coboardClient.labels.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.labels() });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
