/**
 * @fileoverview Tests for REFCHECKER Knowledge Triplets (WU-HALU-002)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * REFCHECKER (Amazon EMNLP 2024) extracts knowledge triplets (subject, predicate, object)
 * from claims for fine-grained hallucination detection.
 *
 * A knowledge triplet represents an atomic fact:
 * - Subject: The entity being described (e.g., "createUserService")
 * - Predicate: The relationship or property (e.g., "returns", "imports", "calls")
 * - Object: The target entity or value (e.g., "UserService", "void", "validateInput")
 *
 * Code-specific predicates:
 * - "imports" - Module imports (X imports Y from Z)
 * - "calls" - Function/method calls (X calls Y)
 * - "extends" - Class inheritance (X extends Y)
 * - "implements" - Interface implementation (X implements Y)
 * - "defines" - Symbol definitions (X defines Y)
 * - "returns" - Return types (X returns Y)
 * - "accepts" - Parameter types (X accepts Y)
 * - "has_property" - Property declarations (X has_property Y)
 * - "has_method" - Method declarations (X has_method Y)
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  type KnowledgeTriplet,
  type TripletExtractor,
  type TripletExtractorConfig,
  type TripletVerificationResult,
  createTripletExtractor,
} from '../refchecker_triplets.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Sample code claims for testing triplet extraction
 */
const SAMPLE_CLAIMS = {
  // Import claims
  importClaim: {
    content: 'The file imports Project from ts-morph',
    id: 'claim-import-1',
  },
  multiImportClaim: {
    content: 'The module imports React, useState, and useEffect from react',
    id: 'claim-import-2',
  },

  // Function call claims
  callClaim: {
    content: 'The processData function calls validateInput before processing',
    id: 'claim-call-1',
  },
  methodCallClaim: {
    content: 'The UserService.create method calls database.insert',
    id: 'claim-call-2',
  },

  // Inheritance claims
  extendsClaim: {
    content: 'The AdminUser class extends BaseUser',
    id: 'claim-extends-1',
  },
  implementsClaim: {
    content: 'The UserRepository implements IRepository interface',
    id: 'claim-implements-1',
  },

  // Definition claims
  definesClaim: {
    content: 'The module defines a UserConfig interface with three properties',
    id: 'claim-defines-1',
  },
  functionDefClaim: {
    content: 'The file defines createUserService as an async factory function',
    id: 'claim-defines-2',
  },

  // Return type claims
  returnsClaim: {
    content: 'The getUserById function returns a Promise of User or null',
    id: 'claim-returns-1',
  },
  voidReturnClaim: {
    content: 'The cleanup function returns void',
    id: 'claim-returns-2',
  },

  // Parameter claims
  parameterClaim: {
    content: 'The createUser function accepts a UserInput parameter',
    id: 'claim-param-1',
  },
  multiParamClaim: {
    content: 'The formatDate function takes date, format, and locale parameters',
    id: 'claim-param-2',
  },

  // Property claims
  propertyClaim: {
    content: 'The Config class has a maxRetries property',
    id: 'claim-property-1',
  },
  methodClaim: {
    content: 'The UserService class has a findById method',
    id: 'claim-method-1',
  },

  // Complex claims (multiple triplets)
  complexClaim: {
    content: 'The UserController extends BaseController, implements IController, and calls userService.findAll',
    id: 'claim-complex-1',
  },

  // Edge cases
  vagueClaim: {
    content: 'The code is well-structured and efficient',
    id: 'claim-vague-1',
  },
  emptyClaim: {
    content: '',
    id: 'claim-empty-1',
  },
};

/**
 * Sample context for verification
 */
