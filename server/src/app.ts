import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import autoload from '@fastify/autoload';
import { registerRoutes as registerRoutesExplicit } from './route-registry.js';
import type { Database } from './db/index.js';
import { loadAuthRuntime, type AuthRuntime } from './auth/config.js';
import { configureEmailChannel } from './email/emailChannel.js';
import { createMailer, type Mailer } from './email/mailer.js';
import { bus, type RealtimeBus } from './realtime/bus.js';
import { SESSION_COOKIE, lookupSession, touchSession } from './auth/session.js';
import { AppError, ErrorCode, isAppError } from './lib/errors.js';
// Fastify type augmentation in ./types/fastify.d.ts is picked up by the compiler
// via the tsconfig `include`; no runtime import is needed.

/**
 * Fastify app builder (§9). Registers cookie/rate-limit/static/autoloaded routes,
 * an auth pre-handler that resolves the session cookie into request.user, a CSRF
 * header check for unsafe methods (§8), and a global error handler emitting the
 * §7 error shape. Exposed as a builder so tests can inject a PGlite-backed db.
 */

const here = dirname(fileURLToPath(import.meta.url));

export interface BuildAppOptions {
  db: Database;
  /** Cookie signing secret (SESSION_SECRET). */
  sessionSecret: string;
  production: boolean;
  /** Realtime bus (defaults to the process singleton; tests can inject). */
  realtimeBus?: RealtimeBus;
  /**
   * Auth runtime (Synapsly SSO / admin allowlist / dev-login). Defaults to an
   * env-derived config; tests that don't exercise SSO can omit it (SSO disabled,
   * dev-login off).
   */
  authRuntime?: AuthRuntime;
  /** Outbound mailer (defaults to one built from the auth runtime; tests inject). */
  mailer?: Mailer;
  /** Absolute path to the built web SPA (web/dist). Omit to skip static serving. */
  webDistPath?: string | undefined;
  /** Fastify logger toggle. */
  logger?: boolean;
  /**
   * How routes are loaded. 'autoload' (default) uses @fastify/autoload to scan
   * src/routes (production). 'explicit' registers them via a static import map —
   * used by Vitest, where autoload's native dynamic import bypasses the Vite
   * transform and cannot resolve the source modules.
   */
  routeLoader?: 'autoload' | 'explicit';
}

/** Methods that mutate state and therefore require the CSRF header (§8). */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
    bodyLimit: 1_000_000, // 1 MB
  });

  // Decorate instance with shared singletons.
  app.decorate('db', options.db);
  app.decorate('bus', options.realtimeBus ?? bus);
  app.decorate('isProduction', options.production);
  app.decorate(
    'authRuntime',
    options.authRuntime ?? loadAuthRuntime({ production: options.production, publicUrl: '' }),
  );
  app.decorate('mailer', options.mailer ?? createMailer(app.authRuntime.synapsly, app.log));
  // 邮件通道 (module singleton): createNotifications mirrors tagged notifications
  // to email through this. Last-built app wins, which is what tests want too.
  configureEmailChannel({
    mailer: app.mailer,
    log: app.log,
    publicUrl: app.authRuntime.publicUrl || '',
  });

  // Per-request auth context defaults.
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  // Tolerant body parsing for bodyless POST/DELETE (logout, claim, release,
  // avatar delete). Some proxies (cloudflared / HTTP-2) attach a Content-Type
  // to these empty requests; without a matching parser Fastify rejects them with
  // 415. Our API only ever consumes JSON bodies, so treat any other content type
  // as an empty body. The built-in application/json parser still handles JSON.
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, _body, done) => {
    done(null, undefined);
  });

  // Multipart uploads (§7.2 task files). Registering this adds a dedicated
  // `multipart/form-data` content-type parser; Fastify prefers that specific match
  // over the '*' catch-all above, so form-data uploads route here while every other
  // content type still falls through to the tolerant parser. The per-file `fileSize`
  // limit is the server-side 5MB cap (busboy hard-truncates the stream); the GLOBAL
  // JSON bodyLimit stays at 1MB — only multipart bodies may exceed it.
  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5 MB per file
      files: 1, // single file per upload
      fields: 8,
    },
  });

  await app.register(cookie, {
    secret: options.sessionSecret,
    hook: 'onRequest',
  });

  // Rate limit: a sane global default; tightened on /api/auth/login below.
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
  });

  // --- Auth pre-handler: resolve session cookie into request.user ----------
  app.addHook('preHandler', async (request) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || unsigned.value === null) return;
    const token = unsigned.value;
    const found = await lookupSession(app.db, token);
    if (found) {
      request.user = found.user;
      request.sessionToken = token;
      // Sliding-window bookkeeping; best-effort.
      void touchSession(app.db, token);
    }
  });

  // --- CSRF header check for unsafe methods (§8) ---------------------------
  // SameSite=Lax cookies + a custom header that browsers cannot set on simple
  // cross-site form posts. Only enforced for cookie-authenticated requests.
  app.addHook('onRequest', async (request) => {
    if (!UNSAFE_METHODS.has(request.method)) return;
    // Only API mutations are guarded; static asset POSTs don't exist.
    if (!request.url.startsWith('/api/')) return;
    const header = request.headers['x-requested-with'];
    if (header !== 'XMLHttpRequest' && header !== 'fetch') {
      throw new AppError(403, ErrorCode.FORBIDDEN, '缺少 CSRF 校验头');
    }
  });

  // --- Routes (under /api) --------------------------------------------------
  if ((options.routeLoader ?? 'autoload') === 'explicit') {
    await app.register(registerRoutesExplicit, { prefix: '/api' });
  } else {
    await app.register(autoload, {
      dir: join(here, 'routes'),
      options: { prefix: '/api' },
      forceESM: true,
    });
  }

  // --- Static SPA hosting with history fallback (§9) -----------------------
  if (options.webDistPath) {
    await app.register(staticPlugin, {
      root: options.webDistPath,
      wildcard: false,
    });

    // SPA fallback: any non-/api GET that isn't a real file returns index.html.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.type('text/html').sendFile('index.html');
      }
      return reply
        .code(404)
        .send(new AppError(404, ErrorCode.NOT_FOUND, '资源不存在').toResponse());
    });
  } else {
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send(new AppError(404, ErrorCode.NOT_FOUND, '资源不存在').toResponse()),
    );
  }

  // --- Global error handler emitting the §7 shape --------------------------
  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      return reply.code(error.statusCode).send(error.toResponse());
    }

    // Fastify validation / parse errors → 400.
    if ((error as { statusCode?: number }).statusCode === 400) {
      return reply.code(400).send({
        error: { code: ErrorCode.VALIDATION, message: '请求格式有误' },
      });
    }

    // Rate limit (set by @fastify/rate-limit).
    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({
        error: { code: ErrorCode.RATE_LIMITED, message: '请求过于频繁，请稍后再试' },
      });
    }

    // Unknown: log internally, do not leak details (§10).
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({
      error: { code: ErrorCode.INTERNAL, message: '服务器内部错误' },
    });
  });

  return app;
}
