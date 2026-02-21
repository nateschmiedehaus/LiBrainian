/**
 * @fileoverview Tests for the error explanation system
 */

import { describe, it, expect, beforeAll, vi, type MockedFunction } from 'vitest';
import {
  explainError,
  classifyError,
  findMatchingPattern,
  extractIdentifiers,
  generateFixes,
  inferLikelyCause,
  findRelatedErrors,
  findDocumentation,
  isErrorExplanationQuery,
  extractErrorFromQuery,
  ERROR_PATTERNS,
  type ErrorType,
  type ErrorExplanation,
} from '../error_explanation.js';
import type { LiBrainianStorage, FunctionKnowledge, FileKnowledge } from '../../storage/types.js';

// ============================================================================
// MOCK STORAGE
// ============================================================================

function createMockStorage(overrides: Partial<LiBrainianStorage> = {}): LiBrainianStorage {
  return {
    // Lifecycle
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(true),
    getCapabilities: vi.fn().mockReturnValue({
      core: { getFunctions: true, getFiles: true, getContextPacks: true },
      optional: {
        graphMetrics: false,
        multiVectors: false,
        embeddings: false,
        episodes: false,
        verificationPlans: false,
      },
      versions: { schema: 1, api: 1 },
    }),

    // Functions
    getFunctions: vi.fn().mockResolvedValue([]),
    getFunction: vi.fn().mockResolvedValue(null),
    getFunctionByPath: vi.fn().mockResolvedValue(null),
    getFunctionsByPath: vi.fn().mockResolvedValue([]),
    getFunctionsByName: vi.fn().mockResolvedValue([]),
    upsertFunction: vi.fn().mockResolvedValue(undefined),
    upsertFunctions: vi.fn().mockResolvedValue(undefined),
    deleteFunction: vi.fn().mockResolvedValue(undefined),
    deleteFunctionsByPath: vi.fn().mockResolvedValue(undefined),

    // Files
    getFiles: vi.fn().mockResolvedValue([]),
    getFile: vi.fn().mockResolvedValue(null),
    getFileByPath: vi.fn().mockResolvedValue(null),
    getFilesByDirectory: vi.fn().mockResolvedValue([]),
    upsertFile: vi.fn().mockResolvedValue(undefined),
    upsertFiles: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    deleteFileByPath: vi.fn().mockResolvedValue(undefined),

    // Other required methods stubbed
    ...Object.fromEntries(
      [
        'getMetadata', 'setMetadata', 'getState', 'setState', 'getVersion', 'setVersion',
        'getModules', 'getModule', 'getModuleByPath', 'upsertModule', 'deleteModule',
        'getDirectories', 'getDirectory', 'getDirectoryByPath', 'getSubdirectories',
        'upsertDirectory', 'upsertDirectories', 'deleteDirectory', 'deleteDirectoryByPath',
        'getContextPacks', 'getContextPack', 'getContextPackForTarget', 'upsertContextPack',
        'invalidateContextPacks', 'deleteContextPack', 'recordContextPackAccess',
        'getFileChecksum', 'setFileChecksum', 'deleteFileChecksum',
        'getEmbedding', 'setEmbedding', 'findSimilarByEmbedding',
        'getMultiVector', 'getMultiVectors', 'upsertMultiVector',
        'invalidateCache', 'invalidateEmbeddings', 'getReverseDependencies',
        'getQueryCacheEntry', 'upsertQueryCacheEntry', 'recordQueryCacheAccess', 'pruneQueryCache',
        'recordEvolutionOutcome', 'getEvolutionOutcomes',
        'recordLearnedMissing', 'getLearnedMissing', 'clearLearnedMissing',
        'recordQualityScore', 'getQualityScoreHistory',
        'upsertGraphEdges', 'deleteGraphEdgesForSource', 'getGraphEdges',
        'getIngestionItem', 'getIngestionItems', 'upsertIngestionItem', 'deleteIngestionItem',
        'recordIndexingResult', 'getLastIndexingResult',
        'recordBootstrapReport', 'getLastBootstrapReport',
        'updateConfidence', 'applyTimeDecay',
        'transaction', 'vacuum', 'getStats',
        'setGraphMetrics', 'getGraphMetrics', 'deleteGraphMetrics',
        'storeCochangeEdges', 'getCochangeEdges', 'getCochangeEdgeCount', 'deleteCochangeEdges',
        'setEvidence', 'getEvidenceForTarget', 'deleteEvidence',
        'getConfidenceEvents', 'countConfidenceUpdates',
        'getTestMapping', 'getTestMappings', 'getTestMappingsByTestPath', 'getTestMappingsBySourcePath',
        'upsertTestMapping', 'deleteTestMapping', 'deleteTestMappingsByTestPath',
        'getCommit', 'getCommitBySha', 'getCommits', 'upsertCommit', 'deleteCommit', 'deleteCommitBySha',
        'getOwnership', 'getOwnershipByFilePath', 'getOwnershipByAuthor', 'getOwnerships',
        'upsertOwnership', 'deleteOwnership', 'deleteOwnershipByFilePath',
        'getUniversalKnowledge', 'getUniversalKnowledgeByFile', 'getUniversalKnowledgeByKind',
        'queryUniversalKnowledge', 'upsertUniversalKnowledge', 'upsertUniversalKnowledgeBatch',
        'deleteUniversalKnowledge', 'deleteUniversalKnowledgeByFile', 'searchUniversalKnowledgeBySimilarity',
        'getAssessment', 'getAssessmentByPath', 'getAssessments',
        'upsertAssessment', 'upsertAssessments', 'deleteAssessment', 'deleteAssessmentByPath',
        'getSCCEntries', 'getSCCByEntity', 'upsertSCCEntries', 'deleteSCCEntries',
        'getCFGEdges', 'getCFGForFunction', 'upsertCFGEdges', 'deleteCFGEdgesForFunction',
        'getBayesianConfidence', 'getBayesianConfidences', 'upsertBayesianConfidence', 'updateBayesianConfidence',
        'getStabilityMetrics', 'getStabilityMetricsList', 'upsertStabilityMetrics',
        'getFeedbackLoop', 'getFeedbackLoops', 'upsertFeedbackLoop', 'resolveFeedbackLoop',
        'getGraphCacheEntry', 'upsertGraphCacheEntry', 'pruneExpiredGraphCache',
        'getBlameEntries', 'getBlameForFile', 'getBlameStats', 'upsertBlameEntries', 'deleteBlameForFile',
        'getDiffRecords', 'getDiffForCommit', 'upsertDiffRecords', 'deleteDiffForCommit',
        'getReflogEntries', 'upsertReflogEntries', 'deleteReflogEntries',
        'getCloneEntries', 'getClonesByEntity', 'getCloneClusters', 'upsertCloneEntries', 'deleteCloneEntries',
        'getDebtMetrics', 'getDebtForEntity', 'getDebtHotspots', 'upsertDebtMetrics', 'deleteDebtMetrics',
        'getKnowledgeEdges', 'getKnowledgeEdgesFrom', 'getKnowledgeEdgesTo', 'getKnowledgeSubgraph',
        'upsertKnowledgeEdges', 'deleteKnowledgeEdge', 'deleteKnowledgeEdgesForEntity',
        'getFaultLocalizations', 'upsertFaultLocalization', 'deleteFaultLocalization',
      ].map(name => [name, vi.fn().mockResolvedValue(null)])
    ),
    ...overrides,
  } as unknown as LiBrainianStorage;
}

