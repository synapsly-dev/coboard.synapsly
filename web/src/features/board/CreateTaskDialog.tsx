import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Plus } from 'lucide-react';
import { createTaskInputSchema, type CreateTaskInput, type Priority } from 'shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../../components/ui';
import { isApiClientError } from '../../api/client';
import { useCreateTask, useProjectMembers } from '../../api/tasks';
import { PRIORITY_LABELS } from './labels';

/**
 * Create-task dialog (§6.1). New tasks default to the `open` column; supplying an
 * assignee dispatches the task into `in_progress` server-side (§6.2). Validated
 * against the shared {@link createTaskInputSchema} via react-hook-form + zod.
 */
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
const UNASSIGNED = '__unassigned__';

interface FormValues {
  title: string;
  description: string;
  priority: Priority;
  points: string;
  dueDate: string;
  assigneeId: string;
}

export interface CreateTaskDialogProps {
  projectId: string;
}

export function CreateTaskDialog({ projectId }: CreateTaskDialogProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { data: members } = useProjectMembers(open ? projectId : undefined);
  const createTask = useCreateTask(projectId);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      title: '',
      description: '',
      priority: 'medium',
      points: '',
      dueDate: '',
      assigneeId: UNASSIGNED,
    },
  });

  const priority = watch('priority');
  const assigneeId = watch('assigneeId');

  const onSubmit = handleSubmit((values) => {
    // Build the API payload, normalizing optional/empty fields.
    const payload: CreateTaskInput = {
      title: values.title.trim(),
      priority: values.priority,
    };
    if (values.description.trim()) payload.description = values.description.trim();
    if (values.points.trim()) {
      const pts = Number(values.points);
      if (Number.isInteger(pts) && pts >= 0) payload.points = pts;
    }
    if (values.dueDate) payload.dueDate = values.dueDate;
    if (values.assigneeId !== UNASSIGNED) payload.assigneeId = values.assigneeId;

    // Validate against the shared contract before sending.
    const parsed = createTaskInputSchema.safeParse(payload);
    if (!parsed.success) {
      const titleIssue = parsed.error.issues.find((iss) => iss.path[0] === 'title');
      if (titleIssue) setError('title', { message: titleIssue.message });
      return;
    }

    createTask.mutate(parsed.data, {
      onSuccess: () => {
        reset();
        setOpen(false);
      },
      onError: (err) => {
        if (isApiClientError(err) && err.fields?.['title']?.[0]) {
          setError('title', { message: err.fields['title'][0] });
        }
      },
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="md">
          <Plus className="h-4 w-4" aria-hidden />
          新建任务
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
          <DialogDescription>
            创建后默认进入「待认领」；如直接指派负责人，将进入「进行中」。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="task-title" required>
              标题
            </Label>
            <Input
              id="task-title"
              autoFocus
              placeholder="简要描述这个任务"
              invalid={!!errors.title}
              {...register('title', { required: '标题不能为空' })}
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="task-desc">描述（支持 Markdown）</Label>
            <Textarea
              id="task-desc"
              rows={4}
              placeholder="补充背景、验收标准等"
              {...register('description')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label>优先级</Label>
              <Select value={priority} onValueChange={(v) => setValue('priority', v as Priority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="task-points">点数（选填）</Label>
              <Input
                id="task-points"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="如 3"
                {...register('points')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="task-due">截止日期（选填）</Label>
              <Input id="task-due" type="date" {...register('dueDate')} />
            </div>

            <div className="grid gap-1.5">
              <Label>负责人（选填）</Label>
              <Select value={assigneeId} onValueChange={(v) => setValue('assigneeId', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="不指派" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>不指派</SelectItem>
                  {(members ?? []).map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.user.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {createTask.isError && !errors.title && (
            <p className="text-xs text-destructive">
              {isApiClientError(createTask.error)
                ? createTask.error.message
                : '创建失败，请稍后重试'}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              取消
            </Button>
            <Button type="submit" loading={createTask.isPending}>
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
