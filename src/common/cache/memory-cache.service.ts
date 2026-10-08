import { Injectable } from '@nestjs/common';

interface Entry {
  value: unknown;
  expiresAt: number;
}

/**
 * Small in-process TTL cache (HLD §8: "cache trong bộ nhớ TTL 30–60 giây").
 * Per-instance by design: with several API instances each one may serve data up
 * to `ttl` seconds stale after a write, which the HLD accepts. Swap for Redis if
 * stricter consistency is ever needed.
 */
@Injectable()
export class MemoryCacheService {
  private readonly store = new Map<string, Entry>();
  private readonly maxEntries = 5_000;

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlSeconds: number): void {
    if (this.store.size >= this.maxEntries) {
      // Map preserves insertion order: drop the oldest entry.
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async wrap<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await factory();
    this.set(key, value, ttlSeconds);
    return value;
  }

  deleteByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
  }
}

/** Prefix for every cache entry derived from catalog data (products, categories, tags). */
export const CATALOG_CACHE_PREFIX = 'catalog:';
export const CATALOG_CACHE_TTL_SECONDS = 30;
