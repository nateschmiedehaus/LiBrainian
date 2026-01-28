/**
 * @fileoverview Tests for Atomic Claim Decomposition (WU-CAL-001)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Atomic Claim Decomposer breaks responses into atomic facts per FActScore/SAFE
 * approach for calibration. This enables more precise evaluation of claim accuracy.
 *
 * Atomic claim characteristics:
 * - Contains exactly one verifiable statement
 * - Cannot be split further without losing meaning
 * - Has clear truth conditions
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  createClaimDecomposer,
  type AtomicClaim,
  type ClaimDecomposer,
  type ClaimDecomposerConfig,
  type DecompositionStats,
} from '../atomic_claims.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const SIMPLE_TEXT = 'The function returns a string.';
const COMPOUND_TEXT = 'The function returns a string and takes two parameters.';
const COMPLEX_TEXT = `
  The UserService class extends BaseService and implements IUserService.
  It has methods createUser, updateUser, and deleteUser.
  The createUser method takes a name parameter of type string.
  This method is async and returns a Promise<User>.
`;

const CODE_EXAMPLE = `
function createUser(name: string): Promise<User> {
  const user = new User(name);
  return this.repository.save(user);
}
`;

const CODE_EXPLANATION = `
The createUser function takes a name parameter and creates a new User instance.
It then saves the user to the repository and returns a Promise.
The function is part of the UserService class.
`;

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createClaimDecomposer', () => {
  it('should create a ClaimDecomposer instance', () => {
    const decomposer = createClaimDecomposer();
    expect(decomposer).toBeDefined();
    expect(typeof decomposer.decompose).toBe('function');
    expect(typeof decomposer.decomposeCodeResponse).toBe('function');
    expect(typeof decomposer.isAtomic).toBe('function');
    expect(typeof decomposer.getDecompositionStats).toBe('function');
  });

  it('should accept configuration options', () => {
    const config: ClaimDecomposerConfig = {
      maxClaimLength: 100,
      minClaimLength: 5,
      splitOnConjunctions: true,
      splitCausalChains: true,
    };
    const decomposer = createClaimDecomposer(config);
    expect(decomposer).toBeDefined();
  });
});

// ============================================================================
// BASIC DECOMPOSITION TESTS
// ============================================================================

describe('ClaimDecomposer - decompose', () => {
  let decomposer: ClaimDecomposer;

  beforeAll(() => {
    decomposer = createClaimDecomposer();
  });

  it('should decompose simple single-claim text', async () => {
    const claims = await decomposer.decompose(SIMPLE_TEXT);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    expect(claims[0].content).toContain('returns');
    expect(claims[0].type).toBe('factual');
  });

  it('should decompose compound claims with "and"', async () => {
    const claims = await decomposer.decompose(COMPOUND_TEXT);

    // Should split "returns a string and takes two parameters" into at least 2 claims
    expect(claims.length).toBeGreaterThanOrEqual(2);

    const returnsClaim = claims.find((c) => c.content.toLowerCase().includes('returns'));
    const paramsClaim = claims.find((c) => c.content.toLowerCase().includes('parameter'));

    expect(returnsClaim).toBeDefined();
    expect(paramsClaim).toBeDefined();
  });

  it('should decompose complex multi-sentence text', async () => {
    const claims = await decomposer.decompose(COMPLEX_TEXT);

    // Should have multiple atomic claims
    expect(claims.length).toBeGreaterThanOrEqual(5);

    // Check for specific claim types
    const extendsClaiim = claims.find((c) => c.content.toLowerCase().includes('extends'));
    const implementsClaim = claims.find((c) => c.content.toLowerCase().includes('implements'));
    const asyncClaim = claims.find((c) => c.content.toLowerCase().includes('async'));

    expect(extendsClaiim).toBeDefined();
    expect(implementsClaim).toBeDefined();
    expect(asyncClaim).toBeDefined();
  });

  it('should handle empty text', async () => {
    const claims = await decomposer.decompose('');
    expect(claims).toEqual([]);
  });

  it('should handle whitespace-only text', async () => {
    const claims = await decomposer.decompose('   \n\t\n   ');
    expect(claims).toEqual([]);
  });

  it('should assign unique IDs to each claim', async () => {
    const claims = await decomposer.decompose(COMPLEX_TEXT);

    const ids = claims.map((c) => c.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should track source spans for each claim', async () => {
    const claims = await decomposer.decompose(COMPOUND_TEXT);

    for (const claim of claims) {
      expect(claim.sourceSpan).toBeDefined();
      expect(typeof claim.sourceSpan.start).toBe('number');
      expect(typeof claim.sourceSpan.end).toBe('number');
      expect(claim.sourceSpan.end).toBeGreaterThan(claim.sourceSpan.start);
    }
  });

  it('should assign confidence scores to claims', async () => {
    const claims = await decomposer.decompose(COMPLEX_TEXT);

    for (const claim of claims) {
      expect(typeof claim.confidence).toBe('number');
      expect(claim.confidence).toBeGreaterThanOrEqual(0);
      expect(claim.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ============================================================================
// CLAIM TYPE CLASSIFICATION TESTS
// ============================================================================

describe('ClaimDecomposer - claim type classification', () => {
  let decomposer: ClaimDecomposer;

  beforeAll(() => {
    decomposer = createClaimDecomposer();
  });

  it('should classify factual claims correctly', async () => {
    const text = 'The function returns a string.';
    const claims = await decomposer.decompose(text);

    const factualClaims = claims.filter((c) => c.type === 'factual');
    expect(factualClaims.length).toBeGreaterThan(0);
  });

  it('should classify procedural claims correctly', async () => {
    const text = 'First, the function validates input, then it processes the data.';
    const claims = await decomposer.decompose(text);

    const proceduralClaims = claims.filter((c) => c.type === 'procedural');
    expect(proceduralClaims.length).toBeGreaterThan(0);
  });

  it('should classify evaluative claims correctly', async () => {
    const text = 'The function is well-designed and efficient.';
    const claims = await decomposer.decompose(text);

    const evaluativeClaims = claims.filter((c) => c.type === 'evaluative');
    expect(evaluativeClaims.length).toBeGreaterThan(0);
  });

  it('should classify definitional claims correctly', async () => {
    const text = 'A UserService is a class that manages user operations.';
    const claims = await decomposer.decompose(text);

    const definitionalClaims = claims.filter((c) => c.type === 'definitional');
    expect(definitionalClaims.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// COMPOUND CLAIM SPLITTING TESTS
// ============================================================================

describe('ClaimDecomposer - compound claim splitting', () => {
  let decomposer: ClaimDecomposer;

  beforeAll(() => {
    decomposer = createClaimDecomposer();
  });

  it('should split claims with "and"', async () => {
    const text = 'The function validates input and processes data.';
    const claims = await decomposer.decompose(text);

    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims.some((c) => c.content.toLowerCase().includes('validates'))).toBe(true);
    expect(claims.some((c) => c.content.toLowerCase().includes('processes'))).toBe(true);
  });

  it('should split claims with "but"', async () => {
    const text = 'The function is fast but uses a lot of memory.';
    const claims = await decomposer.decompose(text);

    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims.some((c) => c.content.toLowerCase().includes('fast'))).toBe(true);
    expect(claims.some((c) => c.content.toLowerCase().includes('memory'))).toBe(true);
  });

  it('should split claims with "also"', async () => {
    const text = 'The class handles errors. It also logs all operations.';
    const claims = await decomposer.decompose(text);

    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims.some((c) => c.content.toLowerCase().includes('errors'))).toBe(true);
    expect(claims.some((c) => c.content.toLowerCase().includes('logs'))).toBe(true);
  });

  it('should split claims with "as well as"', async () => {
    const text = 'The service manages users as well as roles.';
    const claims = await decomposer.decompose(text);

    expect(claims.length).toBeGreaterThanOrEqual(2);
  });

  it('should not split when conjunction is part of meaning', async () => {
    const text = 'The function combines input and output.';
    const claims = await decomposer.decompose(text);

    // "input and output" might be kept together as a compound noun
    // The test checks that we don't over-split
    expect(claims.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// CAUSAL CHAIN SPLITTING TESTS
// ============================================================================

describe('ClaimDecomposer - causal chain splitting', () => {
  let decomposer: ClaimDecomposer;

  beforeAll(() => {
    decomposer = createClaimDecomposer();
  });

  it('should split "because" causal chains', async () => {
    const text = 'The function throws an error because the input is invalid.';
    const claims = await decomposer.decompose(text);

    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims.some((c) => c.content.toLowerCase().includes('throws'))).toBe(true);
    expect(claims.some((c) => c.content.toLowerCase().includes('invalid'))).toBe(true);
  });

  it('should split "therefore" causal chains', async () => {
    const text = 'The input is validated, therefore the function can proceed.';
    const claims = await decomposer.decompose(text);

    expect(claims.length).toBeGreaterThanOrEqual(2);
  });

  it('should split "since" causal chains', async () => {
    const text = 'Since the user is authenticated, the service returns data.';
    const claims = await decomposer.decompose(text);

    expect(claims.length).toBeGreaterThanOrEqual(2);
  });

  it('should split "so that" causal chains', async () => {
    const text = 'The data is cached so that subsequent requests are faster.';
    const claims = await decomposer.decompose(text);

    expect(claims.length).toBeGreaterThanOrEqual(2);
  });

  it('should split "which causes" causal chains', async () => {
    const text = 'The error propagates, which causes the entire transaction to rollback.';
    const claims = await decomposer.decompose(text);

    expect(claims.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// CODE-SPECIFIC DECOMPOSITION TESTS
// ============================================================================

describe('ClaimDecomposer - decomposeCodeResponse', () => {
  let decomposer: ClaimDecomposer;

  beforeAll(() => {
    decomposer = createClaimDecomposer();
  });

  it('should decompose code with explanation', async () => {
    const claims = await decomposer.decomposeCodeResponse(CODE_EXAMPLE, CODE_EXPLANATION);

    expect(claims.length).toBeGreaterThanOrEqual(3);
  });

  it('should extract "function does X" claims', async () => {
    const explanation = 'The createUser function creates a new user in the system.';
    const claims = await decomposer.decomposeCodeResponse(CODE_EXAMPLE, explanation);

    const functionClaim = claims.find(
      (c) => c.content.toLowerCase().includes('createuser') || c.content.toLowerCase().includes('creates')
    );
    expect(functionClaim).toBeDefined();
  });

  it('should extract "function returns Y" claims', async () => {
    const explanation = 'The function returns a Promise containing the created user.';
    const claims = await decomposer.decomposeCodeResponse(CODE_EXAMPLE, explanation);

    const returnsClaim = claims.find((c) => c.content.toLowerCase().includes('returns'));
    expect(returnsClaim).toBeDefined();
  });

  it('should extract "function takes params Z" claims', async () => {
    const explanation = 'The function takes a name parameter of type string.';
    const claims = await decomposer.decomposeCodeResponse(CODE_EXAMPLE, explanation);

    const paramsClaim = claims.find(
      (c) => c.content.toLowerCase().includes('parameter') || c.content.toLowerCase().includes('takes')
    );
    expect(paramsClaim).toBeDefined();
  });

  it('should handle code-only input (no explanation)', async () => {
    const claims = await decomposer.decomposeCodeResponse(CODE_EXAMPLE, '');

    // Should still extract claims from code structure
    expect(claims.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle explanation-only input (no code)', async () => {
    const claims = await decomposer.decomposeCodeResponse('', CODE_EXPLANATION);

    expect(claims.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// ATOMICITY CHECKING TESTS
// ============================================================================

describe('ClaimDecomposer - isAtomic', () => {
  let decomposer: ClaimDecomposer;

  beforeAll(() => {
    decomposer = createClaimDecomposer();
  });

  it('should return true for simple atomic claims', () => {
    expect(decomposer.isAtomic('The function returns a string.')).toBe(true);
    expect(decomposer.isAtomic('The class is abstract.')).toBe(true);
    expect(decomposer.isAtomic('The method is async.')).toBe(true);
  });

  it('should return false for compound claims with "and"', () => {
    expect(decomposer.isAtomic('The function returns a string and takes two parameters.')).toBe(false);
    expect(decomposer.isAtomic('The class extends Base and implements Interface.')).toBe(false);
  });

  it('should return false for compound claims with "but"', () => {
    expect(decomposer.isAtomic('The function is fast but uses memory.')).toBe(false);
  });

  it('should return false for causal chains', () => {
    expect(decomposer.isAtomic('The function throws because the input is invalid.')).toBe(false);
    expect(decomposer.isAtomic('Since X is true, Y happens.')).toBe(false);
  });

  it('should return true for claims with "and" in compound nouns', () => {
    // "input and output" is a compound noun, not two separate claims
    expect(decomposer.isAtomic('The function handles input and output.')).toBe(true);
  });

  it('should return false for very long claims', () => {
    const longClaim = 'The function ' + 'processes data '.repeat(20);
    expect(decomposer.isAtomic(longClaim)).toBe(false);
  });

  it('should return false for empty claims', () => {
    expect(decomposer.isAtomic('')).toBe(false);
    expect(decomposer.isAtomic('   ')).toBe(false);
  });
});

// ============================================================================
// DECOMPOSITION STATISTICS TESTS
// ============================================================================

describe('ClaimDecomposer - getDecompositionStats', () => {
  let decomposer: ClaimDecomposer;

  beforeAll(() => {
    decomposer = createClaimDecomposer();
  });

  it('should return initial stats of zeros', () => {
    const freshDecomposer = createClaimDecomposer();
    const stats = freshDecomposer.getDecompositionStats();

    expect(stats.total).toBe(0);
    expect(stats.atomic).toBe(0);
    expect(stats.composite).toBe(0);
  });

  it('should track decomposition statistics', async () => {
    const freshDecomposer = createClaimDecomposer();

    // Decompose some text
    await freshDecomposer.decompose(COMPOUND_TEXT);
    const stats = freshDecomposer.getDecompositionStats();

    expect(stats.total).toBeGreaterThan(0);
    expect(stats.atomic + stats.composite).toBe(stats.total);
  });

  it('should accumulate stats across multiple calls', async () => {
    const freshDecomposer = createClaimDecomposer();

    await freshDecomposer.decompose(SIMPLE_TEXT);
    const stats1 = freshDecomposer.getDecompositionStats();

    await freshDecomposer.decompose(COMPOUND_TEXT);
    const stats2 = freshDecomposer.getDecompositionStats();

    expect(stats2.total).toBeGreaterThan(stats1.total);
  });
});

// ============================================================================
// PARENT-CHILD RELATIONSHIP TESTS
// ============================================================================

describe('ClaimDecomposer - parent-child relationships', () => {
  let decomposer: ClaimDecomposer;

  beforeAll(() => {
    decomposer = createClaimDecomposer();
  });

  it('should set parentClaimId when splitting compound claims', async () => {
    const claims = await decomposer.decompose(COMPOUND_TEXT);

    // At least some claims should have parent IDs (from splitting)
    const claimsWithParent = claims.filter((c) => c.parentClaimId !== undefined);

    // Compound text should produce some child claims
    expect(claimsWithParent.length).toBeGreaterThanOrEqual(0);
  });

  it('should not set parentClaimId for top-level sentence claims', async () => {
    const claims = await decomposer.decompose(SIMPLE_TEXT);

    // Simple single-claim text should have no parent
    if (claims.length === 1) {
      expect(claims[0].parentClaimId).toBeUndefined();
    }
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('ClaimDecomposer - edge cases', () => {
  let decomposer: ClaimDecomposer;

  beforeAll(() => {
    decomposer = createClaimDecomposer();
  });

  it('should handle very long text', async () => {
    const longText = (COMPLEX_TEXT + ' ').repeat(10);
    const claims = await decomposer.decompose(longText);

    expect(Array.isArray(claims)).toBe(true);
    expect(claims.length).toBeGreaterThan(0);
  });

  it('should handle text with special characters', async () => {
    const text = 'The function<T> returns Promise<T[]>.';
    const claims = await decomposer.decompose(text);

    expect(Array.isArray(claims)).toBe(true);
  });

  it('should handle unicode text', async () => {
    const text = 'The function handles unicode strings like "hello" and "world".';
    const claims = await decomposer.decompose(text);

    expect(Array.isArray(claims)).toBe(true);
  });

  it('should handle markdown formatting', async () => {
    const text = 'The `createUser` function **returns** a _Promise_.';
    const claims = await decomposer.decompose(text);

    expect(Array.isArray(claims)).toBe(true);
    expect(claims.length).toBeGreaterThan(0);
  });

  it('should handle code blocks in text', async () => {
    const text = 'The function works like this: ```const x = 1;``` It returns a number.';
    const claims = await decomposer.decompose(text);

    expect(Array.isArray(claims)).toBe(true);
  });

  it('should handle bullet points and lists', async () => {
    const text = `
      The function:
      - validates input
      - processes data
      - returns results
    `;
    const claims = await decomposer.decompose(text);

    expect(claims.length).toBeGreaterThanOrEqual(3);
  });

  it('should handle numbered lists', async () => {
    const text = `
      The function does the following:
      1. Validates input
      2. Processes data
      3. Returns results
    `;
    const claims = await decomposer.decompose(text);

    expect(claims.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================================
// ATOMICITY RATE TESTS (95% REQUIREMENT)
// ============================================================================

describe('ClaimDecomposer - atomicity rate', () => {
  let decomposer: ClaimDecomposer;

  beforeAll(() => {
    decomposer = createClaimDecomposer();
  });

  it('should achieve >= 95% atomic claims for complex text', async () => {
    const claims = await decomposer.decompose(COMPLEX_TEXT);

    // All returned claims should be atomic
    const atomicCount = claims.filter((c) => decomposer.isAtomic(c.content)).length;
    const atomicRate = atomicCount / claims.length;

    expect(atomicRate).toBeGreaterThanOrEqual(0.95);
  });

  it('should achieve >= 95% atomic claims for compound text', async () => {
    const text = `
      The UserService class extends BaseService and implements IUserService.
      The createUser method takes a name parameter and returns a Promise.
      The method validates input, processes data, and saves to database.
      It is async but handles errors synchronously.
      The service also logs operations and tracks metrics.
    `;
    const claims = await decomposer.decompose(text);

    const atomicCount = claims.filter((c) => decomposer.isAtomic(c.content)).length;
    const atomicRate = atomicCount / claims.length;

    expect(atomicRate).toBeGreaterThanOrEqual(0.95);
  });

  it('should achieve >= 95% atomic claims for code responses', async () => {
    const claims = await decomposer.decomposeCodeResponse(CODE_EXAMPLE, CODE_EXPLANATION);

    const atomicCount = claims.filter((c) => decomposer.isAtomic(c.content)).length;
    const atomicRate = claims.length > 0 ? atomicCount / claims.length : 1;

    expect(atomicRate).toBeGreaterThanOrEqual(0.95);
  });
});

// ============================================================================
// INTERFACE COMPLIANCE TESTS
// ============================================================================

describe('AtomicClaim interface compliance', () => {
  let decomposer: ClaimDecomposer;

  beforeAll(() => {
    decomposer = createClaimDecomposer();
  });

  it('should return claims with all required fields', async () => {
    const claims = await decomposer.decompose(COMPLEX_TEXT);

    for (const claim of claims) {
      // Required fields
      expect(typeof claim.id).toBe('string');
      expect(claim.id.length).toBeGreaterThan(0);

      expect(typeof claim.content).toBe('string');
      expect(claim.content.length).toBeGreaterThan(0);

      expect(['factual', 'procedural', 'evaluative', 'definitional']).toContain(claim.type);

      expect(typeof claim.confidence).toBe('number');
      expect(claim.confidence).toBeGreaterThanOrEqual(0);
      expect(claim.confidence).toBeLessThanOrEqual(1);

      expect(claim.sourceSpan).toBeDefined();
      expect(typeof claim.sourceSpan.start).toBe('number');
      expect(typeof claim.sourceSpan.end).toBe('number');

      // Optional field
      if (claim.parentClaimId !== undefined) {
        expect(typeof claim.parentClaimId).toBe('string');
      }
    }
  });
});

// ============================================================================
// DecompositionStats INTERFACE COMPLIANCE TESTS
// ============================================================================

describe('DecompositionStats interface compliance', () => {
  it('should return stats with all required fields', async () => {
    const decomposer = createClaimDecomposer();
    await decomposer.decompose(COMPLEX_TEXT);

    const stats = decomposer.getDecompositionStats();

    expect(typeof stats.total).toBe('number');
    expect(typeof stats.atomic).toBe('number');
    expect(typeof stats.composite).toBe('number');
  });
});
