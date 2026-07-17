import Taro, { usePullDownRefresh, useRouter } from '@tarojs/taro';
import { Picker, Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { queryKeys } from 'client-core';
import {
  canDeliver,
  canAssign,
  canDeleteTask,
  canEditTask,
  canReview,
  canRevokeApproval,
  isManager,
  resolveProjectRole,
  TASK_STATUS_META,
  type AssetKind,
  type ProjectMemberWithUser,
  type QualityGrade,
  type Task,
  type TaskClaimant,
} from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { useCurrentUser, useSessionToken } from '../../lib/auth';
import {
  ActionButton,
  Avatar,
  Badge,
  Card,
  Empty,
  Field,
  InlineError,
  Modal,
  PageHeader,
  Segmented,
  SelectField,
} from '../../components/ui';
import { Markdown } from '../../components/Markdown';
import { StateView } from '../../components/StateView';
import { AuthGate } from '../../components/AuthGate';
import { queryClient } from '../../lib/query';
import { EditTaskForm } from '../../features/task/EditTaskForm';
import { chooseFiles, formatFileSize, openProtectedFile } from '../../lib/files';
import './index.scss';

type Tab = 'overview' | 'deliver' | 'comments' | 'ideas' | 'activity';
const gradeValues: QualityGrade[] = ['a', 'b', 'c', 'd'];

function TaskPage(): JSX.Element {
  const router = useRouter();
  const id = router.params.id;
  const token = useSessionToken();
  const me = useCurrentUser();
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>(
    router.params.action === 'deliver' || router.params.action === 'review'
      ? 'deliver'
      : router.params.action === 'ideas'
        ? 'ideas'
      : 'overview',
  );
  const [editing, setEditing] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const [transferFrom, setTransferFrom] = useState<TaskClaimant | null>(null);
  const taskQuery = useQuery({
    queryKey: queryKeys.task(id ?? 'missing'),
    enabled: Boolean(id && token),
    queryFn: async () => (await coboardClient.tasks.get(id!)).task,
  });
  const members = useQuery({
    queryKey: ['projects', taskQuery.data?.projectId, 'members', token],
    enabled: Boolean(token && taskQuery.data?.projectId),
    queryFn: async () => (await coboardClient.projects.members(taskQuery.data!.projectId!)).members,
  });
  const labels = useQuery({
    queryKey: ['labels', token],
    enabled: Boolean(token),
    queryFn: async () => (await coboardClient.labels.list()).labels,
  });
  const projects = useQuery({
    queryKey: ['projects', token],
    enabled: Boolean(token),
    queryFn: async () => (await coboardClient.projects.list()).projects,
  });
  const comments = useQuery({
    queryKey: queryKeys.comments(id ?? 'missing'),
    enabled: Boolean(id && token && tab === 'comments'),
    queryFn: async () => (await coboardClient.comments.list(id!)).comments,
  });
  const ideas = useQuery({
    queryKey: queryKeys.taskIdeas(id ?? 'missing'),
    enabled: Boolean(id && token && tab === 'ideas'),
    queryFn: async () => (await coboardClient.ideas.forTask(id!)).ideas,
  });
  const activities = useQuery({
    queryKey: queryKeys.activities(id ?? 'missing'),
    enabled: Boolean(id && token && tab === 'activity'),
    queryFn: async () => (await coboardClient.comments.activities(id!)).activities,
  });
  const texts = useQuery({
    queryKey: queryKeys.taskTexts(id ?? 'missing'),
    enabled: Boolean(id && token && tab === 'deliver'),
    queryFn: async () => (await coboardClient.taskTexts.list(id!)).texts,
  });
  const files = useQuery({
    queryKey: queryKeys.taskFiles(id ?? 'missing'),
    enabled: Boolean(id && token && tab === 'deliver'),
    queryFn: async () => (await coboardClient.files.task.list(id!)).files,
  });
  const reviews = useQuery({
    queryKey: queryKeys.taskReviews(id ?? 'missing'),
    enabled: Boolean(id && token && tab === 'deliver'),
    queryFn: async () => (await coboardClient.tasks.reviews(id!)).reviews,
  });
  usePullDownRefresh(async () => {
    await Promise.all([
      taskQuery.refetch(),
      comments.refetch(),
      ideas.refetch(),
      activities.refetch(),
      texts.refetch(),
      files.refetch(),
      reviews.refetch(),
    ]);
    Taro.stopPullDownRefresh();
  });
  const refresh = (task?: Task) => {
    if (task) client.setQueryData(queryKeys.task(id!), task);
    void client.invalidateQueries({ queryKey: ['projects'] });
  };
  const claim = useMutation({
    mutationFn: () => coboardClient.tasks.claim(id!),
    onSuccess: (response) => refresh(response.task),
  });
  const release = useMutation({
    mutationFn: (userId?: string) => coboardClient.tasks.release(id!, userId),
    onSuccess: (response) => refresh(response.task),
  });
  const assign = useMutation({
    mutationFn: (assigneeId: string) => coboardClient.tasks.assign(id!, { assigneeId }),
    onSuccess: (response) => refresh(response.task),
  });
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof coboardClient.tasks.update>[1]) => coboardClient.tasks.update(id!, patch),
    onSuccess: (response) => { refresh(response.task); setEditing(false); },
  });
  const remove = useMutation({
    mutationFn: () => coboardClient.tasks.remove(id!),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['projects'] }); void Taro.navigateBack(); },
  });
  const task = taskQuery.data;
  const myClaim = task?.claimants.find((person) => person.userId === me.data?.id);
  const permission = task
    ? { user: me.data ?? null, projectRole: resolveProjectRole(members.data, me.data?.id) }
    : null;
  const manager = Boolean(permission && task && isManager(permission, task));
  const assignable = Boolean(permission && task && canAssign(permission, task));
  const deletable = Boolean(permission && task && canDeleteTask(permission, task));
  const candidateMembers = (members.data ?? []).filter((member) => !task?.claimants.some((person) => person.userId === member.userId));
  const taskProject = projects.data?.find((project) => project.id === task?.projectId);

  async function confirmDelete(): Promise<void> {
    const result = await Taro.showModal({ title: '删除任务', content: '确定删除这个任务？此操作不可撤销。', confirmColor: '#b42318' });
    if (result.confirm) remove.mutate();
  }
  return (
    <View className="page">
      <AuthGate>
        <StateView
          loading={taskQuery.isLoading}
          error={taskQuery.isError || !id}
          empty={!task}
          onRetry={() => void taskQuery.refetch()}
        >
          {task && (
            <>
              <PageHeader
                title={task.title}
                description={task.projectName ?? '公共任务池'}
                action={<View className="task-header-actions">
                  {permission && canEditTask(permission, task) && <ActionButton tone="ghost" size="small" onClick={() => setEditing((value) => !value)}>{editing ? '取消编辑' : '编辑'}</ActionButton>}
                  <Badge
                    tone={
                      task.status === 'done'
                        ? 'success'
                        : task.status === 'pending_review'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {TASK_STATUS_META[task.status].label}
                  </Badge>
                </View>}
              />
              <View className="row task-summary">
                <Badge
                  tone={
                    task.priority === 'urgent'
                      ? 'danger'
                      : task.priority === 'high'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {priorityLabel(task.priority)}
                </Badge>
                {task.taskType && <Badge>{taskTypeLabel(task.taskType)}</Badge>}
                {task.points != null && <Badge tone="primary">{task.points} 点</Badge>}
                {task.dueDate && <Badge tone="warning">DDL {task.dueDate}</Badge>}
              </View>
              {editing ? <EditTaskForm task={task} labels={labels.data ?? []} saving={update.isPending} onCancel={() => setEditing(false)} onSave={(patch) => update.mutate(patch)} /> : <>
              <View className="task-actions task-action-bar">
                {!myClaim && (task.status === 'open' || task.status === 'in_progress') && (
                  <ActionButton loading={claim.isPending} onClick={() => claim.mutate()}>
                    认领任务
                  </ActionButton>
                )}
                {myClaim && (task.status === 'open' || task.status === 'in_progress') && (
                  <ActionButton
                    tone="secondary"
                    loading={release.isPending}
                    onClick={() => release.mutate(undefined)}
                  >
                    释放任务
                  </ActionButton>
                )}
                {task.status === 'done' && <ActionButton tone="secondary" onClick={() => setAssetOpen(true)}>沉淀为资产</ActionButton>}
              </View>
              <InlineError message={errorMessage(claim.error ?? release.error ?? assign.error ?? update.error ?? remove.error)} />
              <Segmented
                value={tab}
                onChange={setTab}
                items={[
                  { value: 'overview', label: '详情' },
                  { value: 'deliver', label: '交付' },
                  { value: 'comments', label: '评论' },
                  { value: 'ideas', label: '灵感' },
                  { value: 'activity', label: '动态' },
                ]}
              />
              {tab === 'overview' && <Overview task={task} members={members.data ?? []} assignable={assignable} manager={manager} currentUserId={me.data?.id} assigning={assign.isPending} releasing={release.isPending} updating={update.isPending} onAssign={(userId) => assign.mutate(userId)} onRelease={(userId) => release.mutate(userId)} onTransfer={setTransferFrom} onStatus={(status) => update.mutate({ status })} />}
              {tab === 'deliver' && (
                <DeliverPanel
                  task={task}
                  canDeliverTask={permission ? canDeliver(permission, task) : false}
                  canReviewTask={permission ? canReview(permission, task) : false}
                  canRevokeTask={permission ? canRevokeApproval(permission, task) : false}
                  texts={texts.data ?? []}
                  files={files.data ?? []}
                  reviews={reviews.data ?? []}
                  currentUserId={me.data?.id}
                  manager={manager}
                  onTask={refresh}
                  onRefresh={() => {
                    void texts.refetch();
                    void files.refetch();
                    void reviews.refetch();
                  }}
                />
              )}
              {tab === 'comments' && (
                <CommentPanel
                  taskId={id!}
                  comments={comments.data ?? []}
                  loading={comments.isLoading}
                  currentUserId={me.data?.id}
                  canManage={manager}
                  members={members.data ?? []}
                  onRefresh={() => void comments.refetch()}
                />
              )}
              {tab === 'ideas' && (
                <IdeaPanel
                  taskId={id!}
                  ideas={ideas.data ?? []}
                  loading={ideas.isLoading}
                  currentUserId={me.data?.id}
                  canManage={manager}
                  onRefresh={() => void ideas.refetch()}
                />
              )}
              {tab === 'activity' && (
                <ActivityPanel activities={activities.data ?? []} loading={activities.isLoading} />
              )}
              {deletable && <View className="task-danger-zone"><ActionButton tone="ghost" loading={remove.isPending} onClick={() => void confirmDelete()}>删除任务</ActionButton></View>}
              </>}
              <TransferModal open={Boolean(transferFrom)} task={task} from={transferFrom} candidates={candidateMembers} onClose={() => setTransferFrom(null)} onTask={refresh} />
              <AssetModal open={assetOpen} task={task} trackId={taskProject?.trackId ?? null} onClose={() => setAssetOpen(false)} />
            </>
          )}
        </StateView>
      </AuthGate>
    </View>
  );
}
export default function TaskPageRoot(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <TaskPage />
    </QueryClientProvider>
  );
}

