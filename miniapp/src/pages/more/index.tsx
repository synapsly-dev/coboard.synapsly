import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AppIcon, type AppIconName, Avatar, Badge } from '../../components/ui';
import { useCurrentUser, useSessionToken } from '../../lib/auth';
import { queryClient } from '../../lib/query';
import { coboardClient } from '../../platform/coboard-client';
import './index.scss';

console.info('[more/page] module evaluated');

interface Entry {
  title: string;
  description: string;
  path: string;
  icon: AppIconName;
  tone: string;
}

const collaboration: Entry[] = [
  { title: '灵感区', description: '收集想法、评审提案并发放奖励点数', path: '/pages/ideas/index', icon: 'ideas', tone: 'amber' },
  { title: '资产库', description: '沉淀内容、反馈、资源和问题清单', path: '/pages/assets/index', icon: 'assets', tone: 'blue' },
];

const team: Entry[] = [
  { title: '团队架构', description: '查看部门、岗位、成员和招募申请', path: '/pages/org/index', icon: 'org', tone: 'violet' },
  { title: '团队信息', description: '阅读公告、制度更新与团队动态', path: '/pages/info/index', icon: 'info', tone: 'green' },
  { title: '贡献统计', description: '查看个人贡献、趋势与团队排行榜', path: '/pages/stats/index', icon: 'stats', tone: 'rose' },
];

function openPage(path: string): void {
  void Taro.navigateTo({ url: path });
}

function EntryRow({ entry }: { entry: Entry }): JSX.Element {
  return <View className="more-row" onClick={() => openPage(entry.path)}>
    <View className={`more-row__icon more-row__icon--${entry.tone}`}><AppIcon name={entry.icon} size={21} /></View>
    <View className="more-row__copy">
      <Text className="more-row__title">{entry.title}</Text>
      <Text className="more-row__description">{entry.description}</Text>
    </View>
    <Text className="more-row__arrow">›</Text>
  </View>;
}

function MorePage(): JSX.Element {
  console.info('[more/page] component render');
  const token = useSessionToken();
  const user = useCurrentUser();
  const isAdmin = user.data?.role === 'admin' || user.data?.role === 'super_admin';
  const counts = useQuery({ queryKey: ['notifications', 'counts', token], enabled: Boolean(token), queryFn: () => coboardClient.notifications.counts() });
  const reviews = useQuery({ queryKey: ['workbench', 'review-queue', token], enabled: Boolean(token), queryFn: async () => (await coboardClient.workbench.reviewQueue()).tasks });
  const applications = useQuery({ queryKey: ['org', 'applications', 'all', user.data?.id], enabled: Boolean(user.data), queryFn: () => coboardClient.org.applications('all') });
  const pendingApplications = (applications.data?.applications ?? []).filter((item) => item.status === 'pending' && applications.data?.canDecideNodeIds.includes(item.nodeId) && item.applicant.id !== user.data?.id).length;
  const refresh = async (): Promise<void> => { if (token) await Promise.all([user.refetch(), counts.refetch(), reviews.refetch(), applications.refetch()]); };
  useDidShow(() => { void refresh(); });
  usePullDownRefresh(async () => { await refresh(); Taro.stopPullDownRefresh(); });

  return <View className="page more-page">
    <View className="more-heading">
      <Text className="more-heading__title">更多</Text>
      <Text className="more-heading__description">探索 Coboard 的全部协作能力</Text>
    </View>

    <View className="more-account" onClick={() => openPage('/pages/profile/index')}>
      {user.data ? <Avatar name={user.data.displayName} color={user.data.avatarColor} /> : <View className="more-account__placeholder"><AppIcon name="profile" size={22} /></View>}
      <View className="more-account__copy">
        <Text className="more-account__name">{user.isLoading ? '正在读取账号…' : user.data?.displayName ?? '登录 Coboard'}</Text>
        <Text className="more-account__email">{user.data?.email ?? '登录后同步网页版账号、角色和项目权限'}</Text>
      </View>
      {user.data && <Badge tone={isAdmin ? 'primary' : 'neutral'}>{isAdmin ? '管理员' : '成员'}</Badge>}
      <Text className="more-row__arrow">›</Text>
    </View>

    {token && <View className="more-glance">
      <View onClick={() => void Taro.switchTab({ url: '/pages/notifications/index' })}><Text className="more-glance__value">{counts.data?.counts.unread ?? 0}</Text><Text className="more-glance__label">未读通知</Text></View>
      <View onClick={() => void Taro.switchTab({ url: '/pages/workbench/index' })}><Text className="more-glance__value">{reviews.data?.length ?? 0}</Text><Text className="more-glance__label">待我审核</Text></View>
      <View onClick={() => openPage('/pages/org/index')}><Text className="more-glance__value">{pendingApplications}</Text><Text className="more-glance__label">招募申请</Text></View>
    </View>}

    <View className="more-section">
      <Text className="more-section__title">知识与协作</Text>
      <View className="more-panel">{collaboration.map((entry) => <EntryRow key={entry.path} entry={entry} />)}</View>
    </View>
    <View className="more-section">
      <Text className="more-section__title">团队</Text>
      <View className="more-panel">{team.map((entry) => <EntryRow key={entry.path} entry={entry} />)}</View>
    </View>
    <View className="more-section">
      <Text className="more-section__title">账户与管理</Text>
      <View className="more-panel">
        <EntryRow entry={{ title: '个人资料', description: '账号身份、头像与登录状态', path: '/pages/profile/index', icon: 'profile', tone: 'neutral' }} />
        {isAdmin && <EntryRow entry={{ title: '后台管理', description: '管理用户、赛道、项目和系统设置', path: '/pages/admin/index', icon: 'admin', tone: 'dark' }} />}
      </View>
    </View>
    <Text className="more-version">Coboard Mini · 与网页版数据实时同步</Text>
  </View>;
}

export default function MorePageRoot(): JSX.Element {
  return <QueryClientProvider client={queryClient}><MorePage /></QueryClientProvider>;
}
