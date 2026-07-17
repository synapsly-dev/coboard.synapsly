import Taro from '@tarojs/taro';
import { Picker, Switch, Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { isAdminRole, isSuperAdminRole, type Project, type ProjectRole, type Track, type User, type UserProjectMembership, type UserRole, type UserWithProjects } from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { useCurrentUser } from '../../lib/auth';
import {
  ActionButton,
  AppIcon,
  Avatar,
  Badge,
  Card,
  Empty,
  Field,
  InlineError,
  Modal,
  PageHeader,
  Segmented,
} from '../../components/ui';
import { queryClient } from '../../lib/query';
import './index.scss';

type Tab = 'users' | 'tracks' | 'projects' | 'settings';
type TrackAssignment = 'none' | 'manager' | 'member';

const USER_ROLE_LABELS: Record<UserRole, string> = { super_admin: '超级管理员', admin: '管理员', member: '成员' };
const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = { lead: '负责人', member: '成员' };
const AVATAR_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#14b8a6', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#64748b'] as const;

function errorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  return error instanceof Error ? error.message : fallback;
}

function AdminPage(): JSX.Element {
  const me = useCurrentUser();
  const [tab, setTab] = useState<Tab>('users');
  if (me.isLoading) return <View className="page"><Empty title="正在验证管理权限…" /></View>;
  if (!me.data || !isAdminRole(me.data.role)) return <View className="page"><Empty title="无权访问" description="后台管理仅对管理员开放。" /></View>;
  return <View className="page admin-page">
    <PageHeader title="后台管理" description="管理团队的用户账号、赛道、项目与系统设置。" />
    <Card className="admin-guide">
      <Text className="title">团队协作三步走</Text>
      <View className="admin-guide__steps">
        <GuideStep number={1} title="建账号" description="为每位成员预建 Syna ID 对应账号" />
        <GuideStep number={2} title="建项目" description="项目就是实际协作团队或小组" />
        <GuideStep number={3} title="加成员" description="设置项目负责人和普通成员" />
      </View>
      <Text className="admin-guide__tip">Coboard 没有单独的“用户组”——项目即分组。成员加入项目后才会看到对应看板。</Text>
    </Card>
    <Segmented value={tab} onChange={setTab} items={[{ value: 'users', label: '用户' }, { value: 'tracks', label: '赛道' }, { value: 'projects', label: '项目' }, { value: 'settings', label: '设置' }]} />
    {tab === 'users' && <UsersPanel currentUser={me.data} />}
    {tab === 'tracks' && <TracksPanel />}
    {tab === 'projects' && <ProjectsPanel />}
    {tab === 'settings' && <SettingsPanel />}
  </View>;
}

function GuideStep({ number, title, description }: { number: number; title: string; description: string }): JSX.Element {
  return <View className="admin-guide__step"><Text className="admin-guide__number">{number}</Text><View><Text className="body">{title}</Text><Text className="caption">{description}</Text></View></View>;
}

export default function AdminPageRoot(): JSX.Element {
  return <QueryClientProvider client={queryClient}><AdminPage /></QueryClientProvider>;
}

