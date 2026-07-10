import { NavLink, useMatch } from 'react-router-dom';
import { useReviewQueue } from '../../api/workbench';
import { useAuth } from '../../lib/auth-context';
import { cn } from '../../lib/utils';
import { buildNavItems } from './nav-items';

/**
 * Mobile bottom tab bar (§4). The primary destinations as always-visible
 * icon+label tabs — one tap, thumb-reachable, no menu to open. Shown only below
 * md; on md+ the top-nav inline links take over and this collapses to nothing.
 * Shares {@link buildNavItems} with the top nav so the two never drift.
 */
export function BottomNav(): JSX.Element {
  const { isAdmin } = useAuth();
  // The shell sits above the /board/:projectId route, so read the param from the
  // location to keep 看板 pointed at the active board.
  const projectId = useMatch('/board/:projectId')?.params.projectId;
  const boardTarget = projectId ?? 'all';
  const navItems = buildNavItems(boardTarget).filter((item) => !item.adminOnly || isAdmin);
  // 待我审核 count for the 工作台 dot (P2 §4) — same cached query as the top nav.
  const { data: reviewQueue } = useReviewQueue();
  const reviewCount = reviewQueue?.length ?? 0;

  return (
    <nav
      className="flex shrink-0 items-stretch border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-card/80 md:hidden"
      aria-label="主导航"
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.label}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium',
                // Immediate tactile press feedback on the primary phone nav — a
                // barely-there dip that confirms the tap before the route resolves.
                'transition-[color,transform,opacity] duration-base ease-standard active:scale-[0.94] active:opacity-70',
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )
            }
          >
            <span className="relative">
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              {/* Minimal amber dot: tasks await my review (P2 §4). */}
              {item.reviewBadge && reviewCount > 0 && (
                <span
                  className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-warning ring-2 ring-card"
                  aria-label={`${reviewCount} 个任务待审核`}
                />
              )}
            </span>
            <span className="max-w-full truncate">{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
