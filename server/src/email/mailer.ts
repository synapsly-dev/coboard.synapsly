import type { SynapslyConfig } from '../auth/config.js';

/**
 * Outbound email via core's (Syna ID) M2M send API. coboard is already a
 * confidential OAuth client of core for SSO; the SAME client credentials are
 * used here with the `client_credentials` grant and the `email:send` scope
 * (granted to the client as runtime config in core's admin panel — no core code
 * change). Emails are queued by core (202) and delivered asynchronously.
 *
 * When SSO is not configured (tests, bare local dev) a log-only mailer is used
 * so the notification paths stay exercised without any network dependency.
 */

export interface MailMessage {
  /** Single bare recipient address (core accepts one recipient per request). */
  to: string;
  subject: string;
  html?: string;
  text?: string;
  /**
   * Optional dedup key. Core enforces (client_id, idempotency_key) uniqueness,
   * so repeated sends with the same key are collapsed server-side — used by the
   * due-soon scan to guarantee at-most-one mail per task/user/dueDate.
   */
  idempotencyKey?: string;
}

/** Minimal logger surface (matches Fastify's logger). */
export interface MailerLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export interface Mailer {
  readonly kind: 'synapsly' | 'log';
  /** Resolves once the mail is accepted (202/dedup) — throws on failure. */
  send(message: MailMessage): Promise<void>;
}

const EMAIL_SCOPE = 'email:send';
/** Refresh the cached access token when less than this remains. */
const TOKEN_SKEW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

/** Log-only mailer for tests / unconfigured local dev. */
export class LogMailer implements Mailer {
  readonly kind = 'log' as const;

  constructor(private readonly log: MailerLogger) {}

  send(message: MailMessage): Promise<void> {
    this.log.info(
      { to: message.to, subject: message.subject, idempotencyKey: message.idempotencyKey },
      '[mail] 未配置发信通道，仅记录日志',
    );
    return Promise.resolve();
  }
}

/** Real mailer: client_credentials token + POST {issuer}/api/send/email. */
export class SynapslyMailer implements Mailer {
  readonly kind = 'synapsly' as const;
  private token: TokenCache | null = null;

  constructor(private readonly cfg: Pick<SynapslyConfig, 'issuer' | 'clientId' | 'clientSecret'>) {}

  async send(message: MailMessage): Promise<void> {
    let response = await this.postEmail(message, await this.getToken());
    if (response.status === 401) {
      // Token invalidated early (e.g. key rotation) — refresh once and retry.
      this.token = null;
      response = await this.postEmail(message, await this.getToken());
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`发信失败 ${response.status}: ${body.slice(0, 300)}`);
    }
  }

  private async postEmail(message: MailMessage, accessToken: string): Promise<Response> {
    return fetch(`${this.cfg.issuer}/api/send/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        idempotency_key: message.idempotencyKey,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_SKEW_MS > Date.now()) {
      return this.token.accessToken;
    }
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const res = await fetch(`${this.cfg.issuer}/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: EMAIL_SCOPE }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`获取发信令牌失败 ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error('获取发信令牌失败：响应缺少 access_token');
    }
    this.token = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return this.token.accessToken;
  }
}

/**
 * Build the mailer from the resolved auth runtime. `EMAIL_CLIENT_ID/SECRET`
 * (optional) override the SSO client credentials in case sending is ever moved
 * to a dedicated core client; `EMAIL_ISSUER` overrides the endpoint likewise.
 */
export function createMailer(
  synapsly: SynapslyConfig | null,
  log: MailerLogger,
  env: NodeJS.ProcessEnv = process.env,
): Mailer {
  const clientId = env.EMAIL_CLIENT_ID?.trim() || synapsly?.clientId;
  const clientSecret = env.EMAIL_CLIENT_SECRET?.trim() || synapsly?.clientSecret;
  const issuer = (env.EMAIL_ISSUER?.trim() || synapsly?.issuer)?.replace(/\/+$/, '');
  if (clientId && clientSecret && issuer) {
    return new SynapslyMailer({ issuer, clientId, clientSecret });
  }
  return new LogMailer(log);
}
