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

## v2: 全员星图（同日追加）

> 诉求：点击部门后完整展现**所有**成员（包括小组下的）；小组成员保持与小组的连线；
> 同一人多处任职只画一个节点、拉多条连线，节点放在合适的几何位置。

聚焦场景不再只显示直属成员——焦点子树的全部成员按 userId 去重后每人恰好一个叶节点
（key 仍为 `leaf:<focusId>:<userId>`，focus 域内稳定）：

- **锚点 (anchor)**：直属于焦点节点（负责人/成员）= `star` 锚；出现在卫星 m 的子树
  任意深度 = m 锚（同一卫星内多处任职也只贡献一个锚）。isLead = 任一任职单元的负责人。
- **仅 star 锚** → phyllotaxis 成员星团（同 v1），不画线——贴近即归属；光晕只罩直属星团。
- **仅一个卫星锚** → 该卫星的**扇区 (sector fan)**：卫星环外侧的同心弧排，以卫星方位为
  中心。`FAN_BASE = moonOrbit + MOON_R + FAN_BASE_GAP(64)`，行距 `FAN_ROW_GAP = 76`；
  扇区角宽 = (2π / 卫星数) × `FAN_SECTOR_RATIO(0.82)`（0.18 的边距保证相邻扇区永不重叠）；
  每行容量 `floor(弧长 / LEAF_PITCH(72))`，由内向外填充、行内居中于卫星方位。
  发一条 卫星→成员 连线。
- **多处任职（≥2 锚）** → 只画一个节点 + 到每个锚各一条连线。方位 = 各锚位置向量和的
  方向（star 在原点贡献为零；和近零——如两颗对置卫星——回退第一个卫星方位）；半径 =
  `FAN_BASE + FAN_ROW_GAP`（中间带）；与任何已放置叶单元 < `LEAF_MIN_DIST(48)` px 时
  沿弧线两侧躲避，整圈满则外移一排重试。
- **连线输出**：`OrbitLayout.links: OrbitLink[]`，`{ key, fromKey, toKey }`；
  `fromKey = node:<moonId>`（兼任者的 star 锚为 `node:<focusId>`），
  `toKey = leaf:<focusId>:<userId>`；key 稳定为 `link:<fromKey>-><toKey>`。
- **渲染**：连线为绝对定位 1.5px 圆角细线（`bg-border/70`，origin-left + rotate），
  每帧从 key→item 映射解析两端坐标，left/top/width/transform 走同一条 400ms 曲线，
  与节点同步滑动；层级介于轨道环 (z-0) 与幽灵 (z-10) 之间。兼任叶节点加
  `ring-2 ring-border` 弱提示 + Tooltip 列出任职单元（如「内容组 · 增长组」）；
  点击扇区/兼任叶 → 打开首个锚单元的成员对话框（直属星团仍打开焦点单元）。
- **动态让位**：ghost 弧带与 coreBounds 自动计入最外扇排（sceneOuter 取
  max(星团, 卫星环, 最远叶缘)），运镜取景不裁切、幽灵永远在外。
- **空态**：子树完全无成员 → 场景同 v1；某卫星子树无成员 → 该卫星无扇区、无连线。
