import { describe, it, expect } from 'vitest';
import { classifyQueryIntent, applyDocumentBias, applyDefinitionBias, isDefinitionEntity, type QueryClassification } from '../query.js';
import {
  classifyUnifiedQueryIntent,
  applyRetrievalStrategyAdjustments,
  shouldUseFallback,
  getNextFallbackStrategy,
  type UnifiedQueryIntent,
  type QueryIntentType,
  type RetrievalStrategy,
} from '../query_intent.js';

describe('classifyQueryIntent', () => {
  describe('meta-query detection', () => {
    it('classifies "How should an agent use Librarian?" as meta-query', () => {
      const result = classifyQueryIntent('How should an agent use Librarian?');
      expect(result.isMetaQuery).toBe(true);
      expect(result.isCodeQuery).toBe(false);
      expect(result.documentBias).toBeGreaterThanOrEqual(0.7);
    });

    it('classifies "how to use authentication" as meta-query', () => {
      const result = classifyQueryIntent('how to use authentication');
      expect(result.isMetaQuery).toBe(true);
      expect(result.isCodeQuery).toBe(false);
    });

    it('classifies "what is the architecture" as meta-query', () => {
      const result = classifyQueryIntent('what is the architecture');
      expect(result.isMetaQuery).toBe(true);
      expect(result.isCodeQuery).toBe(false);
    });

    it('classifies "best practice for error handling" as meta-query', () => {
      const result = classifyQueryIntent('best practice for error handling');
      expect(result.isMetaQuery).toBe(true);
      expect(result.isCodeQuery).toBe(false);
    });

    it('classifies "overview of the system" as meta-query', () => {
      const result = classifyQueryIntent('overview of the system');
      expect(result.isMetaQuery).toBe(true);
      expect(result.isCodeQuery).toBe(false);
    });

    it('classifies "getting started guide" as meta-query', () => {
      const result = classifyQueryIntent('getting started guide');
      expect(result.isMetaQuery).toBe(true);
      expect(result.isCodeQuery).toBe(false);
    });
  });

  describe('implementation query detection', () => {
    it('classifies "where is queryLibrarian defined" as implementation query', () => {
      const result = classifyQueryIntent('where is queryLibrarian defined');
      expect(result.isCodeQuery).toBe(true);
      expect(result.isMetaQuery).toBe(false);
      expect(result.documentBias).toBeLessThan(0.3);
    });

    it('classifies "find the implementation of EmbeddingService" as implementation query', () => {
      const result = classifyQueryIntent('find the implementation of EmbeddingService');
      expect(result.isCodeQuery).toBe(true);
      expect(result.isMetaQuery).toBe(false);
    });

    it('classifies "show me the function called generateEmbedding" as implementation query', () => {
      const result = classifyQueryIntent('show me the function called generateEmbedding');
      expect(result.isCodeQuery).toBe(true);
      expect(result.isMetaQuery).toBe(false);
    });

    it('classifies "bug in the authentication module" as implementation query', () => {
      const result = classifyQueryIntent('bug in the authentication module');
      expect(result.isCodeQuery).toBe(true);
      expect(result.isMetaQuery).toBe(false);
    });
  });

  describe('hybrid query detection', () => {
    it('classifies "explain the error handling implementation" as mixed (code signals but explain is meta)', () => {
      const result = classifyQueryIntent('explain the error handling implementation');
      // This could be either depending on pattern matching, but should have entityTypes for both
      expect(result.entityTypes).toContain('function');
      expect(result.entityTypes).toContain('module');
    });
  });

  describe('definition query detection', () => {
    it('classifies "What is the storage interface?" as a definition query', () => {
      const result = classifyQueryIntent('What is the storage interface?');
      expect(result.isDefinitionQuery).toBe(true);
      expect(result.definitionBias).toBeGreaterThanOrEqual(0.6);
    });

    it('classifies "storage interface" as a definition query', () => {
      const result = classifyQueryIntent('storage interface');
      expect(result.isDefinitionQuery).toBe(true);
      expect(result.definitionBias).toBeGreaterThan(0.0);
    });

    it('classifies "LibrarianStorage interface definition" as a definition query', () => {
      const result = classifyQueryIntent('LibrarianStorage interface definition');
      expect(result.isDefinitionQuery).toBe(true);
      expect(result.definitionBias).toBeGreaterThanOrEqual(0.7);
    });

    it('classifies "type definition for QueryOptions" as a definition query', () => {
      const result = classifyQueryIntent('type definition for QueryOptions');
      expect(result.isDefinitionQuery).toBe(true);
      expect(result.definitionBias).toBeGreaterThanOrEqual(0.6);
    });

    it('classifies "what is the contract for embedding service" as a definition query', () => {
      const result = classifyQueryIntent('what is the contract for embedding service');
      expect(result.isDefinitionQuery).toBe(true);
    });

    it('classifies "abstract interface for storage" as a definition query', () => {
      const result = classifyQueryIntent('abstract interface for storage');
      expect(result.isDefinitionQuery).toBe(true);
    });

    it('classifies "schema for configuration" as a definition query', () => {
      const result = classifyQueryIntent('schema for configuration');
      expect(result.isDefinitionQuery).toBe(true);
    });

    it('does not classify "getStorage function" as a definition query', () => {
      const result = classifyQueryIntent('getStorage function');
      expect(result.isDefinitionQuery).toBe(false);
    });
  });

  describe('WHY query detection', () => {
    it('classifies "why does the system use embeddings" as a WHY query', () => {
      const result = classifyQueryIntent('why does the system use embeddings');
      expect(result.isWhyQuery).toBe(true);
      expect(result.whyQueryTopic).toBe('embeddings');
      expect(result.rationaleBias).toBeGreaterThanOrEqual(0.7);
      expect(result.documentBias).toBeGreaterThanOrEqual(0.9);
    });

    it('classifies "reasoning behind using TypeScript" as a WHY query', () => {
      const result = classifyQueryIntent('reasoning behind using TypeScript');
      expect(result.isWhyQuery).toBe(true);
      expect(result.whyQueryTopic).toBe('TypeScript');
      expect(result.rationaleBias).toBeGreaterThanOrEqual(0.7);
    });

    it('classifies "why use SQLite" as a WHY query', () => {
      const result = classifyQueryIntent('why use SQLite');
      expect(result.isWhyQuery).toBe(true);
      expect(result.whyQueryTopic).toBe('SQLite');
    });

    it('classifies "why TypeScript instead of JavaScript" as a WHY query with comparison', () => {
      const result = classifyQueryIntent('why TypeScript instead of JavaScript');
      expect(result.isWhyQuery).toBe(true);
      expect(result.whyQueryTopic).toBe('TypeScript');
      expect(result.whyComparisonTopic).toBe('JavaScript');
    });

    it('classifies "rationale for caching" as a WHY query', () => {
      const result = classifyQueryIntent('rationale for caching');
      expect(result.isWhyQuery).toBe(true);
      expect(result.whyQueryTopic).toBe('caching');
    });

    it('classifies "why Redis over Memcached" as a WHY query with comparison', () => {
      const result = classifyQueryIntent('why Redis over Memcached');
      expect(result.isWhyQuery).toBe(true);
      expect(result.whyQueryTopic).toBe('Redis');
      expect(result.whyComparisonTopic).toBe('Memcached');
    });

    it('classifies "why did you choose React" as a WHY query', () => {
      const result = classifyQueryIntent('why did you choose React');
      expect(result.isWhyQuery).toBe(true);
      expect(result.whyQueryTopic).toBe('React');
    });

    it('does not classify implementation queries as WHY queries', () => {
      const result = classifyQueryIntent('where is queryLibrarian defined');
      expect(result.isWhyQuery).toBe(false);
    });

    it('does not classify test queries as WHY queries', () => {
      const result = classifyQueryIntent('tests for embeddings module');
      expect(result.isWhyQuery).toBe(false);
    });
  });

  describe('entity type routing', () => {
    it('includes document entity type for meta-queries', () => {
      const result = classifyQueryIntent('How should an agent use Librarian?');
      expect(result.entityTypes).toContain('document');
    });

    it('excludes document entity type for pure implementation queries', () => {
      const result = classifyQueryIntent('where is queryLibrarian defined');
      expect(result.entityTypes).not.toContain('document');
    });

    it('searches function and module for implementation queries', () => {
      const result = classifyQueryIntent('find the authentication function');
      expect(result.entityTypes).toContain('function');
      expect(result.entityTypes).toContain('module');
    });
  });

  describe('refactoring safety query detection', () => {
    it('classifies "what would break if I changed SqliteLibrarianStorage" as refactoring safety query', () => {
      const result = classifyQueryIntent('what would break if I changed SqliteLibrarianStorage');
      expect(result.isRefactoringSafetyQuery).toBe(true);
      expect(result.refactoringTarget).toBe('SqliteLibrarianStorage');
    });

    it('classifies "can I safely rename createLibrarian" as refactoring safety query', () => {
      const result = classifyQueryIntent('can I safely rename createLibrarian');
      expect(result.isRefactoringSafetyQuery).toBe(true);
      expect(result.refactoringTarget).toBe('createLibrarian');
    });

    it('classifies "is it safe to refactor EmbeddingService" as refactoring safety query', () => {
      const result = classifyQueryIntent('is it safe to refactor EmbeddingService');
      expect(result.isRefactoringSafetyQuery).toBe(true);
      expect(result.refactoringTarget).toBe('EmbeddingService');
    });

    it('classifies "impact of changing queryLibrarian" as refactoring safety query', () => {
      const result = classifyQueryIntent('impact of changing queryLibrarian');
      expect(result.isRefactoringSafetyQuery).toBe(true);
      expect(result.refactoringTarget).toBe('queryLibrarian');
    });

    it('classifies "safe to refactor LibrarianStorage" as refactoring safety query', () => {
      const result = classifyQueryIntent('safe to refactor LibrarianStorage');
      expect(result.isRefactoringSafetyQuery).toBe(true);
      expect(result.refactoringTarget).toBe('LibrarianStorage');
    });

    it('classifies "can we safely delete OldFunction" as refactoring safety query', () => {
      const result = classifyQueryIntent('can we safely delete OldFunction');
      expect(result.isRefactoringSafetyQuery).toBe(true);
      expect(result.refactoringTarget).toBe('OldFunction');
    });

    it('classifies "breaking changes for renaming Storage" as refactoring safety query', () => {
      const result = classifyQueryIntent('breaking changes for renaming Storage');
      expect(result.isRefactoringSafetyQuery).toBe(true);
      expect(result.refactoringTarget).toBe('Storage');
    });

    it('does not classify "what is SqliteLibrarianStorage" as refactoring safety query', () => {
      const result = classifyQueryIntent('what is SqliteLibrarianStorage');
      expect(result.isRefactoringSafetyQuery).toBe(false);
    });

    it('does not classify "how does createLibrarian work" as refactoring safety query', () => {
      const result = classifyQueryIntent('how does createLibrarian work');
      expect(result.isRefactoringSafetyQuery).toBe(false);
    });
  });

  describe('project understanding query detection', () => {
    it('classifies "what does this codebase do" as project understanding query', () => {
      const result = classifyQueryIntent('what does this codebase do');
      expect(result.isProjectUnderstandingQuery).toBe(true);
      expect(result.isMetaQuery).toBe(true);
      expect(result.projectUnderstandingBias).toBeGreaterThanOrEqual(0.8);
      expect(result.documentBias).toBeGreaterThanOrEqual(0.9);
    });

    it('classifies "what is the purpose of this project" as project understanding query', () => {
      const result = classifyQueryIntent('what is the purpose of this project');
      expect(result.isProjectUnderstandingQuery).toBe(true);
      expect(result.isMetaQuery).toBe(true);
    });

    it('classifies "project overview" as project understanding query', () => {
      const result = classifyQueryIntent('project overview');
      expect(result.isProjectUnderstandingQuery).toBe(true);
    });

    it('classifies "what does this do" as project understanding query', () => {
      const result = classifyQueryIntent('what does this do');
      expect(result.isProjectUnderstandingQuery).toBe(true);
    });

    it('classifies "tell me about this project" as project understanding query', () => {
      const result = classifyQueryIntent('tell me about this project');
      expect(result.isProjectUnderstandingQuery).toBe(true);
    });

    it('classifies "architecture overview" as architecture overview query (more specific than project understanding)', () => {
      const result = classifyQueryIntent('architecture overview');
      // Architecture overview is more specific than project understanding, so it takes precedence
      expect(result.isArchitectureOverviewQuery).toBe(true);
      // Project understanding should be false because architecture overview is more specific
      expect(result.isProjectUnderstandingQuery).toBe(false);
    });

    it('classifies "main features" as project understanding query', () => {
      const result = classifyQueryIntent('main features');
      expect(result.isProjectUnderstandingQuery).toBe(true);
    });

    it('classifies "entry points" as entry point query (not project understanding)', () => {
      // "entry points" is now handled by the dedicated entry point query stage
      // rather than project understanding, as per the refactoring in entry_point_query.ts
      const result = classifyQueryIntent('entry points');
      expect(result.isEntryPointQuery).toBe(true);
      // Entry point queries are more specific than project understanding
      expect(result.isProjectUnderstandingQuery).toBe(false);
    });

    it('does not classify "bootstrap" as entry point query', () => {
      const result = classifyQueryIntent('bootstrap');
      expect(result.isEntryPointQuery).toBe(false);
    });

    it('only searches documents for project understanding queries', () => {
      const result = classifyQueryIntent('what does this codebase do');
      expect(result.entityTypes).toContain('document');
      expect(result.entityTypes).not.toContain('function');
    });

    it('does not classify specific function queries as project understanding', () => {
      const result = classifyQueryIntent('where is the queryLibrarian function defined');
      // This should be a code query, not a project understanding query
      expect(result.isCodeQuery).toBe(true);
      expect(result.isProjectUnderstandingQuery).toBe(false);
    });
  });

  describe('architecture overview query detection', () => {
    it('classifies "architecture layers" as architecture overview query', () => {
      const result = classifyQueryIntent('architecture layers');
      expect(result.isArchitectureOverviewQuery).toBe(true);
      expect(result.isProjectUnderstandingQuery).toBe(false);
      expect(result.architectureOverviewBias).toBeGreaterThanOrEqual(0.75);
    });

    it('classifies "what are the main modules" as architecture overview query', () => {
      const result = classifyQueryIntent('what are the main modules');
      expect(result.isArchitectureOverviewQuery).toBe(true);
      expect(result.isProjectUnderstandingQuery).toBe(false);
    });

    it('classifies "module dependencies" as architecture overview query', () => {
      const result = classifyQueryIntent('module dependencies');
      expect(result.isArchitectureOverviewQuery).toBe(true);
    });

    it('classifies "system architecture" as architecture overview query', () => {
      const result = classifyQueryIntent('system architecture');
      expect(result.isArchitectureOverviewQuery).toBe(true);
    });

    it('classifies "code organization" as architecture overview query', () => {
      const result = classifyQueryIntent('code organization');
      expect(result.isArchitectureOverviewQuery).toBe(true);
    });

    it('classifies "directory structure" as architecture overview query', () => {
      const result = classifyQueryIntent('directory structure');
      expect(result.isArchitectureOverviewQuery).toBe(true);
    });

    it('classifies "how is the code organized" as architecture overview query', () => {
      const result = classifyQueryIntent('how is the code organized');
      expect(result.isArchitectureOverviewQuery).toBe(true);
    });

    it('classifies "layer architecture" as architecture overview query', () => {
      const result = classifyQueryIntent('layer architecture');
      expect(result.isArchitectureOverviewQuery).toBe(true);
    });

    it('searches modules and documents for architecture queries', () => {
      const result = classifyQueryIntent('architecture layers');
      expect(result.entityTypes).toContain('module');
      expect(result.entityTypes).toContain('document');
    });

    it('does not classify "verify architecture violations" as architecture overview (verification instead)', () => {
      const result = classifyQueryIntent('verify architecture violations');
      // This is an architecture verification query, not overview
      expect(result.isArchitectureVerificationQuery).toBe(true);
      expect(result.isArchitectureOverviewQuery).toBe(false);
    });
  });
});

