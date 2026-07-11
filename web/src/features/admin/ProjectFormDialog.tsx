import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createProjectInputSchema,
  updateProjectInputSchema,
  type CreateProjectInput,
  type Project,
  type Track,
  type UpdateProjectInput,
} from 'shared';
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
import { applyFieldErrors } from '../../lib/form-errors';
import { useCreateProject, useUpdateProject } from '../../api/projects';

/**
 * Create / edit project dialog (§6.3, §7 POST /projects, PATCH /projects/:id).
 *
 * - Create mode: collects name, key (immutable short identifier), description,
 *   and — when the caller passes `trackOptions` — the owning 赛道 (spec
 *   2026-07-11 §2: on the 项目 page an admin picks from all tracks or 未归类,
 *   while a 赛道运营经理 must pick one of their managed tracks). The admin tab
 *   omits `trackOptions` and keeps assigning the track on the project card.
 * - Edit mode: name + description (the contract's `updateProjectInputSchema` has
 *   no `key`, so the key is shown read-only). Archive/restore is a separate
 *   one-click action on the card, not part of this form.
 */

/** Sentinel select value for the 「未归类」 (no track) option (P0 §2). */
const NO_TRACK = '__no_track__';

interface CreateProps {
  mode: 'create';
  /**
   * Custom trigger; defaults to a primary "新建项目" button. Must be a single
   * button-like element — it is wrapped in `<DialogTrigger asChild>`.
   */
  trigger?: ReactNode;
  /** Called after a project is successfully created (e.g. to prompt adding members). */
  onCreated?: (project: Project) => void;
  /**
   * When set, show a 所属赛道 select over these (non-archived) tracks. Omit to
   * hide the field entirely (the create payload then carries no `trackId`).
   */
  trackOptions?: Track[];
  /** Require picking a track (赛道经理 create — hides the 未归类 option). */
  trackRequired?: boolean;
  /** Preselected track id (e.g. a manager's only managed track). */
  defaultTrackId?: string;
}