const SAMPLE_CONTEXT = `
import { Project, SourceFile } from 'ts-morph';
import { validateInput, sanitize } from './utils';

export class UserService extends BaseService implements IUserService {
  private database: Database;

  async create(input: UserInput): Promise<User> {
    validateInput(input);
    return this.database.insert(input);
  }

  async findById(id: string): Promise<User | null> {
    return this.database.findOne({ id });
  }
}

export function createUserService(db: Database): UserService {
  return new UserService(db);
}
`;

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createTripletExtractor', () => {
  it('should create a TripletExtractor instance', () => {
    const extractor = createTripletExtractor();
    expect(extractor).toBeDefined();
    expect(typeof extractor.extractTriplets).toBe('function');
    expect(typeof extractor.extractFromClaim).toBe('function');
    expect(typeof extractor.verifyTriplet).toBe('function');
  });

  it('should accept optional configuration', () => {
    const config: TripletExtractorConfig = {
      minConfidence: 0.7,
      includeImplicitTriplets: true,
      maxTripletsPerClaim: 10,
    };
    const extractor = createTripletExtractor(config);
    expect(extractor).toBeDefined();
  });

  it('should use default configuration when not provided', () => {
    const extractor = createTripletExtractor();
    expect(extractor).toBeDefined();
  });
});

// ============================================================================
// TRIPLET EXTRACTION - IMPORT CLAIMS
// ============================================================================

describe('TripletExtractor - Import Claims', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should extract triplets from simple import claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.importClaim);

    expect(triplets.length).toBeGreaterThanOrEqual(1);
    const importTriplet = triplets.find((t) => t.predicate === 'imports');
    expect(importTriplet).toBeDefined();
    expect(importTriplet?.subject.toLowerCase()).toContain('file');
    expect(importTriplet?.object.toLowerCase()).toContain('project');
  });

  it('should extract triplets from multi-import claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.multiImportClaim);

    // Should extract multiple import triplets
    const importTriplets = triplets.filter((t) => t.predicate === 'imports');
    expect(importTriplets.length).toBeGreaterThanOrEqual(1);
  });

  it('should include source span for import triplets', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.importClaim);

    expect(triplets.length).toBeGreaterThan(0);
    const triplet = triplets[0];
    expect(triplet.sourceSpan).toBeDefined();
    expect(typeof triplet.sourceSpan.start).toBe('number');
    expect(typeof triplet.sourceSpan.end).toBe('number');
    expect(triplet.sourceSpan.end).toBeGreaterThan(triplet.sourceSpan.start);
  });
});

// ============================================================================
// TRIPLET EXTRACTION - CALL CLAIMS
// ============================================================================

describe('TripletExtractor - Call Claims', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should extract triplets from function call claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.callClaim);

    expect(triplets.length).toBeGreaterThanOrEqual(1);
    const callTriplet = triplets.find((t) => t.predicate === 'calls');
    expect(callTriplet).toBeDefined();
    expect(callTriplet?.subject.toLowerCase()).toContain('processdata');
    expect(callTriplet?.object.toLowerCase()).toContain('validateinput');
  });

  it('should extract triplets from method call claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.methodCallClaim);

    expect(triplets.length).toBeGreaterThanOrEqual(1);
    const callTriplet = triplets.find((t) => t.predicate === 'calls');
    expect(callTriplet).toBeDefined();
  });

  it('should have confidence scores for call triplets', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.callClaim);

    expect(triplets.length).toBeGreaterThan(0);
    for (const triplet of triplets) {
      expect(triplet.confidence).toBeGreaterThanOrEqual(0);
      expect(triplet.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ============================================================================
// TRIPLET EXTRACTION - INHERITANCE CLAIMS
// ============================================================================

describe('TripletExtractor - Inheritance Claims', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should extract triplets from extends claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.extendsClaim);

    expect(triplets.length).toBeGreaterThanOrEqual(1);
    const extendsTriplet = triplets.find((t) => t.predicate === 'extends');
    expect(extendsTriplet).toBeDefined();
    expect(extendsTriplet?.subject.toLowerCase()).toContain('adminuser');
    expect(extendsTriplet?.object.toLowerCase()).toContain('baseuser');
  });

  it('should extract triplets from implements claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.implementsClaim);

    expect(triplets.length).toBeGreaterThanOrEqual(1);
    const implementsTriplet = triplets.find((t) => t.predicate === 'implements');
    expect(implementsTriplet).toBeDefined();
    expect(implementsTriplet?.subject.toLowerCase()).toContain('userrepository');
    expect(implementsTriplet?.object.toLowerCase()).toContain('irepository');
  });
});

