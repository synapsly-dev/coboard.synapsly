import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { QueryClientProvider } from '@tanstack/react-query';
import { useCurrentUser } from '../../lib/auth';
import { AppIcon, Avatar, Badge, Card, PageHeader } from '../../components/ui';
import { queryClient } from '../../lib/query';
import './index.scss';

const entries = [
  { title: '灵感', description: '想法收集、评审与奖励', path: '/pages/ideas/index', icon: 'ideas' },
  { title: '资产', description: '内容、反馈、资源与问题库', path: '/pages/assets/index', icon: 'assets' },
  { title: '架构', description: '团队分工、岗位与招募', path: '/pages/org/index', icon: 'org' },
  { title: '信息', description: '团队公告与重要消息', path: '/pages/info/index', icon: 'info' },
  { title: '统计', description: '贡献、趋势与排行榜', path: '/pages/stats/index', icon: 'stats' },
] as const;

function MorePage(): JSX.Element {
  const user = useCurrentUser(); const isAdmin = user.data?.role === 'admin' || user.data?.role === 'super_admin';
  return <View className="page"><PageHeader title="更多" description="Coboard 的全部协作能力" /><Card className="account-card" onClick={() => void Taro.navigateTo({ url: '/pages/profile/index' })}>{user.data ? <Avatar name={user.data.displayName} color={user.data.avatarColor} /> : <View className="more-entry__glyph"><AppIcon name="profile" /></View>}<View className="account-card__copy"><Text className="title">{user.data?.displayName ?? '账号与个人资料'}</Text><Text className="caption">{user.data?.email ?? '登录后查看身份与个人资料'}</Text></View>{user.data && <Badge>{isAdmin ? '管理员' : '成员'}</Badge>}<Text>›</Text></Card><View className="more-grid">{entries.map((entry) => <Card key={entry.path} className="more-entry" onClick={() => void Taro.navigateTo({ url: entry.path })}><View className="more-entry__glyph"><AppIcon name={entry.icon} /></View><Text className="title">{entry.title}</Text><Text className="caption">{entry.description}</Text></Card>)}</View>{isAdmin && <Card className="admin-entry" onClick={() => void Taro.navigateTo({ url: '/pages/admin/index' })}><View className="row"><View className="more-entry__glyph"><AppIcon name="admin" /></View><View><Text className="title">后台管理</Text><Text className="caption">用户、赛道、项目与设置</Text></View></View><Text>›</Text></Card>}</View>;
}

export default function MorePageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><MorePage /></QueryClientProvider>; }
