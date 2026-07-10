# P2 生产闭环深化：结构化审核 + 复核 + 个人工作台 — 设计规格

> 状态：已批准（用户授权全自主决策），2026-07-10。承接 P0/P1。
> 对应运营需求 §4.2 交付质量、§5.1 任务发布字段、§7 审核与复核、§3 个人工作台。

## 1. 任务发布字段补齐（§5.1）

`tasks` 增两个可空 text 列 + 契约字段：
- `deliverable_spec`（提交物要求：交什么——文档/链接/截图/数据表…）
- `acceptance_criteria`（验收标准：什么算完成/合格）
新建/编辑任务表单增这两个多行输入；任务详情抽屉展示（放描述之后，独立小节）。

## 2. 结构化审核（§7.2 + §4.2 交付质量）

- 新表 `task_reviews`（一等审核记录，替代"只藏在 activities.meta"）：
  `id · task_id FK(cascade) · reviewer_id FK(restrict) · stage(review_stage: first/final) ·
  decision(review_decision_db: approve/reject) · quality_grade(quality_grade: a/b/c/d, 可空) ·
  comment · created_at`。
- `tasks` 增 `quality_grade`（最新定级快照，可空）。
- 审核输入 `reviewTaskInputSchema` 增 `qualityGrade?: 'a'|'b'|'c'|'d'`。
  质量系数（1.2/1.0/0.6/0）在 UI 展示"建议点数 = 基础点数×系数"，**点数仍人工确认**
  （分配在 deliver 时锁定；本期不自动改点，符合 docx §13.5 "先人工填写并保留计算字段"）。

## 3. 两级复核（§7 高价值任务）

- 触发条件（deliver 时计算并写在任务上）：`needs_final_review boolean`
  = 任务类型 A(critical) **或** 总点数 ≥ 8。
- 流程：pending_review → 项目 lead/赛道经理 初审(stage=first) approve
  → 若 needs_final_review：任务**保持 pending_review**，进入"待复核"（first_approved_at/by 写入
  tasks；驳回则照旧回 in_progress 并清 first_approved）
  → **全局 admin（总运营）** 复核(stage=final) approve → done。
- 不需复核的任务：初审 approve 即 done（现行为不变）。
- 复核人可直接驳回（回 in_progress，清空 first_approved 与份额，照现驳回逻辑）。
- 卡片/抽屉状态徽标区分 待审阅/待复核；ReviewActions 按角色出"初审/复核"按钮。
- `tasks` 增列：`needs_final_review bool not null default false`、
  `first_approved_by uuid null`、`first_approved_at timestamptz null`。
- 撤销通过（revoke）：回 pending_review 且清 first_approved_*（重走完整审核链）。

## 4. 个人工作台（§3 层级 3）

新页面 `/workbench`（导航「工作台」，放在 看板 之后）。全部由现有/新查询组成：
- **待我审核**：新端点 `GET /me/review-queue` — pending_review 且我可审
  （项目 lead / 赛道经理 / admin；admin 另见"待复核"分组）。
- **我的进行中**：/tasks/all 客户端过滤（claimants 含我 & in_progress/open）。DDL 临近
  （<48h 黄、逾期红）徽标。
- **可认领**：open 且（未满员）且（taskType ∈ claimable/collab 或池任务）。
- **我被退回**：最近 rejected 记录（task_reviews 里 decision=reject 且我是 claimant，14 天内）。
  → 端点 `GET /me/rejected-tasks`。
- **我的点数摘要**：复用 /stats/me + 本周区间。

## 5. 异常流（§10.2 最小可用）

- **转让**：lead/赛道经理/admin 在任务上"转让"：release(旧人)+assign(新人) 原子服务方法
  `transferTask`，activity type 增 `transferred`（meta: from,to,reason?）。UI 在任务抽屉
  认领人行的管理菜单里。
- **改期**：PATCH dueDate 时可带 `dueChangeReason?`；有 reason 时 activity 记
  `due_changed`（meta: from,to,reason）。UI：编辑表单改 DDL 时出现"改期原因"输入。
- 失信记录/申诉：**推迟**（P3 后评估），在 spec 中显式 deferred。

## 6. 数据/枚举汇总

- 新 pg 枚举：`review_stage(first/final)`、`quality_grade(a/b/c/d)`、
  `review_decision_db(approve/reject)`；activityTypes 增 `transferred`、`due_changed`。
- `tasks` 新列：`deliverable_spec`、`acceptance_criteria`、`quality_grade`、
  `needs_final_review`、`first_approved_by`、`first_approved_at`。
- 新表：`task_reviews`。
- 契约：Task 增 6 字段；reviewTaskInput 增 qualityGrade；新增 TaskReview 实体 +
  reviews 列表响应；workbench 两个端点响应。

## 7. 测试重点

复核链状态机（needs_final_review 真/假 × 初审/复核 × approve/reject × revoke）、
赛道经理可初审不可复核、admin 可两者、task_reviews 记录完整、qualityGrade 落库、
transfer 权限与 activity、review-queue 端点按角色返回正确集合。

## 8. 交付
typecheck/test/build 全绿 → push main → 部署 hk-01 → 验证迁移与探针。
