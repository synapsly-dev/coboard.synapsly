import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ApplicationStatus, OrgApplication, OrgNode } from 'shared';
import { ActionButton, Avatar, Empty, Field } from '../../components/ui';
import { coboardClient } from '../../platform/coboard-client';
import { ancestorPath, buildTree, flattenTree, isPositionFull, occupancyShort } from './model';

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: '待处理',
  approved: '已录用',
  rejected: '已婉拒',
  withdrawn: '已撤回',
};

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`;
  return new Date(value).toLocaleDateString('zh-CN');
}

function errorToast(error: unknown): void {
  void Taro.showToast({ title: error instanceof Error ? error.message : '操作失败，请重试', icon: 'none' });
}

export function OrgRecruit({
  nodes,
  applications,
  canDecideNodeIds,
  userId,
}: {
  nodes: OrgNode[];
  applications: OrgApplication[];
  canDecideNodeIds: string[];
  userId?: string;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [applyTo, setApplyTo] = useState<OrgNode | null>(null);
  const canDecide = useMemo(() => new Set(canDecideNodeIds), [canDecideNodeIds]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const groups = useMemo(() => {
    const positions = flattenTree(buildTree(nodes)).filter((node) => node.kind === 'position');
    const grouped = new Map<string, OrgNode[]>();
    positions.forEach((node) => {
      const path = ancestorPath(nodes, node).join(' / ') || '未分组';
      grouped.set(path, [...(grouped.get(path) ?? []), node]);
    });
    return [...grouped.entries()];
  }, [nodes]);
  const myApplications = useMemo(
    () => applications
      .filter((application) => application.applicant.id === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [applications, userId],
  );
  const pendingJoinRequests = useMemo(
    () => applications
      .filter((application) =>
        application.status === 'pending' &&
        canDecide.has(application.nodeId) &&
        application.applicant.id !== userId &&
        nodeById.get(application.nodeId)?.kind !== 'position',
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [applications, canDecide, nodeById, userId],
  );

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['org'] });
  };
  const withdraw = useMutation({
    mutationFn: (id: string) => coboardClient.org.withdraw(id),
    onSuccess: invalidate,
    onError: errorToast,
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => coboardClient.org.decide(id, decision, {}),
    onSuccess: invalidate,
    onError: errorToast,
  });

  const confirmWithdraw = async (application: OrgApplication): Promise<void> => {
    const result = await Taro.showModal({
      title: '撤回申请？',
      content: `撤回对“${application.nodeTitle}”的申请。`,
      confirmText: '撤回',
    });
    if (result.confirm) withdraw.mutate(application.id);
  };

  const confirmDecision = async (application: OrgApplication, decisionValue: 'approve' | 'reject'): Promise<void> => {
    const approve = decisionValue === 'approve';
    const result = await Taro.showModal({
      title: approve ? '确认录用？' : '确认婉拒？',
      content: `${approve ? '录用' : '婉拒'} ${application.applicant.displayName} 对“${application.nodeTitle}”的申请。`,
      confirmText: approve ? '录用' : '婉拒',
      confirmColor: approve ? '#18181b' : '#dc2626',
    });
    if (result.confirm) decide.mutate({ id: application.id, decision: decisionValue });
  };

  const positionCount = groups.reduce((count, [, positions]) => count + positions.length, 0);
  return (
    <View className="org-recruit">
      {pendingJoinRequests.length > 0 && (
        <View className="org-recruit__section">
          <Text className="org-recruit__section-title">待处理的加入申请 · {pendingJoinRequests.length}</Text>
          <View className="org-recruit__cards">
            {pendingJoinRequests.map((application) => (
              <View className="org-join-request" key={application.id}>
                <Avatar name={application.applicant.displayName} color={application.applicant.avatarColor} userId={application.applicant.id} hasAvatar={application.applicant.hasAvatar} />
                <View className="org-join-request__copy">
                  <Text className="org-join-request__title">{application.applicant.displayName} 申请加入 {application.nodeTitle}</Text>
                  <Text className="org-join-request__meta">{application.note || '未填写申请理由'} · {relativeTime(application.createdAt)}</Text>
                </View>
                <View className="org-join-request__actions">
                  <Text onClick={() => void confirmDecision(application, 'approve')}>通过</Text>
                  <Text onClick={() => void confirmDecision(application, 'reject')}>驳回</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {positionCount === 0 && pendingJoinRequests.length === 0 ? (
        <View className="org-recruit__empty">
          <View className="org-recruit__empty-icon">
            <View className="org-recruit__briefcase"><View /></View>
          </View>
          <Empty title="暂无招募岗位" description="管理员可在列表视图创建「岗位」节点并设置名额，即可在此开放申报。" />
        </View>
      ) : (
        groups.map(([path, positions]) => (
          <View className="org-recruit__section" key={path}>
            <Text className="org-recruit__section-title">{path}</Text>
            <View className="org-recruit__cards">
              {positions.map((node) => {
                const holders = [...node.leads, ...node.members];
                const onNode = holders.some((person) => person.userId === userId);
                const myPending = applications.find((application) => application.nodeId === node.id && application.applicant.id === userId && application.status === 'pending');
                const requests = applications.filter((application) => application.nodeId === node.id && application.status === 'pending' && canDecide.has(node.id) && application.applicant.id !== userId);
                return (
                  <View className="org-position-card" key={node.id}>
                    <View className="org-position-card__top">
                      <View className="org-position-card__copy">
                        <View className="org-position-card__title-row">
                          <Text className="org-position-card__title">{node.title}</Text>
                          <Text className={`org-position-card__occupancy ${isPositionFull(node) ? 'is-full' : ''}`}>{occupancyShort(node)}</Text>
                        </View>
                        {node.description && <Text className="org-position-card__description">{node.description}</Text>}
                        {holders.length > 0 && (
                          <View className="org-position-card__people">
                            {node.leads.map((person) => <View className="org-position-person" key={person.userId}><Avatar name={person.displayName} color={person.avatarColor} userId={person.userId} hasAvatar={person.hasAvatar} /><Text className="org-position-person__crown">♛</Text><Text>{person.displayName}</Text></View>)}
                            {node.members.slice(0, 6).map((person) => <View className="org-position-person" key={person.userId}><Avatar name={person.displayName} color={person.avatarColor} userId={person.userId} hasAvatar={person.hasAvatar} /><Text>{person.displayName}</Text></View>)}
                          </View>
                        )}
                      </View>
                      <View className="org-position-card__action">
                        {onNode ? <Text className="org-recruit-status is-approved">已在岗</Text>
                          : myPending ? <Text className="org-recruit-action" onClick={() => void confirmWithdraw(myPending)}>已申报 · 撤回</Text>
                            : isPositionFull(node) ? <Text className="org-recruit-status">已满</Text>
                              : <Text className="org-recruit-action is-primary" onClick={() => setApplyTo(node)}>申报</Text>}
                      </View>
                    </View>
                    {requests.length > 0 && (
                      <View className="org-position-card__review">
                        <Text className="org-position-card__review-title">待处理申报 · {requests.length}</Text>
                        {requests.map((application) => (
                          <View className="org-application" key={application.id}>
                            <Avatar name={application.applicant.displayName} color={application.applicant.avatarColor} userId={application.applicant.id} hasAvatar={application.applicant.hasAvatar} />
                            <View className="org-application__copy"><Text>{application.applicant.displayName}</Text><Text>{application.note || '未填写申报理由'} · {relativeTime(application.createdAt)}</Text></View>
                            <View className="org-application__actions"><Text onClick={() => void confirmDecision(application, 'approve')}>录用</Text><Text onClick={() => void confirmDecision(application, 'reject')}>婉拒</Text></View>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        ))
      )}

      {myApplications.length > 0 && (
        <View className="org-recruit__section">
          <Text className="org-recruit__section-title">我的申报</Text>
          <View className="org-my-applications">
            {myApplications.map((application) => (
              <View className="org-my-application" key={application.id}>
                <View className="org-my-application__copy"><Text>{application.nodeTitle}</Text>{application.note && <Text>申报理由：{application.note}</Text>}</View>
                <Text className={`org-application-status is-${application.status}`}>{STATUS_LABELS[application.status]}</Text>
                <Text className="org-my-application__time">{relativeTime(application.decidedAt ?? application.createdAt)}</Text>
                {application.status === 'pending' && <Text className="org-my-application__withdraw" onClick={() => void confirmWithdraw(application)}>撤回</Text>}
              </View>
            ))}
          </View>
        </View>
      )}

      {applyTo && <ApplyDialog node={applyTo} onClose={() => setApplyTo(null)} />}
    </View>
  );
}

function ApplyDialog({ node, onClose }: { node: OrgNode; onClose: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const apply = useMutation({
    mutationFn: () => coboardClient.org.apply(node.id, { note: note.trim() || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org'] });
      onClose();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '申报失败，请重试'),
  });
  return (
    <View className="org-dialog-backdrop" onClick={onClose}>
      <View className="org-dialog" onClick={(event) => event.stopPropagation()}>
        <View className="org-dialog__header"><Text className="org-dialog__title">申报“{node.title}”</Text><Text className="org-dialog__description">负责人将看到你的申报理由，并决定是否录用。</Text></View>
        <View className="org-dialog__body stack"><Field label="申报理由（可选）" value={note} placeholder="介绍你的经验、时间安排或想法" multiline onChange={setNote} />{error && <Text className="org-dialog__error">{error}</Text>}</View>
        <View className="org-dialog__footer"><ActionButton tone="ghost" onClick={onClose}>取消</ActionButton><ActionButton loading={apply.isPending} onClick={() => apply.mutate()}>提交申报</ActionButton></View>
      </View>
    </View>
  );
}
