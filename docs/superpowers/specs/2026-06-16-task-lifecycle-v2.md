# Coboard — 任务生命周期 v2（多人认领 + 交付审阅 + 点数分配）

> 日期: 2026-06-16 · 在 v1 基础上重做任务领域。配合主规格 docs/superpowers/specs/2026-06-15-coboard-design.md。

## 1. 新生命周期

```
待认领 open ──认领/派发──▶ 进行中 in_progress ──交付(分配点数)──▶ 待审阅 pending_review
                                  ▲                                      │
                                  └──────────── 驳回 ◀──────────审阅─────┤
                                                                         └─通过─▶ 已完成 done
```

状态枚举 `task_status` 新增 **`pending_review`**：`open | in_progress | pending_review | done`。

## 2. 多人认领（取消单一 assignee）

任务不再有单一负责人，改为**认领者集合**。

- 新表 **`task_claimants`**：`task_id`(FK→tasks, ON DELETE CASCADE) · `user_id`(FK→users) · `points`(int, nullable，交付时写入的分配份额) · `claimed_at`(timestamptz default now)。主键 `(task_id, user_id)`。
- tasks 新增：`delivered_at`(timestamptz null) · `delivered_by`(uuid→users null) · `reviewed_by`(uuid→users null)。保留 `completed_at`（通过时写）。
- **保留**旧列 `assignee_id`、`completed_by` 但**不再使用**（标记废弃，代码一律改用 claimants；不在本次删除，降低风险）。
- 迁移数据：对每个 `assignee_id IS NOT NULL` 的任务，插入一条 `task_claimants(task_id, assignee_id, points = (status='done' ? tasks.points : null), claimed_at = tasks.created_at)`；对 `status='done'` 且 `completed_by` 与 assignee 不同的，也补一条 claimant。

## 3. 行为与权限

- **认领** `POST /tasks/:id/claim`（任意项目成员）：把自己加入 claimants；若任务为 `open` → `in_progress`。幂等。
- **释放** `POST /tasks/:id/release`（认领者本人）：把自己移出 claimants；若已无认领者 → `open`。
- **派发** `POST /tasks/:id/assign`（lead/admin）：把指定用户加入 claimants（→`in_progress`）。lead/admin 也可移除某认领者（沿用/扩展 release 逻辑）。
- **交付** `POST /tasks/:id/deliver`（认领者或 lead/admin；任务须为 `in_progress`）：
  - 请求体：`{ allocations: [{ userId, points }], totalPoints? }`，必须覆盖**当前所有认领者**。
  - 校验：若 `tasks.points` 非空，则 `sum(allocations.points)` 必须等于 `tasks.points`；若 `tasks.points` 为空，则用请求体 `totalPoints`(>=0) 作为总分，`sum` 必须等于它，并把该总分写回 `tasks.points`。points 为非负整数。
  - 只能给**当前认领者**分配；userId 不在认领者集合 → 400。
  - 成功：`status=pending_review`、`delivered_at=now`、`delivered_by=操作人`，写入各 `task_claimants.points`。记 activity `delivered`。
- **审阅** `POST /tasks/:id/review`（**仅 lead/admin**；任务须为 `pending_review`）：`{ decision: 'approve'|'reject', comment? }`。
  - `approve` → `status=done`、`completed_at=now`、`reviewed_by=操作人`。记 activity `completed`。（份额已在交付时锁定。）
  - `reject` → `status=in_progress`、清空 `delivered_at/delivered_by`、清空各 `task_claimants.points`(→null)、`reviewed_by=操作人`。记 activity `rejected`（comment 作为驳回理由，若提供）。
- 编辑字段/删除任务：沿用 v1（创建者/lead/admin）。`PATCH /tasks/:id` 仅改字段/优先级/截止/rank，**不再用于跨越 deliver/review 的状态跳转**；允许 `open↔in_progress` 的直接状态变更（看板拖拽用）。
- activity 类型新增：`delivered`、`reviewed`/`rejected`（在现有 enum 基础上补充）。

## 4. 贡献统计（改口径）

