# P0 概念基座：赛道（Track）层 — 设计规格

> 状态：已批准，待实现。日期：2026-07-09。
> 背景：运营侧《Coboard 运营协同需求说明》要 Coboard 从"组织架构展示工具"承接"运营协同机制"。
> 总体路线图（分阶段各自 push main + 部署 hk-01）：
> **P0 赛道基座 → P1 岗位申报（BOSS直聘式）→ P2 生产闭环深化（交付质量/多级审核/点数公式/异常流/个人工作台）→ P3 复盘与资产（内容/反馈/资源库、导出、提醒）。**
> 本文件只覆盖 **P0**。

## 1. 目标与范围

P0 把"赛道 / 项目(小组) / 任务"这套重叠的分组概念**归一**，作为后续所有阶段的地基。

**统一层级模型：`赛道(track) → 项目/小组(project) → 任务(task)`。**
- **赛道**：升学 / 求职 / 企业服务 / AI Agent 等顶层运营单元；每个赛道有一位或多位**赛道运营经理**、一个"本周目标/最低 KPI"文本。
- **项目/小组**：赛道下的执行单元（沿用现有 `projects`），负责人 = 小组负责人。
- **任务**：沿用现有任务池 + 生命周期（open→in_progress→pending_review→done）。

### 在 P0（In scope）
1. 新增 `tracks`、`track_members` 两张表；`projects` 增 `track_id`；`tasks` 增 `task_type`。
2. **赛道运营经理**（track manager）新角色：对本赛道下所有项目拥有"项目负责人等价"权限。
3. **任务类型 A/B/C/D**（关键/底线/认领/协作）：任务卡醒目标签 + 新建/编辑选择器 + 看板筛选。
4. 界面：项目页按赛道分组；管理页赛道 CRUD + 指派赛道经理；统计页加"按赛道"维度。
5. 迁移安全：新字段全部可空；种子一条"未归类"赛道承接存量项目。

### 不在 P0（Deferred，避免膨胀）
- 岗位作为一等实体 + 申报制 → **P1**
- 交付质量 A/B/C/D、差异化/DDL/结果奖励、多级审核（初审→确认→复核）、点数公式、异常流（延期/转让/失信/申诉）、个人工作台 → **P2**
- 内容库/反馈库/资源库/问题清单/下周任务池、周报导出、提醒 → **P3**
- 总运营经理 vs 技术管理员 角色拆分 → 留到 P2 复核需要时再拆（P0 暂共用全局 admin）

## 2. 数据模型（`server/src/db/schema.ts` + `packages/shared`）

### 新增枚举（`packages/shared/src/enums.ts`）
```ts
// 赛道成员角色：manager = 赛道运营经理，member = 赛道普通成员
export const trackMemberRoles = ['manager', 'member'] as const;

// 任务类型（§4.1）。值为英文语义标识，UI 展示 A/B/C/D + 中文名。
//   critical  = A 类·关键任务   baseline = B 类·底线任务
//   claimable = C 类·认领任务   collab   = D 类·协作任务
export const taskTypes = ['critical', 'baseline', 'claimable', 'collab'] as const;
```

### 新表 `tracks`
| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | |
| name | text notnull | 赛道名（升学/求职/…）|
| key | text unique | 短标识 slug |
| description | text | |
| weekly_goal | text | 本周目标/最低 KPI（P0 先存自由文本，§3 赛道层）|
| archived | bool default false | |
| rank | text notnull | 兄弟排序键（同 tasks.rank/org_nodes.rank）|
| created_by | uuid → users(restrict) | |
| created_at | ts | |

唯一索引 `tracks_key_uniq`。

### 新表 `track_members`
| 列 | 类型 | 说明 |
|---|---|---|
| track_id | uuid → tracks(cascade) | |
| user_id | uuid → users(cascade) | |
| role | track_member_role notnull | manager / member |
| created_at | ts | |

PK `(track_id, user_id)`；索引 `track_members_user_id_idx`。

### 改 `projects`
- 增 `track_id uuid null → tracks(set null)`；索引 `projects_track_id_idx`。
- 语义：一个项目(=小组)归属一个赛道；null = 尚未归入赛道（存量项目迁移后指向"未归类"种子赛道，见 §5）。

### 改 `tasks`
- 增 `task_type task_type null`（枚举 `critical|baseline|claimable|collab`）。null = 未分类。
- 任务的"赛道"= 其项目的 `track_id`（不在 tasks 上冗余）。任务池(无项目)任务无赛道。

迁移由 `pnpm db:generate` 生成 `0017_*.sql`；容器启动时自动 apply（无需手工迁移）。

## 3. 权限（`server/src/lib/guards.ts` + `services`）

新增中间层 **赛道运营经理**。核心改动集中在 `requireProjectMember`：