describe('applyDocumentBias', () => {
  it('boosts document similarity for high document bias', () => {
    const results = [
      { entityId: 'func:test', entityType: 'function' as const, similarity: 0.8 },
      { entityId: 'doc:AGENTS.md', entityType: 'document' as const, similarity: 0.7 },
    ];

    const boosted = applyDocumentBias(results, 0.8);

    // Document should be boosted and potentially reordered
    const docResult = boosted.find(r => r.entityId === 'doc:AGENTS.md');
    expect(docResult).toBeDefined();
    expect(docResult!.similarity).toBeGreaterThan(0.7);
  });

  it('does not boost when document bias is low', () => {
    const results = [
      { entityId: 'func:test', entityType: 'function' as const, similarity: 0.8 },
      { entityId: 'doc:AGENTS.md', entityType: 'document' as const, similarity: 0.7 },
    ];

    const boosted = applyDocumentBias(results, 0.2);

    // Should return unchanged order with same similarities
    expect(boosted[0].entityId).toBe('func:test');
    expect(boosted[0].similarity).toBe(0.8);
  });

  it('reorders results when document gets boosted above function', () => {
    const results = [
      { entityId: 'func:test', entityType: 'function' as const, similarity: 0.75 },
      { entityId: 'doc:README.md', entityType: 'document' as const, similarity: 0.70 },
    ];

    // High bias should boost doc enough to overtake function
    const boosted = applyDocumentBias(results, 0.9);

    // With 35% boost max (0.9 - 0.3) * 0.5 = 0.3, doc gets ~0.91
    // This should be higher than function at 0.75
    expect(boosted[0].entityType).toBe('document');
  });
});

