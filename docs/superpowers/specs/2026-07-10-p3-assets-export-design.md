# P3 复盘与资产：资产库 + 导出 + 提醒 — 设计规格

> 状态：已批准（用户授权全自主决策），2026-07-10。承接 P0-P2。
> 对应运营需求 §9 周复盘沉淀、§11 导出备份、§10.3 提醒（应用内最小可用）。

## 1. 资产库（§9：内容库/反馈库/资源库/问题清单）

- 新表 `assets`：
  `id · kind(asset_kind: content/feedback/resource/issue) · title · body(Markdown, 链接/原话/
  记录都写这里) · url(可空外链) · track_id FK(set null, 可空) · task_id FK(set null, 可空，
  溯源) · created_by FK(restrict) · created_at · updated_at`。
  索引：kind、track_id、created_at。
- 权限：任意成员可创建/编辑自己创建的；lead/赛道经理/admin 可编辑删除全部。读全员。
- API：`GET /assets?kind&trackId`（列表，倒序）、`POST /assets`、`PATCH /assets/:id`、
  `DELETE /assets/:id`。SSE 实体 `'asset'`。
- 入口 1（沉淀闭环）：任务抽屉在 done 后出现「沉淀为资产」按钮 → 预填 title=任务名、
  task_id、track（任务项目所属赛道）→ 选 kind 提交。
- 入口 2：新页面 `/assets`（导航「资产」）：kind 四个 tab + 赛道筛选 + 搜索(标题/正文
  客户端过滤) + 新建按钮。卡片显示 kind 徽标、标题、摘要、赛道、来源任务链接、作者/时间。

## 2. 导出（§11）

- `GET /export/scores.csv?from&to` — 成员分数表：成员/赛道/项目/任务/最终点数/质量等级/
  审核人/复核状态/完成时间。行 = task_claimants × done 任务（点数>0 或全部？全部 done 行）。
  + 末尾灵感采纳奖励行（来源=idea）。admin 与赛道经理（其赛道范围）可用。
- `GET /export/tasks.csv?from&to&trackId?` — 任务明细：任务全字段+状态+类型+质量+审核链
  （初审人/复核人/时间）+认领人列表。同权限。
- 实现：服务端拼 CSV（UTF-8 BOM，Excel 兼容），`content-disposition: attachment`。
  路由文件 `routes/export.ts`。无第三方依赖。
- UI：统计页顶部「导出」下拉（两项），仅 admin/赛道经理可见；直接 `window.open`。

## 3. 应用内提醒（§10.3 最小可用）

- 顶部导航「工作台」项上挂徽标数 = 待我审核数 +（我的任务中 逾期/48h 内到期数）。
  数据源：workbench 已有查询（P2 的 /me/review-queue + /tasks/all 客户端过滤），
  轻量 polling 由 SSE 失效自然驱动，不引入调度器。
- 邮件/飞书推送：显式 deferred（自部署环境无外发信道）。

## 4. 测试重点
assets CRUD + 权限矩阵 + 任务溯源；CSV 端点权限（member 403 / 赛道经理限定范围 /
admin 全量）、内容形状（表头+行数+BOM）；导出时间窗过滤。

## 5. 交付
typecheck/test/build 全绿 → push main → 部署 hk-01 → 验证迁移与探针 → 更新 README 功能清单。
