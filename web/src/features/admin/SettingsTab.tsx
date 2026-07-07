import { useEffect, useState } from 'react';
import { CheckCircle2, Settings as SettingsIcon, UserPlus } from 'lucide-react';
import {
  Button,
  EmptyState,
  Input,
  Label,
  Spinner,
  Switch,
} from '../../components/ui';
import { isApiClientError } from '../../api/client';
import { useAdminSettings, useUpdateSettings } from '../../api/settings';

/**
 * Settings tab (§8): self-registration controls. An admin can open/close
 * self-registration and set the verification code that members must enter. The
 * code is a secret only admins can see/edit (the public probe never returns it).
 * Registration only works when enabled AND a non-empty code is configured, so we
 * prevent enabling the toggle while the code is empty.
 */
export function SettingsTab(): JSX.Element {
  const { data, isLoading, isError, refetch } = useAdminSettings();
  const updateSettings = useUpdateSettings();

  const [enabled, setEnabled] = useState(false);
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Seed local form state from the server once it loads (and on refetch).
  useEffect(() => {
    if (data) {
      setEnabled(data.registrationEnabled);
      setCode(data.registrationCode);
    }
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon={SettingsIcon}
        title="加载设置失败"
        description="请检查网络后重试。"
        action={
          <Button variant="outline" onClick={() => void refetch()}>
            重新加载
          </Button>
        }
      />
    );
  }

  const codeEmpty = code.trim().length === 0;
  const dirty = enabled !== data.registrationEnabled || code !== data.registrationCode;

  function toggleEnabled(next: boolean): void {
    setSaved(false);
    // Registration is meaningless without a code; don't let it be turned on then.
    if (next && codeEmpty) {
      setActionError('请先设置邀请码，再开启自助加入');
      return;
    }
    setActionError(null);
    setEnabled(next);
  }

  async function onSave(): Promise<void> {
    setActionError(null);
    setSaved(false);
    try {
      await updateSettings.mutateAsync({
        registrationEnabled: enabled,
        registrationCode: code,
      });
      setSaved(true);
    } catch (err) {
      setActionError(isApiClientError(err) ? err.message : '保存失败，请稍后重试');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">设置</h2>
        <p className="text-sm text-muted-foreground">
          管理自助加入。开启后，用 Syna ID 登录的新用户凭邀请码即可加入为「成员」。
        </p>
      </div>

      <div className="space-y-6 rounded-xl border border-border bg-card p-5 sm:p-6">
        <section className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserPlus className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <Label htmlFor="registration-enabled" className="text-sm font-medium">
                自助加入
              </Label>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {enabled
                  ? '已开启：知道邀请码的人登录后可加入为成员。'
                  : '已关闭：成员仅由管理员按邮箱预先添加。'}
              </p>
            </div>
          </div>
          <Switch
            id="registration-enabled"
            checked={enabled}
            onCheckedChange={toggleEnabled}
            disabled={updateSettings.isPending || (!enabled && codeEmpty)}
            aria-label="开启或关闭自助加入"
          />
        </section>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="registration-code">邀请码</Label>
          <Input
            id="registration-code"
            type="text"
            autoComplete="off"
            placeholder="邀请码"
            value={code}
            onChange={(e) => {
              setSaved(false);
              setActionError(null);
              setCode(e.target.value);
            }}
            disabled={updateSettings.isPending}
          />
          <p className="text-xs text-muted-foreground">
            新用户首次登录后需输入此邀请码才能加入。留空将无法开启自助加入。
          </p>
          {enabled && codeEmpty && (
            <p className="text-xs text-destructive">开启自助加入前必须设置邀请码。</p>
          )}
        </div>

        {actionError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionError}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button
            onClick={() => void onSave()}
            loading={updateSettings.isPending}
            disabled={!dirty || (enabled && codeEmpty)}
          >
            {updateSettings.isPending ? '正在保存…' : '保存'}
          </Button>
          {saved && !dirty && (
            <span className="inline-flex items-center gap-1.5 text-sm text-success motion-safe:animate-fade-in">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              已保存
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
