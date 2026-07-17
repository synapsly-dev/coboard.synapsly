import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { OrgApplication, OrgMemberRole, OrgNode } from 'shared';
import { ActionButton, Avatar, Field } from '../../components/ui';
import { coboardClient } from '../../platform/coboard-client';
import { isPositionFull } from './model';

export interface OrgCandidate {
  id: string;
  displayName: string;
  avatarColor: string;
  hasAvatar: boolean;
}

type Assignment = OrgMemberRole | 'none';

function notifyError(error: unknown): void {
  const message = error instanceof Error ? error.message : '操作失败，请重试';
  void Taro.showToast({ title: message, icon: 'none' });
}

export function MembershipControl({
  node,
  userId,
  applications,
  canManage,
  compact = false,
}: {
  node: OrgNode;
  userId?: string;
  applications: OrgApplication[];
  canManage: boolean;
  compact?: boolean;
}): JSX.Element | null {
  const queryClient = useQueryClient();
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['org'] });
  };
  const joinTrack = useMutation({
    mutationFn: () => coboardClient.tracks.join(node.trackId!),
    onSuccess: invalidate,
    onError: notifyError,
  });
  const leaveTrack = useMutation({
    mutationFn: () => coboardClient.tracks.leave(node.trackId!),
    onSuccess: invalidate,
    onError: notifyError,
  });
  const apply = useMutation({
    mutationFn: () => coboardClient.org.apply(node.id, {}),
    onSuccess: invalidate,
    onError: notifyError,
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => coboardClient.org.withdraw(id),
    onSuccess: invalidate,
    onError: notifyError,
  });
  const leave = useMutation({
    mutationFn: () => coboardClient.org.leave(node.id),
    onSuccess: invalidate,
    onError: notifyError,
  });

  const isLead = node.leads.some((person) => person.userId === userId);
  const isMember = node.members.some((person) => person.userId === userId);
  const pending = applications.find(
    (application) =>
      application.nodeId === node.id &&
      application.applicant.id === userId &&
      application.status === 'pending',
  );
  const busy =
    joinTrack.isPending ||
    leaveTrack.isPending ||
    apply.isPending ||
    withdraw.isPending ||
    leave.isPending;

  useEffect(() => {
    if (node.kind !== 'track') return;
    console.info('[org/membership] track state', {
      nodeId: node.id,
      title: node.title,
      userId,
      isLead,
      isMember,
      hasPendingApplication: Boolean(pending),
      canManage,
      renderedState: isLead ? 'manager' : isMember ? 'member' : pending ? 'pending' : 'join',
    });
  }, [canManage, isLead, isMember, node.id, node.kind, node.title, pending, userId]);

  if (!userId) return null;

  if (isLead) {
    return (
      <Text className={`org-membership org-membership--lead ${compact ? 'is-compact' : ''}`}>
        ♛ {node.kind === 'track' ? (compact ? '经理' : '赛道经理') : '负责人'}
      </Text>
    );
  }

  const confirmLeave = async (): Promise<void> => {
    const result = await Taro.showModal({
      title: `退出“${node.title}”？`,
      content: '退出后如需重新加入，可能需要负责人再次审批。',
      confirmText: '确认退出',
    });
    if (!result.confirm) return;
    if (node.kind === 'track') leaveTrack.mutate();
    else leave.mutate();
  };

  if (isMember) {
    return (
      <Text
        className={`org-membership org-membership--joined ${compact ? 'is-compact' : ''}`}
        onClick={() => void confirmLeave()}
      >
        {busy ? '处理中…' : '已加入'}
      </Text>
    );
  }

  if (pending) {
    return (
      <Text
        className={`org-membership org-membership--pending ${compact ? 'is-compact' : ''}`}
        onClick={() => !busy && withdraw.mutate(pending.id)}
      >
        {busy ? '处理中…' : '申请中 · 撤回'}
      </Text>
    );
  }

  // Web 端的赛道始终保留即时加入入口，即使当前用户同时是全局管理员。
  // 只有需要审批的部门 / 小组 / 岗位，才在管理员未加入时隐藏自助申请。
  if (canManage && node.kind !== 'track') return null;
  if (isPositionFull(node)) {
    return <Text className={`org-membership is-disabled ${compact ? 'is-compact' : ''}`}>名额已满</Text>;
  }

  return (
    <Text
      className={`org-membership org-membership--apply ${compact ? 'is-compact' : ''}`}
      onClick={() => {
        if (busy) return;
        if (node.kind === 'track') joinTrack.mutate();
        else apply.mutate();
      }}
    >
      {busy ? '处理中…' : node.kind === 'position' ? '申报' : node.kind === 'track' ? '↪ 加入' : '申请加入'}
    </Text>
  );
}

