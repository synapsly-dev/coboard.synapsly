import Taro from '@tarojs/taro';

const SESSION_KEY = 'coboard-native-session';
const SESSION_EVENT = 'coboard:session-changed';

export interface NativeSession {
  token: string;
  expiresAt: string;
}

export const sessionStore = {
  get(): NativeSession | null {
    const value = Taro.getStorageSync<NativeSession>(SESSION_KEY);
    if (!value || typeof value.token !== 'string' || typeof value.expiresAt !== 'string')
      return null;
    if (Date.parse(value.expiresAt) <= Date.now()) {
      this.clear();
      return null;
    }
    return value;
  },
  token(): string | null {
    return this.get()?.token ?? null;
  },
  set(session: NativeSession): void {
    Taro.setStorageSync(SESSION_KEY, session);
    Taro.eventCenter.trigger(SESSION_EVENT);
  },
  clear(): void {
    Taro.removeStorageSync(SESSION_KEY);
    Taro.eventCenter.trigger(SESSION_EVENT);
  },
  subscribe(listener: () => void): () => void {
    Taro.eventCenter.on(SESSION_EVENT, listener);
    return () => Taro.eventCenter.off(SESSION_EVENT, listener);
  },
};
