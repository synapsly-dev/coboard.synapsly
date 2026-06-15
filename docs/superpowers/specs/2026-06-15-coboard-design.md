# Coboard — 团队协作工具 · 设计规格 (v1)

> 日期: 2026-06-15 · 状态: 已确认方向，进入构建
> 代号: **Coboard** (collaboration + board)

## 1. 背景与目标

小规模初创团队（**16–50 人**，可能分多个小组/项目）需要一个**自部署**的团队协作 Web 应用。核心诉求：

- 任务**派发**（指派给人）与**认领**（成员自己领活）
- 任务**评论 / 讨论**
- **贡献统计 / 排行**（把完成情况量化展示）—— 团队特色诉求
- （v2）Todo 规划增强、**甘特图 / 时间线**

团队**不写代码**，因此交付物必须**开箱即用**：一条命令部署、备份即一个数据库、零件越少越好、附中文文档。

### 决策记录（来自 brainstorming）

| 维度 | 决策 |
|---|---|
| 部署/登录 | **自部署 + 账号登录**（数据自己掌控） |
| 团队规模 | **16–50 人**，做项目划分 + 角色权限 |
| 实时性 | **真实时**（看板即时联动） |
| 技术栈 | 团队不写代码 → 由我选「最省心维护」方案 |
| 自建 vs 现成 | **量身定制，从零构建** |
| v1 范围 | 看板(派发/认领) + 评论 + 贡献统计；**甘特图 → v2** |
| 贡献口径 | **完成任务计数为主，点数选填** |
| 技术方案 | **方案 A：精简单体**（1 app 容器 + 1 Postgres，SSE 实时） |

## 2. 架构总览

```
浏览器 (React SPA)
   │  REST(读写) + SSE(服务端实时推送)
   ▼
 app 容器 (Node + TypeScript / Fastify)
   ├─ 提供 REST API
   ├─ 通过 SSE 广播变更事件（进程内 EventEmitter 扇出）
   └─ 托管打包后的前端静态文件 (web/dist)
   │
   ▼
 Postgres (唯一持久化，单数据卷 = 唯一备份对象)
```

单实例、单进程。实时用**进程内事件总线**即可，不引入 Redis。若将来需要多实例横向扩展，再把事件总线换成 Redis pub/sub（见 §11 v2）。

## 3. 技术栈（锁定）

**前端 (`web/`)**: React 18 + TypeScript + Vite · TailwindCSS · Radix UI primitives（无障碍弹窗/下拉，shadcn 风格自建组件）· TanStack Query（数据缓存 + 乐观更新）· React Router · dnd-kit（看板拖拽）· Recharts（统计图表）· react-hook-form + zod（表单）· lucide-react（图标）· date-fns。

**后端 (`server/`)**: Node 22 + TypeScript · Fastify · @fastify/cookie · @fastify/static · @fastify/autoload（routes 目录自动加载，避免集中注册冲突）· drizzle-orm + postgres.js · drizzle-kit（迁移）· argon2（密码哈希）· zod。

**共享 (`packages/shared/`)**: zod schema + TS 类型，作为**前后端契约的唯一来源**（请求/响应/枚举）。前端表单与后端校验都引用同一份 zod schema。

**测试**: Vitest（后端 service + API 流程，用 `fastify.inject`；前端关键组件用 React Testing Library）· Playwright（核心 happy-path 端到端冒烟）。

**部署**: Docker 多阶段构建 → 单镜像；docker-compose（app + postgres:16-alpine）。

## 4. 仓库结构

```
coboard/
  package.json · pnpm-workspace.yaml · tsconfig.base.json
  .env.example · docker-compose.yml · Dockerfile · README.md(中文部署文档)
  drizzle.config.ts
  packages/shared/src/   index.ts · schema.ts(zod契约) · enums.ts · types.ts
  server/src/
    index.ts             Fastify 启动: cookie / static / autoload(routes) / SSE / 错误处理
    db/                  schema.ts(drizzle表) · index.ts(client) · migrate.ts · seed.ts
    auth/                session.ts · password.ts
    realtime/            bus.ts(EventEmitter) · sse.ts
    routes/              (@fastify/autoload 扫描) auth.ts users.ts projects.ts
                         tasks.ts comments.ts stats.ts stream.ts setup.ts
    services/            每个域的业务逻辑 (authService, taskService, statsService, ...)
    lib/                 errors.ts · guards.ts(权限) · validate.ts(zod 校验插件)
    test/
  web/src/
    main.tsx · App.tsx(router + providers)
    api/                 client.ts(typed fetch) · hooks(TanStack Query: useTasks 等)
    lib/                 auth-context.tsx · sse.ts(EventSource→失效查询) · utils.ts
    components/ui/        Button Dialog Drawer Avatar Badge Select Input ... (Radix+Tailwind)
    components/layout/    AppShell · TopNav · ProjectSwitcher
    pages/               Setup · Login · BoardPage · StatsPage · AdminPage
    features/board/       Column · TaskCard · CreateTaskDialog · ClaimButton · dnd
    features/task/        TaskDetailDrawer · CommentList · CommentComposer · ActivityTimeline
    features/stats/       Leaderboard · ContributionChart · StatFilters
```

