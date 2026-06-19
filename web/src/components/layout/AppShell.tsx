import { type ReactNode } from 'react';
import { TopNav } from './TopNav';
import { BottomNav } from './BottomNav';

/**
 * Authenticated app shell (§4). Pinned to the viewport with `fixed inset-0` so the
 * document itself can never scroll (no stray page-level scrollbar on any device);
 * only the inner page region scrolls. Persistent top nav above the page content,
 * and on phones a bottom tab bar for primary navigation (hidden on md+, where the
 * top-nav inline links take over).
 */
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background">
      <TopNav />
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      <BottomNav />
    </div>
  );
}
