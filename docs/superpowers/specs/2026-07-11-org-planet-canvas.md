# 组织架构「星系画布」— 设计规格

> 状态：已批准，2026-07-11。承接同日 org-chart-redesign（真画布基建复用）。
> 诉求：画布行星化——首屏只见部门；点击聚焦，其他内容被挤开；成员成为叶节点。

## 1. 交互模型：焦点路径 (focus path)

状态 = `focusPath: string[]`（节点 id 链）。三种画面由同一布局函数推导，
焦点变化时所有节点用 CSS transform 过渡滑到新位置——"挤开"即两次布局间的动画。

- **总览 `[]`**：中心「团队」核心（恒星）；**根节点（部门）作为行星**均匀分布在
  轨道环上（-90° 起顺时针）；行星半径按团队规模缩放；只显示部门——不渲染任何下级。
- **聚焦 `[dept]`**：该部门滑至中心成为局部恒星；**其下级单元（小组/岗位）作为
  卫星**上到内轨道环；**该节点的直属成员作为叶节点**（头像圆点+名字）排在外轨道；
  其余部门收缩成**幽灵行星**（小、半透明、可点击横向切换焦点）被挤到远端弧带；
  左上出现面包屑（团队 / 部门），中心上方浮「返回」语义。
- **递归 `[dept, group, …]`**：同构下钻——每一级祖先的兄弟都压缩成幽灵弧带，
  当前焦点的子单元为卫星、直属成员为叶节点。岗位卫星带 在岗/名额 chip。

返回：Esc / 点击面包屑 / 双击空白 = 上一级；点击幽灵行星 = 平级切换。

## 2. 布局（纯函数 + 单测）`chart/orbit-layout.ts`

`orbitLayout(roots, focusPath): { items: OrbitItem[], bounds }`
`OrbitItem = { key, kind: 'core'|'planet'|'moon'|'leaf'|'ghost'|'ring', x, y, r, node?, member?, depth }`

几何常量（可调）：核心 r=56；总览行星 r=clamp(30+人数×1.5, 30, 52)、轨道
R=220+行星数×6；聚焦态：焦点行星 r=64、卫星轨道 R=190（卫星 r=34）、
成员叶轨道 R=320（叶 r=18，>24 人时分双环）、幽灵弧带 R=520（r=14，
弧心指向原方位保持空间记忆）。轨道环本身作为 `ring` item 输出（渲染虚线圆）。
角度均分、偶数抖动避免标签重叠；bounds 含全部 items + 留白。

## 3. 视觉（signature：星轨 + 行星辉光）

- 复用 useCanvas（滚轮缩放/拖拽平移/双指），**焦点切换时 fitTo(bounds) 动画运镜**。
- 轨道环：1px dashed border/40 圆；背景保留点阵（弱化到 /40）。
- 行星/卫星：圆形节点，kind 色相填充 10% + 边 + **同色 box-shadow 辉光**
  （聚焦态更亮）；圆内：标题（截断）+ 人数；岗位卫星加 X/Y 名额徽标（满员 slate）。
- 成员叶节点：Avatar 圆 + 下方 11px 名字；负责人金环+皇冠。点击叶/成员区 →
  onMembers(所属单元)。
- 幽灵行星：灰阶 60% 透明，仅标题首两字 + 人数，hover 恢复彩色。
- 动画：transform/opacity 400ms cubic 过渡（motion-safe 门控）；进出场 fade+scale。
- 编辑（保留全部现有动作）：聚焦单元 hover 出 编辑/成员/＋新增子级
  （复用 OrgAddNodeButton 与两个对话框回调）；总览行星 hover 仅出 ⋯ 菜单。

## 4. 模式与兼容

- 图谱默认 = **星系模式**；画布右下控制组加一枚模式切换（Orbit/TreeDeciduous 图标）
  可回「树形」（刚建的 tidy-tree 画布保留为备选，共享 useCanvas 与数据）。
- 对外契约仍是 `{roots, editable, onAddChild, onEdit, onMembers}`；OrgPage 仅把
  OrgChartCanvas 换成带模式态的包装（或在 OrgChartCanvas 内部并列两种渲染层）。
- 列表/招募视图零改动。orbit-layout 单测：总览只出根、聚焦态项分类正确、
  幽灵保方位、双环分流、bounds 覆盖。

## 5. 交付
全量绿 → push main → 部署 hk-01 → 探针验证。
