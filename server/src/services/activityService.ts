import type { ActivityType, RealtimeEntity, RealtimeEvent } from 'shared';
import type { Database } from '../db/index.js';
import { activities, type ActivityRow } from '../db/schema.js';
import { bus, type RealtimeBus } from '../realtime/bus.js';

/**
 * Activity + realtime service. `recordActivity` is the single seam every write
 * path uses to (1) append an immutable `activities` row and (2) fan out a realtime
 * event on the bus (§5, §6.5). Feature agents call this; this module is owned by
 * Foundation A.
 */

export interface RecordActivityParams {
  taskId: string;
  /** Owning project, or null for a no-project (task-pool) activity (§8). */
  projectId: string | null;
  actorId: string;
  type: ActivityType;
  /** Free-form jsonb meta, e.g. { from: 'open', to: 'in_progress' }. */
  meta?: Record<string, unknown>;
}

/**
 * Insert an activity row and publish a realtime event. Returns the inserted row.
 * The published event uses `entity: 'activity'` plus the activity type so the
 * client can both refresh the timeline and react to the semantic change.
 */
export async function recordActivity(
  db: Database,
  params: RecordActivityParams,
  realtimeBus: RealtimeBus = bus,
): Promise<ActivityRow> {
  const [row] = await db
    .insert(activities)
    .values({
      taskId: params.taskId,
      projectId: params.projectId,
      actorId: params.actorId,
      type: params.type,
      meta: params.meta ?? {},
    })
    .returning();

  if (!row) {
    // Should be unreachable: insert..returning always yields a row on success.
    throw new Error('记录活动失败：未返回插入行');
  }

  publishEvent(
    {
      type: params.type,
      projectId: params.projectId,
      entity: 'activity',
      payload: {
        activityId: row.id,
        taskId: params.taskId,
        actorId: params.actorId,
        ...(params.meta ?? {}),
      },
    },
    realtimeBus,
  );

  return row;
}

/**
 * Publish a realtime event without recording an activity (e.g. comment edits,
 * project membership changes) so clients can invalidate the right queries (§6.5).
 */
export function publishEvent(event: RealtimeEvent, realtimeBus: RealtimeBus = bus): void {
  realtimeBus.publish(event);
}

/** Helper to publish a domain change for a given entity/type. */
export function publishChange(
  args: {
    type: string;
    /** Owning project, or null for a no-project (global) event (§8). */
    projectId: string | null;
    entity: RealtimeEntity;
    /** Restrict a private event (notifications) to one SSE user. */
    recipientUserId?: string;
    payload?: Record<string, unknown>;
  },
  realtimeBus: RealtimeBus = bus,
): void {
  publishEvent(
    {
      type: args.type,
      projectId: args.projectId,
      ...(args.recipientUserId ? { recipientUserId: args.recipientUserId } : {}),
      entity: args.entity,
      payload: args.payload ?? {},
    },
    realtimeBus,
  );
}