function Overview({ task, members, assignable, manager, currentUserId, assigning, releasing, updating, onAssign, onRelease, onTransfer, onStatus }: { task: Task; members: ProjectMemberWithUser[]; assignable: boolean; manager: boolean; currentUserId?: string; assigning: boolean; releasing: boolean; updating: boolean; onAssign: (userId: string) => void; onRelease: (userId?: string) => void; onTransfer: (claimant: TaskClaimant) => void; onStatus: (status: 'open' | 'in_progress') => void }): JSX.Element {
  const candidates = members.filter((member) => !task.claimants.some((person) => person.userId === member.userId));
  const candidateIndex = 0;
  const active = task.status === 'open' || task.status === 'in_progress';
  return (
    <View className="stack">
      <DetailCard title="任务说明" body={task.description} empty="暂无任务说明" />
      <View className="task-requirements"><DetailCard title="提交要求" body={task.deliverableSpec} empty="未填写提交要求" /><DetailCard title="验收标准" body={task.acceptanceCriteria} empty="未填写验收标准" /></View>
      <Card className="stack">
        {task.creator && <View className="task-person-row"><Text className="task-person-row__label">发布者</Text><Avatar name={task.creator.displayName} color={task.creator.avatarColor} userId={task.creator.id} hasAvatar={task.creator.hasAvatar} size="small" /><Text className="body truncate">{task.creator.displayName}</Text><Text className="caption">{relativeDate(task.createdAt)}</Text></View>}
        {task.deliverer && <View className="task-person-row"><Text className="task-person-row__label">交付人</Text><Avatar name={task.deliverer.displayName} color={task.deliverer.avatarColor} userId={task.deliverer.id} hasAvatar={task.deliverer.hasAvatar} size="small" /><Text className="body truncate">{task.deliverer.displayName}</Text><Text className="caption">{task.deliveredAt ? relativeDate(task.deliveredAt) : ''}</Text></View>}
        {task.reviewer && <View className="task-person-row"><Text className="task-person-row__label">审阅人</Text><Avatar name={task.reviewer.displayName} color={task.reviewer.avatarColor} userId={task.reviewer.id} hasAvatar={task.reviewer.hasAvatar} size="small" /><Text className="body truncate">{task.reviewer.displayName}</Text><Badge tone={task.status === 'done' ? 'success' : 'danger'}>{task.status === 'done' ? '通过' : '退回'}</Badge></View>}
      </Card>
      <Card>
        <View className="stack">
          <View className="row-between"><Text className="title">认领者</Text><Badge tone={task.claimants.length < task.minClaimants ? 'warning' : 'success'}>{task.claimants.length}/{task.maxClaimants ?? '不限'}</Badge></View>
          <Text className="caption">下限 {task.minClaimants} 人 · 上限 {task.maxClaimants ?? '不限'} · 当前 {task.claimants.length} 人</Text>
          {task.claimants.length === 0 ? (
            <Text className="caption">尚无人认领 · 需要至少 {task.minClaimants} 人</Text>
          ) : (
            task.claimants.map((person) => (
              <View key={person.userId} className="task-claimant-row">
                <Avatar name={person.displayName} color={person.avatarColor} userId={person.userId} hasAvatar={person.hasAvatar} />
                <View style={{ flex: 1 }}>
                  <Text className="body">{person.displayName}</Text>
                  <Text className="caption">
                    {person.points == null ? '待分配点数' : `${person.points} 点`}
                  </Text>
                </View>
                {manager && active && candidates.length > 0 && <ActionButton tone="ghost" size="small" onClick={() => onTransfer(person)}>转让</ActionButton>}
                {(manager || person.userId === currentUserId) && active && <ActionButton tone="ghost" size="small" loading={releasing} onClick={() => onRelease(person.userId === currentUserId ? undefined : person.userId)}>移除</ActionButton>}
              </View>
            ))
          )}
          {assignable && candidates.length > 0 && task.status !== 'done' && <Picker mode="selector" range={candidates.map((member) => member.user.displayName)} value={candidateIndex} onChange={(event) => { const member = candidates[Number(event.detail.value)]; if (member) onAssign(member.userId); }}><View className="task-assign-control"><Text>{assigning ? '正在派发…' : '＋ 派发给项目成员'}</Text><Text>⌄</Text></View></Picker>}
        </View>
      </Card>
      {active && <Card className="stack"><View className="row-between"><View><Text className="title">任务状态</Text><Text className="caption">可在待认领和进行中之间调整</Text></View><Badge>{TASK_STATUS_META[task.status].label}</Badge></View><View className="row"><ActionButton tone={task.status === 'open' ? 'primary' : 'secondary'} size="small" disabled={task.status === 'open'} loading={updating} onClick={() => onStatus('open')}>待认领</ActionButton><ActionButton tone={task.status === 'in_progress' ? 'primary' : 'secondary'} size="small" disabled={task.status === 'in_progress' || task.claimants.length < task.minClaimants} loading={updating} onClick={() => onStatus('in_progress')}>进行中</ActionButton></View>{task.claimants.length < task.minClaimants && <Text className="caption">达到认领下限后才能进入进行中。</Text>}</Card>}
    </View>
  );
}
function DetailCard({
  title,
  body,
  empty,
}: {
  title: string;
  body: string | null;
  empty: string;
}): JSX.Element {
  return (
    <Card>
      <View className="stack">
        <Text className="title">{title}</Text>
        <Markdown source={body} empty={empty} />
      </View>
    </Card>
  );
}