function UsersPanel({ currentUser }: { currentUser: User }): JSX.Element {
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [addingTo, setAddingTo] = useState<UserWithProjects | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['users'], queryFn: async () => (await coboardClient.users.list()).users });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { role?: UserRole; isActive?: boolean } }) => coboardClient.users.update(id, input),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['users'] }),
    onError: (error) => setActionError(errorMessage(error)),
  });
  const users = query.data ?? [];
  return <View className="stack admin-panel">
    <View className="admin-panel__heading"><View><Text className="title">用户</Text><Text className="caption">共 {users.length} 个账号。{isSuperAdminRole(currentUser.role) ? '可创建管理员并调整全局角色。' : '可创建成员并维护启用状态。'}</Text></View><ActionButton size="small" onClick={() => setCreating(true)}>新建用户</ActionButton></View>
    <InlineError message={query.error ? errorMessage(query.error, '加载用户失败') : actionError} />
    {query.isLoading ? <Empty title="加载用户…" /> : users.length === 0 ? <Empty title="还没有账号" description="新建第一个团队成员账号吧。" /> : users.map((user) => {
      const self = user.id === currentUser.id;
      const protectedUser = isSuperAdminRole(user.role);
      return <Card key={user.id} className={`admin-user ${user.isActive ? '' : 'admin-card--disabled'}`}>
        <View className="admin-user__top"><Avatar name={user.displayName} color={user.avatarColor} userId={user.id} hasAvatar={user.hasAvatar} /><View className="account-copy"><View className="row"><Text className="title truncate">{user.displayName}</Text>{self && <Text className="caption">（我）</Text>}</View><Text className="caption truncate">{user.email}</Text></View><Badge tone={isAdminRole(user.role) ? 'primary' : 'neutral'}>{USER_ROLE_LABELS[user.role]}</Badge></View>
        <View className="admin-chip-list">{user.isActive ? <Badge tone="success">已启用</Badge> : <Badge>已停用</Badge>}{user.projects.length === 0 ? <Badge tone="warning">未加入任何项目</Badge> : user.projects.map((project) => <Badge key={project.projectId} tone={project.role === 'lead' ? 'primary' : 'neutral'}>{project.projectName}{project.role === 'lead' ? ' · 负责人' : ''}</Badge>)}</View>
        <View className="admin-actions"><ActionButton tone="secondary" size="small" onClick={() => setAddingTo(user)}>项目归属</ActionButton>{isSuperAdminRole(currentUser.role) && !protectedUser && <ActionButton tone="ghost" size="small" disabled={self} loading={update.isPending} onClick={() => update.mutate({ id: user.id, input: { role: user.role === 'admin' ? 'member' : 'admin' } })}>{user.role === 'admin' ? '降为成员' : '设为管理员'}</ActionButton>}<ActionButton tone={user.isActive ? 'ghost' : 'secondary'} size="small" disabled={self || protectedUser} loading={update.isPending} onClick={() => update.mutate({ id: user.id, input: { isActive: !user.isActive } })}>{user.isActive ? '停用' : '启用'}</ActionButton></View>
      </Card>;
    })}
    <CreateUserModal open={creating} canCreateAdmin={isSuperAdminRole(currentUser.role)} onClose={() => setCreating(false)} />
    {addingTo && <UserProjectsModal key={addingTo.id} user={addingTo} onClose={() => setAddingTo(null)} />}
  </View>;
}

function CreateUserModal({ open, canCreateAdmin, onClose }: { open: boolean; canCreateAdmin: boolean; onClose: () => void }): JSX.Element {
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('member');
  const [color, setColor] = useState<string>(AVATAR_COLORS[5]);
  const mutation = useMutation({
    mutationFn: () => coboardClient.users.create({ email: email.trim(), displayName: name.trim(), role: canCreateAdmin ? role : 'member', avatarColor: color }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['users'] }); onClose(); },
  });
  return <Modal open={open} title="新建用户" description="按 Syna ID 邮箱预建账号；对方首次登录时会自动关联。" onClose={onClose} footer={<><ActionButton tone="ghost" onClick={onClose}>取消</ActionButton><ActionButton loading={mutation.isPending} disabled={!email.trim() || !name.trim()} onClick={() => mutation.mutate()}>创建账号</ActionButton></>}>
    <View className="stack"><Field label="邮箱" required value={email} placeholder="name@example.com" onChange={setEmail} /><Field label="显示名称" required value={name} onChange={setName} />{canCreateAdmin && <RolePicker value={role === 'admin' ? 'admin' : 'member'} options={[{ value: 'member', label: '成员' }, { value: 'admin', label: '管理员' }]} onChange={(value) => setRole(value as UserRole)} label="全局角色" />}<View className="field"><Text className="field__label">头像底色</Text><View className="admin-colors">{AVATAR_COLORS.map((item) => <View key={item} className={`admin-color ${item === color ? 'admin-color--active' : ''}`} style={{ backgroundColor: item }} onClick={() => setColor(item)} />)}</View></View><InlineError message={mutation.error ? errorMessage(mutation.error, '创建失败') : null} /></View>
  </Modal>;
}

