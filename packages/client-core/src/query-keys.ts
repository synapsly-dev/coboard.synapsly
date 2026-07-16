import type { RealtimeEvent } from 'shared';

export type QueryKey = readonly unknown[];

/** Canonical cache-key vocabulary shared by every Coboard client. */
export const queryKeys = {
  authConfig: () => ['auth', 'config'] as const,
  settings: () => ['settings'] as const,
  emailNotificationSettings: () => ['settings', 'email-notifications'] as const,
  me: () => ['auth', 'me'] as const,
  users: () => ['users'] as const,
  projects: () => ['projects'] as const,
  projectDirectory: () => ['projects', 'directory'] as const,
  tracks: () => ['tracks'] as const,
  trackMemberCandidates: (id: string) => ['tracks', id, 'member-candidates'] as const,
  project: (id: string) => ['projects', id] as const,
  projectMembers: (id: string) => ['projects', id, 'members'] as const,
  board: (id: string) => ['projects', id, 'tasks'] as const,
  allTasks: () => ['projects', 'all', 'tasks'] as const,
  labels: () => ['labels'] as const,
  task: (id: string) => ['tasks', id] as const,
  taskReviews: (id: string) => ['tasks', id, 'reviews'] as const,
  comments: (id: string) => ['tasks', id, 'comments'] as const,
  activities: (id: string) => ['tasks', id, 'activities'] as const,
  taskIdeas: (id: string) => ['tasks', id, 'ideas'] as const,
  taskFiles: (id: string) => ['tasks', id, 'files'] as const,
  taskTexts: (id: string) => ['tasks', id, 'texts'] as const,
  ideas: (params: Record<string, string | undefined>) => ['ideas', params] as const,
  announcements: () => ['announcements'] as const,
  orgTree: (scope: string) => ['org', scope] as const,
  orgApplications: (scope: string) => ['org', 'applications', scope] as const,
  leaderboard: (p: Record<string, string | undefined>) => ['stats', 'leaderboard', p] as const,
  myStats: (p: Record<string, string | undefined>) => ['stats', 'me', p] as const,
  trend: (p: Record<string, string | undefined>) => ['stats', 'trend', p] as const,
  trackStats: (p: Record<string, string | undefined>) => ['stats', 'tracks', p] as const,
  assets: (kind?: string, trackId?: string) => ['assets', kind ?? 'all', trackId ?? 'all'] as const,
  reviewQueue: () => ['workbench', 'review-queue'] as const,
  rejectedTasks: () => ['workbench', 'rejected-tasks'] as const,
  notificationCounts: () => ['notifications', 'counts'] as const,
  notificationPreferences: () => ['notifications', 'preferences'] as const,
  notifications: (filter: 'all' | 'unread' | 'action' = 'all') =>
    ['notifications', 'list', filter] as const,
  prefixes: {
    tasks: () => ['tasks'] as const,
    stats: () => ['stats'] as const,
    workbench: () => ['workbench'] as const,
    ideas: () => ['ideas'] as const,
    notifications: () => ['notifications'] as const,
    org: () => ['org'] as const,
    assets: () => ['assets'] as const,
  },
};

/** Maps a server realtime event to the cache families affected by it. */
export function affectedQueryKeys(event: RealtimeEvent): QueryKey[] {
  const taskId = typeof event.payload.taskId === 'string' ? event.payload.taskId : undefined;
  switch (event.entity) {
    case 'task':
      return [
        ...(event.projectId ? [queryKeys.board(event.projectId)] : []),
        queryKeys.allTasks(),
        ...(taskId
          ? [queryKeys.task(taskId), queryKeys.taskFiles(taskId), queryKeys.taskTexts(taskId)]
          : []),
        queryKeys.prefixes.stats(),
        queryKeys.prefixes.workbench(),
      ];
    case 'comment':
      return taskId ? [queryKeys.comments(taskId), queryKeys.activities(taskId)] : [];
    case 'activity':
      return taskId ? [queryKeys.activities(taskId)] : [];
    case 'project':
      return [queryKeys.projects()];
    case 'idea':
      return [
        ...(taskId ? [queryKeys.taskIdeas(taskId)] : []),
        queryKeys.prefixes.ideas(),
        queryKeys.prefixes.stats(),
      ];
    case 'announcement':
      return [queryKeys.announcements()];
    case 'org':
      return [queryKeys.prefixes.org()];
    case 'asset':
      return [queryKeys.prefixes.assets()];
    case 'track':
      return [
        queryKeys.tracks(),
        queryKeys.projects(),
        ['stats', 'tracks'],
        queryKeys.prefixes.org(),
      ];
    case 'notification':
      return [queryKeys.prefixes.notifications()];
  }
}
