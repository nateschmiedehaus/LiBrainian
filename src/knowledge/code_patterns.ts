/**
 * @fileoverview Code Pattern Library for Agents
 *
 * A system that learns and provides common patterns from the codebase
 * to help agents write consistent code. It extracts patterns by analyzing
 * actual function implementations and provides:
 * - Error handling patterns (try-catch, result objects, error-first callbacks)
 * - Async patterns (async/await, Promise.all, sequential async)
 * - Validation patterns (input validation, schema validation)
 * - Testing patterns (describe/it, setup/teardown)
 * - API design patterns (factory functions, builders)
 * - Configuration patterns (env vars, config objects)
 * - Data access patterns (repository, query builders)
 * - Type definition patterns (interfaces, type aliases)
 * - Dependency injection patterns (constructor injection, factory injection)
 * - Caching patterns (memoization, LRU cache)
 * - Event patterns (pub/sub, event emitters)
 *
 * @example
 * ```typescript
 * const library = new PatternLibrary();
 * await library.buildFromCodebase(storage);
 *
 * // Get patterns for a specific category
 * const errorPatterns = library.getPatternsForCategory('error_handling');
 *
 * // Get pattern suggestions based on context
 * const suggestions = library.suggestPattern('handling errors in async functions');
 *
 * // Generate a comprehensive pattern guide
 * const guide = library.generatePatternGuide();
 * ```
 */

import type { LiBrainianStorage, FunctionKnowledge, ModuleKnowledge } from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A code pattern detected in the codebase.
 */
export interface CodePattern {
  /** Unique identifier for the pattern (category:name format) */
  id: string;
  /** Human-readable pattern name */
  name: string;
  /** Pattern category */
  category: PatternCategory;
  /** Description of what this pattern does and when to use it */
  description: string;
  /** Example code snippet demonstrating the pattern */
  example: string;
  /** Files/functions where this pattern is used */
  usage: string[];
  /** How often this pattern appears in the codebase */
  frequency: number;
  /** Confidence that this is a deliberate pattern (0-1) */
  confidence: number;
}

/**
 * Categories of code patterns.
 */
export type PatternCategory =
  | 'error_handling'
  | 'async_patterns'
  | 'validation'
  | 'logging'
  | 'configuration'
  | 'testing'
  | 'api_design'
  | 'data_access'
  | 'type_definitions'
  | 'dependency_injection'
  | 'caching'
  | 'events';

/**
 * Internal structure for tracking pattern occurrences during extraction.
 */
interface PatternAccumulator {
  count: number;
  examples: string[];
  exampleCode?: string;
}

/**
 * Result of querying the pattern library.
 */
export interface PatternQueryResult {
  patterns: CodePattern[];
  totalPatterns: number;
  categories: PatternCategory[];
  summary: string;
}

/**
 * Options for building the pattern library.
 */
export interface PatternLibraryBuildOptions {
  /** Minimum occurrences to consider something a pattern (default: 2) */
  minOccurrences?: number;
  /** Maximum patterns per category to store (default: 10) */
  maxPatternsPerCategory?: number;
  /** Categories to extract (default: all) */
  categories?: PatternCategory[];
}

// ============================================================================
// PATTERN DESCRIPTIONS
// ============================================================================