function UserProjectsModal({ user, onClose }: { user: UserWithProjects; onClose: () => void }): JSX.Element {
  const client = useQueryClient();
  const projects = useQuery({ queryKey: ['projects', 'admin'], queryFn: async () => (await coboardClient.projects.list()).projects });
  const [memberships, setMemberships] = useState<UserProjectMembership[]>(user.projects);
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState<ProjectRole>('member');
  const add = useMutation({
    mutationFn: () => coboardClient.projects.addMember(projectId, { userId: user.id, role }),
    onSuccess: () => {
      const project = projects.data?.find((item) => item.id === projectId);
      if (project) setMemberships((current) => [...current.filter((item) => item.projectId !== project.id), { projectId: project.id, projectName: project.name, role }]);
      setProjectId('');
      void client.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => coboardClient.projects.removeMember(id, user.id),
    onSuccess: (_data, id) => { setMemberships((current) => current.filter((item) => item.projectId !== id)); void client.invalidateQueries({ queryKey: ['users'] }); },
  });
  const available = (projects.data ?? []).filter((project) => !project.archived && !memberships.some((membership) => membership.projectId === project.id));
  return <Modal open title={`${user.displayName} · 项目归属`} description="加入项目后才会看到对应看板；负责人拥有任务管理与审核权限。" onClose={onClose} footer={<ActionButton onClick={onClose}>完成</ActionButton>}>
    <View className="stack">
      <Text className="title">当前项目</Text>
      {memberships.length === 0 ? <Empty title="尚未加入项目" /> : memberships.map((membership) => <View key={membership.projectId} className="admin-member-row"><View className="account-copy"><Text className="body">{membership.projectName}</Text><Text className="caption">{PROJECT_ROLE_LABELS[membership.role]}</Text></View><ActionButton tone="ghost" size="small" loading={remove.isPending} onClick={() => remove.mutate(membership.projectId)}>移除</ActionButton></View>)}
      <View className="divider" /><Text className="title">加入新项目</Text>
      <ChoiceField label="项目" value={projectId} placeholder={available.length ? '选择项目' : '没有可加入的项目'} options={available.map((project) => ({ value: project.id, label: `${project.name} (${project.key})` }))} onChange={setProjectId} />
      <RolePicker label="项目角色" value={role} options={[{ value: 'member', label: '成员' }, { value: 'lead', label: '负责人' }]} onChange={(value) => setRole(value as ProjectRole)} />
      <InlineError message={add.error ? errorMessage(add.error, '加入失败') : remove.error ? errorMessage(remove.error, '移除失败') : null} />
      <ActionButton tone="secondary" disabled={!projectId} loading={add.isPending} onClick={() => add.mutate()}>加入项目</ActionButton>
    </View>
  </Modal>;
}

function TracksPanel(): JSX.Element {
  const client = useQueryClient();
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; track?: Track } | null>(null);
  const [members, setMembers] = useState<Track | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['tracks'], queryFn: async () => (await coboardClient.tracks.list()).tracks });
  const update = useMutation({
    mutationFn: ({ track, archived }: { track: Track; archived: boolean }) => coboardClient.tracks.update(track.id, { archived }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['tracks'] }),
    onError: (error) => setActionError(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => coboardClient.tracks.remove(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['tracks'] }),
    onError: (error) => setActionError(errorMessage(error, '删除失败')),
  });
  const tracks = [...(query.data ?? [])].sort((a, b) => Number(a.archived) - Number(b.archived));
  const confirmRemove = async (track: Track): Promise<void> => {
    const answer = await Taro.showModal({ title: `删除“${track.name}”？`, content: '删除后其项目会变为未归类。此操作不可撤销。', confirmText: '删除', confirmColor: '#dc2626' });
    if (answer.confirm) remove.mutate(track.id);
  };
  return <View className="stack admin-panel">
    <View className="admin-panel__heading"><View><Text className="title">赛道</Text><Text className="caption">共 {tracks.length} 条赛道。将多个项目归入统一运营方向。</Text></View><ActionButton size="small" onClick={() => setForm({ mode: 'create' })}>新建赛道</ActionButton></View>
    <InlineError message={query.error ? errorMessage(query.error, '加载赛道失败') : actionError} />
    {query.isLoading ? <Empty title="加载赛道…" /> : tracks.length === 0 ? <Empty title="还没有赛道" description="创建第一条赛道来组织项目方向。" /> : tracks.map((track) => <Card key={track.id} className={`admin-entity ${track.archived ? 'admin-card--disabled' : ''}`}>
      <View className="row-between"><View className="account-copy"><View className="row"><Text className="title truncate">{track.name}</Text><Badge>{track.key}</Badge>{track.archived && <Badge tone="warning">已归档</Badge>}</View><Text className="caption">{track.weeklyGoal || track.description || '暂无本周目标'}</Text></View><Text className="admin-entity__count">{track.projectCount}<Text> 项目</Text></Text></View>
      <View className="row admin-manager-list">{track.managers.length === 0 ? <Text className="caption">暂无赛道经理</Text> : <>{track.managers.slice(0, 5).map((manager) => <Avatar key={manager.userId} name={manager.displayName} color={manager.avatarColor} userId={manager.userId} hasAvatar={manager.hasAvatar} size="small" />)}<Text className="caption">{track.managers.map((manager) => manager.displayName).join('、')}</Text></>}</View>
      <View className="admin-actions"><ActionButton tone="secondary" size="small" onClick={() => setMembers(track)}>管理成员</ActionButton><ActionButton tone="ghost" size="small" onClick={() => setForm({ mode: 'edit', track })}>编辑</ActionButton><ActionButton tone="ghost" size="small" loading={update.isPending} onClick={() => update.mutate({ track, archived: !track.archived })}>{track.archived ? '恢复' : '归档'}</ActionButton><ActionButton tone="ghost" size="small" loading={remove.isPending} onClick={() => void confirmRemove(track)}>删除</ActionButton></View>
    </Card>)}
    {form && <TrackFormModal key={`${form.mode}-${form.track?.id ?? 'new'}`} mode={form.mode} track={form.track} onClose={() => setForm(null)} onCreated={(track) => { setForm(null); setMembers(track); }} />}
    {members && <TrackMembersModal key={members.id} track={members} onClose={() => setMembers(null)} />}
  </View>;
}

