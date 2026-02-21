/**
 * @fileoverview Technical Decision Support System for Agents
 *
 * Provides context-aware decision support to help agents make better
 * technical choices by:
 * - Analyzing the question to categorize the decision type
 * - Generating relevant options based on the category
 * - Finding precedents in the codebase
 * - Identifying constraints from project configuration
 * - Scoring options for compatibility
 * - Recommending the best approach with rationale
 *
 * Supports queries like:
 * - "Should I use X or Y?"
 * - "Best approach for error handling here?"
 * - "Which pattern should I follow?"
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { LiBrainianStorage } from '../storage/types.js';
import type { ContextPack, LiBrainianVersion, FunctionKnowledge, ModuleKnowledge } from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Category of technical decision being made.
 */
export type DecisionCategory =
  | 'architecture'
  | 'library_choice'
  | 'pattern'
  | 'testing'
  | 'error_handling'
  | 'data_structure'
  | 'performance'
  | 'security';

/**
 * A single decision option with pros/cons analysis.
 */
export interface DecisionOption {
  /** Short name for the option */
  name: string;
  /** Description of what this option entails */
  description: string;
  /** Advantages of this approach */
  pros: string[];
  /** Disadvantages of this approach */
  cons: string[];
  /** Estimated effort to implement */
  effort: 'low' | 'medium' | 'high';
  /** Risk level of this approach */
  risk: 'low' | 'medium' | 'high';
  /** How well this fits the current codebase (0-1) */
  compatibility: number;
  /** Examples of this pattern in the codebase */
  examples?: string[];
}

/**
 * A relevant precedent found in the codebase.
 */
export interface Precedent {
  /** What decision was made */
  decision: string;
  /** Context where it was found */
  context: string;
  /** File where it exists */
  file?: string;
  /** Known outcome if available */
  outcome?: string;
}

/**
 * Full decision context with options, constraints, and recommendation.
 */
export interface DecisionContext {
  /** The original question */
  question: string;
  /** Detected category of decision */
  category: DecisionCategory;
  /** Available options with analysis */
  options: DecisionOption[];
  /** Constraints identified from the codebase */
  constraints: string[];
  /** Recommended option (if confidence is high enough) */
  recommendation?: DecisionOption;
  /** Confidence in the recommendation (0-1) */
  confidence: number;
  /** Explanation of the recommendation */
  rationale: string;
  /** Similar decisions found in codebase */
  precedents: Precedent[];
}

// ============================================================================
// DECISION QUERY DETECTION
// ============================================================================

/**
 * Patterns that indicate a decision-making query.
 */