describe('isDefinitionEntity', () => {
  it('returns true for entity IDs containing "interface"', () => {
    expect(isDefinitionEntity('func:src/storage/types.ts::LibrarianStorage::interface')).toBe(true);
  });

  it('returns true for entity IDs containing "type:"', () => {
    expect(isDefinitionEntity('type:QueryOptions')).toBe(true);
  });

  it('returns true for entities in types files', () => {
    expect(isDefinitionEntity('func:src/storage/types.ts::QueryOptions')).toBe(true);
    expect(isDefinitionEntity('mod:src/types/index.ts')).toBe(true);
  });

  it('returns true for IStorage naming pattern', () => {
    expect(isDefinitionEntity('func:test', 'IStorage')).toBe(true);
    expect(isDefinitionEntity('func:test', 'IQueryRunner')).toBe(true);
  });

  it('returns true for Interface suffix naming pattern', () => {
    expect(isDefinitionEntity('func:test', 'StorageInterface')).toBe(true);
    expect(isDefinitionEntity('func:test', 'QueryInterface')).toBe(true);
  });

  it('returns true for Contract suffix naming pattern', () => {
    expect(isDefinitionEntity('func:test', 'StorageContract')).toBe(true);
  });

  it('returns true for Type suffix naming pattern', () => {
    expect(isDefinitionEntity('func:test', 'QueryOptionsType')).toBe(true);
  });

  it('returns false for implementation function names', () => {
    expect(isDefinitionEntity('func:src/storage/sqlite.ts::getStorage')).toBe(false);
    expect(isDefinitionEntity('func:test', 'createStorage')).toBe(false);
  });
});

