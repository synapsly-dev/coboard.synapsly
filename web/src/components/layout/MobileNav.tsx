import { useState } from 'react';
import { NavLink, useMatch, useNavigate } from 'react-router-dom';
import { FolderKanban, LayoutGrid, Menu } from 'lucide-react';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '../ui';
import { useProjects } from '../../api/projects';
import { ALL_PROJECTS } from '../../api/tasks';
import { useAuth } from '../../lib/auth-context';
import { cn } from '../../lib/utils';
import { buildNavItems } from './nav-items';

/**
 * Mobile primary navigation (§4). A hamburger button — shown only below md —
 * opens a left-anchored sheet holding the project switcher and the primary
 * destinations. This gives phone users a discoverable menu affordance instead of
 * burying navigation inside the account/avatar dropdown (which then carries only
 * account actions). Rows are full-width with comfortable touch heights.
 */
const ROW =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm font-medium transition-colors';
const ROW_ACTIVE = 'bg-secondary text-foreground';
const ROW_IDLE = 'text-muted-foreground hover:bg-accent hover:text-accent-foreground';

export function MobileNav(): JSX.Element {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const projectId = useMatch('/board/:projectId')?.params.projectId;
  const boardTarget = projectId ?? 'all';
  const isAll = projectId === ALL_PROJECTS;
  const { data: projects } = useProjects();
  const visibleProjects = projects?.filter((p) => !p.archived) ?? [];
  const navItems = buildNavItems(boardTarget).filter((item) => !item.adminOnly || isAdmin);

  const go = (to: string): void => {
    navigate(to);
    setOpen(false);
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
          aria-label="打开菜单"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      </DrawerTrigger>
      <DrawerContent side="left" widthClassName="w-[82vw] max-w-xs">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <LayoutGrid className="h-4 w-4" aria-hidden />
            </span>
            Coboard
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="px-3 py-3">
          <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">项目</p>
          <button
            type="button"
            onClick={() => go(`/board/${ALL_PROJECTS}`)}
            className={cn(ROW, isAll ? ROW_ACTIVE : ROW_IDLE)}
          >
            <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">全部项目</span>
          </button>
          {visibleProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => go(`/board/${project.id}`)}
              className={cn(ROW, project.id === projectId ? ROW_ACTIVE : ROW_IDLE)}
            >
              <FolderKanban className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left">{project.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{project.key}</span>
            </button>
          ))}

          <div className="my-2 h-px bg-border" />

          <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">导航</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.label}
                to={item.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) => cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE)}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {item.label}
              </NavLink>
            );
          })}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
