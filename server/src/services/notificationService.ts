import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type {
  EntitySubscription,
  Notification,
  NotificationCounts,
  NotificationEntityType,
  NotificationPreference,
  NotificationPriority,
  NotificationTopic,
  NotificationsQuery,
  NotificationsResponse,
  NotificationType,
  SetEntitySubscriptionInput,
  SetNotificationPreferenceInput,
  UserSummary,
} from 'shared';
import type { Database } from '../db/index.js';
import {
  entitySubscriptions,
  notificationPreferences,
  notifications,
  projectMembers,
  projects,
  trackMembers,
  users,
  type NotificationRow,
  type TaskRow,
  type UserRow,
} from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import type { RealtimeBus } from '../realtime/bus.js';
import { publishChange } from './activityService.js';

const NOTIFICATION_TOPICS: Record<NotificationType, NotificationTopic> = {
  task_assigned: 'assignments',
  task_unassigned: 'assignments',
  task_transferred: 'assignments',
  user_mentioned: 'mentions',
  comment_replied: 'mentions',
  task_delivered: 'reviews',
  review_requested: 'reviews',
  review_approved: 'reviews',
  review_rejected: 'reviews',
  task_reopened: 'reviews',
  deadline_changed: 'deadlines',
  deadline_due_soon: 'deadlines',
  deadline_overdue: 'deadlines',
  application_submitted: 'applications',
  application_approved: 'applications',
  application_rejected: 'applications',
  membership_changed: 'membership',
  role_changed: 'membership',
  account_status_changed: 'security',
  points_awarded: 'points',
  idea_adopted: 'points',
  idea_rejected: 'points',
  announcement_published: 'announcements',
  watched_entity_updated: 'watched_updates',
};

/** Direct responsibility/security events cannot be disabled inside the app. */
const MANDATORY_IN_APP_TYPES = new Set<NotificationType>([
  'task_assigned',
  'task_unassigned',
  'task_transferred',
  'user_mentioned',
  'comment_replied',
  'task_delivered',
  'review_requested',
  'review_approved',
  'review_rejected',
  'task_reopened',
  'deadline_changed',
  'application_submitted',
  'application_approved',
  'application_rejected',
  'membership_changed',
  'role_changed',
  'account_status_changed',
  'idea_rejected',
]);

function toUserSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    displayName: row.displayName,
    avatarColor: row.avatarColor,
    hasAvatar: row.avatarMime !== null,
  };
}

function toNotification(row: NotificationRow, actor: UserSummary | null): Notification {
  return {
    id: row.id,
    recipientUserId: row.recipientUserId,
    actor,
    type: row.type,
    entityType: row.entityType,
    entityId: row.entityId,
    title: row.title,
    body: row.body,
    payload: row.payload,
    priority: row.priority,
    actionRequired: row.actionRequired,
    readAt: row.readAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function publishNotificationRefresh(
  bus: RealtimeBus,
  recipientUserId: string,
  type: string,
  notificationId?: string,
): void {
  publishChange(
    {
      type,
      projectId: null,
      recipientUserId,
      entity: 'notification',
      payload: notificationId ? { notificationId } : {},
    },
    bus,
  );
}

export interface CreateNotificationsInput {
  recipientUserIds: readonly string[];
  actorUserId?: string | null;
  type: NotificationType;
  entityType?: NotificationEntityType | null;
  entityId?: string | null;
  title: string;
  body?: string | null;
  payload?: Record<string, unknown>;
  priority?: NotificationPriority;
  actionRequired?: boolean;
  /** Stable event id; recipient id is part of the unique database key. */
  dedupeKey?: string | null;
  groupKey?: string | null;
  /** Direct actions normally do not notify their own actor. */
  includeActor?: boolean;
}

/** Insert one durable notification per distinct recipient and publish private SSE. */
export async function createNotifications(
  db: Database,
  bus: RealtimeBus,
  input: CreateNotificationsInput,
): Promise<NotificationRow[]> {
  const recipientIds = [
    ...new Set(
      input.recipientUserIds.filter(
        (id) => input.includeActor || input.actorUserId == null || id !== input.actorUserId,
      ),
    ),
  ];
  if (recipientIds.length === 0) return [];

  // Ignore stale/inactive recipients at the producer boundary.
  const activeRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, recipientIds), eq(users.isActive, true)));
  const activeIds = new Set(activeRows.map((row) => row.id));

  // Sparse preference rows override only optional in-app topics. Mandatory direct
  // work events stay deliverable even if an imported preference says `off`.
  if (!MANDATORY_IN_APP_TYPES.has(input.type) && activeIds.size > 0) {
    const disabledRows = await db
      .select({ userId: notificationPreferences.userId })
      .from(notificationPreferences)
      .where(
        and(
          inArray(notificationPreferences.userId, [...activeIds]),
          eq(notificationPreferences.topic, NOTIFICATION_TOPICS[input.type]),
          eq(notificationPreferences.channel, 'in_app'),
          eq(notificationPreferences.delivery, 'off'),
        ),
      );
    for (const row of disabledRows) activeIds.delete(row.userId);
  }
  const inserted: NotificationRow[] = [];

  for (const recipientUserId of recipientIds) {
    if (!activeIds.has(recipientUserId)) continue;
    const [row] = await db
      .insert(notifications)
      .values({
        recipientUserId,
        actorUserId: input.actorUserId ?? null,
        type: input.type,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        title: input.title,
        body: input.body ?? null,
        payload: input.payload ?? {},
        priority: input.priority ?? 'normal',
        actionRequired: input.actionRequired ?? false,
        dedupeKey: input.dedupeKey ?? null,
        groupKey: input.groupKey ?? null,
      })
      // A duplicate producer retry is benign; the partial dedupe index owns this.
      .onConflictDoNothing()
      .returning();
    if (!row) continue;
    inserted.push(row);
    publishNotificationRefresh(bus, recipientUserId, 'notification_created', row.id);
  }
  return inserted;
}

