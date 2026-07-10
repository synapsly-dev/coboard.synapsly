# P1 岗位申报（BOSS直聘式）— 设计规格

> 状态：已批准（用户授权全自主决策），2026-07-10。承接 P0（`2026-07-09-p0-tracks-design.md`）。
> 目标：把组织架构从"展示"变成"活的入编"：岗位有名额 → 成员申报 → 负责人录用 → 自动入编。

## 1. 建模

- **岗位 = org 树的新节点类型**：`orgNodeKinds` 增 `position`（岗位）。复用整棵树的
  编辑器/排序/成员/SSE 基建；部门(department)/小组(group) 下挂岗位叶子。
- `org_nodes` 增 `headcount int null`（名额；null = 不限）。仅对 kind=position 有业务意义。
- 新表 `org_applications`（申报）：
  `id · node_id FK(cascade) · user_id FK(cascade) · note(申报理由) · status(application_status:
  pending/approved/rejected/withdrawn) · decided_by FK(set null) · decision_note · created_at · decided_at`。
  部分唯一索引：`(node_id,user_id) WHERE status='pending'`（同岗位同时只能有一个待审申报）。

## 2. 规则

- **申报**：任意登录成员可对 kind=position 的节点申报（已在岗 409；已有 pending 409；
  名额已满 409）。可撤回自己的 pending（→ withdrawn）。
- **录用/驳回（审批人）**：全局 admin；项目树 → 项目 lead；全团队树 → 该节点**或任一祖先节点**
  的 org lead（负责人第一次拥有实权）。录用时复查名额（满 → 409），写入
  `org_node_members(role='member', rank 末位)`，幂等防重。
- 实时：复用 `'org'` 实体 SSE 广播（申报/决定都触发）。

## 3. API

- `POST /org/nodes/:id/applications {note?}` — 申报（201）
- `DELETE /org/applications/:id` — 撤回自己的 pending
- `GET /org/applications?scope=all|<projectId>` — 返回 `{ applications, canDecideNodeIds }`：
  自己的全部申报 + （若为审批人）可决定范围内的 pending
- `POST /org/applications/:id/approve|reject {note?}` — 决定
- org 节点 create/update 输入增 `headcount`；树响应节点增 `headcount`。

## 4. 前端

- OrgPage 增第三视图 **招募**（图谱/列表/招募）：按部门分组的岗位卡——名称、职责、
  名额 `在岗/名额`、在岗头像、我的按钮（申报/已申报·可撤回/已在岗/已满）；审批人见
  待审列表（申请人+理由 → 录用/驳回+备注）。"我的申报"区显示历史与状态。
- 节点编辑器：kind 选项加 `岗位`；kind=position 时显示名额输入。
- 树上岗位节点显示名额徽标。

## 5. 测试
申报全流程、重复 pending 409、满员 409（申报与录用两处）、录用写成员行、驳回/撤回、
审批权限矩阵（普通成员❌ / 祖先 lead✅ / 无关 lead❌ / admin✅）。

## 6. 交付
typecheck/test/build 全绿 → push main → 部署 hk-01（备份→git archive→compose -p coboard up -d --build）→
验证迁移 + 401 探针。
