import { useState } from 'react';
import { AtSign, Send } from 'lucide-react';
import type { ProjectMemberWithUser } from 'shared';
import { createCommentInputSchema } from 'shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Textarea,
} from '../../components/ui';
import { useCreateComment } from '../../api/comments';
import { queryKeys } from 'client-core';
import { AttachmentPicker } from '../attachments/AttachmentPicker';
import { useAttachmentSubmit } from '../attachments/useAttachmentSubmit';
import { extractMentions } from './mentions';

/**
 * Comment composer (§6 evaluation). Markdown textarea with an @mention helper;
 * mentioned user ids are derived from member display names on submit and sent
 * alongside the body. Validated against the shared {@link createCommentInputSchema}.
 * Attachments are staged client-side and uploaded right after the comment is
 * created (upload-after-create: nothing to orphan on a cancelled draft).
 */
export interface CommentComposerProps {
  taskId: string;
  members: ProjectMemberWithUser[];
}

export function CommentComposer({ taskId, members }: CommentComposerProps): JSX.Element {
  const [body, setBody] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const createComment = useCreateComment(taskId);
  const queryClient = useQueryClient();
  // Shared create→upload flow; `submitting` covers both, and repeat Cmd/Ctrl+Enter
  // while uploads run is swallowed (status 'busy') instead of double-posting.
  const { submitting, submit } = useAttachmentSubmit('comments');

  function insertMention(name: string): void {
    setBody((prev) => {
      const sep = prev.length === 0 || prev.endsWith(' ') || prev.endsWith('\n') ? '' : ' ';
      return `${prev}${sep}@${name} `;
    });
  }

  async function send(): Promise<void> {
    setError(null);
    const trimmed = body.trim();
    const mentions = extractMentions(trimmed, members);
    const payload = mentions.length > 0 ? { body: trimmed, mentions } : { body: trimmed };
    const parsed = createCommentInputSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '评论不能为空');
      return;
    }

    const result = await submit({
      create: () => createComment.mutateAsync(parsed.data),
      files: pendingFiles,
      invalidate: () =>
        void queryClient.invalidateQueries({ queryKey: queryKeys.comments(taskId) }),
      createdLabel: '评论已发送',
    });
    if (result.status === 'busy') return;
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    if (result.status === 'partial') setError(result.message);
    setBody('');
    setPendingFiles([]);
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    void send();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="写下评论…"
        aria-label="评论内容"
        invalid={!!error}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter to send.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            handleSubmit(e);
          }
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" disabled={members.length === 0}>
                <AtSign className="h-3.5 w-3.5" aria-hidden />
                提及
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-60 overflow-y-auto">
              <DropdownMenuLabel>提及成员</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {members.map((m) => (
                <DropdownMenuItem key={m.userId} onSelect={() => insertMention(m.user.displayName)}>
                  {m.user.displayName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <AttachmentPicker files={pendingFiles} onChange={setPendingFiles} disabled={submitting} />
        </div>

        <Button type="submit" size="sm" loading={submitting} disabled={!body.trim()}>
          {!submitting && <Send className="h-3.5 w-3.5" aria-hidden />}
          发送
        </Button>
      </div>
    </form>
  );
}
