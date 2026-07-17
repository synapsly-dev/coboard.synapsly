import { Text, View } from '@tarojs/components';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { OrgNode, OrgNodeKind } from 'shared';
import { ActionButton, Field, SelectField } from '../../components/ui';
import { coboardClient } from '../../platform/coboard-client';
import { ORG_KIND_LABELS, ORG_KIND_OPTIONS } from './model';

export type NodeEditorState =
  | { mode: 'create'; parentId: string | null; defaultKind?: OrgNodeKind }
  | { mode: 'edit'; node: OrgNode };

export function OrgNodeEditor({ state, onClose }: { state: NodeEditorState; onClose: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const editing = state.mode === 'edit' ? state.node : null;
  const canCreateTrack = state.mode === 'create' && state.parentId === null;
  const kindOptions = useMemo<OrgNodeKind[]>(
    () => canCreateTrack ? ['department', 'track', 'group', 'position'] : ORG_KIND_OPTIONS,
    [canCreateTrack],
  );
  const [title, setTitle] = useState(editing?.title ?? '');
  const [kind, setKind] = useState<OrgNodeKind>(
    editing?.kind ?? (state.mode === 'create' ? state.defaultKind ?? (state.parentId ? 'group' : 'department') : 'department'),
  );
  const [description, setDescription] = useState(editing?.description ?? '');
  const [headcount, setHeadcount] = useState(editing?.headcount == null ? '' : String(editing.headcount));
  const [trackKey, setTrackKey] = useState('');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      const normalizedTitle = title.trim();
      if (!normalizedTitle) throw new Error('名称不能为空');
      let parsedHeadcount: number | null = null;
      if (kind === 'position' && headcount.trim()) {
        const value = Number(headcount.trim());
        if (!Number.isInteger(value) || value < 1 || value > 999) {
          throw new Error('名额需为 1-999 的整数（留空表示不限）');
        }
        parsedHeadcount = value;
      }
      const normalizedDescription = description.trim() || null;
      if (editing) {
        await coboardClient.org.update(editing.id, {
          title: normalizedTitle,
          kind,
          description: normalizedDescription,
          headcount: parsedHeadcount,
        });
        return;
      }
      if (kind === 'track') {
        const normalizedKey = trackKey.trim().toLowerCase();
        if (!/^[a-z0-9-]{2,20}$/.test(normalizedKey)) {
          throw new Error('赛道标识需为 2-20 位小写字母、数字或连字符');
        }
        await coboardClient.tracks.create({
          name: normalizedTitle,
          key: normalizedKey,
          ...(normalizedDescription ? { description: normalizedDescription } : {}),
        });
        return;
      }
      await coboardClient.org.create({
        scope: 'all',
        parentId: state.mode === 'create' ? state.parentId : null,
        kind,
        title: normalizedTitle,
        description: normalizedDescription,
        headcount: parsedHeadcount,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org'] });
      void queryClient.invalidateQueries({ queryKey: ['tracks'] });
      onClose();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '保存失败，请重试'),
  });

  return (
    <View className="org-dialog-backdrop" onClick={onClose}>
      <View className="org-dialog" onClick={(event) => event.stopPropagation()}>
        <View className="org-dialog__header">
          <Text className="org-dialog__title">{editing ? '编辑节点' : '新增节点'}</Text>
          <Text className="org-dialog__description">设置类型、名称与团队职责说明。</Text>
        </View>
        <View className="org-dialog__body stack">
          <Field label="名称" value={title} placeholder="名称" onChange={setTitle} />
          <SelectField
            label="类型"
            range={kindOptions.map((item) => ORG_KIND_LABELS[item])}
            value={Math.max(0, kindOptions.indexOf(kind))}
            valueLabel={ORG_KIND_LABELS[kind]}
            onChange={(index) => setKind(kindOptions[index] ?? 'department')}
          />
          {kind === 'track' && (
            <>
              <Field label="赛道标识" value={trackKey} placeholder="track-key" onChange={(value) => setTrackKey(value.toLowerCase())} />
              <Text className="org-dialog__hint">2-20 位小写字母、数字或连字符。</Text>
            </>
          )}
          {kind === 'position' && (
            <>
              <Field label="名额" value={headcount} placeholder="不限" onChange={setHeadcount} />
              <Text className="org-dialog__hint">留空表示不限名额；满员后将无法申报。</Text>
            </>
          )}
          <Field label="说明（可选）" value={description} placeholder="备注" multiline onChange={setDescription} />
          {error && <Text className="org-dialog__error">{error}</Text>}
        </View>
        <View className="org-dialog__footer">
          <ActionButton tone="ghost" onClick={onClose}>取消</ActionButton>
          <ActionButton loading={save.isPending} disabled={!title.trim()} onClick={() => save.mutate()}>
            {editing ? '保存' : '创建'}
          </ActionButton>
        </View>
      </View>
    </View>
  );
}
