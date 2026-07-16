import Taro from '@tarojs/taro';
import { Switch, Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { coboardClient } from '../../platform/coboard-client';
import { useCurrentUser } from '../../lib/auth';
import { ActionButton, Avatar, Badge, Card, Empty, Field, PageHeader, Segmented } from '../../components/ui';
import { queryClient } from '../../lib/query';

type Tab = 'users' | 'tracks' | 'projects' | 'settings';
function AdminPage(): JSX.Element {
  const me = useCurrentUser(); const [tab, setTab] = useState<Tab>('users'); const isAdmin = me.data?.role === 'admin' || me.data?.role === 'super_admin';
  if (!isAdmin) return <View className="page"><Empty title="无权访问" description="后台管理仅对管理员开放。" /></View>;
  return <View className="page"><PageHeader title="后台管理" description="管理团队账号、赛道、项目与注册设置。" /><Segmented value={tab} onChange={setTab} items={[{ value: 'users', label: '用户' }, { value: 'tracks', label: '赛道' }, { value: 'projects', label: '项目' }, { value: 'settings', label: '设置' }]} />{tab === 'users' && <UsersPanel />}{tab === 'tracks' && <TracksPanel />}{tab === 'projects' && <ProjectsPanel />}{tab === 'settings' && <SettingsPanel />}</View>;
}
export default function AdminPageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><AdminPage /></QueryClientProvider>; }

function UsersPanel(): JSX.Element {
  const client = useQueryClient(); const [creating, setCreating] = useState(false); const [email, setEmail] = useState(''); const [name, setName] = useState('');
  const query = useQuery({ queryKey: ['users'], queryFn: async () => (await coboardClient.users.list()).users });
  const create = useMutation({ mutationFn: () => coboardClient.users.create({ email: email.trim(), displayName: name.trim(), role: 'member' }), onSuccess: () => { setCreating(false); setEmail(''); setName(''); void client.invalidateQueries({ queryKey: ['users'] }); } });
  const toggle = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => coboardClient.users.update(id, { isActive: active }), onSuccess: () => void client.invalidateQueries({ queryKey: ['users'] }) });
  return <View className="stack"><View className="row-between"><Text className="title">用户账号</Text><ActionButton size="small" onClick={() => setCreating(!creating)}>{creating ? '取消' : '新建用户'}</ActionButton></View>{creating && <Card className="stack"><Field label="邮箱" value={email} onChange={setEmail} /><Field label="显示名称" value={name} onChange={setName} /><ActionButton loading={create.isPending} disabled={!email.trim() || !name.trim()} onClick={() => create.mutate()}>创建账号</ActionButton></Card>}{query.isLoading ? <Empty title="加载用户…" /> : (query.data?.length ?? 0) === 0 ? <Empty title="暂无用户" /> : query.data?.map((user) => <Card key={user.id} className="row"><Avatar name={user.displayName} color={user.avatarColor} /><View className="account-copy"><View className="row"><Text className="title">{user.displayName}</Text><Badge>{user.role}</Badge></View><Text className="caption">{user.email} · {user.projects.length} 个项目</Text></View><Switch checked={user.isActive} onChange={(event) => toggle.mutate({ id: user.id, active: event.detail.value })} /></Card>)}</View>;
}

function TracksPanel(): JSX.Element {
  const client = useQueryClient(); const [creating, setCreating] = useState(false); const [name, setName] = useState(''); const [key, setKey] = useState(''); const [goal, setGoal] = useState('');
  const query = useQuery({ queryKey: ['tracks'], queryFn: async () => (await coboardClient.tracks.list()).tracks });
  const create = useMutation({ mutationFn: () => coboardClient.tracks.create({ name: name.trim(), key: key.trim().toLowerCase(), weeklyGoal: goal.trim() || undefined }), onSuccess: () => { setCreating(false); setName(''); setKey(''); setGoal(''); void client.invalidateQueries({ queryKey: ['tracks'] }); } });
  return <View className="stack"><View className="row-between"><Text className="title">赛道</Text><ActionButton size="small" onClick={() => setCreating(!creating)}>{creating ? '取消' : '新建赛道'}</ActionButton></View>{creating && <Card className="stack"><Field label="名称" value={name} onChange={setName} /><Field label="标识" value={key} placeholder="content-growth" onChange={setKey} /><Field label="本周目标" value={goal} multiline onChange={setGoal} /><ActionButton loading={create.isPending} disabled={!name.trim() || !key.trim()} onClick={() => create.mutate()}>创建赛道</ActionButton></Card>}{query.data?.map((track) => <Card key={track.id}><View className="stack"><View className="row-between"><View className="row"><Text className="title">{track.name}</Text><Badge>{track.key}</Badge></View><Text className="caption">{track.projectCount} 个项目</Text></View><Text className="body muted">{track.weeklyGoal || track.description || '暂无目标'}</Text><Text className="caption">{track.managers.length} 名经理 · {track.members.length} 名成员</Text></View></Card>)}</View>;
}

