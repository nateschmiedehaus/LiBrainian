/**
 * @fileoverview Bi-temporal Evidence Store (WU-STALE-002)
 *
 * Tracks valid-time and transaction-time for all facts to support temporal queries.
 * This enables "what did we know at time X about time Y" queries.
 *
 * Key concepts:
 * - Valid-time: When the fact was/is true in reality
 * - Transaction-time: When we learned about this fact
 *
 * Bi-temporal modeling allows:
 * - Auditing: "What did we believe at time T?"
 * - Correction: Update past facts without losing history
 * - Temporal queries: Query facts as they were known at any point
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A fact with both valid-time and transaction-time dimensions
 */
export interface TemporalFact<T> {
  /** Logical ID of the fact */
  id: string;
  /** The actual data of the fact */
  data: T;
  /** When fact became true in reality */
  validFrom: Date;
  /** When fact stopped being true (null = still valid) */
  validTo: Date | null;
  /** When we learned about this fact */
  transactionFrom: Date;
  /** When we updated our knowledge (null = current) */
  transactionTo: Date | null;
}

/**
 * Query parameters for temporal queries
 */
export interface TemporalQuery {
  /** Query as of this transaction time (what we knew then) */
  asOf?: Date;
  /** Query facts valid at this time */
  validAt?: Date;
  /** Query facts valid during this range */
  validDuring?: { start: Date; end: Date };
}

/**
 * Bi-temporal store interface for managing facts with two time dimensions
 */
export interface BitemporalStore<T> {
  /**
   * Add a new fact with specified valid-time
   * Transaction-time is set to current time
   */
  add(id: string, data: T, validFrom: Date): void;

  /**
   * Update an existing fact with new data and valid-time
   * Closes the previous version's transaction-time
   */
  update(id: string, data: T, validFrom: Date): void;

  /**
   * Invalidate a fact at specified valid-time
   * The fact is marked as no longer valid after this time
   */
  invalidate(id: string, validTo: Date): void;

  /**
   * Get a fact by ID, optionally filtered by temporal query
   */
  get(id: string, query?: TemporalQuery): TemporalFact<T> | undefined;

  /**
   * Get the full history of a fact
   */
  getHistory(id: string): TemporalFact<T>[];

  /**
   * Query facts by predicate with optional temporal filtering
   */
  query(
    predicate: (fact: TemporalFact<T>) => boolean,
    query?: TemporalQuery
  ): TemporalFact<T>[];

  /**
   * Get a fact as known at a specific transaction-time
   */
  getAsOf(id: string, transactionTime: Date): TemporalFact<T> | undefined;

  /**
   * Get a fact that was valid at a specific time
   */
  getValidAt(id: string, validTime: Date): TemporalFact<T> | undefined;
}

// ============================================================================
// INTERNAL STORAGE TYPES
// ============================================================================

/**
 * Internal representation of a stored fact version
 */
interface StoredFact<T> {
  id: string;
  data: T;
  validFrom: Date;
  validTo: Date | null;
  transactionFrom: Date;
  transactionTo: Date | null;
}

// ============================================================================
// BITEMPORAL STORE IMPLEMENTATION
// ============================================================================

/**
 * Implementation of a bi-temporal store
 *
 * Uses version chains to efficiently store and query facts across
 * both valid-time and transaction-time dimensions.
 */
class BitemporalStoreImpl<T> implements BitemporalStore<T> {
  /** All fact versions indexed by logical ID */
  private factVersions: Map<string, StoredFact<T>[]> = new Map();

  /**
   * Add a new fact with specified valid-time
   */
  add(id: string, data: T, validFrom: Date): void {
    const now = new Date();
    const versions = this.factVersions.get(id) || [];

    const newFact: StoredFact<T> = {
      id,
      data,
      validFrom,
      validTo: null,
      transactionFrom: now,
      transactionTo: null,
    };

    versions.push(newFact);
    this.factVersions.set(id, versions);
  }

