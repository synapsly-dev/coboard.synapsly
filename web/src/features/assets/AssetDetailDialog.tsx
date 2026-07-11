import { ExternalLink, ListTodo, Pencil } from 'lucide-react';
import type { Asset } from 'shared';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui';
import { renderMarkdown } from '../task/markdown';
import { avatarUrl, cn } from '../../lib/utils';
import { relativeTime } from '../board/format';
import { ASSET_KIND_META } from './labels';

/** Only http(s)/mailto URLs get a live link (mirrors the markdown renderer). */
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/**
 * Read view for one asset (资产详情): the card preview is clamped to three
 * lines, so long-form entries (产品简报, 复盘, 访谈记录…) open here — a wide
 * dialog with the full body rendered through the SAME safe Markdown pipeline as
 * announcements/comments. Editing stays in AssetFormDialog; the 编辑 button
 * here just hands off (the caller closes this view and opens the form).
 */
export function AssetDetailDialog({
  asset,
  canManage,
  onOpenChange,
  onEdit,
  onOpenTask,
}: {
  /** The asset to show; null renders a closed dialog. */
  asset: Asset | null;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (asset: Asset) => void;
  onOpenTask: (taskId: string) => void;
}): JSX.Element {
  const meta = asset ? ASSET_KIND_META[asset.kind] : null;
  const showLink = asset?.url != null && SAFE_URL.test(asset.url);
  const edited = asset != null && asset.updatedAt !== asset.createdAt;

  return (
    <Dialog open={asset !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl">
        {asset && meta && (
          <>
            <DialogHeader className="shrink-0 space-y-2 border-b border-border px-6 pb-4 pt-6">
              <div className="flex flex-wrap items-center gap-2 pr-8">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none',
                    meta.className,
                  )}
                >
                  {meta.label}
                </span>
                <Badge variant="outline" className="max-w-[12rem]">
                  <span className="truncate">{asset.trackName ?? '通用'}</span>
                </Badge>
                {asset.taskId != null && asset.taskTitle != null && (
                  <button
                    type="button"
                    onClick={() => onOpenTask(asset.taskId!)}
                    className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium leading-none text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={`来源任务：${asset.taskTitle}`}
                  >
                    <ListTodo className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="truncate">{asset.taskTitle}</span>
                  </button>
                )}
              </div>
              <div className="flex items-start justify-between gap-3 pr-8">
                <DialogTitle className="break-words text-lg leading-snug">
                  {asset.title}
                </DialogTitle>
                <div className="flex shrink-0 items-center gap-1">
                  {showLink && (
                    <a
                      href={asset.url!}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="打开外部链接"
                      title={asset.url!}
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden />
                    </a>
                  )}
                  {canManage && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onEdit(asset)}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      编辑
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Avatar
                  name={asset.creator.displayName}
                  color={asset.creator.avatarColor}
                  imageUrl={asset.creator.hasAvatar ? avatarUrl(asset.creator.id) : undefined}
                  size="xs"
                />
                <span className="truncate">{asset.creator.displayName}</span>
                <span aria-hidden>·</span>
                <span className="shrink-0">{relativeTime(asset.createdAt)}</span>
                {edited && <span className="shrink-0">（已编辑）</span>}
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 scrollbar-thin">
              {asset.body.trim() !== '' ? (
                <div className="break-words text-sm">{renderMarkdown(asset.body)}</div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  该资产没有正文{showLink ? '，内容在外部链接中。' : '。'}
                </p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
