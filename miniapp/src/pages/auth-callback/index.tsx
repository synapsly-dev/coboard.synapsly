import Taro, { useRouter } from '@tarojs/taro';
import { Button, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { acceptNativeSession } from '../../lib/auth';
import { coboardClient } from '../../platform/coboard-client';

export default function AuthCallbackPage(): JSX.Element {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const exchange = async (): Promise<void> => {
    if (router.params.error) {
      setError(decodeURIComponent(router.params.error));
      return;
    }
    const code = router.params.code;
    if (!code) {
      setError('登录回调缺少凭证，请重新登录');
      return;
    }
    setError(null);
    try {
      const response = await coboardClient.auth.miniappExchange({ code });
      acceptNativeSession(response);
      await Taro.showToast({ title: '登录成功', icon: 'success' });
      await Taro.switchTab({ url: '/pages/profile/index' });
    } catch {
      setError('登录凭证已失效或网络异常，请重新登录');
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void exchange();
  }, []);

  return (
    <View className="page">
      <View className="section-title">{error ? '登录未完成' : '正在完成登录…'}</View>
      {error && (
        <>
          <View className="muted">{error}</View>
          <Button onClick={() => void Taro.redirectTo({ url: '/pages/auth-login/index' })}>
            重新登录
          </Button>
        </>
      )}
    </View>
  );
}