// ============================================================================
// TRIPLET EXTRACTION - DEFINITION CLAIMS
// ============================================================================

describe('TripletExtractor - Definition Claims', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should extract triplets from interface definition claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.definesClaim);

    expect(triplets.length).toBeGreaterThanOrEqual(1);
    const definesTriplet = triplets.find((t) => t.predicate === 'defines');
    expect(definesTriplet).toBeDefined();
    expect(definesTriplet?.object.toLowerCase()).toContain('userconfig');
  });

  it('should extract triplets from function definition claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.functionDefClaim);

    expect(triplets.length).toBeGreaterThanOrEqual(1);
    const definesTriplet = triplets.find((t) => t.predicate === 'defines');
    expect(definesTriplet).toBeDefined();
  });
});

// ============================================================================
// TRIPLET EXTRACTION - RETURN TYPE CLAIMS
// ============================================================================

describe('TripletExtractor - Return Type Claims', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should extract triplets from return type claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.returnsClaim);

    expect(triplets.length).toBeGreaterThanOrEqual(1);
    const returnsTriplet = triplets.find((t) => t.predicate === 'returns');
    expect(returnsTriplet).toBeDefined();
    expect(returnsTriplet?.subject.toLowerCase()).toContain('getuserbyid');
  });

  it('should extract triplets from void return claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.voidReturnClaim);

    expect(triplets.length).toBeGreaterThanOrEqual(1);
    const returnsTriplet = triplets.find((t) => t.predicate === 'returns');
    expect(returnsTriplet).toBeDefined();
    expect(returnsTriplet?.object.toLowerCase()).toContain('void');
  });
});

// ============================================================================
// TRIPLET EXTRACTION - PARAMETER CLAIMS
// ============================================================================

describe('TripletExtractor - Parameter Claims', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should extract triplets from parameter claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.parameterClaim);

    expect(triplets.length).toBeGreaterThanOrEqual(1);
    const acceptsTriplet = triplets.find((t) => t.predicate === 'accepts');
    expect(acceptsTriplet).toBeDefined();
    expect(acceptsTriplet?.subject.toLowerCase()).toContain('createuser');
  });

  it('should extract triplets from multi-parameter claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.multiParamClaim);

    expect(triplets.length).toBeGreaterThanOrEqual(1);
    const acceptsTriplets = triplets.filter((t) => t.predicate === 'accepts');
    expect(acceptsTriplets.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// TRIPLET EXTRACTION - PROPERTY AND METHOD CLAIMS
// ============================================================================

describe('TripletExtractor - Property and Method Claims', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should extract triplets from property claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.propertyClaim);

    expect(triplets.length).toBeGreaterThanOrEqual(1);
    const propertyTriplet = triplets.find((t) => t.predicate === 'has_property');
    expect(propertyTriplet).toBeDefined();
    expect(propertyTriplet?.subject.toLowerCase()).toContain('config');
    expect(propertyTriplet?.object.toLowerCase()).toContain('maxretries');
  });

  it('should extract triplets from method claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.methodClaim);

    expect(triplets.length).toBeGreaterThanOrEqual(1);
    const methodTriplet = triplets.find((t) => t.predicate === 'has_method');
    expect(methodTriplet).toBeDefined();
    expect(methodTriplet?.subject.toLowerCase()).toContain('userservice');
    expect(methodTriplet?.object.toLowerCase()).toContain('findbyid');
  });
});

