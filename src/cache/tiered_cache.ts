export type MemoryTier = 'l1' | 'l2';

export interface MemoryTierAdapter<T> {
  get: (key: string) => Promise<T | null>;
  set?: (key: string, value: T) => Promise<void>;
  delete?: (key: string) => Promise<void>;
}

export interface HierarchicalMemoryOptions<T> {
  l1Max: number;
  l2Max: number;
  l1TtlMs?: number;
  l2TtlMs?: number;
  now?: () => number;
  l3?: MemoryTierAdapter<T>;
}

interface CacheEntry<T> {
  value: T;
  updatedAt: number;
  expiresAt: number | null;
}

class LruCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number | null;
  private readonly now: () => number;

  constructor(maxEntries: number, ttlMs: number | undefined, now: () => number) {
    if (maxEntries <= 0) {
      throw new Error('L2 cache size must be positive');
    }
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs ?? null;
    this.now = now;
  }

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, { ...entry, updatedAt: this.now() });
    return entry.value;
  }

  peek(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    const now = this.now();
    const entry: CacheEntry<T> = {
      value,
      updatedAt: now,
      expiresAt: this.ttlMs ? now + this.ttlMs : null,
    };
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, entry);
    this.evictIfNeeded(now);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  private evictIfNeeded(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    if (entry.expiresAt === null) return false;
    return entry.expiresAt <= this.now();
  }
}

export class HierarchicalMemory<T> {
  private readonly l1 = new Map<string, CacheEntry<T>>();
  private readonly l2: LruCache<T>;
  private readonly l1Max: number;
  private readonly l1TtlMs: number | null;
  private readonly now: () => number;
  private readonly l3?: MemoryTierAdapter<T>;

  constructor(options: HierarchicalMemoryOptions<T>) {
    if (options.l1Max <= 0) {
      throw new Error('L1 cache size must be positive');
    }
    if (options.l2Max <= 0) {
      throw new Error('L2 cache size must be positive');
    }
    this.l1Max = options.l1Max;
    this.l1TtlMs = options.l1TtlMs ?? null;
    this.now = options.now ?? (() => Date.now());
    this.l2 = new LruCache<T>(options.l2Max, options.l2TtlMs, this.now);
    this.l3 = options.l3;
  }

  async get(key: string): Promise<T | null> {
    const l1Entry = this.getL1Entry(key);
    if (l1Entry) {
      this.touchL1(key, l1Entry);
      return l1Entry.value;
    }

    const l2Value = this.l2.get(key);
    if (l2Value !== null) {
      this.setL1(key, l2Value);
      return l2Value;
    }

    if (this.l3) {
      const l3Value = await this.l3.get(key);
      if (l3Value !== null) {
        this.l2.set(key, l3Value);
        this.setL1(key, l3Value);
        return l3Value;
      }
    }

    return null;
  }

  async set(key: string, value: T, tier: MemoryTier = 'l1'): Promise<void> {
    if (tier === 'l1') {
      this.setL1(key, value);
    } else {
      this.l2.set(key, value);
    }

    if (this.l3?.set) {
      await this.l3.set(key, value);
    }
  }

  async invalidate(key: string): Promise<void> {
    this.l1.delete(key);
    this.l2.delete(key);
    if (this.l3?.delete) {
      await this.l3.delete(key);
    }
  }

  async promote(key: string): Promise<void> {
    if (this.l1.has(key)) return;
    const l2Value = this.l2.get(key);
    if (l2Value !== null) {
      this.setL1(key, l2Value);
      return;
    }
    if (this.l3) {
      const l3Value = await this.l3.get(key);
      if (l3Value !== null) {
        this.l2.set(key, l3Value);
        this.setL1(key, l3Value);
      }
    }
  }

  async demote(key: string): Promise<void> {
    const entry = this.getL1Entry(key);
    if (!entry) {
      this.l1.delete(key);
      return;
    }
    this.l1.delete(key);
    this.l2.set(key, entry.value);
  }

  clear(): void {
    this.l1.clear();
    this.l2.clear();
  }

  getStats(): { l1Size: number; l2Size: number } {
    return { l1Size: this.l1.size, l2Size: this.l2.size() };
  }

  private getL1Entry(key: string): CacheEntry<T> | null {
    const entry = this.l1.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.l1.delete(key);
      return null;
    }
    return entry;
  }

  private setL1(key: string, value: T): void {
    const now = this.now();
    const entry: CacheEntry<T> = {
      value,
      updatedAt: now,
      expiresAt: this.l1TtlMs ? now + this.l1TtlMs : null,
    };
    if (this.l1.has(key)) {
      this.l1.delete(key);
    }
    this.l1.set(key, entry);
    this.evictL1IfNeeded();
  }

  private touchL1(key: string, entry: CacheEntry<T>): void {
    this.l1.delete(key);
    this.l1.set(key, { ...entry, updatedAt: this.now() });
  }

  private evictL1IfNeeded(): void {
    while (this.l1.size > this.l1Max) {
      const oldestKey = this.l1.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.l1.delete(oldestKey);
    }
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    if (entry.expiresAt === null) return false;
    return entry.expiresAt <= this.now();
  }
}
