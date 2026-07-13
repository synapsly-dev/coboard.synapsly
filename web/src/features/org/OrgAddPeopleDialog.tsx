import { useEffect, useMemo, useState } from 'react';
import { Check, Search, UserPlus } from 'lucide-react';
import type { OrgNode, OrgScope } from 'shared';
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
import { useSetTrackMembers } from '../../api/tracks';
import type { OrgCandidate } from './OrgMembersDialog';

interface OrgAddPeopleDialogProps {
  scope: OrgScope;
  node: OrgNode;
  candidates: OrgCandidate[];
  candidatesLoading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Admin/负责人 quick "＋加人": search the directory, tick the people to add, save.
 * Unlike the full {@link OrgMembersDialog} (a tri-state batch replace), this only
 * APPENDS — it merges the ticked users into the node's existing member set as
 * 成员 and never touches 负责人 or removes anyone. It reuses the existing
 * replace-roster endpoints (`setMembers` / `setTrackMembers`) with a pre-merged
 * roster, so no new backend surface is needed. People already on the node are
 * hidden from the list.
 */
export function OrgAddPeopleDialog({
  scope,
  node,
  candidates,
  candidatesLoading,
  open,
  onOpenChange,
}: OrgAddPeopleDialogProps): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const setOrgMut = useSetOrgMembers(scope);
  const setTrackMut = useSetTrackMembers();
  const isPending = node.trackId !== null ? setTrackMut.isPending : setOrgMut.isPending;

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setFilter('');
    setError(null);
  }, [open, node]);

  // People already on the node (any role) can't be "added" again.
  const onNode = useMemo(
    () => new Set([...node.leads, ...node.members].map((p) => p.userId)),
    [node],
  );

  const available = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return candidates.filter(
      (c) => !onNode.has(c.id) && (q === '' || c.displayName.toLowerCase().includes(q)),
    );
  }, [candidates, filter, onNode]);

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async (): Promise<void> => {
    if (selected.size === 0) {
      onOpenChange(false);
      return;
    }
    const leadIds = node.leads.map((p) => p.userId);
    const existingMemberIds = node.members.map((p) => p.userId);
    // Append the ticked people, preserving existing order and de-duping.
    const mergedMembers = [...existingMemberIds];
    for (const c of candidates) {
      if (selected.has(c.id) && !onNode.has(c.id)) mergedMembers.push(c.id);
    }
    try {
      if (node.trackId !== null) {
        await setTrackMut.mutateAsync({
          id: node.trackId,
          input: { managers: leadIds, members: mergedMembers },
        });
      } else {
        await setOrgMut.mutateAsync({
          id: node.id,
          input: { leads: leadIds, members: mergedMembers },
        });
      }
      onOpenChange(false);
    } catch (err) {
      setError(isApiClientError(err) ? err.message : '保存失败，请重试');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>加入成员到「{node.title}」</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索要加入的人…"
              className="pl-9"
            />
          </div>

          <div className="max-h-[52vh] space-y-1 overflow-y-auto pr-1">
            {candidatesLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
            ) : available.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {filter.trim() ? '没有匹配的人' : '大家都已在该单元'}
              </p>
            ) : (
              available.map((c) => {
                const picked = selected.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                      picked
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-transparent hover:bg-accent',
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
                    <span
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-full border',
                        picked
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-transparent',
                      )}
                      aria-hidden
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button onClick={() => void save()} loading={isPending} disabled={selected.size === 0}>
            <UserPlus className="h-4 w-4" />
            加入{selected.size > 0 ? ` ${selected.size} 人` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