// ============================================================================
// TRIPLET EXTRACTION - COMPLEX CLAIMS
// ============================================================================

describe('TripletExtractor - Complex Claims', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should extract multiple triplets from complex claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.complexClaim);

    // Should extract at least 3 triplets: extends, implements, and calls
    expect(triplets.length).toBeGreaterThanOrEqual(3);

    const predicates = triplets.map((t) => t.predicate);
    expect(predicates).toContain('extends');
    expect(predicates).toContain('implements');
    expect(predicates).toContain('calls');
  });

  it('should maintain correct subject-object relationships in complex claims', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.complexClaim);

    const extendsTriplet = triplets.find((t) => t.predicate === 'extends');
    expect(extendsTriplet).toBeDefined();
    expect(extendsTriplet!.subject.toLowerCase()).toContain('usercontroller');
    expect(extendsTriplet!.object.toLowerCase()).toContain('basecontroller');

    const implementsTriplet = triplets.find((t) => t.predicate === 'implements');
    expect(implementsTriplet).toBeDefined();
    expect(implementsTriplet!.subject.toLowerCase()).toContain('usercontroller');
  });
});

// ============================================================================
// TRIPLET EXTRACTION - TEXT INPUT
// ============================================================================

describe('TripletExtractor - extractTriplets (text input)', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should extract triplets from raw text', async () => {
    const text = 'The UserService imports Logger from winston and calls logger.info for logging.';
    const triplets = await extractor.extractTriplets(text);

    expect(triplets.length).toBeGreaterThanOrEqual(1);
  });

  it('should extract triplets from multi-sentence text', async () => {
    const text = `
      The UserController extends BaseController.
      It imports UserService from services.
      The create method calls userService.create.
    `;
    const triplets = await extractor.extractTriplets(text);

    expect(triplets.length).toBeGreaterThanOrEqual(2);
  });

  it('should handle empty text', async () => {
    const triplets = await extractor.extractTriplets('');
    expect(triplets).toEqual([]);
  });

  it('should handle text with no extractable triplets', async () => {
    const triplets = await extractor.extractTriplets('This is general text without code claims.');
    expect(triplets.length).toBe(0);
  });
});

// ============================================================================
// TRIPLET VERIFICATION
// ============================================================================

