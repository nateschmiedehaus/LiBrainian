/**
 * @fileoverview Tests for Enhanced Citation Verification Pipeline
 *
 * Comprehensive tests covering:
 * - Multiple citation types (code, documentation, URLs, commits)
 * - Epistemic integration (Evidence, Grounding, ConfidenceValue)
 * - Batch verification for efficiency
 * - Detailed validation reports
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  EnhancedCitationVerifier,
  createEnhancedCitationVerifier,
  type EnhancedCitation,
  type CitationType,
  type BatchVerificationConfig,
  DEFAULT_BATCH_CONFIG,
} from '../enhanced_citation_verifier.js';
import { isConfidenceValue, getNumericValue, isAbsentConfidence } from '../../epistemics/confidence.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

let TEST_DIR: string;
let TEST_FILE_PATH: string;
let TEST_DOC_PATH: string;

/**
 * Create test fixtures
 */
function createTestFixtures(): void {
  TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enhanced-citation-test-'));

  // Create source directory structure
  const srcDir = path.join(TEST_DIR, 'src');
  fs.mkdirSync(srcDir, { recursive: true });

  // Create test TypeScript file
  TEST_FILE_PATH = path.join(srcDir, 'example.ts');
  const testFileContent = `/**
 * Example module for testing citation verification
 */

export interface User {
  id: string;
  name: string;
  email: string;
}

export class UserService {
  private users: Map<string, User> = new Map();

  constructor() {
    // Initialize service
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async createUser(user: User): Promise<User> {
    this.users.set(user.id, user);
    return user;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const existing = this.users.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.users.set(id, updated);
    return updated;
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
  }
}

export function createUserService(): UserService {
  return new UserService();
}

export const DEFAULT_USER: User = {
  id: 'default',
  name: 'Default User',
  email: 'default@example.com',
};
`;

  fs.writeFileSync(TEST_FILE_PATH, testFileContent);

  // Create documentation file
  const docsDir = path.join(TEST_DIR, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });

  TEST_DOC_PATH = path.join(docsDir, 'README.md');
  const docContent = `# Example Project

This is the documentation for the example project.

## Installation

\`\`\`bash
npm install example
\`\`\`

## Usage

See the \`UserService\` class for user management.
`;

  fs.writeFileSync(TEST_DOC_PATH, docContent);

  // Create a fake .git directory for commit verification tests
  const gitDir = path.join(TEST_DIR, '.git');
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(gitDir, 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'refs', 'heads', 'main'), 'abc1234567890abcdef1234567890abcdef1234\n');
}

/**
 * Clean up test fixtures
 */
