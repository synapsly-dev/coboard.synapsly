# 团队架构：自助加入 + 图谱可视化重设计

Date: 2026-07-13 · Status: approved (user: 完成所有任务)

## 背景 / 现状

- **赛道 (track)**：`tracks` 表，普通用户可一键自助加入（`POST /tracks/:id/join`，`加入` pill）。
- **部门/小组/岗位**：单一 `org_nodes` 树（`kind` = department/group/position）+ `org_node_members`。
  普通用户**无法自助加入部门/小组**（无自助路由；成员写入只有管理员/负责人的整表替换
  `PUT /org/nodes/:id/members`）。岗位有 `org_applications` 申报→录用审批流。
- **加入按钮混乱**：`＋`(OrgAddNodeButton)=新增子节点(小组)；`＋人`(UserPlus)=打开整表 tri-state
  批量对话框；`加入` pill=仅赛道。三种图标三种语义。
- **星图 (galaxy, OrgPlanetCanvas)**：从子单元/兼任者到成员画**笔直 1.5px 放射连线**
  (`rotate(atan2…)`, OrgPlanetCanvas.tsx:251-274)。直属成员已用“临近成团、无连线”。
- **树状图 (tree, OrgChartCanvas)**：固定 224×112 大卡、每层一整行 → 又高又宽、无层级、难读。

## 决策（用户确认）

1. **加入方式**：部门/小组也走**审批**（复用现有 `org_applications`），非直接一键。赛道保持一键。岗位不变。
2. **交互统一**：情境化单按钮。成员见「申请加入 / 申请中 / ✓已加入(可退出)」；管理员见「＋加人」
   （搜索勾选多人、立即追加）；结构性「新增子级」收进 `⋯` 菜单。
3. **星图**：去掉笔直连线，靠临近成团表达归属；兼任者保留细环 + 悬浮提示。
4. **树状图**：改为**横向缩进大纲树**（可折叠、连接引导线、内联负责人✦+人数）。

## 后端（最小改动）

- `orgService.applyToNode`：把 `kind !== 'position'` 放宽为允许 `department/group/position`，仅拒绝 `track`
  （赛道请直接加入）。名额校验对 `headcount === null`（部门/小组=不限）天然跳过。文案中性化
  （“你已是该单元成员 / 你已有待处理的申请 / 名额已满”）。
- 新增自助退出：`orgService.leaveNode` + `POST /org/nodes/:id/leave`（`requireAuth`，删除本人 member 行；
  负责人拒绝，提示联系管理员；非成员幂等）。
- **不新增**追加成员端点：管理员「＋加人」在前端合并现有 roster 后调用既有
  `PUT /org/nodes/:id/members`（org 节点）/ `PUT /tracks/:id/members`（赛道节点）。
- 审批可见性沿用 `canDecideOnNode`：全局管理员 / 节点或祖先的 org 负责人 / 关联赛道经理。

## 前端

- `NodeMembershipAction`（由 `TrackMembershipAction` 泛化）：
  - track → 直接 加入/退出/经理徽章（现状）。
  - department/group/position → 基于 `useOrgApplications` 的申请态：申请加入→申请中(可撤回)→已加入(可退出)；
    负责人徽章；岗位名额满显示“名额已满”。
- `OrgAddPeopleDialog`：管理员「＋加人」，搜索多选，提交时合并现有 roster 调用 setMembers/setTrackMembers。
- 各视图（列表 OrgNodeRow / 星图 OrgPlanetCanvas / 大纲树 / 岗位图 OrgRoleChartCanvas）：
  渲染统一的成员按钮；管理员的「＋加人」与「新增子级(⋯)」分离。
- 星图：移除 links 渲染 pass。
- 大纲树 `OrgOutlineTree`：可折叠、连接引导线、kind 徽章、负责人✦、人数、展开显示成员、成员按钮。
- 招募视图：新增顶部「待处理的加入申请」区（部门/小组 pending，岗位仍用卡片内审批面板），
  招募 tab 增加待处理数量角标。
- 移除「岗位图」视图（2026-07-13 追加）：其把岗位画成中间层级、误导层级，且大半画布空置，并与新
  大纲树高度重复。删除 OrgRoleChartCanvas / role-layout / org-role-selectors（及随之失效的
  ExpandablePeople.PeopleHoverCard）。架构页视图精简为 图谱(星系/大纲树) · 列表 · 招募。

## 验证 & 部署

- 本地 `DEV_LOGIN` + pglite 起服务，脚本经 API 造代表性组织树（部门/小组/岗位/赛道 + 成员 + 兼任），
  以普通用户与管理员双视角截图 galaxy/tree/list/role 前后对比，跑通“申请加入→审批→已加入”闭环。
- `pnpm typecheck && pnpm test && pnpm format`。
- 提交到 main，按 deploy-hk-01 runbook 部署（先备份 DB；`git archive` → 嵌套 ssh →
  `docker compose -p coboard up -d --build`），post-deploy 检查。
