import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createTrackInputSchema,
  updateTrackInputSchema,
  type CreateTrackInput,
  type Track,
  type UpdateTrackInput,
} from 'shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '../../components/ui';
import { isApiClientError } from '../../api/client';
import { applyFieldErrors } from '../../lib/form-errors';
import { useCreateTrack, useUpdateTrack } from '../../api/tracks';

/**
 * Create / edit 赛道 dialog (P0 §2, POST /tracks, PATCH /tracks/:id) — global admin.
 *
 * - Create mode: name, key (immutable lowercase slug), 本周目标(weeklyGoal), 描述.
 * - Edit mode: name + weeklyGoal + description (the key is immutable, shown read-only).
 *   Archive/restore is a separate one-click action on the card.
 *
 * Mirrors {@link ProjectFormDialog} — same structure, primitives and error handling.
 */

interface CreateProps {
  mode: 'create';
  /** Custom trigger; defaults to a primary "新建赛道" button. */
  trigger?: ReactNode;
  /** Called after a track is successfully created (e.g. to prompt assigning managers). */
  onCreated?: (track: Track) => void;
}

interface EditProps {
  mode: 'edit';
  track: Track;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TrackFormDialogProps = CreateProps | EditProps;

export function TrackFormDialog(props: TrackFormDialogProps): JSX.Element {
  if (props.mode === 'edit') {
    return (
      <EditTrackDialog track={props.track} open={props.open} onOpenChange={props.onOpenChange} />
    );
  }
  return <CreateTrackDialog trigger={props.trigger} onCreated={props.onCreated} />;
}

function CreateTrackDialog({
  trigger,
  onCreated,
}: {
  trigger?: ReactNode;
  onCreated?: (track: Track) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const createTrack = useCreateTrack();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateTrackInput>({
    resolver: zodResolver(createTrackInputSchema),
    defaultValues: { name: '', key: '', description: '', weeklyGoal: '' },
  });

  useEffect(() => {
    if (open) {
      reset({ name: '', key: '', description: '', weeklyGoal: '' });
      setFormError(null);
    }
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    // Drop empty optionals so they serialize cleanly.
    const payload: CreateTrackInput = {
      name: values.name,
      key: values.key,
    };
    if (values.description?.trim()) payload.description = values.description.trim();
    if (values.weeklyGoal?.trim()) payload.weeklyGoal = values.weeklyGoal.trim();
    try {
      const created = await createTrack.mutateAsync(payload);
      setOpen(false);
      onCreated?.(created);
    } catch (err) {
      if (isApiClientError(err)) {
        if (err.fields) {
          applyFieldErrors<CreateTrackInput>(err.fields, setError);
        } else if (err.isConflict) {
          setError('key', { type: 'server', message: '该赛道标识已被使用' });
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('创建失败，请稍后重试');
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ?? (
        <Button size="sm" onClick={() => setOpen(true)}>
          新建赛道
        </Button>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建赛道</DialogTitle>
          <DialogDescription>赛道用于把多个项目归入统一的运营方向。标识创建后不可修改。</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="new-track-name" required>
              赛道名称
            </Label>
            <Input
              id="new-track-name"
              placeholder="赛道名称"
              invalid={Boolean(errors.name)}
              {...register('name')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="new-track-key" required>
              赛道标识
            </Label>
            <Input
              id="new-track-key"
              placeholder="track-key"
              autoCapitalize="none"
              invalid={Boolean(errors.key)}
              {...register('key', {
                setValueAs: (v: string) => v.trim().toLowerCase(),
              })}
            />
            {errors.key ? (
              <p className="text-xs text-destructive">{errors.key.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">2-20 位小写字母、数字或连字符。</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="new-track-goal">本周目标 / 最低 KPI</Label>
            <Textarea
              id="new-track-goal"
              rows={2}
              placeholder="可选"
              invalid={Boolean(errors.weeklyGoal)}
              {...register('weeklyGoal')}
            />
            {errors.weeklyGoal && (
              <p className="text-xs text-destructive">{errors.weeklyGoal.message}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="new-track-desc">赛道描述</Label>
            <Textarea
              id="new-track-desc"
              rows={3}
              placeholder="可选"
              invalid={Boolean(errors.description)}
              {...register('description')}
            />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description.message}</p>
            )}
          </div>

          {formError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {formError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" loading={createTrack.isPending}>
              创建赛道
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditTrackDialog({
  track,
  open,
  onOpenChange,
}: {
  track: Track;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const updateTrack = useUpdateTrack();
  const [formError, setFormError] = useState<string | null>(null);

  type EditValues = { name: string; weeklyGoal: string; description: string };

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<EditValues>({
    resolver: zodResolver(
      updateTrackInputSchema.innerType().pick({ name: true, weeklyGoal: true, description: true }),
    ),
    defaultValues: {
      name: track.name,
      weeklyGoal: track.weeklyGoal ?? '',
      description: track.description ?? '',
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: track.name,
        weeklyGoal: track.weeklyGoal ?? '',
        description: track.description ?? '',
      });
      setFormError(null);
    }
  }, [open, track, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const input: UpdateTrackInput = {};
    const nextName = values.name.trim();
    if (nextName !== track.name) input.name = nextName;
    const nextGoal = values.weeklyGoal.trim() ? values.weeklyGoal.trim() : null;
    if (nextGoal !== (track.weeklyGoal ?? null)) input.weeklyGoal = nextGoal;
    const nextDesc = values.description.trim() ? values.description.trim() : null;
    if (nextDesc !== (track.description ?? null)) input.description = nextDesc;

    // Nothing changed — just close (the API rejects an empty patch).
    if (Object.keys(input).length === 0) {
      onOpenChange(false);
      return;
    }
    try {
      await updateTrack.mutateAsync({ id: track.id, input });
      onOpenChange(false);
    } catch (err) {
      if (isApiClientError(err)) {
        if (err.fields) {
          applyFieldErrors<EditValues>(err.fields, setError);
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('保存失败，请稍后重试');
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑赛道</DialogTitle>
          <DialogDescription>
            标识 <span className="font-mono font-medium text-foreground">{track.key}</span> 创建后不可修改。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-track-name" required>
              赛道名称
            </Label>
            <Input id="edit-track-name" invalid={Boolean(errors.name)} {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="edit-track-goal">本周目标 / 最低 KPI</Label>
            <Textarea
              id="edit-track-goal"
              rows={2}
              placeholder="可选"
              invalid={Boolean(errors.weeklyGoal)}
              {...register('weeklyGoal')}
            />
            {errors.weeklyGoal && (
              <p className="text-xs text-destructive">{errors.weeklyGoal.message}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="edit-track-desc">赛道描述</Label>
            <Textarea
              id="edit-track-desc"
              rows={3}
              placeholder="可选"
              invalid={Boolean(errors.description)}
              {...register('description')}
            />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description.message}</p>
            )}
          </div>

          {formError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {formError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" loading={updateTrack.isPending}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
