/**
 * @fileoverview Rate Limiter for LiBrainian
 *
 * Implements multiple rate limiting strategies:
 * - Token bucket for burst capacity
 * - Sliding window for smoothing
 * - Circuit breaker for failure protection
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPES
// ============================================================================

/** Rate limiter configuration */
export interface RateLimiterConfig {
  /** Maximum requests per window */
  maxRequests: number;

  /** Window duration in milliseconds */
  windowMs: number;

  /** Burst capacity (for token bucket) */
  burstCapacity?: number;

  /** Tokens per second (for token bucket) */
  tokensPerSecond?: number;

  /** Use sliding window */
  slidingWindow?: boolean;

  /** Skip rate limiting for these keys */
  skipKeys?: Set<string>;

  /** Cost function per operation type */
  operationCosts?: Record<string, number>;
}

/** Rate limit result */
export interface RateLimitResult {
  /** Whether request is allowed */
  allowed: boolean;

  /** Remaining requests in window */
  remaining: number;

  /** Time until reset (ms) */
  resetMs: number;

  /** Current request count */
  count: number;

  /** Limit that was applied */
  limit: number;

  /** Retry-After header value (seconds) */
  retryAfter?: number;
}

/** Rate limit entry for a key */
interface RateLimitEntry {
  /** Request timestamps in current window */
  timestamps: number[];

  /** Token count (for token bucket) */
  tokens: number;

  /** Last token refill time */
  lastRefill: number;

  /** Total requests made */
  totalRequests: number;

  /** First request time */
  firstRequest: number;
}

/** Circuit breaker state */
export type CircuitState = 'closed' | 'open' | 'half-open';

/** Circuit breaker configuration */
export interface CircuitBreakerConfig {
  /** Failure threshold to open circuit */
  failureThreshold: number;

  /** Success threshold to close circuit (half-open) */
  successThreshold: number;

  /** Duration to stay open before half-open (ms) */
  openDurationMs: number;

  /** Window for counting failures (ms) */
  failureWindowMs: number;
}

/** Circuit breaker status */
export interface CircuitBreakerStatus {
  /** Current state */
  state: CircuitState;

  /** Failure count in window */
  failures: number;

  /** Success count (half-open) */
  successes: number;

  /** Time until state change (ms) */
  timeUntilChange?: number;

  /** Last state change timestamp */
  lastStateChange: number;
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

export const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  maxRequests: 100,
  windowMs: 60000, // 1 minute
  burstCapacity: 20,
  tokensPerSecond: 2,
  slidingWindow: true,
  operationCosts: {
    bootstrap: 10,
    query: 1,
    verify_claim: 2,
    run_audit: 5,
    diff_runs: 3,
    export_index: 5,
    get_context_pack_bundle: 2,
  },
};

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  openDurationMs: 30000, // 30 seconds
  failureWindowMs: 60000, // 1 minute
};

// ============================================================================
// RATE LIMITER
// ============================================================================

/**
 * Rate limiter with multiple strategies.
 */
