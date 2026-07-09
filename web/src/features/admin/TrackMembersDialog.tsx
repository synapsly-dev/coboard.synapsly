import { useEffect, useMemo, useState } from 'react';
import { Crown, Search, User as UserIcon } from 'lucide-react';
import type { Track } from 'shared';
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Spinner,
} from '../../components/ui';
import { avatarUrl, cn } from '../../lib/utils';
import { isApiClientError } from '../../api/client';
import { useSetTrackMembers } from '../../api/tracks';
import { useUsers } from '../../api/users';

/**
 * Assign a 赛道's 运营经理(managers) and 成员(members) — PUT /tracks/:id/members
 * (global admin). Each active user cycles through a tri-state — 无 / 赛道经理 / 成员 —
 * and Save replaces the track's whole membership with the two disjoint sets.
 * Managers gain lead-equivalent authority over the track's projects (§3).
 *
 * Mirrors {@link OrgMembersDialog}, but managers is a set (no single-lead limit).
 */
type Assignment = 'manager' | 'member' | 'none';

export function TrackMembersDialog({
  track,
  open,
  onOpenChange,
}: {
  track: Track;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const usersQuery = useUsers();
  const setMut = useSetTrackMembers();

  const [assignments, setAssignments] = useState<Record<string, Assignment>>({});
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Active users are the candidate pool.
  const candidates = useMemo(
    () => (usersQuery.data ?? []).filter((u) => u.isActive),
    [usersQuery.data],
  );

  // Seed the tri-state from the track's current people each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const seed: Record<string, Assignment> = {};
    for (const m of track.managers) seed[m.userId] = 'manager';
    for (const m of track.members) seed[m.userId] = 'member';
    setAssignments(seed);
    setFilter('');
    setError(null);
  }, [open, track]);

  const cycle = (id: string): void => {
    setAssignments((prev) => {
      const cur = prev[id] ?? 'none';
      const next: Assignment =
        cur === 'none' ? 'manager' : cur === 'manager' ? 'member' : 'none';
      return { ...prev, [id]: next };
    });
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) => c.displayName.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
    );
  }, [candidates, filter]);

  const counts = useMemo(() => {
    let managers = 0;
    let members = 0;
    for (const v of Object.values(assignments)) {
      if (v === 'manager') managers += 1;
      else if (v === 'member') members += 1;
    }
    return { managers, members };
  }, [assignments]);

  const save = async (): Promise<void> => {
    // Preserve candidate-list order for a stable display order.
    const managers: string[] = [];
    const members: string[] = [];
    for (const c of candidates) {
      const a = assignments[c.id];
      if (a === 'manager') managers.push(c.id);
      else if (a === 'member') members.push(c.id);
    }
    try {
      await setMut.mutateAsync({ id: track.id, input: { managers, members } });
      onOpenChange(false);
    } catch (err) {
      setError(isApiClientError(err) ? err.message : '保存失败，请重试');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>管理成员 · {track.name}</DialogTitle>
          <DialogDescription>点击右侧标记切换：无 → 赛道经理 → 成员。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索成员…"
              className="pl-9"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            当前 {counts.managers} 位赛道经理、{counts.members} 位成员。
          </p>

          <div className="max-h-[52vh] space-y-1 overflow-y-auto pr-1">
            {usersQuery.isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Spinner />
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">没有可选成员</p>
            ) : (
              filtered.map((c) => {
                const a = assignments[c.id] ?? 'none';
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => cycle(c.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                      a === 'none'
                        ? 'border-transparent hover:bg-accent'
                        : 'border-border bg-secondary/40',
                    )}
                  >
                    <Avatar
                      name={c.displayName}
                      color={c.avatarColor}
                      imageUrl={c.hasAvatar ? avatarUrl(c.id) : undefined}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {c.displayName}
                    </span>
                    <AssignmentChip assignment={a} />
                  </button>
                );
              })
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={setMut.isPending}>
            取消
          </Button>
          <Button onClick={() => void save()} loading={setMut.isPending}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentChip({ assignment }: { assignment: Assignment }): JSX.Element {
  if (assignment === 'manager') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
        <Crown className="h-3 w-3" /> 赛道经理
      </span>
    );
  }
  if (assignment === 'member') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border">
        <UserIcon className="h-3 w-3" /> 成员
      </span>
    );
  }
  return <span className="rounded-full px-2.5 py-1 text-xs text-muted-foreground/60">未选</span>;
}
