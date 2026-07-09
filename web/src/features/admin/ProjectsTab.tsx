import { useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  FolderKanban,
  MoreHorizontal,
  Pencil,
  Users as UsersIcon,
} from 'lucide-react';
import type { Project } from 'shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '../../components/ui';
import { isApiClientError } from '../../api/client';
import { useProjects, useUpdateProject } from '../../api/projects';
import { useTracks } from '../../api/tracks';
import { queryKeys } from '../../lib/query';
import { ProjectFormDialog } from './ProjectFormDialog';
import { ProjectMembersDialog } from './ProjectMembersDialog';

/** Sentinel select value for the 「未归类」 (no track) option (P0 §2). */
const NO_TRACK = '__no_track__';

/**
 * Projects management tab (§6.3, §7). Lists every visible project (admins see
 * all), and lets an admin create projects, edit name/description, manage members
 * and their lead/member role, and archive/restore. Archive is a soft state
 * (`projects.archived`, §5) — never a hard delete in v1.
 */
export function ProjectsTab(): JSX.Element {
  const { data: projects, isLoading, isError, refetch } = useProjects();
  const { data: tracks } = useTracks();
  const updateProject = useUpdateProject();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<Project | null>(null);
  const [managingMembers, setManagingMembers] = useState<Project | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [trackPendingId, setTrackPendingId] = useState<string | null>(null);

  async function toggleArchived(project: Project): Promise<void> {
    setActionError(null);
    setPendingId(project.id);
    try {
      await updateProject.mutateAsync({
        id: project.id,
        input: { archived: !project.archived },
      });
    } catch (err) {
      setActionError(isApiClientError(err) ? err.message : '操作失败，请稍后重试');
    } finally {
      setPendingId(null);
    }
  }

  async function assignTrack(project: Project, value: string): Promise<void> {
    const nextTrackId = value === NO_TRACK ? null : value;
    if (nextTrackId === project.trackId) return;
    setActionError(null);
    setTrackPendingId(project.id);
    try {
      await updateProject.mutateAsync({ id: project.id, input: { trackId: nextTrackId } });
      // Reassigning changes each track's projectCount.
      void queryClient.invalidateQueries({ queryKey: queryKeys.tracks() });
    } catch (err) {
      setActionError(isApiClientError(err) ? err.message : '设置赛道失败，请稍后重试');
    } finally {
      setTrackPendingId(null);
    }
  }

  const activeTracks = (tracks ?? []).filter((t) => !t.archived);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="加载项目失败"
        description="请检查网络后重试。"
        action={
          <Button variant="outline" onClick={() => void refetch()}>
            重新加载
          </Button>
        }
      />
    );
  }

  const list = projects ?? [];
  // Show active projects first, archived ones last.
  const sorted = [...list].sort((a, b) => Number(a.archived) - Number(b.archived));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">项目</h2>
          <p className="text-sm text-muted-foreground">共 {list.length} 个项目。管理项目设置与成员。</p>
        </div>
        <ProjectFormDialog mode="create" onCreated={(p) => setManagingMembers(p)} />
      </div>

      {actionError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="还没有项目"
          description="创建第一个项目来组织团队的任务看板。"
          action={<ProjectFormDialog mode="create" onCreated={(p) => setManagingMembers(p)} />}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sorted.map((project) => (
            <article
              key={project.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate font-semibold text-foreground">{project.name}</h3>
                    <Badge variant="outline" className="shrink-0 font-mono">
                      {project.key}
                    </Badge>
                    {project.archived && <Badge variant="warning" className="shrink-0">已归档</Badge>}
                  </div>
                  {project.description ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {project.description}
                    </p>
                  ) : (
                    <p className="text-sm italic text-muted-foreground/70">暂无描述</p>
                  )}
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`管理 ${project.name}`}
                      loading={pendingId === project.id}
                    >
                      {pendingId !== project.id && (
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setEditing(project)}>
                      <Pencil className="h-4 w-4" aria-hidden />
                      编辑项目
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setManagingMembers(project)}>
                      <UsersIcon className="h-4 w-4" aria-hidden />
                      管理成员
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => void toggleArchived(project)}
                      destructive={!project.archived}
                    >
                      {project.archived ? (
                        <>
                          <ArchiveRestore className="h-4 w-4" aria-hidden />
                          恢复项目
                        </>
                      ) : (
                        <>
                          <Archive className="h-4 w-4" aria-hidden />
                          归档项目
                        </>
                      )}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Assign the project's owning 赛道 (P0 §2). */}
              <div className="mt-auto grid gap-1.5 pt-1">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor={`project-track-${project.id}`}
                >
                  所属赛道
                </label>
                <Select
                  value={project.trackId ?? NO_TRACK}
                  onValueChange={(v) => void assignTrack(project, v)}
                  disabled={trackPendingId === project.id}
                >
                  <SelectTrigger id={`project-track-${project.id}`} className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TRACK}>未归类</SelectItem>
                    {activeTracks.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setManagingMembers(project)}
                >
                  <UsersIcon className="h-4 w-4" aria-hidden />
                  成员
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(project)}>
                  <Pencil className="h-4 w-4" aria-hidden />
                  编辑
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Edit dialog (controlled; one instance for the currently-edited project). */}
      {editing && (
        <ProjectFormDialog
          mode="edit"
          project={editing}
          open={editing !== null}
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
        />
      )}

      {/* Members dialog (controlled). */}
      {managingMembers && (
        <ProjectMembersDialog
          project={managingMembers}
          open={managingMembers !== null}
          onOpenChange={(next) => {
            if (!next) setManagingMembers(null);
          }}
        />
      )}
    </div>
  );
}