function ProjectsPanel(): JSX.Element {
  const client = useQueryClient(); const [creating, setCreating] = useState(false); const [name, setName] = useState(''); const [key, setKey] = useState(''); const [description, setDescription] = useState('');
  const query = useQuery({ queryKey: ['projects', 'admin'], queryFn: async () => (await coboardClient.projects.list()).projects });
  const create = useMutation({ mutationFn: () => coboardClient.projects.create({ name: name.trim(), key: key.trim().toUpperCase(), description: description.trim() || undefined }), onSuccess: () => { setCreating(false); setName(''); setKey(''); setDescription(''); void client.invalidateQueries({ queryKey: ['projects'] }); } });
  return <View className="stack"><View className="row-between"><Text className="title">项目</Text><ActionButton size="small" onClick={() => setCreating(!creating)}>{creating ? '取消' : '新建项目'}</ActionButton></View>{creating && <Card className="stack"><Field label="名称" value={name} onChange={setName} /><Field label="标识" value={key} placeholder="BOARD" onChange={setKey} /><Field label="描述" value={description} multiline onChange={setDescription} /><ActionButton loading={create.isPending} disabled={!name.trim() || !key.trim()} onClick={() => create.mutate()}>创建项目</ActionButton></Card>}{query.data?.map((project) => <Card key={project.id}><View className="row-between"><View><View className="row"><Text className="title">{project.name}</Text><Badge>{project.key}</Badge></View><Text className="caption">{project.description || '暂无描述'}</Text></View>{project.archived && <Badge tone="danger">已归档</Badge>}</View></Card>)}</View>;
}

function SettingsPanel(): JSX.Element {
  const client = useQueryClient(); const query = useQuery({ queryKey: ['settings'], queryFn: () => coboardClient.settings.get() }); const emailQuery = useQuery({ queryKey: ['settings', 'email-notifications'], queryFn: () => coboardClient.settings.emailNotifications() }); const [code, setCode] = useState(''); const [dueDays, setDueDays] = useState('');
  const update = useMutation({ mutationFn: (input: { registrationEnabled?: boolean; registrationCode?: string }) => coboardClient.settings.update(input), onSuccess: (data) => { client.setQueryData(['settings'], data); void Taro.showToast({ title: '已保存', icon: 'success' }); } });
  const currentCode = code || query.data?.registrationCode || '';
  const updateEmail = useMutation({ mutationFn: (input: Parameters<typeof coboardClient.settings.updateEmailNotifications>[0]) => coboardClient.settings.updateEmailNotifications(input), onSuccess: (data) => client.setQueryData(['settings', 'email-notifications'], data) }); const email = emailQuery.data;
  return <View className="stack"><Card className="stack"><View className="row-between"><View className="account-copy"><Text className="title">开放新成员加入</Text><Text className="caption">允许新 Syna ID 用户通过邀请码加入</Text></View><Switch checked={query.data?.registrationEnabled ?? false} onChange={(event) => update.mutate({ registrationEnabled: event.detail.value })} /></View><Field label="邀请码" value={currentCode} onChange={setCode} /><ActionButton loading={update.isPending} disabled={!currentCode} onClick={() => update.mutate({ registrationCode: currentCode })}>保存邀请码</ActionButton></Card><Card className="stack"><View className="row-between"><View className="account-copy"><Text className="title">邮件提醒</Text><Text className="caption">关键任务事件通过邮件触达相关成员</Text></View><Switch checked={email?.enabled ?? false} onChange={(event) => updateEmail.mutate({ enabled: event.detail.value })} /></View>{email && <>{Object.entries(email.events).map(([key, enabled]) => <View key={key} className="row-between"><Text className="body">{emailEventLabel(key)}</Text><Switch checked={enabled} onChange={(event) => updateEmail.mutate({ events: { [key]: event.detail.value } })} /></View>)}<Field label="临期提醒天数" value={dueDays || String(email.dueSoonDays)} onChange={setDueDays} /><ActionButton tone="secondary" size="small" disabled={!dueDays} onClick={() => updateEmail.mutate({ dueSoonDays: Math.max(0, Math.min(30, Number.parseInt(dueDays, 10) || 0)) })}>保存提醒时间</ActionButton></>}</Card></View>;
}

function emailEventLabel(key: string): string { return ({ taskAssigned: '任务被派发', taskDueSoon: '任务即将到期', taskSubmitted: '任务提交交付', taskRejected: '任务被驳回', adminReviewNeeded: '需要管理员复核' } as Record<string, string>)[key] ?? key; }
