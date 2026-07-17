import Taro, { useDidShow } from '@tarojs/taro';
import { Input, Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { queryKeys } from 'client-core';
import type { AuthUserResponse } from 'shared';
import { acceptNativeSession, logout, useCurrentUser } from '../../lib/auth';
import { coboardClient } from '../../platform/coboard-client';
import { sessionStore } from '../../platform/session';
import { taroHttpAdapter } from '../../platform/http';
import {
  ActionButton,
  AppIcon,
  Avatar,
  Badge,
  Card,
  clearAvatarCache,
  Field,
  InlineError,
  PageHeader,
} from '../../components/ui';
import { queryClient } from '../../lib/query';
import './index.scss';

const SYNA_ACCOUNT_URL = 'https://auth.synapsly.org/account';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function chooseAvatarDataUrl(): Promise<string | null> {
  const result = await Taro.chooseMedia({
    count: 1,
    mediaType: ['image'],
    sourceType: ['album', 'camera'],
    sizeType: ['compressed'],
  });
  const path = result.tempFiles[0]?.tempFilePath;
  if (!path) return null;
  const compressed = await Taro.compressImage({ src: path, quality: 82 }).catch(() => ({ tempFilePath: path }));
  const filePath = compressed.tempFilePath || path;
  const base64 = await new Promise<string>((resolve, reject) => {
    Taro.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (response) => resolve(String(response.data)),
      fail: () => reject(new Error('读取头像失败')),
    });
  });
  const suffix = filePath.toLowerCase();
  const mime = suffix.includes('.png') ? 'image/png' : suffix.includes('.webp') ? 'image/webp' : 'image/jpeg';
  const image = `data:${mime};base64,${base64}`;
  if (image.length > 2_000_000) throw new Error('图片仍然过大，请选择小于 1.5 MB 的图片');
  return image;
}