export const DECISION_SUPPORT_PATTERNS = [
  // "Should I use X or Y"
  /\bshould\s+i\s+(use|choose|pick|go\s+with|prefer)\b/i,
  // "X or Y" comparisons
  /\b(\w+)\s+or\s+(\w+)\s*(for|when|to)\b/i,
  // "Best approach/way/method for"
  /\bbest\s+(approach|way|method|pattern|practice|option)\s+(for|to)\b/i,
  // "Which X should I use"
  /\bwhich\s+(\w+)\s+should\s+i\s+(use|choose|prefer)\b/i,
  // "How should I handle"
  /\bhow\s+should\s+i\s+(handle|implement|approach|deal\s+with)\b/i,
  // "What's the recommended"
  /\bwhat('s|s|\s+is)\s+(the\s+)?(recommended|best|preferred)\b/i,
  // "Trade-offs between"
  /\btrade-?offs?\s+(between|of)\b/i,
  // "Pros and cons"
  /\bpros\s+(and|&)\s+cons\b/i,
  // "Compare X and Y"
  /\bcompare\s+\w+\s+(and|vs\.?|versus|with)\s+\w+\b/i,
];

/**
 * Detects if a query is asking for decision support.
 */
export function isDecisionSupportQuery(intent: string): boolean {
  return DECISION_SUPPORT_PATTERNS.some(pattern => pattern.test(intent));
}

// ============================================================================
// DECISION CLASSIFICATION
// ============================================================================

/**
 * Classifies the type of decision being asked about.
 * Order matters - more specific patterns should be checked before generic ones.
 */
export function classifyDecision(question: string): DecisionCategory {
  const lower = question.toLowerCase();

  // Check specific technical terms first (before generic patterns like "use X or Y")
  // Note: Using word boundary at start (\b) but allowing suffixes (no \b at end) for plurals

  // Data structure - check for specific types like Map, Set, Array, Object
  if (/\b(array|map|set|hash|list|collection)/i.test(lower) ||
      /\bdata\s*(structure|type)/i.test(lower) ||
      /\b(map|set|array)\s+(vs|or|versus)/i.test(lower)) {
    return 'data_structure';
  }

  // Error handling - check for error-related terms
  if (/\b(error|exception|fail|catch|throw|try-catch|result\s*type)/i.test(lower)) {
    return 'error_handling';
  }

  // Testing - check for test-related terms
  if (/\b(test|coverage|mock|assert|spec|jest|vitest)/i.test(lower)) {
    return 'testing';
  }

  // Performance - check for performance-related terms
  if (/\b(performance|optimi|cache|caching|speed|fast|slow|efficient|bottleneck)/i.test(lower)) {
    return 'performance';
  }

  // Security - check for security-related terms
  if (/\b(security|auth|permission|secret|encrypt|token|credential|vulnerab)/i.test(lower)) {
    return 'security';
  }

  // Architecture - check for structure-related terms (but not "data structure")
  if (/\b(architect|layer|module|organiz|folder|directory)/i.test(lower) ||
      (/\bstructure/i.test(lower) && !/\bdata\s*structure/i.test(lower))) {
    return 'architecture';
  }

  // Library choice - generic "use X or Y" for packages/libraries
  if (/\b(library|package|dependency|framework|npm|import)/i.test(lower)) {
    return 'library_choice';
  }

  // Pattern - general design/implementation questions
  if (/\b(pattern|approach|design|implement|style|convention)/i.test(lower)) {
    return 'pattern';
  }

  return 'pattern';
}

// ============================================================================
// OPTION GENERATION
// ============================================================================

/**
 * Generates relevant options based on decision category.
 */
export async function generateOptions(
  storage: LiBrainianStorage,
  question: string,
  category: DecisionCategory,
  workspace: string
): Promise<DecisionOption[]> {
  const options: DecisionOption[] = [];

  switch (category) {
    case 'error_handling':
      options.push(
        {
          name: 'Try-Catch with Custom Errors',
          description: 'Use try-catch blocks with custom error classes',
          pros: ['Clear error types', 'Stack traces preserved', 'TypeScript friendly'],
          cons: ['Verbose', 'Can obscure control flow'],
          effort: 'low',
          risk: 'low',
          compatibility: 0.8,
        },
        {
          name: 'Result Type Pattern',
          description: 'Return { success, data } or { error } objects',
          pros: ['Explicit error handling', 'No exceptions', 'Composable'],
          cons: ['Requires discipline', 'More boilerplate'],
          effort: 'medium',
          risk: 'low',
          compatibility: 0.6,
        },
        {
          name: 'Error-First Callbacks',
          description: 'Use Node.js style callback(err, result)',
          pros: ['Node.js convention', 'Simple'],
          cons: ['Callback hell', 'Not TypeScript friendly'],
          effort: 'low',
          risk: 'medium',
          compatibility: 0.3,
        }
      );
      break;

    case 'testing':
      options.push(
        {
          name: 'Unit Tests with Mocks',
          description: 'Test functions in isolation with mocked dependencies',
          pros: ['Fast', 'Isolated', 'Easy to debug'],
          cons: ['May miss integration issues', 'Mock maintenance'],
          effort: 'low',
          risk: 'low',
          compatibility: 0.9,
        },
        {
          name: 'Integration Tests',
          description: 'Test multiple components together',
          pros: ['Catches integration issues', 'More realistic'],
          cons: ['Slower', 'Harder to debug', 'Setup complexity'],
          effort: 'medium',
          risk: 'low',
          compatibility: 0.7,
        },
        {
          name: 'Property-Based Testing',
          description: 'Generate random inputs to find edge cases',
          pros: ['Finds edge cases', 'Thorough'],
          cons: ['Learning curve', 'Slower'],
          effort: 'high',
          risk: 'low',
          compatibility: 0.5,
        }
      );
      break;

    case 'data_structure':
      options.push(
        {
          name: 'Array',
          description: 'Use JavaScript array',
          pros: ['Simple', 'Built-in methods', 'Ordered'],
          cons: ['O(n) lookup', 'No key-based access'],
          effort: 'low',
          risk: 'low',
          compatibility: 0.9,
        },
        {
          name: 'Map',
          description: 'Use JavaScript Map',
          pros: ['O(1) lookup', 'Any key type', 'Insertion order'],
          cons: ['Slightly more complex', 'Serialization needs care'],
          effort: 'low',
          risk: 'low',
          compatibility: 0.8,
        },
        {
          name: 'Set',
          description: 'Use JavaScript Set',
          pros: ['O(1) has check', 'Unique values', 'Fast'],
          cons: ['No key-value', 'No index access'],
          effort: 'low',
          risk: 'low',
          compatibility: 0.7,
        }
      );
      break;

    case 'architecture':
      options.push(
        {
          name: 'Layered Architecture',
          description: 'Separate code into layers (presentation, business, data)',
          pros: ['Clear separation', 'Easy to understand', 'Testable'],
          cons: ['Can be rigid', 'May need refactoring'],
          effort: 'medium',
          risk: 'low',
          compatibility: 0.8,
        },
        {
          name: 'Feature-Based Modules',
          description: 'Organize by feature/domain rather than layer',
          pros: ['Cohesive features', 'Easier to scale', 'Parallel development'],
          cons: ['Cross-cutting concerns', 'Potential duplication'],
          effort: 'medium',
          risk: 'low',
          compatibility: 0.7,
        },
        {
          name: 'Hexagonal Architecture',
          description: 'Ports and adapters pattern for clean boundaries',
          pros: ['Highly testable', 'Framework agnostic', 'Clear contracts'],
          cons: ['More boilerplate', 'Learning curve'],
          effort: 'high',
          risk: 'low',
          compatibility: 0.5,
        }
      );
      break;

    case 'performance':
      options.push(
        {
          name: 'In-Memory Caching',
          description: 'Cache frequently accessed data in memory',
          pros: ['Very fast', 'Simple to implement'],
          cons: ['Memory pressure', 'Cache invalidation'],
          effort: 'low',
          risk: 'medium',
          compatibility: 0.8,
        },
        {
          name: 'Lazy Loading',
          description: 'Load data only when needed',
          pros: ['Reduced initial load', 'Memory efficient'],
          cons: ['Latency on first access', 'Complexity'],
          effort: 'low',
          risk: 'low',
          compatibility: 0.85,
        },
        {
          name: 'Batch Processing',
          description: 'Process items in batches to reduce overhead',
          pros: ['Reduced overhead', 'Better throughput'],
          cons: ['Latency for individual items', 'Complexity'],
          effort: 'medium',
          risk: 'low',
          compatibility: 0.75,
        }
      );
      break;

    case 'security':
      options.push(
        {
          name: 'Input Validation',
          description: 'Validate all inputs at boundaries',
          pros: ['Prevents injection', 'Clear contracts', 'Early failure'],
          cons: ['Boilerplate', 'Performance overhead'],
          effort: 'low',
          risk: 'low',
          compatibility: 0.95,
        },
        {
          name: 'Principle of Least Privilege',
          description: 'Grant minimum necessary permissions',
          pros: ['Limits blast radius', 'Defense in depth'],
          cons: ['More configuration', 'Can be complex'],
          effort: 'medium',
          risk: 'low',
          compatibility: 0.85,
        },
        {
          name: 'Defense in Depth',
          description: 'Multiple layers of security controls',
          pros: ['Comprehensive', 'Resilient'],
          cons: ['More complexity', 'Performance overhead'],
          effort: 'high',
          risk: 'low',
          compatibility: 0.7,
        }
      );
      break;

    case 'library_choice':
      // For library choice, we generate generic advice
      options.push(
        {
          name: 'Use Existing Dependency',
          description: 'Use a library already in the project',
          pros: ['No new dependencies', 'Familiar', 'Consistent'],
          cons: ['May not be optimal', 'May be outdated'],
          effort: 'low',
          risk: 'low',
          compatibility: 0.9,
        },
        {
          name: 'Add New Library',
          description: 'Add a new, specialized library',
          pros: ['Best for the job', 'Well-maintained'],
          cons: ['New dependency', 'Learning curve'],
          effort: 'medium',
          risk: 'medium',
          compatibility: 0.6,
        },
        {
          name: 'Build Custom Solution',
          description: 'Implement the functionality yourself',
          pros: ['Full control', 'No dependencies', 'Tailored'],
          cons: ['Development time', 'Maintenance burden'],
          effort: 'high',
          risk: 'medium',
          compatibility: 0.4,
        }
      );
      break;

    default:
      // Generic options for pattern decisions
      options.push({
        name: 'Follow Existing Pattern',
        description: 'Use the same approach as existing similar code',
        pros: ['Consistent', 'Familiar', 'Proven'],
        cons: ['May propagate issues', 'May not be optimal'],
        effort: 'low',
        risk: 'low',
        compatibility: 0.8,
      });
  }

  // Find existing examples for each option
  await enrichOptionsWithExamples(storage, options, category);

  return options;
}

/**
 * Enriches options with examples found in the codebase.
 */
async function enrichOptionsWithExamples(
  storage: LiBrainianStorage,
  options: DecisionOption[],
  category: DecisionCategory
): Promise<void> {
  try {
    const functions = await storage.getFunctions({ limit: 100 });

    for (const option of options) {
      const examples: string[] = [];

      // Search for examples based on option name patterns
      const searchTerms = getSearchTermsForOption(option.name, category);

      for (const func of functions) {
        const funcLower = (func.name + ' ' + (func.purpose ?? '')).toLowerCase();
        if (searchTerms.some(term => funcLower.includes(term))) {
          examples.push(func.filePath);
          if (examples.length >= 3) break;
        }
      }

      if (examples.length > 0) {
        option.examples = Array.from(new Set(examples));
        // Boost compatibility if we found examples
        option.compatibility = Math.min(1.0, option.compatibility + 0.1);
      }
    }
  } catch {
    // If we can't find examples, continue without them
  }
}

/**
 * Gets search terms for finding examples of an option.
 */
function getSearchTermsForOption(optionName: string, category: DecisionCategory): string[] {
  const lower = optionName.toLowerCase();

  if (category === 'error_handling') {
    if (lower.includes('try-catch')) return ['catch', 'throw', 'error'];
    if (lower.includes('result')) return ['result', 'success', 'failure'];
    if (lower.includes('callback')) return ['callback', 'err,'];
  }

  if (category === 'testing') {
    if (lower.includes('unit')) return ['mock', 'vi.fn', 'jest.fn'];
    if (lower.includes('integration')) return ['integration', 'e2e'];
    if (lower.includes('property')) return ['property', 'fc.', 'fast-check'];
  }

  if (category === 'data_structure') {
    if (lower.includes('array')) return ['array', '[]'];
    if (lower.includes('map')) return ['new map', 'map<'];
    if (lower.includes('set')) return ['new set', 'set<'];
  }

  return [lower];
}

// ============================================================================
// PRECEDENT FINDING
// ============================================================================

/**
 * Finds precedents for similar decisions in the codebase.
 */
export async function findPrecedents(
  storage: LiBrainianStorage,
  question: string,
  category: DecisionCategory
): Promise<Precedent[]> {
  const precedents: Precedent[] = [];

  // Patterns to search for based on category
  const patterns: Record<string, string[]> = {
    architecture: ['// Architecture', '// Design decision', '// ADR'],
    error_handling: ['// Error handling', 'catch (', 'throw new'],
    testing: ['describe(', 'it(', 'test('],
    pattern: ['// Pattern:', '// Using'],
    library_choice: ['// Using', 'import {'],
    data_structure: ['new Map', 'new Set', ': Map<', ': Set<'],
    performance: ['// Cache', '// Performance', '// Lazy'],
    security: ['// Security', '// Auth', 'validate'],
  };

  const searchTerms = patterns[category] || [];

  try {
    const functions = await storage.getFunctions({ limit: 200 });
    const modules = await storage.getModules({ limit: 50 });

    // Search functions for patterns
    for (const term of searchTerms.slice(0, 2)) {
      for (const func of functions) {
        const content = `${func.name} ${func.purpose ?? ''} ${func.filePath}`;
        if (content.toLowerCase().includes(term.toLowerCase().replace('//', '').trim())) {
          precedents.push({
            decision: `Uses ${term.replace('//', '').trim()}`,
            context: func.purpose?.slice(0, 100) ?? '',
            file: func.filePath,
          });
          if (precedents.length >= 5) break;
        }
      }
      if (precedents.length >= 5) break;
    }

    // Also check modules
    for (const mod of modules.slice(0, 10)) {
      if (mod.purpose && mod.purpose.length > 20) {
        precedents.push({
          decision: 'Module pattern',
          context: mod.purpose.slice(0, 100),
          file: mod.path,
        });
        if (precedents.length >= 5) break;
      }
    }
  } catch {
    // Continue without precedents if search fails
  }

  return precedents.slice(0, 5);
}

// ============================================================================
// CONSTRAINT IDENTIFICATION
// ============================================================================

/**
 * Identifies constraints from the codebase configuration.
 */
export async function identifyConstraints(
  storage: LiBrainianStorage,
  category: DecisionCategory,
  workspace: string
): Promise<string[]> {
  const constraints: string[] = [];

  // Check package.json for constraints
  try {
    const pkgPath = path.join(workspace, 'package.json');
    const pkgContent = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);

    // TypeScript constraint
    if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
      constraints.push('TypeScript: Solution must be type-safe');
    }

    // Testing framework
    if (pkg.devDependencies?.vitest) {
      constraints.push('Testing: Use vitest for tests');
    } else if (pkg.devDependencies?.jest) {
      constraints.push('Testing: Use jest for tests');
    }

    // Node version
    if (pkg.engines?.node) {
      constraints.push(`Node: Must support ${pkg.engines.node}`);
    }

    // ESM vs CJS
    if (pkg.type === 'module') {
      constraints.push('Module: ESM-only (no require())');
    }

    // Existing libraries that might influence decisions
    if (category === 'error_handling') {
      if (pkg.dependencies?.['neverthrow']) {
        constraints.push('Error handling: neverthrow library is available');
      }
    }

    if (category === 'testing') {
      if (pkg.devDependencies?.['fast-check']) {
        constraints.push('Testing: fast-check is available for property testing');
      }
    }
  } catch {
    // package.json not found or invalid
  }

  // Check tsconfig for stricter constraints
  try {
    const tsconfigPath = path.join(workspace, 'tsconfig.json');
    const tsconfigContent = await fs.readFile(tsconfigPath, 'utf-8');
    const tsconfig = JSON.parse(tsconfigContent);

    if (tsconfig.compilerOptions?.strict) {
      constraints.push('TypeScript: Strict mode enabled');
    }
    if (tsconfig.compilerOptions?.noImplicitAny) {
      constraints.push('TypeScript: No implicit any');
    }
  } catch {
    // tsconfig not found
  }

  return constraints;
}

