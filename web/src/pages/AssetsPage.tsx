import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Library, ListTodo, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { Asset, AssetKind } from 'shared';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '../components/ui';
import { avatarUrl, cn } from '../lib/utils';
import { useAuth } from '../lib/auth-context';
import { useAssets, useDeleteAsset } from '../api/assets';
import { useIsAnyTrackManager, useTracks } from '../api/tracks';
import { relativeTime } from '../features/board/format';
import { ASSET_KIND_META, ASSET_KIND_OPTIONS } from '../features/assets/labels';
import { filterAssets, TRACK_ALL, TRACK_NONE } from '../features/assets/filter';
import { AssetFormDialog } from '../features/assets/AssetFormDialog';

/**
 * 资产库 page (P3 §1, 运营需求 §9) — the durable output of the weekly retrospective
 * loop, split into 内容库/反馈库/资源库/问题清单. Any member reads and creates;
 * edit/delete controls show for the author, a global admin, or any 赛道经理 (the
 * server is the real gate). Kind tabs + the 赛道 filter query the server; 通用 and
 * the search box refine client-side (see features/assets/filter).
 */

/** Sentinel for the "全部" kind tab. */
const KIND_ALL = 'all';

export default function AssetsPage(): JSX.Element {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const isTrackManager = useIsAnyTrackManager();

  const [kind, setKind] = useState<AssetKind | typeof KIND_ALL>(KIND_ALL);
  const [trackFilter, setTrackFilter] = useState<string>(TRACK_ALL);
  const [search, setSearch] = useState('');
  // null = closed; 'new' = create; an Asset = edit that one.
  const [editing, setEditing] = useState<Asset | 'new' | null>(null);

  const { data: tracks } = useTracks();
  const { data: assets, isLoading, isError } = useAssets({
    ...(kind !== KIND_ALL ? { kind } : {}),
    // 通用 (no track) can't be expressed server-side; fetch all and refine below.
    ...(trackFilter !== TRACK_ALL && trackFilter !== TRACK_NONE
      ? { trackId: trackFilter }
      : {}),
  });

  const list = useMemo(() => {
    const refined = filterAssets(assets ?? [], { trackFilter, search });
    // The server returns newest first; re-assert defensively so 「最新的在最上」holds.
    return [...refined].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [assets, trackFilter, search]);

  const kindMeta = kind === KIND_ALL ? null : ASSET_KIND_META[kind];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 motion-safe:animate-fade-in sm:px-6">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-base font-semibold">
              <Library className="h-4 w-4 text-muted-foreground" aria-hidden />
              资产库
            </h1>
            <p className="text-sm text-muted-foreground">
              沉淀可复用的内容、外部反馈、资源与问题，按库分类、按赛道归属。
            </p>
          </div>
          <Button size="md" className="shrink-0" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden />
            新建资产
          </Button>
        </div>

        {/* Kind tabs + 赛道 filter + search */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="资产分类">
            <KindTab
              label="全部"
              active={kind === KIND_ALL}
              onClick={() => setKind(KIND_ALL)}
            />
            {ASSET_KIND_OPTIONS.map((k) => (
              <KindTab
                key={k}
                label={ASSET_KIND_META[k].label}
                active={kind === k}
                onClick={() => setKind(k)}
              />
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select value={trackFilter} onValueChange={setTrackFilter}>
              <SelectTrigger className="w-full sm:w-44" aria-label="按赛道筛选">
                <SelectValue placeholder="全部赛道" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TRACK_ALL}>全部赛道</SelectItem>
                <SelectItem value={TRACK_NONE}>通用</SelectItem>
                {(tracks ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                className="pl-8"
                placeholder="搜索标题或正文…"
                aria-label="搜索资产"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner label="加载资产" />
          </div>
        ) : isError ? (
          <EmptyState icon={Library} title="加载资产失败" description="请检查网络后重试。" />
        ) : list.length === 0 ? (
          <EmptyState
            icon={Library}
            title={
              search.trim()
                ? '没有匹配的资产'
                : kindMeta
                  ? `${kindMeta.label}还没有资产`
                  : '还没有资产'
            }
            description={
              search.trim()
                ? '换个关键词，或调整分类与赛道筛选。'
                : '点击「新建资产」沉淀第一条，或在已完成的任务里「沉淀为资产」。'
            }
          />
        ) : (
          <ul className="space-y-3">
            {list.map((a) => (
              <AssetCard
                key={a.id}
                asset={a}
                canManage={isAdmin || isTrackManager || a.creator.id === user?.id}
                onEdit={() => setEditing(a)}
                onOpenTask={(taskId) => navigate(`/board/all?task=${taskId}`)}
              />
            ))}
          </ul>
        )}
      </div>

      <AssetFormDialog
        open={editing !== null}
        existing={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

/** Pill-style kind tab (same recipe as the drawer's status quick-move buttons). */
function KindTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button
      type="button"
      role="tab"
      aria-selected={active}
      variant={active ? 'primary' : 'outline'}
      size="sm"
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

/** Only http(s)/mailto URLs get a live link (mirrors the markdown renderer). */
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function AssetCard({
  asset,
  canManage,
  onEdit,
  onOpenTask,
}: {
  asset: Asset;
  /** Author / global admin / any 赛道经理 (client heuristic; server re-enforces). */
  canManage: boolean;
  onEdit: () => void;
  onOpenTask: (taskId: string) => void;
}): JSX.Element {
  const deleteAsset = useDeleteAsset();
  const meta = ASSET_KIND_META[asset.kind];
  const edited = asset.updatedAt !== asset.createdAt;
  const showLink = asset.url != null && SAFE_URL.test(asset.url);

  return (
    <li className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none',
              meta.className,
            )}
          >
            {meta.label}
          </span>
          <Badge variant="outline" className="max-w-[10rem]">
            <span className="truncate">{asset.trackName ?? '通用'}</span>
          </Badge>
          {asset.taskId != null && asset.taskTitle != null && (
            <button
              type="button"
              onClick={() => onOpenTask(asset.taskId!)}
              className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium leading-none text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={`来源任务：${asset.taskTitle}`}
            >
              <ListTodo className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{asset.taskTitle}</span>
            </button>
          )}
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1 sm:gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 sm:h-8 sm:w-8"
              aria-label="编辑资产"
              title="编辑"
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-destructive sm:h-8 sm:w-8"
              aria-label="删除资产"
              title="删除"
              loading={deleteAsset.isPending}
              onClick={() => {
                if (window.confirm(`确定删除资产「${asset.title}」？`)) {
                  deleteAsset.mutate(asset.id);
                }
              }}
            >
              {!deleteAsset.isPending && <Trash2 className="h-3.5 w-3.5" aria-hidden />}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-start gap-1.5">
        <h2 className="min-w-0 break-words text-base font-semibold text-foreground">
          {asset.title}
        </h2>
        {showLink && (
          <a
            href={asset.url!}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-primary"
            aria-label="打开外部链接"
            title={asset.url!}
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        )}
      </div>

      {/* Safe preview: plain text, React-escaped, clamped (same recipe as 灵感卡片). */}
      {asset.body.trim() !== '' && (
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {asset.body}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Avatar
          name={asset.creator.displayName}
          color={asset.creator.avatarColor}
          imageUrl={asset.creator.hasAvatar ? avatarUrl(asset.creator.id) : undefined}
          size="xs"
        />
        <span className="truncate">{asset.creator.displayName}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0">{relativeTime(asset.createdAt)}</span>
        {edited && <span className="shrink-0">（已编辑）</span>}
      </div>
    </li>
  );
}