describe('applyDefinitionBias', () => {
  it('boosts interface results for high definition bias', () => {
    const results = [
      { entityId: 'func:getStorage', entityType: 'function' as const, similarity: 0.8 },
      { entityId: 'func:src/storage/types.ts::LibrarianStorage', entityType: 'function' as const, similarity: 0.7 },
    ];

    const boosted = applyDefinitionBias(results, 0.8);

    // The types.ts entity should be boosted
    const typesResult = boosted.find(r => r.entityId.includes('types.ts'));
    expect(typesResult).toBeDefined();
    expect(typesResult!.similarity).toBeGreaterThan(0.7);
  });

  it('does not boost when definition bias is low', () => {
    const results = [
      { entityId: 'func:getStorage', entityType: 'function' as const, similarity: 0.8 },
      { entityId: 'func:src/storage/types.ts::LibrarianStorage', entityType: 'function' as const, similarity: 0.7 },
    ];

    const boosted = applyDefinitionBias(results, 0.05);

    // Should return unchanged order with same similarities
    expect(boosted[0].entityId).toBe('func:getStorage');
    expect(boosted[0].similarity).toBe(0.8);
  });

  it('reorders results when interface gets boosted above implementation', () => {
    const results = [
      { entityId: 'func:getStorage', entityType: 'function' as const, similarity: 0.75 },
      { entityId: 'func:src/storage/types.ts::LibrarianStorage', entityType: 'function' as const, similarity: 0.65 },
    ];

    // High bias should boost interface enough to overtake implementation
    const boosted = applyDefinitionBias(results, 0.9);

    // Interface should now be first
    expect(boosted[0].entityId).toContain('types.ts');
  });

  it('penalizes implementation-looking results when seeking definitions', () => {
    const results = [
      { entityId: 'func:getStorage', entityType: 'function' as const, similarity: 0.8 },
      { entityId: 'func:StorageInterface', entityType: 'function' as const, similarity: 0.75 },
    ];
    const entityNames = new Map([
      ['func:getStorage', 'getStorage'],
      ['func:StorageInterface', 'StorageInterface'],
    ]);

    const boosted = applyDefinitionBias(results, 0.8, entityNames);

    // getStorage should be penalized (starts with 'get')
    // StorageInterface should be boosted
    expect(boosted[0].entityId).toBe('func:StorageInterface');
  });

  it('correctly prioritizes LibrarianStorage interface over storage functions', () => {
    // This is the critical test case from the bug report
    const results = [
      { entityId: 'func:src/storage/sqlite.ts::getStorage', entityType: 'function' as const, similarity: 0.82 },
      { entityId: 'func:src/storage/sqlite.ts::createStorage', entityType: 'function' as const, similarity: 0.80 },
      { entityId: 'func:src/storage/sqlite.ts::initStorage', entityType: 'function' as const, similarity: 0.78 },
      { entityId: 'func:src/storage/types.ts::LibrarianStorage', entityType: 'function' as const, similarity: 0.70 },
    ];
    const entityNames = new Map([
      ['func:src/storage/sqlite.ts::getStorage', 'getStorage'],
      ['func:src/storage/sqlite.ts::createStorage', 'createStorage'],
      ['func:src/storage/sqlite.ts::initStorage', 'initStorage'],
      ['func:src/storage/types.ts::LibrarianStorage', 'LibrarianStorage'],
    ]);

    // Query: "What is the storage interface?"
    const classification = classifyQueryIntent('What is the storage interface?');
    expect(classification.isDefinitionQuery).toBe(true);

    const boosted = applyDefinitionBias(results, classification.definitionBias, entityNames);

    // LibrarianStorage (the interface) should be ranked first despite lower initial similarity
    expect(boosted[0].entityId).toContain('types.ts');
    expect(boosted[0].entityId).toContain('LibrarianStorage');
  });
});