// ============================================================================
// OPTION SCORING
// ============================================================================

/**
 * Scores options based on precedents, constraints, and codebase fit.
 */
export async function scoreOptions(
  options: DecisionOption[],
  precedents: Precedent[],
  constraints: string[],
  storage: LiBrainianStorage
): Promise<DecisionOption[]> {
  // Score based on precedents and constraints
  for (const option of options) {
    let score = option.compatibility;

    // Boost if similar patterns exist
    const nameLower = option.name.toLowerCase();
    const similar = precedents.filter(p =>
      p.decision.toLowerCase().includes(nameLower) ||
      nameLower.includes(p.decision.toLowerCase().split(' ')[0])
    );
    if (similar.length > 0) {
      score += 0.1 * Math.min(similar.length, 3);
    }

    // Check constraint compatibility
    for (const constraint of constraints) {
      const constraintLower = constraint.toLowerCase();

      // Penalize options that conflict with constraints
      if (constraintLower.includes('typescript') &&
          option.cons.some(c => c.toLowerCase().includes('typescript'))) {
        score -= 0.2;
      }

      // Boost options that align with constraints
      if (constraintLower.includes('vitest') &&
          option.name.toLowerCase().includes('unit')) {
        score += 0.1;
      }

      if (constraintLower.includes('strict') &&
          option.pros.some(p => p.toLowerCase().includes('type'))) {
        score += 0.05;
      }
    }

    // Boost if examples were found
    if (option.examples && option.examples.length > 0) {
      score += 0.05 * option.examples.length;
    }

    option.compatibility = Math.min(1, Math.max(0, score));
  }

  return options.sort((a, b) => b.compatibility - a.compatibility);
}

