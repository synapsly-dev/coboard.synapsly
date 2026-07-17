import Taro, { usePullDownRefresh, useRouter } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { queryKeys } from 'client-core';
import {
  canDeliver,
  canEditTask,
  canReview,
  canRevokeApproval,
  resolveProjectRole,
  TASK_STATUS_META,
  type QualityGrade,
  type Task,
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
  PageHeader,
  Segmented,
  SelectField,
} from '../../components/ui';
import { StateView } from '../../components/StateView';
import { AuthGate } from '../../components/AuthGate';
import { queryClient } from '../../lib/query';
import { EditTaskForm } from '../../features/task/EditTaskForm';
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
    mutationFn: () => coboardClient.tasks.release(id!),
    onSuccess: (response) => refresh(response.task),
  });
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof coboardClient.tasks.update>[1]) => coboardClient.tasks.update(id!, patch),
    onSuccess: (response) => { refresh(response.task); setEditing(false); },
  });
  const task = taskQuery.data;
  const myClaim = task?.claimants.find((person) => person.userId === me.data?.id);
  const permission = task
    ? { user: me.data ?? null, projectRole: resolveProjectRole(members.data, me.data?.id) }
    : null;
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
              <View className="task-actions">
                {!myClaim && (task.status === 'open' || task.status === 'in_progress') && (
                  <ActionButton loading={claim.isPending} onClick={() => claim.mutate()}>
                    认领任务
                  </ActionButton>
                )}
                {myClaim && (task.status === 'open' || task.status === 'in_progress') && (
                  <ActionButton
                    tone="secondary"
                    loading={release.isPending}
                    onClick={() => release.mutate()}
                  >
                    释放任务
                  </ActionButton>
                )}
              </View>
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
              {tab === 'overview' && <Overview task={task} />}
              {tab === 'deliver' && (
                <DeliverPanel
                  task={task}
                  canDeliverTask={permission ? canDeliver(permission, task) : false}
                  canReviewTask={permission ? canReview(permission, task) : false}
                  canRevokeTask={permission ? canRevokeApproval(permission, task) : false}
                  texts={texts.data ?? []}
                  files={files.data ?? []}
                  reviews={reviews.data ?? []}
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
                  onRefresh={() => void comments.refetch()}
                />
              )}
              {tab === 'ideas' && (
                <IdeaPanel
                  taskId={id!}
                  ideas={ideas.data ?? []}
                  loading={ideas.isLoading}
                  onRefresh={() => void ideas.refetch()}
                />
              )}
              {tab === 'activity' && (
                <ActivityPanel activities={activities.data ?? []} loading={activities.isLoading} />
              )}
              </>}
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

