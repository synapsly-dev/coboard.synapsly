import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Input, Picker, Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Asset, AssetKind } from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { useCurrentUser, useSessionToken } from '../../lib/auth';
import {
  ActionButton,
  Avatar,
  Badge,
  Card,
  Empty,
  Field,
  PageHeader,
  Segmented,
  SelectField,
} from '../../components/ui';
import { StateView } from '../../components/StateView';
import { queryClient } from '../../lib/query';
import './index.scss';

type Filter = 'all' | AssetKind;
const labels: Record<AssetKind, string> = {
  content: '内容',
  feedback: '反馈',
  resource: '资源',
  issue: '问题',
};
function AssetsPage(): JSX.Element {
  const token = useSessionToken();
  const me = useCurrentUser();
  const client = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<AssetKind>('content');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [trackId, setTrackId] = useState('none');
  const [trackFilter, setTrackFilter] = useState('all');
  const [viewing, setViewing] = useState<Asset | null>(null);
  const tracks = useQuery({ queryKey: ['tracks', token], enabled: Boolean(token), queryFn: async () => (await coboardClient.tracks.list()).tracks });
  const query = useQuery({
    queryKey: ['assets', filter, token],
    enabled: Boolean(token),
    queryFn: async () =>
      (await coboardClient.assets.list(filter === 'all' ? {} : { kind: filter })).assets,
  });
  const create = useMutation({
    mutationFn: () =>
      coboardClient.assets.create({
        kind,
        title: title.trim(),
        body: body.trim() || undefined,
        url: url.trim() || undefined,
        trackId: trackId === 'none' ? null : trackId,
      }),
    onSuccess: () => {
      setCreating(false);
      setTitle('');
      setBody('');
      setUrl('');
      void client.invalidateQueries({ queryKey: ['assets'] });
    },
  });
  const update = useMutation({
    mutationFn: () =>
      coboardClient.assets.update(editing!.id, {
        kind,
        title: title.trim(),
        body: body.trim(),
        url: url.trim() || null,
        trackId: trackId === 'none' ? null : trackId,
      }),
    onSuccess: () => {
      setEditing(null);
      setTitle('');
      setBody('');
      setUrl('');
      void client.invalidateQueries({ queryKey: ['assets'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => coboardClient.assets.remove(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['assets'] }),
  });
  const startEdit = (asset: Asset): void => {
    setCreating(false);
    setEditing(asset);
    setKind(asset.kind);
    setTitle(asset.title);
    setBody(asset.body);
    setUrl(asset.url ?? '');
    setTrackId(asset.trackId ?? 'none');
  };
  const confirmRemove = async (asset: Asset): Promise<void> => {
    const result = await Taro.showModal({
      title: `删除“${asset.title}”？`,
      content: '删除后无法恢复。',
      confirmColor: '#dc2626',
    });
    if (result.confirm) remove.mutate(asset.id);
  };
  usePullDownRefresh(async () => {
    await query.refetch();
    Taro.stopPullDownRefresh();
  });
  const kinds: AssetKind[] = ['content', 'feedback', 'resource', 'issue'];
  const term = search.trim().toLowerCase();
  const visible = (query.data ?? []).filter(
    (asset) =>
      (trackFilter === 'all' || (trackFilter === 'none' ? asset.trackId === null : asset.trackId === trackFilter)) &&
      (!term || asset.title.toLowerCase().includes(term) || asset.body.toLowerCase().includes(term)),
  );
  const isAdmin = me.data?.role === 'admin' || me.data?.role === 'super_admin';
  const isTrackManager = (tracks.data ?? []).some((track) => track.managers.some((person) => person.userId === me.data?.id));
  const trackOptions = [{ id: 'none', name: '通用（不归属赛道）' }, ...(tracks.data ?? [])];
  const trackIndex = Math.max(0, trackOptions.findIndex((item) => item.id === trackId));
  const trackFilterOptions = [{ id: 'all', name: '全部赛道' }, { id: 'none', name: '通用' }, ...(tracks.data ?? [])];
  const trackFilterIndex = Math.max(0, trackFilterOptions.findIndex((item) => item.id === trackFilter));
  return (
    <View className="page">
      <PageHeader
        title="资产库"
        description="沉淀团队可复用的内容、反馈、资源和问题。"
        action={
          <ActionButton
            size="small"
            onClick={() => {
              if (creating || editing) {
                setCreating(false);
                setEditing(null);
              } else {
                setCreating(true);
                setTitle('');
                setBody('');
                setUrl('');
                setTrackId('none');
              }
            }}
          >
            {creating || editing ? '取消' : '新建'}
          </ActionButton>
        }
      />
      {(creating || editing) && <View className="asset-modal" onClick={() => { setCreating(false); setEditing(null); }}><View className="asset-dialog" onClick={(event) => event.stopPropagation()}>
        <Card className="stack">
          <Text className="title">{editing ? '编辑资产' : '新建资产'}</Text>
          <SelectField
            label="类型"
            range={kinds.map((item) => labels[item])}
            value={kinds.indexOf(kind)}
            valueLabel={labels[kind]}
            onChange={(index) => setKind(kinds[index] ?? 'content')}
          />
          <Field label="标题" value={title} onChange={setTitle} />
          <Field label="正文" value={body} multiline onChange={setBody} />
          <Field label="链接（可选）" value={url} onChange={setUrl} />
          <View className="field"><Text className="field__label">所属赛道</Text><Picker mode="selector" range={trackOptions.map((item) => item.name)} value={trackIndex} onChange={(event) => setTrackId(trackOptions[Number(event.detail.value)]?.id ?? 'none')}><View className="field__control field__select"><Text>{trackOptions[trackIndex]?.name}</Text><Text>⌄</Text></View></Picker></View>
          <ActionButton
            loading={create.isPending || update.isPending}
            disabled={!title.trim() || (!body.trim() && !url.trim())}
            onClick={() => (editing ? update.mutate() : create.mutate())}
          >
            {editing ? '保存修改' : '保存资产'}
          </ActionButton>
        </Card>
      </View></View>}
      <View className="asset-tools"><Picker mode="selector" range={trackFilterOptions.map((item) => item.name)} value={trackFilterIndex} onChange={(event) => setTrackFilter(trackFilterOptions[Number(event.detail.value)]?.id ?? 'all')}><View className="asset-track-filter"><Text>{trackFilterOptions[trackFilterIndex]?.name}</Text><Text>⌄</Text></View></Picker><View className="field__control asset-search">
        <Input
          value={search}
          placeholder="搜索标题或正文…"
          onInput={(event) => setSearch(event.detail.value)}
        />
      </View></View>
      <Segmented
        value={filter}
        onChange={setFilter}
        items={[
          { value: 'all', label: '全部' },
          ...kinds.map((item) => ({ value: item, label: labels[item] })),
        ]}
      />
      <StateView
        loading={query.isLoading}
        error={query.isError}
        empty={false}
        onRetry={() => void query.refetch()}
      >
        {visible.length === 0 ? (
          <Empty title={term ? '没有匹配的资产' : '暂无资产'} />
        ) : (
          <View className="stack">
            {visible.map((asset) => (
              <Card key={asset.id} className="asset-card" onClick={() => setViewing(asset)}>
                <View className="stack">
                  <View className="row-between">
                    <Badge>{labels[asset.kind]}</Badge>
                    <Text className="caption">{asset.trackName ?? '通用'}</Text>
                  </View>
                  <Text className="title">{asset.title}</Text>
                  {asset.body && <Text className="body muted">{asset.body}</Text>}
                  {asset.url && (
                    <Text
                      className="caption"
                      onClick={() => void Taro.setClipboardData({ data: asset.url! })}
                    >
                      {asset.url} · 复制链接
                    </Text>
                  )}
                  {asset.taskId && <Text className="asset-source" onClick={(event) => { event.stopPropagation(); void Taro.navigateTo({ url: `/pages/task/index?id=${asset.taskId}` }); }}>来源任务：{asset.taskTitle ?? '查看任务'}</Text>}
                  <View className="row-between">
                    <Text className="caption">创建人 {asset.creator.displayName}</Text>
                    {(isAdmin || isTrackManager || asset.creator.id === me.data?.id) && (
                      <View className="row" onClick={(event) => event.stopPropagation()}>
                        <ActionButton tone="ghost" size="small" onClick={() => startEdit(asset)}>
                          编辑
                        </ActionButton>
                        <ActionButton
                          tone="danger"
                          size="small"
                          loading={remove.isPending}
                          onClick={() => void confirmRemove(asset)}
                        >
                          删除
                        </ActionButton>
                      </View>
                    )}
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
      </StateView>
      {viewing && <View className="asset-modal" onClick={() => setViewing(null)}><View className="asset-dialog" onClick={(event) => event.stopPropagation()}><Card className="asset-detail"><View className="row-between"><View className="row"><Badge>{labels[viewing.kind]}</Badge><Badge>{viewing.trackName ?? '通用'}</Badge></View><Text className="asset-close" onClick={() => setViewing(null)}>×</Text></View><Text className="asset-detail__title">{viewing.title}</Text>{viewing.body && <Text className="asset-detail__body">{viewing.body}</Text>}{viewing.url && <ActionButton tone="secondary" size="small" onClick={() => void Taro.setClipboardData({ data: viewing.url! })}>复制外部链接</ActionButton>}{viewing.taskId && <ActionButton tone="ghost" size="small" onClick={() => void Taro.navigateTo({ url: `/pages/task/index?id=${viewing.taskId}` })}>查看来源任务</ActionButton>}<View className="row"><Avatar name={viewing.creator.displayName} color={viewing.creator.avatarColor} /><Text className="caption">{viewing.creator.displayName} · {new Date(viewing.createdAt).toLocaleString('zh-CN')}</Text></View></Card></View></View>}
    </View>
  );
}
export default function AssetsPageRoot(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <AssetsPage />
    </QueryClientProvider>
  );
}