// ============================================================================
// UNIFIED QUERY INTENT CLASSIFICATION TESTS
// ============================================================================

describe('classifyUnifiedQueryIntent', () => {
  describe('structural query detection (graph strategy)', () => {
    it('classifies "What imports utils.ts?" as structural with graph strategy', () => {
      const result = classifyUnifiedQueryIntent('What imports utils.ts?');
      expect(result.intentType).toBe('structural');
      expect(result.primaryStrategy).toBe('graph');
      expect(result.intentConfidence).toBeGreaterThanOrEqual(0.6);
      expect(result.structuralIntent).toBeDefined();
      expect(result.structuralIntent?.isStructural).toBe(true);
    });

    it('classifies "What depends on LibrarianStorage?" as structural', () => {
      const result = classifyUnifiedQueryIntent('What depends on LibrarianStorage?');
      expect(result.intentType).toBe('structural');
      expect(result.primaryStrategy).toBe('graph');
      expect(result.graphEdgeTypes).toContain('imports');
    });

    it('classifies "What calls queryLibrarian?" as structural with calls edge', () => {
      const result = classifyUnifiedQueryIntent('What calls queryLibrarian?');
      expect(result.intentType).toBe('structural');
      expect(result.graphEdgeTypes).toContain('calls');
    });

    it('classifies "Show me the callers of embedFunction" as structural', () => {
      const result = classifyUnifiedQueryIntent('Show me the callers of embedFunction');
      expect(result.intentType).toBe('structural');
      expect(result.primaryStrategy).toBe('graph');
    });

    it('classifies "What does query.ts import?" as structural', () => {
      const result = classifyUnifiedQueryIntent('What does query.ts import?');
      expect(result.intentType).toBe('structural');
      expect(result.structuralIntent?.direction).toBe('dependencies');
    });

    it('detects exhaustive mode for "all dependents" queries', () => {
      const result = classifyUnifiedQueryIntent('Show me ALL files that depend on utils.ts');
      expect(result.intentType).toBe('structural');
      expect(result.requiresExhaustive).toBe(true);
    });

    it('detects exhaustive mode for refactoring queries', () => {
      const result = classifyUnifiedQueryIntent('What will break if I refactor LibrarianStorage?');
      expect(result.requiresExhaustive).toBe(true);
    });
  });

  describe('location query detection (search strategy)', () => {
    it('classifies "Where is queryLibrarian defined?" as location', () => {
      const result = classifyUnifiedQueryIntent('Where is queryLibrarian defined?');
      expect(result.intentType).toBe('location');
      expect(result.primaryStrategy).toBe('search');
    });

    it('classifies "Find the EmbeddingService class" as location', () => {
      const result = classifyUnifiedQueryIntent('Find the EmbeddingService class');
      expect(result.intentType).toBe('location');
      expect(result.primaryStrategy).toBe('search');
    });

    it('classifies "Which file contains the storage interface?" as location', () => {
      const result = classifyUnifiedQueryIntent('Which file contains the storage interface?');
      expect(result.intentType).toBe('location');
    });

    it('classifies "Locate the bootstrap function" as location', () => {
      const result = classifyUnifiedQueryIntent('Locate the bootstrap function');
      expect(result.intentType).toBe('location');
    });
  });

  describe('explanation query detection (summary strategy)', () => {
    it('classifies "What does queryLibrarian do?" as explanation', () => {
      const result = classifyUnifiedQueryIntent('What does queryLibrarian do?');
      expect(result.intentType).toBe('explanation');
      expect(result.primaryStrategy).toBe('summary');
    });

    it('classifies "How does the embedding service work?" as explanation', () => {
      const result = classifyUnifiedQueryIntent('How does the embedding service work?');
      expect(result.intentType).toBe('explanation');
    });

    it('classifies "Why is the confidence calibration needed?" as explanation', () => {
      const result = classifyUnifiedQueryIntent('Why is the confidence calibration needed?');
      expect(result.intentType).toBe('explanation');
    });

    it('classifies "Explain the purpose of context packs" as explanation', () => {
      const result = classifyUnifiedQueryIntent('Explain the purpose of context packs');
      expect(result.intentType).toBe('explanation');
    });

    it('classifies "Describe the query pipeline logic" as explanation', () => {
      const result = classifyUnifiedQueryIntent('Describe the query pipeline logic');
      expect(result.intentType).toBe('explanation');
    });
  });

  describe('meta query detection (docs strategy)', () => {
    it('classifies "What is this project about?" as meta', () => {
      const result = classifyUnifiedQueryIntent('What is this project about?');
      expect(result.intentType).toBe('meta');
      expect(result.primaryStrategy).toBe('docs');
    });

    it('classifies "How do I use Librarian?" as meta', () => {
      const result = classifyUnifiedQueryIntent('How do I use Librarian?');
      expect(result.intentType).toBe('meta');
      expect(result.documentBias).toBeGreaterThan(0.7);
    });

    it('classifies "Getting started guide" as meta', () => {
      const result = classifyUnifiedQueryIntent('Getting started guide');
      expect(result.intentType).toBe('meta');
    });

    it('classifies "What are the best practices?" as meta', () => {
      const result = classifyUnifiedQueryIntent('What are the best practices?');
      expect(result.intentType).toBe('meta');
    });

    it('classifies "Project overview" as meta', () => {
      const result = classifyUnifiedQueryIntent('Project overview');
      expect(result.intentType).toBe('meta');
    });
  });

  describe('test query detection (test correlation strategy)', () => {
    it('classifies "Tests for query.ts" as test query', () => {
      const result = classifyUnifiedQueryIntent('Tests for query.ts');
      expect(result.intentType).toBe('test');
      expect(result.primaryStrategy).toBe('test_correlation');
    });

    it('classifies "What tests cover the embedding service?" as test query', () => {
      const result = classifyUnifiedQueryIntent('What tests cover the embedding service?');
      expect(result.intentType).toBe('test');
    });

    it('classifies "Find test files for bootstrap" as test query', () => {
      const result = classifyUnifiedQueryIntent('Find test files for bootstrap');
      expect(result.intentType).toBe('test');
    });
  });

  describe('fallback strategies', () => {
    it('provides graph -> search -> summary fallback for structural queries', () => {
      const result = classifyUnifiedQueryIntent('What imports utils.ts?');
      expect(result.fallbackStrategies).toEqual(['search', 'summary']);
    });

    it('provides search -> graph -> summary fallback for location queries', () => {
      const result = classifyUnifiedQueryIntent('Where is queryLibrarian?');
      expect(result.fallbackStrategies).toEqual(['graph', 'summary']);
    });

    it('provides summary -> search -> docs fallback for explanation queries', () => {
      const result = classifyUnifiedQueryIntent('How does X work?');
      expect(result.fallbackStrategies).toEqual(['search', 'docs']);
    });

    it('provides docs -> summary -> search fallback for meta queries', () => {
      const result = classifyUnifiedQueryIntent('How do I use this project?');
      expect(result.fallbackStrategies).toEqual(['summary', 'search']);
    });
  });

  describe('entity type routing', () => {
    it('uses function/module for structural queries', () => {
      const result = classifyUnifiedQueryIntent('What calls this function?');
      expect(result.entityTypes).toContain('function');
      expect(result.entityTypes).toContain('module');
      expect(result.entityTypes).not.toContain('document');
    });

    it('uses document first for meta queries', () => {
      const result = classifyUnifiedQueryIntent('Project documentation');
      expect(result.entityTypes[0]).toBe('document');
    });

    it('uses function/module/document for explanation queries', () => {
      const result = classifyUnifiedQueryIntent('Explain how this works');
      expect(result.entityTypes).toContain('function');
      expect(result.entityTypes).toContain('module');
      expect(result.entityTypes).toContain('document');
    });
  });

  describe('confidence levels', () => {
    it('has high confidence for clear structural patterns', () => {
      const result = classifyUnifiedQueryIntent('What imports query.ts?');
      expect(result.intentConfidence).toBeGreaterThanOrEqual(0.8);
    });

    it('has moderate confidence for ambiguous queries', () => {
      const result = classifyUnifiedQueryIntent('show me something about storage');
      expect(result.intentConfidence).toBeLessThan(0.8);
    });

    it('has low confidence when no patterns match', () => {
      const result = classifyUnifiedQueryIntent('xyz abc 123');
      expect(result.intentConfidence).toBeLessThanOrEqual(0.5);
    });
  });
});

