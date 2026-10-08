/**
 * Options for every interactive `$transaction(async (tx) => …)`.
 * Prisma's default timeout (5 s) is too short for a remote database (Neon), where each
 * round trip can take a few hundred milliseconds; transactions that exceed it are rolled
 * back with P2028 "Transaction not found". Keep transactions to a few queries anyway.
 */
export const INTERACTIVE_TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;
