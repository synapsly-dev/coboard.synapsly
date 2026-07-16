import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Announcement } from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { useCurrentUser, useSessionToken } from '../../lib/auth';
import { ActionButton, Card, Empty, Field, PageHeader } from '../../components/ui';
import { StateView } from '../../components/StateView';
import { queryClient } from '../../lib/query';

function InfoPage(): JSX.Element {
  const token = useSessionToken(); const user = useCurrentUser(); const client = useQueryClient(); const [creating, setCreating] = useState(false); const [editing, setEditing] = useState<Announcement | null>(null); const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const isAdmin = user.data?.role === 'admin' || user.data?.role === 'super_admin';
  const query = useQuery({ queryKey: ['announcements', token], enabled: Boolean(token), queryFn: async () => (await coboardClient.announcements.list()).announcements });
  const create = useMutation({ mutationFn: () => coboardClient.announcements.create({ title: title.trim(), body: body.trim() }), onSuccess: () => { setCreating(false); setTitle(''); setBody(''); void client.invalidateQueries({ queryKey: ['announcements'] }); } });
  const update = useMutation({ mutationFn: () => coboardClient.announcements.update(editing!.id, { title: title.trim(), body: body.trim() }), onSuccess: () => { setEditing(null); setTitle(''); setBody(''); void client.invalidateQueries({ queryKey: ['announcements'] }); } });
  const remove = useMutation({ mutationFn: (id: string) => coboardClient.announcements.remove(id), onSuccess: () => void client.invalidateQueries({ queryKey: ['announcements'] }) });
  const startEdit = (item: Announcement): void => { setCreating(false); setEditing(item); setTitle(item.title); setBody(item.body); };
  const confirmRemove = async (item: Announcement): Promise<void> => { const result = await Taro.showModal({ title: `删除“${item.title}”？`, content: '删除后无法恢复。', confirmColor: '#dc2626' }); if (result.confirm) remove.mutate(item.id); };
  usePullDownRefresh(async () => { await query.refetch(); Taro.stopPullDownRefresh(); });
  return <View className="page"><PageHeader title="团队信息" description="重要公告、制度更新与团队动态。" action={isAdmin ? <ActionButton size="small" onClick={() => { if (creating || editing) { setCreating(false); setEditing(null); } else { setCreating(true); setTitle(''); setBody(''); } }}>{creating || editing ? '取消' : '发布'}</ActionButton> : undefined} />{(creating || editing) && <Card className="stack"><Text className="title">{editing ? '编辑信息' : '发布信息'}</Text><Field label="标题" value={title} onChange={setTitle} /><Field label="正文" value={body} multiline onChange={setBody} /><ActionButton loading={create.isPending || update.isPending} disabled={!title.trim() || !body.trim()} onClick={() => editing ? update.mutate() : create.mutate()}>{editing ? '保存修改' : '发布公告'}</ActionButton></Card>}<StateView loading={query.isLoading} error={query.isError} empty={false} onRetry={() => void query.refetch()}>{(query.data?.length ?? 0) === 0 ? <Empty title="暂无公告" /> : <View className="stack">{query.data?.map((item) => <Card key={item.id}><View className="stack"><Text className="title">{item.title}</Text><Text className="body">{item.body}</Text><View className="row-between"><Text className="caption">{item.author.displayName} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}</Text>{isAdmin && <View className="row"><ActionButton tone="ghost" size="small" onClick={() => startEdit(item)}>编辑</ActionButton><ActionButton tone="danger" size="small" loading={remove.isPending} onClick={() => void confirmRemove(item)}>删除</ActionButton></View>}</View></View></Card>)}</View>}</StateView></View>;
}
export default function InfoPageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><InfoPage /></QueryClientProvider>; }
