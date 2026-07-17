import { defineConfig, type UserConfigExport } from '@tarojs/cli';

export default defineConfig<'webpack5'>(async (merge) => {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  // Taro.request needs an absolute URL. The watch build always injects the local
  // service origin; release builds still require an explicit HTTPS origin.
  const apiBase = process.env.TARO_APP_API_BASE ?? (isDevelopment ? 'http://127.0.0.1:3000' : '');
  const base: UserConfigExport<'webpack5'> = {
    projectName: 'coboard-miniapp',
    date: '2026-07-16',
    designWidth: 375,
    deviceRatio: { 375: 2, 750: 1 },
    sourceRoot: 'src',
    outputRoot: 'dist',
    framework: 'react',
    compiler: 'webpack5',
    cache: { enable: true },
    copy: {
      patterns: [
        { from: 'src/assets/tabbar', to: 'dist/assets/tabbar' },
      ],
      options: {},
    },
    env: {
      TARO_APP_API_BASE: JSON.stringify(apiBase),
    },
    mini: {
      postcss: {
        pxtransform: { enable: true, config: {} },
        url: { enable: true, config: { limit: 1024 } },
        cssModules: { enable: false, config: { namingPattern: 'module', generateScopedName: '[name]__[local]___[hash:base64:5]' } },
      },
    },
  };

  if (isDevelopment) {
    return merge({}, base, { env: { NODE_ENV: '"development"' } });
  }
  return merge({}, base, { env: { NODE_ENV: '"production"' } });
});
