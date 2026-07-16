import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { useSessionToken } from '../lib/auth';
import './state-view.scss';

export function AuthGate({ children }: { children: React.ReactNode }): JSX.Element {
  const token = useSessionToken();
  if (token) return <>{children}</>;
  return (
    <View className="state-view">
      <Text>登录后查看团队内容</Text>
      <Button size="mini" onClick={() => void Taro.switchTab({ url: '/pages/profile/index' })}>
        去登录
      </Button>
    </View>
  );
}
