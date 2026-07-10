import { useState } from 'react';
import type { Asset, AssetKind, CreateAssetInput, UpdateAssetInput } from 'shared';
import { createAssetInputSchema, updateAssetInputSchema } from 'shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useCreateAsset, useUpdateAsset } from '../../api/assets';
import { useTracks } from '../../api/tracks';
import { ASSET_KIND_META, ASSET_KIND_OPTIONS } from './labels';

/**
 * Create / edit dialog for a 资产 (P3 §1). Shared by the 资产 page (blank create +
 * edit) and the task drawer's 「沉淀为资产」 entry, which pre-fills title / taskId /
 * trackId from a done task. Body-or-url is client-enforced before submit (mirrors
 * the shared schema's refine); the server re-validates.
 */

/** Sentinel for the 通用 (no track) option — Radix selects need non-empty values. */
const NO_TRACK = '__no_track__';

/** Pre-filled values for the 「沉淀为资产」 flow (create only). */
export interface AssetPrefill {
  title?: string;
  /** Source task for 溯源; rides along invisibly on the create payload. */
  taskId?: string;
  trackId?: string | null;
  kind?: AssetKind;
}

export interface AssetFormDialogProps {
  open: boolean;
  /** Asset being edited, or null to create. */
  existing: Asset | null;
  /** Initial values for a create (ignored when editing). */
  prefill?: AssetPrefill;
  onClose: () => void;
}

export function AssetFormDialog({
  open,
  existing,
  prefill,
  onClose,
}: AssetFormDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? '编辑资产' : '新建资产'}</DialogTitle>
          <DialogDescription>
            {existing
              ? '修改这条资产的分类、内容或归属赛道。'
              : '把有复用价值的内容沉淀到团队资产库，正文和外部链接至少填写一项。'}
          </DialogDescription>
        </DialogHeader>
        {/* Keyed so state resets between create / editing / different prefills. */}
        {open && (
          <AssetForm
            key={existing?.id ?? prefill?.taskId ?? 'new'}
            existing={existing}
            prefill={prefill}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssetForm({
  existing,
  prefill,
  onClose,
}: {
  existing: Asset | null;
  prefill?: AssetPrefill;
  onClose: () => void;
}): JSX.Element {
  const { data: tracks } = useTracks();
  const createAsset = useCreateAsset();
  const updateAsset = useUpdateAsset();

  const [kind, setKind] = useState<AssetKind>(existing?.kind ?? prefill?.kind ?? 'content');
  const [title, setTitle] = useState(existing?.title ?? prefill?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [url, setUrl] = useState(existing?.url ?? '');
  const initialTrack = existing ? existing.trackId : prefill?.trackId ?? null;
  const [trackSel, setTrackSel] = useState<string>(initialTrack ?? NO_TRACK);
  const [error, setError] = useState<string | null>(null);
  const pending = createAsset.isPending || updateAsset.isPending;

  // Options: non-archived tracks, plus the current selection even if archived so
  // an existing assignment stays visible/representable.
  const trackOptions = (tracks ?? []).filter((t) => !t.archived || t.id === trackSel);

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);
    const trimmedBody = body.trim();
    const trimmedUrl = url.trim();
    // Body-or-url (P3 §1) — enforced up front so the edit path errors identically
    // to the create schema's refine.
    if (!trimmedBody && !trimmedUrl) {
      setError('正文和链接至少填写一项');
      return;
    }
    const trackId = trackSel === NO_TRACK ? null : trackSel;
    const onError = (err: unknown): void =>
      setError(isApiClientError(err) ? err.message : '提交失败，请稍后重试');

    if (existing) {
      const input: UpdateAssetInput = {
        kind,
        title: title.trim(),
        body: trimmedBody,
        url: trimmedUrl ? trimmedUrl : null,
        trackId,
      };
      const parsed = updateAssetInputSchema.safeParse(input);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? '请检查输入');
        return;
      }
      updateAsset.mutate({ id: existing.id, input: parsed.data }, { onSuccess: onClose, onError });
    } else {
      const input: CreateAssetInput = {
        kind,
        title: title.trim(),
        ...(trimmedBody ? { body: trimmedBody } : {}),
        ...(trimmedUrl ? { url: trimmedUrl } : {}),
        trackId,
        ...(prefill?.taskId ? { taskId: prefill.taskId } : {}),
      };
      const parsed = createAssetInputSchema.safeParse(input);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? '请检查输入');
        return;
      }
      createAsset.mutate(parsed.data, { onSuccess: onClose, onError });
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>分类</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as AssetKind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSET_KIND_OPTIONS.map((k) => (
                <SelectItem key={k} value={k}>
                  {ASSET_KIND_META[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>归属赛道</Label>
          <Select value={trackSel} onValueChange={setTrackSel}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TRACK}>通用</SelectItem>
              {trackOptions.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="asset-title" required>
          标题
        </Label>
        <Input
          id="asset-title"
          autoFocus
          placeholder="资产标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          invalid={!title.trim() && error !== null}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="asset-body">正文（支持 Markdown）</Label>
        <Textarea
          id="asset-body"
          rows={5}
          placeholder="原话 / 记录 / 可复用的结构、联系方式…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="asset-url">外部链接（选填）</Label>
        {/* Plain text (not type="url") so zod's Chinese message handles bad URLs
            instead of the browser's native validation bubble. */}
        <Input
          id="asset-url"
          inputMode="url"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">正文和链接至少填写一项。</p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" loading={pending} disabled={!title.trim()}>
          {existing ? '保存' : '创建'}
        </Button>
      </DialogFooter>
    </form>
  );
}
