import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Camera, Check, ExternalLink, Trash2, UserCog } from 'lucide-react';
import { updateProfileInputSchema, type UpdateProfileInput } from 'shared';

import { isApiClientError } from '../api/client';
import { useAuth } from '../lib/auth-context';
import { avatarUrl } from '../lib/utils';
import { Avatar, Button, Input, Label, Tooltip } from '../components/ui';

/** Synapsly account self-service (password / email / security) lives in core. */
const SYNAPSLY_ACCOUNT_URL = 'https://auth.synapsly.org/account';

/**
 * Account self-service page. With Synapsly ID SSO, password / email / security are
 * managed in the Synapsly account (linked out below). Coboard keeps the local
 * profile knobs: avatar upload/preview/remove and the display name (§7 PATCH
 * /auth/profile). The server only lets a user change their own data.
 */
export default function AccountProfilePage(): JSX.Element {
  const navigate = useNavigate();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          返回
        </button>

        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UserCog className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">账号设置</h1>
        </div>

        <div className="flex flex-col gap-4">
          <ProfileSection />
          <SynapslyAccountSection />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: card wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title?: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="relative rounded-xl border border-border bg-card p-5 shadow-sm">
      {title && <h2 className="mb-4 text-base font-semibold text-foreground">{title}</h2>}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: profile
// ---------------------------------------------------------------------------

/** Max avatar edge in pixels; the client resizes before upload to keep it tiny. */
const AVATAR_MAX_PX = 256;

/**
 * Resize an image file to a square <= AVATAR_MAX_PX (center-cover) and export it
 * as a JPEG data URL. Keeps uploads small so the server never sees big payloads.
 */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('图片解码失败'));
    el.src = dataUrl;
  });

  const side = Math.min(AVATAR_MAX_PX, Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');

  // Center-cover: scale so the shorter edge fills the square, crop the overflow.
  const scale = side / Math.min(img.width, img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = (side - dw) / 2;
  const dy = (side - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);

  return canvas.toDataURL('image/jpeg', 0.85);
}

function ProfileSection(): JSX.Element {
  const { user, updateAvatar, removeAvatar } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after each change so the preview <img> refreshes past the cache.
  const [version, setVersion] = useState(0);

  if (!user) return <Section>{null}</Section>;

  const previewUrl = user.hasAvatar
    ? `${avatarUrl(user.id)}?t=${version}`
    : undefined;

  async function handleFile(file: File): Promise<void> {
    setError(null);
    setBusy('upload');
    try {
      const image = await fileToAvatarDataUrl(file);
      await updateAvatar(image);
      setVersion((v) => v + 1);
    } catch (err) {
      if (isApiClientError(err)) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : '上传失败，请稍后重试');
      }
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleRemove(): Promise<void> {
    setError(null);
    setBusy('remove');
    try {
      await removeAvatar();
      setVersion((v) => v + 1);
    } catch (err) {
      setError(isApiClientError(err) ? err.message : '移除失败，请稍后重试');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Tooltip
            content="上传一张图片作为头像，未设置时显示姓名首字母。支持 PNG / JPEG / WebP，上传后自动压缩。"
            side="bottom"
          >
            <button
              type="button"
              aria-label="上传头像"
              className="group relative flex h-16 w-16 shrink-0 overflow-hidden rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onClick={() => fileInputRef.current?.click()}
            >
              <Avatar
                name={user.displayName}
                color={user.avatarColor}
                imageUrl={previewUrl}
                size="lg"
                className="h-16 w-16 rounded-full text-base"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Camera className="h-4 w-4" aria-hidden />
              </span>
              {busy === 'upload' && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-xs text-white">
                  上传中
                </span>
              )}
            </button>
          </Tooltip>
          {user.hasAvatar && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="移除头像"
              className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-destructive"
              loading={busy === 'remove'}
              onClick={() => void handleRemove()}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <DisplayNameForm />
          {error && (
            <div
              role="alert"
              className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Section: display name
// ---------------------------------------------------------------------------

function DisplayNameForm(): JSX.Element {
  const { user, updateProfile } = useAuth();
  const [nameHovered, setNameHovered] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileInputSchema),
    defaultValues: { displayName: user?.displayName ?? '' },
  });

  const currentName = user?.displayName ?? '';
  const displayNameValue = watch('displayName');
  const isSynced = displayNameValue.trim() === currentName;
  const displayNameField = register('displayName');
  const showNameTip = nameHovered || nameFocused;

  useEffect(() => {
    reset({ displayName: currentName });
  }, [currentName, reset]);

  async function onSubmit(values: UpdateProfileInput): Promise<void> {
    const nextName = values.displayName.trim();
    if (nextName === currentName) {
      return;
    }

    try {
      const updated = await updateProfile({ displayName: nextName });
      reset({ displayName: updated.displayName });
    } catch (err) {
      if (isApiClientError(err)) {
        if (err.fields?.displayName?.[0]) {
          setError('displayName', { type: 'server', message: err.fields.displayName[0] });
          return;
        }
        setError('displayName', { type: 'server', message: err.message });
        return;
      }
      setError('displayName', { type: 'server', message: '保存失败，请稍后重试' });
    }
  }

  return (
    <form className="flex flex-col gap-1.5" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="flex items-center gap-2">
        <Label htmlFor="display-name" required className="sr-only">
          显示名称
        </Label>
        <Tooltip
          content="其他成员看到的名字。"
          side="bottom"
          align="start"
          open={showNameTip}
        >
          <Input
            id="display-name"
            placeholder="你的名字"
            invalid={Boolean(errors.displayName)}
            onMouseEnter={() => setNameHovered(true)}
            onMouseLeave={() => setNameHovered(false)}
            onFocus={() => setNameFocused(true)}
            {...displayNameField}
            onBlur={(event) => {
              void displayNameField.onBlur(event);
              setNameFocused(false);
            }}
          />
        </Tooltip>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center">
          {!isSynced && (
            <Button
              type="submit"
              size="icon"
              aria-label="保存显示名称"
              loading={isSubmitting}
              disabled={isSynced}
            >
              <Check className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      </div>
      {errors.displayName && (
        <p className="text-xs text-destructive">{errors.displayName.message}</p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Section: Synapsly account (password / email / security live in core)
// ---------------------------------------------------------------------------

function SynapslyAccountSection(): JSX.Element {
  const { user } = useAuth();
  return (
    <Section title="Syna 账号">
      <div className="flex flex-col gap-4">
        <p className="-mt-2 text-sm text-muted-foreground">
          密码、邮箱与安全设置由 Syna 账号统一管理。
        </p>
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {user?.displayName}
            </p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            Syna ID
          </span>
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              window.open(SYNAPSLY_ACCOUNT_URL, '_blank', 'noopener,noreferrer')
            }
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            管理 Syna 账号
          </Button>
        </div>
      </div>
    </Section>
  );
}
