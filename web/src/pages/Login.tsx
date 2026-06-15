import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LayoutDashboard } from 'lucide-react';
import { loginInputSchema, type LoginInput } from 'shared';

import { isApiClientError, type FieldErrors } from '../api/client';
import { useAuth } from '../lib/auth-context';
import { Button, Input, Label } from '../components/ui';

/**
 * Login page (§7 POST /auth/login, §8). Authenticates via `useAuth().login`,
 * which posts credentials and syncs the session into the auth cache, then routes
 * back to wherever the user was headed (the `from` location set by RequireAuth)
 * or to the board home.
 */

const FIELD_NAMES = ['email', 'password'] as const;

interface LocationState {
  from?: { pathname?: string };
}

export default function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { email: '', password: '' },
  });

  // Where to land after a successful login: the originally requested route, or
  // the app home which redirects to the first visible project's board.
  const redirectTo = (location.state as LocationState | null)?.from?.pathname ?? '/';

  async function onSubmit(values: LoginInput): Promise<void> {
    setSubmitError(null);
    try {
      await login(values);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      handleLoginError(err, setError, setSubmitError);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <LayoutDashboard className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            登录 Coboard
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            使用团队账号登录，继续你的协作
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <form
            className="flex flex-col gap-5"
            onSubmit={handleSubmit(onSubmit)}
            noValidate
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-email" required>
                邮箱
              </Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="username"
                placeholder="you@example.com"
                autoFocus
                invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'login-email-error' : undefined}
                {...register('email')}
              />
              {errors.email && (
                <p id="login-email-error" className="text-xs text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password" required>
                密码
              </Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'login-password-error' : undefined}
                {...register('password')}
              />
              {errors.password && (
                <p id="login-password-error" className="text-xs text-destructive">
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
              {isSubmitting ? '正在登录…' : '登录'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          没有账号？请联系团队管理员创建
        </p>
      </div>
    </main>
  );
}

/**
 * Map a login failure to inline field errors and/or a banner. 401 is the common
 * "wrong email/password" case (§7) — surface it as a friendly banner rather than
 * leaking which field was wrong.
 */
function handleLoginError(
  err: unknown,
  setError: (name: (typeof FIELD_NAMES)[number], error: { type: string; message: string }) => void,
  setBanner: (message: string) => void,
): void {
  if (isApiClientError(err)) {
    if (err.isUnauthorized) {
      setBanner('邮箱或密码错误');
      return;
    }
    if (err.fields) {
      applyFieldErrors(err.fields, setError);
    }
    setBanner(err.message);
    return;
  }
  setBanner('登录失败，请稍后重试');
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