// ============================================================================
// TESTS: ERROR CLASSIFICATION
// ============================================================================

describe('classifyError', () => {
  it('classifies TypeError', () => {
    expect(classifyError('TypeError: Cannot read property of undefined')).toBe('type_error');
    expect(classifyError("Type 'string' is not assignable to type 'number'")).toBe('type_error');
    expect(classifyError('foo is not a function')).toBe('type_error');
  });

  it('classifies ReferenceError', () => {
    expect(classifyError('ReferenceError: foo is not defined')).toBe('reference_error');
    expect(classifyError('Cannot find name myVariable')).toBe('reference_error');
  });

  it('classifies SyntaxError', () => {
    expect(classifyError('SyntaxError: Unexpected token')).toBe('syntax_error');
    expect(classifyError('Parsing error: unexpected end of input')).toBe('syntax_error');
  });

  it('classifies import errors', () => {
    expect(classifyError("Cannot find module 'express'")).toBe('import_error');
    expect(classifyError('Module not found: lodash')).toBe('import_error');
    expect(classifyError('ERR_REQUIRE_ESM')).toBe('import_error');
  });

  it('classifies network errors', () => {
    expect(classifyError('ECONNREFUSED 127.0.0.1:3000')).toBe('network_error');
    expect(classifyError('ETIMEDOUT connecting to api.example.com')).toBe('network_error');
    expect(classifyError('getaddrinfo ENOTFOUND example.com')).toBe('network_error');
  });

  it('classifies runtime errors', () => {
    expect(classifyError('ENOENT: no such file or directory')).toBe('runtime_error');
    expect(classifyError('EACCES: permission denied')).toBe('runtime_error');
    expect(classifyError('File not found: config.json')).toBe('runtime_error');
  });

  it('classifies test failures', () => {
    expect(classifyError('Test failed: expected 1 but received 2')).toBe('test_failure');
    expect(classifyError('expect(received).toBe(expected)')).toBe('test_failure');
    expect(classifyError('Assertion failed in jest test')).toBe('test_failure');
  });

  it('classifies build errors', () => {
    expect(classifyError('Build failed: tsc exited with code 1')).toBe('build_error');
    expect(classifyError('Compile error in webpack')).toBe('build_error');
    expect(classifyError('esbuild failed')).toBe('build_error');
  });

  it('classifies configuration errors', () => {
    expect(classifyError('Missing environment variable')).toBe('configuration_error');
    expect(classifyError('Invalid config setting')).toBe('configuration_error');
    expect(classifyError('configuration error in app')).toBe('configuration_error');
    // Note: ".env file not found" matches runtime_error first due to "file not found"
    // This is the expected behavior - file system errors take precedence
  });

  it('classifies async errors', () => {
    expect(classifyError('Unhandled promise rejection')).toBe('async_error');
    expect(classifyError('await used outside of async function')).toBe('async_error');
    expect(classifyError('Promise.reject() was called')).toBe('async_error');
  });

  it('classifies database errors', () => {
    expect(classifyError('SQLITE_BUSY: database is locked')).toBe('database_error');
    expect(classifyError('PostgreSQL connection failed')).toBe('database_error');
    expect(classifyError('MySQL query syntax error')).toBe('database_error');
  });

  it('returns unknown for unrecognized errors', () => {
    expect(classifyError('Something went wrong')).toBe('unknown');
    expect(classifyError('')).toBe('unknown');
  });
});