## 5. 数据模型 (Drizzle / Postgres)

所有表带 `id`(uuid, 默认 gen_random_uuid)、`created_at`、`updated_at`(适用处)。

- **users**: `email`(uniq) · `password_hash` · `display_name` · `avatar_color` · `role`(enum `admin|member`) · `is_active`(bool) · `created_at`
- **sessions**: `id`(随机 token) · `user_id`→users · `created_at` · `expires_at` · `last_seen_at`
- **projects**: `name` · `key`(短标识, uniq) · `description` · `archived`(bool) · `created_by`→users · `created_at`
- **project_members**: `project_id`→projects · `user_id`→users · `role`(enum `lead|member`) · (project_id, user_id) 唯一
- **tasks**: `project_id`→projects · `title` · `description`(markdown 文本) · `status`(enum `open|in_progress|done`) · `assignee_id`→users(nullable) · `points`(int, nullable) · `priority`(enum `low|medium|high|urgent`, 默认 medium) · `due_date`(date, nullable) · `created_by`→users · `rank`(text, 分数排序键, 用于列内排序) · `completed_at`(timestamptz, nullable) · `completed_by`→users(nullable, 锁定贡献归属) · `created_at`
- **comments**: `task_id`→tasks · `author_id`→users · `body`(markdown) · `mentions`(uuid[]) · `created_at` · `edited_at`(nullable)
- **activities**: `task_id`→tasks · `project_id`→projects · `actor_id`→users · `type`(enum: `created|claimed|assigned|unassigned|released|status_changed|completed|reopened|commented|updated`) · `meta`(jsonb, 如 from/to 状态) · `created_at`

索引: tasks(project_id, status)、tasks(assignee_id)、tasks(completed_at)、comments(task_id)、activities(task_id, created_at)、activities(project_id, created_at)、project_members(user_id)。

**贡献统计不建表**，直接查 tasks：`status='done'` 按 `completed_by` 聚合，时间过滤用 `completed_at`，可选项数用 `points`。

## 6. 关键行为与规则

### 6.1 任务列（看板）
固定三列：**待认领 `open`** → **进行中 `in_progress`** → **已完成 `done`**。
- 新建任务默认进 `open`（无负责人）。建任务时可直接指派负责人 → 进 `in_progress`。
- 拖拽改列即改 `status`；列内拖拽改 `rank`。

### 6.2 派发 vs 认领
- **认领**: `open` 且无负责人的任务，任意项目成员点「认领」→ `assignee=自己`、`status=in_progress`，记 `activity(claimed)`。
- **派发(指派)**: 项目 lead / 全局 admin 直接设 `assignee` → 若仍为 open 则转 `in_progress`，记 `assigned`。
- **释放**: 负责人本人或 lead 可「释放」→ `assignee=null`、`status=open`，记 `released`。
- **完成**: 移到 `done` → 写 `completed_at=now`、`completed_by=当前 assignee（无则操作人）`，记 `completed`。**重新打开** → 清空 `completed_at/completed_by`，记 `reopened`。

### 6.3 角色与权限
- **全局 admin**: 管理用户（建号/改角色/停用）、建/删/归档项目、所有项目完全权限。
- **项目 lead**: 管理本项目（成员、设置）、派发任务、编辑/删除本项目任意任务。
- **项目 member**: 建任务、认领、评论、编辑自己创建或负责的任务。
- 同项目所有成员可**查看**全部任务并评论。非成员看不到该项目。

权限在后端 `lib/guards.ts` 统一校验（每个写操作都过守卫），前端按角色隐藏不可用操作（但不作为安全边界）。

### 6.4 贡献统计
- **指标**: 完成任务**数**（主）+ **点数和**（`points` 选填，缺省按 0 计入点数、按 1 计入计数）。
- **维度**: 按用户聚合；可过滤**项目**（全部/单个）与**时间范围**（本周 / 本月 / 全部 / 自定义起止）。
- **视图**: 排行榜（默认按完成数排序，可切换按点数）；个人趋势图（按天/周完成数，Recharts）。
- **归属**: 用 `completed_by` + `completed_at` 计算，归属稳定（完成后再改 assignee 不影响历史）。
- 实时计算，无需预聚合（数据量级毫无压力）。

### 6.5 实时 (SSE)
- 端点 `GET /api/stream`：用 Cookie 鉴权，订阅**当前用户所属项目**的事件。
- 任意写操作成功后，service 向 `realtime/bus.ts` 发布 `{type, projectId, entity, payload}`；SSE 连接按其项目成员资格过滤后下发。
- 前端 `lib/sse.ts` 用 `EventSource`，收到事件 → 让对应 TanStack Query 失效/重取（看板、评论、统计）。本人操作走**乐观更新**，他人变更由 SSE 触发刷新。
- 心跳注释每 25s 防代理断连；断线 `EventSource` 自动重连。

## 7. API 契约（REST，前缀 `/api`）