function ProfilePage(): JSX.Element {
  const user = useCurrentUser();
  const isLocalDevelopment = process.env.NODE_ENV === 'development';
  const authConfig = useQuery({
    queryKey: queryKeys.authConfig(),
    queryFn: ({ signal }) => coboardClient.auth.config(signal),
    staleTime: 300000,
  });
  const [email, setEmail] = useState('admin@coboard.local');
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [avatarVersion, setAvatarVersion] = useState(0);

  const devLogin = useMutation({
    mutationFn: () => coboardClient.auth.miniappDevLogin({ email: email.trim() }),
    onSuccess: (response) => {
      acceptNativeSession(response);
      void Taro.showToast({ title: '登录成功', icon: 'success' });
    },
  });
  const update = useMutation({
    mutationFn: () => coboardClient.auth.updateProfile({ displayName: displayName.trim() }),
    onSuccess: (response) => {
      setEditing(false);
      setDisplayName(response.user.displayName);
      void user.refetch();
      void Taro.showToast({ title: '已保存', icon: 'success' });
    },
  });
  const avatar = useMutation({
    mutationFn: async () => {
      const image = await chooseAvatarDataUrl();
      if (!image) throw new Error('未选择图片');
      return taroHttpAdapter.request<AuthUserResponse>({ method: 'POST', path: '/auth/avatar', body: { image } });
    },
    onSuccess: (response) => {
      clearAvatarCache(response.user.id);
      queryClient.setQueryData(queryKeys.me(), response.user);
      setAvatarVersion((current) => current + 1);
      void Taro.showToast({ title: '头像已更新', icon: 'success' });
    },
  });
  const removeAvatar = useMutation({
    mutationFn: () => taroHttpAdapter.request<AuthUserResponse>({ method: 'DELETE', path: '/auth/avatar' }),
    onSuccess: (response) => {
      clearAvatarCache(response.user.id);
      queryClient.setQueryData(queryKeys.me(), response.user);
      setAvatarVersion((current) => current + 1);
      void Taro.showToast({ title: '头像已移除', icon: 'success' });
    },
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => void Taro.showToast({ title: '已退出', icon: 'success' }),
  });

  useDidShow(() => {
    if (sessionStore.token()) void user.refetch();
  });

  if (!user.data) {
    return <View className="page profile-page profile-login">
      <View className="profile-login__brand"><View className="profile-login__mark"><AppIcon name="profile" size={28} /></View><Text className="profile-login__title">登录 Coboard</Text><Text className="profile-login__description">使用 Syna 账号继续你的团队协作</Text></View>
      <InlineError message={errorMessage(user.error, '') || errorMessage(authConfig.error, '')} />
      {authConfig.data?.synapslyEnabled ? <ActionButton block onClick={() => void Taro.navigateTo({ url: '/pages/auth-login/index' })}>使用 Syna ID 登录</ActionButton> : !authConfig.isLoading && <Card><Text className="caption">Syna ID 登录尚未配置，请联系管理员。</Text></Card>}
      {(isLocalDevelopment || authConfig.data?.devLogin) && <Card className="stack profile-dev-login">
        <View><Text className="title">本地开发登录</Text><Text className="caption">仅开发环境可用。请填写 Web 端当前账号的同一邮箱，确保角色、项目与数据完全一致。</Text></View>
        <Input className="field__control" value={email} onInput={(event) => setEmail(event.detail.value)} placeholder="例如 admin@coboard.local" />
        <InlineError message={devLogin.error ? errorMessage(devLogin.error, '开发登录失败') : null} />
        <ActionButton tone="secondary" block loading={devLogin.isPending} disabled={!email.trim()} onClick={() => devLogin.mutate()}>以此邮箱登录</ActionButton>
      </Card>}
      <Text className="profile-login__legal">登录即表示同意由 Syna 账号完成身份验证，Coboard 不保存你的密码。</Text>
    </View>;
  }

  const currentUser = user.data;
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'super_admin';
  const roleLabel = currentUser.role === 'super_admin' ? '超级管理员' : currentUser.role === 'admin' ? '管理员' : '成员';
  const avatarError = avatar.error ? errorMessage(avatar.error, '头像上传失败') : removeAvatar.error ? errorMessage(removeAvatar.error, '头像移除失败') : null;

  return <View className="page profile-page">
    <PageHeader title="账号设置" description="维护 Coboard 内展示的头像和名称；邮箱、密码与安全设置由 Syna 账号统一管理。" />
    <Card className="profile-card">
      <View className="profile-card__identity">
        <View className="profile-avatar" onClick={() => { if (!avatar.isPending) avatar.mutate(); }}>
          <Avatar name={currentUser.displayName} color={currentUser.avatarColor} userId={currentUser.id} hasAvatar={currentUser.hasAvatar} size="large" version={avatarVersion} />
          <View className="profile-avatar__edit"><Text>{avatar.isPending ? '上传中' : '更换'}</Text></View>
        </View>
        <View className="account-copy"><Text className="title">{currentUser.displayName}</Text><Text className="caption">{currentUser.email}</Text><Badge tone={isAdmin ? 'primary' : 'neutral'}>{roleLabel}</Badge></View>
      </View>
      <InlineError message={avatarError} />
      <View className="profile-card__actions">
        <ActionButton tone="secondary" size="small" loading={avatar.isPending} onClick={() => avatar.mutate()}>{currentUser.hasAvatar ? '更换头像' : '上传头像'}</ActionButton>
        {currentUser.hasAvatar && <ActionButton tone="ghost" size="small" loading={removeAvatar.isPending} onClick={() => removeAvatar.mutate()}>移除头像</ActionButton>}
      </View>
      <View className="profile-divider" />
      {editing ? <View className="stack">
        <Field label="显示名称" required value={displayName} onChange={setDisplayName} error={update.error ? errorMessage(update.error, '保存失败') : undefined} hint="其他成员在任务、评论与排行榜中看到的名字。" />
        <View className="row"><ActionButton size="small" loading={update.isPending} disabled={!displayName.trim() || displayName.trim() === currentUser.displayName} onClick={() => update.mutate()}>保存名称</ActionButton><ActionButton tone="ghost" size="small" onClick={() => setEditing(false)}>取消</ActionButton></View>
      </View> : <View className="row-between"><View className="account-copy"><Text className="body">显示名称</Text><Text className="caption">{currentUser.displayName}</Text></View><ActionButton tone="ghost" size="small" onClick={() => { setDisplayName(currentUser.displayName); setEditing(true); }}>编辑</ActionButton></View>}
    </Card>

    <Card className="stack profile-syna">
      <View className="row-between"><View><Text className="title">Syna 账号</Text><Text className="caption">密码、邮箱与安全设置由 Syna 账号统一管理。</Text></View><Badge tone="primary">Syna ID</Badge></View>
      <View className="profile-syna__identity"><View><Text className="body">{currentUser.displayName}</Text><Text className="caption">{currentUser.email}</Text></View></View>
      <View className="row profile-syna__actions"><ActionButton tone="secondary" size="small" onClick={() => void Taro.navigateTo({ url: '/pages/syna-account/index' })}>管理 Syna 账号</ActionButton><ActionButton tone="ghost" size="small" onClick={() => void Taro.setClipboardData({ data: SYNA_ACCOUNT_URL }).then(() => Taro.showToast({ title: '管理地址已复制', icon: 'success' }))}>复制地址</ActionButton></View>
    </Card>

    {isAdmin && <Card interactive onClick={() => void Taro.navigateTo({ url: '/pages/admin/index' })}><View className="row-between"><View className="row"><View className="profile-admin__icon"><AppIcon name="admin" size={20} /></View><View className="account-copy"><Text className="title">后台管理</Text><Text className="caption">用户、赛道、项目与注册设置</Text></View></View><Text className="profile-chevron">›</Text></View></Card>}
    <ActionButton tone="ghost" block loading={logoutMutation.isPending} onClick={() => logoutMutation.mutate()}>退出登录</ActionButton>
  </View>;
}

export default function ProfilePageRoot(): JSX.Element {
  return <QueryClientProvider client={queryClient}><ProfilePage /></QueryClientProvider>;
}
