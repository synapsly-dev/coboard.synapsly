# 赛道运营经理的项目管理权 — 设计规格

> 状态：已批准（方案A：本赛道内），2026-07-11。承接 P0 赛道基座。
> 诉求：非管理员的「运营经理」可管理项目。结论：不新增角色——补全 P0 已有的
> **赛道运营经理**（track_members.role='manager'），把项目的"创建"与"赛道归属"
> 两个 admin 专属能力下放到其管辖赛道内。

## 1. 权限规则（服务端为准）

- **创建项目 `POST /projects`**：
  - admin：不变（trackId 可选）。
  - 赛道经理（≥1 个 manager 行）：允许，但 `trackId` **必填**且 ∈ 其管理的赛道；
    创建者照旧自动成为项目 lead。
  - 其他成员：403（文案「需要管理员或赛道运营经理权限」）。
- **变更项目赛道 `PATCH /projects/:id` 的 trackId**（原本任何项目 lead 均可改，收紧）：
  - admin：不变。
  - 非 admin（含项目 lead、赛道经理）：**源赛道与目标赛道中每个非 null 端点都必须
    ∈ 其管理的赛道**；否则 403「只能在自己管理的赛道内调整项目归属」。
    - 推论：普通项目 lead（非经理）不能再改 trackId；经理可在自己管理的多个赛道间
      移动、可挂/摘（null↔managed）；"收编"他人未归类项目天然不可能（对该项目
      无 lead 权）。
- 赛道经理在其赛道内项目的既有 lead 等价权（审核/派发/成员/编辑/归档）不变。
- 赛道名册（PUT /tracks/:id/members）仍为 admin 专属（用户选择不加购）。

## 2. 实现

- guards.ts：新增 `listManagedTrackIds(db, userId)`（track_members role='manager'）。
- routes/projects.ts：
  - POST：requireAuth 后按上规分流（admin 走 requireAdmin 语义，经理校验 trackId 集合）。
  - PATCH：requireProjectLead 之后，若 `input.trackId !== undefined` 且非 admin，
    校验 {当前 trackId, 目标 trackId} 中非 null 端点 ⊆ 管理集合。
- 前端：ProjectsPage 对 admin/任一赛道经理显示「新建项目」（复用/镜像管理页的
  项目表单）；经理的赛道选择器只列其管理的赛道且必选，admin 全列可空。
  经理的赛道移动 UI 暂不做（服务端能力已开，后续需要再加）。

## 3. 测试

经理建项目（本赛道 201+自动 lead / 缺 trackId 400/外赛道 403）、普通成员 403、
admin 不变、经理双赛道间移动 ok、经理移往外赛道 403、普通 lead 改 trackId 403、
admin 移动不受限。

## 4. 交付
全量绿 → push main → 部署 hk-01 → 探针验证。
