# 组织架构图谱重设计 — 设计规格

> 状态：已批准（用户允许激进修改），2026-07-11。只动 图谱 视图；列表/招募视图不变。
> 病根：现实现是 CSS ul/li 连接线树 + scrollLeft 假平移——无缩放、不能自由平移、
> 方括号连线、成员被平铺成"人叶子节点"撑爆画布。
> 参考：飞书组织架构（卡片+成员收进卡内）、Figma/Miro（真画布：滚轮缩放/拖拽平移/
> 适应视图/点阵背景）、ChartHop/Rippling（整洁树布局+圆角正交连线）。

## 1. 架构：真画布，三层分离

- **布局层 `features/org/chart/layout.ts`（纯函数+单测）**：Reingold–Tilford 风格
  tidy tree——后序遍历算子树宽，父节点居中于子树跨度；固定卡宽 W=224、卡高 H=112、
  兄弟间距 24、层间距 64、多根间距 48；输入 roots+collapsed 集合，输出
  `{nodes:[{node,x,y}], edges:[{from,to}], bounds}`（折叠子树整体剪枝）。
- **画布层 `features/org/chart/useCanvas.ts`**：`{x,y,scale}` 状态，
  `transform: translate(x,y) scale(k)`；滚轮=以光标为焦点缩放(0.25–2)、
  空白处拖拽=平移、双指捏合=触屏缩放、双击空白=适应视图；
  `fit(bounds)` 首次布局自动执行；键盘 +/− 缩放、0=适应。
- **渲染层 `OrgChartCanvas.tsx`**：内层一个绝对定位容器（尺寸=bounds+留白，
  **点阵网格背景**随变换缩放，Figma 质感）；SVG 边层在下、HTML 卡片层在上。

## 2. 连线（signature 之一）

圆角正交连线取代方括号：父底中点 → 垂直下行至中线 → 圆角(r=8)水平 → 圆角垂直
入子顶中点；stroke = border 色、1.5px、圆角 cap；单 path/子节点。暗色自动跟随 token。

## 3. 节点卡（signature 之二：成员收进卡内）

- 224px 圆角卡，**顶部 3px kind 色条**（department=primary / group=sky /
  position=violet，沿用 labels.ts 色相，新增 ORG_KIND_ACCENT map）。
- 行1：kind 徽章 +（岗位）在岗/名额 chip（满员转 slate）。
- 行2：标题（最多两行截断）。
- 行3：负责人 avatar（金冠标记）+ 名字；**普通成员改为卡内 avatar 叠放**
  （最多 5 个 + "+N"），整行可点 → onMembers。**彻底删除"人叶子节点"**——
  这是画布爆宽的元凶。
- 卡底骑缝：折叠 pill（后代数）；editable 悬停时旁出 ＋（onAddChild，
  复用 OrgAddNodeButton 的 kind 菜单）；卡右上悬停出 编辑/成员 菜单（现交互保留）。

## 4. 画布 chrome

- 右下浮动控制组（bg-card 圆角边框阴影）：− / 百分比 / ＋ / 适应视图 / 100%。
- 左下 muted 微提示「拖拽平移 · 滚轮缩放」。
- prefers-reduced-motion：拖拽/缩放不加过渡（按钮步进缩放才有 150ms 过渡）。
- 触屏：单指平移、双指缩放；`touch-action:none` 仅限画布。

## 5. 兼容与清理

- 对外 props 契约不变：`{roots, editable, onAddChild, onEdit, onMembers}`——
  OrgPage 仅换 import；列表视图(OrgNodeRow)、招募视图(RecruitView)、
  节点/成员对话框零改动。
- 删除旧 OrgChart.tsx 与 index.css 中整段 `.org-tree` CSS（死代码不留）。
- layout.ts 布局单测（居中/子树宽/折叠剪枝/边数）；全量 typecheck/test/build 绿。

## 6. 交付
push main → 部署 hk-01 → 探针验证。
