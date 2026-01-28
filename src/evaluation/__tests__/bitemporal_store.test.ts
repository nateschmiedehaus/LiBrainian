/**
 * @fileoverview Tests for Bi-temporal Evidence Store (WU-STALE-002)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Bi-temporal Evidence Store tracks valid-time and transaction-time for all facts
 * to support temporal queries. This enables "what did we know at time X about time Y" queries.
 *
 * Key concepts:
 * - Valid-time: When the fact was/is true in reality
 * - Transaction-time: When we learned about this fact
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createBitemporalStore,
  type BitemporalStore,
  type TemporalFact,
  type TemporalQuery,
} from '../bitemporal_store.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

interface TestData {
  name: string;
  value: number;
}

const now = new Date('2025-01-28T12:00:00Z');
const yesterday = new Date('2025-01-27T12:00:00Z');
const twoDaysAgo = new Date('2025-01-26T12:00:00Z');
const threeDaysAgo = new Date('2025-01-25T12:00:00Z');
const tomorrow = new Date('2025-01-29T12:00:00Z');

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createBitemporalStore', () => {
  it('should create a BitemporalStore instance', () => {
    const store = createBitemporalStore<TestData>();
    expect(store).toBeDefined();
    expect(typeof store.add).toBe('function');
    expect(typeof store.update).toBe('function');
    expect(typeof store.invalidate).toBe('function');
    expect(typeof store.get).toBe('function');
    expect(typeof store.getHistory).toBe('function');
    expect(typeof store.query).toBe('function');
    expect(typeof store.getAsOf).toBe('function');
    expect(typeof store.getValidAt).toBe('function');
  });

  it('should create typed stores', () => {
    const stringStore = createBitemporalStore<string>();
    const numberStore = createBitemporalStore<number>();
    const objectStore = createBitemporalStore<{ x: number; y: string }>();

    expect(stringStore).toBeDefined();
    expect(numberStore).toBeDefined();
    expect(objectStore).toBeDefined();
  });
});

// ============================================================================
// ADD OPERATION TESTS
// ============================================================================

describe('BitemporalStore - add', () => {
  let store: BitemporalStore<TestData>;

  beforeEach(() => {
    store = createBitemporalStore<TestData>();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should add a new fact with valid-time', () => {
    store.add('fact-1', { name: 'test', value: 42 }, yesterday);

    const fact = store.get('fact-1');
    expect(fact).toBeDefined();
    expect(fact!.id).toBe('fact-1');
    expect(fact!.data.name).toBe('test');
    expect(fact!.data.value).toBe(42);
    expect(fact!.validFrom).toEqual(yesterday);
    expect(fact!.validTo).toBeNull(); // Still valid
  });

  it('should set transaction-time to current time on add', () => {
    store.add('fact-1', { name: 'test', value: 42 }, yesterday);

    const fact = store.get('fact-1');
    expect(fact!.transactionFrom).toEqual(now);
    expect(fact!.transactionTo).toBeNull(); // Current knowledge
  });

  it('should support adding multiple facts with different IDs', () => {
    store.add('fact-1', { name: 'first', value: 1 }, yesterday);
    store.add('fact-2', { name: 'second', value: 2 }, twoDaysAgo);

    const fact1 = store.get('fact-1');
    const fact2 = store.get('fact-2');

    expect(fact1!.data.name).toBe('first');
    expect(fact2!.data.name).toBe('second');
  });

  it('should generate unique ID for each fact version', () => {
    store.add('fact-1', { name: 'v1', value: 1 }, yesterday);
    vi.setSystemTime(new Date(now.getTime() + 1000));
    store.update('fact-1', { name: 'v2', value: 2 }, now);

    const history = store.getHistory('fact-1');
    expect(history.length).toBe(2);
    // Each should have the same logical ID but be different versions
    expect(history[0].id).toBe('fact-1');
    expect(history[1].id).toBe('fact-1');
  });
});

// ============================================================================
// UPDATE OPERATION TESTS
// ============================================================================

describe('BitemporalStore - update', () => {
  let store: BitemporalStore<TestData>;

  beforeEach(() => {
    store = createBitemporalStore<TestData>();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should update existing fact with new valid-time', () => {
    store.add('fact-1', { name: 'original', value: 1 }, twoDaysAgo);
    vi.setSystemTime(new Date(now.getTime() + 1000)); // Advance time slightly
    store.update('fact-1', { name: 'updated', value: 2 }, yesterday);

    const fact = store.get('fact-1');
    expect(fact!.data.name).toBe('updated');
    expect(fact!.data.value).toBe(2);
    expect(fact!.validFrom).toEqual(yesterday);
  });

  it('should preserve history when updating', () => {
    store.add('fact-1', { name: 'v1', value: 1 }, threeDaysAgo);
    vi.setSystemTime(new Date(now.getTime() + 1000));
    store.update('fact-1', { name: 'v2', value: 2 }, twoDaysAgo);
    vi.setSystemTime(new Date(now.getTime() + 2000));
    store.update('fact-1', { name: 'v3', value: 3 }, yesterday);

    const history = store.getHistory('fact-1');
    expect(history.length).toBe(3);
  });

  it('should close previous version transaction-time on update', () => {
    store.add('fact-1', { name: 'v1', value: 1 }, twoDaysAgo);
    const updateTime = new Date(now.getTime() + 1000);
    vi.setSystemTime(updateTime);
    store.update('fact-1', { name: 'v2', value: 2 }, yesterday);

    const history = store.getHistory('fact-1');
    // Find the old version (v1)
    const oldVersion = history.find((h) => h.data.name === 'v1');
    expect(oldVersion).toBeDefined();
    expect(oldVersion!.transactionTo).toEqual(updateTime);
  });

  it('should set new version transaction-from to update time', () => {
    store.add('fact-1', { name: 'v1', value: 1 }, twoDaysAgo);
    const updateTime = new Date(now.getTime() + 1000);
    vi.setSystemTime(updateTime);
    store.update('fact-1', { name: 'v2', value: 2 }, yesterday);

    const fact = store.get('fact-1');
    expect(fact!.transactionFrom).toEqual(updateTime);
  });
});

// ============================================================================
// INVALIDATE OPERATION TESTS
// ============================================================================

describe('BitemporalStore - invalidate', () => {
  let store: BitemporalStore<TestData>;

  beforeEach(() => {
    store = createBitemporalStore<TestData>();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should mark fact as invalid at specified valid-time', () => {
    store.add('fact-1', { name: 'test', value: 42 }, threeDaysAgo);
    store.invalidate('fact-1', yesterday);

    const fact = store.get('fact-1');
    // Current query should not return invalidated fact
    expect(fact).toBeUndefined();
  });

  it('should set validTo on invalidation', () => {
    store.add('fact-1', { name: 'test', value: 42 }, threeDaysAgo);
    store.invalidate('fact-1', yesterday);

    const history = store.getHistory('fact-1');
    // Find the version that was invalidated
    const invalidated = history.find(
      (h) => h.validTo !== null && h.validTo.getTime() === yesterday.getTime()
    );
    expect(invalidated).toBeDefined();
  });

  it('should preserve fact in history after invalidation', () => {
    store.add('fact-1', { name: 'test', value: 42 }, threeDaysAgo);
    store.invalidate('fact-1', yesterday);

    const history = store.getHistory('fact-1');
    expect(history.length).toBeGreaterThan(0);
  });

  it('should allow querying invalidated facts by valid-time', () => {
    store.add('fact-1', { name: 'test', value: 42 }, threeDaysAgo);
    store.invalidate('fact-1', yesterday);

    // Query for when fact was still valid
    const fact = store.getValidAt('fact-1', twoDaysAgo);
    expect(fact).toBeDefined();
    expect(fact!.data.name).toBe('test');
  });
});

// ============================================================================
// GET OPERATION TESTS
// ============================================================================

describe('BitemporalStore - get', () => {
  let store: BitemporalStore<TestData>;

  beforeEach(() => {
    store = createBitemporalStore<TestData>();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should return undefined for non-existent fact', () => {
    const fact = store.get('non-existent');
    expect(fact).toBeUndefined();
  });

  it('should return current fact when no query specified', () => {
    store.add('fact-1', { name: 'test', value: 42 }, yesterday);

    const fact = store.get('fact-1');
    expect(fact).toBeDefined();
    expect(fact!.data.value).toBe(42);
  });

  it('should support asOf query for transaction-time', () => {
    store.add('fact-1', { name: 'v1', value: 1 }, threeDaysAgo);
    const updateTime = new Date(now.getTime() + 1000);
    vi.setSystemTime(updateTime);
    store.update('fact-1', { name: 'v2', value: 2 }, twoDaysAgo);

    // Query as of before the update
    const oldFact = store.get('fact-1', { asOf: now });
    expect(oldFact).toBeDefined();
    expect(oldFact!.data.name).toBe('v1');
  });

  it('should support validAt query for valid-time', () => {
    store.add('fact-1', { name: 'test', value: 42 }, twoDaysAgo);
    store.invalidate('fact-1', yesterday);

    // Query for when fact was valid
    const fact = store.get('fact-1', { validAt: threeDaysAgo });
    expect(fact).toBeUndefined(); // Not yet valid

    const validFact = store.get('fact-1', { validAt: twoDaysAgo });
    expect(validFact).toBeDefined();
  });

  it('should support combined asOf and validAt query', () => {
    // Complex bi-temporal query: "What did we know at transaction-time X about valid-time Y?"
    store.add('fact-1', { name: 'original', value: 1 }, threeDaysAgo);
    const updateTime = new Date(now.getTime() + 1000);
    vi.setSystemTime(updateTime);
    store.update('fact-1', { name: 'corrected', value: 2 }, threeDaysAgo);

    // At transaction time `now`, we thought value was 1
    const oldKnowledge = store.get('fact-1', { asOf: now, validAt: threeDaysAgo });
    expect(oldKnowledge).toBeDefined();
    expect(oldKnowledge!.data.value).toBe(1);

    // After update, we know value was actually 2
    const newKnowledge = store.get('fact-1', {
      asOf: updateTime,
      validAt: threeDaysAgo,
    });
    expect(newKnowledge).toBeDefined();
    expect(newKnowledge!.data.value).toBe(2);
  });

  it('should support validDuring range query', () => {
    store.add('fact-1', { name: 'test', value: 42 }, twoDaysAgo);
    store.invalidate('fact-1', yesterday);

    // Query for range that includes valid period
    const fact = store.get('fact-1', {
      validDuring: { start: threeDaysAgo, end: yesterday },
    });
    expect(fact).toBeDefined();

    // Query for range outside valid period
    const noFact = store.get('fact-1', {
      validDuring: { start: now, end: tomorrow },
    });
    expect(noFact).toBeUndefined();
  });
});

// ============================================================================
// GET HISTORY TESTS
// ============================================================================

describe('BitemporalStore - getHistory', () => {
  let store: BitemporalStore<TestData>;

  beforeEach(() => {
    store = createBitemporalStore<TestData>();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should return empty array for non-existent fact', () => {
    const history = store.getHistory('non-existent');
    expect(history).toEqual([]);
  });

  it('should return all versions of a fact', () => {
    store.add('fact-1', { name: 'v1', value: 1 }, threeDaysAgo);
    vi.setSystemTime(new Date(now.getTime() + 1000));
    store.update('fact-1', { name: 'v2', value: 2 }, twoDaysAgo);
    vi.setSystemTime(new Date(now.getTime() + 2000));
    store.update('fact-1', { name: 'v3', value: 3 }, yesterday);

    const history = store.getHistory('fact-1');
    expect(history.length).toBe(3);
  });

  it('should order history by transaction-time descending (most recent first)', () => {
    store.add('fact-1', { name: 'v1', value: 1 }, threeDaysAgo);
    vi.setSystemTime(new Date(now.getTime() + 1000));
    store.update('fact-1', { name: 'v2', value: 2 }, twoDaysAgo);
    vi.setSystemTime(new Date(now.getTime() + 2000));
    store.update('fact-1', { name: 'v3', value: 3 }, yesterday);

    const history = store.getHistory('fact-1');
    expect(history[0].data.name).toBe('v3'); // Most recent
    expect(history[2].data.name).toBe('v1'); // Oldest
  });

  it('should include invalidated versions in history', () => {
    store.add('fact-1', { name: 'test', value: 42 }, threeDaysAgo);
    vi.setSystemTime(new Date(now.getTime() + 1000));
    store.invalidate('fact-1', yesterday);

    const history = store.getHistory('fact-1');
    expect(history.length).toBeGreaterThan(0);
    expect(history.some((h) => h.validTo !== null)).toBe(true);
  });
});

// ============================================================================
// QUERY OPERATION TESTS
// ============================================================================

describe('BitemporalStore - query', () => {
  let store: BitemporalStore<TestData>;

  beforeEach(() => {
    store = createBitemporalStore<TestData>();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should query facts by predicate', () => {
    store.add('fact-1', { name: 'high', value: 100 }, yesterday);
    store.add('fact-2', { name: 'low', value: 10 }, yesterday);
    store.add('fact-3', { name: 'medium', value: 50 }, yesterday);

    const highValueFacts = store.query((fact) => fact.data.value > 50);
    expect(highValueFacts.length).toBe(1);
    expect(highValueFacts[0].data.name).toBe('high');
  });

  it('should support asOf query with predicate', () => {
    store.add('fact-1', { name: 'v1', value: 10 }, twoDaysAgo);
    const updateTime = new Date(now.getTime() + 1000);
    vi.setSystemTime(updateTime);
    store.update('fact-1', { name: 'v1-updated', value: 100 }, twoDaysAgo);

    // Query as of before update with value > 50
    const oldQuery = store.query((fact) => fact.data.value > 50, { asOf: now });
    expect(oldQuery.length).toBe(0); // Value was 10 then

    // Query as of after update
    const newQuery = store.query((fact) => fact.data.value > 50, {
      asOf: updateTime,
    });
    expect(newQuery.length).toBe(1);
  });

  it('should support validAt query with predicate', () => {
    store.add('fact-1', { name: 'test', value: 42 }, twoDaysAgo);
    store.invalidate('fact-1', yesterday);

    // Query at time when fact was valid
    const validQuery = store.query((fact) => fact.data.value === 42, {
      validAt: twoDaysAgo,
    });
    expect(validQuery.length).toBe(1);

    // Query at time when fact was invalid
    const invalidQuery = store.query((fact) => fact.data.value === 42, {
      validAt: now,
    });
    expect(invalidQuery.length).toBe(0);
  });

  it('should return empty array when no facts match', () => {
    store.add('fact-1', { name: 'test', value: 42 }, yesterday);

    const result = store.query((fact) => fact.data.value > 1000);
    expect(result).toEqual([]);
  });

  it('should query by name pattern', () => {
    store.add('fact-1', { name: 'user-alice', value: 1 }, yesterday);
    store.add('fact-2', { name: 'user-bob', value: 2 }, yesterday);
    store.add('fact-3', { name: 'admin-carol', value: 3 }, yesterday);

    const userFacts = store.query((fact) => fact.data.name.startsWith('user-'));
    expect(userFacts.length).toBe(2);
  });
});

// ============================================================================
// GET AS OF TESTS
// ============================================================================

describe('BitemporalStore - getAsOf', () => {
  let store: BitemporalStore<TestData>;

  beforeEach(() => {
    store = createBitemporalStore<TestData>();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should return fact as known at transaction-time', () => {
    store.add('fact-1', { name: 'v1', value: 1 }, threeDaysAgo);
    const updateTime = new Date(now.getTime() + 1000);
    vi.setSystemTime(updateTime);
    store.update('fact-1', { name: 'v2', value: 2 }, twoDaysAgo);

    const oldFact = store.getAsOf('fact-1', now);
    expect(oldFact).toBeDefined();
    expect(oldFact!.data.name).toBe('v1');

    const newFact = store.getAsOf('fact-1', updateTime);
    expect(newFact).toBeDefined();
    expect(newFact!.data.name).toBe('v2');
  });

  it('should return undefined for future transaction-time', () => {
    // Store is empty at transaction-time before any adds
    const fact = store.getAsOf('fact-1', yesterday);
    expect(fact).toBeUndefined();
  });

  it('should handle transaction-time boundaries correctly', () => {
    store.add('fact-1', { name: 'v1', value: 1 }, yesterday);

    // Exactly at transaction-time should include the fact
    const atTime = store.getAsOf('fact-1', now);
    expect(atTime).toBeDefined();

    // Just before should not
    const beforeTime = store.getAsOf('fact-1', new Date(now.getTime() - 1));
    expect(beforeTime).toBeUndefined();
  });
});

// ============================================================================
// GET VALID AT TESTS
// ============================================================================

describe('BitemporalStore - getValidAt', () => {
  let store: BitemporalStore<TestData>;

  beforeEach(() => {
    store = createBitemporalStore<TestData>();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should return fact valid at specified time', () => {
    store.add('fact-1', { name: 'test', value: 42 }, twoDaysAgo);

    const fact = store.getValidAt('fact-1', yesterday);
    expect(fact).toBeDefined();
    expect(fact!.data.value).toBe(42);
  });

  it('should return undefined for time before validFrom', () => {
    store.add('fact-1', { name: 'test', value: 42 }, yesterday);

    const fact = store.getValidAt('fact-1', twoDaysAgo);
    expect(fact).toBeUndefined();
  });

  it('should return undefined for time after validTo', () => {
    store.add('fact-1', { name: 'test', value: 42 }, threeDaysAgo);
    store.invalidate('fact-1', yesterday);

    const fact = store.getValidAt('fact-1', now);
    expect(fact).toBeUndefined();
  });

  it('should handle valid-time boundaries correctly', () => {
    store.add('fact-1', { name: 'test', value: 42 }, twoDaysAgo);
    store.invalidate('fact-1', yesterday);

    // At validFrom should be valid
    const atStart = store.getValidAt('fact-1', twoDaysAgo);
    expect(atStart).toBeDefined();

    // Just before validFrom should not be valid
    const beforeStart = store.getValidAt(
      'fact-1',
      new Date(twoDaysAgo.getTime() - 1)
    );
    expect(beforeStart).toBeUndefined();

    // At validTo should not be valid (exclusive)
    const atEnd = store.getValidAt('fact-1', yesterday);
    expect(atEnd).toBeUndefined();

    // Just before validTo should be valid
    const beforeEnd = store.getValidAt(
      'fact-1',
      new Date(yesterday.getTime() - 1)
    );
    expect(beforeEnd).toBeDefined();
  });
});

// ============================================================================
// TEMPORAL FACT INTERFACE TESTS
// ============================================================================

describe('TemporalFact Interface', () => {
  it('should include all required fields', () => {
    const fact: TemporalFact<TestData> = {
      id: 'test-fact',
      data: { name: 'test', value: 42 },
      validFrom: yesterday,
      validTo: null,
      transactionFrom: now,
      transactionTo: null,
    };

    expect(fact.id).toBe('test-fact');
    expect(fact.data.name).toBe('test');
    expect(fact.validFrom).toEqual(yesterday);
    expect(fact.validTo).toBeNull();
    expect(fact.transactionFrom).toEqual(now);
    expect(fact.transactionTo).toBeNull();
  });

  it('should support nullable validTo and transactionTo', () => {
    const openFact: TemporalFact<TestData> = {
      id: 'open',
      data: { name: 'open', value: 1 },
      validFrom: yesterday,
      validTo: null,
      transactionFrom: now,
      transactionTo: null,
    };

    const closedFact: TemporalFact<TestData> = {
      id: 'closed',
      data: { name: 'closed', value: 2 },
      validFrom: threeDaysAgo,
      validTo: yesterday,
      transactionFrom: twoDaysAgo,
      transactionTo: now,
    };

    expect(openFact.validTo).toBeNull();
    expect(openFact.transactionTo).toBeNull();
    expect(closedFact.validTo).toEqual(yesterday);
    expect(closedFact.transactionTo).toEqual(now);
  });
});

// ============================================================================
// TEMPORAL QUERY INTERFACE TESTS
// ============================================================================

describe('TemporalQuery Interface', () => {
  it('should support optional query parameters', () => {
    const asOfQuery: TemporalQuery = { asOf: now };
    const validAtQuery: TemporalQuery = { validAt: yesterday };
    const validDuringQuery: TemporalQuery = {
      validDuring: { start: threeDaysAgo, end: yesterday },
    };
    const combinedQuery: TemporalQuery = {
      asOf: now,
      validAt: yesterday,
    };
    const emptyQuery: TemporalQuery = {};

    expect(asOfQuery.asOf).toEqual(now);
    expect(validAtQuery.validAt).toEqual(yesterday);
    expect(validDuringQuery.validDuring!.start).toEqual(threeDaysAgo);
    expect(combinedQuery.asOf).toEqual(now);
    expect(combinedQuery.validAt).toEqual(yesterday);
    expect(emptyQuery.asOf).toBeUndefined();
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('BitemporalStore - Edge Cases', () => {
  let store: BitemporalStore<TestData>;

  beforeEach(() => {
    store = createBitemporalStore<TestData>();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('should handle empty string ID', () => {
    store.add('', { name: 'empty-id', value: 0 }, yesterday);

    const fact = store.get('');
    expect(fact).toBeDefined();
    expect(fact!.id).toBe('');
  });

  it('should handle special characters in ID', () => {
    const specialId = 'fact/with:special@chars#123';
    store.add(specialId, { name: 'special', value: 1 }, yesterday);

    const fact = store.get(specialId);
    expect(fact).toBeDefined();
    expect(fact!.id).toBe(specialId);
  });

  it('should handle very old valid-time dates', () => {
    const veryOld = new Date('1900-01-01T00:00:00Z');
    store.add('fact-old', { name: 'old', value: 1 }, veryOld);

    const fact = store.get('fact-old');
    expect(fact).toBeDefined();
    expect(fact!.validFrom).toEqual(veryOld);
  });

  it('should handle future valid-time dates', () => {
    const future = new Date('2030-01-01T00:00:00Z');
    store.add('fact-future', { name: 'future', value: 1 }, future);

    const fact = store.get('fact-future');
    // Future valid facts should not be returned for current time query
    expect(fact).toBeUndefined();

    // But should be visible in history
    const history = store.getHistory('fact-future');
    expect(history.length).toBe(1);
  });

  it('should handle null data gracefully', () => {
    const nullStore = createBitemporalStore<null>();
    nullStore.add('fact-null', null, yesterday);

    const fact = nullStore.get('fact-null');
    expect(fact).toBeDefined();
    expect(fact!.data).toBeNull();
  });

  it('should handle complex nested data', () => {
    interface ComplexData {
      nested: {
        deep: {
          value: number;
        };
      };
      array: string[];
    }

    const complexStore = createBitemporalStore<ComplexData>();
    const complexData: ComplexData = {
      nested: { deep: { value: 42 } },
      array: ['a', 'b', 'c'],
    };

    complexStore.add('fact-complex', complexData, yesterday);

    const fact = complexStore.get('fact-complex');
    expect(fact!.data.nested.deep.value).toBe(42);
    expect(fact!.data.array).toEqual(['a', 'b', 'c']);
  });

  it('should handle rapid successive updates', () => {
    store.add('fact-rapid', { name: 'v0', value: 0 }, yesterday);

    for (let i = 1; i <= 100; i++) {
      vi.setSystemTime(new Date(now.getTime() + i));
      store.update('fact-rapid', { name: `v${i}`, value: i }, yesterday);
    }

    const fact = store.get('fact-rapid');
    expect(fact!.data.value).toBe(100);

    const history = store.getHistory('fact-rapid');
    expect(history.length).toBe(101);
  });

  it('should handle invalidate followed by add (re-creation)', () => {
    store.add('fact-recreate', { name: 'v1', value: 1 }, threeDaysAgo);
    vi.setSystemTime(new Date(now.getTime() + 1000));
    store.invalidate('fact-recreate', twoDaysAgo);
    vi.setSystemTime(new Date(now.getTime() + 2000));
    store.add('fact-recreate', { name: 'v2', value: 2 }, yesterday);

    const fact = store.get('fact-recreate');
    expect(fact).toBeDefined();
    expect(fact!.data.name).toBe('v2');

    const history = store.getHistory('fact-recreate');
    expect(history.length).toBe(3); // v1, invalidation, v2
  });

  it('should handle same valid-from time for different facts', () => {
    store.add('fact-a', { name: 'a', value: 1 }, yesterday);
    store.add('fact-b', { name: 'b', value: 2 }, yesterday);
    store.add('fact-c', { name: 'c', value: 3 }, yesterday);

    const allFacts = store.query(() => true);
    expect(allFacts.length).toBe(3);
  });

  it('should not return superseded versions in current query', () => {
    store.add('fact-1', { name: 'v1', value: 1 }, threeDaysAgo);
    vi.setSystemTime(new Date(now.getTime() + 1000));
    store.update('fact-1', { name: 'v2', value: 2 }, twoDaysAgo);

    const allFacts = store.query(() => true);
    // Only the current version should be returned
    expect(allFacts.length).toBe(1);
    expect(allFacts[0].data.name).toBe('v2');
  });
});

// ============================================================================
// CLEANUP
// ============================================================================

afterEach(() => {
  vi.useRealTimers();
});
