import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lte } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { miniappAuthCodes } from '../db/schema.js';

const AUTH_CODE_TTL_MS = 2 * 60_000;

function digest(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export interface RedeemedMiniappAuthCode {
  userId: string;
  oidcIdToken: string | null;
}

/** Create a two-minute, single-use credential for the Mini Program callback. */
export async function issueMiniappAuthCode(
  db: Database,
  userId: string,
  oidcIdToken: string | null,
): Promise<string> {
  const now = new Date();
  // Opportunistic cleanup keeps abandoned login attempts bounded.
  await db.delete(miniappAuthCodes).where(lte(miniappAuthCodes.expiresAt, now));

  const code = randomBytes(32).toString('base64url');
  await db.insert(miniappAuthCodes).values({
    codeHash: digest(code),
    userId,
    oidcIdToken,
    expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_MS),
  });
  return code;
}

/** Atomically consume a code; a second exchange always fails. */
export async function redeemMiniappAuthCode(
  db: Database,
  code: string,
): Promise<RedeemedMiniappAuthCode | null> {
  const rows = await db
    .delete(miniappAuthCodes)
    .where(
      and(eq(miniappAuthCodes.codeHash, digest(code)), gt(miniappAuthCodes.expiresAt, new Date())),
    )
    .returning({
      userId: miniappAuthCodes.userId,
      oidcIdToken: miniappAuthCodes.oidcIdToken,
    });
  return rows[0] ?? null;
}