function toEntitySubscription(row: typeof entitySubscriptions.$inferSelect): EntitySubscription {
  return {
    userId: row.userId,
    entityType: row.entityType,
    entityId: row.entityId,
    mode: row.mode,
    mutedUntil: row.mutedUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listEntitySubscriptions(
  db: Database,
  userId: string,
): Promise<EntitySubscription[]> {
  const rows = await db
    .select()
    .from(entitySubscriptions)
    .where(eq(entitySubscriptions.userId, userId))
    .orderBy(desc(entitySubscriptions.updatedAt));
  return rows.map(toEntitySubscription);
}

export async function setEntitySubscription(
  db: Database,
  userId: string,
  input: SetEntitySubscriptionInput,
): Promise<EntitySubscription> {
  const now = new Date();
  const mutedUntil = input.mode === 'muted' && input.mutedUntil ? new Date(input.mutedUntil) : null;
  const [row] = await db
    .insert(entitySubscriptions)
    .values({
      userId,
      entityType: input.entityType,
      entityId: input.entityId,
      mode: input.mode,
      mutedUntil,
    })
    .onConflictDoUpdate({
      target: [
        entitySubscriptions.userId,
        entitySubscriptions.entityType,
        entitySubscriptions.entityId,
      ],
      set: { mode: input.mode, mutedUntil, updatedAt: now },
    })
    .returning();
  if (!row) throw new Error('保存关注设置失败：未返回插入行');
  return toEntitySubscription(row);
}

export async function removeEntitySubscription(
  db: Database,
  userId: string,
  entityType: SetEntitySubscriptionInput['entityType'],
  entityId: string,
): Promise<void> {
  await db
    .delete(entitySubscriptions)
    .where(
      and(
        eq(entitySubscriptions.userId, userId),
        eq(entitySubscriptions.entityType, entityType),
        eq(entitySubscriptions.entityId, entityId),
      ),
    );
}

function toNotificationPreference(
  row: typeof notificationPreferences.$inferSelect,
): NotificationPreference {
  return {
    userId: row.userId,
    topic: row.topic,
    channel: row.channel,
    delivery: row.delivery,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listNotificationPreferences(
  db: Database,
  userId: string,
): Promise<NotificationPreference[]> {
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .orderBy(notificationPreferences.topic, notificationPreferences.channel);
  return rows.map(toNotificationPreference);
}

export async function setNotificationPreference(
  db: Database,
  userId: string,
  input: SetNotificationPreferenceInput,
): Promise<NotificationPreference> {
  const [row] = await db
    .insert(notificationPreferences)
    .values({ userId, topic: input.topic, channel: input.channel, delivery: input.delivery })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.topic,
        notificationPreferences.channel,
      ],
      set: { delivery: input.delivery, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error('保存通知偏好失败：未返回插入行');
  return toNotificationPreference(row);
}

export async function getNotificationCounts(
  db: Database,
  recipientUserId: string,
): Promise<NotificationCounts> {
  const [unreadRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, recipientUserId),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
      ),
    );
  const [actionRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, recipientUserId),
        eq(notifications.actionRequired, true),
        isNull(notifications.resolvedAt),
        isNull(notifications.archivedAt),
      ),
    );
  return {
    unread: unreadRow?.value ?? 0,
    unresolvedActions: actionRow?.value ?? 0,
  };
}