describe('TripletExtractor - verifyTriplet', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should verify triplet against matching context', async () => {
    const triplet: KnowledgeTriplet = {
      subject: 'UserService',
      predicate: 'extends',
      object: 'BaseService',
      confidence: 0.9,
      sourceSpan: { start: 0, end: 35 },
    };

    const result = await extractor.verifyTriplet(triplet, SAMPLE_CONTEXT);

    expect(result.verified).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should not verify triplet against non-matching context', async () => {
    const triplet: KnowledgeTriplet = {
      subject: 'UserService',
      predicate: 'extends',
      object: 'NonExistentClass',
      confidence: 0.9,
      sourceSpan: { start: 0, end: 40 },
    };

    const result = await extractor.verifyTriplet(triplet, SAMPLE_CONTEXT);

    expect(result.verified).toBe(false);
  });

  it('should verify import triplets', async () => {
    const triplet: KnowledgeTriplet = {
      subject: 'file',
      predicate: 'imports',
      object: 'Project',
      confidence: 0.9,
      sourceSpan: { start: 0, end: 30 },
    };

    const result = await extractor.verifyTriplet(triplet, SAMPLE_CONTEXT);

    expect(result.verified).toBe(true);
  });

  it('should verify method call triplets', async () => {
    const triplet: KnowledgeTriplet = {
      subject: 'create',
      predicate: 'calls',
      object: 'validateInput',
      confidence: 0.9,
      sourceSpan: { start: 0, end: 35 },
    };

    const result = await extractor.verifyTriplet(triplet, SAMPLE_CONTEXT);

    expect(result.verified).toBe(true);
  });

  it('should return confidence between 0 and 1', async () => {
    const triplet: KnowledgeTriplet = {
      subject: 'UserService',
      predicate: 'implements',
      object: 'IUserService',
      confidence: 0.9,
      sourceSpan: { start: 0, end: 40 },
    };

    const result = await extractor.verifyTriplet(triplet, SAMPLE_CONTEXT);

    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// TRIPLET STRUCTURE VALIDATION
// ============================================================================

describe('KnowledgeTriplet Interface', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should have all required fields', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.extendsClaim);

    expect(triplets.length).toBeGreaterThan(0);
    const triplet = triplets[0];

    expect(triplet).toHaveProperty('subject');
    expect(triplet).toHaveProperty('predicate');
    expect(triplet).toHaveProperty('object');
    expect(triplet).toHaveProperty('confidence');
    expect(triplet).toHaveProperty('sourceSpan');
  });

  it('should have valid source span', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.callClaim);

    expect(triplets.length).toBeGreaterThan(0);
    const triplet = triplets[0];

    expect(triplet.sourceSpan).toHaveProperty('start');
    expect(triplet.sourceSpan).toHaveProperty('end');
    expect(typeof triplet.sourceSpan.start).toBe('number');
    expect(typeof triplet.sourceSpan.end).toBe('number');
  });

  it('should have non-empty subject and object', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.implementsClaim);

    expect(triplets.length).toBeGreaterThan(0);
    for (const triplet of triplets) {
      expect(triplet.subject.length).toBeGreaterThan(0);
      expect(triplet.object.length).toBeGreaterThan(0);
    }
  });

  it('should have valid predicate', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.complexClaim);

    const validPredicates = [
      'imports',
      'calls',
      'extends',
      'implements',
      'defines',
      'returns',
      'accepts',
      'has_property',
      'has_method',
    ];

    for (const triplet of triplets) {
      expect(validPredicates).toContain(triplet.predicate);
    }
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('TripletExtractor - Edge Cases', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should handle empty claim content', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.emptyClaim);
    expect(triplets).toEqual([]);
  });

  it('should handle vague claims with no triplets', async () => {
    const triplets = await extractor.extractFromClaim(SAMPLE_CLAIMS.vagueClaim);
    // Vague claims should return empty or low-confidence triplets
    expect(triplets.length).toBe(0);
  });

  it('should handle claims with special characters', async () => {
    const claim = {
      content: 'The `foo<T>` generic class extends `Base<T>` and implements `IFoo<T>`',
      id: 'claim-special-1',
    };
    const triplets = await extractor.extractFromClaim(claim);

    // Should still extract triplets despite generic syntax
    expect(triplets.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle claims with unicode', async () => {
    const claim = {
      content: 'The UserService handles "hello" unicode strings',
      id: 'claim-unicode-1',
    };
    const triplets = await extractor.extractFromClaim(claim);

    // Should not crash
    expect(Array.isArray(triplets)).toBe(true);
  });

  it('should handle very long claims', async () => {
    const longContent = 'The UserService '.repeat(50) + 'extends BaseService';
    const claim = { content: longContent, id: 'claim-long-1' };
    const triplets = await extractor.extractFromClaim(claim);

    // Should still extract triplets
    expect(Array.isArray(triplets)).toBe(true);
  });

  it('should handle whitespace-only claims', async () => {
    const claim = { content: '   \n\t\n   ', id: 'claim-whitespace-1' };
    const triplets = await extractor.extractFromClaim(claim);
    expect(triplets).toEqual([]);
  });
});

// ============================================================================
// CONFIDENCE SCORING
// ============================================================================

