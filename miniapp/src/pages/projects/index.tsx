import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from 'client-core';
import type { ProjectDirectoryItem, Track } from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { ActionButton, Avatar, Badge, Card, Empty, PageHeader } from '../../components/ui';
import { StateView } from '../../components/StateView';
import { AuthGate } from '../../components/AuthGate';
import { queryClient } from '../../lib/query';
import { useSessionToken } from '../../lib/auth';
import './index.scss';

function ProjectsPage(): JSX.Element {
  const token = useSessionToken();
  const queryClient = useQueryClient();
  const directory = useQuery({
    queryKey: ['projects', 'directory', token],
    enabled: Boolean(token),
    queryFn: async () => (await coboardClient.projects.directory()).projects,
  });
  const tracks = useQuery({
    queryKey: [...queryKeys.tracks(), token],
    enabled: Boolean(token),
    queryFn: async () => (await coboardClient.tracks.list()).tracks,
  });
  const membership = useMutation({
    mutationFn: ({ id, join }: { id: string; join: boolean }) => join
      ? coboardClient.projects.join(id)
      : coboardClient.projects.leave(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  useDidShow(() => {
    void directory.refetch();
    void tracks.refetch();
  });
  usePullDownRefresh(async () => {
    await Promise.all([directory.refetch(), tracks.refetch()]);
    Taro.stopPullDownRefresh();
  });

  const projects = directory.data ?? [];
  const activeTracks = (tracks.data ?? []).filter((track) => !track.archived);
  const activeTrackIds = new Set(activeTracks.map((track) => track.id));
  const ungrouped = projects.filter((project) => !project.trackId || !activeTrackIds.has(project.trackId));

  return (
    <View className="page projects-page">
      <PageHeader
        title="项目"
        description={`共 ${projects.length} 个项目，按赛道分组。加入感兴趣的项目即可查看其看板。`}
      />
      <AuthGate>
        <StateView
          loading={directory.isLoading || tracks.isLoading}
          error={directory.isError || tracks.isError}
          empty={false}
          onRetry={() => void Promise.all([directory.refetch(), tracks.refetch()])}
        >
          {projects.length === 0 ? (
            <Empty title="还没有可加入的项目" description="等待管理员创建项目后，这里会列出所有可加入的项目。" />
          ) : (
            <View className="projects-sections">
              {activeTracks.map((track) => (
                <TrackSection
                  key={track.id}
                  track={track}
                  projects={projects.filter((project) => project.trackId === track.id)}
                  loadingId={membership.isPending ? membership.variables?.id : undefined}
                  onToggle={(project) => membership.mutate({ id: project.id, join: !project.isMember })}
                />
              ))}
              {ungrouped.length > 0 && (
                <TrackSection
                  projects={ungrouped}
                  loadingId={membership.isPending ? membership.variables?.id : undefined}
                  onToggle={(project) => membership.mutate({ id: project.id, join: !project.isMember })}
                />
              )}
            </View>
          )}
        </StateView>
      </AuthGate>
    </View>
  );
}

function TrackSection({
  track,
  projects,
  loadingId,
  onToggle,
}: {
  track?: Track;
  projects: ProjectDirectoryItem[];
  loadingId?: string;
  onToggle: (project: ProjectDirectoryItem) => void;
}): JSX.Element {
  return (
    <View className="track-section">
      <View className="track-section__header">
        <View className={`track-section__icon ${track ? 'track-section__icon--primary' : ''}`}>
          <Text>{track ? '⌁' : '◇'}</Text>
        </View>
        <Text className="track-section__title">{track?.name ?? '未归类'}</Text>
        {track && <Badge>{track.key}</Badge>}
        <Text className="track-section__count">{projects.length} 个项目</Text>
        {track && track.managers.length > 0 && (
          <View className="track-managers">
            <Text className="track-managers__label">运营经理</Text>
            <View className="track-managers__avatars">
              {track.managers.slice(0, 3).map((manager) => (
                <Avatar key={manager.userId} name={manager.displayName} color={manager.avatarColor} />
              ))}
            </View>
          </View>
        )}
        {track?.weeklyGoal && (
          <View className="track-goal">
            <Text className="track-goal__icon">◎</Text>
            <Text>{track.weeklyGoal}</Text>
          </View>
        )}
      </View>

      {projects.length === 0 ? (
        <Empty title="该赛道暂无可加入的项目" />
      ) : (
        <View className="stack">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              loading={loadingId === project.id}
              onToggle={() => onToggle(project)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function ProjectCard({
  project,
  loading,
  onToggle,
}: {
  project: ProjectDirectoryItem;
  loading: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <Card className="project-card">
      <View className="project-card__heading">
        <Text className="project-card__title">{project.name}</Text>
        <Badge>{project.key}</Badge>
        {project.isMember && <Badge tone="success">已加入</Badge>}
      </View>
      <Text className={`project-card__description ${project.description ? '' : 'project-card__description--empty'}`}>
        {project.description || '暂无描述'}
      </Text>
      <Text className="project-card__members">♙ {project.memberCount} 名成员</Text>
      <View className="project-card__actions">
        {project.isMember ? (
          <>
            <ActionButton
              size="small"
              onClick={() => {
                Taro.setStorageSync('coboard-board-project', project.id);
                void Taro.switchTab({ url: '/pages/board/index' });
              }}
            >
              进入看板
            </ActionButton>
            <ActionButton tone="ghost" size="small" loading={loading} onClick={onToggle}>退出项目</ActionButton>
          </>
        ) : (
          <ActionButton size="small" loading={loading} onClick={onToggle}>加入</ActionButton>
        )}
      </View>
    </Card>
  );
}

export default function ProjectsPageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><ProjectsPage /></QueryClientProvider>; }
