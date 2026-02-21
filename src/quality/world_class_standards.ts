/**
 * @fileoverview World-Class Software Development Standards
 *
 * Quality measures for best-in-world software development.
 * These go beyond basic code smells to measure engineering excellence.
 *
 * Inspired by:
 * - Google's software engineering practices
 * - NASA's software safety standards
 * - Microsoft's Security Development Lifecycle
 * - Netflix's chaos engineering principles
 * - Stripe's API design guidelines
 */

import type { DetectedIssue } from './issue_detector.js';
import type { IssueCategory, IssueSeverity } from './issue_registry.js';
import type { LiBrainianStorage } from '../storage/types.js';

// ============================================================================
// WORLD-CLASS QUALITY DIMENSIONS
// ============================================================================

/**
 * The 12 dimensions of world-class software quality.
 * Each dimension has specific, measurable criteria.
 */
export interface WorldClassDimensions {
  // Core Engineering
  correctness: DimensionScore;      // Does it do what it's supposed to?
  reliability: DimensionScore;      // Does it work consistently?
  security: DimensionScore;         // Is it protected from threats?
  performance: DimensionScore;      // Is it fast enough?

  // Maintainability
  readability: DimensionScore;      // Can developers understand it?
  testability: DimensionScore;      // Can we verify it works?
  modularity: DimensionScore;       // Is it well-organized?
  extensibility: DimensionScore;    // Can it be easily extended?

  // Operational Excellence
  observability: DimensionScore;    // Can we see what it's doing?
  resilience: DimensionScore;       // Does it handle failures gracefully?
  deployability: DimensionScore;    // Can we ship it safely?
  documentation: DimensionScore;    // Is it well-documented?
}

export interface DimensionScore {
  score: number;           // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  issues: string[];        // Specific issues found
  improvements: string[];  // Suggested improvements
}

// ============================================================================
// DETECTION RULES
// ============================================================================

export interface WorldClassRule {
  id: string;
  dimension: keyof WorldClassDimensions;
  name: string;
  description: string;
  severity: IssueSeverity;
  check: (ctx: RuleContext) => Promise<RuleViolation[]>;
}

export interface RuleContext {
  storage: LiBrainianStorage;
  workspace: string;
  functions: any[];
  files: any[];
  edges: any[];
}

export interface RuleViolation {
  ruleId: string;
  filePath: string;
  entityId?: string;
  entityName?: string;
  startLine?: number;
  message: string;
  evidence: string[];
  suggestedFix: string;
}

// ============================================================================
// WORLD-CLASS RULES
// ============================================================================