  /**
   * Update an existing fact with new data and valid-time
   */
  update(id: string, data: T, validFrom: Date): void {
    const now = new Date();
    const versions = this.factVersions.get(id) || [];

    // Close the transaction-time of all current (non-closed) versions
    for (const version of versions) {
      if (version.transactionTo === null) {
        version.transactionTo = now;
      }
    }

    // Add the new version
    const newFact: StoredFact<T> = {
      id,
      data,
      validFrom,
      validTo: null,
      transactionFrom: now,
      transactionTo: null,
    };

    versions.push(newFact);
    this.factVersions.set(id, versions);
  }

  /**
   * Invalidate a fact at specified valid-time
   */
  invalidate(id: string, validTo: Date): void {
    const now = new Date();
    const versions = this.factVersions.get(id) || [];

    // Find the most recent current version BEFORE closing transactions
    const currentVersion = this.findCurrentVersion(versions);

    // Close the transaction-time of current versions
    for (const version of versions) {
      if (version.transactionTo === null) {
        version.transactionTo = now;
      }
    }

    // Create an invalidated copy of the current version
    if (currentVersion) {
      const invalidatedFact: StoredFact<T> = {
        id: currentVersion.id,
        data: currentVersion.data,
        validFrom: currentVersion.validFrom,
        validTo: validTo,
        transactionFrom: now,
        transactionTo: null,
      };

      versions.push(invalidatedFact);
      this.factVersions.set(id, versions);
    }
  }

  /**
   * Get a fact by ID, optionally filtered by temporal query
   */
  get(id: string, query?: TemporalQuery): TemporalFact<T> | undefined {
    const versions = this.factVersions.get(id) || [];
    if (versions.length === 0) {
      return undefined;
    }

    // Apply temporal filtering
    const filtered = this.applyTemporalFilter(versions, query);
    if (filtered.length === 0) {
      return undefined;
    }

    // Return the most recent version that matches
    return this.toTemporalFact(filtered[0]);
  }

  /**
   * Get the full history of a fact
   */
  getHistory(id: string): TemporalFact<T>[] {
    const versions = this.factVersions.get(id) || [];

    // Sort by transaction-from descending (most recent first)
    const sorted = [...versions].sort(
      (a, b) => b.transactionFrom.getTime() - a.transactionFrom.getTime()
    );

    return sorted.map((v) => this.toTemporalFact(v));
  }

  /**
   * Query facts by predicate with optional temporal filtering
   */
  query(
    predicate: (fact: TemporalFact<T>) => boolean,
    query?: TemporalQuery
  ): TemporalFact<T>[] {
    const results: TemporalFact<T>[] = [];

    // Use Array.from for ES5 compatibility
    const entries = Array.from(this.factVersions.entries());
    for (const [_id, versions] of entries) {
      // Apply temporal filtering
      const filtered = this.applyTemporalFilter(versions, query);
      if (filtered.length === 0) {
        continue;
      }

      // Get the most recent version that matches temporal criteria
      const fact = this.toTemporalFact(filtered[0]);

      // Apply predicate
      if (predicate(fact)) {
        results.push(fact);
      }
    }

    return results;
  }

  /**
   * Get a fact as known at a specific transaction-time
   */
  getAsOf(id: string, transactionTime: Date): TemporalFact<T> | undefined {
    return this.get(id, { asOf: transactionTime });
  }