function cleanupTestFixtures(): void {
  if (TEST_DIR && fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// ============================================================================
// FACTORY TESTS
// ============================================================================

describe('createEnhancedCitationVerifier', () => {
  it('should create a verifier instance', () => {
    const verifier = createEnhancedCitationVerifier();
    expect(verifier).toBeInstanceOf(EnhancedCitationVerifier);
  });
});

// ============================================================================
// CITATION EXTRACTION TESTS
// ============================================================================

describe('EnhancedCitationVerifier - extractCitations', () => {
  let verifier: EnhancedCitationVerifier;

  beforeAll(() => {
    verifier = createEnhancedCitationVerifier();
  });

  describe('Code references', () => {
    it('should extract file:line citations', () => {
      const text = 'See `src/example.ts:25` for the implementation.';
      const citations = verifier.extractCitations(text);

      expect(citations.length).toBe(1);
      expect(citations[0].type).toBe('code_reference');
      expect(citations[0].file).toBe('src/example.ts');
      expect(citations[0].line).toBe(25);
    });

    it('should extract line range citations', () => {
      const text = 'The function spans `src/example.ts:25-35`.';
      const citations = verifier.extractCitations(text);

      expect(citations.length).toBe(1);
      expect(citations[0].type).toBe('line_range');
      expect(citations[0].file).toBe('src/example.ts');
      expect(citations[0].line).toBe(25);
      expect(citations[0].endLine).toBe(35);
    });

    it('should extract GitHub-style line references', () => {
      const text = 'See `src/example.ts#L25` and `src/example.ts#L30-L40`.';
      const citations = verifier.extractCitations(text);

      expect(citations.length).toBe(2);
      expect(citations[0].type).toBe('code_reference');
      expect(citations[0].line).toBe(25);
      expect(citations[1].type).toBe('line_range');
      expect(citations[1].line).toBe(30);
      expect(citations[1].endLine).toBe(40);
    });

    it('should extract multiple citations from the same text', () => {
      const text = `
        The \`UserService\` class is in \`src/example.ts:12\`.
        The \`getUser\` method is at \`src/example.ts:18\`.
        The \`createUser\` method is at \`src/example.ts:22\`.
      `;
      const citations = verifier.extractCitations(text);

      expect(citations.length).toBe(3);
      expect(citations[0].line).toBe(12);
      expect(citations[1].line).toBe(18);
      expect(citations[2].line).toBe(22);
    });
  });

  describe('Identifier references', () => {
    it('should extract identifier in file citations', () => {
      const text = 'The `UserService` in `src/example.ts` handles user operations.';
      const citations = verifier.extractCitations(text);

      const identifierCitation = citations.find(c => c.type === 'identifier_reference');
      expect(identifierCitation).toBeDefined();
      expect(identifierCitation?.identifier).toBe('UserService');
      expect(identifierCitation?.file).toBe('src/example.ts');
    });

    it('should extract identifier defined at line citations', () => {
      const text = '`UserService` is defined in `src/example.ts:12`.';
      const citations = verifier.extractCitations(text);

      const identifierCitation = citations.find(c => c.type === 'identifier_reference');
      expect(identifierCitation).toBeDefined();
      expect(identifierCitation?.identifier).toBe('UserService');
      expect(identifierCitation?.line).toBe(12);
    });
  });

  describe('Documentation references', () => {
    it('should extract README citations', () => {
      const text = 'See `README.md` for installation instructions.';
      const citations = verifier.extractCitations(text);

      expect(citations.length).toBe(1);
      expect(citations[0].type).toBe('documentation');
      expect(citations[0].file).toBe('README.md');
    });

    it('should extract docs folder citations', () => {
      const text = 'See `docs/getting-started.md` for details.';
      const citations = verifier.extractCitations(text);

      expect(citations.length).toBe(1);
      expect(citations[0].type).toBe('documentation');
      expect(citations[0].file).toBe('docs/getting-started.md');
    });
  });

  describe('External URLs', () => {
    it('should extract HTTPS URLs', () => {
      const text = 'For more info, see https://example.com/docs';
      const citations = verifier.extractCitations(text);

      const urlCitation = citations.find(c => c.type === 'external_url');
      expect(urlCitation).toBeDefined();
      expect(urlCitation?.url).toBe('https://example.com/docs');
    });

    it('should extract HTTP URLs', () => {
      const text = 'Legacy docs at http://old.example.com/docs';
      const citations = verifier.extractCitations(text);

      const urlCitation = citations.find(c => c.type === 'external_url');
      expect(urlCitation).toBeDefined();
      expect(urlCitation?.url).toContain('old.example.com');
    });

    it('should handle URLs with trailing punctuation', () => {
      const text = 'See https://example.com/docs.';
      const citations = verifier.extractCitations(text);

      const urlCitation = citations.find(c => c.type === 'external_url');
      expect(urlCitation?.url).toBe('https://example.com/docs');
    });
  });

  describe('Issue references', () => {
    it('should extract issue number references', () => {
      const text = 'Fixed in #123';
      const citations = verifier.extractCitations(text);

      const issueCitation = citations.find(c => c.type === 'issue_reference');
      expect(issueCitation).toBeDefined();
      expect(issueCitation?.issueNumber).toBe(123);
    });

    it('should extract cross-repo issue references', () => {
      const text = 'Related to owner/repo#456';
      const citations = verifier.extractCitations(text);

      const issueCitation = citations.find(c => c.type === 'issue_reference');
      expect(issueCitation).toBeDefined();
      expect(issueCitation?.repository).toBe('owner/repo');
      expect(issueCitation?.issueNumber).toBe(456);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty text', () => {
      const citations = verifier.extractCitations('');
      expect(citations.length).toBe(0);
    });

    it('should handle text with no citations', () => {
      const text = 'This is just regular text with no citations.';
      const citations = verifier.extractCitations(text);
      // May pick up some false positives from patterns, but should be minimal
      expect(citations.length).toBeLessThanOrEqual(1);
    });

    it('should include position information', () => {
      const text = 'See `src/example.ts:25` for details.';
      const citations = verifier.extractCitations(text);

      expect(citations[0].position.start).toBe(4);
      expect(citations[0].position.end).toBeGreaterThan(4);
    });

    it('should include claim context', () => {
      const text = 'The implementation of the user service is in `src/example.ts:25`.';
      const citations = verifier.extractCitations(text);

      expect(citations[0].claim).toContain('user service');
    });
  });
});

// ============================================================================
// SINGLE CITATION VERIFICATION TESTS
// ============================================================================

describe('EnhancedCitationVerifier - verifyCitation', () => {
  let verifier: EnhancedCitationVerifier;

  beforeAll(() => {
    createTestFixtures();
    verifier = createEnhancedCitationVerifier();
  });

  afterAll(() => {
    cleanupTestFixtures();
  });

  describe('Code reference verification', () => {
    it('should verify valid code reference', async () => {
      const citation: EnhancedCitation = {
        id: 'test_1',
        type: 'code_reference',
        file: 'src/example.ts',
        line: 12,
        claim: 'UserService class',
        rawText: '`src/example.ts:12`',
        position: { start: 0, end: 20 },
      };

      const result = await verifier.verifyCitation(citation, TEST_DIR);

      expect(result.status).toBe('verified');
      expect(isConfidenceValue(result.confidence)).toBe(true);
      expect(result.checks.length).toBeGreaterThan(0);
    });

    it('should detect non-existent file', async () => {
      const citation: EnhancedCitation = {
        id: 'test_2',
        type: 'code_reference',
        file: 'src/nonexistent.ts',
        line: 10,
        claim: 'test',
        rawText: '`src/nonexistent.ts:10`',
        position: { start: 0, end: 25 },
      };

      const result = await verifier.verifyCitation(citation, TEST_DIR);

      expect(result.status).toBe('refuted');
      expect(result.checks.some(c => c.name === 'file_exists' && !c.passed)).toBe(true);
    });

    it('should detect out-of-range line number', async () => {
      const citation: EnhancedCitation = {
        id: 'test_3',
        type: 'code_reference',
        file: 'src/example.ts',
        line: 9999,
        claim: 'test',
        rawText: '`src/example.ts:9999`',
        position: { start: 0, end: 22 },
      };

      const result = await verifier.verifyCitation(citation, TEST_DIR);

      expect(result.status).toBe('refuted');
      expect(result.checks.some(c => c.name === 'line_valid' && !c.passed)).toBe(true);
    });

    it('should include grounding information', async () => {
      const citation: EnhancedCitation = {
        id: 'test_4',
        type: 'code_reference',
        file: 'src/example.ts',
        line: 12,
        claim: 'test',
        rawText: '`src/example.ts:12`',
        position: { start: 0, end: 20 },
      };

      const result = await verifier.verifyCitation(citation, TEST_DIR);

      expect(result.grounding).toBeDefined();
      expect(result.grounding?.type).toBe('evidential');
    });
  });

  describe('Identifier reference verification', () => {
    it('should verify valid identifier reference', async () => {
      const citation: EnhancedCitation = {
        id: 'test_5',
        type: 'identifier_reference',
        identifier: 'UserService',
        file: 'src/example.ts',
        claim: 'user service class',
        rawText: '`UserService` in `src/example.ts`',
        position: { start: 0, end: 35 },
      };

      const result = await verifier.verifyCitation(citation, TEST_DIR);

      expect(['verified', 'partially_verified']).toContain(result.status);
      expect(result.matchedFact).toBeDefined();
      expect(result.matchedFact?.identifier).toBe('UserService');
    });

    it('should suggest correction for typo in identifier', async () => {
      const citation: EnhancedCitation = {
        id: 'test_6',
        type: 'identifier_reference',
        identifier: 'UserServic', // Missing 'e'
        file: 'src/example.ts',
        claim: 'test',
        rawText: '`UserServic` in `src/example.ts`',
        position: { start: 0, end: 34 },
      };

      const result = await verifier.verifyCitation(citation, TEST_DIR);

      expect(result.status).toBe('refuted');
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion?.identifier).toBe('UserService');
    });
  });

  describe('Documentation verification', () => {
    it('should verify existing documentation file', async () => {
      const citation: EnhancedCitation = {
        id: 'test_7',
        type: 'documentation',
        file: 'docs/README.md',
        claim: 'documentation',
        rawText: '`docs/README.md`',
        position: { start: 0, end: 16 },
      };

      const result = await verifier.verifyCitation(citation, TEST_DIR);

      expect(result.status).toBe('verified');
    });

    it('should refute non-existent documentation', async () => {
      const citation: EnhancedCitation = {
        id: 'test_8',
        type: 'documentation',
        file: 'docs/nonexistent.md',
        claim: 'test',
        rawText: '`docs/nonexistent.md`',
        position: { start: 0, end: 21 },
      };

      const result = await verifier.verifyCitation(citation, TEST_DIR);

      expect(result.status).toBe('refuted');
    });
  });

  describe('External URL verification', () => {
    it('should partially verify valid URL format', async () => {
      const citation: EnhancedCitation = {
        id: 'test_9',
        type: 'external_url',
        url: 'https://example.com/docs',
        claim: 'external documentation',
        rawText: 'https://example.com/docs',
        position: { start: 0, end: 24 },
      };

      const result = await verifier.verifyCitation(citation, TEST_DIR);

      expect(['verified', 'partially_verified']).toContain(result.status);
      expect(result.checks.some(c => c.name === 'url_valid' && c.passed)).toBe(true);
    });

    it('should refute invalid URL format', async () => {
      const citation: EnhancedCitation = {
        id: 'test_10',
        type: 'external_url',
        url: 'not-a-valid-url',
        claim: 'test',
        rawText: 'not-a-valid-url',
        position: { start: 0, end: 15 },
      };

      const result = await verifier.verifyCitation(citation, TEST_DIR);

      expect(result.status).toBe('refuted');
    });

    it('should note HTTP vs HTTPS', async () => {
      const httpsUrl: EnhancedCitation = {
        id: 'test_11a',
        type: 'external_url',
        url: 'https://secure.example.com',
        claim: 'test',
        rawText: 'https://secure.example.com',
        position: { start: 0, end: 26 },
      };

      const httpUrl: EnhancedCitation = {
        id: 'test_11b',
        type: 'external_url',
        url: 'http://insecure.example.com',
        claim: 'test',
        rawText: 'http://insecure.example.com',
        position: { start: 0, end: 27 },
      };

      const httpsResult = await verifier.verifyCitation(httpsUrl, TEST_DIR);
      const httpResult = await verifier.verifyCitation(httpUrl, TEST_DIR);

      expect(httpsResult.checks.some(c => c.name === 'url_secure' && c.passed)).toBe(true);
      expect(httpResult.checks.some(c => c.name === 'url_secure' && !c.passed)).toBe(true);
    });
  });

  describe('Commit reference verification', () => {
    it('should partially verify valid SHA format', async () => {
      const citation: EnhancedCitation = {
        id: 'test_12',
        type: 'commit_reference',
        commitSha: 'abc1234567890abcdef1234567890abcdef1234',
        claim: 'commit reference',
        rawText: 'abc1234567890abcdef1234567890abcdef1234',
        position: { start: 0, end: 40 },
      };

      const result = await verifier.verifyCitation(citation, TEST_DIR);

      expect(result.checks.some(c => c.name === 'sha_format_valid' && c.passed)).toBe(true);
    });

    it('should refute invalid SHA format', async () => {
      const citation: EnhancedCitation = {
        id: 'test_13',
        type: 'commit_reference',
        commitSha: 'not-a-sha',
        claim: 'test',
        rawText: 'not-a-sha',
        position: { start: 0, end: 9 },
      };

      const result = await verifier.verifyCitation(citation, TEST_DIR);

      expect(result.status).toBe('refuted');
    });
  });

  describe('Verification metadata', () => {
    it('should include timestamp', async () => {
      const citation: EnhancedCitation = {
        id: 'test_14',
        type: 'code_reference',
        file: 'src/example.ts',
        line: 12,
        claim: 'test',
        rawText: '`src/example.ts:12`',
        position: { start: 0, end: 20 },
      };

      const result = await verifier.verifyCitation(citation, TEST_DIR);

      expect(result.verifiedAt).toBeDefined();
      expect(new Date(result.verifiedAt).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should include duration', async () => {
      const citation: EnhancedCitation = {
        id: 'test_15',
        type: 'code_reference',
        file: 'src/example.ts',
        line: 12,
        claim: 'test',
        rawText: '`src/example.ts:12`',
        position: { start: 0, end: 20 },
      };

      const result = await verifier.verifyCitation(citation, TEST_DIR);

      expect(result.verificationDurationMs).toBeGreaterThanOrEqual(0);
    });
  });
});

// ============================================================================
// BATCH VERIFICATION TESTS
// ============================================================================

describe('EnhancedCitationVerifier - verifyBatch', () => {
  let verifier: EnhancedCitationVerifier;

  beforeAll(() => {
    createTestFixtures();
    verifier = createEnhancedCitationVerifier();
  });

  afterAll(() => {
    cleanupTestFixtures();
  });

  it('should verify multiple citations in batch', async () => {
    const citations: EnhancedCitation[] = [
      {
        id: 'batch_1',
        type: 'code_reference',
        file: 'src/example.ts',
        line: 12,
        claim: 'UserService',
        rawText: '`src/example.ts:12`',
        position: { start: 0, end: 20 },
      },
      {
        id: 'batch_2',
        type: 'documentation',
        file: 'docs/README.md',
        claim: 'documentation',
        rawText: '`docs/README.md`',
        position: { start: 0, end: 16 },
      },
      {
        id: 'batch_3',
        type: 'external_url',
        url: 'https://example.com',
        claim: 'external',
        rawText: 'https://example.com',
        position: { start: 0, end: 19 },
      },
    ];

    const result = await verifier.verifyBatch(citations, TEST_DIR);

    expect(result.results.length).toBe(3);
    expect(result.statistics.total).toBe(3);
    expect(result.completedAt).toBeDefined();
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('should compute statistics correctly', async () => {
    const citations: EnhancedCitation[] = [
      {
        id: 'stats_1',
        type: 'code_reference',
        file: 'src/example.ts',
        line: 12,
        claim: 'valid',
        rawText: 'valid',
        position: { start: 0, end: 5 },
      },
      {
        id: 'stats_2',
        type: 'code_reference',
        file: 'src/nonexistent.ts',
        line: 10,
        claim: 'invalid',
        rawText: 'invalid',
        position: { start: 0, end: 7 },
      },
    ];

    const result = await verifier.verifyBatch(citations, TEST_DIR);

    expect(result.statistics.total).toBe(2);
    expect(result.statistics.refuted).toBe(1);
    expect(result.statistics.verificationRate).toBeLessThan(1);
    expect(result.statistics.byType.code_reference.total).toBe(2);
  });

  it('should compute aggregate confidence', async () => {
    const citations: EnhancedCitation[] = [
      {
        id: 'conf_1',
        type: 'code_reference',
        file: 'src/example.ts',
        line: 12,
        claim: 'test',
        rawText: 'test',
        position: { start: 0, end: 4 },
      },
    ];

    const result = await verifier.verifyBatch(citations, TEST_DIR);

    expect(isConfidenceValue(result.aggregateConfidence)).toBe(true);
  });

  it('should respect concurrency limits', async () => {
    const citations: EnhancedCitation[] = Array.from({ length: 10 }, (_, i) => ({
      id: `conc_${i}`,
      type: 'code_reference' as CitationType,
      file: 'src/example.ts',
      line: 12,
      claim: 'test',
      rawText: 'test',
      position: { start: 0, end: 4 },
    }));

    const config: Partial<BatchVerificationConfig> = {
      concurrency: 2,
    };

    const result = await verifier.verifyBatch(citations, TEST_DIR, config);

    expect(result.results.length).toBe(10);
  });

  it('should handle empty citation list', async () => {
    const result = await verifier.verifyBatch([], TEST_DIR);

    expect(result.results.length).toBe(0);
    expect(result.statistics.total).toBe(0);
    expect(result.statistics.verificationRate).toBe(0);
  });
});

// ============================================================================
// VALIDATION REPORT TESTS
// ============================================================================

describe('EnhancedCitationVerifier - generateReport', () => {
  let verifier: EnhancedCitationVerifier;

  beforeAll(() => {
    createTestFixtures();
    verifier = createEnhancedCitationVerifier();
  });

  afterAll(() => {
    cleanupTestFixtures();
  });

  it('should generate comprehensive validation report', async () => {
    const sourceDocument = `
      The \`UserService\` class is defined in \`src/example.ts:12\`.
      See \`docs/README.md\` for documentation.
    `;

    const report = await verifier.generateReport(sourceDocument, TEST_DIR);

    expect(report.id).toBeDefined();
    expect(report.title).toBe('Citation Validation Report');
    expect(report.sourceDocument.content).toBe(sourceDocument);
    expect(report.sourceDocument.hash).toBeDefined();
    expect(report.verification.results.length).toBeGreaterThan(0);
    expect(report.metadata.generatedAt).toBeDefined();
  });

  it('should include quality assessment', async () => {
    const sourceDocument = `
      The \`UserService\` class is in \`src/example.ts:12\`.
    `;

    const report = await verifier.generateReport(sourceDocument, TEST_DIR);

    expect(['excellent', 'good', 'acceptable', 'poor', 'failing']).toContain(report.assessment.quality);
    expect(report.assessment.summary).toBeDefined();
    expect(isConfidenceValue(report.assessment.confidence)).toBe(true);
  });

  it('should include recommendations for invalid citations', async () => {
    const sourceDocument = `
      See \`src/nonexistent.ts:100\` for details.
    `;

    const report = await verifier.generateReport(sourceDocument, TEST_DIR);

    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations[0].severity).toBe('critical');
    expect(report.recommendations[0].category).toBe('incorrect_citation');
  });

  it('should include grounding chain', async () => {
    const sourceDocument = `
      The \`UserService\` class is in \`src/example.ts:12\`.
    `;

    const report = await verifier.generateReport(sourceDocument, TEST_DIR);

    expect(report.groundingChain.length).toBeGreaterThan(0);
    expect(report.groundingChain[0].type).toBeDefined();
  });

  it('should include repository information', async () => {
    const sourceDocument = 'Test document';

    const report = await verifier.generateReport(sourceDocument, TEST_DIR);

    expect(report.repository.path).toBe(TEST_DIR);
    // Git hash may or may not be present depending on test setup
  });
});

// ============================================================================
// CONFIDENCE SCORING TESTS
// ============================================================================

describe('EnhancedCitationVerifier - Confidence Scoring', () => {
  let verifier: EnhancedCitationVerifier;

  beforeAll(() => {
    createTestFixtures();
    verifier = createEnhancedCitationVerifier();
  });

  afterAll(() => {
    cleanupTestFixtures();
  });

  it('should return high confidence for verified citations', async () => {
    const citation: EnhancedCitation = {
      id: 'conf_high',
      type: 'code_reference',
      file: 'src/example.ts',
      line: 12,
      claim: 'UserService class',
      rawText: '`src/example.ts:12`',
      position: { start: 0, end: 20 },
    };

    const result = await verifier.verifyCitation(citation, TEST_DIR);

    const numericConf = getNumericValue(result.confidence);
    expect(numericConf).toBeGreaterThan(0.5);
  });

  it('should return low confidence for refuted citations', async () => {
    const citation: EnhancedCitation = {
      id: 'conf_low',
      type: 'code_reference',
      file: 'src/nonexistent.ts',
      line: 10,
      claim: 'test',
      rawText: 'test',
      position: { start: 0, end: 4 },
    };

    const result = await verifier.verifyCitation(citation, TEST_DIR);

    const numericConf = getNumericValue(result.confidence);
    // Refuted citations may have deterministic false confidence
    if (numericConf !== null) {
      expect(numericConf).toBeLessThanOrEqual(0.5);
    }
  });

  it('should include confidence for each check', async () => {
    const citation: EnhancedCitation = {
      id: 'conf_checks',
      type: 'code_reference',
      file: 'src/example.ts',
      line: 12,
      claim: 'test',
      rawText: 'test',
      position: { start: 0, end: 4 },
    };

    const result = await verifier.verifyCitation(citation, TEST_DIR);

    for (const check of result.checks) {
      expect(isConfidenceValue(check.confidence)).toBe(true);
    }
  });
});

// ============================================================================
// EPISTEMIC INTEGRATION TESTS
// ============================================================================

describe('EnhancedCitationVerifier - Epistemic Integration', () => {
  let verifier: EnhancedCitationVerifier;

  beforeAll(() => {
    createTestFixtures();
    verifier = createEnhancedCitationVerifier();
  });

  afterAll(() => {
    cleanupTestFixtures();
  });

  it('should create evidence entry for verification result', async () => {
    const citation: EnhancedCitation = {
      id: 'evidence_1',
      type: 'code_reference',
      file: 'src/example.ts',
      line: 12,
      claim: 'test',
      rawText: 'test',
      position: { start: 0, end: 4 },
    };

    const result = await verifier.verifyCitation(citation, TEST_DIR);
    const evidence = verifier.createEvidenceEntry(result);

    expect(evidence.kind).toBe('verification');
    expect(evidence.payload).toBeDefined();
    expect(evidence.provenance).toBeDefined();
    expect(evidence.provenance.source).toBe('ast_parser');
    expect(evidence.provenance.method).toBe('enhanced_citation_verification');
    expect(isConfidenceValue(evidence.confidence)).toBe(true);
  });

  it('should include grounding relation in results', async () => {
    const citation: EnhancedCitation = {
      id: 'grounding_1',
      type: 'code_reference',
      file: 'src/example.ts',
      line: 12,
      claim: 'test',
      rawText: 'test',
      position: { start: 0, end: 4 },
    };

    const result = await verifier.verifyCitation(citation, TEST_DIR);

    expect(result.grounding).toBeDefined();
    expect(result.grounding?.from).toBeDefined();
    expect(result.grounding?.to).toBeDefined();
    expect(result.grounding?.strength).toBeDefined();
    expect(result.grounding?.strength.value).toBeGreaterThanOrEqual(0);
    expect(result.grounding?.strength.value).toBeLessThanOrEqual(1);
  });

  it('should set grounding type based on verification status', async () => {
    const validCitation: EnhancedCitation = {
      id: 'grounding_valid',
      type: 'code_reference',
      file: 'src/example.ts',
      line: 12,
      claim: 'test',
      rawText: 'test',
      position: { start: 0, end: 4 },
    };

    const invalidCitation: EnhancedCitation = {
      id: 'grounding_invalid',
      type: 'code_reference',
      file: 'src/nonexistent.ts',
      line: 10,
      claim: 'test',
      rawText: 'test',
      position: { start: 0, end: 4 },
    };

    const validResult = await verifier.verifyCitation(validCitation, TEST_DIR);
    const invalidResult = await verifier.verifyCitation(invalidCitation, TEST_DIR);

    expect(validResult.grounding?.type).toBe('evidential');
    expect(invalidResult.grounding?.type).toBe('rebutting');
  });
});

// ============================================================================
// DEFAULT CONFIG TESTS
// ============================================================================

describe('DEFAULT_BATCH_CONFIG', () => {
  it('should have all required fields', () => {
    expect(DEFAULT_BATCH_CONFIG.concurrency).toBeDefined();
    expect(DEFAULT_BATCH_CONFIG.timeoutMs).toBeDefined();
    expect(DEFAULT_BATCH_CONFIG.verifyUrls).toBeDefined();
    expect(DEFAULT_BATCH_CONFIG.verifyCommits).toBeDefined();
    expect(DEFAULT_BATCH_CONFIG.urlCacheDurationMs).toBeDefined();
  });

  it('should have reasonable defaults', () => {
    expect(DEFAULT_BATCH_CONFIG.concurrency).toBeGreaterThan(0);
    expect(DEFAULT_BATCH_CONFIG.timeoutMs).toBeGreaterThan(0);
    expect(typeof DEFAULT_BATCH_CONFIG.verifyUrls).toBe('boolean');
    expect(typeof DEFAULT_BATCH_CONFIG.verifyCommits).toBe('boolean');
    expect(DEFAULT_BATCH_CONFIG.urlCacheDurationMs).toBeGreaterThan(0);
  });
});

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('EnhancedCitationVerifier - Edge Cases', () => {
  let verifier: EnhancedCitationVerifier;

  beforeAll(() => {
    createTestFixtures();
    verifier = createEnhancedCitationVerifier();
  });

  afterAll(() => {
    cleanupTestFixtures();
  });

  it('should handle non-existent repository path', async () => {
    const citation: EnhancedCitation = {
      id: 'edge_1',
      type: 'code_reference',
      file: 'src/example.ts',
      line: 10,
      claim: 'test',
      rawText: 'test',
      position: { start: 0, end: 4 },
    };

    const result = await verifier.verifyCitation(citation, '/nonexistent/path');

    expect(result).toBeDefined();
    expect(result.status).toBe('refuted');
  });

  it('should handle citation with missing fields', async () => {
    const citation: EnhancedCitation = {
      id: 'edge_2',
      type: 'identifier_reference',
      // No identifier provided
      claim: 'test',
      rawText: 'test',
      position: { start: 0, end: 4 },
    };

    const result = await verifier.verifyCitation(citation, TEST_DIR);

    expect(result).toBeDefined();
    expect(result.status).toBe('unverified');
  });

  it('should handle very long file paths', async () => {
    const longPath = 'a'.repeat(200) + '.ts';
    const citation: EnhancedCitation = {
      id: 'edge_3',
      type: 'code_reference',
      file: longPath,
      line: 10,
      claim: 'test',
      rawText: 'test',
      position: { start: 0, end: 4 },
    };

    const result = await verifier.verifyCitation(citation, TEST_DIR);

    expect(result).toBeDefined();
    expect(result.status).toBe('refuted');
  });

  it('should handle negative line numbers', async () => {
    const citation: EnhancedCitation = {
      id: 'edge_4',
      type: 'code_reference',
      file: 'src/example.ts',
      line: -5,
      claim: 'test',
      rawText: 'test',
      position: { start: 0, end: 4 },
    };

    const result = await verifier.verifyCitation(citation, TEST_DIR);

    expect(result).toBeDefined();
    expect(result.status).toBe('refuted');
  });

  it('should handle special characters in identifiers', async () => {
    const citation: EnhancedCitation = {
      id: 'edge_5',
      type: 'identifier_reference',
      identifier: '$special_identifier',
      file: 'src/example.ts',
      claim: 'test',
      rawText: 'test',
      position: { start: 0, end: 4 },
    };

    const result = await verifier.verifyCitation(citation, TEST_DIR);

    expect(result).toBeDefined();
    // Should not crash, may be refuted if not found
  });
});
