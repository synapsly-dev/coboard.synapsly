# 竞品分析看板

输入 站点 + 我司 ASIN + 最多 3 个竞品 ASIN,自动完成数据拉取(LinkFox Agent →
卖家精灵/亚马逊前台)、LLM 分析(标题五点 Rufus/Alexa 视角、VOC 聚类、跨产品综合)、
并组装为前端看板。唯一对齐基准见 `CONTRACT.md`。

## 架构

```
frontend/  单页看板(原生 JS,由 FastAPI 静态托管)
backend/
  config.py          .env 手写解析(不覆盖已存在的进程环境变量)
  linkfox_client.py  LinkFox 提交/轮询(裸 JWT 鉴权,轮询 5s,超时 600s)
  datasources.py     三类工具任务文本构造 + 真实返回结构解析 → 规范化
  llm.py             OpenAI 兼容 chat(urllib),JSON 模式,围栏容错,重试 2 次
  analysis.py        LLM 分析 prompts(中文)+ 严格 JSON 解析 + VOC 证据原文校验
  pipeline.py        编排:并行拉取(线程)→ LLM → 组装 dashboard.json;进度写 status.json
  store.py           data/ 持久化(runs + cache),原子写 JSON
  app.py             FastAPI 路由 + CORS + 静态托管
data/
  cache/             原始工具结果缓存: {tool}_{market}_{asinsKey}.json
  runs/<runId>/      status.json + dashboard.json + raw/*.json
```

## 启动

```powershell
powershell -File run.ps1
# 浏览器打开 http://127.0.0.1:8916/
```

run.ps1 会自动补 PATH(Machine+User)、设 `PYTHONUTF8=1`、缺依赖时执行
`pip install -r requirements.txt`(仅 fastapi + uvicorn;HTTP 全部走标准库 urllib)。
`.env` 位于项目根目录(含真实密钥,勿覆盖、勿提交),由 `backend/config.py` 启动时解析。

## API(契约 §7)

| 方法+路径 | 说明 |
|---|---|
| `GET /` | 静态看板(frontend/) |
| `POST /api/runs` | 发起分析:`{"market":"US","myAsin":"B0..","competitorAsins":["B0.."],"reviewsPerStar":20,"useCache":true}` → `{"runId":"..."}` |
| `GET /api/runs` | 运行列表(倒序) |
| `GET /api/runs/{runId}/status` | 进度/阶段/日志 |
| `GET /api/runs/{runId}/dashboard` | Dashboard JSON(未完成时 404 `{"detail":"not ready"}`) |
| `POST /api/runs/{runId}/rebuild` | 用已缓存原始数据重跑 LLM+组装(不花 LinkFox 积分) |

## 数据源与费用注意

- **LinkFox Agent 按任务计费,积分昂贵**:`useCache=true`(默认)时相同
  工具+站点+ASIN 组合直接复用 `data/cache/`,不重复提交任务;
  只想换 LLM 分析结论时请用 `rebuild`,完全不消耗 LinkFox 积分。
- 三类任务:`@卖家精灵-查竞品`(批量 4 ASIN)、`@亚马逊前端-商品详情`(批量)、
  `@亚马逊-商品评论`(单 ASIN 一个任务)。
- LLM 供应商由 `.env` 决定(当前:DMXAPI 中转 gpt-5.5,OpenAI 兼容;为推理模型,
  llm.py 已按 reasoning_tokens 预留 max_tokens 余量并在正文被挤掉时自动加倍重试)。
- 诚实原则:任何拿不到的数据置 null/unavailable 并写明原因(如详情接口未返回
  relatedProducts/视频 URL/Coupon 字段);VOC 证据经程序校验必须是评论原文连续摘录,
  非原文子串的证据会被剔除,绝不编造。