// ============================================================================
// RATIONALE GENERATION
// ============================================================================

/**
 * Generates a rationale explaining the recommendation.
 */
export function generateRationale(
  recommendation: DecisionOption | undefined,
  precedents: Precedent[],
  constraints: string[]
): string {
  if (!recommendation) {
    return 'No clear recommendation - consider the trade-offs of each option based on your specific requirements.';
  }

  const parts: string[] = [
    `Recommended: ${recommendation.name}`,
    `Reasoning: ${recommendation.description}`,
  ];

  if (recommendation.examples && recommendation.examples.length > 0) {
    parts.push(`Examples found: ${recommendation.examples.length} similar patterns in codebase`);
  }

  if (precedents.length > 0) {
    parts.push(`Precedents: ${precedents.length} related decisions found in codebase`);
  }

  if (constraints.length > 0) {
    parts.push(`Constraints considered: ${constraints.slice(0, 3).join(', ')}`);
  }

  const pros = recommendation.pros.slice(0, 2).join(', ');
  parts.push(`Key benefits: ${pros}`);

  return parts.join('. ') + '.';
}

// ============================================================================
// MAIN API
// ============================================================================

/**
 * Gets comprehensive decision support for a technical question.
 */
export async function getDecisionSupport(
  storage: LiBrainianStorage,
  question: string,
  workspace: string
): Promise<DecisionContext> {
  // Classify the decision
  const category = classifyDecision(question);

  // Generate options based on category
  const options = await generateOptions(storage, question, category, workspace);

  // Find precedents in codebase
  const precedents = await findPrecedents(storage, question, category);

  // Apply constraints from codebase
  const constraints = await identifyConstraints(storage, category, workspace);

  // Score options and make recommendation
  const scoredOptions = await scoreOptions(options, precedents, constraints, storage);
  const recommendation = scoredOptions[0];

  // Determine confidence threshold for recommendation
  const recommendationThreshold = 0.6;

  return {
    question,
    category,
    options: scoredOptions,
    constraints,
    recommendation: recommendation && recommendation.compatibility > recommendationThreshold
      ? recommendation
      : undefined,
    confidence: recommendation ? recommendation.compatibility : 0.3,
    rationale: generateRationale(
      recommendation?.compatibility > recommendationThreshold ? recommendation : undefined,
      precedents,
      constraints
    ),
    precedents,
  };
}

