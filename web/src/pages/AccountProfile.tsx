import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, CheckCircle2, UserCog } from 'lucide-react';
import { updateProfileInputSchema, type UpdateProfileInput } from 'shared';

import { isApiClientError } from '../api/client';
import { useAuth } from '../lib/auth-context';
import { Avatar, Button, Input, Label } from '../components/ui';

/**
 * Account self-service: edit own profile (§7 PATCH /auth/profile). v1 covers the
 * display name; the server only lets a user change their own name (never role or
 * active state). On success the `me` cache is updated so the nav reflects it.
 */
export default function AccountProfilePage(): JSX.Element {
  const navigate = useNavigate();
  const { user, updateProfile } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileInputSchema),
    defaultValues: { displayName: user?.displayName ?? '' },
  });

  const previewName = watch('displayName') || user?.displayName || '';

  async function onSubmit(values: UpdateProfileInput): Promise<void> {
    setSubmitError(null);
    try {
      await updateProfile({ displayName: values.displayName.trim() });
      setDone(true);
    } catch (err) {
      if (isApiClientError(err)) {
        if (err.fields?.displayName?.[0]) {
          setError('displayName', { type: 'server', message: err.fields.displayName[0] });
          return;
        }
        setSubmitError(err.message);
        return;
      }
      setSubmitError('保存失败，请稍后重试');
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        返回
      </button>

      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <UserCog className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">修改资料</h1>
          <p className="text-sm text-muted-foreground">更新你的显示名称</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        {done ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden />
            <p className="font-medium text-foreground">资料已更新</p>
            <Button onClick={() => navigate('/')}>返回工作台</Button>
          </div>
        ) : (
          <form className="flex flex-col gap-5" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="flex items-center gap-3">
              <Avatar name={previewName} color={user?.avatarColor ?? '#3b82f6'} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{previewName || '—'}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="display-name" required>
                显示名称
              </Label>
              <Input
                id="display-name"
                autoFocus
                placeholder="你的名字"
                invalid={Boolean(errors.displayName)}
                {...register('displayName')}
              />
              {errors.displayName && (
                <p className="text-xs text-destructive">{errors.displayName.message}</p>
              )}
            </div>

            {submitError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {submitError}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className="mt-1 w-full"
              loading={isSubmitting}
              disabled={!isDirty}
            >
              {isSubmitting ? '正在保存…' : '保存'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
