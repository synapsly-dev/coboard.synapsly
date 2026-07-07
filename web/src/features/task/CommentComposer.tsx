import { useState } from 'react';
import { AtSign, Send } from 'lucide-react';
import type { ProjectMemberWithUser } from 'shared';
import { createCommentInputSchema } from 'shared';
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
import { isApiClientError } from '../../api/client';
import { useCreateComment } from '../../api/comments';
import { extractMentions } from './mentions';

/**
 * Comment composer (§6 evaluation). Markdown textarea with an @mention helper;
 * mentioned user ids are derived from member display names on submit and sent
 * alongside the body. Validated against the shared {@link createCommentInputSchema}.
 */
export interface CommentComposerProps {
  taskId: string;
  members: ProjectMemberWithUser[];
}

export function CommentComposer({ taskId, members }: CommentComposerProps): JSX.Element {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createComment = useCreateComment(taskId);

  function insertMention(name: string): void {
    setBody((prev) => {
      const sep = prev.length === 0 || prev.endsWith(' ') || prev.endsWith('\n') ? '' : ' ';
      return `${prev}${sep}@${name} `;
    });
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);
    const trimmed = body.trim();
    const mentions = extractMentions(trimmed, members);
    const payload = mentions.length > 0 ? { body: trimmed, mentions } : { body: trimmed };
    const parsed = createCommentInputSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '评论不能为空');
      return;
    }
    createComment.mutate(parsed.data, {
      onSuccess: () => setBody(''),
      onError: (err) =>
        setError(isApiClientError(err) ? err.message : '发送失败，请稍后重试'),
    });
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
              <DropdownMenuItem
                key={m.userId}
                onSelect={() => insertMention(m.user.displayName)}
              >
                {m.user.displayName}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button type="submit" size="sm" loading={createComment.isPending} disabled={!body.trim()}>
          {!createComment.isPending && <Send className="h-3.5 w-3.5" aria-hidden />}
          发送
        </Button>
      </div>
    </form>
  );
}
