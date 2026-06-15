import { type ReactNode } from 'react';
import { TopNav } from './TopNav';

/**
 * Authenticated app shell (§4). Persistent top navigation above a scrollable main
 * region. Feature pages render into `children` (via the router's <Outlet/>).
 */
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex h-full min-h-screen flex-col bg-background">
      <TopNav />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
