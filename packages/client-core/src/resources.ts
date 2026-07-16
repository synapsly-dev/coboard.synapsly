import type {
  ActivitiesResponse,
  AddProjectMemberInput,
  AdoptIdeaInput,
  AnnouncementResponse,
  AnnouncementsResponse,
  AssetResponse,
  AssetsQuery,
  AssetsResponse,
  AuthConfigResponse,
  AuthUserResponse,
  CommentsResponse,
  CreateAnnouncementInput,
  CreateAssetInput,
  CreateCommentInput,
  CreateIdeaInput,
  CreateLabelInput,
  CreateOrgApplicationInput,
  CreateOrgNodeInput,
  CreateProjectInput,
  CreateStandaloneIdeaInput,
  CreateTaskTextInput,
  CreateTrackInput,
  CreateUserInput,
  DecideOrgApplicationInput,
  DevLoginInput,
  EmailNotificationSettings,
  IdeaResponse,
  IdeasQuery,
  IdeasResponse,
  IdeasWithContextResponse,
  LabelResponse,
  LabelsResponse,
  LeaderboardResponse,
  MoveOrgNodeInput,
  MiniappAuthExchangeInput,
  MiniappAuthExchangeResponse,
  MyStatsResponse,
  NotificationCountsResponse,
  NotificationPreferencesResponse,
  NotificationsResponse,
  OrgApplicationResponse,
  OrgApplicationsResponse,
  OrgNodeResponse,
  OrgScope,
  OrgTreeResponse,
  ProjectDirectoryResponse,
  ProjectMembersResponse,
  ProjectResponse,
  ProjectsListResponse,
  RegistrationSettings,
  RejectIdeaInput,
  SetNotificationPreferenceInput,
  SetOrgMembersInput,
  SetTrackMembersInput,
  StatsSort,
  TaskTextsResponse,
  TrackMemberCandidatesResponse,
  TrackResponse,
  TrackStatsResponse,
  TracksResponse,
  TrendBucket,
  TrendResponse,
  UpdateAnnouncementInput,
  UpdateAssetInput,
  UpdateCommentInput,
  UpdateEmailNotificationSettingsInput,
  UpdateLabelInput,
  UpdateOrgNodeInput,
  UpdateProjectInput,
  UpdateProfileInput,
  UpdateRegistrationSettingsInput,
  UpdateTrackInput,
  UpdateUserInput,
  UsersListResponse,
} from 'shared';
import type { HttpAdapter } from './http.js';

export type NotificationFilter = 'all' | 'unread' | 'action';

export interface LeaderboardParams {
  projectId?: string;
  from?: string;
  to?: string;
  sort?: StatsSort;
}

export interface MyStatsParams {
  from?: string;
  to?: string;
}

export interface TrendParams {
  userId?: string;
  from?: string;
  to?: string;
  bucket?: TrendBucket;
}

function unwrapFirst<T>(values: readonly T[], message: string): T {
  const value = values[0];
  if (!value) throw new Error(message);
  return value;
}