请求/响应体均由 `packages/shared` 的 zod schema 定义并校验。鉴权：除 `setup`/`login` 外都要登录态 Cookie。

- **首启/认证**: `GET /setup/status` · `POST /setup`(无用户时创建首个 admin) · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me`
- **用户(admin)**: `GET /users` · `POST /users`(建号,初始密码) · `PATCH /users/:id`(改名/角色/停用) · `POST /auth/password`(本人改密)
- **项目**: `GET /projects`(我可见的) · `POST /projects`(admin) · `PATCH /projects/:id` · `GET /projects/:id/members` · `POST /projects/:id/members` · `DELETE /projects/:id/members/:userId`
- **任务**: `GET /projects/:id/tasks`(看板数据) · `POST /projects/:id/tasks` · `GET /tasks/:id` · `PATCH /tasks/:id`(改字段/状态/rank) · `POST /tasks/:id/claim` · `POST /tasks/:id/release` · `POST /tasks/:id/assign` · `DELETE /tasks/:id`
- **评论**: `GET /tasks/:id/comments` · `POST /tasks/:id/comments` · `PATCH /comments/:id` · `DELETE /comments/:id` · `GET /tasks/:id/activities`
- **统计**: `GET /stats/leaderboard?projectId&from&to&sort=count|points` · `GET /stats/me?from&to` · `GET /stats/trend?userId&from&to`
- **实时**: `GET /stream`(SSE)

错误统一格式 `{ error: { code, message, fields? } }`；HTTP 状态码语义化（400 校验 / 401 未登录 / 403 越权 / 404 / 409 冲突如重复认领）。

## 8. 认证与安全

- 密码 **argon2id** 哈希。登录态 = 服务端 `sessions` 表 + **httpOnly + SameSite=Lax + (生产)Secure 的签名 Cookie**（仅存 session token，JS 不可读）。登出删 session。
- **首启引导**: 无任何用户时，前端 `/setup` 页创建第一个 admin；之后 admin 在后台建成员账号（邮箱 + 初始密码，成员可改密）。v1 无开放注册、无邀请链接（v2）。
- CSRF: 写操作用 SameSite=Lax Cookie + 自定义头校验（`X-Requested-With`）。基本输入校验全走 zod。评论 markdown 渲染做 XSS 净化（前端用安全渲染器/sanitize）。
- 速率限制登录接口（防爆破）。Cookie/会话密钥来自环境变量 `SESSION_SECRET`。

## 9. 部署（交付重点：开箱即用）

- **Dockerfile** 多阶段: ① 安装依赖、构建 shared、`vite build`(web/dist)、`tsc`(server/dist)；② `node:22-alpine` 仅装生产依赖，拷贝 dist。容器启动先跑 `drizzle migrate` 再起服务；服务用 `@fastify/static` 托管 `web/dist`，SPA 路由回退 index.html。
- **docker-compose.yml**: 服务 `app`（端口映射、依赖 db、读 .env）与 `db`（postgres:16-alpine、命名卷 `coboard-db`、healthcheck）。
- **.env.example**: `DATABASE_URL` · `SESSION_SECRET` · `PORT` · `NODE_ENV` · `PUBLIC_URL`。
- **README.md（中文）**: 三步部署（拷贝 .env → `docker compose up -d` → 浏览器打开做 setup）、备份/恢复（`pg_dump`/`pg_restore` 单库）、升级（拉新镜像 + 自动迁移）、可选 Caddy 反代上 HTTPS 示例、常见问题。
- 可选 `seed.ts`: 生成演示项目 + 样例任务，便于首次体验（通过开关）。

## 10. 错误处理与测试

- **后端**: Fastify 全局错误处理器统一输出错误格式；zod 校验失败 → 400 带字段；守卫越权 → 403；未捕获异常记日志不泄漏内部。service 层抛领域错误。
- **测试聚焦特色逻辑**: 
  - 后端(Vitest + `fastify.inject`)：认证/会话、**认领竞争**（两人同时认领→一人成功一人 409）、权限守卫矩阵、**贡献统计聚合**（计数/点数/时间范围/归属稳定性）。
  - 前端(Vitest + RTL)：看板卡片/认领按钮、统计排行榜渲染。
  - E2E(Playwright)：核心链路 setup→登录→建任务→认领→完成→统计出现。
- CI 友好：`pnpm typecheck`、`pnpm test`、`pnpm build` 均可一键跑通（v1 的「完成」定义）。

## 11. v2 路线（明确不在 v1）

甘特图/时间线视图 · Todo 规划增强（个人「我的任务」跨项目已在 v1 作为筛选视图；结构化里程碑/迭代留 v2）· 标签/Tag · 附件 · 邀请链接 + 邮件/站内通知 · 自定义列/工作流 · 更多贡献维度（准时率、协作活跃度）· Webhook/集成 · 多实例扩展（Redis pub/sub）· 审计日志。

## 12. i18n
v1 界面**中文**。文案集中管理（`web/src/lib/i18n.ts` 简单字典），结构上为将来加英文留口，但 v1 只发中文。