- 数据源：`task_claimants` ⋈ `tasks WHERE status='done'`。
- **每个认领者各 +1 完成数**；点数 = 该 claimant 的 `points`（null→0）。
- 时间过滤用 `tasks.completed_at`；归属稳定（份额在交付时定、通过时锁）。
- leaderboard / me / trend 全部改为按 claimants 聚合（替换原 `completed_by` 单人逻辑）。

## 5. 前端

- **看板 4 列**：待认领 / 进行中 / 待审阅 / 已完成。
- **TaskCard**：显示**多个认领者头像**（叠放，超出显示 +N）、点数徽标、优先级、截止。动作按钮：
  - `open`/`in_progress` 且我不是认领者 → 「认领」；
  - `in_progress` 且我是认领者 → 「交付」（打开点数分配弹窗）；
  - `pending_review` 且我是 lead/admin → 「审阅」（通过 / 驳回）；非 lead 显示「待审阅」状态徽标。
- **交付弹窗**：列出当前所有认领者，每人一个点数输入；默认平均分（任务点数 / 人数，余数给第一人）；任务无点数时显示「总点数」输入 + 分配；实时显示合计 vs 目标，不等时禁用提交。
- **审阅**：lead/admin 在 `pending_review` 卡片/详情页可「通过」或「驳回」（驳回可填理由）。
- **TaskDetailDrawer**：展示认领者列表 + 各自分配点数 + 当前状态 + 交付/审阅动作 + 时间线（含 delivered/reviewed/rejected）。
- **拖拽**：列内重排；`open↔in_progress` 可拖拽切换；拖入「待审阅」→ 触发交付弹窗（若我是认领者，否则回弹并提示用按钮）；拖入「已完成」→ lead/admin 触发审阅通过，否则回弹。优先用按钮驱动受控转换，拖拽体验做到不报错即可。
- **统计页**：排行榜/趋势按新口径展示（每人完成数 + 点数份额）。

## 6. 迁移与兼容注意

- 新增枚举值用 `ALTER TYPE ... ADD VALUE`（drizzle-kit 生成；PGlite 与 Postgres 均支持，迁移在容器启动时应用）。
- 迁移含数据拷贝（assignee_id → task_claimants），见 §2，需在生成的 SQL 迁移里手写该 INSERT。
- 现有测试需同步更新（任务相关测试从单 assignee 改为 claimants 语义）。

## 7. 紧随其后（下一批，本次生命周期落地后再做）

这两项依赖本生命周期 v2 的「贡献/点数」与「交付」体系，故排在其后：

### 7.1 灵感 / 想法区
- 新表 `ideas`：`task_id`(FK→tasks, 关联到某任务) · `author_id`(FK→users) · `body`(markdown) · `status`(enum `pending|adopted|rejected`) · `reward_points`(int null，采纳时写入) · `adopted_by`(uuid null) · `created_at`。
- 任意项目成员可在**任务详情页的「想法/灵感」区**对该任务发布想法；另有一个**「灵感区」页面**聚合本人可见项目的所有想法（按状态/任务筛选）。
- **采纳并奖励**：项目 lead 或全局 admin 可「采纳」一条想法并填写奖励点数 → `status=adopted`、`reward_points=N`、`adopted_by`。被采纳想法的奖励点数**计入作者的贡献点数**（贡献 = 任务完成点数份额 + 被采纳想法的奖励点数；完成数仍只来自任务）。可「驳回」。
- 统计页与 leaderboard 把 idea 奖励点数并入点数列（标注来源）。

### 7.2 任务文件上传（≤5MB，用于交付）
- 新表 `task_files`：`id` · `task_id`(FK→tasks, cascade) · `uploader_id` · `filename` · `mime` · `size_bytes`(int) · `data`(bytea) · `created_at`。
- 用 `@fastify/multipart` 流式上传，**单文件 ≤ 5MB** 服务端强校验；`GET /tasks/:id/files/:fileId` 下载（带 Content-Disposition + 鉴权）。任务详情页「附件」区可上传/下载/删除（上传者或 lead/admin 可删）。文件随库备份。
- 注意 app.ts 当前 bodyLimit=1MB：multipart 路由单独放宽到 ~6MB（仅该路由），不动全局 JSON bodyLimit。

### 7.3 仍延后
实时「逐人确认」协商（v2 用交付者提交分配）；甘特图（v2+）。
