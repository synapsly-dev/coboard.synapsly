import { Button, Text, View } from '@tarojs/components';
import './state-view.scss';

export function StateView({
  loading,
  error,
  empty,
  onRetry,
  children,
}: {
  loading: boolean;
  error: boolean;
  empty: boolean;
  onRetry: () => void;
  children: React.ReactNode;
}): JSX.Element {
  if (loading) return <View className="state-view"><Text>加载中…</Text></View>;
  if (error) return <View className="state-view"><Text>加载失败</Text><Button size="mini" onClick={onRetry}>重试</Button></View>;
  if (empty) return <View className="state-view"><Text>暂无内容</Text></View>;
  return <>{children}</>;
}