export class RateLimiter {
  private config: RateLimiterConfig;
  private entries: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMITER_CONFIG, ...config };

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanup(), this.config.windowMs);
  }

  /**
   * Check if a request is allowed.
   */
  check(key: string, operation?: string): RateLimitResult {
    // Skip rate limiting for whitelisted keys
    if (this.config.skipKeys?.has(key)) {
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetMs: 0,
        count: 0,
        limit: this.config.maxRequests,
      };
    }

    const now = Date.now();
    const cost = operation ? (this.config.operationCosts?.[operation] ?? 1) : 1;
    let entry = this.entries.get(key);

    if (!entry) {
      entry = {
        timestamps: [],
        tokens: this.config.burstCapacity ?? this.config.maxRequests,
        lastRefill: now,
        totalRequests: 0,
        firstRequest: now,
      };
      this.entries.set(key, entry);
    }

    // Refill tokens (token bucket)
    if (this.config.tokensPerSecond) {
      const elapsed = now - entry.lastRefill;
      const tokensToAdd = Math.floor(elapsed / 1000 * this.config.tokensPerSecond);
      if (tokensToAdd > 0) {
        entry.tokens = Math.min(
          this.config.burstCapacity ?? this.config.maxRequests,
          entry.tokens + tokensToAdd
        );
        entry.lastRefill = now;
      }
    }

    // Remove expired timestamps (sliding window)
    if (this.config.slidingWindow) {
      const windowStart = now - this.config.windowMs;
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
    }

    // Check rate limit
    const currentCount = this.config.slidingWindow
      ? entry.timestamps.length
      : entry.totalRequests;

    const wouldExceedWindow = currentCount + cost > this.config.maxRequests;
    const wouldExceedTokens = entry.tokens < cost;

    const allowed = !wouldExceedWindow && !wouldExceedTokens;

    if (allowed) {
      // Record request
      entry.timestamps.push(now);
      entry.tokens -= cost;
      entry.totalRequests += cost;
    }

    // Calculate reset time
    const resetMs = this.config.slidingWindow && entry.timestamps.length > 0
      ? Math.max(0, entry.timestamps[0] + this.config.windowMs - now)
      : this.config.windowMs;

    return {
      allowed,
      remaining: Math.max(0, this.config.maxRequests - currentCount - (allowed ? cost : 0)),
      resetMs,
      count: currentCount + (allowed ? cost : 0),
      limit: this.config.maxRequests,
      retryAfter: allowed ? undefined : Math.ceil(resetMs / 1000),
    };
  }

  /**
   * Consume a request (returns allowed status).
   */
  consume(key: string, operation?: string): boolean {
    return this.check(key, operation).allowed;
  }

  /**
   * Reset rate limit for a key.
   */
  reset(key: string): void {
    this.entries.delete(key);
  }

  /**
   * Get current status for a key.
   */
  getStatus(key: string): RateLimitResult | null {
    const entry = this.entries.get(key);
    if (!entry) return null;

    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const currentCount = this.config.slidingWindow
      ? entry.timestamps.filter((t) => t > windowStart).length
      : entry.totalRequests;

    const resetMs = this.config.slidingWindow && entry.timestamps.length > 0
      ? Math.max(0, entry.timestamps[0] + this.config.windowMs - now)
      : this.config.windowMs;

    return {
      allowed: currentCount < this.config.maxRequests,
      remaining: Math.max(0, this.config.maxRequests - currentCount),
      resetMs,
      count: currentCount,
      limit: this.config.maxRequests,
    };
  }

  /**
   * Get statistics for all keys.
   */
  getStats(): {
    totalKeys: number;
    totalRequests: number;
    activeKeys: number;
  } {
    let totalRequests = 0;
    let activeKeys = 0;
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const entry of this.entries.values()) {
      totalRequests += entry.totalRequests;
      if (entry.timestamps.some((t) => t > windowStart)) {
        activeKeys++;
      }
    }

    return {
      totalKeys: this.entries.size,
      totalRequests,
      activeKeys,
    };
  }

  /**
   * Clean up expired entries.
   */
  private cleanup(): void {
    const now = Date.now();
    const expireTime = now - this.config.windowMs * 2;

    for (const [key, entry] of this.entries.entries()) {
      // Remove entries with no recent activity
      const lastActivity = entry.timestamps.length > 0
        ? Math.max(...entry.timestamps)
        : entry.firstRequest;

      if (lastActivity < expireTime) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Stop the rate limiter.
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clear all rate limit entries.
   */
  clear(): void {
    this.entries.clear();
  }
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

/**
 * Circuit breaker for failure protection.
 */
export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = 'closed';
  private failures: number[] = [];
  private successes: number = 0;
  private lastStateChange: number = Date.now();

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  /**
   * Check if circuit allows operation.
   */
  canExecute(): boolean {
    this.updateState();

    switch (this.state) {
      case 'closed':
        return true;
      case 'open':
        return false;
      case 'half-open':
        return true; // Allow test requests
    }
  }

  /**
   * Record a success.
   */
  recordSuccess(): void {
    this.updateState();

    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    }

    // In closed state, reset failure count on success
    if (this.state === 'closed') {
      this.failures = [];
    }
  }

  /**
   * Record a failure.
   */
  recordFailure(): void {
    this.updateState();
    const now = Date.now();

    if (this.state === 'half-open') {
      // Any failure in half-open returns to open
      this.transitionTo('open');
      return;
    }

    if (this.state === 'closed') {
      this.failures.push(now);

      // Remove old failures outside window
      const windowStart = now - this.config.failureWindowMs;
      this.failures = this.failures.filter((t) => t > windowStart);

      if (this.failures.length >= this.config.failureThreshold) {
        this.transitionTo('open');
      }
    }
  }

  /**
   * Get current status.
   */
  getStatus(): CircuitBreakerStatus {
    this.updateState();
    const now = Date.now();

    let timeUntilChange: number | undefined;
    if (this.state === 'open') {
      timeUntilChange = Math.max(
        0,
        this.lastStateChange + this.config.openDurationMs - now
      );
    }

    // Count failures in window
    const windowStart = now - this.config.failureWindowMs;
    const recentFailures = this.failures.filter((t) => t > windowStart).length;

    return {
      state: this.state,
      failures: recentFailures,
      successes: this.successes,
      timeUntilChange,
      lastStateChange: this.lastStateChange,
    };
  }

  /**
   * Force reset to closed state.
   */
  reset(): void {
    this.transitionTo('closed');
    this.failures = [];
    this.successes = 0;
  }

  /**
   * Update state based on time.
   */
  private updateState(): void {
    if (this.state === 'open') {
      const now = Date.now();
      if (now - this.lastStateChange >= this.config.openDurationMs) {
        this.transitionTo('half-open');
      }
    }
  }

  /**
   * Transition to a new state.
   */
  private transitionTo(newState: CircuitState): void {
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === 'half-open') {
      this.successes = 0;
    }

    if (newState === 'closed') {
      this.failures = [];
      this.successes = 0;
    }
  }
}