describe('applyRetrievalStrategyAdjustments', () => {
  it('increases graph depth for structural queries', () => {
    const intent = classifyUnifiedQueryIntent('What depends on utils.ts?');
    const adjustments = applyRetrievalStrategyAdjustments(intent, { graphDepth: 2 });

    expect(adjustments.adjustedGraphDepth).toBeGreaterThanOrEqual(3);
    expect(adjustments.useGraphFirst).toBe(true);
  });

  it('increases limit for location queries', () => {
    const intent = classifyUnifiedQueryIntent('Where is the storage interface?');
    const adjustments = applyRetrievalStrategyAdjustments(intent, { limit: 14 });

    expect(adjustments.adjustedLimit).toBeGreaterThan(14);
  });

  it('sets useDocsFirst for meta queries', () => {
    const intent = classifyUnifiedQueryIntent('How do I use this project?');
    const adjustments = applyRetrievalStrategyAdjustments(intent, {});

    expect(adjustments.useDocsFirst).toBe(true);
  });

  it('sets useTestCorrelation for test queries', () => {
    const intent = classifyUnifiedQueryIntent('Tests for query.ts');
    const adjustments = applyRetrievalStrategyAdjustments(intent, {});

    expect(adjustments.useTestCorrelation).toBe(true);
  });

  it('uses very high limit for exhaustive queries', () => {
    const intent = classifyUnifiedQueryIntent('Show ALL dependents of utils.ts');
    const adjustments = applyRetrievalStrategyAdjustments(intent, { limit: 14 });

    expect(adjustments.adjustedLimit).toBeGreaterThanOrEqual(1000);
  });

  it('includes fallback note for low confidence', () => {
    const intent: UnifiedQueryIntent = {
      intentType: 'explanation',
      intentConfidence: 0.4,
      primaryStrategy: 'summary',
      fallbackStrategies: ['search', 'docs'],
      entityTypes: ['function', 'module'],
      documentBias: 0.4,
      explanation: 'Low confidence test',
      requiresExhaustive: false,
    };

    const adjustments = applyRetrievalStrategyAdjustments(intent, {});
    expect(adjustments.explanation).toContain('fallback');
  });
});

