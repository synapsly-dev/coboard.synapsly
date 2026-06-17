import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard } from 'lucide-react';
import { setupInputSchema, type AuthUserResponse, type SetupInput } from 'shared';

import { api, isApiClientError, type FieldErrors } from '../api/client';
import { queryKeys } from '../lib/query';
import { Button, Input, Label } from '../components/ui';

/**
 * First-run setup page (§7 POST /setup, §8). Creates the very first global admin
 * when the instance has no users yet. On success the server sets the session
 * cookie; we prime the auth cache from the response and route into the app, so
 * the first admin lands straight on the board without a second login.
 */

/** Map server field errors onto the form's known field names (§7 `fields`). */
const FIELD_NAMES = ['email', 'password', 'displayName'] as const;

export default function SetupPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SetupInput>({
    resolver: zodResolver(setupInputSchema),
    defaultValues: { email: '', password: '', displayName: '' },
  });

  async function onSubmit(values: SetupInput): Promise<void> {
    setSubmitError(null);
    try {
      const res = await api.post<AuthUserResponse>('/setup', values);
      // Prime the auth cache so RequireAuth lets us through immediately, and mark
      // setup as done so the first-run gate never bounces us back here. The
      // `me` query is the auth context's source of truth (§8), so seeding it
      // flips `isAuthenticated` synchronously for the redirect.
      queryClient.setQueryData(queryKeys.me(), res.user);
      queryClient.setQueryData(queryKeys.setupStatus(), { needsSetup: false });
      navigate('/', { replace: true });
    } catch (err) {
      handleApiError(err, setError, setSubmitError);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
    <main className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <LayoutDashboard className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            初始化 Coboard
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            创建第一个管理员账号，开始团队协作
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <form
            className="flex flex-col gap-5"
            onSubmit={handleSubmit(onSubmit)}
            noValidate
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="setup-displayName" required>
                昵称
              </Label>
              <Input
                id="setup-displayName"
                type="text"
                autoComplete="name"
                placeholder="例如：张三"
                invalid={Boolean(errors.displayName)}
                aria-describedby={errors.displayName ? 'setup-displayName-error' : undefined}
                {...register('displayName')}
              />
              {errors.displayName && (
                <p id="setup-displayName-error" className="text-xs text-destructive">
                  {errors.displayName.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="setup-email" required>
                邮箱
              </Label>
              <Input
                id="setup-email"
                type="email"
                autoComplete="username"
                placeholder="admin@example.com"
                invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'setup-email-error' : undefined}
                {...register('email')}
              />
              {errors.email && (
                <p id="setup-email-error" className="text-xs text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="setup-password" required>
                密码
              </Label>
              <Input
                id="setup-password"
                type="password"
                autoComplete="new-password"
                placeholder="至少 8 位"
                invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'setup-password-error' : undefined}
                {...register('password')}
              />
              {errors.password && (
                <p id="setup-password-error" className="text-xs text-destructive">
                  {errors.password.message}
                </p>
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

            <Button type="submit" size="lg" className="mt-1 w-full" loading={isSubmitting}>
              {isSubmitting ? '正在创建…' : '创建管理员并进入'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          此页面仅在首次部署、尚无任何账号时可用
        </p>
      </div>
    </main>
    </div>
  );
}

/**
 * Translate an API failure into either per-field form errors (so they appear
 * inline) or a banner message. Shared by setup/login submit handlers in shape.
 */
function handleApiError(
  err: unknown,
  setError: (name: (typeof FIELD_NAMES)[number], error: { type: string; message: string }) => void,
  setBanner: (message: string) => void,
): void {
  if (isApiClientError(err)) {
    if (err.fields) {
      applyFieldErrors(err.fields, setError);
    }
    setBanner(err.message);
    return;
  }
  setBanner('创建失败，请稍后重试');
}

function applyFieldErrors(
  fields: FieldErrors,
  setError: (name: (typeof FIELD_NAMES)[number], error: { type: string; message: string }) => void,
): void {
  for (const name of FIELD_NAMES) {
    const messages = fields[name];
    if (messages && messages.length > 0) {
      setError(name, { type: 'server', message: messages[0]! });
    }
  }
}
