import { LayoutGrid, BarChart3, ClipboardList, Compass, Library, Lightbulb, Megaphone, Network, Settings } from 'lucide-react';

/**
 * Primary navigation destinations (§4), shared by the desktop top-nav and the
 * mobile expandable menu so the two never drift. `boardTarget` is the current
 * board project id (or the `all` sentinel) so 看板 links back to the active board.
 */
export interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
  adminOnly?: boolean;
  /**
   * Show the reminder count badge on this item (工作台): 待我审核 (P2 §4) plus my
   * overdue / due-soon tasks (P3 §3). Both navs compute the count via
   * {@link ../../features/workbench/my-tasks!useWorkbenchBadgeCount}.
   */
  reviewBadge?: boolean;
}

export function buildNavItems(boardTarget: string): NavItem[] {
  return [
    { to: `/board/${boardTarget}`, label: '看板', icon: LayoutGrid },
    { to: '/workbench', label: '工作台', icon: ClipboardList, reviewBadge: true },
    { to: '/projects', label: '项目', icon: Compass },
    { to: '/ideas', label: '灵感', icon: Lightbulb },
    { to: '/assets', label: '资产', icon: Library },
    { to: '/org', label: '架构', icon: Network },
    { to: '/info', label: '信息', icon: Megaphone },
    { to: '/stats', label: '统计', icon: BarChart3 },
    { to: '/admin', label: '管理', icon: Settings, adminOnly: true },
  ];
}