describe('shouldUseFallback', () => {
  it('returns true when results are insufficient', () => {
    const intent = classifyUnifiedQueryIntent('What imports utils.ts?');
    expect(shouldUseFallback(intent, 1, 3)).toBe(true);
  });

  it('returns false when results are sufficient', () => {
    const intent = classifyUnifiedQueryIntent('What imports utils.ts?');
    expect(shouldUseFallback(intent, 5, 3)).toBe(false);
  });

  it('uses fallback for very sparse results even with low confidence', () => {
    const intent: UnifiedQueryIntent = {
      intentType: 'explanation',
      intentConfidence: 0.4,
      primaryStrategy: 'summary',
      fallbackStrategies: ['search', 'docs'],
      entityTypes: ['function', 'module'],
      documentBias: 0.4,
      explanation: 'Low confidence',
      requiresExhaustive: false,
    };

    expect(shouldUseFallback(intent, 1, 3)).toBe(true);
  });
});

describe('getNextFallbackStrategy', () => {
  it('returns the first unused fallback strategy', () => {
    const intent = classifyUnifiedQueryIntent('What imports utils.ts?');
    const used = new Set<RetrievalStrategy>(['graph']);

    const next = getNextFallbackStrategy(intent, used);
    expect(next).toBe('search');
  });

  it('returns null when all fallbacks are used', () => {
    const intent = classifyUnifiedQueryIntent('What imports utils.ts?');
    const used = new Set<RetrievalStrategy>(['graph', 'search', 'summary']);

    const next = getNextFallbackStrategy(intent, used);
    expect(next).toBeNull();
  });

  it('skips already used strategies', () => {
    const intent = classifyUnifiedQueryIntent('What imports utils.ts?');
    const used = new Set<RetrievalStrategy>(['graph', 'search']);

    const next = getNextFallbackStrategy(intent, used);
    expect(next).toBe('summary');
  });
});