- 现有逻辑：全局 admin → 对每个项目 lead 等价。
- **新增**：若 caller 是"该项目所属赛道(`project.track_id`)的 manager(`track_members.role='manager'`)"，同样解析为 `projectRole='lead'`（`isMemberRow=false`）。
- 于是所有基于 `requireProjectLead` / `ProjectMembership.projectRole==='lead'` 的动作（发布/派发/审核/管理成员）对赛道经理自动放行，无需逐处改。
- 任务池(无项目)任务的 review 仍是全局 admin（`canReviewNoProjectTask`）——赛道经理不跨赛道管池子任务。

**赛道本身的管理**（建/删/改赛道、指派赛道经理）= 全局 admin（`requireAdmin`）。

`ProjectMembership` 增加可选字段 `viaTrackManager: boolean`（便于前端/审计区分来源；非必须但保留）。

## 4. 服务与路由

### 新增 `trackService`（`server/src/services/trackService.ts`）
- `listTracks()` → 赛道 + 项目数 + 经理列表 + weeklyGoal（供项目页分组、总览）。
- `createTrack` / `updateTrack` / `archiveTrack` / `deleteTrack`（admin）。
- `setTrackManagers(trackId, userIds)` / `setTrackMembers` — 写 `track_members`。
- `isTrackManager(db, userId, trackId)` — 供 guards 复用。
- 每次写入走 `activityService.publishChange`（复用现有实时/审计 seam），实体名 `'track'`。

### 新增路由 `server/src/routes/tracks.ts`，在 `route-registry.ts` 注册
- `GET /api/tracks`（任意登录用户可读，用于分组展示）
- `POST /api/tracks`、`PATCH /api/tracks/:id`、`DELETE /api/tracks/:id`（admin）
- `PUT /api/tracks/:id/managers`、`PUT /api/tracks/:id/members`（admin）

### 改现有服务/路由
- `projectService`：create/update 支持 `trackId`；list 返回 `trackId`。
- `taskService`：create/update 支持 `taskType`；board 查询把 `taskType` 带出。
- `statsService`：新增"按赛道"聚合（对 done 任务的点数按 `project.track_id` 分组；池任务归"无赛道"）。
- 共享契约 `packages/shared/src/schema.ts`/`types.ts`：Track / TrackMember 的 zod schema 与 wire 类型；Project、Task 的 schema 增 `trackId` / `taskType`。

## 5. 迁移与向后兼容
- 所有新列可空；不动存量数据的读路径。
- 迁移末尾/或首启 seed（`server/src/db/seed.ts`）：若存在项目但无任何赛道，则建一条 `未归类`（key `uncategorized`）赛道，并把 `track_id IS NULL` 的项目指向它。**幂等**：已存在则跳过。
- `task_type` 存量任务保持 null，UI 显示"未分类"。

## 6. 前端（`web/src`）
- `api/tracks.ts` 新增；`api/projects.ts`、`api/tasks.ts` 增字段。
- **项目页 `ProjectsPage`**：按赛道分组；每赛道头部显示 名称 / 本周目标 / 经理头像 / 项目数；未归类单独一组。
- **管理页 `AdminPage`**：赛道 CRUD 面板 + 指派赛道经理（复用现有用户选择模式）。
- **看板**：`TaskCard` 显示 A/B/C/D 类型徽标（醒目配色，参考现有 `Badge`/`LabelChip`）；`CreateTaskDialog`/编辑增 `任务类型` 选择器；`Board` 顶部增赛道筛选（可选，随分组数据）。
- **统计页 `StatsPage`**：增"按赛道"维度切换。
- 实时：`tracks` 变更经 SSE(`'track'` 实体) 触发相应 query 失效（复用现有 `sse.ts` 模式）。

## 7. 测试
- 服务端（`server/test/`）：
  - `tracks.test.ts`：CRUD、成员/经理设置、权限（非 admin 不能建赛道；赛道经理能管本赛道项目、不能管他赛道）。
  - 迁移/种子：存量项目迁入"未归类"赛道、幂等。
  - `tasks.test.ts` 扩展：`task_type` 读写、board 带出。
  - `guards`/`projects.test.ts` 扩展：赛道经理 = 项目 lead 等价。
- 前端（`web/src`）：任务类型徽标渲染、项目页赛道分组冒烟。
- 全量：`pnpm typecheck && pnpm test && pnpm build` 必须绿。

## 8. 验收 & 部署
- 验收：`pnpm -r test` + `build` 通过；本地起服务能建赛道、把项目归入赛道、赛道经理可审核本赛道任务、任务卡出现 A/B/C/D 徽标。
- 部署（见 memory `deploy-hk-01`）：commit→push main→备份远端库→`git archive HEAD | ssh dev "ssh hk-01 'tar -xf - -C /root/coboard.synapsly'"`→`docker compose -p coboard up -d --build`→查 `docker logs coboard-app-1` 见"Coboard 已启动"、`/api/tracks` 未登录返回 401。