function TrackFormModal({ mode, track, onClose, onCreated }: { mode: 'create' | 'edit'; track?: Track; onClose: () => void; onCreated: (track: Track) => void }): JSX.Element {
  const client = useQueryClient();
  const [name, setName] = useState(track?.name ?? '');
  const [key, setKey] = useState(track?.key ?? '');
  const [description, setDescription] = useState(track?.description ?? '');
  const [goal, setGoal] = useState(track?.weeklyGoal ?? '');
  const mutation = useMutation({
    mutationFn: async () => mode === 'create'
      ? (await coboardClient.tracks.create({ name: name.trim(), key: key.trim().toLowerCase(), description: description.trim() || undefined, weeklyGoal: goal.trim() || undefined })).track
      : (await coboardClient.tracks.update(track!.id, { name: name.trim(), description: description.trim() || null, weeklyGoal: goal.trim() || null })).track,
    onSuccess: (saved) => { void client.invalidateQueries({ queryKey: ['tracks'] }); mode === 'create' ? onCreated(saved) : onClose(); },
  });
  return <Modal open title={mode === 'create' ? '新建赛道' : '编辑赛道'} description="赛道用于汇总项目方向、运营经理和本周目标。" onClose={onClose} footer={<><ActionButton tone="ghost" onClick={onClose}>取消</ActionButton><ActionButton loading={mutation.isPending} disabled={!name.trim() || !key.trim()} onClick={() => mutation.mutate()}>{mode === 'create' ? '创建并配置成员' : '保存'}</ActionButton></>}>
    <View className="stack"><Field label="名称" required value={name} onChange={setName} /><Field label="标识" required disabled={mode === 'edit'} value={key} placeholder="content-growth" hint="仅支持小写字母、数字与连字符。创建后不可修改。" onChange={setKey} /><Field label="说明" multiline value={description} onChange={setDescription} /><Field label="本周目标" multiline value={goal} onChange={setGoal} /><InlineError message={mutation.error ? errorMessage(mutation.error, '保存失败') : null} /></View>
  </Modal>;
}

