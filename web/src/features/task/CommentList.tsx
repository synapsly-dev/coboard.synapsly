import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { CommentWithAuthor, ProjectMemberWithUser, Task } from 'shared';
import { updateCommentInputSchema } from 'shared';
import { Avatar, Button, Spinner, Textarea } from '../../components/ui';
import { avatarUrl } from '../../lib/utils';
import { useAuth } from '../../lib/auth-context';
import { useQueryClient } from '@tanstack/react-query';
import { isApiClientError } from '../../api/client';
import { useDeleteComment, useUpdateComment } from '../../api/comments';
import { queryKeys } from '../../lib/query';
import { relativeTime } from '../board/format';
import { isManager } from '../board/permissions';
import type { TaskPermissionContext } from '../board/permissions';
import { AttachmentChips } from '../attachments/AttachmentChips';
import { extractMentions } from './mentions';
import { renderMarkdown } from './markdown';

/**
 * Comment list (§6). Renders each comment's author, time, and SAFELY rendered
 * markdown body (see {@link renderMarkdown} — no raw HTML, XSS-inert). Authors can
 * edit/delete their own comments; managers (admin/lead) can delete any (§6.3).
 */
export interface CommentListProps {
  task: Task;
  comments: CommentWithAuthor[];
  isLoading: boolean;
  members: ProjectMemberWithUser[];
  permCtx: TaskPermissionContext;
}

export function CommentList({
  task,
  comments,
  isLoading,
  members,
  permCtx,
}: CommentListProps): JSX.Element {
  if (isLoading) {
    return (
      <div className="py-4 text-center">
        <Spinner label="加载评论" />
      </div>
    );
  }

  if (comments.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">还没有评论</p>;
  }

  return (
    <ul className="flex flex-col gap-4">
      {comments.map((comment) => (
        <CommentItem
          key={comment.id}
          task={task}
          comment={comment}
          members={members}
          permCtx={permCtx}
        />
      ))}
    </ul>
  );
}

interface CommentItemProps {
  task: Task;
  comment: CommentWithAuthor;
  members: ProjectMemberWithUser[];
  permCtx: TaskPermissionContext;
}

function CommentItem({ task, comment, members, permCtx }: CommentItemProps): JSX.Element {
  const taskId = task.id;
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const updateComment = useUpdateComment(taskId);
  const deleteComment = useDeleteComment(taskId);

  const isAuthor = user?.id === comment.authorId;
  const canEdit = isAuthor;
  const canDelete = isAuthor || isManager(permCtx, task);

  function saveEdit(): void {
    setError(null);
    const trimmed = draft.trim();
    const mentions = extractMentions(trimmed, members);
    const payload = mentions.length > 0 ? { body: trimmed, mentions } : { body: trimmed };
    const parsed = updateCommentInputSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '评论不能为空');
      return;
    }
    updateComment.mutate(
      { commentId: comment.id, body: parsed.data },
      {
        onSuccess: () => setEditing(false),
        onError: (err) =>
          setError(isApiClientError(err) ? err.message : '保存失败，请稍后重试'),
      },
    );
  }

  return (
    <li className="group flex gap-3">
      <Avatar
        name={comment.author.displayName}
        color={comment.author.avatarColor}
        imageUrl={comment.author.hasAvatar ? avatarUrl(comment.author.id) : undefined}
        size="sm"
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {comment.author.displayName}
          </span>
          <span className="text-xs text-muted-foreground">{relativeTime(comment.createdAt)}</span>
          {comment.editedAt && <span className="text-xs text-muted-foreground">（已编辑）</span>}

          {!editing && (canEdit || canDelete) && (
            <span className="ml-auto flex items-center gap-1 opacity-100 transition-opacity sm:gap-0.5 sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 sm:h-7 sm:w-7"
                  aria-label="编辑评论"
                  onClick={() => {
                    setDraft(comment.body);
                    setEditing(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
              {canDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive sm:h-7 sm:w-7"
                  aria-label="删除评论"
                  onClick={() => {
                    if (window.confirm('确定删除这条评论？')) {
                      deleteComment.mutate(comment.id);
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
            </span>
          )}
        </div>

        {editing ? (
          <div className="mt-2 flex flex-col gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              invalid={!!error}
              aria-label="编辑评论内容"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                loading={updateComment.isPending}
                onClick={saveEdit}
                disabled={!draft.trim()}
              >
                保存
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-1 break-words">{renderMarkdown(comment.body)}</div>
            <AttachmentChips
              owner="comments"
              ownerId={comment.id}
              files={comment.files}
              // Mirrors the server rules: the author may add files (also the
              // recovery path for a failed composer upload); uploader/manager delete.
              canUpload={isAuthor}
              canDeleteFile={(f) => f.uploaderId === user?.id || isManager(permCtx, task)}
              onChanged={() =>
                void queryClient.invalidateQueries({ queryKey: queryKeys.comments(taskId) })
              }
            />
          </>
        )}
      </div>
    </li>
  );
}