function DeliverPanel({
  task,
  canDeliverTask,
  canReviewTask,
  canRevokeTask,
  texts,
  files,
  reviews,
  currentUserId,
  manager,
  onTask,
  onRefresh,
}: {
  task: Task;
  canDeliverTask: boolean;
  canReviewTask: boolean;
  canRevokeTask: boolean;
  texts: Awaited<ReturnType<typeof coboardClient.taskTexts.list>>['texts'];
  files: Awaited<ReturnType<typeof coboardClient.files.task.list>>['files'];
  reviews: Awaited<ReturnType<typeof coboardClient.tasks.reviews>>['reviews'];
  currentUserId?: string;
  manager: boolean;
  onTask: (task: Task) => void;
  onRefresh: () => void;
}): JSX.Element {
  const [content, setContent] = useState('');
  const [total, setTotal] = useState(String(task.points ?? 0));
  const [grade, setGrade] = useState<QualityGrade>('b');
  const [reviewComment, setReviewComment] = useState('');
  const initialEach = Math.floor((task.points ?? 0) / Math.max(1, task.claimants.length));
  const [allocations, setAllocations] = useState<Record<string, string>>(() => Object.fromEntries(task.claimants.map((person, index) => [person.userId, String(person.points ?? initialEach + (index < ((task.points ?? 0) % Math.max(1, task.claimants.length)) ? 1 : 0))])));
  const addText = useMutation({
    mutationFn: () => coboardClient.taskTexts.create(task.id, { content: content.trim() }),
    onSuccess: () => {
      setContent('');
      onRefresh();
    },
  });
  const upload = useMutation({
    mutationFn: async () => {
      const chosen = await chooseFiles(9);
      if (chosen.length === 0) throw new Error('未选择文件');
      return Promise.all(chosen.map((file) => coboardClient.files.task.upload(task.id, file)));
    },
    onSuccess: onRefresh,
  });
  const removeText = useMutation({ mutationFn: (textId: string) => coboardClient.taskTexts.remove(task.id, textId), onSuccess: onRefresh });
  const removeFile = useMutation({ mutationFn: (fileId: string) => coboardClient.files.task.remove(task.id, fileId), onSuccess: onRefresh });
  const deliver = useMutation({
    mutationFn: () => {
      const points = Math.max(0, Number.parseInt(total, 10) || 0);
      const shares = task.claimants.map((person) => ({
        userId: person.userId,
        points: Math.max(0, Number.parseInt(allocations[person.userId] ?? '0', 10) || 0),
      }));
      if (shares.reduce((sum, item) => sum + item.points, 0) !== points) throw new Error('参与者点数之和必须等于任务总点数');
      return coboardClient.tasks.deliver(task.id, {
        allocations: shares,
        ...(task.points == null ? { totalPoints: points } : {}),
      });
    },
    onSuccess: (response) => onTask(response.task),
  });
  const review = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      coboardClient.tasks.review(task.id, {
        decision,
        qualityGrade: grade,
        comment: reviewComment.trim() || undefined,
      }),
    onSuccess: (response) => {
      onTask(response.task);
      setReviewComment('');
      onRefresh();
    },
  });
  const revoke = useMutation({
    mutationFn: () => coboardClient.tasks.revokeApproval(task.id),
    onSuccess: (response) => onTask(response.task),
  });
  return (
    <View className="stack">
      <Card className="stack">
        <Text className="title">文字交付</Text>
        <Field
          label="交付内容"
          value={content}
          multiline
          placeholder="粘贴文案、链接或交付说明…"
          onChange={setContent}
        />
        <ActionButton
          size="small"
          disabled={!content.trim()}
          loading={addText.isPending}
          onClick={() => addText.mutate()}
        >
          添加文字交付
        </ActionButton>
        {texts.map((item) => (
          <View key={item.id} className="delivery-item">
            <View className="row-between"><View className="row"><Avatar name={item.author.displayName} color={item.author.avatarColor} userId={item.author.id} hasAvatar={item.author.hasAvatar} size="small" /><Text className="caption">{item.author.displayName}</Text></View>{(manager || item.author.id === currentUserId) && <ActionButton tone="ghost" size="small" loading={removeText.isPending} onClick={() => removeText.mutate(item.id)}>删除</ActionButton>}</View>
            <Markdown source={item.content} />
          </View>
        ))}
      </Card>
      <Card className="stack">
        <View className="row-between">
          <Text className="title">附件</Text>
          <ActionButton
            tone="secondary"
            size="small"
            loading={upload.isPending}
            onClick={() => upload.mutate()}
          >
            上传文件
          </ActionButton>
        </View>
        {files.length === 0 ? (
          <Text className="caption">暂无附件</Text>
        ) : (
          files.map((file) => (
            <View key={file.id} className="delivery-file">
              <View className="delivery-file__icon"><Text>↧</Text></View><View className="account-copy" onClick={() => void openProtectedFile(coboardClient.files.task.url(task.id, file.id, true), file.filename, file.mime)}><Text className="body truncate">{file.filename}</Text><Text className="caption">{formatFileSize(file.sizeBytes)} · {file.uploader.displayName}</Text></View>{(manager || file.uploaderId === currentUserId) && <ActionButton tone="ghost" size="small" loading={removeFile.isPending} onClick={() => removeFile.mutate(file.id)}>删除</ActionButton>}
            </View>
          ))
        )}
      </Card>
      {canDeliverTask && (
        <Card className="stack">
          <Text className="title">提交审核</Text>
          <Field label="任务总点数" value={total} placeholder="0" onChange={setTotal} />
          <Text className="caption">为每位参与者分配点数，合计必须等于任务总点数。</Text>
          {task.claimants.map((person) => <View key={person.userId} className="delivery-allocation"><View className="row"><Avatar name={person.displayName} color={person.avatarColor} userId={person.userId} hasAvatar={person.hasAvatar} size="small" /><Text className="body">{person.displayName}</Text></View><View className="delivery-allocation__input"><Field label="" value={allocations[person.userId] ?? '0'} onChange={(value) => setAllocations((current) => ({ ...current, [person.userId]: value }))} /></View><Text className="caption">点</Text></View>)}
          <ActionButton loading={deliver.isPending} onClick={() => deliver.mutate()}>
            提交审核
          </ActionButton>
          <InlineError message={errorMessage(deliver.error)} />
        </Card>
      )}
      {canReviewTask && (
        <Card className="stack">
          <Text className="title">审核交付</Text>
          <SelectField
            label="交付质量"
            range={gradeValues.map((item) => item.toUpperCase())}
            value={gradeValues.indexOf(grade)}
            valueLabel={`${grade.toUpperCase()} 级`}
            onChange={(index) => setGrade(gradeValues[index] ?? 'b')}
          />
          <Field label="审核意见" value={reviewComment} multiline onChange={setReviewComment} />
          <View className="row">
            <ActionButton loading={review.isPending} onClick={() => review.mutate('approve')}>
              通过
            </ActionButton>
            <ActionButton
              tone="danger"
              loading={review.isPending}
              onClick={() => review.mutate('reject')}
            >
              退回
            </ActionButton>
          </View>
        </Card>
      )}
      {canRevokeTask && (
        <ActionButton tone="secondary" loading={revoke.isPending} onClick={() => revoke.mutate()}>
          撤销通过并重新审核
        </ActionButton>
      )}
      <Card className="stack">
        <Text className="title">审核记录</Text>
        {reviews.length === 0 ? (
          <Text className="caption">暂无审核记录</Text>
        ) : (
          reviews.map((item) => (
            <View key={item.id} className="delivery-item">
              <View className="row-between">
              <Text className="body">
                  {item.reviewer.displayName} · {item.stage === 'first' ? '初审' : '复核'}
              </Text>
                <Badge tone={item.decision === 'approve' ? 'success' : 'danger'}>
                  {item.decision === 'approve' ? '通过' : '退回'}
                </Badge>
              </View>
              {item.comment && <Text className="caption">{item.comment}</Text>}
            </View>
          ))
        )}
      </Card>
      <InlineError message={errorMessage(addText.error ?? upload.error ?? removeText.error ?? removeFile.error ?? review.error ?? revoke.error)} />
    </View>
  );
}