function TrackMembersModal({ track, onClose }: { track: Track; onClose: () => void }): JSX.Element {
  const client = useQueryClient();
  const candidates = useQuery({ queryKey: ['tracks', track.id, 'member-candidates'], queryFn: async () => (await coboardClient.tracks.memberCandidates(track.id)).users });
  const [assignments, setAssignments] = useState<Record<string, TrackAssignment>>(() => Object.fromEntries([...track.managers.map((person) => [person.userId, 'manager'] as const), ...track.members.map((person) => [person.userId, 'member'] as const)]));
  const save = useMutation({
    mutationFn: () => coboardClient.tracks.setMembers(track.id, { managers: Object.entries(assignments).filter(([, role]) => role === 'manager').map(([id]) => id), members: Object.entries(assignments).filter(([, role]) => role === 'member').map(([id]) => id) }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['tracks'] }); onClose(); },
  });
  const existing = [...track.managers, ...track.members].map((person) => ({ id: person.userId, displayName: person.displayName, avatarColor: person.avatarColor, hasAvatar: person.hasAvatar }));
  const people = [...existing, ...(candidates.data ?? [])].filter((person, index, all) => all.findIndex((item) => item.id === person.id) === index);
  return <Modal open title={`${track.name} · 成员`} description="经理对赛道下全部项目拥有负责人权限；普通成员只表示赛道归属。" onClose={onClose} footer={<><ActionButton tone="ghost" onClick={onClose}>取消</ActionButton><ActionButton loading={save.isPending} onClick={() => save.mutate()}>保存成员</ActionButton></>}>
    <View className="stack"><InlineError message={candidates.error ? errorMessage(candidates.error, '加载候选成员失败') : save.error ? errorMessage(save.error, '保存失败') : null} />{candidates.isLoading ? <Empty title="加载成员…" /> : people.length === 0 ? <Empty title="没有可用成员" /> : people.map((person) => <View key={person.id} className="admin-person"><Avatar name={person.displayName} color={person.avatarColor} userId={person.id} hasAvatar={person.hasAvatar} /><Text className="body truncate">{person.displayName}</Text><RolePicker compact value={assignments[person.id] ?? 'none'} options={[{ value: 'none', label: '未加入' }, { value: 'manager', label: '经理' }, { value: 'member', label: '成员' }]} onChange={(value) => setAssignments((current) => ({ ...current, [person.id]: value as TrackAssignment }))} /></View>)}</View>
  </Modal>;
}

function ProjectsPanel(): JSX.Element {
  const client = useQueryClient();
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; project?: Project } | null>(null);
  const [members, setMembers] = useState<Project | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const projects = useQuery({ queryKey: ['projects', 'admin'], queryFn: async () => (await coboardClient.projects.list()).projects });
  const tracks = useQuery({ queryKey: ['tracks'], queryFn: async () => (await coboardClient.tracks.list()).tracks });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { archived?: boolean; trackId?: string | null } }) => coboardClient.projects.update(id, input),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['projects'] }); void client.invalidateQueries({ queryKey: ['tracks'] }); },
    onError: (error) => setActionError(errorMessage(error)),
  });
  const list = [...(projects.data ?? [])].sort((a, b) => Number(a.archived) - Number(b.archived));
  const trackOptions = [{ value: '__none__', label: '未归类' }, ...(tracks.data ?? []).filter((track) => !track.archived).map((track) => ({ value: track.id, label: track.name }))];
  return <View className="stack admin-panel">
    <View className="admin-panel__heading"><View><Text className="title">项目</Text><Text className="caption">共 {list.length} 个项目。维护赛道归属、设置与成员。</Text></View><ActionButton size="small" onClick={() => setForm({ mode: 'create' })}>新建项目</ActionButton></View>
    <InlineError message={projects.error ? errorMessage(projects.error, '加载项目失败') : actionError} />
    {projects.isLoading ? <Empty title="加载项目…" /> : list.length === 0 ? <Empty title="还没有项目" description="创建第一个项目来组织团队看板。" /> : list.map((project) => <Card key={project.id} className={`admin-entity ${project.archived ? 'admin-card--disabled' : ''}`}>
      <View className="row-between"><View className="account-copy"><View className="row"><Text className="title truncate">{project.name}</Text><Badge>{project.key}</Badge>{project.archived && <Badge tone="warning">已归档</Badge>}</View><Text className="caption">{project.description || '暂无描述'}</Text></View><AppIcon name="projects" size={20} /></View>
      <ChoiceField label="所属赛道" value={project.trackId ?? '__none__'} options={trackOptions} onChange={(value) => update.mutate({ id: project.id, input: { trackId: value === '__none__' ? null : value } })} />
      <View className="admin-actions"><ActionButton tone="secondary" size="small" onClick={() => setMembers(project)}>管理成员</ActionButton><ActionButton tone="ghost" size="small" onClick={() => setForm({ mode: 'edit', project })}>编辑</ActionButton><ActionButton tone="ghost" size="small" loading={update.isPending} onClick={() => update.mutate({ id: project.id, input: { archived: !project.archived } })}>{project.archived ? '恢复' : '归档'}</ActionButton></View>
    </Card>)}
    {form && <ProjectFormModal key={`${form.mode}-${form.project?.id ?? 'new'}`} mode={form.mode} project={form.project} tracks={tracks.data ?? []} onClose={() => setForm(null)} onCreated={(project) => { setForm(null); setMembers(project); }} />}
    {members && <ProjectMembersModal key={members.id} project={members} onClose={() => setMembers(null)} />}
  </View>;
}

