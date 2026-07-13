import { type ReactNode } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from './lib/query';
import { AuthProvider, useAuth } from './lib/auth-context';
import { RealtimeListener } from './lib/sse';
import { AppShell } from './components/layout/AppShell';
import { ConfirmProvider, TooltipProvider } from './components/ui';
import { FullPageSpinner } from './components/ui/Spinner';

import LoginPage from './pages/Login';
import JoinPage from './pages/Join';
import BoardPage from './pages/BoardPage';
import WorkbenchPage from './pages/WorkbenchPage';
import ProjectsPage from './pages/ProjectsPage';
import IdeasPage from './pages/IdeasPage';
import AssetsPage from './pages/AssetsPage';
import OrgPage from './pages/OrgPage';
import AnnouncementsPage from './pages/AnnouncementsPage';
import StatsPage from './pages/StatsPage';
import AdminPage from './pages/AdminPage';
import AccountProfilePage from './pages/AccountProfile';

/**
 * App root (§4). Wires providers (Query → Auth → Tooltip), mounts the realtime
 * listener for authenticated sessions, and defines the route table with guards
 * (§8): unauthenticated → /login; first-run (no users) → /setup; /admin requires
 * a global admin.
 */

/**
 * Gate for authenticated areas. While the session query is loading, render a
 * spinner. Unauthenticated users are sent to /login (which drives Synapsly SSO),
 * preserving where they were headed so login can return them there.
 */
function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <FullPageSpinner />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

/** Admin-only gate (§6.3). Assumes it is nested inside RequireAuth. */
function RequireAdmin({ children }: { children: ReactNode }): JSX.Element {
  const { isAdmin } = useAuth();
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

/**
 * Public route gate — redirects already-authenticated users away from /login and
 * /setup back into the app.
 */
function PublicOnly({ children }: { children: ReactNode }): JSX.Element {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return <FullPageSpinner />;
  }
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

/** Index route: the board defaults to the All-Projects view (§8). */
function HomeRedirect(): JSX.Element {
  return <Navigate to="/board/all" replace />;
}

function AuthedRoutes(): JSX.Element {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/board/:projectId" element={<BoardPage />} />
        {/* 个人工作台 (P2 §4): review queue + my work + claimable + weekly points. */}
        <Route path="/workbench" element={<WorkbenchPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/ideas" element={<IdeasPage />} />
        {/* 资产库 (P3 §1): 内容库/反馈库/资源库/问题清单. */}
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/org" element={<OrgPage />} />
        <Route path="/info" element={<AnnouncementsPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
        {/* Account self-service (avatar / name / password) lives under the shell. */}
        {/* Old bookmark: 修改密码 now lives inside the profile page. */}
        <Route
          path="/account/password"
          element={<Navigate to="/account/profile" replace />}
        />
        <Route path="/account/profile" element={<AccountProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      {/* First-time SSO join (has a pending-join cookie, not a session yet). */}
      <Route
        path="/join"
        element={
          <PublicOnly>
            <JoinPage />
          </PublicOnly>
        }
      />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <RealtimeListener />
            <AuthedRoutes />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <ConfirmProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </ConfirmProvider>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
