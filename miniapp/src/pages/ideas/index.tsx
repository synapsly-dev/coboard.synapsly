import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Input, Text, Textarea, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { IdeaStatus, IdeaWithContext } from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { useCurrentUser, useSessionToken } from '../../lib/auth';
import { ActionButton, Avatar, Badge, Card, Empty, PageHeader, Segmented } from '../../components/ui';
import { StateView } from '../../components/StateView';
import { queryClient } from '../../lib/query';
import './index.scss';

type Filter = 'all' | IdeaStatus;
const statusLabel: Record<IdeaStatus, string> = { pending: '待评审', adopted: '已采纳', rejected: '未采纳' };

function IdeasPage(): JSX.Element {
  const token = useSessionToken(); const me = useCurrentUser(); const client = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all'); const [creating, setCreating] = useState(false); const [body, setBody] = useState(''); const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  const [reviewing, setReviewing] = useState<IdeaWithContext | null>(null); const [reward, setReward] = useState('1'); const [reason, setReason] = useState('');
  const isAdmin = me.data?.role === 'admin' || me.data?.role === 'super_admin';
  const query = useQuery({ queryKey: ['ideas', filter, token], enabled: Boolean(token), queryFn: async () => (await coboardClient.ideas.all(filter === 'all' ? {} : { status: filter })).ideas });
  const refresh = (): void => { void client.invalidateQueries({ queryKey: ['ideas'] }); };
  const create = useMutation({ mutationFn: async () => { const idea = await coboardClient.ideas.createStandalone({ body: body.trim() }); if (file) await coboardClient.files.attachment.upload('ideas', idea.id, file); return idea; }, onSuccess: () => { setBody(''); setFile(null); setCreating(false); refresh(); void Taro.showToast({ title: '灵感已发布', icon: 'success' }); } });
  const adopt = useMutation({ mutationFn: (idea: IdeaWithContext) => coboardClient.ideas.adopt(idea.id, { rewardPoints: Math.max(0, Number.parseInt(reward, 10) || 0) }), onSuccess: () => { setReviewing(null); refresh(); } });
  const reject = useMutation({ mutationFn: (idea: IdeaWithContext) => coboardClient.ideas.reject(idea.id, { reason: reason.trim() || undefined }), onSuccess: () => { setReviewing(null); refresh(); } });
  const remove = useMutation({ mutationFn: (id: string) => coboardClient.ideas.remove(id), onSuccess: refresh });
  async function chooseFile(): Promise<void> { const result = await Taro.chooseMessageFile({ count: 1, type: 'file' }); const chosen = result.tempFiles[0]; if (chosen) setFile({ path: chosen.path, name: chosen.name }); }
  async function confirmRemove(idea: IdeaWithContext): Promise<void> { const result = await Taro.showModal({ title: '删除灵感', content: '删除后无法恢复，确定继续吗？', confirmColor: '#dc2626' }); if (result.confirm) remove.mutate(idea.id); }
  usePullDownRefresh(async () => { await query.refetch(); Taro.stopPullDownRefresh(); });

  return <View className="page ideas-page"><PageHeader title="灵感区" description="汇集你可见项目下的想法与独立灵感；被采纳后会为作者计入奖励点数。" action={<ActionButton size="small" onClick={() => setCreating(true)}>＋ 发布灵感</ActionButton>} />
    <Segmented value={filter} onChange={setFilter} items={[{ value: 'all', label: '全部' }, { value: 'pending', label: '待评审' }, { value: 'adopted', label: '已采纳' }, { value: 'rejected', label: '未采纳' }]} />
    <StateView loading={query.isLoading} error={query.isError} empty={false} onRetry={() => void query.refetch()}>{(query.data?.length ?? 0) === 0 ? <Empty title="还没有想法" description="发布第一条独立灵感，或在任务详情中记录想法。" /> : <View className="idea-grid">{query.data?.map((idea) => <Card key={idea.id} className="idea-card" onClick={() => idea.taskId ? void Taro.navigateTo({ url: `/pages/task/index?id=${idea.taskId}&action=ideas` }) : undefined}><View className="idea-card__head"><View className="idea-card__badges"><Badge tone={idea.taskId ? 'neutral' : 'primary'}>{idea.projectName ?? '独立想法'}</Badge><Badge tone={idea.status === 'adopted' ? 'success' : idea.status === 'rejected' ? 'danger' : 'warning'}>{statusLabel[idea.status]}</Badge>{idea.rewardPoints != null && <Badge tone="primary">奖励 {idea.rewardPoints} 点</Badge>}</View>{(isAdmin || idea.author.id === me.data?.id) && <Text className="idea-card__delete" onClick={(event) => { event.stopPropagation(); void confirmRemove(idea); }}>删除</Text>}</View>{idea.taskTitle && <Text className="idea-card__task">{idea.taskTitle}</Text>}<Text className="idea-card__body">{idea.body}</Text>{idea.files.length > 0 && <View className="idea-card__files">{idea.files.map((item) => <Text key={item.id} onClick={(event) => { event.stopPropagation(); void Taro.setClipboardData({ data: coboardClient.files.attachment.url('ideas', idea.id, item.id) }); }}>📎 {item.filename}</Text>)}</View>}<View className="idea-card__foot"><View className="row"><Avatar name={idea.author.displayName} color={idea.author.avatarColor} /><View><Text className="body">{idea.author.displayName}</Text><Text className="caption">{new Date(idea.createdAt).toLocaleString('zh-CN')}</Text></View></View>{isAdmin && idea.status === 'pending' && <ActionButton tone="secondary" size="small" onClick={() => setReviewing(idea)}>评审</ActionButton>}</View></Card>)}</View>}</StateView>
    {creating && <View className="idea-modal" onClick={() => setCreating(false)}><View className="idea-dialog" onClick={(event) => event.stopPropagation()}><Card className="stack"><View className="row-between"><View><Text className="title">发布灵感</Text><Text className="caption">独立灵感对所有成员可见。</Text></View><Text className="idea-close" onClick={() => setCreating(false)}>×</Text></View><Textarea className="idea-textarea" value={body} maxlength={20000} placeholder="分享一个想法或灵感…" onInput={(event) => setBody(event.detail.value)} /><View className="row-between"><ActionButton tone="secondary" size="small" onClick={() => void chooseFile()}>{file ? '更换附件' : '添加附件'}</ActionButton>{file && <Text className="caption">{file.name}</Text>}</View><View className="idea-dialog__actions"><ActionButton tone="secondary" onClick={() => setCreating(false)}>取消</ActionButton><ActionButton disabled={!body.trim()} loading={create.isPending} onClick={() => create.mutate()}>发布</ActionButton></View></Card></View></View>}
    {reviewing && <View className="idea-modal" onClick={() => setReviewing(null)}><View className="idea-dialog" onClick={(event) => event.stopPropagation()}><Card className="stack"><Text className="title">评审灵感</Text><Text className="body muted">{reviewing.body}</Text><View className="field"><Text className="field__label">奖励点数</Text><Input className="field__control" type="number" value={reward} onInput={(event) => setReward(event.detail.value)} /></View><View className="field"><Text className="field__label">驳回理由（可选）</Text><Textarea className="idea-textarea idea-textarea--short" value={reason} onInput={(event) => setReason(event.detail.value)} /></View><View className="idea-dialog__actions"><ActionButton tone="danger" loading={reject.isPending} onClick={() => reject.mutate(reviewing)}>驳回</ActionButton><ActionButton loading={adopt.isPending} onClick={() => adopt.mutate(reviewing)}>采纳</ActionButton></View></Card></View></View>}
  </View>;
}
export default function IdeasPageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><IdeasPage /></QueryClientProvider>; }
