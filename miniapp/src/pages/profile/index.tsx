import Taro, { useDidShow } from '@tarojs/taro';
import { Input, Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { queryKeys } from 'client-core';
import { acceptNativeSession, logout, useCurrentUser } from '../../lib/auth';
import { coboardClient } from '../../platform/coboard-client';
import { sessionStore } from '../../platform/session';
import { ActionButton, Avatar, Badge, Card, Field, PageHeader } from '../../components/ui';
import { queryClient } from '../../lib/query';

function ProfilePage(): JSX.Element {
  const user = useCurrentUser(); const isLocalDevelopment = process.env.NODE_ENV === 'development'; const authConfig = useQuery({ queryKey: queryKeys.authConfig(), queryFn: ({ signal }) => coboardClient.auth.config(signal), staleTime: 300000 }); const [email, setEmail] = useState('admin@coboard.local'); const [editing, setEditing] = useState(false); const [displayName, setDisplayName] = useState('');
  const devLogin = useMutation({
    mutationFn: () => coboardClient.auth.miniappDevLogin({ email: email.trim() }),
    onSuccess: (response) => {
      acceptNativeSession(response);
      void Taro.showToast({ title: '登录成功', icon: 'success' });
    },
    onError: (error) => {
      void Taro.showModal({
        title: '开发登录失败',
        content: error instanceof Error ? error.message : '请确认本地服务已启动',
        showCancel: false,
      });
    },
  });
  const update = useMutation({ mutationFn: () => coboardClient.auth.updateProfile({ displayName: displayName.trim() }), onSuccess: (response) => { setEditing(false); setDisplayName(response.user.displayName); void user.refetch(); void Taro.showToast({ title: '已保存', icon: 'success' }); } });
  const logoutMutation = useMutation({ mutationFn: logout, onSuccess: () => void Taro.showToast({ title: '已退出', icon: 'success' }) });
  useDidShow(() => { if (sessionStore.token()) void user.refetch(); });
  if (!user.data) return <View className="page"><PageHeader title="登录 Coboard" description="小程序使用独立登录会话，但会连接 Web 端同一个服务和数据库。" />{authConfig.data?.synapslyEnabled && <ActionButton onClick={() => void Taro.navigateTo({ url: '/pages/auth-login/index' })}>使用 Syna ID 登录</ActionButton>}{(isLocalDevelopment || authConfig.data?.devLogin) && <Card className="stack"><Text className="title">本地开发登录</Text><Text className="caption">必须填写 Web 端当前登录所用的同一邮箱；不同邮箱是不同账号，项目权限和可见数据也不同。</Text><Input className="field__control" value={email} onInput={(event) => setEmail(event.detail.value)} placeholder="例如 admin@coboard.local" /><ActionButton loading={devLogin.isPending} disabled={!email.trim()} onClick={() => devLogin.mutate()}>以此邮箱登录</ActionButton></Card>}</View>;
  const isAdmin = user.data.role === 'admin' || user.data.role === 'super_admin';
  return <View className="page"><PageHeader title="账号" description="管理个人资料和当前登录会话。" /><Card className="stack"><View className="row"><Avatar name={user.data.displayName} color={user.data.avatarColor} /><View className="account-copy"><Text className="title">{user.data.displayName}</Text><Text className="caption">{user.data.email}</Text></View><Badge>{isAdmin ? '管理员' : '成员'}</Badge></View>{editing ? <><Field label="显示名称" value={displayName} onChange={setDisplayName} /><View className="row"><ActionButton size="small" loading={update.isPending} disabled={!displayName.trim()} onClick={() => update.mutate()}>保存</ActionButton><ActionButton tone="ghost" size="small" onClick={() => setEditing(false)}>取消</ActionButton></View></> : <ActionButton tone="secondary" size="small" onClick={() => { setDisplayName(user.data!.displayName); setEditing(true); }}>编辑资料</ActionButton>}</Card><View style={{ height: '16px' }} />{isAdmin && <Card onClick={() => void Taro.navigateTo({ url: '/pages/admin/index' })}><View className="row-between"><View className="account-copy"><Text className="title">后台管理</Text><Text className="caption">用户、赛道、项目与注册设置</Text></View><Text>›</Text></View></Card>}<View style={{ height: '16px' }} /><ActionButton tone="ghost" loading={logoutMutation.isPending} onClick={() => logoutMutation.mutate()}>退出登录</ActionButton></View>;
}
export default function ProfilePageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><ProfilePage /></QueryClientProvider>; }