/** Cursor-paginated notification history plus lightweight badge counts. */
export async function listNotifications(
  db: Database,
  recipientUserId: string,
  query: NotificationsQuery,
): Promise<NotificationsResponse> {
  const conditions: SQL[] = [
    eq(notifications.recipientUserId, recipientUserId),
    isNull(notifications.archivedAt),
  ];
  if (query.filter === 'unread') conditions.push(isNull(notifications.readAt));
  if (query.filter === 'action') {
    conditions.push(eq(notifications.actionRequired, true), isNull(notifications.resolvedAt));
  }

  if (query.cursor) {
    const [cursor] = await db
      .select({ id: notifications.id, createdAt: notifications.createdAt })
      .from(notifications)
      .where(
        and(eq(notifications.id, query.cursor), eq(notifications.recipientUserId, recipientUserId)),
      )
      .limit(1);
    if (cursor) {
      conditions.push(
        or(
          lt(notifications.createdAt, cursor.createdAt),
          and(eq(notifications.createdAt, cursor.createdAt), lt(notifications.id, cursor.id)),
        )!,
      );
    }
  }

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(query.limit + 1);
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  const actorIds = [...new Set(page.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])))];
  const actorRows =
    actorIds.length > 0 ? await db.select().from(users).where(inArray(users.id, actorIds)) : [];
  const actors = new Map(actorRows.map((row) => [row.id, toUserSummary(row)]));

  return {
    notifications: page.map((row) =>
      toNotification(row, row.actorUserId ? (actors.get(row.actorUserId) ?? null) : null),
    ),
    counts: await getNotificationCounts(db, recipientUserId),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  };
}

export async function markNotificationRead(
  db: Database,
  bus: RealtimeBus,
  recipientUserId: string,
  notificationId: string,
): Promise<void> {
  const [updated] = await db
    .update(notifications)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(notifications.id, notificationId), eq(notifications.recipientUserId, recipientUserId)),
    )
    .returning({ id: notifications.id });
  if (!updated) throw notFound('通知不存在');
  publishNotificationRefresh(bus, recipientUserId, 'notification_read', notificationId);
}

export async function markAllNotificationsRead(
  db: Database,
  bus: RealtimeBus,
  recipientUserId: string,
): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(notifications.recipientUserId, recipientUserId),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
      ),
    );
  publishNotificationRefresh(bus, recipientUserId, 'notifications_read_all');
}

export async function archiveNotification(
  db: Database,
  bus: RealtimeBus,
  recipientUserId: string,
  notificationId: string,
): Promise<void> {
  const now = new Date();
  const [updated] = await db
    .update(notifications)
    .set({ archivedAt: now, readAt: now, updatedAt: now })
    .where(
      and(eq(notifications.id, notificationId), eq(notifications.recipientUserId, recipientUserId)),
    )
    .returning({ id: notifications.id });
  if (!updated) throw notFound('通知不存在');
  publishNotificationRefresh(bus, recipientUserId, 'notification_archived', notificationId);
}

/** Resolve outstanding action notifications when their source workflow advances. */
export async function resolveEntityNotifications(
  db: Database,
  bus: RealtimeBus,
  entityType: NotificationEntityType,
  entityId: string,
  types?: readonly NotificationType[],
): Promise<void> {
  const filters: SQL[] = [
    eq(notifications.entityType, entityType),
    eq(notifications.entityId, entityId),
    isNull(notifications.resolvedAt),
  ];
  if (types && types.length > 0) filters.push(inArray(notifications.type, [...types]));
  const now = new Date();
  const updated = await db
    .update(notifications)
    .set({ resolvedAt: now, updatedAt: now })
    .where(and(...filters))
    .returning({ recipientUserId: notifications.recipientUserId });
  for (const recipientUserId of new Set(updated.map((row) => row.recipientUserId))) {
    publishNotificationRefresh(bus, recipientUserId, 'notification_resolved');
  }
}

/** Active recipients for a workspace-wide announcement. */
export async function listActiveUserIds(db: Database): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.isActive, true));
  return rows.map((row) => row.id);
}

/** Active global administrators; also used as the final-review fallback. */
export async function listActiveAdminIds(db: Database): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.isActive, true), or(eq(users.role, 'super_admin'), eq(users.role, 'admin'))),
    );
  return rows.map((row) => row.id);
}

/** Users who should be prompted to review this task at its current review stage. */
export async function listTaskReviewerIds(
  db: Database,
  task: Pick<TaskRow, 'projectId' | 'needsFinalReview' | 'firstApprovedAt'>,
): Promise<string[]> {
  if (task.projectId === null || (task.needsFinalReview && task.firstApprovedAt !== null)) {
    return listActiveAdminIds(db);
  }

  const leadRows = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        eq(projectMembers.projectId, task.projectId),
        eq(projectMembers.role, 'lead'),
        eq(users.isActive, true),
      ),
    );
  const [project] = await db
    .select({ trackId: projects.trackId })
    .from(projects)
    .where(eq(projects.id, task.projectId))
    .limit(1);
  const managerRows = project?.trackId
    ? await db
        .select({ userId: trackMembers.userId })
        .from(trackMembers)
        .innerJoin(users, eq(users.id, trackMembers.userId))
        .where(
          and(
            eq(trackMembers.trackId, project.trackId),
            eq(trackMembers.role, 'manager'),
            eq(users.isActive, true),
          ),
        )
    : [];
  const reviewers = [...new Set([...leadRows, ...managerRows].map((row) => row.userId))];
  return reviewers.length > 0 ? reviewers : listActiveAdminIds(db);
}