// ============================================================================
// COMPOSITE RATE LIMITER
// ============================================================================

/**
 * Composite rate limiter with multiple limits.
 */
export class CompositeRateLimiter {
  private limiters: Map<string, RateLimiter> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  /**
   * Add a rate limiter tier.
   */
  addLimiter(name: string, config: Partial<RateLimiterConfig>): void {
    this.limiters.set(name, new RateLimiter(config));
  }

  /**
   * Add a circuit breaker.
   */
  addCircuitBreaker(name: string, config: Partial<CircuitBreakerConfig>): void {
    this.circuitBreakers.set(name, new CircuitBreaker(config));
  }

  /**
   * Check all limiters for a key.
   */
  check(key: string, operation?: string): RateLimitResult & { circuitOpen: boolean } {
    // Check circuit breakers first
    for (const breaker of this.circuitBreakers.values()) {
      if (!breaker.canExecute()) {
        return {
          allowed: false,
          remaining: 0,
          resetMs: breaker.getStatus().timeUntilChange ?? 0,
          count: 0,
          limit: 0,
          circuitOpen: true,
          retryAfter: Math.ceil((breaker.getStatus().timeUntilChange ?? 30000) / 1000),
        };
      }
    }

    // Check all rate limiters
    let mostRestrictive: RateLimitResult | null = null;

    for (const limiter of this.limiters.values()) {
      const result = limiter.check(key, operation);

      if (!result.allowed) {
        return { ...result, circuitOpen: false };
      }

      if (!mostRestrictive || result.remaining < mostRestrictive.remaining) {
        mostRestrictive = result;
      }
    }

    return {
      ...(mostRestrictive ?? {
        allowed: true,
        remaining: Infinity,
        resetMs: 0,
        count: 0,
        limit: Infinity,
      }),
      circuitOpen: false,
    };
  }

  /**
   * Record success for circuit breakers.
   */
  recordSuccess(): void {
    for (const breaker of this.circuitBreakers.values()) {
      breaker.recordSuccess();
    }
  }

  /**
   * Record failure for circuit breakers.
   */
  recordFailure(): void {
    for (const breaker of this.circuitBreakers.values()) {
      breaker.recordFailure();
    }
  }

  /**
   * Stop all limiters.
   */
  stop(): void {
    for (const limiter of this.limiters.values()) {
      limiter.stop();
    }
  }

  /**
   * Clear all state.
   */
  clear(): void {
    for (const limiter of this.limiters.values()) {
      limiter.clear();
    }
    for (const breaker of this.circuitBreakers.values()) {
      breaker.reset();
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a rate limiter.
 */
export function createRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiter {
  return new RateLimiter(config);
}

/**
 * Create a circuit breaker.
 */
export function createCircuitBreaker(config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  return new CircuitBreaker(config);
}

/**
 * Create a composite rate limiter with sensible defaults.
 */
export function createDefaultRateLimiter(): CompositeRateLimiter {
  const composite = new CompositeRateLimiter();

  // Per-second burst limit
  composite.addLimiter('burst', {
    maxRequests: 20,
    windowMs: 1000,
    slidingWindow: true,
  });

  // Per-minute sustained limit
  composite.addLimiter('sustained', {
    maxRequests: 100,
    windowMs: 60000,
    slidingWindow: true,
  });

  // Per-hour overall limit
  composite.addLimiter('hourly', {
    maxRequests: 1000,
    windowMs: 3600000,
    slidingWindow: true,
  });

  // Circuit breaker for failures
  composite.addCircuitBreaker('main', {
    failureThreshold: 5,
    successThreshold: 3,
    openDurationMs: 30000,
    failureWindowMs: 60000,
  });

  return composite;
}
