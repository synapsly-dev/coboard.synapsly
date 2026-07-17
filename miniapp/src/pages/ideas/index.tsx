import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { IdeaStatus, IdeaWithContext } from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { useCurrentUser, useSessionToken } from '../../lib/auth';
import { ActionButton, Avatar, Badge, Card, Empty, Field, InlineError, Modal, PageHeader, Segmented } from '../../components/ui';
import { Markdown } from '../../components/Markdown';
import { StateView } from '../../components/StateView';
import { chooseFiles, formatFileSize, openProtectedFile } from '../../lib/files';
import { queryClient } from '../../lib/query';
import './index.scss';

type Filter = 'all' | IdeaStatus;
const statusLabel: Record<IdeaStatus, string> = { pending: '待评审', adopted: '已采纳', rejected: '未采纳' };

function IdeasPage(): JSX.Element {
  const token = useSessionToken();
  const me = useCurrentUser();
  const client = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<IdeaWithContext | null>(null);
  const isAdmin = me.data?.role === 'admin' || me.data?.role === 'super_admin';
  const query = useQuery({
    queryKey: ['ideas', filter, token],
    enabled: Boolean(token),
    queryFn: async () => (await coboardClient.ideas.all(filter === 'all' ? {} : { status: filter })).ideas,
  });
  const refresh = async (): Promise<void> => { await client.invalidateQueries({ queryKey: ['ideas'] }); };
  useDidShow(() => { void query.refetch(); });
  usePullDownRefresh(async () => { await query.refetch(); Taro.stopPullDownRefresh(); });

  return <View className="page ideas-page">
    <PageHeader title="灵感区" description="汇集你可见项目下的想法与独立灵感；被采纳后会为作者计入奖励点数。" action={<ActionButton size="small" onClick={() => setCreating(true)}>发布灵感</ActionButton>} />
    <Segmented value={filter} onChange={setFilter} items={[{ value: 'all', label: '全部' }, { value: 'pending', label: '待评审' }, { value: 'adopted', label: '已采纳' }, { value: 'rejected', label: '未采纳' }]} />
    <StateView loading={query.isLoading} error={query.isError} empty={false} onRetry={() => void query.refetch()}>
      {(query.data?.length ?? 0) === 0 ? <Empty title="还没有想法" description="发布第一条独立灵感，或在任务详情中记录想法。" /> : <View className="idea-grid">{query.data?.map((idea) => <IdeaCard key={idea.id} idea={idea} onOpen={() => setSelected(idea)} />)}</View>}
    </StateView>
    <CreateIdeaModal open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void refresh(); }} />
    <IdeaDetailModal idea={selected} isAdmin={isAdmin} currentUserId={me.data?.id} onClose={() => setSelected(null)} onChanged={() => { setSelected(null); void refresh(); }} />
  </View>;
}

function IdeaCard({ idea, onOpen }: { idea: IdeaWithContext; onOpen: () => void }): JSX.Element {
  return <Card className="idea-card" onClick={onOpen}>
    <View className="idea-card__head"><View className="idea-card__badges"><Badge tone={idea.taskId ? 'neutral' : 'primary'}>{idea.projectName ?? '独立想法'}</Badge><Badge tone={idea.status === 'adopted' ? 'success' : idea.status === 'rejected' ? 'danger' : 'warning'}>{statusLabel[idea.status]}</Badge>{idea.rewardPoints != null && <Badge tone="primary">奖励 {idea.rewardPoints} 点</Badge>}</View></View>
    {idea.taskTitle && <Text className="idea-card__task">{idea.taskTitle}</Text>}
    <Text className="idea-card__body">{idea.body}</Text>
    {idea.files.length > 0 && <Text className="idea-card__attachments">附件 {idea.files.length}</Text>}
    <View className="idea-card__foot"><View className="row"><Avatar name={idea.author.displayName} color={idea.author.avatarColor} userId={idea.author.id} hasAvatar={idea.author.hasAvatar} size="small" /><View><Text className="body">{idea.author.displayName}</Text><Text className="caption">{relativeDate(idea.createdAt)}</Text></View></View><Text className="idea-card__arrow">›</Text></View>
  </Card>;
}

function CreateIdeaModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }): JSX.Element | null {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<Array<{ path: string; name: string }>>([]);
  const create = useMutation({
    mutationFn: async () => {
      const idea = await coboardClient.ideas.createStandalone({ body: body.trim() });
      await Promise.all(files.map((file) => coboardClient.files.attachment.upload('ideas', idea.id, file)));
      return idea;
    },
    onSuccess: () => { setBody(''); setFiles([]); void Taro.showToast({ title: '灵感已发布', icon: 'success' }); onCreated(); },
  });
  return <Modal open={open} title="发布灵感" description="独立灵感对所有成员可见，正文支持 Markdown。" onClose={onClose} footer={<><ActionButton tone="secondary" onClick={onClose}>取消</ActionButton><ActionButton loading={create.isPending} disabled={!body.trim()} onClick={() => create.mutate()}>发布</ActionButton></>}>
    <View className="stack"><Field label="灵感内容" required value={body} multiline placeholder="分享一个想法、方案或观察…" onChange={setBody} />
      {files.length > 0 && <View className="idea-files">{files.map((file, index) => <View className="idea-file" key={`${file.path}-${index}`}><Text className="truncate">{file.name}</Text><Text onClick={() => setFiles((items) => items.filter((_, itemIndex) => itemIndex !== index))}>×</Text></View>)}</View>}
      <ActionButton tone="secondary" size="small" onClick={() => void chooseFiles(5).then((selected) => setFiles((current) => [...current, ...selected].slice(0, 5)))}>添加附件</ActionButton>
      <InlineError message={create.error instanceof Error ? create.error.message : null} />
    </View>
  </Modal>;
}