export function createResourceClients(http: HttpAdapter) {
  return {
    auth: {
      config: (signal?: AbortSignal): Promise<AuthConfigResponse> =>
        http.request({ method: 'GET', path: '/auth/config', signal }),
      me: (signal?: AbortSignal): Promise<AuthUserResponse> =>
        http.request({ method: 'GET', path: '/auth/me', signal }),
      miniappExchange: (body: MiniappAuthExchangeInput): Promise<MiniappAuthExchangeResponse> =>
        http.request({ method: 'POST', path: '/auth/miniapp/exchange', body }),
      devLogin: (body: DevLoginInput): Promise<AuthUserResponse> =>
        http.request({ method: 'POST', path: '/auth/dev-login', body }),
      miniappDevLogin: (body: DevLoginInput): Promise<MiniappAuthExchangeResponse> =>
        http.request({ method: 'POST', path: '/auth/miniapp/dev-login', body }),
      logout: (): Promise<{ ok: true; endSessionUrl?: string }> =>
        http.request({ method: 'POST', path: '/auth/logout' }),
      updateProfile: (body: UpdateProfileInput): Promise<AuthUserResponse> =>
        http.request({ method: 'PATCH', path: '/auth/profile', body }),
    },
    announcements: {
      list: (signal?: AbortSignal): Promise<AnnouncementsResponse> =>
        http.request({ method: 'GET', path: '/announcements', signal }),
      create: (body: CreateAnnouncementInput): Promise<AnnouncementResponse> =>
        http.request({ method: 'POST', path: '/announcements', body }),
      update: (id: string, body: UpdateAnnouncementInput): Promise<AnnouncementResponse> =>
        http.request({ method: 'PATCH', path: `/announcements/${id}`, body }),
      remove: (id: string): Promise<void> =>
        http.request({ method: 'DELETE', path: `/announcements/${id}` }),
    },
    assets: {
      list: (query: AssetsQuery, signal?: AbortSignal): Promise<AssetsResponse> =>
        http.request({ method: 'GET', path: '/assets', query, signal }),
      create: (body: CreateAssetInput): Promise<AssetResponse> =>
        http.request({ method: 'POST', path: '/assets', body }),
      update: (id: string, body: UpdateAssetInput): Promise<AssetResponse> =>
        http.request({ method: 'PATCH', path: `/assets/${id}`, body }),
      remove: (id: string): Promise<void> =>
        http.request({ method: 'DELETE', path: `/assets/${id}` }),
    },
    comments: {
      list: (taskId: string, signal?: AbortSignal): Promise<CommentsResponse> =>
        http.request({ method: 'GET', path: `/tasks/${taskId}/comments`, signal }),
      create: async (taskId: string, body: CreateCommentInput) =>
        unwrapFirst(
          (
            await http.request<CommentsResponse>({
              method: 'POST',
              path: `/tasks/${taskId}/comments`,
              body,
            })
          ).comments,
          '服务器未返回评论数据',
        ),
      update: async (id: string, body: UpdateCommentInput) =>
        unwrapFirst(
          (await http.request<CommentsResponse>({ method: 'PATCH', path: `/comments/${id}`, body }))
            .comments,
          '服务器未返回评论数据',
        ),
      remove: (id: string): Promise<void> =>
        http.request({ method: 'DELETE', path: `/comments/${id}` }),
      activities: (taskId: string, signal?: AbortSignal): Promise<ActivitiesResponse> =>
        http.request({ method: 'GET', path: `/tasks/${taskId}/activities`, signal }),
    },
    ideas: {
      forTask: (taskId: string, signal?: AbortSignal): Promise<IdeasResponse> =>
        http.request({ method: 'GET', path: `/tasks/${taskId}/ideas`, signal }),
      create: async (taskId: string, body: CreateIdeaInput) =>
        unwrapFirst(
          (
            await http.request<IdeasResponse>({
              method: 'POST',
              path: `/tasks/${taskId}/ideas`,
              body,
            })
          ).ideas,
          '服务器未返回想法数据',
        ),
      createStandalone: async (body: CreateStandaloneIdeaInput) =>
        (await http.request<IdeaResponse>({ method: 'POST', path: '/ideas', body })).idea,
      all: (query: IdeasQuery, signal?: AbortSignal): Promise<IdeasWithContextResponse> =>
        http.request({ method: 'GET', path: '/ideas', query, signal }),
      adopt: async (id: string, body: AdoptIdeaInput) =>
        (await http.request<IdeaResponse>({ method: 'POST', path: `/ideas/${id}/adopt`, body }))
          .idea,
      reject: async (id: string, body?: RejectIdeaInput) =>
        (await http.request<IdeaResponse>({ method: 'POST', path: `/ideas/${id}/reject`, body }))
          .idea,
      remove: (id: string): Promise<void> =>
        http.request({ method: 'DELETE', path: `/ideas/${id}` }),
    },
    labels: {
      list: (signal?: AbortSignal): Promise<LabelsResponse> =>
        http.request({ method: 'GET', path: '/labels', signal }),
      create: async (body: CreateLabelInput) =>
        (await http.request<LabelResponse>({ method: 'POST', path: '/labels', body })).label,
      update: async (id: string, body: UpdateLabelInput) =>
        (await http.request<LabelResponse>({ method: 'PATCH', path: `/labels/${id}`, body })).label,
      remove: (id: string): Promise<void> =>
        http.request({ method: 'DELETE', path: `/labels/${id}` }),
    },
    notifications: {
      list: (
        filter: NotificationFilter,
        limit: number,
        cursor?: string,
        signal?: AbortSignal,
      ): Promise<NotificationsResponse> =>
        http.request({
          method: 'GET',
          path: '/notifications',
          query: { filter, limit, cursor },
          signal,
        }),
      counts: (signal?: AbortSignal): Promise<NotificationCountsResponse> =>
        http.request({ method: 'GET', path: '/notifications/counts', signal }),
      preferences: (signal?: AbortSignal): Promise<NotificationPreferencesResponse> =>
        http.request({ method: 'GET', path: '/notifications/preferences', signal }),
      setPreference: (body: SetNotificationPreferenceInput): Promise<void> =>
        http.request({ method: 'PUT', path: '/notifications/preferences', body }),
      read: (id: string): Promise<void> =>
        http.request({ method: 'POST', path: `/notifications/${id}/read` }),
      readAll: (): Promise<void> =>
        http.request({ method: 'POST', path: '/notifications/read-all' }),
      archive: (id: string): Promise<void> =>
        http.request({ method: 'DELETE', path: `/notifications/${id}` }),
    },
    org: {
      tree: (scope: OrgScope, signal?: AbortSignal): Promise<OrgTreeResponse> =>
        http.request({ method: 'GET', path: '/org/tree', query: { scope }, signal }),
      create: async (body: CreateOrgNodeInput) =>
        (await http.request<OrgNodeResponse>({ method: 'POST', path: '/org/nodes', body })).node,
      update: async (id: string, body: UpdateOrgNodeInput) =>
        (await http.request<OrgNodeResponse>({ method: 'PATCH', path: `/org/nodes/${id}`, body }))
          .node,
      move: async (id: string, body: MoveOrgNodeInput) =>
        (
          await http.request<OrgNodeResponse>({
            method: 'POST',
            path: `/org/nodes/${id}/move`,
            body,
          })
        ).node,
      remove: (id: string): Promise<void> =>
        http.request({ method: 'DELETE', path: `/org/nodes/${id}` }),
      setMembers: async (id: string, body: SetOrgMembersInput) =>
        (
          await http.request<OrgNodeResponse>({
            method: 'PUT',
            path: `/org/nodes/${id}/members`,
            body,
          })
        ).node,
      leave: async (id: string) =>
        (await http.request<OrgNodeResponse>({ method: 'POST', path: `/org/nodes/${id}/leave` }))
          .node,
      applications: (scope: OrgScope, signal?: AbortSignal): Promise<OrgApplicationsResponse> =>
        http.request({ method: 'GET', path: '/org/applications', query: { scope }, signal }),
      apply: async (nodeId: string, body: CreateOrgApplicationInput) =>
        (
          await http.request<OrgApplicationResponse>({
            method: 'POST',
            path: `/org/nodes/${nodeId}/applications`,
            body,
          })
        ).application,
      withdraw: async (id: string) =>
        (
          await http.request<OrgApplicationResponse>({
            method: 'DELETE',
            path: `/org/applications/${id}`,
          })
        ).application,
      decide: async (id: string, decision: 'approve' | 'reject', body: DecideOrgApplicationInput) =>
        (
          await http.request<OrgApplicationResponse>({
            method: 'POST',
            path: `/org/applications/${id}/${decision}`,
            body,
          })
        ).application,
    },
    projects: {
      list: (signal?: AbortSignal): Promise<ProjectsListResponse> =>
        http.request({ method: 'GET', path: '/projects', signal }),
      create: (body: CreateProjectInput): Promise<ProjectResponse> =>
        http.request({ method: 'POST', path: '/projects', body }),
      update: (id: string, body: UpdateProjectInput): Promise<ProjectResponse> =>
        http.request({ method: 'PATCH', path: `/projects/${id}`, body }),
      directory: (signal?: AbortSignal): Promise<ProjectDirectoryResponse> =>
        http.request({ method: 'GET', path: '/projects/directory', signal }),
      join: (id: string): Promise<{ ok: boolean }> =>
        http.request({ method: 'POST', path: `/projects/${id}/join` }),
      leave: (id: string): Promise<{ ok: boolean }> =>
        http.request({ method: 'POST', path: `/projects/${id}/leave` }),
      members: (id: string, signal?: AbortSignal): Promise<ProjectMembersResponse> =>
        http.request({ method: 'GET', path: `/projects/${id}/members`, signal }),
      addMember: (id: string, body: AddProjectMemberInput): Promise<ProjectMembersResponse> =>
        http.request({ method: 'POST', path: `/projects/${id}/members`, body }),
      removeMember: (id: string, userId: string): Promise<void> =>
        http.request({ method: 'DELETE', path: `/projects/${id}/members/${userId}` }),
    },
    settings: {
      get: (signal?: AbortSignal): Promise<RegistrationSettings> =>
        http.request({ method: 'GET', path: '/settings', signal }),
      update: (body: UpdateRegistrationSettingsInput): Promise<RegistrationSettings> =>
        http.request({ method: 'PATCH', path: '/settings', body }),
      emailNotifications: (signal?: AbortSignal): Promise<EmailNotificationSettings> =>
        http.request({ method: 'GET', path: '/settings/email-notifications', signal }),
      updateEmailNotifications: (
        body: UpdateEmailNotificationSettingsInput,
      ): Promise<EmailNotificationSettings> =>
        http.request({ method: 'PATCH', path: '/settings/email-notifications', body }),
    },
    stats: {
      leaderboard: (query: LeaderboardParams, signal?: AbortSignal): Promise<LeaderboardResponse> =>
        http.request({ method: 'GET', path: '/stats/leaderboard', query: { ...query }, signal }),
      me: (query: MyStatsParams, signal?: AbortSignal): Promise<MyStatsResponse> =>
        http.request({ method: 'GET', path: '/stats/me', query: { ...query }, signal }),
      trend: (query: TrendParams, signal?: AbortSignal): Promise<TrendResponse> =>
        http.request({ method: 'GET', path: '/stats/trend', query: { ...query }, signal }),
      tracks: (query: MyStatsParams, signal?: AbortSignal): Promise<TrackStatsResponse> =>
        http.request({ method: 'GET', path: '/stats/tracks', query: { ...query }, signal }),
    },
    taskTexts: {
      list: (taskId: string, signal?: AbortSignal): Promise<TaskTextsResponse> =>
        http.request({ method: 'GET', path: `/tasks/${taskId}/texts`, signal }),
      create: (taskId: string, body: CreateTaskTextInput): Promise<TaskTextsResponse> =>
        http.request({ method: 'POST', path: `/tasks/${taskId}/texts`, body }),
      remove: (taskId: string, id: string): Promise<void> =>
        http.request({ method: 'DELETE', path: `/tasks/${taskId}/texts/${id}` }),
    },
    tracks: {
      list: (signal?: AbortSignal): Promise<TracksResponse> =>
        http.request({ method: 'GET', path: '/tracks', signal }),
      create: (body: CreateTrackInput): Promise<TrackResponse> =>
        http.request({ method: 'POST', path: '/tracks', body }),
      update: (id: string, body: UpdateTrackInput): Promise<TrackResponse> =>
        http.request({ method: 'PATCH', path: `/tracks/${id}`, body }),
      remove: (id: string): Promise<void> =>
        http.request({ method: 'DELETE', path: `/tracks/${id}` }),
      memberCandidates: (
        id: string,
        signal?: AbortSignal,
      ): Promise<TrackMemberCandidatesResponse> =>
        http.request({ method: 'GET', path: `/tracks/${id}/member-candidates`, signal }),
      setMembers: (id: string, body: SetTrackMembersInput): Promise<TrackResponse> =>
        http.request({ method: 'PUT', path: `/tracks/${id}/members`, body }),
      join: (id: string): Promise<TrackResponse> =>
        http.request({ method: 'POST', path: `/tracks/${id}/join` }),
      leave: (id: string): Promise<TrackResponse> =>
        http.request({ method: 'POST', path: `/tracks/${id}/leave` }),
    },
    users: {
      list: (signal?: AbortSignal): Promise<UsersListResponse> =>
        http.request({ method: 'GET', path: '/users', signal }),
      create: (body: CreateUserInput): Promise<AuthUserResponse> =>
        http.request({ method: 'POST', path: '/users', body }),
      update: (id: string, body: UpdateUserInput): Promise<AuthUserResponse> =>
        http.request({ method: 'PATCH', path: `/users/${id}`, body }),
    },
    workbench: {
      reviewQueue: (signal?: AbortSignal): Promise<import('shared').BoardResponse> =>
        http.request({ method: 'GET', path: '/me/review-queue', signal }),
      rejectedTasks: (signal?: AbortSignal): Promise<import('shared').BoardResponse> =>
        http.request({ method: 'GET', path: '/me/rejected-tasks', signal }),
    },
  };
}
