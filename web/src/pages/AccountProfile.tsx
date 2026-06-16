import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, ImagePlus, KeyRound, Trash2, UserCog } from 'lucide-react';
import {
  passwordSchema,
  updateProfileInputSchema,
  type UpdateProfileInput,
} from 'shared';

import { api, isApiClientError } from '../api/client';
import { useAuth } from '../lib/auth-context';
import { avatarUrl } from '../lib/utils';
import { Avatar, Button, Input, Label } from '../components/ui';

/**
 * Account self-service page. A single account view with three stacked sections:
 * (1) 头像 — upload/preview/remove an avatar (§ Change 1); (2) 显示名称 — edit own
 * display name (§7 PATCH /auth/profile); (3) 修改密码 — change own password (§7
 * POST /auth/password). The server only lets a user change their own data.
 */
export default function AccountProfilePage(): JSX.Element {
  const navigate = useNavigate();

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
          <h1 className="text-xl font-semibold tracking-tight text-foreground">账号设置</h1>
          <p className="text-sm text-muted-foreground">管理你的头像、显示名称与密码</p>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <AvatarSection />
        <DisplayNameSection />
        <PasswordSection />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: card wrapper
// ---------------------------------------------------------------------------

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: avatar upload / preview / remove
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

function AvatarSection(): JSX.Element {
  const { user, updateAvatar, removeAvatar } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after each change so the preview <img> refreshes past the cache.
  const [version, setVersion] = useState(0);

  if (!user) return <Section title="头像">{null}</Section>;

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
    <Section title="头像" description="上传一张图片作为头像，未设置时显示姓名首字母。">
      <div className="flex items-center gap-4">
        <Avatar
          name={user.displayName}
          color={user.avatarColor}
          imageUrl={previewUrl}
          size="lg"
        />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={busy === 'upload'}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" aria-hidden />
              上传头像
            </Button>
            {user.hasAvatar && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                loading={busy === 'remove'}
                onClick={() => void handleRemove()}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                移除头像
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">支持 PNG / JPEG / WebP，上传后自动压缩。</p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Section: display name
// ---------------------------------------------------------------------------

function DisplayNameSection(): JSX.Element {
  const { user, updateProfile } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileInputSchema),
    defaultValues: { displayName: user?.displayName ?? '' },
  });

  async function onSubmit(values: UpdateProfileInput): Promise<void> {
    setSubmitError(null);
    setDone(false);
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
    <Section title="显示名称" description="其他成员看到的名字。">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="display-name" required>
            显示名称
          </Label>
          <Input
            id="display-name"
            placeholder="你的名字"
            invalid={Boolean(errors.displayName)}
            {...register('displayName', { onChange: () => setDone(false) })}
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
        {done && <p className="text-sm text-emerald-600">名称已更新</p>}

        <div>
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            {isSubmitting ? '正在保存…' : '保存'}
          </Button>
        </div>
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Section: password
// ---------------------------------------------------------------------------

const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1, '请输入当前密码'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, '请再次输入新密码'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: '两次输入的新密码不一致',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: '新密码不能与当前密码相同',
    path: ['newPassword'],
  });

type PasswordFormValues = z.infer<typeof passwordFormSchema>;

function PasswordSection(): JSX.Element {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: PasswordFormValues): Promise<void> {
    setSubmitError(null);
    setDone(false);
    try {
      await api.post('/auth/password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      setDone(true);
      reset();
    } catch (err) {
      if (isApiClientError(err)) {
        if (err.status === 400 || err.status === 401) {
          setError('currentPassword', { type: 'server', message: '当前密码不正确' });
          return;
        }
        if (err.fields?.newPassword?.[0]) {
          setError('newPassword', { type: 'server', message: err.fields.newPassword[0] });
          return;
        }
        setSubmitError(err.message);
        return;
      }
      setSubmitError('修改失败，请稍后重试');
    }
  }

  return (
    <Section title="修改密码" description="定期更换密码以保护账号安全。">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="current-password" required>
            当前密码
          </Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            invalid={Boolean(errors.currentPassword)}
            {...register('currentPassword')}
          />
          {errors.currentPassword && (
            <p className="text-xs text-destructive">{errors.currentPassword.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-password" required>
            新密码
          </Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            placeholder="至少 8 位"
            invalid={Boolean(errors.newPassword)}
            {...register('newPassword')}
          />
          {errors.newPassword && (
            <p className="text-xs text-destructive">{errors.newPassword.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-password" required>
            确认新密码
          </Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            invalid={Boolean(errors.confirmPassword)}
            {...register('confirmPassword')}
          />
          {errors.confirmPassword && (
            <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
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
        {done && <p className="text-sm text-emerald-600">密码已更新</p>}

        <div>
          <Button type="submit" loading={isSubmitting}>
            <KeyRound className="h-4 w-4" aria-hidden />
            {isSubmitting ? '正在更新…' : '更新密码'}
          </Button>
        </div>
      </form>
    </Section>
  );
}
