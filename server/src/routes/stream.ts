import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { isAdminRole, type RealtimeEvent } from 'shared';
import { projectMembers, projects } from '../db/schema.js';
import { requireAuth } from '../lib/guards.js';
import type { Database } from '../db/index.js';

/**
 * Server-Sent Events endpoint (§6.5): GET /api/stream.
 *
 * - Authenticated via the session cookie (the global auth pre-handler populates
 *   request.user before this runs).
 * - Subscribes to the realtime bus filtered to the projects the user belongs to
 *   (global admins receive events for all projects).
 * - Streams each matching event as a named SSE message.
 * - Emits a heartbeat comment every 25s to keep proxies from closing the stream.
 * - Cleans up the subscription and heartbeat on client disconnect.
 */

const HEARTBEAT_MS = 25_000;

/** Project ids whose events this user should receive. Admins get all projects. */
async function resolveSubscribedProjectIds(
  db: Database,
  userId: string,
  isAdmin: boolean,
): Promise<string[]> {
  if (isAdmin) {
    const rows = await db.select({ id: projects.id }).from(projects);
    return rows.map((r) => r.id);
  }
  const rows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  return rows.map((r) => r.projectId);
}

/** Serialize an event into the SSE wire format. */
function formatEvent(event: RealtimeEvent): string {
  // `event:` lets the client's EventSource use addEventListener(entity, ...) if
  // desired; data is the full JSON payload. Always end with a blank line.
  return `event: ${event.entity}\ndata: ${JSON.stringify(event)}\n\n`;
}

const streamRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = requireAuth(request);

    const projectIds = await resolveSubscribedProjectIds(
      fastify.db,
      user.id,
      isAdminRole(user.role),
    );

    // Take over the raw response to stream manually.
    reply.hijack();
    const raw = reply.raw;

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering (nginx); harmless elsewhere.
      'X-Accel-Buffering': 'no',
    });

    // Initial comment so the client knows the stream is open immediately.
    raw.write(': connected\n\n');

    const unsubscribe = fastify.bus.subscribe(
      projectIds,
      (event) => {
        // Guard against writes after the socket closed.
        if (!raw.writableEnded) {
          raw.write(formatEvent(event));
        }
      },
      user.id,
    );

    const heartbeat = setInterval(() => {
      if (!raw.writableEnded) {
        raw.write(`: heartbeat ${Date.now()}\n\n`);
      }
    }, HEARTBEAT_MS);
    // Don't keep the event loop alive solely for the heartbeat.
    heartbeat.unref?.();

    const cleanup = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!raw.writableEnded) {
        raw.end();
      }
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
};

export default streamRoutes;