export function MembersDialog({
  node,
  mode,
  onClose,
}: {
  node: OrgNode;
  mode: 'manage' | 'add';
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [assignments, setAssignments] = useState<Record<string, Assignment>>(() => {
    const initial: Record<string, Assignment> = {};
    node.leads.forEach((person) => {
      initial[person.userId] = 'lead';
    });
    node.members.forEach((person) => {
      initial[person.userId] = 'member';
    });
    return initial;
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const candidatesQuery = useQuery({
    queryKey: ['org', 'member-candidates', node.trackId ?? 'all'],
    queryFn: async (): Promise<OrgCandidate[]> => {
      const source = node.trackId
        ? (await coboardClient.tracks.memberCandidates(node.trackId)).users
        : (await coboardClient.users.list()).users.filter((candidate) => candidate.isActive);
      const normalized: OrgCandidate[] = source.map((candidate) => ({
        id: candidate.id,
        displayName: candidate.displayName,
        avatarColor: candidate.avatarColor,
        hasAvatar: candidate.hasAvatar,
      }));
      const known = new Set(normalized.map((candidate) => candidate.id));
      for (const person of [...node.leads, ...node.members]) {
        if (known.has(person.userId)) continue;
        normalized.push({
          id: person.userId,
          displayName: person.displayName,
          avatarColor: person.avatarColor,
          hasAvatar: person.hasAvatar,
        });
      }
      return normalized;
    },
  });

  const candidates = candidatesQuery.data ?? [];
  const currentIds = useMemo(
    () => new Set([...node.leads, ...node.members].map((person) => person.userId)),
    [node],
  );
  const visible = candidates.filter((candidate) => {
    const matches = candidate.displayName.toLowerCase().includes(filter.trim().toLowerCase());
    return matches && (mode === 'manage' || !currentIds.has(candidate.id));
  });
  const counts = Object.values(assignments).reduce(
    (result, assignment) => {
      if (assignment === 'lead') result.leads += 1;
      if (assignment === 'member') result.members += 1;
      return result;
    },
    { leads: 0, members: 0 },
  );

  const setMembers = useMutation({
    mutationFn: async (): Promise<void> => {
      let leads: string[];
      let members: string[];
      if (mode === 'add') {
        leads = node.leads.map((person) => person.userId);
        members = node.members.map((person) => person.userId);
        candidates.forEach((candidate) => {
          if (selected.has(candidate.id) && !currentIds.has(candidate.id)) members.push(candidate.id);
        });
      } else {
        leads = candidates.filter((candidate) => assignments[candidate.id] === 'lead').map((candidate) => candidate.id);
        members = candidates.filter((candidate) => assignments[candidate.id] === 'member').map((candidate) => candidate.id);
      }
      if (!node.trackId && leads.length > 1) throw new Error('一个节点只能设置一位负责人');
      if (node.trackId) {
        await coboardClient.tracks.setMembers(node.trackId, { managers: leads, members });
      } else {
        await coboardClient.org.setMembers(node.id, { leads, members });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org'] });
      onClose();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '保存失败，请重试'),
  });

  const cycle = (id: string): void => {
    setAssignments((current) => {
      const next = { ...current };
      const assignment = current[id] ?? 'none';
      const value: Assignment = assignment === 'none' ? 'lead' : assignment === 'lead' ? 'member' : 'none';
      if (value === 'lead' && !node.trackId) {
        Object.keys(next).forEach((candidateId) => {
          if (next[candidateId] === 'lead') next[candidateId] = 'member';
        });
      }
      next[id] = value;
      return next;
    });
  };

  const toggleSelected = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <View className="org-dialog-backdrop" onClick={onClose}>
      <View className="org-dialog org-dialog--members" onClick={(event) => event.stopPropagation()}>
        <View className="org-dialog__header">
          <Text className="org-dialog__title">
            {mode === 'add' ? `加入成员到“${node.title}”` : `设置“${node.title}”的负责人与成员`}
          </Text>
          {mode === 'manage' && (
            <Text className="org-dialog__description">
              点击成员切换：无 → {node.trackId ? '赛道经理' : '负责人'} → 成员。当前 {counts.leads} 位负责人、{counts.members} 位成员。
            </Text>
          )}
        </View>
        <View className="org-dialog__body stack">
          <Field label="搜索成员" value={filter} placeholder="输入成员姓名" onChange={setFilter} />
          <View className="org-candidate-list">
            {candidatesQuery.isLoading ? (
              <Text className="org-dialog__placeholder">加载中…</Text>
            ) : visible.length === 0 ? (
              <Text className="org-dialog__placeholder">
                {filter.trim() ? '没有匹配的人' : mode === 'add' ? '大家都已在该单元' : '没有可选成员'}
              </Text>
            ) : (
              visible.map((candidate) => {
                const assignment = assignments[candidate.id] ?? 'none';
                const picked = selected.has(candidate.id);
                return (
                  <View
                    key={candidate.id}
                    className={`org-candidate ${assignment !== 'none' || picked ? 'is-selected' : ''}`}
                    onClick={() => mode === 'add' ? toggleSelected(candidate.id) : cycle(candidate.id)}
                  >
                    <Avatar name={candidate.displayName} color={candidate.avatarColor} userId={candidate.id} hasAvatar={candidate.hasAvatar} />
                    <Text className="org-candidate__name">{candidate.displayName}</Text>
                    {mode === 'add' ? (
                      <Text className={`org-candidate__check ${picked ? 'is-checked' : ''}`}>{picked ? '✓' : ''}</Text>
                    ) : (
                      <Text className={`org-assignment org-assignment--${assignment}`}>
                        {assignment === 'lead' ? `♛ ${node.trackId ? '赛道经理' : '负责人'}` : assignment === 'member' ? '成员' : '未选'}
                      </Text>
                    )}
                  </View>
                );
              })
            )}
          </View>
          {error && <Text className="org-dialog__error">{error}</Text>}
        </View>
        <View className="org-dialog__footer">
          <ActionButton tone="ghost" onClick={onClose}>取消</ActionButton>
          <ActionButton
            loading={setMembers.isPending}
            disabled={mode === 'add' && selected.size === 0}
            onClick={() => setMembers.mutate()}
          >
            {mode === 'add' ? `加入${selected.size ? ` ${selected.size} 人` : ''}` : '保存'}
          </ActionButton>
        </View>
      </View>
    </View>
  );
}