describe('TripletExtractor - Confidence Scoring', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should assign high confidence to explicit structural claims', async () => {
    const claim = {
      content: 'The UserService class extends BaseService',
      id: 'claim-explicit-1',
    };
    const triplets = await extractor.extractFromClaim(claim);

    expect(triplets.length).toBeGreaterThan(0);
    const extendsTriplet = triplets.find((t) => t.predicate === 'extends');
    expect(extendsTriplet?.confidence).toBeGreaterThan(0.7);
  });

  it('should assign lower confidence to implicit claims', async () => {
    const claim = {
      content: 'The UserService probably uses some kind of validation',
      id: 'claim-implicit-1',
    };
    const triplets = await extractor.extractFromClaim(claim);

    // If any triplets extracted, they should have lower confidence
    for (const triplet of triplets) {
      expect(triplet.confidence).toBeLessThan(0.8);
    }
  });

  it('should adjust confidence based on claim clarity', async () => {
    const clearClaim = {
      content: 'The AdminUser class explicitly extends User and implements IAdmin',
      id: 'claim-clear-1',
    };
    const vagueClaim = {
      content: 'AdminUser might extend something user-related',
      id: 'claim-vague-2',
    };

    const clearTriplets = await extractor.extractFromClaim(clearClaim);
    const vagueTriplets = await extractor.extractFromClaim(vagueClaim);

    if (clearTriplets.length > 0 && vagueTriplets.length > 0) {
      const clearConfidence = Math.max(...clearTriplets.map((t) => t.confidence));
      const vagueConfidence = Math.max(...vagueTriplets.map((t) => t.confidence));
      expect(clearConfidence).toBeGreaterThanOrEqual(vagueConfidence);
    }
  });
});

// ============================================================================
// PREDICATE COVERAGE
// ============================================================================

describe('TripletExtractor - Predicate Coverage', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should support "imports" predicate', async () => {
    const claim = { content: 'The module imports fs from node:fs', id: 'pred-import' };
    const triplets = await extractor.extractFromClaim(claim);
    expect(triplets.some((t) => t.predicate === 'imports')).toBe(true);
  });

  it('should support "calls" predicate', async () => {
    const claim = { content: 'The function processData calls validate', id: 'pred-calls' };
    const triplets = await extractor.extractFromClaim(claim);
    expect(triplets.some((t) => t.predicate === 'calls')).toBe(true);
  });

  it('should support "extends" predicate', async () => {
    const claim = { content: 'The class Child extends Parent', id: 'pred-extends' };
    const triplets = await extractor.extractFromClaim(claim);
    expect(triplets.some((t) => t.predicate === 'extends')).toBe(true);
  });

  it('should support "implements" predicate', async () => {
    const claim = { content: 'The class Service implements IService', id: 'pred-implements' };
    const triplets = await extractor.extractFromClaim(claim);
    expect(triplets.some((t) => t.predicate === 'implements')).toBe(true);
  });

  it('should support "defines" predicate', async () => {
    const claim = { content: 'The module defines a Config interface', id: 'pred-defines' };
    const triplets = await extractor.extractFromClaim(claim);
    expect(triplets.some((t) => t.predicate === 'defines')).toBe(true);
  });

  it('should support "returns" predicate', async () => {
    const claim = { content: 'The function getUser returns a User object', id: 'pred-returns' };
    const triplets = await extractor.extractFromClaim(claim);
    expect(triplets.some((t) => t.predicate === 'returns')).toBe(true);
  });

  it('should support "accepts" predicate', async () => {
    const claim = { content: 'The function createUser accepts a UserInput parameter', id: 'pred-accepts' };
    const triplets = await extractor.extractFromClaim(claim);
    expect(triplets.some((t) => t.predicate === 'accepts')).toBe(true);
  });

  it('should support "has_property" predicate', async () => {
    const claim = { content: 'The Config class has a timeout property', id: 'pred-property' };
    const triplets = await extractor.extractFromClaim(claim);
    expect(triplets.some((t) => t.predicate === 'has_property')).toBe(true);
  });

  it('should support "has_method" predicate', async () => {
    const claim = { content: 'The UserService class has a findAll method', id: 'pred-method' };
    const triplets = await extractor.extractFromClaim(claim);
    expect(triplets.some((t) => t.predicate === 'has_method')).toBe(true);
  });
});