const PATTERN_DESCRIPTIONS: Record<string, string> = {
  // Error handling
  'try_catch_rethrow': 'Wrap operations in try-catch and rethrow with context for better stack traces',
  'result_object': 'Return result objects with success/error properties instead of throwing (Rust-style Result)',
  'error_first_callback': 'Use error-first callback style for Node.js compatibility',
  'typed_errors': 'Use typed/custom error classes for specific error handling',
  'error_boundary': 'Wrap components/sections in error boundaries for graceful degradation',

  // Async patterns
  'async_await': 'Use async/await for asynchronous operations for cleaner code',
  'promise_all': 'Run multiple independent promises in parallel with Promise.all',
  'promise_allsettled': 'Run promises in parallel, handling both success and failure individually',
  'sequential_async': 'Process async operations sequentially in a loop when order matters',
  'async_generator': 'Use async generators for streaming data processing',
  'promise_race': 'Use Promise.race for timeout patterns or taking fastest response',

  // Validation
  'input_validation': 'Validate function inputs at the start of the function',
  'schema_validation': 'Use schema libraries (Zod, Joi) for complex validation',
  'type_guard': 'Use TypeScript type guards for runtime type checking',
  'assertion': 'Use assertions for invariants that should never fail',
  'early_return': 'Return early on invalid input instead of nested conditionals',

  // Testing
  'describe_it': 'Use describe/it blocks for BDD-style test organization',
  'setup_teardown': 'Use beforeEach/afterEach for test setup and cleanup',
  'mock_injection': 'Inject mocks through function parameters or constructors',
  'test_factory': 'Use factory functions to create test fixtures',
  'arrange_act_assert': 'Structure tests with arrange, act, assert sections',

  // API design
  'factory_function': 'Use factory functions to create instances with configuration',
  'builder_pattern': 'Use fluent builder pattern for complex object construction',
  'options_object': 'Accept an options object instead of many parameters',
  'method_chaining': 'Return this from methods to enable method chaining',
  'named_exports': 'Use named exports for better tree-shaking and IDE support',

  // Configuration
  'env_config': 'Read configuration from environment variables',
  'config_object': 'Centralize configuration in a config object',
  'default_values': 'Provide sensible defaults with optional overrides',
  'config_validation': 'Validate configuration at startup',

  // Logging
  'structured_logging': 'Use structured logging with metadata objects',
  'log_levels': 'Use appropriate log levels (debug, info, warn, error)',
  'context_logging': 'Include context (request ID, user ID) in log entries',

  // Data access
  'repository_pattern': 'Abstract data access behind repository interfaces',
  'query_builder': 'Use query builders for complex database queries',
  'transaction_wrapper': 'Wrap multiple operations in transactions',

  // Type definitions
  'interface_first': 'Define interfaces before implementations',
  'type_alias': 'Use type aliases for complex types',
  'discriminated_union': 'Use discriminated unions for type-safe variants',
  'generic_constraints': 'Use generic constraints for type-safe abstractions',

  // Dependency injection
  'constructor_injection': 'Inject dependencies through constructor parameters',
  'factory_injection': 'Use factories to inject dependencies',
  'interface_dependency': 'Depend on interfaces, not implementations',

  // Caching
  'memoization': 'Cache function results based on inputs',
  'lru_cache': 'Use LRU cache for bounded memory caching',
  'cache_invalidation': 'Implement cache invalidation strategies',

  // Events
  'event_emitter': 'Use event emitters for pub/sub communication',
  'observer_pattern': 'Use observer pattern for reactive updates',
  'event_bus': 'Use a central event bus for cross-module communication',
};

// ============================================================================
// PATTERN LIBRARY
// ============================================================================

/**
 * A library of code patterns extracted from the codebase.
 * Helps agents write consistent code by learning from existing patterns.
 */
export class PatternLibrary {
  private patterns: Map<string, CodePattern> = new Map();
  private buildOptions: Required<PatternLibraryBuildOptions>;

  constructor(options: PatternLibraryBuildOptions = {}) {
    this.buildOptions = {
      minOccurrences: options.minOccurrences ?? 2,
      maxPatternsPerCategory: options.maxPatternsPerCategory ?? 10,
      categories: options.categories ?? [
        'error_handling',
        'async_patterns',
        'validation',
        'logging',
        'configuration',
        'testing',
        'api_design',
        'data_access',
        'type_definitions',
        'dependency_injection',
        'caching',
        'events',
      ],
    };
  }

  /**
   * Build the pattern library by analyzing the codebase.
   */
  async buildFromCodebase(storage: LiBrainianStorage): Promise<void> {
    const functions = await storage.getFunctions();
    const modules = await storage.getModules();

    const categories = this.buildOptions.categories;

    if (categories.includes('error_handling')) {
      await this.extractErrorPatterns(functions, storage);
    }

    if (categories.includes('async_patterns')) {
      await this.extractAsyncPatterns(functions, storage);
    }

    if (categories.includes('validation')) {
      await this.extractValidationPatterns(functions, storage);
    }

    if (categories.includes('testing')) {
      await this.extractTestingPatterns(functions, storage);
    }

    if (categories.includes('api_design')) {
      await this.extractAPIPatterns(functions, modules, storage);
    }

    if (categories.includes('configuration')) {
      await this.extractConfigurationPatterns(functions, modules, storage);
    }

    if (categories.includes('logging')) {
      await this.extractLoggingPatterns(functions, storage);
    }

    if (categories.includes('type_definitions')) {
      await this.extractTypePatterns(functions, modules, storage);
    }

    if (categories.includes('events')) {
      await this.extractEventPatterns(functions, modules, storage);
    }
  }