export const WORLD_CLASS_RULES: WorldClassRule[] = [
  // =========================================================================
  // CORRECTNESS
  // =========================================================================
  {
    id: 'WC-001',
    dimension: 'correctness',
    name: 'Error handling completeness',
    description: 'All async operations must have error handling',
    severity: 'major',
    check: async (ctx) => {
      const violations: RuleViolation[] = [];
      for (const fn of ctx.functions) {
        const content = fn.content || '';
        // Has await but no try/catch or .catch()
        if (content.includes('await ') && !content.includes('catch') && !content.includes('.catch(')) {
          violations.push({
            ruleId: 'WC-001',
            filePath: fn.filePath,
            entityId: fn.id,
            entityName: fn.name,
            startLine: fn.startLine,
            message: `Async function "${fn.name}" has unhandled promise rejections`,
            evidence: ['Contains await without try/catch or .catch()'],
            suggestedFix: 'Wrap async operations in try/catch or use .catch() for error handling',
          });
        }
      }
      return violations;
    },
  },

  {
    id: 'WC-002',
    dimension: 'correctness',
    name: 'Null safety',
    description: 'Potential null/undefined access without checks',
    severity: 'major',
    check: async (ctx) => {
      const violations: RuleViolation[] = [];
      for (const fn of ctx.functions) {
        const content = fn.content || '';
        // Access patterns that might be unsafe
        const unsafePatterns = [
          /\w+\.\w+\.\w+(?!\?)/g, // Deep access without optional chaining
        ];
        for (const pattern of unsafePatterns) {
          const matches = content.match(pattern);
          if (matches && matches.length > 3) { // Multiple deep accesses
            violations.push({
              ruleId: 'WC-002',
              filePath: fn.filePath,
              entityId: fn.id,
              entityName: fn.name,
              startLine: fn.startLine,
              message: `Function "${fn.name}" has multiple deep property accesses without null checks`,
              evidence: [`Found ${matches.length} deep property access patterns`],
              suggestedFix: 'Use optional chaining (?.) or explicit null checks',
            });
            break;
          }
        }
      }
      return violations;
    },
  },

  // =========================================================================
  // RELIABILITY
  // =========================================================================
  {
    id: 'WC-010',
    dimension: 'reliability',
    name: 'Retry logic for external calls',
    description: 'External API calls should have retry logic',
    severity: 'minor',
    check: async (ctx) => {
      const violations: RuleViolation[] = [];
      for (const fn of ctx.functions) {
        const content = fn.content || '';
        // Has fetch/axios/http calls but no retry patterns
        if ((content.includes('fetch(') || content.includes('axios.') || content.includes('http.')) &&
            !content.includes('retry') && !content.includes('Retry') && !content.includes('attempt')) {
          violations.push({
            ruleId: 'WC-010',
            filePath: fn.filePath,
            entityId: fn.id,
            entityName: fn.name,
            startLine: fn.startLine,
            message: `External API call in "${fn.name}" lacks retry logic`,
            evidence: ['Contains HTTP call without visible retry mechanism'],
            suggestedFix: 'Add retry logic with exponential backoff for transient failures',
          });
        }
      }
      return violations;
    },
  },

  {
    id: 'WC-011',
    dimension: 'reliability',
    name: 'Timeout handling',
    description: 'Long-running operations should have timeouts',
    severity: 'minor',
    check: async (ctx) => {
      const violations: RuleViolation[] = [];
      for (const fn of ctx.functions) {
        const content = fn.content || '';
        // Has await or Promise but no timeout
        if (content.includes('await ') && !content.includes('timeout') && !content.includes('Timeout') &&
            !content.includes('AbortController') && !content.includes('Promise.race')) {
          // Only flag if it looks like an external call
          if (content.includes('fetch') || content.includes('http') || content.includes('database') ||
              content.includes('query') || content.includes('execute')) {
            violations.push({
              ruleId: 'WC-011',
              filePath: fn.filePath,
              entityId: fn.id,
              entityName: fn.name,
              startLine: fn.startLine,
              message: `Long-running operation in "${fn.name}" may lack timeout`,
              evidence: ['Contains async operation without visible timeout mechanism'],
              suggestedFix: 'Add timeout using AbortController or Promise.race',
            });
          }
        }
      }
      return violations;
    },
  },

  // =========================================================================
  // SECURITY
  // =========================================================================
  {
    id: 'WC-020',
    dimension: 'security',
    name: 'Hardcoded secrets',
    description: 'No hardcoded API keys, passwords, or tokens',
    severity: 'critical',
    check: async (ctx) => {
      const violations: RuleViolation[] = [];
      const secretPatterns = [
        /api[_-]?key\s*[:=]\s*['"][^'"]{20,}['"]/gi,
        /password\s*[:=]\s*['"][^'"]+['"]/gi,
        /secret\s*[:=]\s*['"][^'"]{10,}['"]/gi,
        /token\s*[:=]\s*['"][^'"]{20,}['"]/gi,
        /bearer\s+[a-zA-Z0-9\-_.]{20,}/gi,
      ];

      for (const fn of ctx.functions) {
        const content = fn.content || '';
        for (const pattern of secretPatterns) {
          if (pattern.test(content)) {
            violations.push({
              ruleId: 'WC-020',
              filePath: fn.filePath,
              entityId: fn.id,
              entityName: fn.name,
              startLine: fn.startLine,
              message: `Potential hardcoded secret in "${fn.name}"`,
              evidence: ['Detected pattern matching API key, password, or token'],
              suggestedFix: 'Move secrets to environment variables or a secrets manager',
            });
            break; // One violation per function
          }
        }
      }
      return violations;
    },
  },

  {
    id: 'WC-021',
    dimension: 'security',
    name: 'Input validation at boundaries',
    description: 'External input must be validated before use',
    severity: 'major',
    check: async (ctx) => {
      const violations: RuleViolation[] = [];
      for (const fn of ctx.functions) {
        // Check if function handles external input
        const isHandler = fn.name.includes('handler') || fn.name.includes('Handler') ||
                          fn.name.startsWith('on') || fn.name.includes('endpoint') ||
                          fn.filePath.includes('/api/') || fn.filePath.includes('/routes/');

        if (isHandler) {
          const content = fn.content || '';
          // Has request/params/body access but no validation
          if ((content.includes('req.') || content.includes('request.') || content.includes('params.') ||
               content.includes('body.') || content.includes('query.')) &&
              !content.includes('validate') && !content.includes('schema') && !content.includes('Zod') &&
              !content.includes('Joi') && !content.includes('yup') && !content.includes('assert')) {
            violations.push({
              ruleId: 'WC-021',
              filePath: fn.filePath,
              entityId: fn.id,
              entityName: fn.name,
              startLine: fn.startLine,
              message: `Handler "${fn.name}" may lack input validation`,
              evidence: ['Accesses request data without visible validation'],
              suggestedFix: 'Add input validation using Zod, Joi, or custom validators',
            });
          }
        }
      }
      return violations;
    },
  },

  // =========================================================================
  // TESTABILITY
  // =========================================================================
  {
    id: 'WC-040',
    dimension: 'testability',
    name: 'Test coverage for public API',
    description: 'Exported functions should have corresponding tests',
    severity: 'major',
    check: async (ctx) => {
      const violations: RuleViolation[] = [];
      const exportedFunctions = ctx.functions.filter(fn => fn.exported);
      const testFiles = ctx.files.filter(f => f.path.includes('.test.') || f.path.includes('.spec.'));
      const testedNames = new Set<string>();

      // Extract test descriptions/names from test files
      for (const testFile of testFiles) {
        const content = testFile.content || '';
        const matches = content.match(/(?:it|test|describe)\s*\(\s*['"]([^'"]+)['"]/g) || [];
        for (const match of matches) {
          const name = match.replace(/(?:it|test|describe)\s*\(\s*['"]/, '').replace(/['"]$/, '');
          testedNames.add(name.toLowerCase());
        }
      }

      for (const fn of exportedFunctions) {
        const fnName = fn.name.toLowerCase();
        const hasTest = Array.from(testedNames).some(
          testName => testName.includes(fnName) || fnName.includes(testName)
        );

        if (!hasTest) {
          violations.push({
            ruleId: 'WC-040',
            filePath: fn.filePath,
            entityId: fn.id,
            entityName: fn.name,
            startLine: fn.startLine,
            message: `Exported function "${fn.name}" may lack test coverage`,
            evidence: ['No test file mentions this function name'],
            suggestedFix: `Create test file: ${fn.filePath.replace('.ts', '.test.ts')}`,
          });
        }
      }
      return violations;
    },
  },

  {
    id: 'WC-041',
    dimension: 'testability',
    name: 'Dependency injection',
    description: 'Functions with external dependencies should accept them as parameters',
    severity: 'minor',
    check: async (ctx) => {
      const violations: RuleViolation[] = [];
      for (const fn of ctx.functions) {
        const content = fn.content || '';
        const signature = fn.signature || '';

        // Has global/singleton access but no injected dependency
        const hasGlobalAccess = content.includes('process.env') || content.includes('globalThis') ||
                                content.includes('getInstance()') || content.includes('Singleton');
        const hasDI = signature.includes('options') || signature.includes('config') ||
                      signature.includes('deps') || signature.includes('context');

        if (hasGlobalAccess && !hasDI && fn.exported) {
          violations.push({
            ruleId: 'WC-041',
            filePath: fn.filePath,
            entityId: fn.id,
            entityName: fn.name,
            startLine: fn.startLine,
            message: `Function "${fn.name}" accesses globals without dependency injection`,
            evidence: ['Uses process.env or singletons directly'],
            suggestedFix: 'Accept dependencies as parameters for easier testing',
          });
        }
      }
      return violations;
    },
  },

  // =========================================================================
  // OBSERVABILITY
  // =========================================================================
  {
    id: 'WC-050',
    dimension: 'observability',
    name: 'Logging for critical paths',
    description: 'Critical operations should have logging',
    severity: 'minor',
    check: async (ctx) => {
      const violations: RuleViolation[] = [];
      for (const fn of ctx.functions) {
        // Is this a critical path?
        const isCritical = fn.name.includes('payment') || fn.name.includes('auth') ||
                          fn.name.includes('order') || fn.name.includes('user') ||
                          fn.name.includes('delete') || fn.name.includes('create') ||
                          fn.filePath.includes('/api/') || fn.filePath.includes('/handlers/');

        if (isCritical) {
          const content = fn.content || '';
          const hasLogging = content.includes('log.') || content.includes('logger.') ||
                            content.includes('console.') || content.includes('telemetry') ||
                            content.includes('span') || content.includes('trace');

          if (!hasLogging) {
            violations.push({
              ruleId: 'WC-050',
              filePath: fn.filePath,
              entityId: fn.id,
              entityName: fn.name,
              startLine: fn.startLine,
              message: `Critical function "${fn.name}" lacks logging`,
              evidence: ['Appears to be a critical path without observability'],
              suggestedFix: 'Add structured logging for debugging and monitoring',
            });
          }
        }
      }
      return violations;
    },
  },

  {
    id: 'WC-051',
    dimension: 'observability',
    name: 'Error context',
    description: 'Caught errors should include context when re-thrown',
    severity: 'minor',
    check: async (ctx) => {
      const violations: RuleViolation[] = [];
      for (const fn of ctx.functions) {
        const content = fn.content || '';
        // Has catch block that re-throws without context
        if (content.includes('catch') && content.match(/throw\s+(?:e|err|error)\s*;/)) {
          violations.push({
            ruleId: 'WC-051',
            filePath: fn.filePath,
            entityId: fn.id,
            entityName: fn.name,
            startLine: fn.startLine,
            message: `Error re-thrown without context in "${fn.name}"`,
            evidence: ['catch block re-throws original error without additional context'],
            suggestedFix: 'Wrap error with additional context: throw new Error(`Context: ${e.message}`, { cause: e })',
          });
        }
      }
      return violations;
    },
  },

  // =========================================================================
  // MODULARITY
  // =========================================================================
  {
    id: 'WC-060',
    dimension: 'modularity',
    name: 'Single responsibility',
    description: 'Functions should have a single, clear responsibility',
    severity: 'minor',
    check: async (ctx) => {
      const violations: RuleViolation[] = [];
      for (const fn of ctx.functions) {
        const content = fn.content || '';
        const lines = fn.endLine - fn.startLine;

        // Multiple distinct operations (heuristic: many different verbs)
        const verbs = ['create', 'update', 'delete', 'fetch', 'parse', 'validate', 'format',
                       'save', 'load', 'send', 'receive', 'transform', 'compute', 'calculate'];
        const foundVerbs = verbs.filter(v => content.toLowerCase().includes(v));

        if (foundVerbs.length >= 4 && lines > 50) {
          violations.push({
            ruleId: 'WC-060',
            filePath: fn.filePath,
            entityId: fn.id,
            entityName: fn.name,
            startLine: fn.startLine,
            message: `Function "${fn.name}" may have multiple responsibilities`,
            evidence: [`Contains operations: ${foundVerbs.join(', ')}`, `${lines} lines`],
            suggestedFix: 'Split into focused functions with single responsibilities',
          });
        }
      }
      return violations;
    },
  },

  // =========================================================================
  // DOCUMENTATION
  // =========================================================================
  {
    id: 'WC-070',
    dimension: 'documentation',
    name: 'API documentation',
    description: 'Public APIs must have comprehensive documentation',
    severity: 'major',
    check: async (ctx) => {
      const violations: RuleViolation[] = [];
      for (const fn of ctx.functions) {
        if (!fn.exported) continue;

        const hasGoodDocs = fn.docstring && fn.docstring.length > 50 &&
                           (fn.docstring.includes('@param') || fn.docstring.includes('@returns') ||
                            fn.docstring.includes('Parameters') || fn.docstring.includes('Returns'));

        if (!hasGoodDocs) {
          violations.push({
            ruleId: 'WC-070',
            filePath: fn.filePath,
            entityId: fn.id,
            entityName: fn.name,
            startLine: fn.startLine,
            message: `Public API "${fn.name}" lacks comprehensive documentation`,
            evidence: [
              fn.docstring ? `Current docs: ${fn.docstring.length} chars` : 'No documentation',
              'Missing @param or @returns tags',
            ],
            suggestedFix: 'Add JSDoc with @param and @returns, including examples',
          });
        }
      }
      return violations;
    },
  },

  {
    id: 'WC-071',
    dimension: 'documentation',
    name: 'Complex logic explanation',
    description: 'Complex code blocks should have explanatory comments',
    severity: 'info',
    check: async (ctx) => {
      const violations: RuleViolation[] = [];
      for (const fn of ctx.functions) {
        const content = fn.content || '';
        const complexity = (content.match(/if|for|while|switch|&&|\|\||\?/g) || []).length;

        if (complexity > 10) {
          const commentLines = (content.match(/\/\/|\/\*|\*\//g) || []).length;
          const ratio = commentLines / complexity;

          if (ratio < 0.2) { // Less than 1 comment per 5 decision points
            violations.push({
              ruleId: 'WC-071',
              filePath: fn.filePath,
              entityId: fn.id,
              entityName: fn.name,
              startLine: fn.startLine,
              message: `Complex function "${fn.name}" lacks explanatory comments`,
              evidence: [`Complexity: ${complexity} decision points`, `Comment ratio: ${(ratio * 100).toFixed(0)}%`],
              suggestedFix: 'Add comments explaining the "why" for complex logic blocks',
            });
          }
        }
      }
      return violations;
    },
  },
];

// ============================================================================
// RUNNER
// ============================================================================

/**
 * Run all world-class rules and return violations as issues
 */
export async function detectWorldClassIssues(ctx: RuleContext): Promise<DetectedIssue[]> {
  const issues: DetectedIssue[] = [];

  for (const rule of WORLD_CLASS_RULES) {
    try {
      const violations = await rule.check(ctx);

      for (const v of violations) {
        issues.push({
          category: dimensionToCategory(rule.dimension),
          severity: rule.severity,
          filePath: v.filePath,
          entityId: v.entityId,
          entityName: v.entityName,
          startLine: v.startLine,
          title: `[${rule.id}] ${v.message}`,
          description: rule.description,
          evidence: v.evidence,
          impactScore: severityToImpact(rule.severity),
          effortMinutes: estimateEffort(rule.dimension),
          suggestedFix: v.suggestedFix,
          automatable: false,
          blockedBy: [],
          blocks: [],
        });
      }
    } catch (error) {
      // Rule failed, skip
    }
  }

  return issues;
}

// ============================================================================
// HELPERS
// ============================================================================

function dimensionToCategory(dim: keyof WorldClassDimensions): IssueCategory {
  const map: Record<keyof WorldClassDimensions, IssueCategory> = {
    correctness: 'complexity',
    reliability: 'architecture',
    security: 'security',
    performance: 'complexity',
    readability: 'complexity',
    testability: 'test_coverage',
    modularity: 'coupling',
    extensibility: 'architecture',
    observability: 'documentation',
    resilience: 'architecture',
    deployability: 'architecture',
    documentation: 'documentation',
  };
  return map[dim];
}

function severityToImpact(sev: IssueSeverity): number {
  const map: Record<IssueSeverity, number> = {
    critical: 1.0,
    major: 0.7,
    minor: 0.4,
    info: 0.2,
  };
  return map[sev];
}

function estimateEffort(dim: keyof WorldClassDimensions): number {
  const map: Record<keyof WorldClassDimensions, number> = {
    correctness: 30,
    reliability: 45,
    security: 60,
    performance: 60,
    readability: 20,
    testability: 45,
    modularity: 30,
    extensibility: 45,
    observability: 20,
    resilience: 60,
    deployability: 45,
    documentation: 15,
  };
  return map[dim];
}
