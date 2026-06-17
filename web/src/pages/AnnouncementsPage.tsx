import { useState } from 'react';
import { Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Announcement } from 'shared';
import { createAnnouncementInputSchema, updateAnnouncementInputSchema } from 'shared';
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Spinner,
  Textarea,
} from '../components/ui';
import { avatarUrl } from '../lib/utils';
import { isApiClientError } from '../api/client';
import { useAuth } from '../lib/auth-context';
import { relativeTime } from '../features/board/format';
import { renderMarkdown } from '../features/task/markdown';
import {
  useAnnouncements,
  useCreateAnnouncement,
  useDeleteAnnouncement,
  useUpdateAnnouncement,
} from '../api/announcements';

/**
 * 信息 page — admin-published notices, readable by every logged-in user. A global
 * admin gets 发布 / 编辑 / 删除 controls; everyone else just reads. Notices are shown
 * newest-first with the author, time, and a safely-rendered Markdown body.
 */
export default function AnnouncementsPage(): JSX.Element {
  const { isAdmin } = useAuth();
  const { data: announcements, isLoading, isError } = useAnnouncements();
  // null = closed; 'new' = create; an Announcement = edit that one.
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto">
        <Spinner />
      </div>
    );
  }

  const list = announcements ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-semibold">信息</h1>
            <p className="text-sm text-muted-foreground">
              {isAdmin ? '发布团队公告与通知，所有成员可见。' : '团队公告与通知。'}
            </p>
          </div>
          {isAdmin && (
            <Button size="md" className="shrink-0" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" aria-hidden />
              发布信息
            </Button>
          )}
        </div>

        {isError ? (
          <EmptyState icon={Megaphone} title="加载信息失败" description="请检查网络后重试。" />
        ) : list.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="还没有信息"
            description={isAdmin ? '点击「发布信息」发布第一条公告。' : '管理员尚未发布任何信息。'}
          />
        ) : (
          <ul className="space-y-3">
            {list.map((a) => (
              <AnnouncementCard
                key={a.id}
                announcement={a}
                canManage={isAdmin}
                onEdit={() => setEditing(a)}
              />
            ))}
          </ul>
        )}
      </div>

      {isAdmin && (
        <AnnouncementFormDialog
          open={editing !== null}
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AnnouncementCard({
  announcement,
  canManage,
  onEdit,
}: {
  announcement: Announcement;
  canManage: boolean;
  onEdit: () => void;
}): JSX.Element {
  const deleteAnnouncement = useDeleteAnnouncement();
  const edited = announcement.updatedAt !== announcement.createdAt;

  return (
    <li className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-base font-semibold text-foreground">
          {announcement.title}
        </h2>
        {canManage && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="编辑信息"
              title="编辑"
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              aria-label="删除信息"
              title="删除"
              loading={deleteAnnouncement.isPending}
              onClick={() => {
                if (window.confirm(`确定删除信息「${announcement.title}」？`)) {
                  deleteAnnouncement.mutate(announcement.id);
                }
              }}
            >
              {!deleteAnnouncement.isPending && <Trash2 className="h-3.5 w-3.5" aria-hidden />}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <Avatar
          name={announcement.author.displayName}
          color={announcement.author.avatarColor}
          imageUrl={announcement.author.hasAvatar ? avatarUrl(announcement.author.id) : undefined}
          size="xs"
        />
        <span className="truncate">{announcement.author.displayName}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0">{relativeTime(announcement.createdAt)}</span>
        {edited && <span className="shrink-0">（已编辑）</span>}
      </div>

      <div className="mt-3 break-words text-sm">{renderMarkdown(announcement.body)}</div>
    </li>
  );
}

function AnnouncementFormDialog({
  open,
  existing,
  onClose,
}: {
  open: boolean;
  existing: Announcement | null;
  onClose: () => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? '编辑信息' : '发布信息'}</DialogTitle>
          <DialogDescription>
            {existing
              ? '修改这条信息的标题或内容。'
              : '发布一条所有成员可见的公告。内容支持 Markdown。'}
          </DialogDescription>
        </DialogHeader>
        {/* Keyed so the form state resets between create / editing different notices. */}
        {open && <AnnouncementForm key={existing?.id ?? 'new'} existing={existing} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function AnnouncementForm({
  existing,
  onClose,
}: {
  existing: Announcement | null;
  onClose: () => void;
}): JSX.Element {
  const createAnnouncement = useCreateAnnouncement();
  const updateAnnouncement = useUpdateAnnouncement();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const pending = createAnnouncement.isPending || updateAnnouncement.isPending;

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);
    const payload = { title: title.trim(), body: body.trim() };
    const onError = (err: unknown): void =>
      setError(isApiClientError(err) ? err.message : '提交失败，请稍后重试');

    if (existing) {
      const parsed = updateAnnouncementInputSchema.safeParse(payload);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? '请检查输入');
        return;
      }
      updateAnnouncement.mutate({ id: existing.id, input: parsed.data }, { onSuccess: onClose, onError });
    } else {
      const parsed = createAnnouncementInputSchema.safeParse(payload);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? '请检查输入');
        return;
      }
      createAnnouncement.mutate(parsed.data, { onSuccess: onClose, onError });
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="announcement-title" required>
          标题
        </Label>
        <Input
          id="announcement-title"
          autoFocus
          placeholder="简要标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          invalid={!title.trim() && error !== null}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="announcement-body" required>
          内容（支持 Markdown）
        </Label>
        <Textarea
          id="announcement-body"
          rows={6}
          placeholder="公告内容…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" loading={pending} disabled={!title.trim() || !body.trim()}>
          {existing ? '保存' : '发布'}
        </Button>
      </DialogFooter>
    </form>
  );
}
