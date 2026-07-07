import { useEffect, useMemo, useState } from 'react';
import { Crown, Search, User as UserIcon } from 'lucide-react';
import type { OrgMemberRole, OrgNode, OrgScope } from 'shared';
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '../../components/ui';
import { avatarUrl, cn } from '../../lib/utils';
import { isApiClientError } from '../../api/client';
import { useSetOrgMembers } from '../../api/org';

/** A person who may be placed on a node — normalized from users / project members. */
export interface OrgCandidate {
  id: string;
  displayName: string;
  avatarColor: string;
  hasAvatar: boolean;
}

/** Tri-state assignment for a candidate on the node. */
type Assignment = OrgMemberRole | 'none';

interface OrgMembersDialogProps {
  scope: OrgScope;
  node: OrgNode;
  candidates: OrgCandidate[];
  candidatesLoading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Assign a node's 负责人 (leads) and 成员 (members). Each candidate cycles through a
 * tri-state — 无 / 负责人 / 成员 — and Save replaces the node's whole membership set.
 * Candidate source is provided by the page (all users for the whole-team tree, or the
 * project's members for a project tree). Order follows the candidate list.
 */
export function OrgMembersDialog({
  scope,
  node,
  candidates,
  candidatesLoading,
  open,
  onOpenChange,
}: OrgMembersDialogProps): JSX.Element {
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({});
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const setMut = useSetOrgMembers(scope);

  // Seed the tri-state from the node's current people each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const seed: Record<string, Assignment> = {};
    node.leads.forEach((lead, index) => {
      seed[lead.userId] = index === 0 ? 'lead' : 'member';
    });
    for (const m of node.members) seed[m.userId] = 'member';
    setAssignments(seed);
    setFilter('');
    setError(null);
  }, [open, node]);

  const cycle = (id: string): void => {
    setAssignments((prev) => {
      const cur = prev[id] ?? 'none';
      const next: Assignment = cur === 'none' ? 'lead' : cur === 'lead' ? 'member' : 'none';
      const updated = { ...prev };
      if (next === 'lead') {
        for (const [otherId, assignment] of Object.entries(updated)) {
          if (otherId !== id && assignment === 'lead') {
            updated[otherId] = 'member';
          }
        }
      }
      updated[id] = next;
      return updated;
    });
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.displayName.toLowerCase().includes(q));
  }, [candidates, filter]);

  const counts = useMemo(() => {
    let leads = 0;
    let members = 0;
    for (const v of Object.values(assignments)) {
      if (v === 'lead') leads += 1;
      else if (v === 'member') members += 1;
    }
    return { leads, members };
  }, [assignments]);

  const save = async (): Promise<void> => {
    // Preserve candidate-list order for a stable display order.
    const leads: string[] = [];
    const members: string[] = [];
    for (const c of candidates) {
      const a = assignments[c.id];
      if (a === 'lead') leads.push(c.id);
      else if (a === 'member') members.push(c.id);
    }
    if (leads.length > 1) {
      setError('一个节点只能设置一位负责人');
      return;
    }
    try {
      await setMut.mutateAsync({ id: node.id, input: { leads, members } });
      onOpenChange(false);
    } catch (err) {
      setError(isApiClientError(err) ? err.message : '保存失败，请重试');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>设置「{node.title}」的负责人与成员</DialogTitle>
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
            点击右侧标记切换：无 → 负责人 → 成员。当前 {counts.leads} 位负责人、
            {counts.members} 位成员。
          </p>

          <div className="max-h-[52vh] space-y-1 overflow-y-auto pr-1">
            {candidatesLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
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
  if (assignment === 'lead') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
        <Crown className="h-3 w-3" /> 负责人
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
