import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Input, Picker, Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { TASK_STATUS_META, TASK_STATUS_ORDER, type Task, type TaskStatus } from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { AuthGate } from '../../components/AuthGate';
import { ActionButton, Card, Empty, Field, Segmented } from '../../components/ui';
import { TaskCard } from '../../components/TaskCard';
import { useCurrentUser, useSessionToken } from '../../lib/auth';
import { queryClient } from '../../lib/query';
import './index.scss';

type SortKey = 'default' | 'priority' | 'due';

const SORTS: readonly { value: SortKey; label: string }[] = [
  { value: 'default', label: '默认排序' },
  { value: 'priority', label: '优先级：高 → 低' },
  { value: 'due', label: '截止日期：近 → 远' },
];

const PRIORITY = { low: 0, medium: 1, high: 2, urgent: 3 } as const;

function matches(task: Task, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  return task.title.toLowerCase().includes(query)
    || task.labels.some((label) => label.name.toLowerCase().includes(query))
    || task.claimants.some((claimant) => claimant.displayName.toLowerCase().includes(query))
    || (task.projectName ?? '').toLowerCase().includes(query);
}

function BoardPage(): JSX.Element {
  const token = useSessionToken();
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TaskStatus>('open');
  const [projectId, setProjectId] = useState('all');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('default');

  const projects = useQuery({
    queryKey: ['projects', 'directory', token],
    enabled: Boolean(token),
    queryFn: async () => (await coboardClient.projects.directory()).projects.filter((project) => project.isMember),
  });
  const query = useQuery({
    queryKey: ['board', projectId, token],
    enabled: Boolean(token),
    queryFn: async () => (projectId === 'all'
      ? await coboardClient.tasks.all()
      : await coboardClient.tasks.board(projectId)).tasks,
  });
  const claim = useMutation({
    mutationFn: (id: string) => coboardClient.tasks.claim(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['board'] }),
  });
  const create = useMutation({
    mutationFn: () => coboardClient.tasks.create({
      title: title.trim(),
      description: description.trim() || undefined,
      priority: 'medium',
      minClaimants: 1,
      projectId: projectId === 'all' ? null : projectId,
    }),
    onSuccess: () => {
      setCreating(false);
      setTitle('');
      setDescription('');
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
  });

  useDidShow(() => {
    const stored = Taro.getStorageSync('coboard-board-project');
    if (stored) {
      setProjectId(stored);
      Taro.removeStorageSync('coboard-board-project');
    }
    if (token) {
      void projects.refetch();
      void query.refetch();
      void me.refetch();
    }
  });
  usePullDownRefresh(async () => {
    await query.refetch();
    Taro.stopPullDownRefresh();
  });

  const projectOptions = [{ id: 'all', name: '全部项目' }, ...(projects.data ?? [])];
  const projectIndex = Math.max(0, projectOptions.findIndex((project) => project.id === projectId));
  const tasks = query.data ?? [];
  const statusTasks = tasks.filter((task) => task.status === status);
  const visible = useMemo(() => {
    const filtered = statusTasks.filter((task) => matches(task, search));
    if (sortKey === 'priority') {
      return [...filtered].sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority]);
    }
    if (sortKey === 'due') {
      return [...filtered].sort((a, b) => {
        const aTime = a.dueDate ? Date.parse(a.dueDate) : Number.POSITIVE_INFINITY;
        const bTime = b.dueDate ? Date.parse(b.dueDate) : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      });
    }
    return filtered;
  }, [search, sortKey, statusTasks]);

  return (
    <View className="page board-page">
      <View className="board-toolbar">
        <Picker
          mode="selector"
          range={projectOptions.map((project) => project.name)}
          value={projectIndex}
          onChange={(event) => setProjectId(projectOptions[Number(event.detail.value)]?.id ?? 'all')}
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

      {creating && (
        <Card className="stack board-create">
          <Field label="任务标题" value={title} placeholder="输入任务标题" onChange={setTitle} />
          <Field label="任务说明" value={description} placeholder="补充任务目标和验收标准" multiline onChange={setDescription} />
          <ActionButton loading={create.isPending} disabled={!title.trim()} onClick={() => create.mutate()}>
            创建任务
          </ActionButton>
        </Card>
      )}

      <Segmented
        value={status}
        onChange={(value) => {
          setStatus(value);
          setSearch('');
          setSearchOpen(false);
        }}
        items={TASK_STATUS_ORDER.map((value) => ({
          value,
          label: TASK_STATUS_META[value].label,
          count: tasks.filter((task) => task.status === value).length,
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
              className={`board-icon-button ${searchOpen ? 'board-icon-button--active' : ''}`}
              onClick={() => {
                setSearchOpen((value) => !value);
                if (searchOpen) setSearch('');
              }}
            >
              <Text>⌕</Text>
            </View>
            <Picker
              mode="selector"
              range={SORTS.map((item) => item.label)}
              value={Math.max(0, SORTS.findIndex((item) => item.value === sortKey))}
              onChange={(event) => setSortKey(SORTS[Number(event.detail.value)]?.value ?? 'default')}
            >
              <View className={`board-icon-button ${sortKey !== 'default' ? 'board-icon-button--active' : ''}`}>
                <Text>⇅</Text>
              </View>
            </Picker>
          </View>
        </View>

        {searchOpen && (
          <View className="board-search">
            <Input
              value={search}
              placeholder="搜索标题 / 标签 / 认领人"
              focus
              onInput={(event) => setSearch(event.detail.value)}
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
                <TaskCard
                  key={task.id}
                  task={task}
                  showStatus={false}
                  action={(task.status === 'open' || task.status === 'in_progress')
                    && !task.claimants.some((person) => person.userId === me.data?.id)
                    ? (
                      <ActionButton
                        size="small"
                        loading={claim.isPending && claim.variables === task.id}
                        onClick={() => claim.mutate(task.id)}
                      >
                        认领
                      </ActionButton>
                    )
                    : undefined}
                />
              ))}
            </View>
          )}
        </AuthGate>
      </View>
    </View>
  );
}

export default function BoardPageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><BoardPage /></QueryClientProvider>; }
