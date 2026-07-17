import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Input, Picker, Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { canClaim, canDeliver, canReview, canRevokeApproval, resolveProjectRole, TASK_STATUS_META, TASK_STATUS_ORDER, type TaskStatus } from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { AuthGate } from '../../components/AuthGate';
import { ActionButton, Empty, Segmented } from '../../components/ui';
import { TaskCard } from '../../components/TaskCard';
import { useCurrentUser, useSessionToken } from '../../lib/auth';
import { queryClient } from '../../lib/query';
import { BoardFilters, FILTER_ALL, FILTER_ME, LABEL_FILTER_ALL } from '../../features/board/BoardFilters';
import { compareTasksForKey, taskMatcher, type ColumnSortKey } from '../../features/board/sort';
import { CreateTaskForm } from '../../features/board/CreateTaskForm';
import './index.scss';

const SORTS: readonly { value: ColumnSortKey; label: string }[] = [
  { value: 'default', label: '默认排序' },
  { value: 'time_desc', label: '阶段时间：新 → 旧' },
  { value: 'time_asc', label: '阶段时间：旧 → 新' },
  { value: 'priority', label: '优先级：高 → 低' },
  { value: 'due', label: '截止日期：近 → 远' },
];

function BoardPage(): JSX.Element {
  const token = useSessionToken();
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TaskStatus>('open');
  const [projectId, setProjectId] = useState('all');
  const [creating, setCreating] = useState(false);
  const [searchOpen, setSearchOpen] = useState<Record<TaskStatus, boolean>>({ open: false, in_progress: false, pending_review: false, done: false });
  const [searches, setSearches] = useState<Record<TaskStatus, string>>({ open: '', in_progress: '', pending_review: '', done: '' });
  const [sortKeys, setSortKeys] = useState<Record<TaskStatus, ColumnSortKey>>({ open: 'default', in_progress: 'default', pending_review: 'default', done: 'default' });
  const [assignee, setAssignee] = useState(FILTER_ALL);
  const [labelFilter, setLabelFilter] = useState(LABEL_FILTER_ALL);

  const projects = useQuery({
    queryKey: ['projects', 'directory', token],
    enabled: Boolean(token),
    queryFn: async () => (await coboardClient.projects.directory()).projects.filter((project) => project.isMember),
  });
  const query = useQuery({
    queryKey: ['board', projectId, token],
    enabled: Boolean(token),
    queryFn: async () => {
      const response = projectId === 'all'
        ? await coboardClient.tasks.all()
        : await coboardClient.tasks.board(projectId);
      return response.tasks;
    },
  });
  const members = useQuery({
    queryKey: ['projects', projectId, 'members', token],
    enabled: Boolean(token) && projectId !== 'all',
    queryFn: async () => (await coboardClient.projects.members(projectId)).members,
  });
  const labels = useQuery({
    queryKey: ['labels', token],
    enabled: Boolean(token),
    queryFn: async () => (await coboardClient.labels.list()).labels,
  });
  const claim = useMutation({
    mutationFn: (id: string) => coboardClient.tasks.claim(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['board'] }),
  });

  useDidShow(() => {
    const stored = Taro.getStorageSync('coboard-board-project');
    if (stored) {
      setProjectId(stored);
      Taro.removeStorageSync('coboard-board-project');
    }
    if (token) {
      // The first mount already starts these queries. Refetching from the initial
      // useDidShow callback cancels that request in the mini-program runtime.
      if (projects.status !== 'pending') void projects.refetch();
      if (query.status !== 'pending') void query.refetch();
      if (me.status !== 'pending') void me.refetch();
    }
  });
  usePullDownRefresh(async () => {
    await query.refetch();
    Taro.stopPullDownRefresh();
  });

  const projectOptions = [{ id: 'all', name: '全部项目' }, ...(projects.data ?? [])];
  const projectIndex = Math.max(0, projectOptions.findIndex((project) => project.id === projectId));
  const tasks = query.data ?? [];
  const filteredTasks = tasks.filter((task) => {
    if (assignee === FILTER_ME && !task.claimants.some((person) => person.userId === me.data?.id)) return false;
    if (assignee !== FILTER_ALL && assignee !== FILTER_ME && !task.claimants.some((person) => person.userId === assignee)) return false;
    return labelFilter === LABEL_FILTER_ALL || task.labels.some((item) => item.id === labelFilter);
  });
  const statusTasks = filteredTasks.filter((task) => task.status === status);
  const search = searches[status];
  const sortKey = sortKeys[status];
  const visible = useMemo(() => {
    const matcher = taskMatcher(search);
    return statusTasks.filter((task) => !matcher || matcher(task)).sort(compareTasksForKey(status, sortKey));
  }, [search, sortKey, statusTasks]);

  return (
    <View className="page board-page">
      <View className="board-toolbar">
        <Picker
          mode="selector"
          range={projectOptions.map((project) => project.name)}
          value={projectIndex}
          onChange={(event) => {
            setProjectId(projectOptions[Number(event.detail.value)]?.id ?? 'all');
            setAssignee(FILTER_ALL);
          }}
        >
          <View className="board-project-picker">
            <Text className="board-project-picker__label">项目</Text>
            <Text className="board-project-picker__value">{projectOptions[projectIndex]?.name ?? '全部项目'}</Text>
            <Text className="board-project-picker__chevron">⌄</Text>
          </View>
        </Picker>
        <ActionButton size="small" onClick={() => setCreating((value) => !value)}>
          {creating ? '取消' : '新建任务'}
        </ActionButton>
      </View>

      <BoardFilters assignee={assignee} label={labelFilter} members={members.data ?? []} labels={labels.data ?? []} currentUserId={me.data?.id} showMembers={projectId !== 'all'} onAssigneeChange={setAssignee} onLabelChange={setLabelFilter} />

      {creating && <CreateTaskForm boardProjectId={projectId} projects={projects.data ?? []} labels={labels.data ?? []} onCancel={() => setCreating(false)} onCreated={() => setCreating(false)} />}

      <Segmented
        value={status}
        onChange={setStatus}
        items={TASK_STATUS_ORDER.map((value) => ({
          value,
          label: TASK_STATUS_META[value].label,
          count: filteredTasks.filter((task) => task.status === value).length,
        }))}
      />

      <View className="board-column">
        <View className="board-column__header">
          <View className={`board-column__dot board-column__dot--${status}`} />
          <Text className="board-column__title">{TASK_STATUS_META[status].label}</Text>
          <Text className="board-column__count">
            {search.trim() ? `${visible.length}/${statusTasks.length}` : statusTasks.length}
          </Text>
          <View className="board-column__actions">
            <View
              className={`board-icon-button ${searchOpen[status] ? 'board-icon-button--active' : ''}`}
              onClick={() => {
                setSearchOpen((value) => ({ ...value, [status]: !value[status] }));
                if (searchOpen[status]) setSearches((value) => ({ ...value, [status]: '' }));
              }}
            >
              <Text>搜索</Text>
            </View>
            <Picker
              mode="selector"
              range={SORTS.map((item) => item.label)}
              value={Math.max(0, SORTS.findIndex((item) => item.value === sortKey))}
              onChange={(event) => setSortKeys((value) => ({ ...value, [status]: SORTS[Number(event.detail.value)]?.value ?? 'default' }))}
            >
              <View className={`board-icon-button ${sortKey !== 'default' ? 'board-icon-button--active' : ''}`}>
                <Text>排序</Text>
              </View>
            </Picker>
          </View>
        </View>

        {searchOpen[status] && (
          <View className="board-search">
            <Input
              value={search}
              placeholder="搜索标题 / 标签 / 认领人"
              focus
              onInput={(event) => setSearches((value) => ({ ...value, [status]: event.detail.value }))}
            />
          </View>
        )}

        <AuthGate>
          {query.isLoading ? (
            <Empty title="加载看板…" />
          ) : query.isError ? (
            <Empty title="无法加载看板" description="请下拉刷新重试。" />
          ) : visible.length === 0 ? (
            <Empty title={search.trim() && statusTasks.length > 0 ? '无匹配任务' : '暂无任务'} />
          ) : (
            <View className="board-column__tasks">
              {visible.map((task) => (
                (() => {
                  const ctx = { user: me.data ?? null, projectRole: resolveProjectRole(members.data, me.data?.id) };
                  const routeAction = canDeliver(ctx, task) ? '交付' : canReview(ctx, task) ? '审阅' : canRevokeApproval(ctx, task) ? '撤销通过' : null;
                  return (
                <TaskCard
                  key={task.id}
                  task={task}
                  showStatus={false}
                  showProject={projectId === 'all'}
                  action={canClaim(ctx, task) ? (
                      <ActionButton
                        size="small"
                        loading={claim.isPending && claim.variables === task.id}
                        onClick={() => claim.mutate(task.id)}
                      >
                        认领
                      </ActionButton>
                    ) : routeAction ? <ActionButton size="small" tone="secondary" onClick={() => Taro.navigateTo({ url: `/pages/task/index?id=${task.id}&action=${routeAction === '交付' ? 'deliver' : 'review'}` })}>{routeAction}</ActionButton> : undefined}
                />
                  );
                })()
              ))}
            </View>
          )}
        </AuthGate>
      </View>
    </View>
  );
}

export default function BoardPageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><BoardPage /></QueryClientProvider>; }
