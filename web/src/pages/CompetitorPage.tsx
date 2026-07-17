import { useState } from 'react';
import { Spinner } from '../components/ui';

/**
 * 竞品分析栏目 —— 以 iframe 同源嵌入竞品分析看板子应用(方案 A)。
 *
 * 子应用是独立的 FastAPI + 原生 JS 服务(apps/competitor-board),由
 * server 在 /apps/competitor/* 反向代理到内网 8916,并要求平台登录
 * (requireAuth)。iframe 与平台同源,平台的 session cookie 对代理路径
 * 天然生效;看板自身的视觉与 GSAP 动效在 iframe 内保持原样。
 */
export default function CompetitorPage(): JSX.Element {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="relative h-full">
      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background">
          <Spinner />
          <p className="text-sm text-muted-foreground">竞品分析看板加载中…</p>
        </div>
      )}
      <iframe
        src="/apps/competitor/"
        title="竞品分析看板"
        className="h-full w-full border-0"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