// ============================================================================
// TESTS: PATTERN MATCHING
// ============================================================================

describe('findMatchingPattern', () => {
  it('matches "Cannot find module" pattern', () => {
    const pattern = findMatchingPattern("Cannot find module 'lodash'");
    expect(pattern).not.toBeNull();
    expect(pattern?.type).toBe('import_error');
    expect(pattern?.fixes).toContain('Run npm install to ensure dependencies are installed');
  });

  it('matches "is not a function" pattern', () => {
    const pattern = findMatchingPattern('foo.bar is not a function');
    expect(pattern).not.toBeNull();
    expect(pattern?.type).toBe('type_error');
  });

  it('matches "Cannot read propert" pattern', () => {
    const pattern = findMatchingPattern("Cannot read property 'foo' of undefined");
    expect(pattern).not.toBeNull();
    expect(pattern?.type).toBe('type_error');
    expect(pattern?.fixes).toContain('Use optional chaining (?.) for safe property access');
  });

  it('matches ENOENT pattern', () => {
    const pattern = findMatchingPattern('ENOENT: no such file');
    expect(pattern).not.toBeNull();
    expect(pattern?.type).toBe('runtime_error');
  });

  it('matches network error patterns', () => {
    expect(findMatchingPattern('ECONNREFUSED 127.0.0.1')?.type).toBe('network_error');
    expect(findMatchingPattern('ETIMEDOUT')?.type).toBe('network_error');
  });

  it('matches SQLite patterns', () => {
    expect(findMatchingPattern('SQLITE_BUSY')?.type).toBe('database_error');
    expect(findMatchingPattern('SQLITE_CONSTRAINT violation')?.type).toBe('database_error');
  });

  it('returns null for no match', () => {
    expect(findMatchingPattern('some random error')).toBeNull();
  });
});

