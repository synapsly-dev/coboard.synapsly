import argon2 from 'argon2';

/**
 * Password hashing with argon2id (§8). Parameters are argon2's safe defaults for
 * server-side auth; tuned conservatively for a self-hosted single instance.
 */

const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

/** Hash a plaintext password. Returns an encoded argon2id string. */
export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, HASH_OPTIONS);
}

/**
 * Verify a plaintext password against a stored hash. Returns false (never throws)
 * on malformed hashes so callers can treat it as a simple boolean check.
 */
export async function verifyPassword(
  hash: string,
  plaintext: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