interface EditProps {
  mode: 'edit';
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ProjectFormDialogProps = CreateProps | EditProps;

export function ProjectFormDialog(props: ProjectFormDialogProps): JSX.Element {
  if (props.mode === 'edit') {
    return (
      <EditProjectDialog
        project={props.project}
        open={props.open}
        onOpenChange={props.onOpenChange}
      />
    );
  }
  return (
    <CreateProjectDialog
      trigger={props.trigger}
      onCreated={props.onCreated}
      trackOptions={props.trackOptions}
      trackRequired={props.trackRequired}
      defaultTrackId={props.defaultTrackId}
    />
  );
}

function CreateProjectDialog({
  trigger,
  onCreated,
  trackOptions,
  trackRequired = false,
  defaultTrackId,
}: Omit<CreateProps, 'mode'>): JSX.Element {
  const [open, setOpen] = useState(false);
  const createProject = useCreateProject();
  const [formError, setFormError] = useState<string | null>(null);

  // Without a track field the payload carries no trackId; with an optional one
  // it defaults to 未归类 (null); a required one starts unselected (placeholder).
  const initialTrackId =
    defaultTrackId ?? (trackOptions && !trackRequired ? null : undefined);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateProjectInput>({
    // The shared schema keeps trackId optional (admin); a 赛道经理 must pick one.
    resolver: zodResolver(
      createProjectInputSchema.superRefine((value, ctx) => {
        if (trackRequired && !value.trackId) {
          ctx.addIssue({ code: 'custom', path: ['trackId'], message: '请选择所属赛道' });
        }
      }),
    ),
    defaultValues: { name: '', key: '', description: '', trackId: initialTrackId },
  });

  const trackId = watch('trackId');

  useEffect(() => {
    if (open) {
      reset({ name: '', key: '', description: '', trackId: initialTrackId });
      setFormError(null);
    }
    // initialTrackId is derived from props; re-running on its change is harmless.
  }, [open, reset, initialTrackId]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    // Drop an empty optional description so it serializes cleanly.
    const payload: CreateProjectInput = {
      ...values,
      description: values.description?.trim() ? values.description.trim() : undefined,
    };
    try {
      const created = await createProject.mutateAsync(payload);
      setOpen(false);
      onCreated?.(created);
    } catch (err) {
      if (isApiClientError(err)) {
        if (err.fields) {
          applyFieldErrors<CreateProjectInput>(err.fields, setError);
        } else if (err.isConflict) {
          setError('key', { type: 'server', message: '该项目标识已被使用' });
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
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm">新建项目</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>项目用于组织看板、任务与成员。标识创建后不可修改。</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="new-project-name" required>
              项目名称
            </Label>
            <Input
              id="new-project-name"
              placeholder="项目名称"
              invalid={Boolean(errors.name)}
              {...register('name')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="new-project-key" required>
              项目标识
            </Label>
            <Input
              id="new-project-key"
              placeholder="项目标识"
              autoCapitalize="characters"
              invalid={Boolean(errors.key)}
              {...register('key', {
                setValueAs: (v: string) => v.trim().toUpperCase(),
              })}
            />
            {errors.key ? (
              <p className="text-xs text-destructive">{errors.key.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">2-10 位大写字母或数字，用于标识项目。</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="new-project-desc">项目描述</Label>
            <Textarea
              id="new-project-desc"
              rows={3}
              placeholder="可选"
              invalid={Boolean(errors.description)}
              {...register('description')}
            />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description.message}</p>
            )}
          </div>

          {trackOptions && (
            <div className="grid gap-1.5">
              <Label htmlFor="new-project-track" required={trackRequired}>
                所属赛道
              </Label>
              <Select
                // Radix shows the placeholder for '' while staying controlled.
                value={trackId ?? (trackRequired ? '' : NO_TRACK)}
                onValueChange={(v) =>
                  setValue('trackId', v === NO_TRACK ? null : v, { shouldValidate: true })
                }
              >
                <SelectTrigger id="new-project-track" invalid={Boolean(errors.trackId)}>
                  <SelectValue placeholder="请选择赛道" />
                </SelectTrigger>
                <SelectContent>
                  {!trackRequired && <SelectItem value={NO_TRACK}>未归类</SelectItem>}
                  {trackOptions.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.trackId ? (
                <p className="text-xs text-destructive">{errors.trackId.message}</p>
              ) : (
                trackRequired && (
                  <p className="text-xs text-muted-foreground">
                    新项目将归入你管理的赛道。
                  </p>
                )
              )}
            </div>
          )}

          {formError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {formError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" loading={createProject.isPending}>
              创建项目
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const updateProject = useUpdateProject();
  const [formError, setFormError] = useState<string | null>(null);

  type EditValues = { name: string; description: string };

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<EditValues>({
    // Validate name + description against the shared update schema's field rules.
    resolver: zodResolver(
      updateProjectInputSchema.innerType().pick({ name: true, description: true }),
    ),
    defaultValues: { name: project.name, description: project.description ?? '' },
  });

  useEffect(() => {
    if (open) {
      reset({ name: project.name, description: project.description ?? '' });
      setFormError(null);
    }
  }, [open, project, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const input: UpdateProjectInput = {};
    const nextName = values.name.trim();
    if (nextName !== project.name) input.name = nextName;
    const nextDesc = values.description.trim() ? values.description.trim() : null;
    if (nextDesc !== (project.description ?? null)) input.description = nextDesc;

    // Nothing changed — just close (the API would reject an empty patch).
    if (Object.keys(input).length === 0) {
      onOpenChange(false);
      return;
    }
    try {
      await updateProject.mutateAsync({ id: project.id, input });
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
          <DialogTitle>编辑项目</DialogTitle>
          <DialogDescription>
            标识 <span className="font-mono font-medium text-foreground">{project.key}</span> 创建后不可修改。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-project-name" required>
              项目名称
            </Label>
            <Input
              id="edit-project-name"
              invalid={Boolean(errors.name)}
              {...register('name')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="edit-project-desc">项目描述</Label>
            <Textarea
              id="edit-project-desc"
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
            <Button type="submit" loading={updateProject.isPending}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
