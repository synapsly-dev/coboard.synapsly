import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { LayoutDashboard, Lock } from 'lucide-react';
import { registerInputSchema, type RegisterInput } from 'shared';

import { isApiClientError } from '../api/client';
import { useRegistrationStatus } from '../api/auth';
import { useAuth } from '../lib/auth-context';
import { applyFieldErrors } from '../lib/form-errors';
import { Button, Input, Label } from '../components/ui';
import { FullPageSpinner } from '../components/ui/Spinner';

/**
 * Self-registration page (§8 POST /auth/register, GET /auth/registration).
 * Registration is admin-gated by an invite code. On mount we probe the public
 * status: if closed, we show a friendly "contact the admin" state instead of the
 * form. On a successful submit the server logs the new member in (session
 * cookie); `useAuth().register` syncs the `me` cache so the app reflects the
 * session, then we route into the board home.
 */


export default function RegisterPage(): JSX.Element {
  const navigate = useNavigate();
  const { register: registerAccount } = useAuth();
  const statusQuery = useRegistrationStatus();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerInputSchema),
    defaultValues: { email: '', displayName: '', password: '', code: '' },
  });

  async function onSubmit(values: RegisterInput): Promise<void> {
    setSubmitError(null);
    try {
      await registerAccount(values);
      navigate('/', { replace: true });
    } catch (err) {
      handleRegisterError(err, setError, setSubmitError);
    }
  }

  // While we don't yet know whether registration is open, hold a spinner.
  if (statusQuery.isLoading) {
    return <FullPageSpinner />;
  }

  const open = statusQuery.data?.enabled === true;

  return (
    <div className="h-full overflow-y-auto bg-background">
    <main className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <LayoutDashboard className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            注册 Coboard
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            使用团队验证码自助注册为成员
          </p>
        </div>

        {!open ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center shadow-sm sm:p-8">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
              <Lock className="h-5 w-5" aria-hidden />
            </span>
            <p className="font-medium text-foreground">注册暂未开放</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              请联系管理员开通自助注册，或向管理员索取账号。
            </p>
            <Button variant="outline" className="mt-5 w-full" onClick={() => navigate('/login')}>
              返回登录
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
            <form
              className="flex flex-col gap-5"
              onSubmit={handleSubmit(onSubmit)}
              noValidate
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="register-email" required>
                  邮箱
                </Label>
                <Input
                  id="register-email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@example.com"
                  autoFocus
                  invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'register-email-error' : undefined}
                  {...register('email')}
                />
                {errors.email && (
                  <p id="register-email-error" className="text-xs text-destructive">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="register-displayName" required>
                  昵称
                </Label>
                <Input
                  id="register-displayName"
                  type="text"
                  autoComplete="name"
                  placeholder="例如：张三"
                  invalid={Boolean(errors.displayName)}
                  aria-describedby={
                    errors.displayName ? 'register-displayName-error' : undefined
                  }
                  {...register('displayName')}
                />
                {errors.displayName && (
                  <p id="register-displayName-error" className="text-xs text-destructive">
                    {errors.displayName.message}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="register-password" required>
                  密码
                </Label>
                <Input
                  id="register-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="至少 8 位"
                  invalid={Boolean(errors.password)}
                  aria-describedby={
                    errors.password ? 'register-password-error' : undefined
                  }
                  {...register('password')}
                />
                {errors.password && (
                  <p id="register-password-error" className="text-xs text-destructive">
                    {errors.password.message}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="register-code" required>
                  验证码
                </Label>
                <Input
                  id="register-code"
                  type="text"
                  autoComplete="off"
                  placeholder="向管理员索取的验证码"
                  invalid={Boolean(errors.code)}
                  aria-describedby={errors.code ? 'register-code-error' : undefined}
                  {...register('code')}
                />
                {errors.code && (
                  <p id="register-code-error" className="text-xs text-destructive">
                    {errors.code.message}
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
                {isSubmitting ? '正在注册…' : '注册并进入'}
              </Button>
            </form>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          已有账号？
          <Link to="/login" className="ml-1 text-primary underline-offset-4 hover:underline">
            去登录
          </Link>
        </p>
      </div>
    </main>
    </div>
  );
}

/**
 * Map a registration failure to inline field errors and/or a banner. The gate
 * failure is a single generic 403 ("注册未开放或验证码错误") that we surface as a
 * banner without guessing which input was wrong; 409 means the email is taken.
 */
function handleRegisterError(
  err: unknown,
  setError: UseFormSetError<RegisterInput>,
  setBanner: (message: string) => void,
): void {
  if (isApiClientError(err)) {
    if (err.status === 409) {
      setError('email', { type: 'server', message: '该邮箱已被注册' });
      setBanner('该邮箱已被注册，请直接登录或更换邮箱');
      return;
    }
    if (err.status === 403) {
      setBanner('注册未开放或验证码错误');
      return;
    }
    if (err.fields) {
      applyFieldErrors(err.fields, setError);
    }
    setBanner(err.message);
    return;
  }
  setBanner('注册失败，请稍后重试');
}