// ============================================================================
// TESTS: IDENTIFIER EXTRACTION
// ============================================================================

describe('extractIdentifiers', () => {
  it('extracts quoted strings', () => {
    const ids = extractIdentifiers("Cannot find module 'express'");
    expect(ids).toContain('express');
  });

  it('extracts PascalCase identifiers', () => {
    const ids = extractIdentifiers('Error in LiBrainianStorage.getFiles');
    expect(ids).toContain('LiBrainianStorage');
  });

  it('extracts camelCase identifiers', () => {
    const ids = extractIdentifiers('undefined is not a function at createLiBrainian');
    expect(ids).toContain('createLiBrainian');
  });

  it('extracts file paths', () => {
    const ids = extractIdentifiers('Error in src/api/query.ts');
    expect(ids).toContain('src/api/query.ts');
  });

  it('deduplicates identifiers', () => {
    const ids = extractIdentifiers("Error 'foo' and also 'foo'");
    expect(ids.filter(id => id === 'foo').length).toBe(1);
  });

  it('handles empty string', () => {
    expect(extractIdentifiers('')).toEqual([]);
  });
});

// ============================================================================
// TESTS: FIX GENERATION
// ============================================================================

describe('generateFixes', () => {
  it('generates fixes from pattern', () => {
    const pattern = ERROR_PATTERNS['Cannot find module'];
    const fixes = generateFixes('Cannot find module', 'import_error', pattern, []);
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes[0].confidence).toBeGreaterThan(0);
  });

  it('generates type-specific fixes for import errors', () => {
    const fixes = generateFixes('Cannot find module xyz', 'import_error', null, []);
    const npmFix = fixes.find(f => f.description.includes('Install missing package'));
    expect(npmFix).toBeDefined();
    expect(npmFix?.code).toBe('npm install <package-name>');
  });

  it('generates fixes for type errors with undefined', () => {
    const fixes = generateFixes('undefined is not a function', 'type_error', null, []);
    const nullCheckFix = fixes.find(f => f.description.includes('null check'));
    expect(nullCheckFix).toBeDefined();
  });

  it('generates async error fixes', () => {
    const fixes = generateFixes('Unhandled promise rejection', 'async_error', null, []);
    const tryCatchFix = fixes.find(f => f.code?.includes('try'));
    expect(tryCatchFix).toBeDefined();
  });

  it('generates database error fixes', () => {
    const fixes = generateFixes('SQLITE_BUSY', 'database_error', null, []);
    const walFix = fixes.find(f => f.description.includes('WAL'));
    expect(walFix).toBeDefined();
  });

  it('limits fixes to 5', () => {
    const fixes = generateFixes('complex error', 'type_error', ERROR_PATTERNS['is not a function'], []);
    expect(fixes.length).toBeLessThanOrEqual(5);
  });

  it('sorts fixes by confidence', () => {
    const fixes = generateFixes('Cannot find module', 'import_error', ERROR_PATTERNS['Cannot find module'], []);
    for (let i = 0; i < fixes.length - 1; i++) {
      expect(fixes[i].confidence).toBeGreaterThanOrEqual(fixes[i + 1].confidence);
    }
  });
});

// ============================================================================
// TESTS: CAUSE INFERENCE
// ============================================================================

describe('inferLikelyCause', () => {
  it('infers cause for undefined property access', () => {
    const cause = inferLikelyCause("Cannot read property 'foo' of undefined", 'type_error', []);
    expect(cause).toContain('undefined');
    expect(cause).toContain('async');
  });

  it('infers cause for undefined variable', () => {
    const cause = inferLikelyCause('foo is not defined', 'reference_error', []);
    expect(cause).toContain('scope');
  });

  it('infers cause for not a function', () => {
    const cause = inferLikelyCause('bar is not a function', 'type_error', []);
    expect(cause).toContain('callable');
  });

  it('infers cause for ENOENT', () => {
    const cause = inferLikelyCause('ENOENT: no such file', 'runtime_error', []);
    expect(cause).toContain('path');
  });

  it('infers cause for connection refused', () => {
    const cause = inferLikelyCause('ECONNREFUSED', 'network_error', []);
    expect(cause).toContain('service');
  });

  it('returns type-based cause for unknown errors', () => {
    const cause = inferLikelyCause('some error', 'unknown', []);
    expect(cause).toBeTruthy();
  });
});

