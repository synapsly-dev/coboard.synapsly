import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { isApiClientError } from '../api/client';
import { useAuth } from '../lib/auth-context';
import { Button, Input, Label } from '../components/ui';
import { SynapseMark } from '../components/brand/SynapseMark';

/**
 * First-time join screen. Reached when a brand-new Synapsly identity has no
 * matching coboard account: the OIDC callback stashed the pending identity in a
 * short-lived cookie and redirected here. The user supplies the admin-preset
 * invite code to be provisioned as a member. If the pending-join cookie has
 * expired, we send them back to restart the SSO flow.
 */
export default function JoinPage(): JSX.Element {
  const navigate = useNavigate();
  const { completeJoin, loginWithSynapsly } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await completeJoin({ code: code.trim() });
      navigate('/', { replace: true });
    } catch (err) {
      if (isApiClientError(err) && err.isUnauthorized) {
        setExpired(true);
        setError('加入会话已失效，请重新登录');
      } else {
        setError(isApiClientError(err) ? err.message : '加入失败，请稍后重试');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <main className="flex min-h-full items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm motion-safe:animate-enter-rise">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <SynapseMark className="h-7 w-7" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              加入 Coboard
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              你的 Syna 账号尚未加入本团队，请输入管理员提供的邀请码
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
            {error && (
              <div
                role="alert"
                className="mb-5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </div>
            )}

            {expired ? (
              <Button
                type="button"
                size="lg"
                className="w-full"
                onClick={() => loginWithSynapsly('/')}
              >
                重新登录
              </Button>
            ) : (
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
                noValidate
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="join-code" required>
                    邀请码
                  </Label>
                  <Input
                    id="join-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="邀请码"
                    autoFocus
                  />
                </div>
                <Button type="submit" size="lg" className="w-full" loading={busy}>
                  {busy ? '正在加入…' : '加入团队'}
                </Button>
              </form>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            没有邀请码？请联系团队管理员
          </p>
        </div>
      </main>
    </div>
  );
}
