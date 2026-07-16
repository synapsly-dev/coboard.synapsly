/** Build-time API origin, e.g. TARO_APP_API_BASE=https://coboard.example.com. */
export const API_BASE = (process.env.TARO_APP_API_BASE ?? '').replace(/\/+$/, '');

if (process.env.NODE_ENV === 'production' && !API_BASE.startsWith('https://')) {
  throw new Error('生产小程序必须设置 HTTPS 的 TARO_APP_API_BASE');
}

