import { useState } from 'react';
import { FileText, Send, Trash2 } from 'lucide-react';
import type { Task, TaskText } from 'shared';
import { createTaskTextInputSchema } from 'shared';
import { Avatar, Button, Spinner, Textarea } from '../../components/ui';
import { avatarUrl } from '../../lib/utils';
import { isApiClientError } from '../../api/client';
import { useCreateTaskText, useDeleteTaskText, useTaskTexts } from '../../api/task-texts';
import type { TaskPermissionContext } from '../board/permissions';
import { isManager } from '../board/permissions';
import { relativeTime } from '../board/format';
import { renderMarkdown } from './markdown';

/**
 * Text-deliverable section (交付内容 §7.2) inside the task detail drawer — a Markdown
 * text box to deliver written content (notes, links, summaries), multiple per task
 * like attachments. Each entry shows its author. Any member may submit; the author or
 * a project lead/admin may delete (the server re-enforces both).
 */
export interface TextDeliverySectionProps {
  task: Task;
  permCtx: TaskPermissionContext;
}

export function TextDeliverySection({ task, permCtx }: TextDeliverySectionProps): JSX.Element {
  const taskId = task.id;
  const { data: texts, isLoading } = useTaskTexts(taskId);
  const createText = useCreateTaskText(taskId);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const manager = isManager(permCtx, task);
  const myId = permCtx.user?.id;

  function submit(): void {
    setError(null);
    const parsed = createTaskTextInputSchema.safeParse({ content: draft.trim() });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '请检查输入');
      return;
    }
    createText.mutate(parsed.data, {
      onSuccess: () => setDraft(''),
      onError: (err) =>
        setError(isApiClientError(err) ? err.message : '提交失败，请稍后重试'),
    });
  }

  return (
    <div className="grid min-w-0 gap-2 rounded-lg border border-border bg-secondary/30 p-3">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <FileText className="h-3.5 w-3.5" aria-hidden />
        文本交付（用于交付文字内容，可提交多条）
      </span>

      {/* Composer */}
      <div className="flex flex-col gap-2">
        <Textarea
          rows={3}
          placeholder="填写交付内容…支持 Markdown"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          invalid={!!error}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            loading={createText.isPending}
            disabled={!draft.trim()}
            onClick={submit}
          >
            {!createText.isPending && <Send className="h-3.5 w-3.5" aria-hidden />}
            提交交付
          </Button>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="py-2 text-center">
          <Spinner label="加载交付内容" />
        </div>
      ) : !texts || texts.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">暂无文本交付</p>
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-border/60">
          {texts.map((text) => (
            <TextRow
              key={text.id}
              taskId={taskId}
              text={text}
              canDelete={manager || text.author.id === myId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TextRow({
  taskId,
  text,
  canDelete,
}: {
  taskId: string;
  text: TaskText;
  canDelete: boolean;
}): JSX.Element {
  const deleteText = useDeleteTaskText(taskId);

  return (
    <li className="flex min-w-0 gap-2 py-2">
      <Avatar
        name={text.author.displayName}
        color={text.author.avatarColor}
        imageUrl={text.author.hasAvatar ? avatarUrl(text.author.id) : undefined}
        size="xs"
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate font-medium text-foreground">
            {text.author.displayName}
          </span>
          <span className="shrink-0">{relativeTime(text.createdAt)}</span>
          {canDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label="删除交付内容"
              title="删除"
              loading={deleteText.isPending}
              onClick={() => {
                if (window.confirm('确定删除这条交付内容？')) {
                  deleteText.mutate(text.id);
                }
              }}
            >
              {!deleteText.isPending && <Trash2 className="h-3.5 w-3.5" aria-hidden />}
            </Button>
          )}
        </div>
        <div className="mt-1 break-words text-sm">{renderMarkdown(text.content)}</div>
      </div>
    </li>
  );
}