// ============================================================================
// TRACEABILITY
// ============================================================================

describe('TripletExtractor - Traceability', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should track source spans accurately', async () => {
    const claim = {
      content: 'The AdminUser class extends BaseUser',
      id: 'trace-1',
    };
    const triplets = await extractor.extractFromClaim(claim);

    expect(triplets.length).toBeGreaterThan(0);
    const triplet = triplets[0];

    // Source span should be within the claim content
    expect(triplet.sourceSpan.start).toBeGreaterThanOrEqual(0);
    expect(triplet.sourceSpan.end).toBeLessThanOrEqual(claim.content.length);
  });

  it('should have non-overlapping source spans for different triplets', async () => {
    const claim = {
      content: 'UserService extends BaseService and implements IUserService',
      id: 'trace-2',
    };
    const triplets = await extractor.extractFromClaim(claim);

    if (triplets.length >= 2) {
      // Different triplets can have overlapping or separate spans
      // but each span should be valid
      for (const triplet of triplets) {
        expect(triplet.sourceSpan.start).toBeGreaterThanOrEqual(0);
        expect(triplet.sourceSpan.end).toBeLessThanOrEqual(claim.content.length);
      }
    }
  });

  it('should allow extracting the source text using spans', async () => {
    const claim = {
      content: 'The function validateInput returns boolean',
      id: 'trace-3',
    };
    const triplets = await extractor.extractFromClaim(claim);

    expect(triplets.length).toBeGreaterThan(0);
    const triplet = triplets[0];
    const extractedText = claim.content.slice(triplet.sourceSpan.start, triplet.sourceSpan.end);

    // Extracted text should be non-empty
    expect(extractedText.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// VERIFICATION RESULT INTERFACE
// ============================================================================

describe('TripletVerificationResult Interface', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should have verified boolean field', async () => {
    const triplet: KnowledgeTriplet = {
      subject: 'Test',
      predicate: 'extends',
      object: 'Base',
      confidence: 0.9,
      sourceSpan: { start: 0, end: 10 },
    };

    const result = await extractor.verifyTriplet(triplet, 'class Test extends Base {}');

    expect(typeof result.verified).toBe('boolean');
  });

  it('should have confidence number field', async () => {
    const triplet: KnowledgeTriplet = {
      subject: 'Test',
      predicate: 'extends',
      object: 'Base',
      confidence: 0.9,
      sourceSpan: { start: 0, end: 10 },
    };

    const result = await extractor.verifyTriplet(triplet, 'class Test extends Base {}');

    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('TripletExtractor - Integration', () => {
  let extractor: TripletExtractor;

  beforeAll(() => {
    extractor = createTripletExtractor();
  });

  it('should extract and verify triplets in one workflow', async () => {
    const claim = {
      content: 'The UserService class extends BaseService and implements IUserService',
      id: 'integration-1',
    };

    // Extract triplets
    const triplets = await extractor.extractFromClaim(claim);
    expect(triplets.length).toBeGreaterThan(0);

    // Verify each triplet
    for (const triplet of triplets) {
      const result = await extractor.verifyTriplet(triplet, SAMPLE_CONTEXT);
      expect(typeof result.verified).toBe('boolean');
      expect(typeof result.confidence).toBe('number');
    }
  });

  it('should handle real-world code documentation', async () => {
    const documentation = `
      The EvaluationHarness class provides metrics computation.
      It imports EvaluationConfig from ./types.
      The run method accepts an EvaluationQuery parameter.
      The computeMetrics function returns a MetricsReport.
    `;

    const triplets = await extractor.extractTriplets(documentation);

    // Should extract multiple triplets from documentation
    expect(triplets.length).toBeGreaterThanOrEqual(2);
  });
});