// ============================================================================
// CONTEXT PACK CREATION
// ============================================================================

/**
 * Creates a context pack from decision support results.
 */
export function createDecisionSupportPack(
  context: DecisionContext,
  version: LiBrainianVersion
): ContextPack {
  const keyFacts: string[] = [
    `Decision category: ${context.category}`,
    `Options analyzed: ${context.options.length}`,
    `Confidence: ${(context.confidence * 100).toFixed(0)}%`,
  ];

  if (context.recommendation) {
    keyFacts.push(`Recommended: ${context.recommendation.name}`);
    keyFacts.push(`Effort: ${context.recommendation.effort}, Risk: ${context.recommendation.risk}`);
  }

  if (context.constraints.length > 0) {
    keyFacts.push(`Constraints: ${context.constraints.slice(0, 3).join('; ')}`);
  }

  if (context.precedents.length > 0) {
    keyFacts.push(`Found ${context.precedents.length} precedents in codebase`);
  }

  return {
    packId: `decision_${Date.now()}`,
    packType: 'decision_context',
    targetId: `decision:${context.category}`,
    summary: context.rationale,
    confidence: context.confidence,
    keyFacts,
    codeSnippets: [],
    relatedFiles: context.precedents
      .filter(p => p.file)
      .map(p => p.file as string)
      .slice(0, 5),
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: [],
  };
}

