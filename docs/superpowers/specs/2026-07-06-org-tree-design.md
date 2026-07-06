# 团队架构树（组织分工页）— 设计

> 2026-07-06 · 新增一个可编辑、灵活的树状结构页面，用于展示团队分工与职位。

## 1. 目标与范围

- 新增一个**全体可见**的顶部导航页面「架构」（`/org`），展示团队的分工/职位组织树。
- **作用域**：默认一棵「全团队」树，并可通过页面顶部的 scope 切换器切换到某个具体项目的树。
- 树是**灵活的**：任意深度嵌套；节点是组织单元（部门/小组/通用单元），可挂多个**负责人**与多个**成员**。
- **编辑权限**：全团队树仅全局 admin 可编辑；项目树由该项目的 lead 或全局 admin 编辑。全体成员只读查看。
- 实时：改动经 SSE 广播，其他在线用户自动刷新。

非目标（YAGNI）：不引入独立“人员”表（成员复用现有 `users`）；不做节点级细粒度权限；不做历史/审计；不做跨作用域移动节点。

## 2. 数据模型

### 2.1 `org_nodes`（组织节点，自引用树）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `project_id` | uuid → `projects` (cascade)，可空 | NULL = 全团队树；非空 = 该项目的树 |
| `parent_id` | uuid → `org_nodes` (cascade)，可空 | NULL = 根节点；级联删除保证删父即删整棵子树 |
| `kind` | enum `org_node_kind` | `'department' \| 'group' \| 'unit'`，仅决定视觉样式，可任意嵌套 |
| `title` | text notNull | 单元名称，如“工程部”“前端组” |
| `description` | text 可空 | 备注/职责说明 |
| `rank` | text notNull | 同一父下的兄弟排序键（复用 tasks 的 lexo-rank 思路） |
| `created_at` / `updated_at` | timestamptz | |

索引：`(project_id, parent_id)`（按作用域拉子节点）、`(parent_id)`。

> `project_id` 与 `parent_id` 的一致性由服务层保证：一个节点的 `project_id` 必须与其父节点相同；根节点直接携带作用域。跨作用域移动不允许。

### 2.2 `org_node_members`（节点上的负责人/成员）

| 列 | 类型 | 说明 |
|---|---|---|
| `node_id` | uuid → `org_nodes` (cascade) | |
| `user_id` | uuid → `users` (cascade) | 复用现有用户（头像、姓名） |
| `role` | enum `org_member_role` | `'lead'`（负责人）\| `'member'`（成员） |
| `rank` | text notNull | 头像展示排序 |
| pk | (`node_id`, `user_id`) | 一个人在同一节点只出现一次；改角色即改 `role` 列 |

索引：`(user_id)`（便于“某人在架构中的位置”这类反查，虽当前 UI 未用，成本极低）。

> 多负责人 = 同一 `node_id` 下多条 `role='lead'`。部门与小组一视同仁，都能挂多个负责人。

### 2.3 shared 契约

- `packages/shared/src/enums.ts`：新增 `orgNodeKinds = ['department','group','unit']`、`orgMemberRoles = ['lead','member']`。
- `packages/shared/src/schema.ts`：新增 zod 输入/输出 schema（见 §3）。
- `packages/shared/src/types.ts`：`OrgNode`、`OrgNodeMember`、`OrgTreeResponse` 等 wire 类型。

## 3. 后端 API（跟随 ideas/announcements 分层）

新增 `server/src/routes/org.ts` 与 `server/src/services/orgService.ts`，并在 `route-registry.ts` 注册。

| 方法 & 路径 | 权限 | 说明 |
|---|---|---|
| `GET /org/tree?scope=all\|<projectId>` | 任意登录用户（项目树需该项目可见性/成员或 admin） | 返回该作用域下全部节点 + 成员，前端组装成树 |
| `POST /org/nodes` | 作用域可写 | body: `{ scope, parentId?, kind, title, description? }`，追加为目标父的末位兄弟 |
| `PATCH /org/nodes/:id` | 作用域可写 | 改 `title` / `kind` / `description` |
| `POST /org/nodes/:id/move` | 作用域可写 | body: `{ parentId, beforeId? \| afterId? }` → 重设 `parent_id` + `rank`（同作用域内） |
| `DELETE /org/nodes/:id` | 作用域可写 | 级联删整棵子树（前端先确认“将一并删除 N 个子节点”） |
| `PUT /org/nodes/:id/members` | 作用域可写 | body: `{ leads: userId[], members: userId[] }`，整体覆盖该节点成员集合 |

