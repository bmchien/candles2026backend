import * as argon2 from 'argon2';

/** OWASP-recommended argon2id parameters. */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} satisfies argon2.HashOptions;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { ...ARGON2_OPTIONS, raw: false });
}

/** Never throws: a malformed hash simply fails verification. */
export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password).catch(() => false);
}