function ProjectFormModal({ mode, project, tracks, onClose, onCreated }: { mode: 'create' | 'edit'; project?: Project; tracks: Track[]; onClose: () => void; onCreated: (project: Project) => void }): JSX.Element {
  const client = useQueryClient();
  const [name, setName] = useState(project?.name ?? '');
  const [key, setKey] = useState(project?.key ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [trackId, setTrackId] = useState(project?.trackId ?? '__none__');
  const mutation = useMutation({
    mutationFn: async () => mode === 'create'
      ? (await coboardClient.projects.create({ name: name.trim(), key: key.trim().toUpperCase(), description: description.trim() || undefined, trackId: trackId === '__none__' ? null : trackId })).project
      : (await coboardClient.projects.update(project!.id, { name: name.trim(), description: description.trim() || null, trackId: trackId === '__none__' ? null : trackId })).project,
    onSuccess: (saved) => { void client.invalidateQueries({ queryKey: ['projects'] }); void client.invalidateQueries({ queryKey: ['tracks'] }); mode === 'create' ? onCreated(saved) : onClose(); },
  });
  return <Modal open title={mode === 'create' ? '新建项目' : '编辑项目'} description="项目是成员权限和任务看板的实际边界。" onClose={onClose} footer={<><ActionButton tone="ghost" onClick={onClose}>取消</ActionButton><ActionButton loading={mutation.isPending} disabled={!name.trim() || !key.trim()} onClick={() => mutation.mutate()}>{mode === 'create' ? '创建并添加成员' : '保存'}</ActionButton></>}>
    <View className="stack"><Field label="名称" required value={name} onChange={setName} /><Field label="标识" required disabled={mode === 'edit'} value={key} placeholder="BOARD" hint="项目标识创建后不可修改。" onChange={setKey} /><Field label="描述" multiline value={description} onChange={setDescription} /><ChoiceField label="所属赛道" value={trackId} options={[{ value: '__none__', label: '未归类' }, ...tracks.filter((item) => !item.archived).map((item) => ({ value: item.id, label: item.name }))]} onChange={setTrackId} /><InlineError message={mutation.error ? errorMessage(mutation.error, '保存失败') : null} /></View>
  </Modal>;
}

function ProjectMembersModal({ project, onClose }: { project: Project; onClose: () => void }): JSX.Element {
  const client = useQueryClient();
  const members = useQuery({ queryKey: ['projects', project.id, 'members'], queryFn: async () => (await coboardClient.projects.members(project.id)).members });
  const users = useQuery({ queryKey: ['users'], queryFn: async () => (await coboardClient.users.list()).users });
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<ProjectRole>('member');
  const save = useMutation({
    mutationFn: ({ id, nextRole }: { id: string; nextRole: ProjectRole }) => coboardClient.projects.addMember(project.id, { userId: id, role: nextRole }),
    onSuccess: () => { setUserId(''); void client.invalidateQueries({ queryKey: ['projects', project.id, 'members'] }); void client.invalidateQueries({ queryKey: ['users'] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => coboardClient.projects.removeMember(project.id, id),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['projects', project.id, 'members'] }); void client.invalidateQueries({ queryKey: ['users'] }); },
  });
  const current = members.data ?? [];
  const available = (users.data ?? []).filter((user) => user.isActive && !current.some((membership) => membership.userId === user.id));
  return <Modal open title={`${project.name} · 成员`} description="负责人可以派发、转交和审核任务；成员可查看项目并参与任务。" onClose={onClose} footer={<ActionButton onClick={onClose}>完成</ActionButton>}>
    <View className="stack"><InlineError message={members.error ? errorMessage(members.error, '加载成员失败') : save.error ? errorMessage(save.error, '保存失败') : remove.error ? errorMessage(remove.error, '移除失败') : null} />
      <Text className="title">当前成员 · {current.length}</Text>
      {members.isLoading ? <Empty title="加载成员…" /> : current.length === 0 ? <Empty title="项目还没有成员" /> : current.map((membership) => <View key={membership.userId} className="admin-person"><Avatar name={membership.user.displayName} color={membership.user.avatarColor} userId={membership.user.id} hasAvatar={membership.user.hasAvatar} /><View className="account-copy"><Text className="body truncate">{membership.user.displayName}</Text><Text className="caption truncate">{membership.user.email}</Text></View><RolePicker compact value={membership.role} options={[{ value: 'member', label: '成员' }, { value: 'lead', label: '负责人' }]} onChange={(nextRole) => save.mutate({ id: membership.userId, nextRole: nextRole as ProjectRole })} /><ActionButton tone="ghost" size="small" loading={remove.isPending} onClick={() => remove.mutate(membership.userId)}>移除</ActionButton></View>)}
      <View className="divider" /><Text className="title">添加成员</Text><ChoiceField label="成员" value={userId} placeholder={available.length ? '选择账号' : '没有可添加账号'} options={available.map((user) => ({ value: user.id, label: `${user.displayName} · ${user.email}` }))} onChange={setUserId} /><RolePicker label="项目角色" value={role} options={[{ value: 'member', label: '成员' }, { value: 'lead', label: '负责人' }]} onChange={(nextRole) => setRole(nextRole as ProjectRole)} /><ActionButton tone="secondary" disabled={!userId} loading={save.isPending} onClick={() => save.mutate({ id: userId, nextRole: role })}>添加到项目</ActionButton>
    </View>
  </Modal>;
}

function SettingsPanel(): JSX.Element {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => coboardClient.settings.get() });
  const email = useQuery({ queryKey: ['settings', 'email-notifications'], queryFn: () => coboardClient.settings.emailNotifications() });
  const users = useQuery({ queryKey: ['users'], queryFn: async () => (await coboardClient.users.list()).users });
  const [code, setCode] = useState('');
  const [dueDays, setDueDays] = useState('');
  const update = useMutation({
    mutationFn: (input: { registrationEnabled?: boolean; registrationCode?: string }) => coboardClient.settings.update(input),
    onSuccess: (data) => { client.setQueryData(['settings'], data); void Taro.showToast({ title: '已保存', icon: 'success' }); },
  });
  const updateEmail = useMutation({
    mutationFn: (input: Parameters<typeof coboardClient.settings.updateEmailNotifications>[0]) => coboardClient.settings.updateEmailNotifications(input),
    onSuccess: (data) => { client.setQueryData(['settings', 'email-notifications'], data); void Taro.showToast({ title: '邮件设置已保存', icon: 'success' }); },
  });
  const registration = settings.data;
  const emailSettings = email.data;
  const currentCode = code || registration?.registrationCode || '';
  const administrators = (users.data ?? []).filter((user) => isAdminRole(user.role) && user.isActive);
  const toggleRecipient = (id: string, enabled: boolean): void => {
    if (!emailSettings) return;
    const next = enabled ? [...new Set([...emailSettings.adminRecipientIds, id])] : emailSettings.adminRecipientIds.filter((item) => item !== id);
    updateEmail.mutate({ adminRecipientIds: next });
  };
  return <View className="stack admin-panel">
    <View><Text className="title">系统设置</Text><Text className="caption">管理自助加入与任务邮件提醒。</Text></View>
    <InlineError message={settings.error ? errorMessage(settings.error, '加载注册设置失败') : email.error ? errorMessage(email.error, '加载邮件设置失败') : update.error ? errorMessage(update.error) : updateEmail.error ? errorMessage(updateEmail.error) : null} />
    <Card className="stack">
      <View className="row-between"><View className="account-copy"><Text className="title">开放新成员加入</Text><Text className="caption">允许新的 Syna ID 使用邀请码加入团队。</Text></View><Switch checked={registration?.registrationEnabled ?? false} disabled={!registration} onChange={(event) => update.mutate({ registrationEnabled: event.detail.value })} /></View>
      <Field label="邀请码" value={currentCode} placeholder="设置团队邀请码" onChange={setCode} hint="只应通过可信渠道发给成员。" />
      <ActionButton tone="secondary" size="small" loading={update.isPending} disabled={!currentCode || currentCode === registration?.registrationCode} onClick={() => update.mutate({ registrationCode: currentCode })}>保存邀请码</ActionButton>
    </Card>
    <Card className="stack">
      <View className="row-between"><View className="account-copy"><Text className="title">邮件提醒</Text><Text className="caption">关键任务节点通过邮件触达相关成员。</Text></View><Switch checked={emailSettings?.enabled ?? false} disabled={!emailSettings} onChange={(event) => updateEmail.mutate({ enabled: event.detail.value })} /></View>
      {emailSettings && <><View className="divider" />{Object.entries(emailSettings.events).map(([key, enabled]) => <View key={key} className="row-between"><Text className="body">{emailEventLabel(key)}</Text><Switch checked={enabled} onChange={(event) => updateEmail.mutate({ events: { [key]: event.detail.value } })} /></View>)}
        <Field label="临期提醒天数" value={dueDays || String(emailSettings.dueSoonDays)} onChange={setDueDays} hint="任务到期前 0–30 天发送提醒。" />
        <ActionButton tone="secondary" size="small" disabled={!dueDays} loading={updateEmail.isPending} onClick={() => updateEmail.mutate({ dueSoonDays: Math.max(0, Math.min(30, Number.parseInt(dueDays, 10) || 0)) })}>保存提醒时间</ActionButton>
        <View className="divider" /><View><Text className="title">管理员复核邮件接收人</Text><Text className="caption">仅影响“需要管理员复核”这一类邮件。</Text></View>{administrators.map((admin) => <View key={admin.id} className="row-between"><View className="row"><Avatar name={admin.displayName} color={admin.avatarColor} userId={admin.id} hasAvatar={admin.hasAvatar} size="small" /><Text className="body">{admin.displayName}</Text></View><Switch checked={emailSettings.adminRecipientIds.includes(admin.id)} onChange={(event) => toggleRecipient(admin.id, event.detail.value)} /></View>)}</>}
    </Card>
  </View>;
}