// ============================================================================
// TESTS: RELATED ERRORS
// ============================================================================

describe('findRelatedErrors', () => {
  it('finds related errors for type errors', () => {
    const related = findRelatedErrors('undefined error', 'type_error');
    expect(related.length).toBeGreaterThan(0);
  });

  it('finds related errors for import errors', () => {
    const related = findRelatedErrors('Cannot find module', 'import_error');
    expect(related.some(r => r.includes('Build'))).toBe(true);
  });

  it('finds related errors for async errors', () => {
    const related = findRelatedErrors('unhandled rejection', 'async_error');
    expect(related.length).toBeGreaterThan(0);
  });

  it('finds related errors for database errors', () => {
    const related = findRelatedErrors('SQLITE_BUSY', 'database_error');
    expect(related.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// TESTS: DOCUMENTATION
// ============================================================================

describe('findDocumentation', () => {
  it('returns MDN link for type errors', () => {
    const doc = findDocumentation('type_error');
    expect(doc).toContain('developer.mozilla.org');
    expect(doc).toContain('TypeError');
  });

  it('returns MDN link for reference errors', () => {
    const doc = findDocumentation('reference_error');
    expect(doc).toContain('ReferenceError');
  });

  it('returns MDN link for syntax errors', () => {
    const doc = findDocumentation('syntax_error');
    expect(doc).toContain('SyntaxError');
  });

  it('returns Node.js link for import errors', () => {
    const doc = findDocumentation('import_error');
    expect(doc).toContain('nodejs.org');
  });

  it('returns undefined for unknown type', () => {
    expect(findDocumentation('unknown')).toBeUndefined();
  });

  it('returns undefined for test failures', () => {
    expect(findDocumentation('test_failure')).toBeUndefined();
  });
});

// ============================================================================
// TESTS: QUERY DETECTION
// ============================================================================

describe('isErrorExplanationQuery', () => {
  it('detects "explain this error" queries', () => {
    expect(isErrorExplanationQuery('explain this error: Cannot find module')).toBe(true);
    expect(isErrorExplanationQuery('Explain error: foo is undefined')).toBe(true);
  });

  it('detects "what does this error mean" queries', () => {
    expect(isErrorExplanationQuery('what does this error mean?')).toBe(true);
    expect(isErrorExplanationQuery('What does error mean')).toBe(true);
  });

  it('detects "why am I getting" queries', () => {
    expect(isErrorExplanationQuery('why am I getting this error?')).toBe(true);
    expect(isErrorExplanationQuery('why do I get this error')).toBe(true);
  });

  it('detects "help me fix" queries', () => {
    expect(isErrorExplanationQuery('help me fix this error')).toBe(true);
    expect(isErrorExplanationQuery('help understand this')).toBe(true);
  });

  it('detects "how to fix" queries', () => {
    expect(isErrorExplanationQuery('how do I fix this?')).toBe(true);
    expect(isErrorExplanationQuery('how to fix ENOENT')).toBe(true);
  });

  it('does not match unrelated queries', () => {
    expect(isErrorExplanationQuery('what is the purpose of this function')).toBe(false);
    expect(isErrorExplanationQuery('show me the code for LiBrainianStorage')).toBe(false);
  });
});

// ============================================================================
// TESTS: ERROR EXTRACTION
// ============================================================================

describe('extractErrorFromQuery', () => {
  it('extracts quoted error messages', () => {
    expect(extractErrorFromQuery('explain this error: "Cannot find module"')).toBe('Cannot find module');
    expect(extractErrorFromQuery("explain 'TypeError: foo is undefined'")).toBe('TypeError: foo is undefined');
  });

  it('extracts error after colon', () => {
    expect(extractErrorFromQuery('explain this error: ENOENT file not found')).toBe('ENOENT file not found');
  });

  it('extracts error after explain keyword', () => {
    expect(extractErrorFromQuery('explain Cannot read property foo')).toBe('Cannot read property foo');
  });

  it('returns full intent if no pattern matches', () => {
    const intent = 'some random query';
    expect(extractErrorFromQuery(intent)).toBe(intent);
  });
});

// ============================================================================
// TESTS: FULL EXPLANATION
// ============================================================================

describe('explainError', () => {
  it('returns complete ErrorExplanation', async () => {
    const storage = createMockStorage();
    const explanation = await explainError('Cannot find module express', storage);

    expect(explanation.error).toBe('Cannot find module express');
    expect(explanation.type).toBe('import_error');
    expect(explanation.explanation).toBeTruthy();
    expect(explanation.likelyCause).toBeTruthy();
    expect(Array.isArray(explanation.relevantCode)).toBe(true);
    expect(Array.isArray(explanation.suggestedFixes)).toBe(true);
    expect(Array.isArray(explanation.relatedErrors)).toBe(true);
  });

  it('includes documentation link when available', async () => {
    const storage = createMockStorage();
    const explanation = await explainError('TypeError: foo is undefined', storage);

    expect(explanation.documentation).toContain('mozilla.org');
  });

  it('uses context when provided', async () => {
    const mockFile: FileKnowledge = {
      id: 'file-1',
      path: '/src/api/query.ts',
      relativePath: 'src/api/query.ts',
      name: 'query.ts',
      extension: '.ts',
      category: 'code',
      purpose: 'Query API',
      role: 'api',
      summary: 'Query functions',
      keyExports: [],
      mainConcepts: [],
      lineCount: 100,
      functionCount: 10,
      classCount: 0,
      importCount: 5,
      exportCount: 5,
      imports: [],
      importedBy: [],
      directory: '/src/api',
      complexity: 'medium',
      hasTests: true,
      checksum: 'abc123',
      confidence: 0.9,
      lastIndexed: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };

    const storage = createMockStorage({
      getFileByPath: vi.fn().mockResolvedValue(mockFile),
    });

    const explanation = await explainError('Error in query.ts', storage, {
      file: '/src/api/query.ts',
      line: 42,
    });

    expect(storage.getFileByPath).toHaveBeenCalledWith('/src/api/query.ts');
    expect(explanation.relevantCode.some(r => r.file === '/src/api/query.ts')).toBe(true);
  });

  it('searches for functions by extracted identifiers', async () => {
    const mockFunction: FunctionKnowledge = {
      id: 'func-1',
      filePath: '/src/api/librainian.ts',
      name: 'createLiBrainian',
      signature: 'createLiBrainian(config: LiBrainianConfig): LiBrainian',
      purpose: 'Create a LiBrainian instance',
      startLine: 10,
      endLine: 50,
      confidence: 0.9,
      accessCount: 0,
      lastAccessed: null,
      validationCount: 0,
      outcomeHistory: { successes: 0, failures: 0 },
    };

    const storage = createMockStorage({
      getFunctionsByName: vi.fn().mockResolvedValue([mockFunction]),
    });

    const explanation = await explainError(
      "Error in 'createLiBrainian': foo is undefined",
      storage
    );

    expect(storage.getFunctionsByName).toHaveBeenCalledWith('createLiBrainian');
    expect(explanation.relevantCode.some(r => r.relevance.includes('createLiBrainian'))).toBe(true);
  });

  it('handles storage errors gracefully', async () => {
    const storage = createMockStorage({
      getFileByPath: vi.fn().mockRejectedValue(new Error('Storage error')),
      getFunctionsByName: vi.fn().mockRejectedValue(new Error('Storage error')),
    });

    // Should not throw
    const explanation = await explainError('Some error', storage, {
      file: '/some/path.ts',
    });

    expect(explanation.error).toBe('Some error');
    expect(Array.isArray(explanation.relevantCode)).toBe(true);
  });
});

// ============================================================================
// TESTS: ERROR PATTERN COVERAGE
// ============================================================================

describe('ERROR_PATTERNS', () => {
  it('has explanations for all patterns', () => {
    for (const [key, config] of Object.entries(ERROR_PATTERNS)) {
      expect(config.explanation).toBeTruthy();
      expect(config.explanation.length).toBeGreaterThan(10);
    }
  });

  it('has fixes for all patterns', () => {
    for (const [key, config] of Object.entries(ERROR_PATTERNS)) {
      expect(Array.isArray(config.fixes)).toBe(true);
      expect(config.fixes.length).toBeGreaterThan(0);
    }
  });

  it('has valid error types for all patterns', () => {
    const validTypes: ErrorType[] = [
      'type_error', 'reference_error', 'syntax_error', 'runtime_error',
      'async_error', 'import_error', 'test_failure', 'build_error',
      'configuration_error', 'network_error', 'database_error', 'unknown',
    ];

    for (const [key, config] of Object.entries(ERROR_PATTERNS)) {
      expect(validTypes).toContain(config.type);
    }
  });
});

// ============================================================================
// TESTS: STAGE INTEGRATION
// ============================================================================

import {
  runErrorExplanationStage,
  createErrorExplanationPack,
  createRelevantCodePacks,
  formatErrorSummary,
} from '../error_explanation.js';
import type { LiBrainianVersion } from '../../types.js';

const mockVersion: LiBrainianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0',
  qualityTier: 'full',
  indexedAt: new Date(),
  indexerVersion: '1.0.0',
  features: [],
};

describe('runErrorExplanationStage', () => {
  it('returns analyzed=false for non-error queries', async () => {
    const storage = createMockStorage();
    const result = await runErrorExplanationStage({
      storage,
      intent: 'what is the purpose of LiBrainianStorage',
      version: mockVersion,
    });

    expect(result.analyzed).toBe(false);
    expect(result.packs).toHaveLength(0);
  });

  it('analyzes error explanation queries', async () => {
    const storage = createMockStorage();
    const result = await runErrorExplanationStage({
      storage,
      intent: 'explain this error: Cannot find module express',
      version: mockVersion,
    });

    expect(result.analyzed).toBe(true);
    expect(result.packs.length).toBeGreaterThan(0);
    expect(result.explanation).toContain('import_error');
    expect(result.errorExplanation).toBeDefined();
    expect(result.errorExplanation?.type).toBe('import_error');
  });

  it('analyzes even minimal error queries', async () => {
    const storage = createMockStorage();
    // "explain error" extracts "error" as the error message
    // This is valid and will be analyzed (even if not very useful)
    const result = await runErrorExplanationStage({
      storage,
      intent: 'explain error',
      version: mockVersion,
    });

    // The query is detected and analyzed (extracts "error" as the message)
    expect(result.analyzed).toBe(true);
    expect(result.packs.length).toBeGreaterThan(0);
    // The error type will be unknown since "error" alone doesn't match patterns
    expect(result.errorExplanation?.type).toBe('unknown');
  });

  it('uses context when provided', async () => {
    const mockFile: FileKnowledge = {
      id: 'file-1',
      path: '/src/api/query.ts',
      relativePath: 'src/api/query.ts',
      name: 'query.ts',
      extension: '.ts',
      category: 'code',
      purpose: 'Query API',
      role: 'api',
      summary: 'Query functions',
      keyExports: [],
      mainConcepts: [],
      lineCount: 100,
      functionCount: 10,
      classCount: 0,
      importCount: 5,
      exportCount: 5,
      imports: [],
      importedBy: [],
      directory: '/src/api',
      complexity: 'medium',
      hasTests: true,
      checksum: 'abc123',
      confidence: 0.9,
      lastIndexed: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };

    const storage = createMockStorage({
      getFileByPath: vi.fn().mockResolvedValue(mockFile),
    });

    const result = await runErrorExplanationStage({
      storage,
      intent: 'explain this error: TypeError in query.ts',
      version: mockVersion,
      context: { file: '/src/api/query.ts', line: 42 },
    });

    expect(result.analyzed).toBe(true);
    expect(storage.getFileByPath).toHaveBeenCalledWith('/src/api/query.ts');
  });
});

describe('createErrorExplanationPack', () => {
  it('creates a valid context pack', () => {
    const explanation: ErrorExplanation = {
      error: 'Cannot find module express',
      type: 'import_error',
      explanation: 'Module not found',
      likelyCause: 'Package not installed',
      relevantCode: [],
      suggestedFixes: [
        { description: 'Run npm install', confidence: 0.8 },
        { description: 'Check import path', code: "import x from './x.js'", confidence: 0.7 },
      ],
      relatedErrors: ['Build error'],
      documentation: 'https://nodejs.org/api/errors.html',
    };

    const pack = createErrorExplanationPack(explanation, mockVersion);

    expect(pack.packId).toMatch(/^err_/);
    expect(pack.packType).toBe('function_context');
    expect(pack.targetId).toBe('error:import_error');
    expect(pack.summary).toContain('Cannot find module');
    expect(pack.keyFacts).toContain('Error Type: import_error');
    expect(pack.keyFacts).toContain('Likely Cause: Package not installed');
    expect(pack.confidence).toBe(0.85);
  });

  it('includes code snippets from suggested fixes', () => {
    const explanation: ErrorExplanation = {
      error: 'Test error',
      type: 'type_error',
      explanation: 'Type error',
      likelyCause: 'Wrong type',
      relevantCode: [],
      suggestedFixes: [
        { description: 'Add type check', code: 'if (typeof x === "string") {}', confidence: 0.7 },
      ],
      relatedErrors: [],
    };

    const pack = createErrorExplanationPack(explanation, mockVersion);

    expect(pack.codeSnippets.length).toBe(1);
    expect(pack.codeSnippets[0].content).toContain('typeof');
  });
});

describe('createRelevantCodePacks', () => {
  it('creates packs for relevant code', () => {
    const explanation: ErrorExplanation = {
      error: 'Test error',
      type: 'type_error',
      explanation: 'Type error',
      likelyCause: 'Wrong type',
      relevantCode: [
        { file: '/src/a.ts', line: 10, snippet: 'const x = 1', relevance: 'Error location' },
        { file: '/src/b.ts', line: 20, snippet: 'const y = 2', relevance: 'Related code' },
      ],
      suggestedFixes: [],
      relatedErrors: [],
    };

    const packs = createRelevantCodePacks(explanation, mockVersion);

    expect(packs.length).toBe(2);
    expect(packs[0].summary).toContain('Error location');
    expect(packs[0].relatedFiles).toContain('/src/a.ts');
    expect(packs[1].summary).toContain('Related code');
  });

  it('limits to 3 packs', () => {
    const explanation: ErrorExplanation = {
      error: 'Test error',
      type: 'type_error',
      explanation: 'Type error',
      likelyCause: 'Wrong type',
      relevantCode: [
        { file: '/src/a.ts', line: 1, snippet: '', relevance: '1' },
        { file: '/src/b.ts', line: 2, snippet: '', relevance: '2' },
        { file: '/src/c.ts', line: 3, snippet: '', relevance: '3' },
        { file: '/src/d.ts', line: 4, snippet: '', relevance: '4' },
        { file: '/src/e.ts', line: 5, snippet: '', relevance: '5' },
      ],
      suggestedFixes: [],
      relatedErrors: [],
    };

    const packs = createRelevantCodePacks(explanation, mockVersion);

    expect(packs.length).toBe(3);
  });
});

describe('formatErrorSummary', () => {
  it('formats a complete error summary', () => {
    const explanation: ErrorExplanation = {
      error: 'Cannot find module express',
      type: 'import_error',
      explanation: 'The specified module cannot be found.',
      likelyCause: 'Package not installed or path incorrect.',
      relevantCode: [],
      suggestedFixes: [
        { description: 'Run npm install', confidence: 0.8 },
        { description: 'Check path', code: "import x from './x.js'", confidence: 0.7 },
      ],
      relatedErrors: [],
      documentation: 'https://example.com/docs',
    };

    const summary = formatErrorSummary(explanation);

    expect(summary).toContain('**Error:**');
    expect(summary).toContain('Cannot find module express');
    expect(summary).toContain('**Type:**');
    expect(summary).toContain('import_error');
    expect(summary).toContain('**Explanation:**');
    expect(summary).toContain('**Likely Cause:**');
    expect(summary).toContain('**Suggested Fixes:**');
    expect(summary).toContain('80% confidence');
    expect(summary).toContain('**Documentation:**');
  });

  it('handles missing optional fields', () => {
    const explanation: ErrorExplanation = {
      error: 'Simple error',
      type: 'unknown',
      explanation: 'Unknown error',
      likelyCause: 'Unknown cause',
      relevantCode: [],
      suggestedFixes: [],
      relatedErrors: [],
    };

    const summary = formatErrorSummary(explanation);

    expect(summary).toContain('Simple error');
    expect(summary).not.toContain('**Documentation:**');
  });
});