// ============================================================================
// FORMATTING
// ============================================================================

/**
 * Formats decision support context as readable markdown.
 */
export function formatDecisionSupport(context: DecisionContext): string {
  let output = `## Decision: ${context.question}\n\n`;
  output += `**Category:** ${context.category}\n\n`;

  if (context.recommendation) {
    output += `### Recommendation: ${context.recommendation.name}\n`;
    output += `**Confidence:** ${(context.confidence * 100).toFixed(0)}%\n\n`;
    output += `${context.rationale}\n\n`;
  } else {
    output += `### No Clear Recommendation\n`;
    output += `${context.rationale}\n\n`;
  }

  output += `### Options:\n\n`;
  for (const option of context.options) {
    output += `**${option.name}** (effort: ${option.effort}, risk: ${option.risk}, fit: ${(option.compatibility * 100).toFixed(0)}%)\n`;
    output += `${option.description}\n`;
    output += `- Pros: ${option.pros.join(', ')}\n`;
    output += `- Cons: ${option.cons.join(', ')}\n`;
    if (option.examples && option.examples.length > 0) {
      output += `- Examples: ${option.examples.slice(0, 2).join(', ')}\n`;
    }
    output += `\n`;
  }

  if (context.constraints.length > 0) {
    output += `### Constraints:\n`;
    for (const c of context.constraints) {
      output += `- ${c}\n`;
    }
    output += `\n`;
  }

  if (context.precedents.length > 0) {
    output += `### Precedents:\n`;
    for (const p of context.precedents) {
      output += `- ${p.decision}`;
      if (p.file) output += ` (${p.file})`;
      output += `\n`;
    }
  }

  return output;
}

// ============================================================================
// QUERY STAGE RUNNER
// ============================================================================

export interface DecisionSupportStageResult {
  analyzed: boolean;
  packs: ContextPack[];
  explanation: string;
}

/**
 * Runs the decision support stage for queries.
 */
export async function runDecisionSupportStage(options: {
  storage: LiBrainianStorage;
  intent: string;
  version: LiBrainianVersion;
  workspaceRoot: string;
}): Promise<DecisionSupportStageResult> {
  const { storage, intent, version, workspaceRoot } = options;

  if (!isDecisionSupportQuery(intent)) {
    return {
      analyzed: false,
      packs: [],
      explanation: '',
    };
  }

  try {
    const context = await getDecisionSupport(storage, intent, workspaceRoot);
    const pack = createDecisionSupportPack(context, version);

    return {
      analyzed: true,
      packs: [pack],
      explanation: `Decision support: analyzed ${context.options.length} options for ${context.category} decision` +
        (context.recommendation ? `, recommending "${context.recommendation.name}"` : ''),
    };
  } catch (error) {
    return {
      analyzed: false,
      packs: [],
      explanation: `Decision support analysis failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}
