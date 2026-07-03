import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { isApiClientError } from '../api/client';
import { useAuthConfig } from '../api/auth';
import { useAuth } from '../lib/auth-context';
import { Button, Input, Label } from '../components/ui';
import { SynapseMark } from '../components/brand/SynapseMark';

/**
 * Login page — Syna ID SSO. The primary action hands off to the server-driven
 * OIDC flow ("使用 Syna ID 登录"). A dev fake-login box appears only when the
 * server reports `devLogin: true` (non-production). Any `?sso_error=` returned by
 * the callback is surfaced as a banner.
 */

interface LocationState {
  from?: { pathname?: string };
}

export default function LoginPage(): JSX.Element {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { loginWithSynapsly } = useAuth();
  const config = useAuthConfig();
  // Feedback for the full-page SSO redirect: the click has no navigation of its
  // own until the browser leaves, so show the button's spinner meanwhile.
  const [redirecting, setRedirecting] = useState(false);

  const ssoError = searchParams.get('sso_error');
  const redirectTo = (location.state as LocationState | null)?.from?.pathname ?? '/';
  const ssoDisabled = config.data ? !config.data.synapslyEnabled : false;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <main className="flex min-h-full items-center justify-center px-6 py-12">
        {/* One restrained entrance for the whole column — a fade + small settle,
            no per-element stagger. */}
        <div className="w-full max-w-sm motion-safe:animate-enter-rise">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <SynapseMark className="h-7 w-7" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              登录 Coboard
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              使用 Syna 账号继续你的团队协作
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
            {ssoError && (
              <div
                role="alert"
                className="mb-5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {ssoError}
              </div>
            )}

            <Button
              type="button"
              size="lg"
              className="w-full"
              loading={redirecting}
              disabled={ssoDisabled || redirecting}
              onClick={() => {
                setRedirecting(true);
                loginWithSynapsly(redirectTo);
              }}
            >
              {!redirecting && <SynapseMark className="h-4 w-4" />}
              {redirecting ? '正在跳转…' : '使用 Syna ID 登录'}
            </Button>

            {config.data && !config.data.synapslyEnabled && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Syna ID 登录尚未配置，请联系管理员
              </p>
            )}

            {config.data?.devLogin && <DevLoginBox redirectTo={redirectTo} />}
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            登录即表示同意由{' '}
            <span className="font-medium text-foreground">Syna 账号</span> 统一管理你的身份
          </p>
        </div>
      </main>
    </div>
  );
}

/**
 * Local development fake-login (only rendered when the server enables it). Signs
 * in by email without touching Synapsly, so the app stays runnable offline.
 */
function DevLoginBox({ redirectTo }: { redirectTo: string }): JSX.Element {
  const navigate = useNavigate();
  const { devLogin } = useAuth();
  const [email, setEmail] = useState('admin@coboard.local');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await devLogin({ email: email.trim() });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(isApiClientError(err) ? err.message : '假登录失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t border-dashed border-border pt-5">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        开发假登录（Dev only）
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="dev-email" className="sr-only">
          邮箱
        </Label>
        <Input
          id="dev-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={busy}
          onClick={() => void submit()}
        >
          以此邮箱进入
        </Button>
      </div>
    </div>
  );
}