function IdeaDetailModal({ idea, isAdmin, currentUserId, onClose, onChanged }: { idea: IdeaWithContext | null; isAdmin: boolean; currentUserId?: string; onClose: () => void; onChanged: () => void }): JSX.Element | null {
  const [reward, setReward] = useState('1');
  const [reason, setReason] = useState('');
  const canDelete = Boolean(idea && (isAdmin || idea.author.id === currentUserId));
  const canFiles = canDelete;
  const adopt = useMutation({ mutationFn: () => coboardClient.ideas.adopt(idea!.id, { rewardPoints: Math.max(0, Number.parseInt(reward, 10) || 0) }), onSuccess: onChanged });
  const reject = useMutation({ mutationFn: () => coboardClient.ideas.reject(idea!.id, { reason: reason.trim() || undefined }), onSuccess: onChanged });
  const remove = useMutation({ mutationFn: () => coboardClient.ideas.remove(idea!.id), onSuccess: onChanged });
  const upload = useMutation({ mutationFn: async () => { const files = await chooseFiles(5); return Promise.all(files.map((file) => coboardClient.files.attachment.upload('ideas', idea!.id, file))); }, onSuccess: onChanged });
  const removeFile = useMutation({ mutationFn: (fileId: string) => coboardClient.files.attachment.remove('ideas', idea!.id, fileId), onSuccess: onChanged });
  async function confirmDelete(): Promise<void> { const result = await Taro.showModal({ title: '删除灵感', content: '删除后无法恢复，确定继续吗？', confirmColor: '#b42318' }); if (result.confirm) remove.mutate(); }
  return <Modal open={Boolean(idea)} title={idea?.taskTitle ? `想法 · ${idea.taskTitle}` : '灵感详情'} description={idea ? `${idea.author.displayName} · ${relativeDate(idea.createdAt)}` : undefined} onClose={onClose}>
    {idea && <View className="stack"><View className="row"><Badge tone={idea.taskId ? 'neutral' : 'primary'}>{idea.projectName ?? '独立想法'}</Badge><Badge tone={idea.status === 'adopted' ? 'success' : idea.status === 'rejected' ? 'danger' : 'warning'}>{statusLabel[idea.status]}</Badge>{idea.rewardPoints != null && <Badge tone="primary">奖励 {idea.rewardPoints} 点</Badge>}</View>
      <Markdown source={idea.body} />
      {idea.rejectReason && <View className="surface-muted"><Text className="caption">未采纳原因</Text><Text className="body">{idea.rejectReason}</Text></View>}
      <View className="idea-detail__section"><View className="row-between"><Text className="title">附件</Text>{canFiles && <ActionButton tone="secondary" size="small" loading={upload.isPending} onClick={() => upload.mutate()}>添加附件</ActionButton>}</View>{idea.files.length === 0 ? <Text className="caption">暂无附件</Text> : <View className="idea-files">{idea.files.map((file) => <View className="idea-file" key={file.id}><View className="account-copy" onClick={() => void openProtectedFile(coboardClient.files.attachment.url('ideas', idea.id, file.id, true), file.filename, file.mime)}><Text className="body truncate">{file.filename}</Text><Text className="caption">{formatFileSize(file.sizeBytes)} · 点击预览</Text></View>{canFiles && <ActionButton tone="ghost" size="small" loading={removeFile.isPending} onClick={() => removeFile.mutate(file.id)}>删除</ActionButton>}</View>)}</View>}</View>
      {idea.taskId && <ActionButton tone="secondary" onClick={() => void Taro.navigateTo({ url: `/pages/task/index?id=${idea.taskId}&action=ideas` })}>查看来源任务</ActionButton>}
      {isAdmin && idea.status === 'pending' && <View className="idea-review"><Text className="title">评审灵感</Text><Field label="采纳奖励点数" value={reward} onChange={setReward} /><Field label="不采纳原因" value={reason} multiline onChange={setReason} /><View className="row"><ActionButton loading={adopt.isPending} onClick={() => adopt.mutate()}>采纳</ActionButton><ActionButton tone="danger" loading={reject.isPending} onClick={() => reject.mutate()}>不采纳</ActionButton></View></View>}
      {canDelete && <View className="idea-danger"><ActionButton tone="ghost" loading={remove.isPending} onClick={() => void confirmDelete()}>删除灵感</ActionButton></View>}
      <InlineError message={firstError(adopt.error, reject.error, remove.error, upload.error, removeFile.error)} />
    </View>}
  </Modal>;
}

function firstError(...errors: unknown[]): string | null { const error = errors.find((item) => item instanceof Error); return error instanceof Error ? error.message : null; }
function relativeDate(iso: string): string { const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); if (days < 1) return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); if (days < 7) return `${days} 天前`; return new Date(iso).toLocaleDateString('zh-CN'); }

export default function IdeasPageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><IdeasPage /></QueryClientProvider>; }