function Overview({ task }: { task: Task }): JSX.Element {
  return (
    <View className="stack">
      <DetailCard title="任务说明" body={task.description} empty="暂无任务说明" />
      <DetailCard title="提交要求" body={task.deliverableSpec} empty="未填写提交要求" />
      <DetailCard title="验收标准" body={task.acceptanceCriteria} empty="未填写验收标准" />
      <Card>
        <View className="stack">
          <Text className="title">参与者</Text>
          {task.claimants.length === 0 ? (
            <Text className="caption">尚无人认领 · 需要至少 {task.minClaimants} 人</Text>
          ) : (
            task.claimants.map((person) => (
              <View key={person.userId} className="row">
                <Avatar name={person.displayName} color={person.avatarColor} />
                <View style={{ flex: 1 }}>
                  <Text className="body">{person.displayName}</Text>
                  <Text className="caption">
                    {person.points == null ? '待分配点数' : `${person.points} 点`}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </Card>
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
        <Text className={body ? 'body' : 'caption'}>{body || empty}</Text>
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
  onTask: (task: Task) => void;
  onRefresh: () => void;
}): JSX.Element {
  const [content, setContent] = useState('');
  const [total, setTotal] = useState(String(task.points ?? 0));
  const [grade, setGrade] = useState<QualityGrade>('b');
  const [reviewComment, setReviewComment] = useState('');
  const addText = useMutation({
    mutationFn: () => coboardClient.taskTexts.create(task.id, { content: content.trim() }),
    onSuccess: () => {
      setContent('');
      onRefresh();
    },
  });
  const upload = useMutation({
    mutationFn: async () => {
      const chosen = await Taro.chooseMessageFile({ count: 1, type: 'file' });
      const file = chosen.tempFiles[0];
      if (!file) throw new Error('未选择文件');
      return coboardClient.files.task.upload(task.id, { path: file.path, name: file.name });
    },
    onSuccess: onRefresh,
  });
  const deliver = useMutation({
    mutationFn: () => {
      const points = Math.max(0, Number.parseInt(total, 10) || 0);
      const count = Math.max(1, task.claimants.length);
      const base = Math.floor(points / count);
      let remainder = points - base * count;
      const allocations = task.claimants.map((person) => ({
        userId: person.userId,
        points: base + (remainder-- > 0 ? 1 : 0),
      }));
      return coboardClient.tasks.deliver(task.id, {
        allocations,
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
            <Text className="body">{item.content}</Text>
            <Text className="caption">{item.author.displayName}</Text>
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
            <View key={file.id} className="row-between delivery-item">
              <Text className="body">{file.filename}</Text>
              <Text className="caption">{formatBytes(file.sizeBytes)}</Text>
            </View>
          ))
        )}
      </Card>
      {canDeliverTask && (
        <Card className="stack">
          <Text className="title">提交审核</Text>
          <Field label="任务总点数" value={total} placeholder="0" onChange={setTotal} />
          <Text className="caption">
            点数会在 {task.claimants.length} 名参与者之间平均分配，审核人可按结果确认。
          </Text>
          <ActionButton loading={deliver.isPending} onClick={() => deliver.mutate()}>
            提交审核
          </ActionButton>
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
    </View>
  );
}

function CommentPanel({
  taskId,
  comments,
  loading,
  onRefresh,
}: {
  taskId: string;
  comments: Awaited<ReturnType<typeof coboardClient.comments.list>>['comments'];
  loading: boolean;
  onRefresh: () => void;
}): JSX.Element {
  const [body, setBody] = useState('');
  const create = useMutation({
    mutationFn: () => coboardClient.comments.create(taskId, { body: body.trim() }),
    onSuccess: () => {
      setBody('');
      onRefresh();
    },
  });
  return (
    <View className="stack">
      <Card className="stack">
        <Field
          label="发表评论"
          value={body}
          multiline
          placeholder="补充进展、反馈或问题…"
          onChange={setBody}
        />
        <ActionButton
          size="small"
          disabled={!body.trim()}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          发送评论
        </ActionButton>
      </Card>
      {loading ? (
        <Empty title="加载评论…" />
      ) : comments.length === 0 ? (
        <Empty title="暂无评论" />
      ) : (
        comments.map((item) => (
          <Card key={item.id}>
            <View className="stack">
              <View className="row">
                <Avatar name={item.author.displayName} color={item.author.avatarColor} />
                <View>
                  <Text className="title">{item.author.displayName}</Text>
                  <Text className="caption">
                    {new Date(item.createdAt).toLocaleString('zh-CN')}
                  </Text>
                </View>
              </View>
              <Text className="body">{item.body}</Text>
              {item.files.length > 0 && <Badge>{item.files.length} 个附件</Badge>}
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
  onRefresh,
}: {
  taskId: string;
  ideas: Awaited<ReturnType<typeof coboardClient.ideas.forTask>>['ideas'];
  loading: boolean;
  onRefresh: () => void;
}): JSX.Element {
  const [body, setBody] = useState('');
  const create = useMutation({
    mutationFn: () => coboardClient.ideas.create(taskId, { body: body.trim() }),
    onSuccess: () => {
      setBody('');
      onRefresh();
    },
  });
  return (
    <View className="stack">
      <Card className="stack">
        <Field
          label="记录灵感"
          value={body}
          multiline
          placeholder="与这个任务相关的新想法…"
          onChange={setBody}
        />
        <ActionButton
          size="small"
          disabled={!body.trim()}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          添加灵感
        </ActionButton>
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
                <Text className="caption">{item.author.displayName}</Text>
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
              <Text className="body">{item.body}</Text>
              {item.rewardPoints != null && <Badge tone="primary">+{item.rewardPoints} 点</Badge>}
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
          <View className="timeline__dot" />
          <View>
            <Text className="body">
              {item.actor.displayName} {activityLabel(item.type)}
            </Text>
            <Text className="caption">{new Date(item.createdAt).toLocaleString('zh-CN')}</Text>
          </View>
        </View>
      ))}
    </View>
  );
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
function formatBytes(value: number): string {
  return value < 1024
    ? `${value} B`
    : value < 1048576
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1048576).toFixed(1)} MB`;
}