**“作用域可写”判定（`orgService.assertCanEditScope`）**：
- `scope === 'all'`（`project_id` 为 NULL）：要求 `user.role === 'admin'`。
- `scope === <projectId>`：要求全局 admin，或该项目 `project_members.role` 为 lead（复用现有 guard 判定 lead 的逻辑）。

**读权限**：全团队树对任何登录用户可见；项目树要求项目成员或全局 admin（复用 stats/ideas 的可见性范围思路）。

**校验**：`title` 1–80 字；`description` ≤ 500 字；`kind`/`role` 属枚举；`move` 目标父必须同作用域且不能是自身或自身后代（防环）；成员集合里的 `userId` 必须存在且 `leads`/`members` 无交集。

**实时**：写操作成功后经现有 SSE `bus` 在对应频道广播一个 `org` 失效事件——全团队树走 global 频道，项目树走该 project 频道；前端收到后 `invalidateQueries(['org', scope])` 重拉。（沿用现有 bus 的发布 API，具体事件名在实现时对齐 `lib/sse.ts`。）

## 4. 前端

### 4.1 导航与路由
- `nav-items.ts` 新增 `{ to: '/org', label: '架构', icon: Network }`（全体可见）。
- `App.tsx` 新增 `<Route path="/org" element={<OrgPage />} />`。
- `web/src/api/org.ts`：封装上述端点 + React Query hooks。

### 4.2 页面结构（`web/src/pages/OrgPage.tsx` + `web/src/features/org/*`）
- 顶部：**scope 切换器**（全团队 ▾ / 各项目，复用 ProjectSwitcher 视觉）＋（有权限时）**编辑开关**。
- 主体：**可展开/收起的缩进树**。每个节点行显示：
  - `kind` 徽章（部门/小组/单元，不同色）、`title`、`description`（次要文字）。
  - **负责人**：带 👑 标记的头像 + 姓名。
  - **成员**：头像行（复用 `ClaimantAvatars`/`Avatar` 组件）。
- **编辑模式**（`useCanEditOrg(scope)` 为真时可切换）：
  - 每节点操作菜单：加子节点 / 加同级 / 编辑（名称·类型·描述，Dialog）/ 设负责人·成员（成员选择器）/ 删除（确认级联）。
  - **重排/改层级**：用已有 `@dnd-kit` 实现同级拖拽重排 + 拖到某节点上改父级；并提供 上移 / 下移 / 缩进 / 取消缩进 按钮作为可靠回退（键盘/触屏友好）。
- 空态：无节点时提示“还没有架构，点击新建根节点”（有权限者可见新建入口）。

### 4.3 纯函数（便于单测）
- `buildTree(nodes)`：扁平列表 → 树（按 `rank` 排序兄弟）。
- `sort.ts`：lexo-rank 生成/比较（若可复用 board/sort.ts 则复用）。
- `permissions.ts`：`canEditOrgScope(user, scope, membership)`。

## 5. 测试

- **server**：`server/test/org.test.ts` 跟随 `ideas.test.ts`：建/改/移/删节点、级联删、成员覆盖、权限（admin vs lead vs 普通成员 vs 越权项目）、防环 move、跨作用域 move 拒绝。
- **web**：`buildTree`、rank 排序、`canEditOrgScope` 纯函数单测（Vitest）。

## 6. 部署

1. `pnpm db:generate` 生成迁移；`pnpm typecheck && pnpm test && pnpm build` 全绿。
2. `git push origin main`。
3. `ssh -J dev hk-01` → 进入项目目录 → `git pull && docker compose up -d --build`（容器启动自动应用迁移）。
4. 打开站点验证「架构」页可见、增删改拖拽、SSE 实时、权限拦截。
