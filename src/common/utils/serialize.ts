import { Prisma } from '@prisma/client';

/**
 * Converts values JSON cannot represent natively:
 *  - BigInt ids  -> number (string if outside the safe integer range)
 *  - Prisma.Decimal money values -> number
 * Dates are left alone (JSON.stringify emits ISO-8601).
 */
export function serialize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (Prisma.Decimal.isDecimal(value)) return value.toNumber();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serialize(v);
    }
    return out;
  }
  return value;
}