  /**
   * Get a fact that was valid at a specific time
   */
  getValidAt(id: string, validTime: Date): TemporalFact<T> | undefined {
    return this.get(id, { validAt: validTime });
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Find the current (non-transaction-closed) version from a list
   */
  private findCurrentVersion(versions: StoredFact<T>[]): StoredFact<T> | undefined {
    // Sort by transaction-from descending
    const sorted = [...versions].sort(
      (a, b) => b.transactionFrom.getTime() - a.transactionFrom.getTime()
    );

    // Return the most recent version that is still current
    return sorted.find((v) => v.transactionTo === null);
  }

  /**
   * Apply temporal filtering to a list of versions
   */
  private applyTemporalFilter(
    versions: StoredFact<T>[],
    query?: TemporalQuery
  ): StoredFact<T>[] {
    let filtered = [...versions];

    // Default: filter to current transaction-time and currently valid
    if (!query) {
      // Get only current versions (transaction not closed)
      filtered = filtered.filter((v) => v.transactionTo === null);

      // Filter to facts that are valid now
      const now = new Date();
      filtered = filtered.filter((v) => this.isValidAt(v, now));

      // Sort by transaction-from descending
      filtered.sort(
        (a, b) => b.transactionFrom.getTime() - a.transactionFrom.getTime()
      );

      return filtered;
    }

    // Apply asOf (transaction-time) filter
    if (query.asOf !== undefined) {
      filtered = filtered.filter((v) =>
        this.isKnownAsOf(v, query.asOf!)
      );
    } else {
      // Default: only current transaction
      filtered = filtered.filter((v) => v.transactionTo === null);
    }

    // Apply validAt filter - this checks if the fact was valid at that point in time
    // This INCLUDES facts that were later invalidated, as long as they were valid then
    if (query.validAt !== undefined) {
      filtered = filtered.filter((v) => this.isValidAt(v, query.validAt!));
    }

    // Apply validDuring filter - checks if validity period overlaps with range
    if (query.validDuring !== undefined) {
      filtered = filtered.filter((v) =>
        this.overlapsWithRange(v, query.validDuring!.start, query.validDuring!.end)
      );
    }

    // If no validAt or validDuring specified AND no asOf specified, filter to currently valid
    // But if validAt or validDuring is specified, don't apply additional time filter
    if (
      query.validAt === undefined &&
      query.validDuring === undefined &&
      query.asOf === undefined
    ) {
      const now = new Date();
      filtered = filtered.filter((v) => this.isValidAt(v, now));
    }

    // Sort by transaction-from descending (most recent first)
    filtered.sort(
      (a, b) => b.transactionFrom.getTime() - a.transactionFrom.getTime()
    );

    return filtered;
  }

  /**
   * Check if a version was known at a specific transaction-time
   */
  private isKnownAsOf(version: StoredFact<T>, transactionTime: Date): boolean {
    // Must have been recorded by this time
    if (version.transactionFrom.getTime() > transactionTime.getTime()) {
      return false;
    }

    // If transaction was closed, must have been closed after this time
    if (
      version.transactionTo !== null &&
      version.transactionTo.getTime() <= transactionTime.getTime()
    ) {
      return false;
    }

    return true;
  }

  /**
   * Check if a fact was valid at a specific time
   */
  private isValidAt(version: StoredFact<T>, validTime: Date): boolean {
    // Must be valid from before or at this time
    if (version.validFrom.getTime() > validTime.getTime()) {
      return false;
    }

    // If has validTo, must be before validTo (exclusive)
    if (
      version.validTo !== null &&
      version.validTo.getTime() <= validTime.getTime()
    ) {
      return false;
    }

    return true;
  }

  /**
   * Check if a fact's valid period overlaps with a range
   */
  private overlapsWithRange(
    version: StoredFact<T>,
    start: Date,
    end: Date
  ): boolean {
    // Fact must start before range ends
    if (version.validFrom.getTime() >= end.getTime()) {
      return false;
    }

    // If fact has end, it must end after range starts
    if (
      version.validTo !== null &&
      version.validTo.getTime() <= start.getTime()
    ) {
      return false;
    }

    return true;
  }

  /**
   * Convert internal storage format to public TemporalFact
   */
  private toTemporalFact(stored: StoredFact<T>): TemporalFact<T> {
    return {
      id: stored.id,
      data: stored.data,
      validFrom: stored.validFrom,
      validTo: stored.validTo,
      transactionFrom: stored.transactionFrom,
      transactionTo: stored.transactionTo,
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new bi-temporal store
 *
 * @returns A new BitemporalStore instance
 */
export function createBitemporalStore<T>(): BitemporalStore<T> {
  return new BitemporalStoreImpl<T>();
}
