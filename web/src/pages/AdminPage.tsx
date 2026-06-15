import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { FolderKanban, Users } from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { cn } from '../lib/utils';
import { ProjectsTab, UsersTab } from '../features/admin';

/**
 * Admin console (§6.3). Two tabs — Users and Projects — for managing accounts and
 * projects/members. Access is admin-only: the router already wraps this route in
 * `RequireAdmin`, and the server enforces the real authorization on every write
 * (§6.3); the guard below is a defensive belt-and-braces redirect.
 */

type AdminTab = 'users' | 'projects';

interface TabDef {
  id: AdminTab;
  label: string;
  icon: typeof Users;
}

const tabs: readonly TabDef[] = [
  { id: 'users', label: '用户', icon: Users },
  { id: 'projects', label: '项目', icon: FolderKanban },
];

export default function AdminPage(): JSX.Element {
  const { isAdmin } = useAuth();
  const [active, setActive] = useState<AdminTab>('users');

  // Defensive client-side gate (the route is already admin-guarded).
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">后台管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">管理团队的用户账号与项目设置。</p>
        </header>

        <div
          role="tablist"
          aria-label="管理分区"
          className="mb-6 inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(tab.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {tab.label}
              </button>
            );
          })}
        </div>

        {active === 'users' ? <UsersTab /> : <ProjectsTab />}
      </div>
    </div>
  );
}