function CommentPanel({
  taskId,
  comments,
  loading,
  currentUserId,
  canManage,
  members,
  onRefresh,
}: {
  taskId: string;
  comments: Awaited<ReturnType<typeof coboardClient.comments.list>>['comments'];
  loading: boolean;
  currentUserId?: string;
  canManage: boolean;
  members: ProjectMemberWithUser[];
  onRefresh: () => void;
}): JSX.Element {
  const [body, setBody] = useState('');
  const [pendingFiles, setPendingFiles] = useState<Array<{ path: string; name: string }>>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const comment = await coboardClient.comments.create(taskId, { body: body.trim(), mentions: extractMentions(body, members) });
      await Promise.all(pendingFiles.map((file) => coboardClient.files.attachment.upload('comments', comment.id, file)));
      return comment;
    },
    onSuccess: () => {
      setBody('');
      setPendingFiles([]);
      onRefresh();
    },
  });
  const update = useMutation({ mutationFn: (id: string) => coboardClient.comments.update(id, { body: editBody.trim(), mentions: extractMentions(editBody, members) }), onSuccess: () => { setEditingId(null); setEditBody(''); onRefresh(); } });
  const remove = useMutation({ mutationFn: (id: string) => coboardClient.comments.remove(id), onSuccess: onRefresh });
  const removeFile = useMutation({ mutationFn: ({ commentId, fileId }: { commentId: string; fileId: string }) => coboardClient.files.attachment.remove('comments', commentId, fileId), onSuccess: onRefresh });
  async function confirmRemove(id: string): Promise<void> { const result = await Taro.showModal({ title: '删除评论', content: '确定删除这条评论？', confirmColor: '#b42318' }); if (result.confirm) remove.mutate(id); }
  return (
    <View className="stack">
      <Card className="stack">
        <Field
          label="发表评论"
          value={body}
          multiline
          placeholder="补充进展、反馈或问题…"
          onChange={setBody}
          hint="支持 Markdown；输入 @姓名 可提醒项目成员。"
        />
        {pendingFiles.length > 0 && <View className="attachment-drafts">{pendingFiles.map((file, index) => <View key={`${file.path}-${index}`} className="attachment-chip"><Text className="truncate">{file.name}</Text><Text onClick={() => setPendingFiles((items) => items.filter((_, itemIndex) => itemIndex !== index))}>×</Text></View>)}</View>}
        <View className="row-between"><ActionButton tone="secondary" size="small" onClick={() => void chooseFiles(5).then((files) => setPendingFiles((current) => [...current, ...files].slice(0, 5)))}>添加附件</ActionButton>
        <ActionButton
          size="small"
          disabled={!body.trim()}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          发送评论
        </ActionButton>
        </View>
        <InlineError message={errorMessage(create.error ?? update.error ?? remove.error ?? removeFile.error)} />
      </Card>
      {loading ? (
        <Empty title="加载评论…" />
      ) : comments.length === 0 ? (
        <Empty title="暂无评论" />
      ) : (
        comments.map((item) => (
          <Card key={item.id}>
            <View className="stack">
              <View className="row-between"><View className="row">
                <Avatar name={item.author.displayName} color={item.author.avatarColor} userId={item.author.id} hasAvatar={item.author.hasAvatar} />
                <View className="account-copy">
                  <Text className="title">{item.author.displayName}</Text>
                  <Text className="caption">
                    {relativeDate(item.createdAt)}{item.editedAt ? ' · 已编辑' : ''}
                  </Text>
                </View>
              </View>{(canManage || item.author.id === currentUserId) && <View className="row"><ActionButton tone="ghost" size="small" onClick={() => { setEditingId(item.id); setEditBody(item.body); }}>编辑</ActionButton><ActionButton tone="ghost" size="small" loading={remove.isPending} onClick={() => void confirmRemove(item.id)}>删除</ActionButton></View>}</View>
              {editingId === item.id ? <View className="stack"><Field label="编辑评论" value={editBody} multiline onChange={setEditBody} /><View className="row"><ActionButton size="small" loading={update.isPending} disabled={!editBody.trim()} onClick={() => update.mutate(item.id)}>保存</ActionButton><ActionButton tone="ghost" size="small" onClick={() => setEditingId(null)}>取消</ActionButton></View></View> : <Markdown source={item.body} />}
              {item.files.length > 0 && <View className="attachment-list">{item.files.map((file) => <View key={file.id} className="attachment-row"><View className="account-copy" onClick={() => void openProtectedFile(coboardClient.files.attachment.url('comments', item.id, file.id, true), file.filename, file.mime)}><Text className="body truncate">{file.filename}</Text><Text className="caption">{formatFileSize(file.sizeBytes)} · 点击预览</Text></View>{(canManage || file.uploaderId === currentUserId) && <ActionButton tone="ghost" size="small" loading={removeFile.isPending} onClick={() => removeFile.mutate({ commentId: item.id, fileId: file.id })}>删除</ActionButton>}</View>)}</View>}
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

function IdeaPanel({
  taskId,
  ideas,
  loading,
  currentUserId,
  canManage,
  onRefresh,
}: {
  taskId: string;
  ideas: Awaited<ReturnType<typeof coboardClient.ideas.forTask>>['ideas'];
  loading: boolean;
  currentUserId?: string;
  canManage: boolean;
  onRefresh: () => void;
}): JSX.Element {
  const [body, setBody] = useState('');
  const [pendingFiles, setPendingFiles] = useState<Array<{ path: string; name: string }>>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reward, setReward] = useState('1');
  const [reason, setReason] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const idea = await coboardClient.ideas.create(taskId, { body: body.trim() });
      await Promise.all(pendingFiles.map((file) => coboardClient.files.attachment.upload('ideas', idea.id, file)));
      return idea;
    },
    onSuccess: () => {
      setBody('');
      setPendingFiles([]);
      onRefresh();
    },
  });
  const adopt = useMutation({ mutationFn: (id: string) => coboardClient.ideas.adopt(id, { rewardPoints: Math.max(0, Number.parseInt(reward, 10) || 0) }), onSuccess: () => { setReviewingId(null); onRefresh(); } });
  const reject = useMutation({ mutationFn: (id: string) => coboardClient.ideas.reject(id, { reason: reason.trim() || undefined }), onSuccess: () => { setReviewingId(null); onRefresh(); } });
  const remove = useMutation({ mutationFn: (id: string) => coboardClient.ideas.remove(id), onSuccess: onRefresh });
  const removeFile = useMutation({ mutationFn: ({ ideaId, fileId }: { ideaId: string; fileId: string }) => coboardClient.files.attachment.remove('ideas', ideaId, fileId), onSuccess: onRefresh });
  async function confirmRemove(id: string): Promise<void> { const result = await Taro.showModal({ title: '删除灵感', content: '删除后无法恢复，确定继续吗？', confirmColor: '#b42318' }); if (result.confirm) remove.mutate(id); }
  return (
    <View className="stack">
      <Card className="stack">
        <Field
          label="记录灵感"
          value={body}
          multiline
          placeholder="与这个任务相关的新想法…"
          onChange={setBody}
          hint="支持 Markdown，可附加最多 5 个文件。"
        />
        {pendingFiles.length > 0 && <View className="attachment-drafts">{pendingFiles.map((file, index) => <View key={`${file.path}-${index}`} className="attachment-chip"><Text className="truncate">{file.name}</Text><Text onClick={() => setPendingFiles((items) => items.filter((_, itemIndex) => itemIndex !== index))}>×</Text></View>)}</View>}
        <View className="row-between"><ActionButton tone="secondary" size="small" onClick={() => void chooseFiles(5).then((files) => setPendingFiles((current) => [...current, ...files].slice(0, 5)))}>添加附件</ActionButton><ActionButton
          size="small"
          disabled={!body.trim()}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          添加灵感
        </ActionButton></View>
        <InlineError message={errorMessage(create.error ?? adopt.error ?? reject.error ?? remove.error ?? removeFile.error)} />
      </Card>
      {loading ? (
        <Empty title="加载灵感…" />
      ) : ideas.length === 0 ? (
        <Empty title="暂无相关灵感" />
      ) : (
        ideas.map((item) => (
          <Card key={item.id}>
            <View className="stack">
              <View className="row-between">
                <View className="row"><Avatar name={item.author.displayName} color={item.author.avatarColor} userId={item.author.id} hasAvatar={item.author.hasAvatar} size="small" /><Text className="caption">{item.author.displayName} · {relativeDate(item.createdAt)}</Text></View>
                <Badge
                  tone={
                    item.status === 'adopted'
                      ? 'success'
                      : item.status === 'rejected'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {item.status === 'pending'
                    ? '待评审'
                    : item.status === 'adopted'
                      ? '已采纳'
                      : '未采纳'}
                </Badge>
              </View>
              <Markdown source={item.body} />
              {item.rewardPoints != null && <Badge tone="primary">+{item.rewardPoints} 点</Badge>}
              {item.rejectReason && <View className="surface-muted"><Text className="caption">未采纳原因</Text><Text className="body">{item.rejectReason}</Text></View>}
              {item.files.length > 0 && <View className="attachment-list">{item.files.map((file) => <View key={file.id} className="attachment-row"><View className="account-copy" onClick={() => void openProtectedFile(coboardClient.files.attachment.url('ideas', item.id, file.id, true), file.filename, file.mime)}><Text className="body truncate">{file.filename}</Text><Text className="caption">{formatFileSize(file.sizeBytes)} · 点击预览</Text></View>{(canManage || file.uploaderId === currentUserId) && <ActionButton tone="ghost" size="small" loading={removeFile.isPending} onClick={() => removeFile.mutate({ ideaId: item.id, fileId: file.id })}>删除</ActionButton>}</View>)}</View>}
              <View className="row-between"><View>{canManage && item.status === 'pending' && <ActionButton tone="secondary" size="small" onClick={() => { setReviewingId(reviewingId === item.id ? null : item.id); setReward('1'); setReason(''); }}>评审</ActionButton>}</View>{(canManage || item.author.id === currentUserId) && <ActionButton tone="ghost" size="small" loading={remove.isPending} onClick={() => void confirmRemove(item.id)}>删除</ActionButton>}</View>
              {reviewingId === item.id && <View className="idea-review-panel"><Field label="采纳奖励点数" value={reward} onChange={setReward} /><Field label="不采纳原因" value={reason} multiline onChange={setReason} /><View className="row"><ActionButton loading={adopt.isPending} onClick={() => adopt.mutate(item.id)}>采纳</ActionButton><ActionButton tone="danger" loading={reject.isPending} onClick={() => reject.mutate(item.id)}>不采纳</ActionButton></View></View>}
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

function ActivityPanel({
  activities,
  loading,
}: {
  activities: Awaited<ReturnType<typeof coboardClient.comments.activities>>['activities'];
  loading: boolean;
}): JSX.Element {
  if (loading) return <Empty title="加载动态…" />;
  if (activities.length === 0) return <Empty title="暂无动态" />;
  return (
    <View className="timeline">
      {activities.map((item) => (
        <View key={item.id} className="timeline__item">
          <Avatar name={item.actor.displayName} color={item.actor.avatarColor} userId={item.actor.id} hasAvatar={item.actor.hasAvatar} size="small" />
          <View className="timeline__copy">
            <Text className="body">
              <Text className="title">{item.actor.displayName}</Text> {activityLabel(item.type)}
            </Text>
            <Text className="caption">{activityMeta(item.meta)}{activityMeta(item.meta) ? ' · ' : ''}{relativeDate(item.createdAt)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function TransferModal({ open, task, from, candidates, onClose, onTask }: { open: boolean; task: Task; from: TaskClaimant | null; candidates: ProjectMemberWithUser[]; onClose: () => void; onTask: (task: Task) => void }): JSX.Element | null {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [reason, setReason] = useState('');
  const transfer = useMutation({ mutationFn: () => {
    const candidate = candidates[candidateIndex];
    if (!from || !candidate) throw new Error('请选择接手成员');
    return coboardClient.tasks.transfer(task.id, { fromUserId: from.userId, toUserId: candidate.userId, reason: reason.trim() || undefined });
  }, onSuccess: (response) => { onTask(response.task); setReason(''); onClose(); } });
  return <Modal open={open} title="转让任务" description={from ? `把 ${from.displayName} 的认领责任转给另一位项目成员。` : undefined} onClose={onClose} footer={<><ActionButton tone="secondary" onClick={onClose}>取消</ActionButton><ActionButton loading={transfer.isPending} disabled={candidates.length === 0} onClick={() => transfer.mutate()}>确认转让</ActionButton></>}><View className="stack">{candidates.length === 0 ? <Empty title="没有可接手的成员" /> : <View className="field"><Text className="field__label">接手成员</Text><Picker mode="selector" range={candidates.map((candidate) => candidate.user.displayName)} value={candidateIndex} onChange={(event) => setCandidateIndex(Number(event.detail.value))}><View className="field__control field__select"><Text>{candidates[candidateIndex]?.user.displayName}</Text><Text>⌄</Text></View></Picker></View>}<Field label="转让原因（选填）" value={reason} multiline onChange={setReason} /><InlineError message={errorMessage(transfer.error)} /></View></Modal>;
}

const assetKinds: Array<{ value: AssetKind; label: string }> = [
  { value: 'content', label: '内容库' },
  { value: 'feedback', label: '反馈库' },
  { value: 'resource', label: '资源库' },
  { value: 'issue', label: '问题清单' },
];

function AssetModal({ open, task, trackId, onClose }: { open: boolean; task: Task; trackId: string | null; onClose: () => void }): JSX.Element | null {
  const [kind, setKind] = useState<AssetKind>('content');
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.description ?? '');
  const [url, setUrl] = useState('');
  const create = useMutation({ mutationFn: () => coboardClient.assets.create({ kind, title: title.trim(), body: body.trim() || undefined, url: url.trim() || undefined, trackId, taskId: task.id }), onSuccess: () => { void Taro.showToast({ title: '已沉淀到资产库', icon: 'success' }); onClose(); } });
  const kindIndex = Math.max(0, assetKinds.findIndex((item) => item.value === kind));
  return <Modal open={open} title="沉淀为资产" description="保留来源任务，方便团队复用和追溯。" onClose={onClose} footer={<><ActionButton tone="secondary" onClick={onClose}>取消</ActionButton><ActionButton loading={create.isPending} disabled={!title.trim() || (!body.trim() && !url.trim())} onClick={() => create.mutate()}>保存资产</ActionButton></>}><View className="stack"><View className="field"><Text className="field__label">资产类型</Text><Picker mode="selector" range={assetKinds.map((item) => item.label)} value={kindIndex} onChange={(event) => setKind(assetKinds[Number(event.detail.value)]?.value ?? 'content')}><View className="field__control field__select"><Text>{assetKinds[kindIndex]?.label}</Text><Text>⌄</Text></View></Picker></View><Field label="标题" required value={title} onChange={setTitle} /><Field label="正文（支持 Markdown）" value={body} multiline onChange={setBody} /><Field label="外部链接（可选）" value={url} onChange={setUrl} hint="正文和链接至少填写一项。" /><InlineError message={errorMessage(create.error)} /></View></Modal>;
}

function priorityLabel(value: Task['priority']): string {
  return { low: '低优先级', medium: '中优先级', high: '高优先级', urgent: '紧急' }[value];
}
function taskTypeLabel(value: NonNullable<Task['taskType']>): string {
  return {
    critical: 'A 类·关键',
    baseline: 'B 类·底线',
    claimable: 'C 类·认领',
    collab: 'D 类·协作',
  }[value];
}
function activityLabel(value: string): string {
  return (
    (
      {
        created: '创建了任务',
        claimed: '认领了任务',
        assigned: '分派了任务',
        unassigned: '取消了分派',
        released: '释放了任务',
        status_changed: '更新了状态',
        completed: '完成了任务',
        reopened: '重新打开任务',
        commented: '发表了评论',
        updated: '更新了任务',
        delivered: '提交了交付',
        rejected: '退回了交付',
        transferred: '转交了任务',
        due_changed: '调整了截止日期',
      } as Record<string, string>
    )[value] ?? value
  );
}

function extractMentions(body: string, members: ProjectMemberWithUser[]): string[] {
  const mentioned = new Set<string>();
  for (const member of members) {
    if (body.includes(`@${member.user.displayName}`)) mentioned.add(member.userId);
  }
  return [...mentioned];
}

function relativeDate(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

function activityMeta(meta: Record<string, unknown>): string {
  if (typeof meta.reason === 'string' && meta.reason) return meta.reason;
  if (typeof meta.from === 'string' || typeof meta.to === 'string') return `${String(meta.from ?? '未设置')} → ${String(meta.to ?? '未设置')}`;
  return '';
}

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}