  /**
   * Extract error handling patterns from functions.
   */
  private async extractErrorPatterns(
    functions: FunctionKnowledge[],
    storage: LiBrainianStorage
  ): Promise<void> {
    const patterns = new Map<string, PatternAccumulator>();

    for (const func of functions) {
      const content = func.signature + ' ' + func.purpose;

      // Try-catch patterns
      if (/try\s*\{|catch\s*\(|throw\s+new\s+Error/i.test(content)) {
        this.incrementPattern(patterns, 'try_catch_rethrow', func.name);
      }

      // Result type patterns (like Rust's Result)
      if (/return\s*\{\s*(success|ok|error|err|result):/i.test(content) ||
          /Result<|Either<|Maybe</i.test(content)) {
        this.incrementPattern(patterns, 'result_object', func.name);
      }

      // Error-first callback
      if (/callback\s*\([^,]*err|err\s*,\s*result/i.test(content) ||
          /\(err(?:or)?\s*[,)]/i.test(func.signature)) {
        this.incrementPattern(patterns, 'error_first_callback', func.name);
      }

      // Typed errors
      if (/extends\s+Error|class\s+\w+Error|new\s+\w+Error\s*\(/i.test(content)) {
        this.incrementPattern(patterns, 'typed_errors', func.name);
      }

      // Error boundary (React-style or general)
      if (/errorBoundary|onError|handleError|componentDidCatch/i.test(func.name) ||
          /catch.*boundary|fallback.*error/i.test(content)) {
        this.incrementPattern(patterns, 'error_boundary', func.name);
      }
    }

    await this.addPatternsToLibrary('error_handling', patterns, storage);
  }

  /**
   * Extract async patterns from functions.
   */
  private async extractAsyncPatterns(
    functions: FunctionKnowledge[],
    storage: LiBrainianStorage
  ): Promise<void> {
    const patterns = new Map<string, PatternAccumulator>();

    for (const func of functions) {
      const content = func.signature + ' ' + func.purpose;

      // async/await
      if (/async\s+(function|const|let|var|\()|async\s*=>|:\s*Promise</i.test(content)) {
        this.incrementPattern(patterns, 'async_await', func.name);
      }

      // Promise.all
      if (/Promise\.all\s*\(/i.test(content)) {
        this.incrementPattern(patterns, 'promise_all', func.name);
      }

      // Promise.allSettled
      if (/Promise\.allSettled\s*\(/i.test(content)) {
        this.incrementPattern(patterns, 'promise_allsettled', func.name);
      }

      // Promise.race
      if (/Promise\.race\s*\(/i.test(content)) {
        this.incrementPattern(patterns, 'promise_race', func.name);
      }

      // Sequential async (await in loop)
      if (/for\s*(await)?\s*\([^)]*\)\s*\{[^}]*await/i.test(content) ||
          /forEach.*await|map.*await/i.test(content)) {
        this.incrementPattern(patterns, 'sequential_async', func.name);
      }

      // Async generator
      if (/async\s*\*\s*function|async\s*\*\s*\(|yield\s+await/i.test(content)) {
        this.incrementPattern(patterns, 'async_generator', func.name);
      }
    }

    await this.addPatternsToLibrary('async_patterns', patterns, storage);
  }

  /**
   * Extract validation patterns from functions.
   */
  private async extractValidationPatterns(
    functions: FunctionKnowledge[],
    storage: LiBrainianStorage
  ): Promise<void> {
    const patterns = new Map<string, PatternAccumulator>();

    for (const func of functions) {
      const content = func.signature + ' ' + func.purpose + ' ' + func.name;

      // Input validation
      if (/validate|isValid|checkInput|assertValid/i.test(func.name) ||
          /if\s*\(!?\w+\s*\)\s*throw/i.test(content)) {
        this.incrementPattern(patterns, 'input_validation', func.name);
      }

      // Schema validation (Zod, Joi, Yup, etc.)
      if (/\.parse\(|\.validate\(|schema\.|z\.|Joi\.|yup\./i.test(content) ||
          /Schema|zodSchema|joiSchema/i.test(func.name)) {
        this.incrementPattern(patterns, 'schema_validation', func.name);
      }

      // Type guards
      if (/is[A-Z]\w+\s*\([^)]*\)\s*:\s*\w+\s+is\s+/i.test(content) ||
          func.name.startsWith('is') && func.signature.includes(' is ')) {
        this.incrementPattern(patterns, 'type_guard', func.name);
      }

      // Assertions
      if (/assert|invariant|expect\(/i.test(func.name) ||
          /assert\(|invariant\(/i.test(content)) {
        this.incrementPattern(patterns, 'assertion', func.name);
      }

      // Early return pattern
      if (/if\s*\([^)]*\)\s*return\s*;?\s*$/im.test(content) ||
          func.purpose.toLowerCase().includes('early return')) {
        this.incrementPattern(patterns, 'early_return', func.name);
      }
    }

    await this.addPatternsToLibrary('validation', patterns, storage);
  }

  /**
   * Extract testing patterns from functions.
   */
  private async extractTestingPatterns(
    functions: FunctionKnowledge[],
    storage: LiBrainianStorage
  ): Promise<void> {
    const patterns = new Map<string, PatternAccumulator>();

    // Filter for test files
    const testFunctions = functions.filter(f =>
      f.filePath.includes('.test.') ||
      f.filePath.includes('.spec.') ||
      f.filePath.includes('__tests__')
    );

    for (const func of testFunctions) {
      const content = func.signature + ' ' + func.purpose + ' ' + func.name;

      // describe/it pattern
      if (/describe\s*\(|it\s*\(|test\s*\(/i.test(content)) {
        this.incrementPattern(patterns, 'describe_it', func.name);
      }

      // Setup/teardown
      if (/beforeEach|afterEach|beforeAll|afterAll|setUp|tearDown/i.test(content)) {
        this.incrementPattern(patterns, 'setup_teardown', func.name);
      }

      // Mock injection
      if (/mock|stub|spy|jest\.|vi\.|sinon\./i.test(content) ||
          /Mock|Stub|Fake/i.test(func.name)) {
        this.incrementPattern(patterns, 'mock_injection', func.name);
      }

      // Test factory
      if (/createMock|createTest|buildFixture|factory/i.test(func.name)) {
        this.incrementPattern(patterns, 'test_factory', func.name);
      }
    }

    await this.addPatternsToLibrary('testing', patterns, storage);
  }

  /**
   * Extract API design patterns from functions and modules.
   */
  private async extractAPIPatterns(
    functions: FunctionKnowledge[],
    modules: ModuleKnowledge[],
    storage: LiBrainianStorage
  ): Promise<void> {
    const patterns = new Map<string, PatternAccumulator>();

    for (const func of functions) {
      const content = func.signature + ' ' + func.name;

      // Factory function
      if (func.name.startsWith('create') || func.name.startsWith('make') ||
          func.name.includes('Factory') || func.name.startsWith('build')) {
        this.incrementPattern(patterns, 'factory_function', func.name);
      }

      // Builder pattern
      if (func.name.includes('Builder') || func.name.startsWith('with') ||
          /return\s+this\s*;?\s*$/i.test(content)) {
        this.incrementPattern(patterns, 'builder_pattern', func.name);
      }

      // Options object
      if (/options\s*[?:]|config\s*[?:]|\{\s*[^}]*\?\s*:/i.test(func.signature) ||
          func.name.includes('Options') || func.name.includes('Config')) {
        this.incrementPattern(patterns, 'options_object', func.name);
      }
    }

    // Named exports (check modules)
    for (const mod of modules) {
      if (mod.exports.length > 0 && !mod.exports.includes('default')) {
        this.incrementPattern(patterns, 'named_exports', mod.path);
      }
    }

    await this.addPatternsToLibrary('api_design', patterns, storage);
  }

  /**
   * Extract configuration patterns from functions and modules.
   */
  private async extractConfigurationPatterns(
    functions: FunctionKnowledge[],
    modules: ModuleKnowledge[],
    storage: LiBrainianStorage
  ): Promise<void> {
    const patterns = new Map<string, PatternAccumulator>();

    for (const func of functions) {
      const content = func.signature + ' ' + func.purpose + ' ' + func.name;

      // Environment config
      if (/process\.env|Deno\.env|import\.meta\.env|dotenv/i.test(content) ||
          func.name.includes('Env') || func.name.includes('Environment')) {
        this.incrementPattern(patterns, 'env_config', func.name);
      }

      // Config object
      if (func.name.includes('Config') || func.name.includes('Settings') ||
          /getConfig|loadConfig|resolveConfig/i.test(func.name)) {
        this.incrementPattern(patterns, 'config_object', func.name);
      }

      // Default values
      if (/\?\?|=\s*{|default\w*/i.test(func.signature) ||
          func.purpose.toLowerCase().includes('default')) {
        this.incrementPattern(patterns, 'default_values', func.name);
      }
    }

    await this.addPatternsToLibrary('configuration', patterns, storage);
  }

  /**
   * Extract logging patterns from functions.
   */
  private async extractLoggingPatterns(
    functions: FunctionKnowledge[],
    storage: LiBrainianStorage
  ): Promise<void> {
    const patterns = new Map<string, PatternAccumulator>();

    for (const func of functions) {
      const content = func.signature + ' ' + func.purpose + ' ' + func.name;

      // Structured logging
      if (/log\w*\s*\(\s*\{|logger\.\w+\s*\(\s*\{|console\.\w+\s*\(\s*\{/i.test(content) ||
          func.name.includes('Logger') || func.name.includes('Logging')) {
        this.incrementPattern(patterns, 'structured_logging', func.name);
      }

      // Log levels
      if (/\.debug\(|\.info\(|\.warn\(|\.error\(|logLevel|LogLevel/i.test(content)) {
        this.incrementPattern(patterns, 'log_levels', func.name);
      }

      // Context logging
      if (/requestId|correlationId|traceId|context\./i.test(content) ||
          func.name.includes('WithContext')) {
        this.incrementPattern(patterns, 'context_logging', func.name);
      }
    }

    await this.addPatternsToLibrary('logging', patterns, storage);
  }

  /**
   * Extract type definition patterns from functions and modules.
   */
  private async extractTypePatterns(
    functions: FunctionKnowledge[],
    modules: ModuleKnowledge[],
    storage: LiBrainianStorage
  ): Promise<void> {
    const patterns = new Map<string, PatternAccumulator>();

    for (const func of functions) {
      const content = func.signature;

      // Interface usage
      if (/:\s*I[A-Z]\w+|implements\s+\w+/i.test(content)) {
        this.incrementPattern(patterns, 'interface_first', func.name);
      }

      // Type alias
      if (/type\s+\w+\s*=|:\s*\w+Type\b/i.test(content)) {
        this.incrementPattern(patterns, 'type_alias', func.name);
      }

      // Discriminated union
      if (/:\s*\w+\s*\|\s*\w+|kind\s*:\s*['"`]\w+['"`]|type\s*:\s*['"`]\w+['"`]/i.test(content)) {
        this.incrementPattern(patterns, 'discriminated_union', func.name);
      }

      // Generic constraints
      if (/<\s*\w+\s+extends\s+\w+/i.test(content)) {
        this.incrementPattern(patterns, 'generic_constraints', func.name);
      }
    }

    // Check modules for type exports
    for (const mod of modules) {
      const typeExports = mod.exports.filter(e =>
        e.startsWith('I') || e.endsWith('Type') || e.endsWith('Interface')
      );
      if (typeExports.length > 0) {
        this.incrementPattern(patterns, 'interface_first', mod.path);
      }
    }

    await this.addPatternsToLibrary('type_definitions', patterns, storage);
  }

  /**
   * Extract event patterns from functions and modules.
   */
  private async extractEventPatterns(
    functions: FunctionKnowledge[],
    modules: ModuleKnowledge[],
    storage: LiBrainianStorage
  ): Promise<void> {
    const patterns = new Map<string, PatternAccumulator>();

    for (const func of functions) {
      const content = func.signature + ' ' + func.purpose + ' ' + func.name;

      // Event emitter
      if (/EventEmitter|\.emit\(|\.on\(|\.once\(|addListener|removeListener/i.test(content) ||
          func.name.includes('Emitter') || func.name.includes('Event')) {
        this.incrementPattern(patterns, 'event_emitter', func.name);
      }

      // Observer pattern
      if (/subscribe|unsubscribe|observer|notify|Subject/i.test(content) ||
          func.name.includes('Observer') || func.name.includes('Subscribe')) {
        this.incrementPattern(patterns, 'observer_pattern', func.name);
      }

      // Event bus
      if (/eventBus|messageBus|pubsub|publish|broadcast/i.test(content) ||
          func.name.includes('Bus') || func.name.includes('Publish')) {
        this.incrementPattern(patterns, 'event_bus', func.name);
      }
    }

    await this.addPatternsToLibrary('events', patterns, storage);
  }

  /**
   * Helper to increment pattern count and track examples.
   */
  private incrementPattern(
    map: Map<string, PatternAccumulator>,
    pattern: string,
    example: string
  ): void {
    if (!map.has(pattern)) {
      map.set(pattern, { count: 0, examples: [] });
    }
    const data = map.get(pattern)!;
    data.count++;
    if (data.examples.length < 5) {
      data.examples.push(example);
    }
  }

  /**
   * Add extracted patterns to the library.
   */
  private async addPatternsToLibrary(
    category: PatternCategory,
    patterns: Map<string, PatternAccumulator>,
    storage: LiBrainianStorage
  ): Promise<void> {
    const sortedPatterns = [...patterns.entries()]
      .filter(([, data]) => data.count >= this.buildOptions.minOccurrences)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, this.buildOptions.maxPatternsPerCategory);

    for (const [name, data] of sortedPatterns) {
      const id = `${category}:${name}`;
      const exampleCode = await this.getExampleCode(data.examples[0], storage);

      this.patterns.set(id, {
        id,
        name: formatPatternName(name),
        category,
        description: PATTERN_DESCRIPTIONS[name] || `Pattern: ${name}`,
        example: exampleCode,
        usage: data.examples,
        frequency: data.count,
        confidence: Math.min(1, data.count / 10),
      });
    }
  }

  /**
   * Get example code for a pattern.
   */
  private async getExampleCode(
    functionName: string | undefined,
    storage: LiBrainianStorage
  ): Promise<string> {
    if (!functionName) return '';

    try {
      const functions = await storage.getFunctionsByName(functionName);
      if (functions.length > 0) {
        const func = functions[0];
        return `// ${func.purpose}\n${func.signature}`;
      }
    } catch {
      // Ignore errors when fetching example code
    }
    return '';
  }

  // ==========================================================================
  // PUBLIC QUERY METHODS
  // ==========================================================================

  /**
   * Get a specific pattern by ID.
   */
  getPattern(id: string): CodePattern | undefined {
    return this.patterns.get(id);
  }

  /**
   * Get all patterns for a category.
   */
  getPatternsForCategory(category: PatternCategory): CodePattern[] {
    return [...this.patterns.values()]
      .filter(p => p.category === category)
      .sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Get all patterns.
   */
  getAllPatterns(): CodePattern[] {
    return [...this.patterns.values()].sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Get pattern count.
   */
  getPatternCount(): number {
    return this.patterns.size;
  }

  /**
   * Suggest patterns based on context (query text).
   * Matches keywords in the context to relevant pattern categories.
   */
  suggestPattern(context: string): CodePattern[] {
    const suggestions: CodePattern[] = [];
    const lowerContext = context.toLowerCase();

    // Error handling keywords
    if (/error|exception|fail|throw|catch|try/i.test(lowerContext)) {
      suggestions.push(...this.getPatternsForCategory('error_handling'));
    }

    // Async keywords
    if (/async|await|promise|concurrent|parallel/i.test(lowerContext)) {
      suggestions.push(...this.getPatternsForCategory('async_patterns'));
    }

    // Validation keywords
    if (/valid|check|verify|assert|input|schema/i.test(lowerContext)) {
      suggestions.push(...this.getPatternsForCategory('validation'));
    }

    // Testing keywords
    if (/test|spec|mock|stub|fixture|assert/i.test(lowerContext)) {
      suggestions.push(...this.getPatternsForCategory('testing'));
    }

    // API design keywords
    if (/api|factory|builder|create|make|options/i.test(lowerContext)) {
      suggestions.push(...this.getPatternsForCategory('api_design'));
    }

    // Configuration keywords
    if (/config|setting|env|environment|option/i.test(lowerContext)) {
      suggestions.push(...this.getPatternsForCategory('configuration'));
    }

    // Logging keywords
    if (/log|logging|trace|debug|info|warn/i.test(lowerContext)) {
      suggestions.push(...this.getPatternsForCategory('logging'));
    }

    // Type keywords
    if (/type|interface|generic|constraint|discriminate/i.test(lowerContext)) {
      suggestions.push(...this.getPatternsForCategory('type_definitions'));
    }

    // Event keywords
    if (/event|emit|subscribe|publish|observer|bus/i.test(lowerContext)) {
      suggestions.push(...this.getPatternsForCategory('events'));
    }

    // Caching keywords
    if (/cache|memoize|lru|invalidat/i.test(lowerContext)) {
      suggestions.push(...this.getPatternsForCategory('caching'));
    }

    // Data access keywords
    if (/repository|query|database|transaction|data\s*access/i.test(lowerContext)) {
      suggestions.push(...this.getPatternsForCategory('data_access'));
    }

    // Dependency injection keywords
    if (/inject|dependency|di|ioc|container/i.test(lowerContext)) {
      suggestions.push(...this.getPatternsForCategory('dependency_injection'));
    }

    // Remove duplicates and sort by frequency
    const uniquePatterns = [...new Map(suggestions.map(p => [p.id, p])).values()];
    return uniquePatterns.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Query patterns with structured options.
   */
  queryPatterns(options: {
    category?: PatternCategory;
    minFrequency?: number;
    minConfidence?: number;
    limit?: number;
    context?: string;
  }): PatternQueryResult {
    let results = [...this.patterns.values()];

    // Filter by category
    if (options.category) {
      results = results.filter(p => p.category === options.category);
    }

    // Filter by frequency
    if (options.minFrequency !== undefined) {
      results = results.filter(p => p.frequency >= options.minFrequency!);
    }

    // Filter by confidence
    if (options.minConfidence !== undefined) {
      results = results.filter(p => p.confidence >= options.minConfidence!);
    }

    // Use context to boost relevance
    if (options.context) {
      const suggestions = this.suggestPattern(options.context);
      const suggestionIds = new Set(suggestions.map(s => s.id));
      results.sort((a, b) => {
        const aBoost = suggestionIds.has(a.id) ? 1 : 0;
        const bBoost = suggestionIds.has(b.id) ? 1 : 0;
        return (bBoost - aBoost) || (b.frequency - a.frequency);
      });
    } else {
      results.sort((a, b) => b.frequency - a.frequency);
    }

    // Apply limit
    if (options.limit !== undefined) {
      results = results.slice(0, options.limit);
    }

    const categories = [...new Set(results.map(p => p.category))];

    return {
      patterns: results,
      totalPatterns: results.length,
      categories,
      summary: `Found ${results.length} patterns${options.category ? ` in ${options.category}` : ''}`
    };
  }

  /**
   * Generate a comprehensive pattern guide for agents.
   */
  generatePatternGuide(): string {
    const categories = [...new Set([...this.patterns.values()].map(p => p.category))];

    let guide = '# Code Patterns Used in This Project\n\n';
    guide += 'This guide documents the common patterns found in this codebase. ';
    guide += 'Following these patterns helps maintain consistency.\n\n';

    for (const category of categories) {
      const patterns = this.getPatternsForCategory(category);
      if (patterns.length === 0) continue;

      guide += `## ${formatCategoryName(category)}\n\n`;

      for (const pattern of patterns.slice(0, 3)) {
        guide += `### ${pattern.name}\n`;
        guide += `${pattern.description}\n\n`;
        guide += `**Frequency:** ${pattern.frequency} occurrences\n`;
        guide += `**Confidence:** ${(pattern.confidence * 100).toFixed(0)}%\n\n`;

        if (pattern.example) {
          guide += '```typescript\n' + pattern.example + '\n```\n\n';
        }

        if (pattern.usage.length > 0) {
          guide += `**Used in:** ${pattern.usage.slice(0, 3).join(', ')}`;
          if (pattern.usage.length > 3) {
            guide += ` and ${pattern.usage.length - 3} more`;
          }
          guide += '\n\n';
        }
      }

      if (patterns.length > 3) {
        guide += `*...and ${patterns.length - 3} more ${formatCategoryName(category).toLowerCase()} patterns*\n\n`;
      }
    }

    return guide;
  }

  /**
   * Get a summary of the pattern library.
   */
  getSummary(): {
    totalPatterns: number;
    byCategory: Record<string, number>;
    topPatterns: Array<{ name: string; frequency: number }>;
  } {
    const byCategory: Record<string, number> = {};
    for (const pattern of this.patterns.values()) {
      byCategory[pattern.category] = (byCategory[pattern.category] || 0) + 1;
    }

    const topPatterns = [...this.patterns.values()]
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10)
      .map(p => ({ name: p.name, frequency: p.frequency }));

    return {
      totalPatterns: this.patterns.size,
      byCategory,
      topPatterns,
    };
  }

  /**
   * Clear the pattern library.
   */
  clear(): void {
    this.patterns.clear();
  }

  /**
   * Serialize the pattern library to JSON.
   */
  toJSON(): string {
    return JSON.stringify({
      patterns: [...this.patterns.values()],
      buildOptions: this.buildOptions,
    }, null, 2);
  }

  /**
   * Load patterns from JSON.
   */
  fromJSON(json: string): void {
    const data = JSON.parse(json);
    this.patterns.clear();
    for (const pattern of data.patterns) {
      this.patterns.set(pattern.id, pattern);
    }
    if (data.buildOptions) {
      this.buildOptions = { ...this.buildOptions, ...data.buildOptions };
    }
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format a pattern name for display.
 */
function formatPatternName(name: string): string {
  return name
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Format a category name for display.
 */
function formatCategoryName(category: string): string {
  return category
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ============================================================================
// QUERY INTEGRATION
// ============================================================================

/**
 * Pattern query patterns for classifying user queries about code patterns.
 */
export const CODE_PATTERN_QUERY_PATTERNS = [
  /what\s+patterns?\s+(should|do|does|can)\s+(I|we)\s+use/i,
  /how\s+should\s+(I|we)\s+(handle|implement|write)/i,
  /pattern\s+for\s+(error|async|validation|test|config|log|event)/i,
  /best\s+practice\s+for\s+(error|async|validation|test|config|log|event)/i,
  /show\s+(me\s+)?patterns?\s+(for|in|used)/i,
  /what\s+(error|async|validation|test|config|logging)\s+patterns?/i,
  /common\s+patterns?\s+(for|in|used)/i,
  /code\s+patterns?\s+(for|in|used)/i,
  /how\s+does?\s+this\s+(project|codebase)\s+(handle|implement)/i,
];

/**
 * Check if a query is asking about code patterns.
 */
export function isCodePatternQuery(intent: string): boolean {
  return CODE_PATTERN_QUERY_PATTERNS.some(p => p.test(intent));
}

/**
 * Extract the pattern category from a query.
 */
export function extractPatternCategory(intent: string): PatternCategory | undefined {
  const categoryMap: Array<[RegExp, PatternCategory]> = [
    [/error|exception|catch|throw/i, 'error_handling'],
    [/async|await|promise|concurrent/i, 'async_patterns'],
    [/valid|check|verify|schema/i, 'validation'],
    [/test|spec|mock|fixture/i, 'testing'],
    [/api|factory|builder|create/i, 'api_design'],
    [/config|setting|env/i, 'configuration'],
    [/log|trace|debug/i, 'logging'],
    [/type|interface|generic/i, 'type_definitions'],
    [/event|emit|subscribe|publish/i, 'events'],
    [/cache|memoize/i, 'caching'],
    [/repository|query|database/i, 'data_access'],
    [/inject|dependency|di/i, 'dependency_injection'],
  ];

  for (const [pattern, category] of categoryMap) {
    if (pattern.test(intent)) {
      return category;
    }
  }

  return undefined;
}

/**
 * Handle a code pattern query using the pattern library.
 */
export async function handleCodePatternQuery(
  intent: string,
  storage: LiBrainianStorage
): Promise<PatternQueryResult> {
  const library = new PatternLibrary();
  await library.buildFromCodebase(storage);

  const category = extractPatternCategory(intent);

  return library.queryPatterns({
    category,
    context: intent,
    limit: 10,
  });
}
