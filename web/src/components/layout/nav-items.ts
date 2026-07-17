import {
  LayoutGrid,
  BarChart3,
  Compass,
  Lightbulb,
  LineChart,
  Megaphone,
  Network,
  Settings,
} from 'lucide-react';

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
}

export function buildNavItems(boardTarget: string): NavItem[] {
  return [
    { to: `/board/${boardTarget}`, label: '看板', icon: LayoutGrid },
    { to: '/projects', label: '项目', icon: Compass },
    { to: '/ideas', label: '灵感', icon: Lightbulb },
    { to: '/org', label: '架构', icon: Network },
    { to: '/info', label: '信息', icon: Megaphone },
    { to: '/stats', label: '统计', icon: BarChart3 },
    { to: '/competitor', label: '竞品', icon: LineChart },
    { to: '/admin', label: '管理', icon: Settings, adminOnly: true },
  ];
}