function ChoiceField({ label, value, placeholder = '请选择', options, onChange }: { label: string; value: string; placeholder?: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void }): JSX.Element {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options.find((option) => option.value === value);
  return <View className="field"><Text className="field__label">{label}</Text><Picker mode="selector" range={options.map((option) => option.label)} value={index} disabled={options.length === 0} onChange={(event) => { const option = options[Number(event.detail.value)]; if (option) onChange(option.value); }}><View className={`field__control field__select ${selected ? '' : 'admin-choice--placeholder'}`}><Text>{selected?.label ?? placeholder}</Text><Text>⌄</Text></View></Picker></View>;
}

function RolePicker({ label, value, options, onChange, compact = false }: { label?: string; value: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void; compact?: boolean }): JSX.Element {
  return <View className={`${compact ? '' : 'field'} admin-role-field`}>{label && <Text className="field__label">{label}</Text>}<View className={`admin-role-picker ${compact ? 'admin-role-picker--compact' : ''}`}>{options.map((option) => <Text key={option.value} className={`admin-role-picker__item ${value === option.value ? 'admin-role-picker__item--active' : ''}`} onClick={() => onChange(option.value)}>{option.label}</Text>)}</View></View>;
}

function emailEventLabel(key: string): string {
  return ({ taskAssigned: '任务被派发', taskDueSoon: '任务即将到期', taskSubmitted: '任务提交交付', taskRejected: '任务被驳回', adminReviewNeeded: '需要管理员复核' } as Record<string, string>)[key] ?? key;
}
