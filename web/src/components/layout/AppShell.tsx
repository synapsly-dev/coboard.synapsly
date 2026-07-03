import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
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
  // Cross-fade the page region when moving between primary destinations — the one
  // deliberate motion for navigation on this persistent-shell app. Opacity only,
  // no slide/stagger, so it reads as "the app responded", not a page reload. Key
  // on the top-level segment (not the full path) so switching projects within the
  // board re-renders in place instead of remounting (which would reset filters /
  // refetch and flash a spinner).
  const { pathname } = useLocation();
  const section = pathname.split('/')[1] || 'home';
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background">
      <TopNav />
      <main className="min-h-0 flex-1 overflow-hidden">
        <div key={section} className="h-full motion-safe:animate-fade-in">
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
