/**
 * Inferred TS types — re-exported from the zod schemas in `schema.ts` and the
 * enums in `enums.ts`. Importing types from here (rather than re-inferring) keeps
 * the contract single-sourced. The `z.infer` type aliases are declared alongside
 * their schemas; this module simply surfaces them as a types-only entrypoint.
 */

export type {
  UserRole,
  ProjectRole,
  TaskStatus,
  Priority,
  TaskType,
  TrackMemberRole,
  ActivityType,
  OrgNodeKind,
  OrgMemberRole,
  ApplicationStatus,
  QualityGrade,
  ReviewStage,
  AssetKind,
} from './enums.js';

export type {
  // entities
  User,
  Session,
  Project,
  ProjectMember,
  ProjectMemberWithUser,
  Task,
  Comment,
  CommentWithAuthor,
  ActivityMeta,
  Activity,
  ActivityWithActor,
  // errors
  ApiError,
  // auth (Synapsly ID SSO)
  AuthConfigResponse,
  CompleteJoinInput,
  DevLoginInput,
  AuthUserResponse,
  // member self-join gate
  RegistrationSettings,
  UpdateRegistrationSettingsInput,
  // users
  UsersListResponse,
  CreateUserInput,
  UpdateUserInput,
  // projects
  ProjectsListResponse,
  CreateProjectInput,
  UpdateProjectInput,
  ProjectMembersResponse,
  AddProjectMemberInput,
  // tracks (赛道)
  TrackMember,
  Track,
  TracksResponse,
  TrackResponse,
  CreateTrackInput,
  UpdateTrackInput,
  SetTrackMembersInput,
  SetProjectTrackInput,
  // tasks
  TaskClaimant,
  BoardResponse,
  TaskResponse,
  CreateTaskInput,
  UpdateTaskInput,
  AssignTaskInput,
  ReleaseTaskInput,
  DeliverAllocation,
  DeliverTaskInput,
  ReviewDecision,
  ReviewTaskInput,
  TaskReview,
  TaskReviewsResponse,
  TransferTaskInput,
  // 资产库 (P3)
  Asset,
  CreateAssetInput,
  UpdateAssetInput,
  AssetsQuery,
  AssetsResponse,
  AssetResponse,
  // comments & activities
  CommentsResponse,
  CreateCommentInput,
  UpdateCommentInput,
  ActivitiesResponse,
  // stats
  StatsSort,
  LeaderboardQuery,
  LeaderboardEntry,
  LeaderboardResponse,
  MyStatsQuery,
  MyStatsResponse,
  TrendBucket,
  TrendQuery,
  TrendPoint,
  TrendResponse,
  TrackStatsEntry,
  TrackStatsResponse,
  // org tree (团队架构)
  OrgScope,
  OrgNode,
  OrgNodeMember,
  OrgTreeResponse,
  OrgNodeResponse,
  OrgTreeQuery,
  CreateOrgNodeInput,
  UpdateOrgNodeInput,
  MoveOrgNodeInput,
  SetOrgMembersInput,
  // 岗位申报 (P1)
  OrgApplication,
  CreateOrgApplicationInput,
  DecideOrgApplicationInput,
  OrgApplicationsResponse,
  OrgApplicationResponse,
  // realtime
  RealtimeEntity,
  RealtimeEvent,
  // params
  IdParam,
  ProjectMemberParams,
} from './schema.js';
