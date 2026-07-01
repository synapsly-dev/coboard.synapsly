import type { Database } from '../db/index.js';
import type { RealtimeBus } from '../realtime/bus.js';
import type { UserRow } from '../db/schema.js';
import type { AuthRuntime } from '../auth/config.js';

/**
 * Fastify type augmentation. The bootstrap decorates the instance with `db` and
 * `bus`; an auth pre-handler decorates each request with the resolved `user` and
 * `sessionToken` (null when unauthenticated). Route/guard code reads these.
 */
declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    bus: RealtimeBus;
    /** True when NODE_ENV === 'production' (drives Secure cookies). */
    isProduction: boolean;
    /** Resolved Synapsly SSO / admin-allowlist / dev-login runtime config. */
    authRuntime: AuthRuntime;
  }

  interface FastifyRequest {
    /** Resolved, active user for the request, or null if unauthenticated. */
    user: UserRow | null;
    /** Raw session token from the signed cookie, or null. */
    sessionToken: string | null;
  }
}

export {};
