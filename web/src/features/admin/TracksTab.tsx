import { useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Route,
  Target,
  Trash2,
  Users as UsersIcon,
} from 'lucide-react';
import type { Track, TrackMember } from 'shared';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Spinner,
} from '../../components/ui';
import { isApiClientError } from '../../api/client';
import { avatarUrl } from '../../lib/utils';
import { useDeleteTrack, useTracks, useUpdateTrack } from '../../api/tracks';
import { TrackFormDialog } from './TrackFormDialog';
import { TrackMembersDialog } from './TrackMembersDialog';

/**
 * Tracks management tab (P0 §2, §3) — global admin. Lists every 赛道 (name, key,
 * 本周目标, project count, manager avatars) and lets an admin create tracks, edit
 * name/goal/description, assign 运营经理/成员, archive/restore, and delete (409 when a
 * track still owns projects, surfaced inline). Mirrors {@link ProjectsTab}.
 */
export function TracksTab(): JSX.Element {
  const { data: tracks, isLoading, isError, refetch } = useTracks();
  const updateTrack = useUpdateTrack();
  const deleteTrack = useDeleteTrack();

  const [editing, setEditing] = useState<Track | null>(null);
  const [managingMembers, setManagingMembers] = useState<Track | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Track | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function toggleArchived(track: Track): Promise<void> {
    setActionError(null);
    setPendingId(track.id);
    try {
      await updateTrack.mutateAsync({ id: track.id, input: { archived: !track.archived } });
    } catch (err) {
      setActionError(isApiClientError(err) ? err.message : '操作失败，请稍后重试');
    } finally {
      setPendingId(null);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await deleteTrack.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      // 409 = the track still owns projects; surface the server message.
      setDeleteError(isApiClientError(err) ? err.message : '删除失败，请稍后重试');
    }
  }

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
        icon={Route}
        title="加载赛道失败"
        description="请检查网络后重试。"
        action={
          <Button variant="outline" onClick={() => void refetch()}>
            重新加载
          </Button>
        }
      />
    );
  }

  const list = tracks ?? [];
  // Active tracks first, archived ones last.
  const sorted = [...list].sort((a, b) => Number(a.archived) - Number(b.archived));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">赛道</h2>
          <p className="text-sm text-muted-foreground">
            共 {list.length} 条赛道。赛道把多个项目归入统一的运营方向。
          </p>
        </div>
        <TrackFormDialog mode="create" onCreated={(t) => setManagingMembers(t)} />
      </div>

      {actionError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon={Route}
          title="还没有赛道"
          description="创建第一条赛道来组织团队的项目方向。"
          action={<TrackFormDialog mode="create" onCreated={(t) => setManagingMembers(t)} />}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sorted.map((track) => (
            <article
              key={track.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate font-semibold text-foreground">{track.name}</h3>
                    <Badge variant="outline" className="shrink-0 font-mono">
                      {track.key}
                    </Badge>
                    {track.archived && (
                      <Badge variant="warning" className="shrink-0">
                        已归档
                      </Badge>
                    )}
                  </div>
                  {track.weeklyGoal ? (
                    <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                      <Target className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="line-clamp-2">{track.weeklyGoal}</span>
                    </p>
                  ) : (
                    <p className="text-sm italic text-muted-foreground/70">暂无本周目标</p>
                  )}
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`管理 ${track.name}`}
                      loading={pendingId === track.id}
                    >
                      {pendingId !== track.id && (
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setEditing(track)}>
                      <Pencil className="h-4 w-4" aria-hidden />
                      编辑赛道
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setManagingMembers(track)}>
                      <UsersIcon className="h-4 w-4" aria-hidden />
                      管理成员
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => void toggleArchived(track)}
                      destructive={!track.archived}
                    >
                      {track.archived ? (
                        <>
                          <ArchiveRestore className="h-4 w-4" aria-hidden />
                          恢复赛道
                        </>
                      ) : (
                        <>
                          <Archive className="h-4 w-4" aria-hidden />
                          归档赛道
                        </>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      destructive
                      onSelect={() => {
                        setDeleteError(null);
                        setDeleteTarget(track);
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      删除赛道
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Managers + project count */}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                <ManagerAvatars managers={track.managers} />
                <span className="text-xs text-muted-foreground">
                  {track.projectCount} 个项目
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setManagingMembers(track)}>
                  <UsersIcon className="h-4 w-4" aria-hidden />
                  成员
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(track)}>
                  <Pencil className="h-4 w-4" aria-hidden />
                  编辑
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Edit dialog (controlled). */}
      {editing && (
        <TrackFormDialog
          mode="edit"
          track={editing}
          open={editing !== null}
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
        />
      )}

      {/* Members dialog (controlled). */}
      {managingMembers && (
        <TrackMembersDialog
          track={managingMembers}
          open={managingMembers !== null}
          onOpenChange={(next) => {
            if (!next) setManagingMembers(null);
          }}
        />
      )}

      {/* Delete confirmation — surfaces the 409 "still owns projects" error inline. */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除「{deleteTarget?.name}」？</DialogTitle>
            <DialogDescription>
              删除后该赛道下的项目将变为「未归类」。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError(null);
              }}
              disabled={deleteTrack.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              loading={deleteTrack.isPending}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A compact stacked-avatar row for a track's 运营经理 (managers). */
function ManagerAvatars({ managers }: { managers: TrackMember[] }): JSX.Element {
  if (managers.length === 0) {
    return <span className="text-xs text-muted-foreground/70">暂无赛道经理</span>;
  }
  const shown = managers.slice(0, 4);
  const extra = managers.length - shown.length;
  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-2">
        {shown.map((m) => (
          <Avatar
            key={m.userId}
            name={m.displayName}
            color={m.avatarColor}
            imageUrl={m.hasAvatar ? avatarUrl(m.userId) : undefined}
            size="sm"
            className="ring-2 ring-card"
          />
        ))}
      </div>
      {extra > 0 && <span className="text-xs text-muted-foreground">+{extra}</span>}
    </div>
  );
}
