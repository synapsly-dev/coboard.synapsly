import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, LayoutGrid, LogOut, Route, Target, Users as UsersIcon } from 'lucide-react';
import type { ProjectDirectoryItem, Track, TrackMember } from 'shared';
import { Avatar, Badge, Button, EmptyState, Spinner } from '../components/ui';
import { isApiClientError } from '../api/client';
import {
  useJoinProject,
  useLeaveProject,
  useProjectDirectory,
} from '../api/projects';
import { useTracks } from '../api/tracks';
import { avatarUrl } from '../lib/utils';

/**
 * Project directory (§6.3) — a browsable list of every non-archived project that
 * any logged-in user can self-join as a `member` or leave. Projects are grouped by
 * 赛道 (P0 §2): one section per non-archived track (header = name + 本周目标 + 运营
 * 经理), plus a final 「未归类」 group for projects with no (or an archived) track.
 * Join/leave only ever affect the caller's own membership; the server enforces authz.
 */
export default function ProjectsPage(): JSX.Element {
  const { data: projects, isLoading, isError, refetch } = useProjectDirectory();
  const { data: tracks } = useTracks();

  // Group projects by owning track. Non-archived tracks (in server rank order) each
  // get a section; projects with a null / archived / unknown track fall into 未归类.
  const { orderedTracks, byTrack, ungrouped } = useMemo(() => {
    const activeTracks = (tracks ?? []).filter((t) => !t.archived);
    const trackIds = new Set(activeTracks.map((t) => t.id));
    const grouped = new Map<string, ProjectDirectoryItem[]>();
    const pool: ProjectDirectoryItem[] = [];
    for (const project of projects ?? []) {
      if (project.trackId && trackIds.has(project.trackId)) {
        const bucket = grouped.get(project.trackId);
        if (bucket) bucket.push(project);
        else grouped.set(project.trackId, [project]);
      } else {
        pool.push(project);
      }
    }
    return { orderedTracks: activeTracks, byTrack: grouped, ungrouped: pool };
  }, [projects, tracks]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="h-full overflow-y-auto px-4 py-6 sm:px-6">
        <EmptyState
          icon={Compass}
          title="加载项目失败"
          description="请检查网络后重试。"
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              重新加载
            </Button>
          }
        />
      </div>
    );
  }

  const list = projects ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 motion-safe:animate-fade-in sm:px-6">
        <div>
          <h1 className="text-base font-semibold">项目</h1>
          <p className="text-sm text-muted-foreground">
            共 {list.length} 个项目，按赛道分组。加入感兴趣的项目即可查看其看板。
          </p>
        </div>

        {list.length === 0 ? (
          <EmptyState
            icon={Compass}
            title="还没有可加入的项目"
            description="等待管理员创建项目后，这里会列出所有可加入的项目。"
          />
        ) : (
          <>
            {orderedTracks.map((track) => (
              <TrackSection
                key={track.id}
                track={track}
                projects={byTrack.get(track.id) ?? []}
              />
            ))}
            {ungrouped.length > 0 && <UngroupedSection projects={ungrouped} />}
          </>
        )}
      </div>
    </div>
  );
}

/** One 赛道 section: header (name + 本周目标 + 运营经理) over its project cards. */
function TrackSection({
  track,
  projects,
}: {
  track: Track;
  projects: ProjectDirectoryItem[];
}): JSX.Element {
  return (
    <section className="space-y-3">
      <header className="space-y-1.5 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Route className="h-4 w-4" aria-hidden />
          </span>
          <h2 className="text-sm font-semibold text-foreground">{track.name}</h2>
          <Badge variant="outline" className="font-mono">
            {track.key}
          </Badge>
          <span className="text-xs text-muted-foreground">{projects.length} 个项目</span>
          <ManagerAvatars managers={track.managers} className="ml-auto" />
        </div>
        {track.weeklyGoal && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Target className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{track.weeklyGoal}</span>
          </p>
        )}
      </header>
      {projects.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
          该赛道暂无可加入的项目。
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((project) => (
            <DirectoryCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </section>
  );
}

/** The trailing 「未归类」 group for projects with no owning track. */
function UngroupedSection({ projects }: { projects: ProjectDirectoryItem[] }): JSX.Element {
  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Compass className="h-4 w-4" aria-hidden />
        </span>
        <h2 className="text-sm font-semibold text-foreground">未归类</h2>
        <span className="text-xs text-muted-foreground">{projects.length} 个项目</span>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        {projects.map((project) => (
          <DirectoryCard key={project.id} project={project} />
        ))}
      </div>
    </section>
  );
}

/** A compact stacked-avatar row for a track's 运营经理 (managers). */
function ManagerAvatars({
  managers,
  className,
}: {
  managers: TrackMember[];
  className?: string;
}): JSX.Element | null {
  if (managers.length === 0) return null;
  const shown = managers.slice(0, 4);
  const extra = managers.length - shown.length;
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">运营经理</span>
        <div className="flex -space-x-2">
          {shown.map((m) => (
            <Avatar
              key={m.userId}
              name={m.displayName}
              color={m.avatarColor}
              imageUrl={m.hasAvatar ? avatarUrl(m.userId) : undefined}
              size="xs"
              className="ring-2 ring-background"
            />
          ))}
        </div>
        {extra > 0 && <span className="text-xs text-muted-foreground">+{extra}</span>}
      </div>
    </div>
  );
}

/** A single directory card with the join / enter+leave actions. */
function DirectoryCard({ project }: { project: ProjectDirectoryItem }): JSX.Element {
  const navigate = useNavigate();
  const joinProject = useJoinProject();
  const leaveProject = useLeaveProject();
  const [error, setError] = useState<string | null>(null);

  async function handleJoin(): Promise<void> {
    setError(null);
    try {
      await joinProject.mutateAsync(project.id);
    } catch (err) {
      setError(isApiClientError(err) ? err.message : '加入失败，请稍后重试');
    }
  }

  async function handleLeave(): Promise<void> {
    setError(null);
    try {
      await leaveProject.mutateAsync(project.id);
    } catch (err) {
      setError(isApiClientError(err) ? err.message : '退出失败，请稍后重试');
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate font-semibold text-foreground">{project.name}</h2>
          <Badge variant="outline" className="font-mono">
            {project.key}
          </Badge>
          {project.isMember && <Badge variant="success">已加入</Badge>}
        </div>
        {project.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {project.description}
          </p>
        ) : (
          <p className="text-sm italic text-muted-foreground/70">暂无描述</p>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <UsersIcon className="h-3.5 w-3.5" aria-hidden />
          {project.memberCount} 名成员
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-auto flex items-center gap-2 pt-1">
        {project.isMember ? (
          <>
            <Button size="sm" onClick={() => navigate(`/board/${project.id}`)}>
              <LayoutGrid className="h-4 w-4" aria-hidden />
              进入看板
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleLeave()}
              loading={leaveProject.isPending}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              退出项目
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            onClick={() => void handleJoin()}
            loading={joinProject.isPending}
          >
            加入
          </Button>
        )}
      </div>
    </article>
  );
}
