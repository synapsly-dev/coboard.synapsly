import { useState } from 'react';
import { Link, NavLink, useMatch, useNavigate } from 'react-router-dom';
import { Check, LogOut, Moon, Sun, UserCog } from 'lucide-react';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui';
import { ProjectSwitcher } from './ProjectSwitcher';
import { buildNavItems } from './nav-items';
import { useReviewQueue } from '../../api/workbench';
import { useAuth } from '../../lib/auth-context';
import { useTheme } from '../../lib/theme';
import { avatarUrl, cn } from '../../lib/utils';
import { useHoverMenu } from '../../lib/use-hover-menu';
import { SynapseMark } from '../brand/SynapseMark';

/**
 * Top navigation bar (§4). Shows the logo, project switcher, and — on md+ — the
 * primary nav inline; the avatar dropdown carries account actions. On phones the
 * primary destinations live in the bottom tab bar (see BottomNav). Frontend role
 * hiding is a UX nicety; the server enforces real authorization (§6.3).
 */
export function TopNav(): JSX.Element {
  const { user, isAdmin, logout } = useAuth();
  const { resolved, toggle } = useTheme();
  const navigate = useNavigate();
  // The nav lives above the /board/:projectId route, so useParams can't see the
  // param — read it from the location. Default the 看板 link to the all view.
  const projectId = useMatch('/board/:projectId')?.params.projectId;
  const boardTarget = projectId ?? 'all';
  const userMenu = useHoverMenu();
  const [confirmLogout, setConfirmLogout] = useState(false);

  const navItems = buildNavItems(boardTarget).filter((item) => !item.adminOnly || isAdmin);
  // 待我审核 count for the 工作台 badge (P2 §4) — shares the workbench page's
  // cached query, so this costs one fetch per staleness window at most.
  const { data: reviewQueue } = useReviewQueue();
  const reviewCount = reviewQueue?.length ?? 0;

  const handleLogout = async (): Promise<void> => {
    await logout();
    // Full reload to /login guarantees a clean app boot (fresh, unauthenticated
    // state) regardless of any in-flight SPA state.
    window.location.assign('/login');
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="flex h-14 items-center gap-2 px-4 sm:gap-4 sm:px-6">
        {/* Logo */}
        <Link
          to="/"
          className="group flex items-center gap-2 transition-[opacity,transform] duration-base ease-standard active:scale-[0.98]"
          aria-label="Coboard 首页"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-transform duration-base ease-standard group-hover:-translate-y-0.5">
            <SynapseMark className="h-4 w-4" />
          </span>
          <span className="hidden text-base font-semibold tracking-tight sm:inline">Coboard</span>
        </Link>

        {/* Project switcher — visible on every size (primary navigation on phones
            lives in the bottom tab bar; see BottomNav). */}
        <div className="h-5 w-px bg-border" aria-hidden />
        <ProjectSwitcher />

        {/* Primary nav — desktop only; phones use the bottom tab bar. */}
        <nav className="ml-2 hidden items-center gap-1 md:flex" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.label}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-[background-color,color,transform] duration-base ease-standard active:scale-[0.98]',
                    isActive
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:-translate-y-0.5 hover:bg-accent hover:text-accent-foreground',
                  )
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                {item.label}
                {/* Pending-review count on 工作台 (P2 §4). */}
                {item.reviewBadge && reviewCount > 0 && (
                  <span
                    className="rounded-full bg-warning/20 px-1.5 text-[10px] font-semibold leading-4 tabular-nums text-warning-foreground"
                    aria-label={`${reviewCount} 个任务待审核`}
                  >
                    {reviewCount}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user && (
            <DropdownMenu
              open={userMenu.open}
              onOpenChange={(open) => {
                if (!open) setConfirmLogout(false);
                userMenu.onOpenChange(open);
              }}
              modal={false}
            >
              <DropdownMenuTrigger asChild {...userMenu.triggerProps}>
                <button
                  type="button"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full p-1.5 transition-[background-color,transform] duration-base ease-standard hover:-translate-y-0.5 hover:bg-accent active:scale-[0.96] focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:min-h-0 sm:min-w-0 sm:p-0.5"
                  aria-label="用户菜单"
                >
                  <Avatar
                    name={user.displayName}
                    color={user.avatarColor}
                    imageUrl={user.hasAvatar ? avatarUrl(user.id) : undefined}
                    size="sm"
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent {...userMenu.contentProps}>
                <DropdownMenuLabel className="flex max-w-[16rem] flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {user.displayName}
                  </span>
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    {user.email}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/account/profile')}>
                  <UserCog className="h-4 w-4" aria-hidden />
                  修改资料
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    // Keep the menu open so the theme flip is visible in place.
                    e.preventDefault();
                    toggle();
                  }}
                >
                  {resolved === 'dark' ? (
                    <Sun className="h-4 w-4" aria-hidden />
                  ) : (
                    <Moon className="h-4 w-4" aria-hidden />
                  )}
                  {resolved === 'dark' ? '浅色模式' : '深色模式'}
                </DropdownMenuItem>
                {confirmLogout ? (
                  <DropdownMenuItem destructive onSelect={() => void handleLogout()}>
                    <Check className="h-4 w-4" aria-hidden />
                    确认退出
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    destructive
                    onSelect={(event) => {
                      event.preventDefault();
                      setConfirmLogout(true);
                    }}
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
                    退出登录
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