describe('refactoring opportunities query detection', () => {
  it('classifies "what should I refactor" as refactoring opportunities query', () => {
    const result = classifyQueryIntent('what should I refactor');
    expect(result.isRefactoringOpportunitiesQuery).toBe(true);
    expect(result.isRefactoringSafetyQuery).toBe(false);
  });

  it('classifies "refactoring opportunities" as refactoring opportunities query', () => {
    const result = classifyQueryIntent('refactoring opportunities');
    expect(result.isRefactoringOpportunitiesQuery).toBe(true);
  });

  it('classifies "find code to refactor" as refactoring opportunities query', () => {
    const result = classifyQueryIntent('find code to refactor');
    expect(result.isRefactoringOpportunitiesQuery).toBe(true);
  });

  it('classifies "code improvements needed" as refactoring opportunities query', () => {
    const result = classifyQueryIntent('code improvements needed');
    expect(result.isRefactoringOpportunitiesQuery).toBe(true);
  });

  it('classifies "suggest refactoring" as refactoring opportunities query', () => {
    const result = classifyQueryIntent('suggest refactoring');
    expect(result.isRefactoringOpportunitiesQuery).toBe(true);
  });

  it('classifies "where should we improve code quality" as refactoring opportunities query', () => {
    const result = classifyQueryIntent('where should we improve code quality');
    expect(result.isRefactoringOpportunitiesQuery).toBe(true);
  });

  it('classifies "cleanup opportunities" as refactoring opportunities query', () => {
    const result = classifyQueryIntent('cleanup opportunities');
    expect(result.isRefactoringOpportunitiesQuery).toBe(true);
  });

  it('does NOT classify refactoring safety queries as refactoring opportunities', () => {
    // "can I safely refactor X" is a safety query, not an opportunities query
    const result = classifyQueryIntent('can I safely refactor the Storage class');
    expect(result.isRefactoringSafetyQuery).toBe(true);
    expect(result.isRefactoringOpportunitiesQuery).toBe(false);
  });

  it('does NOT classify "what would break if I changed X" as refactoring opportunities', () => {
    const result = classifyQueryIntent('what would break if I changed the API');
    expect(result.isRefactoringSafetyQuery).toBe(true);
    expect(result.isRefactoringOpportunitiesQuery).toBe(false);
  });
});
