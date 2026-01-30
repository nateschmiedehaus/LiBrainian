/**
 * @fileoverview Adversarial Pattern Library (WU-806)
 *
 * Collects and catalogs patterns that commonly cause hallucinations or errors
 * in code understanding systems. These patterns are used to stress-test Librarian.
 *
 * @packageDocumentation
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Category of adversarial pattern
 */
export type AdversarialCategory = 'naming' | 'structure' | 'semantic' | 'misleading' | 'edge_case';

/**
 * Severity level of an adversarial pattern
 */
export type AdversarialSeverity = 'high' | 'medium' | 'low';

/**
 * Example demonstrating an adversarial pattern
 */
export interface AdversarialExample {
  /** The code demonstrating the pattern */
  code: string;
  /** File path where this pattern might appear */
  file: string;
  /** What systems often get wrong */
  commonMistake: string;
  /** The actual correct understanding */
  correctAnswer: string;
}

/**
 * An adversarial pattern that can trip up code understanding systems
 */
export interface AdversarialPattern {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category of pattern */
  category: AdversarialCategory;
  /** Description of why this is adversarial */
  description: string;
  /** Example demonstrating the pattern */
  example: AdversarialExample;
  /** Questions likely to trigger mistakes */
  triggerQueries: string[];
  /** How likely this is to cause errors */
  severity: AdversarialSeverity;
}

/**
 * A corpus of adversarial patterns
 */
export interface AdversarialCorpus {
  /** All patterns in the corpus */
  patterns: AdversarialPattern[];
  /** Count of patterns per category */
  categories: Record<string, number>;
  /** Total number of patterns */
  totalPatterns: number;
  /** When the corpus was generated (ISO timestamp) */
  generatedAt: string;
}

/**
 * A probe generated from an adversarial pattern
 */
export interface AdversarialProbe {
  /** ID of the source pattern */
  patternId: string;
  /** Question to ask the system */
  query: string;
  /** The correct answer */
  expectedAnswer: string;
  /** The tempting but wrong answer */
  trapAnswer: string;
}

/**
 * Result of running an adversarial test
 */
export interface AdversarialTestResult {
  /** The probe that was tested */
  probe: AdversarialProbe;
  /** What the system actually answered */
  actualAnswer: string;
  /** Whether the system avoided the trap */
  passed: boolean;
  /** Explanation of the result */
  explanation: string;
}

// ============================================================================
// BUILT-IN ADVERSARIAL PATTERNS
// ============================================================================

const BUILT_IN_PATTERNS: AdversarialPattern[] = [
  // NAMING PATTERNS (5+)
  {
    id: 'naming-001',
    name: 'Similar Function Names',
    category: 'naming',
    description: 'Functions with very similar names that can be easily confused',
    example: {
      code: `function getData() { return this.cache; }
function getData2() { return this.fetchFromAPI(); }
function _getData() { return this.privateData; }
function getDataSync() { return this.syncData; }`,
      file: 'src/data.ts',
      commonMistake: 'Confusing getData with getData2, claiming getData fetches from API',
      correctAnswer: 'getData returns cached data, getData2 fetches from API, _getData returns private data',
    },
    triggerQueries: [
      'What does getData do?',
      'Which function fetches from the API?',
      'What is the difference between getData and getData2?',
    ],
    severity: 'high',
  },
  {
    id: 'naming-002',
    name: 'Misleading Function Name',
    category: 'naming',
    description: 'Function name suggests one behavior but implementation does another',
    example: {
      code: `function validateEmail(email: string): string {
  // Just normalizes, doesn't validate
  return email.toLowerCase().trim();
}`,
      file: 'src/validators.ts',
      commonMistake: 'Claiming validateEmail validates email format or throws on invalid email',
      correctAnswer: 'validateEmail only normalizes the email (lowercase + trim), no validation performed',
    },
    triggerQueries: [
      'Does validateEmail check if an email is valid?',
      'What validation does validateEmail perform?',
      'Will validateEmail throw on invalid input?',
    ],
    severity: 'high',
  },
  {
    id: 'naming-003',
    name: 'Abbreviation Confusion',
    category: 'naming',
    description: 'Same concept referred to by multiple names (abbreviation, full name, alias)',
    example: {
      code: `const cfg = loadConfig();
const config = cfg;
const configuration = config;
// All three refer to the same object`,
      file: 'src/config.ts',
      commonMistake: 'Treating cfg, config, and configuration as different objects',
      correctAnswer: 'cfg, config, and configuration all refer to the same configuration object',
    },
    triggerQueries: [
      'Are cfg and config different objects?',
      'What is the relationship between cfg and configuration?',
      'How many configuration objects are there?',
    ],
    severity: 'medium',
  },
  {
    id: 'naming-004',
    name: 'Boolean Naming Inversion',
    category: 'naming',
    description: 'Boolean variable name suggests opposite of its actual meaning',
    example: {
      code: `const isDisabled = true; // Actually means feature IS active
if (isDisabled) {
  enableFeature();
}`,
      file: 'src/features.ts',
      commonMistake: 'Assuming isDisabled=true means the feature is disabled',
      correctAnswer: 'When isDisabled is true, the feature is actually enabled (inverted naming)',
    },
    triggerQueries: [
      'Is the feature disabled when isDisabled is true?',
      'What does isDisabled control?',
      'How do you disable the feature?',
    ],
    severity: 'high',
  },
  {
    id: 'naming-005',
    name: 'Shadowed Variable Names',
    category: 'naming',
    description: 'Variable in inner scope shadows outer variable with same name',
    example: {
      code: `const user = { name: 'Admin' };
function processUser(user: any) {
  // This user is parameter, not outer user
  return user.name.toUpperCase();
}`,
      file: 'src/users.ts',
      commonMistake: 'Claiming processUser always returns "ADMIN"',
      correctAnswer: 'processUser returns the uppercase name of the passed user parameter, not the outer user',
    },
    triggerQueries: [
      'What does processUser return?',
      'Does processUser use the Admin user?',
      'What user does processUser process?',
    ],
    severity: 'medium',
  },

  // STRUCTURE PATTERNS (5+)
  {
    id: 'structure-001',
    name: 'Nested Function Same Name',
    category: 'structure',
    description: 'Inner function has the same name as outer function, causing confusion',
    example: {
      code: `function process(items: string[]) {
  function process(item: string) {
    return item.toUpperCase();
  }
  return items.map(process);
}`,
      file: 'src/processor.ts',
      commonMistake: 'Claiming the outer process function does uppercase conversion directly',
      correctAnswer: 'Outer process maps over items, inner process does the actual uppercase conversion',
    },
    triggerQueries: [
      'What does the process function do?',
      'How many process functions are there?',
      'Where is the uppercase conversion done?',
    ],
    severity: 'medium',
  },
  {
    id: 'structure-002',
    name: 'Function Overloads',
    category: 'structure',
    description: 'Multiple function signatures with different behaviors',
    example: {
      code: `function parse(input: string): number;
function parse(input: number): string;
function parse(input: string | number): string | number {
  if (typeof input === 'string') return parseInt(input, 10);
  return input.toString();
}`,
      file: 'src/parsers.ts',
      commonMistake: 'Claiming parse always returns a number',
      correctAnswer: 'parse returns number for string input, string for number input',
    },
    triggerQueries: [
      'What does parse return?',
      'What type does parse(42) return?',
      'Does parse always return a number?',
    ],
    severity: 'medium',
  },
  {
    id: 'structure-003',
    name: 'Re-export with Different Name',
    category: 'structure',
    description: 'Module re-exports something under a different name',
    example: {
      code: `// utils.ts
export { calculateSum as add } from './math';
export { calculateSum } from './math';
// Both add and calculateSum are the same function`,
      file: 'src/utils.ts',
      commonMistake: 'Treating add and calculateSum as different functions',
      correctAnswer: 'add is an alias for calculateSum, they are the same function',
    },
    triggerQueries: [
      'What is the difference between add and calculateSum?',
      'Are add and calculateSum different functions?',
      'Where is add implemented?',
    ],
    severity: 'medium',
  },
  {
    id: 'structure-004',
    name: 'Class with Static and Instance Methods',
    category: 'structure',
    description: 'Same method name exists as both static and instance method',
    example: {
      code: `class Logger {
  static log(msg: string) { console.log('[STATIC]', msg); }
  log(msg: string) { console.log('[INSTANCE]', msg); }
}`,
      file: 'src/logger.ts',
      commonMistake: 'Confusing Logger.log() with logger.log() behavior',
      correctAnswer: 'Logger.log() (static) prefixes [STATIC], logger.log() (instance) prefixes [INSTANCE]',
    },
    triggerQueries: [
      'How do you log a message with Logger?',
      'What does Logger.log output?',
      'Is Logger.log the same as logger.log?',
    ],
    severity: 'medium',
  },
  {
    id: 'structure-005',
    name: 'Prototype Method Override',
    category: 'structure',
    description: 'Method exists on both prototype and instance',
    example: {
      code: `class Base {
  getValue() { return 'base'; }
}
const obj = new Base();
obj.getValue = function() { return 'override'; };`,
      file: 'src/objects.ts',
      commonMistake: 'Claiming obj.getValue() returns "base"',
      correctAnswer: 'obj.getValue() returns "override" because the instance method shadows the prototype',
    },
    triggerQueries: [
      'What does obj.getValue() return?',
      'Does obj use the Base class getValue?',
      'What happens when you call getValue on obj?',
    ],
    severity: 'low',
  },

  // SEMANTIC PATTERNS (5+)
  {
    id: 'semantic-001',
    name: 'Dead Code After Return',
    category: 'semantic',
    description: 'Code exists after a return statement and is unreachable',
    example: {
      code: `function calculate(x: number): number {
  return x * 2;
  x = x + 1;  // Dead code
  return x * 3;  // Never reached
}`,
      file: 'src/calc.ts',
      commonMistake: 'Claiming calculate can return x * 3 or that x is incremented',
      correctAnswer: 'calculate always returns x * 2, all code after the first return is dead',
    },
    triggerQueries: [
      'What values can calculate return?',
      'Does calculate ever add 1 to x?',
      'Can calculate return x * 3?',
    ],
    severity: 'high',
  },
  {
    id: 'semantic-002',
    name: 'Deprecated but Present',
    category: 'semantic',
    description: 'Function is deprecated and should not be used',
    example: {
      code: `/** @deprecated Use newFetch instead */
function fetchData() {
  return legacyFetch();
}

function newFetch() {
  return modernFetch();
}`,
      file: 'src/api.ts',
      commonMistake: 'Recommending use of fetchData for fetching data',
      correctAnswer: 'fetchData is deprecated, newFetch should be used instead',
    },
    triggerQueries: [
      'How should I fetch data?',
      'What function should I use to fetch data?',
      'Is fetchData the right function to use?',
    ],
    severity: 'high',
  },
  {
    id: 'semantic-003',
    name: 'Commented-Out Code',
    category: 'semantic',
    description: 'Code that looks active but is actually commented out',
    example: {
      code: `function process(data) {
  // validateData(data);
  // transformData(data);
  return data;
}`,
      file: 'src/process.ts',
      commonMistake: 'Claiming process validates and transforms data',
      correctAnswer: 'process does nothing to the data, validation and transformation are commented out',
    },
    triggerQueries: [
      'Does process validate the data?',
      'What transformations does process apply?',
      'What does process do to its input?',
    ],
    severity: 'high',
  },
  {
    id: 'semantic-004',
    name: 'Conditional Always False',
    category: 'semantic',
    description: 'Condition that can never be true due to type or value constraints',
    example: {
      code: `function check(value: string) {
  if (typeof value === 'number') {
    return 'numeric';  // Never reached
  }
  return 'string';
}`,
      file: 'src/types.ts',
      commonMistake: 'Claiming check can return "numeric"',
      correctAnswer: 'check always returns "string" because value is typed as string',
    },
    triggerQueries: [
      'Can check return "numeric"?',
      'What does check return for number input?',
      'When does check return "numeric"?',
    ],
    severity: 'medium',
  },
  {
    id: 'semantic-005',
    name: 'Side Effect in Condition',
    category: 'semantic',
    description: 'Assignment in conditional expression that looks like comparison',
    example: {
      code: `let count = 0;
if (count = 5) {  // Assignment, not comparison!
  console.log('Count is five');
}`,
      file: 'src/counter.ts',
      commonMistake: 'Claiming the code checks if count equals 5',
      correctAnswer: 'The code assigns 5 to count and always enters the block (5 is truthy)',
    },
    triggerQueries: [
      'What does the if condition check?',
      'When does the console.log execute?',
      'Does this compare count to 5?',
    ],
    severity: 'high',
  },

  // MISLEADING PATTERNS (5+)
  {
    id: 'misleading-001',
    name: 'Outdated Comment',
    category: 'misleading',
    description: 'Comment describes behavior that no longer matches the code',
    example: {
      code: `// Doubles the input value
function transform(x: number): number {
  return x * 3;  // Changed to triple
}`,
      file: 'src/transform.ts',
      commonMistake: 'Claiming transform doubles the input',
      correctAnswer: 'transform triples the input despite the comment saying "doubles"',
    },
    triggerQueries: [
      'What does transform do?',
      'Does transform double the input?',
      'What is transform(10)?',
    ],
    severity: 'high',
  },
  {
    id: 'misleading-002',
    name: 'README Contradicts Implementation',
    category: 'misleading',
    description: 'Documentation claims different behavior than actual code',
    example: {
      code: `// README: "Authentication is required for all endpoints"
// Actual code:
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });  // No auth check!
});`,
      file: 'src/routes.ts',
      commonMistake: 'Claiming /health requires authentication',
      correctAnswer: '/health endpoint has no authentication, contradicting the README',
    },
    triggerQueries: [
      'Does /health require authentication?',
      'Which endpoints are unprotected?',
      'Is authentication required for all endpoints?',
    ],
    severity: 'high',
  },
  {
    id: 'misleading-003',
    name: 'Type Definition Mismatch',
    category: 'misleading',
    description: 'TypeScript types do not match runtime behavior',
    example: {
      code: `interface User {
  name: string;
  email: string;
}
function getUser(): User {
  return { name: 'John' } as User;  // Missing email!
}`,
      file: 'src/types.ts',
      commonMistake: 'Assuming getUser always returns an object with email',
      correctAnswer: 'getUser returns object without email property despite User type requiring it',
    },
    triggerQueries: [
      'Does getUser return an email?',
      'What properties does getUser return?',
      'Is the User type accurate?',
    ],
    severity: 'high',
  },
  {
    id: 'misleading-004',
    name: 'Default Parameter Misleading',
    category: 'misleading',
    description: 'Default parameter suggests different usage than intended',
    example: {
      code: `function connect(
  host: string = 'localhost',
  port: number = 5432  // Looks like Postgres default
) {
  // Actually connects to Redis
  return redis.connect(host, port);
}`,
      file: 'src/db.ts',
      commonMistake: 'Assuming connect uses PostgreSQL based on port 5432',
      correctAnswer: 'connect actually connects to Redis despite the misleading default port',
    },
    triggerQueries: [
      'What database does connect use?',
      'Does connect use PostgreSQL?',
      'What does port 5432 indicate here?',
    ],
    severity: 'medium',
  },
  {
    id: 'misleading-005',
    name: 'Error Message Mismatch',
    category: 'misleading',
    description: 'Error message describes different issue than actual cause',
    example: {
      code: `function divide(a: number, b: number) {
  if (a === 0) {  // Wrong condition!
    throw new Error('Cannot divide by zero');
  }
  return a / b;
}`,
      file: 'src/math.ts',
      commonMistake: 'Thinking the error is thrown when b is zero',
      correctAnswer: 'Error is thrown when a (not b) is zero, despite the misleading message',
    },
    triggerQueries: [
      'When does divide throw "Cannot divide by zero"?',
      'Does divide(10, 0) throw an error?',
      'What causes the division error?',
    ],
    severity: 'high',
  },

  // EDGE CASE PATTERNS (5+)
  {
    id: 'edge-001',
    name: 'Empty Function',
    category: 'edge_case',
    description: 'Function has no implementation and does nothing',
    example: {
      code: `function initialize() {
  // TODO: implement
}

function setup() { }`,
      file: 'src/init.ts',
      commonMistake: 'Claiming initialize or setup performs initialization',
      correctAnswer: 'Both initialize and setup are empty stubs that do nothing',
    },
    triggerQueries: [
      'What does initialize do?',
      'How does setup configure the system?',
      'What initialization is performed?',
    ],
    severity: 'medium',
  },
  {
    id: 'edge-002',
    name: 'Single-Line File',
    category: 'edge_case',
    description: 'File contains only a single line or export',
    example: {
      code: `export const VERSION = '1.0.0';`,
      file: 'src/version.ts',
      commonMistake: 'Assuming version.ts contains version logic or utilities',
      correctAnswer: 'version.ts only exports a single constant, no logic',
    },
    triggerQueries: [
      'What does version.ts contain?',
      'What functions are in version.ts?',
      'How does version.ts work?',
    ],
    severity: 'low',
  },
  {
    id: 'edge-003',
    name: 'Comment-Only File',
    category: 'edge_case',
    description: 'File contains only comments and no executable code',
    example: {
      code: `/**
 * This module will contain user management functions.
 * TODO: Implement user CRUD operations
 * TODO: Add authentication
 */`,
      file: 'src/users.ts',
      commonMistake: 'Claiming users.ts implements user management',
      correctAnswer: 'users.ts contains only TODO comments, no actual implementation',
    },
    triggerQueries: [
      'What user functions are in users.ts?',
      'How does users.ts handle authentication?',
      'What CRUD operations does users.ts have?',
    ],
    severity: 'medium',
  },
  {
    id: 'edge-004',
    name: 'Circular Import',
    category: 'edge_case',
    description: 'Circular dependency between modules can cause undefined behavior',
    example: {
      code: `// a.ts
import { b } from './b';
export const a = () => b();

// b.ts
import { a } from './a';
export const b = () => a();`,
      file: 'src/circular.ts',
      commonMistake: 'Claiming a() successfully calls b() which calls a()',
      correctAnswer: 'Circular import may cause a or b to be undefined at runtime',
    },
    triggerQueries: [
      'What happens when you call a()?',
      'Is there a circular dependency?',
      'Does b successfully call a?',
    ],
    severity: 'high',
  },
  {
    id: 'edge-005',
    name: 'Zero-Argument vs No-Parentheses',
    category: 'edge_case',
    description: 'Calling function vs referencing function object',
    example: {
      code: `function getValue() { return 42; }

const result1 = getValue;   // Function reference
const result2 = getValue(); // Function call`,
      file: 'src/functions.ts',
      commonMistake: 'Confusing getValue (reference) with getValue() (call)',
      correctAnswer: 'result1 is the function itself, result2 is 42',
    },
    triggerQueries: [
      'What is the value of result1?',
      'What does result1 contain?',
      'Are result1 and result2 the same?',
    ],
    severity: 'medium',
  },

  // Additional patterns to reach 20+
  {
    id: 'naming-006',
    name: 'Plural vs Singular Confusion',
    category: 'naming',
    description: 'Similar function names differ only in plural form',
    example: {
      code: `function getUser(id: string) { return db.findOne(id); }
function getUsers() { return db.findAll(); }
function getUsersList() { return getUsers().map(u => u.name); }`,
      file: 'src/users.ts',
      commonMistake: 'Confusing getUsers with getUsersList return types',
      correctAnswer: 'getUsers returns full user objects, getUsersList returns only names',
    },
    triggerQueries: [
      'What does getUsers return?',
      'How is getUsersList different from getUsers?',
      'Which function returns user names only?',
    ],
    severity: 'medium',
  },
  {
    id: 'structure-006',
    name: 'Default Export vs Named Export',
    category: 'structure',
    description: 'Same module has both default and named exports with similar names',
    example: {
      code: `// utils.ts
export default function utils() { return 'default'; }
export function utils() { return 'named'; } // Different!`,
      file: 'src/utils.ts',
      commonMistake: 'Assuming default and named utils are the same',
      correctAnswer: 'Default utils returns "default", named utils returns "named"',
    },
    triggerQueries: [
      'What does importing utils give you?',
      'Are the two utils exports the same?',
      'What is the default export?',
    ],
    severity: 'medium',
  },
  {
    id: 'semantic-006',
    name: 'Early Exit vs Full Execution',
    category: 'semantic',
    description: 'Function has multiple return paths with different behaviors',
    example: {
      code: `function process(data: any[]) {
  if (!data.length) return [];

  const validated = validate(data);
  const transformed = transform(validated);
  logMetrics(data);
  return transformed;
}`,
      file: 'src/process.ts',
      commonMistake: 'Claiming process always logs metrics',
      correctAnswer: 'process only logs metrics for non-empty arrays, early return skips logging',
    },
    triggerQueries: [
      'Does process always log metrics?',
      'What happens when process receives empty array?',
      'When is logMetrics called?',
    ],
    severity: 'medium',
  },
  {
    id: 'misleading-006',
    name: 'Async Without Await',
    category: 'misleading',
    description: 'Function is async but never awaits, suggesting sync behavior',
    example: {
      code: `async function quickCheck(value: string) {
  // No await anywhere!
  return value.length > 0;
}`,
      file: 'src/validation.ts',
      commonMistake: 'Assuming quickCheck performs async operations',
      correctAnswer: 'quickCheck is async but performs no async operations, returns Promise<boolean>',
    },
    triggerQueries: [
      'Why is quickCheck async?',
      'What async operations does quickCheck perform?',
      'Does quickCheck need to be awaited?',
    ],
    severity: 'low',
  },
  {
    id: 'edge-006',
    name: 'Getter with Side Effects',
    category: 'edge_case',
    description: 'Property getter that modifies state unexpectedly',
    example: {
      code: `class Counter {
  private _count = 0;

  get count() {
    this._count++;  // Side effect!
    return this._count;
  }
}`,
      file: 'src/counter.ts',
      commonMistake: 'Assuming counter.count returns consistent value',
      correctAnswer: 'Each access to count increments and returns new value (side effect)',
    },
    triggerQueries: [
      'Is count a pure getter?',
      'Does accessing count change state?',
      'What happens if you read count twice?',
    ],
    severity: 'high',
  },
];

// ============================================================================
// ADVERSARIAL PATTERN LIBRARY
// ============================================================================

/**
 * Library for adversarial patterns that can trip up code understanding systems
 */
export class AdversarialPatternLibrary {
  private patterns: AdversarialPattern[];
  private importCounter = 0;

  constructor(initialPatterns?: AdversarialPattern[]) {
    this.patterns = [...BUILT_IN_PATTERNS];
    if (initialPatterns) {
      this.patterns.push(...initialPatterns);
    }
  }

  /**
   * Get all patterns in the library
   */
  getPatterns(): AdversarialPattern[] {
    return [...this.patterns];
  }

  /**
   * Get patterns filtered by category
   */
  getByCategory(category: AdversarialCategory): AdversarialPattern[] {
    return this.patterns.filter((p) => p.category === category);
  }

  /**
   * Get the complete corpus with statistics
   */
  getCorpus(): AdversarialCorpus {
    const categories: Record<string, number> = {};

    for (const pattern of this.patterns) {
      categories[pattern.category] = (categories[pattern.category] || 0) + 1;
    }

    return {
      patterns: [...this.patterns],
      categories,
      totalPatterns: this.patterns.length,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Import patterns by analyzing a repository for adversarial code patterns
   */
  async importFromRepo(repoPath: string): Promise<AdversarialPattern[]> {
    const imported: AdversarialPattern[] = [];

    try {
      const statResult = await stat(repoPath);
      if (!statResult.isDirectory()) {
        return [];
      }

      // Scan for TypeScript/JavaScript files
      const files = await this.collectSourceFiles(repoPath);

      // Detect patterns in files
      for (const file of files.slice(0, 50)) { // Limit to 50 files for performance
        const detectedPatterns = await this.detectPatternsInFile(file, repoPath);
        imported.push(...detectedPatterns);
      }
    } catch {
      // Repository doesn't exist or can't be read
      return [];
    }

    return imported;
  }

  /**
   * Generate probes from patterns for testing
   */
  generateProbes(patterns: AdversarialPattern[]): AdversarialProbe[] {
    const probes: AdversarialProbe[] = [];

    for (const pattern of patterns) {
      for (const query of pattern.triggerQueries) {
        probes.push({
          patternId: pattern.id,
          query,
          expectedAnswer: pattern.example.correctAnswer,
          trapAnswer: pattern.example.commonMistake,
        });
      }
    }

    return probes;
  }

  /**
   * Run adversarial tests against an answer provider
   */
  async runTest(
    probes: AdversarialProbe[],
    answerProvider: (query: string) => Promise<string>
  ): Promise<AdversarialTestResult[]> {
    const results: AdversarialTestResult[] = [];

    for (const probe of probes) {
      try {
        const actualAnswer = await answerProvider(probe.query);
        const result = this.evaluateAnswer(probe, actualAnswer);
        results.push(result);
      } catch {
        // Handle provider errors gracefully
        results.push({
          probe,
          actualAnswer: '[Error: Answer provider failed]',
          passed: false,
          explanation: 'Answer provider threw an error',
        });
      }
    }

    return results;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private async collectSourceFiles(dir: string, files: string[] = []): Promise<string[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        // Skip node_modules and hidden directories
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await this.collectSourceFiles(fullPath, files);
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Ignore directories we can't read
    }

    return files;
  }

  private async detectPatternsInFile(filePath: string, repoPath: string): Promise<AdversarialPattern[]> {
    const patterns: AdversarialPattern[] = [];

    try {
      const content = await readFile(filePath, 'utf-8');
      const relativePath = filePath.replace(repoPath + '/', '');

      // Detect similar function names
      const similarNames = this.detectSimilarFunctionNames(content, relativePath);
      patterns.push(...similarNames);

      // Detect dead code patterns
      const deadCode = this.detectDeadCodePatterns(content, relativePath);
      patterns.push(...deadCode);

      // Detect misleading comments
      const misleadingComments = this.detectMisleadingComments(content, relativePath);
      patterns.push(...misleadingComments);

    } catch {
      // Ignore files we can't read
    }

    return patterns;
  }

  private detectSimilarFunctionNames(content: string, file: string): AdversarialPattern[] {
    const patterns: AdversarialPattern[] = [];

    // Find all function declarations
    const functionRegex = /function\s+(\w+)\s*\(/g;
    const functions: string[] = [];
    let match;

    while ((match = functionRegex.exec(content)) !== null) {
      functions.push(match[1]);
    }

    // Find groups of similar names
    const groups = this.groupSimilarNames(functions);

    for (const group of groups) {
      if (group.length >= 2) {
        this.importCounter++;
        patterns.push({
          id: `imported-naming-${this.importCounter}`,
          name: `Similar Functions: ${group.slice(0, 3).join(', ')}`,
          category: 'naming',
          description: `Functions with similar names detected: ${group.join(', ')}`,
          example: {
            code: group.map(f => `function ${f}() { ... }`).join('\n'),
            file,
            commonMistake: `Confusing ${group[0]} with ${group[1]}`,
            correctAnswer: `${group[0]} and ${group[1]} are distinct functions that may have different behaviors`,
          },
          triggerQueries: [
            `What does ${group[0]} do?`,
            `What is the difference between ${group[0]} and ${group[1]}?`,
          ],
          severity: 'medium',
        });
      }
    }

    return patterns;
  }

  private detectDeadCodePatterns(content: string, file: string): AdversarialPattern[] {
    const patterns: AdversarialPattern[] = [];

    // Simple heuristic: code after return statement in same block
    const deadCodeRegex = /return\s+[^;]+;\s*\n\s*[a-zA-Z]/g;

    if (deadCodeRegex.test(content)) {
      this.importCounter++;
      patterns.push({
        id: `imported-semantic-${this.importCounter}`,
        name: 'Potential Dead Code Detected',
        category: 'semantic',
        description: 'Code appears after return statement (may be dead code)',
        example: {
          code: '// Code after return detected',
          file,
          commonMistake: 'Assuming all code in the function executes',
          correctAnswer: 'Code after return statements is unreachable',
        },
        triggerQueries: [
          'Is all code in this function reachable?',
          'Is there dead code in this file?',
        ],
        severity: 'medium',
      });
    }

    return patterns;
  }

  private detectMisleadingComments(content: string, file: string): AdversarialPattern[] {
    const patterns: AdversarialPattern[] = [];

    // Detect @deprecated tags
    if (content.includes('@deprecated')) {
      this.importCounter++;
      patterns.push({
        id: `imported-semantic-${this.importCounter}`,
        name: 'Deprecated Code Present',
        category: 'semantic',
        description: 'File contains deprecated functions that should not be used',
        example: {
          code: '// @deprecated',
          file,
          commonMistake: 'Using deprecated functions',
          correctAnswer: 'Deprecated functions exist but should be avoided',
        },
        triggerQueries: [
          'What functions in this file are deprecated?',
          'Should I use the functions in this file?',
        ],
        severity: 'medium',
      });
    }

    // Detect TODO comments that suggest incomplete implementation
    const todoCount = (content.match(/\/\/\s*TODO/gi) || []).length;
    if (todoCount >= 3) {
      this.importCounter++;
      patterns.push({
        id: `imported-edge-${this.importCounter}`,
        name: 'Multiple TODO Comments',
        category: 'edge_case',
        description: 'File has many TODO comments suggesting incomplete implementation',
        example: {
          code: '// Multiple TODOs found',
          file,
          commonMistake: 'Assuming full implementation exists',
          correctAnswer: 'File may have incomplete or stub implementations',
        },
        triggerQueries: [
          'Is this file fully implemented?',
          'What parts of this file are incomplete?',
        ],
        severity: 'low',
      });
    }

    return patterns;
  }

  private groupSimilarNames(names: string[]): string[][] {
    const groups: string[][] = [];
    const used = new Set<string>();

    for (const name of names) {
      if (used.has(name)) continue;

      const similar = names.filter((other) => {
        if (other === name || used.has(other)) return false;
        return this.areSimilarNames(name, other);
      });

      if (similar.length > 0) {
        const group = [name, ...similar];
        group.forEach((n) => used.add(n));
        groups.push(group);
      }
    }

    return groups;
  }

  private areSimilarNames(a: string, b: string): boolean {
    // Check for common patterns of similar names
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    // Same base with suffix (getData vs getData2)
    if (aLower.replace(/\d+$/, '') === bLower.replace(/\d+$/, '')) return true;

    // Same base with underscore prefix (_getData vs getData)
    if (aLower.replace(/^_/, '') === bLower.replace(/^_/, '')) return true;

    // Same base with different case (getdata vs getData) - unlikely in well-typed code
    if (aLower === bLower && a !== b) return true;

    // Very similar edit distance
    if (this.levenshtein(a, b) <= 2 && Math.min(a.length, b.length) > 5) return true;

    return false;
  }

  private levenshtein(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  private evaluateAnswer(probe: AdversarialProbe, actualAnswer: string): AdversarialTestResult {
    const answerLower = actualAnswer.toLowerCase();
    const expectedLower = probe.expectedAnswer.toLowerCase();
    const trapLower = probe.trapAnswer.toLowerCase();

    // Calculate how much the answer matches expected vs trap
    const expectedMatch = this.calculateMatchScore(answerLower, expectedLower);
    const trapMatch = this.calculateMatchScore(answerLower, trapLower);

    const passed = expectedMatch > trapMatch || (trapMatch === 0 && expectedMatch > 0);

    let explanation: string;
    if (passed) {
      explanation = `Answer correctly aligns with expected answer (match: ${expectedMatch.toFixed(2)}) and avoids trap (match: ${trapMatch.toFixed(2)})`;
    } else if (trapMatch > expectedMatch) {
      explanation = `Answer fell into trap (trap match: ${trapMatch.toFixed(2)} > expected match: ${expectedMatch.toFixed(2)})`;
    } else {
      explanation = `Answer is ambiguous (expected match: ${expectedMatch.toFixed(2)}, trap match: ${trapMatch.toFixed(2)})`;
    }

    return {
      probe,
      actualAnswer,
      passed,
      explanation,
    };
  }

  private calculateMatchScore(answer: string, target: string): number {
    // Split target into key phrases
    const targetWords = target.split(/\s+/).filter((w) => w.length > 3);

    if (targetWords.length === 0) return 0;

    let matches = 0;
    for (const word of targetWords) {
      if (answer.includes(word)) {
        matches++;
      }
    }

    return matches / targetWords.length;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an AdversarialPatternLibrary instance
 */
export function createAdversarialPatternLibrary(
  initialPatterns?: AdversarialPattern[]
): AdversarialPatternLibrary {
  return new AdversarialPatternLibrary(initialPatterns);
}

// ============================================================================
// ADVERSARIAL BEHAVIOR DETECTION TYPES
// ============================================================================

/**
 * Categories of adversarial agent behavior
 */
export type AdversarialBehaviorCategory =
  | 'reasoning_fallacy'        // Logical fallacies in reasoning
  | 'evasion'                  // Avoiding direct answers
  | 'misdirection'             // Redirecting to irrelevant topics
  | 'overconfidence'           // Unjustified certainty
  | 'underconfidence'          // Excessive hedging to avoid accountability
  | 'circular_reasoning'       // Conclusions assumed in premises
  | 'appeal_to_authority'      // Using authority instead of evidence
  | 'hallucination_pattern'    // Patterns that indicate fabrication
  | 'sycophancy'               // Excessive agreement without substance
  | 'refusal_gaming'           // Gaming safety systems inappropriately
  | 'context_manipulation';    // Manipulating context for desired outputs

/**
 * Severity of adversarial behavior
 */
export type BehaviorSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * A detected instance of adversarial behavior
 */
export interface AdversarialBehaviorDetection {
  /** Unique identifier for this detection */
  id: string;
  /** Category of behavior detected */
  category: AdversarialBehaviorCategory;
  /** Severity of the behavior */
  severity: BehaviorSeverity;
  /** Evidence that triggered this detection */
  evidence: string[];
  /** Confidence in this detection (0-1) */
  confidence: number;
  /** Explanation of why this was flagged */
  explanation: string;
  /** Timestamp of detection */
  detectedAt: string;
  /** Related fallacy if applicable (from inference auditor) */
  relatedFallacy?: string;
}

/**
 * Remediation action for adversarial behavior
 */
export interface BehaviorRemediation {
  /** Unique identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Type of remediation aligned with quality gates */
  type: 'clarify' | 'adjust' | 'rollback' | 'pivot' | 'abort' | 'hotfix' | 'escalate';
  /** Estimated effort */
  effort: 'trivial' | 'low' | 'medium' | 'high' | 'critical';
  /** Specific steps to take */
  steps: string[];
  /** Which detections this addresses */
  addressesDetections: string[];
  /** Priority (lower = higher priority) */
  priority: number;
}

/**
 * Result of analyzing agent behavior for adversarial patterns
 */
export interface AdversarialBehaviorReport {
  /** All detections found */
  detections: AdversarialBehaviorDetection[];
  /** Overall adversarial score (0-1, higher = more adversarial) */
  adversarialScore: number;
  /** Whether the behavior should be flagged for review */
  shouldFlag: boolean;
  /** Suggested remediations */
  remediations: BehaviorRemediation[];
  /** Summary of findings */
  summary: string;
  /** Timestamp of analysis */
  analyzedAt: string;
}

/**
 * Input for behavior analysis
 */
export interface BehaviorAnalysisInput {
  /** The response or reasoning being analyzed */
  content: string;
  /** The original query/prompt that triggered this response */
  originalQuery?: string;
  /** Previous context or conversation history */
  context?: string[];
  /** Claimed confidence in the response */
  statedConfidence?: number;
  /** Evidence provided for claims */
  providedEvidence?: string[];
  /** Sources cited */
  citations?: string[];
  /** Inference steps taken (for integration with inference auditor) */
  inferenceSteps?: Array<{
    premises: string[];
    conclusion: string;
    rule?: string;
    confidence?: number;
  }>;
}

// ============================================================================
// ADVERSARIAL BEHAVIOR DETECTOR
// ============================================================================

/**
 * Built-in patterns for detecting adversarial behavior
 */
const BEHAVIOR_PATTERNS: Array<{
  category: AdversarialBehaviorCategory;
  patterns: RegExp[];
  keywords: string[];
  severity: BehaviorSeverity;
  description: string;
}> = [
  {
    category: 'evasion',
    patterns: [
      /I (?:can't|cannot|am unable to) (?:directly |fully |completely )?(?:answer|address|respond)/i,
      /that's (?:beyond|outside) (?:my|the) (?:scope|capability)/i,
      /I (?:don't|do not) have (?:access to|information about)/i,
      /let me redirect you to/i,
      /instead of answering.*let me/i,
    ],
    keywords: ['cannot answer', 'unable to', 'beyond scope', 'outside capability', 'redirect'],
    severity: 'medium',
    description: 'Response evades the direct question without justification',
  },
  {
    category: 'misdirection',
    patterns: [
      /(?:more importantly|the real question is|what you should ask)/i,
      /let's focus (?:instead )?on/i,
      /a better question would be/i,
      /rather than (?:that|this), consider/i,
    ],
    keywords: ['more importantly', 'real question', 'better question', 'focus instead'],
    severity: 'medium',
    description: 'Response redirects to a different topic without addressing the original',
  },
  {
    category: 'overconfidence',
    patterns: [
      /(?:definitely|certainly|absolutely|undoubtedly|without (?:a )?doubt|100%)/i,
      /(?:there is no|there's no) (?:question|doubt|uncertainty)/i,
      /(?:always|never) (?:will|does|is)/i,
      /guaranteed to/i,
    ],
    keywords: ['definitely', 'certainly', 'absolutely', 'undoubtedly', 'guaranteed', '100%'],
    severity: 'high',
    description: 'Claims excessive certainty without adequate evidence',
  },
  {
    category: 'underconfidence',
    patterns: [
      /I (?:think|believe|suppose|guess) (?:that )?maybe/i,
      /(?:might|could|may) (?:possibly|perhaps|maybe)/i,
      /I'm not (?:entirely |completely )?(?:sure|certain)/i,
      /(?:this|that) (?:might|may|could) (?:or might not|or may not)/i,
    ],
    keywords: ['might possibly', 'could perhaps', 'not entirely sure', 'may or may not'],
    severity: 'low',
    description: 'Excessive hedging that avoids making useful assertions',
  },
  {
    category: 'circular_reasoning',
    patterns: [
      /because (?:it is|it's|that's) (?:true|the case)/i,
      /(?:obviously|clearly) (?:this|that) (?:is|means)/i,
      /(?:by definition|definitionally)/i,
    ],
    keywords: ['because it is true', 'obviously', 'by definition', 'self-evident'],
    severity: 'high',
    description: 'Conclusion is assumed in the premises',
  },
  {
    category: 'appeal_to_authority',
    patterns: [
      /(?:experts|authorities|professionals) (?:say|agree|believe)/i,
      /according to (?:most|many|leading) (?:experts|authorities)/i,
      /(?:it is|it's) widely (?:accepted|believed|known)/i,
    ],
    keywords: ['experts say', 'authorities agree', 'widely accepted', 'professionals believe'],
    severity: 'medium',
    description: 'Uses authority claims without substantive evidence',
  },
  {
    category: 'hallucination_pattern',
    patterns: [
      /(?:in|on) (?:page|chapter|section) \d+/i, // Specific citations without source
      /(?:according to|as stated in) (?:the|their|its) (?:documentation|manual|guide)/i,
      /version \d+\.\d+\.\d+ (?:introduces|adds|includes)/i, // Specific version claims
      /(?:released|published|announced) (?:on|in) (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2},? \d{4}/i,
    ],
    keywords: ['page number', 'chapter number', 'section number', 'specific date'],
    severity: 'critical',
    description: 'Contains suspiciously specific details that may be fabricated',
  },
  {
    category: 'sycophancy',
    patterns: [
      /(?:you're|you are) (?:absolutely|completely|totally) (?:right|correct)/i,
      /(?:great|excellent|wonderful) (?:question|point|observation)/i,
      /I (?:completely|totally|fully) agree with (?:you|your|everything)/i,
      /(?:couldn't|could not) have (?:said|put) it better/i,
    ],
    keywords: ['absolutely right', 'great question', 'completely agree', 'excellent point'],
    severity: 'medium',
    description: 'Excessive agreement without substantive contribution',
  },
  {
    category: 'refusal_gaming',
    patterns: [
      /I (?:can't|cannot|won't|will not) (?:help with|assist with|provide)/i,
      /(?:this|that) (?:request|query) (?:violates|goes against)/i,
      /for (?:safety|ethical|legal) (?:reasons|concerns)/i,
    ],
    keywords: ['cannot help', 'safety reasons', 'ethical concerns', 'violates policy'],
    severity: 'low',
    description: 'May be inappropriately refusing a legitimate request',
  },
  {
    category: 'context_manipulation',
    patterns: [
      /(?:as|like) (?:you|we) (?:mentioned|said|discussed) (?:earlier|before)/i,
      /(?:based on|given) (?:our|your) (?:previous|earlier) (?:conversation|discussion)/i,
      /(?:you|we) (?:agreed|established) that/i,
    ],
    keywords: ['as you mentioned', 'we discussed', 'you agreed', 'we established'],
    severity: 'high',
    description: 'References context that may not exist or be accurate',
  },
];

/**
 * Detector for adversarial agent behavior.
 * Integrates with inference auditor for fallacy detection
 * and quality gates for course correction.
 */
export class AdversarialBehaviorDetector {
  private detectionCounter = 0;
  private remediationCounter = 0;
  private customPatterns: typeof BEHAVIOR_PATTERNS = [];

  /**
   * Add custom behavior patterns
   */
  addPattern(pattern: typeof BEHAVIOR_PATTERNS[0]): void {
    this.customPatterns.push(pattern);
  }

  /**
   * Analyze content for adversarial behavior patterns.
   *
   * @param input - The behavior analysis input
   * @returns A comprehensive behavior report
   */
  analyze(input: BehaviorAnalysisInput): AdversarialBehaviorReport {
    const detections: AdversarialBehaviorDetection[] = [];
    const allPatterns = [...BEHAVIOR_PATTERNS, ...this.customPatterns];

    // Phase 1: Pattern-based detection
    for (const patternDef of allPatterns) {
      const matches = this.findPatternMatches(input.content, patternDef);
      if (matches.length > 0) {
        this.detectionCounter++;
        detections.push({
          id: `detection_${this.detectionCounter}`,
          category: patternDef.category,
          severity: patternDef.severity,
          evidence: matches,
          confidence: this.calculatePatternConfidence(matches, patternDef),
          explanation: patternDef.description,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // Phase 2: Inference-based detection (if inference steps provided)
    if (input.inferenceSteps && input.inferenceSteps.length > 0) {
      const inferenceDetections = this.analyzeInferenceSteps(input.inferenceSteps);
      detections.push(...inferenceDetections);
    }

    // Phase 3: Confidence calibration detection
    if (input.statedConfidence !== undefined) {
      const calibrationDetection = this.checkConfidenceCalibration(
        input.content,
        input.statedConfidence,
        input.providedEvidence || []
      );
      if (calibrationDetection) {
        detections.push(calibrationDetection);
      }
    }

    // Phase 4: Citation verification
    if (input.citations && input.citations.length > 0) {
      const citationDetections = this.checkCitations(input.content, input.citations);
      detections.push(...citationDetections);
    }

    // Phase 5: Context consistency (if context provided)
    if (input.context && input.context.length > 0 && input.originalQuery) {
      const contextDetection = this.checkContextConsistency(
        input.content,
        input.originalQuery,
        input.context
      );
      if (contextDetection) {
        detections.push(contextDetection);
      }
    }

    // Calculate overall adversarial score
    const adversarialScore = this.calculateAdversarialScore(detections);

    // Generate remediations
    const remediations = this.generateRemediations(detections);

    // Determine if should flag
    const shouldFlag = adversarialScore > 0.5 ||
      detections.some(d => d.severity === 'critical') ||
      detections.filter(d => d.severity === 'high').length >= 2;

    // Build summary
    const summary = this.buildSummary(detections, adversarialScore);

    return {
      detections,
      adversarialScore,
      shouldFlag,
      remediations,
      summary,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * Analyze inference steps for logical fallacies.
   * Integrates with the inference auditor patterns.
   */
  private analyzeInferenceSteps(
    steps: BehaviorAnalysisInput['inferenceSteps']
  ): AdversarialBehaviorDetection[] {
    const detections: AdversarialBehaviorDetection[] = [];

    if (!steps) return detections;

    for (const step of steps) {
      // Check for circular reasoning
      const conclusionLower = step.conclusion.toLowerCase();
      for (const premise of step.premises) {
        const premiseLower = premise.toLowerCase();
        const similarity = this.stringSimilarity(premiseLower, conclusionLower);
        if (similarity > 0.7) {
          this.detectionCounter++;
          detections.push({
            id: `detection_${this.detectionCounter}`,
            category: 'circular_reasoning',
            severity: 'high',
            evidence: [`Premise: "${premise}"`, `Conclusion: "${step.conclusion}"`],
            confidence: similarity,
            explanation: 'Conclusion appears to be restating a premise',
            detectedAt: new Date().toISOString(),
            relatedFallacy: 'circular_reasoning',
          });
        }
      }

      // Check for hasty generalization
      const universalQuantifiers = ['all', 'every', 'always', 'never', 'none', 'no one'];
      if (universalQuantifiers.some(q => conclusionLower.includes(q))) {
        if (step.premises.length < 3) {
          this.detectionCounter++;
          detections.push({
            id: `detection_${this.detectionCounter}`,
            category: 'reasoning_fallacy',
            severity: 'medium',
            evidence: [
              `Universal claim: "${step.conclusion}"`,
              `Based on only ${step.premises.length} premise(s)`,
            ],
            confidence: 0.7,
            explanation: 'Universal claim made with insufficient supporting premises',
            detectedAt: new Date().toISOString(),
            relatedFallacy: 'hasty_generalization',
          });
        }
      }

      // Check for low confidence inference with high certainty language
      if (step.confidence !== undefined && step.confidence < 0.5) {
        const highCertaintyWords = ['definitely', 'certainly', 'absolutely', 'clearly', 'obviously'];
        if (highCertaintyWords.some(w => conclusionLower.includes(w))) {
          this.detectionCounter++;
          detections.push({
            id: `detection_${this.detectionCounter}`,
            category: 'overconfidence',
            severity: 'high',
            evidence: [
              `Stated confidence: ${step.confidence}`,
              `But uses high-certainty language: "${step.conclusion}"`,
            ],
            confidence: 0.8,
            explanation: 'Language certainty does not match stated confidence',
            detectedAt: new Date().toISOString(),
          });
        }
      }
    }

    return detections;
  }

  /**
   * Check if stated confidence matches the evidence provided.
   */
  private checkConfidenceCalibration(
    content: string,
    statedConfidence: number,
    evidence: string[]
  ): AdversarialBehaviorDetection | null {
    // High confidence with little evidence
    if (statedConfidence > 0.8 && evidence.length < 2) {
      this.detectionCounter++;
      return {
        id: `detection_${this.detectionCounter}`,
        category: 'overconfidence',
        severity: 'high',
        evidence: [
          `Stated confidence: ${statedConfidence}`,
          `Evidence items provided: ${evidence.length}`,
        ],
        confidence: 0.75,
        explanation: 'High confidence claimed with insufficient supporting evidence',
        detectedAt: new Date().toISOString(),
      };
    }

    // Very low confidence but making strong claims
    if (statedConfidence < 0.3) {
      const strongClaimPatterns = [
        /(?:must|should|will) (?:be|do|have)/i,
        /(?:definitely|certainly|absolutely)/i,
        /(?:always|never)/i,
      ];
      for (const pattern of strongClaimPatterns) {
        if (pattern.test(content)) {
          this.detectionCounter++;
          return {
            id: `detection_${this.detectionCounter}`,
            category: 'reasoning_fallacy',
            severity: 'medium',
            evidence: [
              `Stated confidence: ${statedConfidence}`,
              `But content contains strong claims`,
            ],
            confidence: 0.65,
            explanation: 'Content makes strong claims despite low stated confidence',
            detectedAt: new Date().toISOString(),
          };
        }
      }
    }

    return null;
  }

  /**
   * Check citations for potential hallucination patterns.
   */
  private checkCitations(content: string, citations: string[]): AdversarialBehaviorDetection[] {
    const detections: AdversarialBehaviorDetection[] = [];

    // Check for suspiciously specific citations
    for (const citation of citations) {
      // Very specific page numbers in long documents
      const pageMatch = citation.match(/page\s*(\d+)/i);
      if (pageMatch) {
        const pageNum = parseInt(pageMatch[1], 10);
        if (pageNum > 500) {
          this.detectionCounter++;
          detections.push({
            id: `detection_${this.detectionCounter}`,
            category: 'hallucination_pattern',
            severity: 'high',
            evidence: [`Citation: "${citation}"`, `Suspiciously specific page number: ${pageNum}`],
            confidence: 0.6,
            explanation: 'Very specific page number citation may indicate hallucination',
            detectedAt: new Date().toISOString(),
          });
        }
      }

      // URLs that look fabricated (random-looking strings)
      const urlMatch = citation.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        const url = urlMatch[0];
        // Check for suspicious patterns in URLs
        if (url.includes('/article/') && /\d{8,}/.test(url)) {
          this.detectionCounter++;
          detections.push({
            id: `detection_${this.detectionCounter}`,
            category: 'hallucination_pattern',
            severity: 'medium',
            evidence: [`URL: "${url}"`, 'Contains suspicious numeric ID pattern'],
            confidence: 0.5,
            explanation: 'URL pattern may indicate fabricated citation',
            detectedAt: new Date().toISOString(),
          });
        }
      }
    }

    return detections;
  }

  /**
   * Check for context manipulation.
   */
  private checkContextConsistency(
    content: string,
    query: string,
    context: string[]
  ): AdversarialBehaviorDetection | null {
    // Check if response claims things about the context that aren't there
    const claimPatterns = [
      /(?:as|like) (?:you|we) (?:mentioned|said|discussed)/i,
      /(?:you|we) (?:agreed|established|confirmed)/i,
      /(?:based on|given) (?:our|your) (?:previous|earlier)/i,
    ];

    for (const pattern of claimPatterns) {
      const match = content.match(pattern);
      if (match) {
        // Check if the claimed context actually exists
        const contextStr = context.join(' ').toLowerCase();
        const matchedText = match[0].toLowerCase();

        // If claiming context but context is minimal
        if (context.length < 2 || contextStr.length < 100) {
          this.detectionCounter++;
          return {
            id: `detection_${this.detectionCounter}`,
            category: 'context_manipulation',
            severity: 'high',
            evidence: [
              `Claims: "${match[0]}"`,
              `But context is minimal (${context.length} items, ${contextStr.length} chars)`,
            ],
            confidence: 0.7,
            explanation: 'References context that may not exist',
            detectedAt: new Date().toISOString(),
          };
        }
      }
    }

    return null;
  }

  /**
   * Find pattern matches in content.
   */
  private findPatternMatches(
    content: string,
    patternDef: typeof BEHAVIOR_PATTERNS[0]
  ): string[] {
    const matches: string[] = [];

    // Check regex patterns
    for (const pattern of patternDef.patterns) {
      const match = content.match(pattern);
      if (match) {
        matches.push(match[0]);
      }
    }

    // Check keywords (case-insensitive)
    const contentLower = content.toLowerCase();
    for (const keyword of patternDef.keywords) {
      if (contentLower.includes(keyword.toLowerCase())) {
        // Get surrounding context
        const idx = contentLower.indexOf(keyword.toLowerCase());
        const start = Math.max(0, idx - 20);
        const end = Math.min(content.length, idx + keyword.length + 20);
        const context = content.slice(start, end);
        if (!matches.includes(context) && !matches.some(m => m.includes(keyword))) {
          matches.push(`...${context}...`);
        }
      }
    }

    return matches;
  }

  /**
   * Calculate confidence for pattern-based detection.
   */
  private calculatePatternConfidence(
    matches: string[],
    patternDef: typeof BEHAVIOR_PATTERNS[0]
  ): number {
    // Base confidence from number of matches
    const matchCount = Math.min(matches.length, 5);
    const baseConfidence = 0.4 + (matchCount * 0.12);

    // Adjust by severity (more severe patterns should have higher confidence threshold)
    const severityMultiplier: Record<BehaviorSeverity, number> = {
      critical: 1.0,
      high: 0.95,
      medium: 0.9,
      low: 0.85,
    };

    return Math.min(1.0, baseConfidence * severityMultiplier[patternDef.severity]);
  }

  /**
   * Calculate overall adversarial score from detections.
   */
  private calculateAdversarialScore(detections: AdversarialBehaviorDetection[]): number {
    if (detections.length === 0) return 0;

    const severityWeights: Record<BehaviorSeverity, number> = {
      critical: 1.0,
      high: 0.7,
      medium: 0.4,
      low: 0.2,
    };

    let weightedSum = 0;
    let totalWeight = 0;

    for (const detection of detections) {
      const weight = severityWeights[detection.severity];
      weightedSum += detection.confidence * weight;
      totalWeight += weight;
    }

    // Normalize by expected maximum
    const normalizedScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Apply scaling based on number of detections
    const countFactor = Math.min(1.0, detections.length / 5);

    return Math.min(1.0, normalizedScore * (0.5 + 0.5 * countFactor));
  }

  /**
   * Generate remediations for detected issues.
   * Returns remediation suggestions compatible with quality gates system.
   */
  private generateRemediations(
    detections: AdversarialBehaviorDetection[]
  ): BehaviorRemediation[] {
    const remediations: BehaviorRemediation[] = [];
    const addressedCategories = new Set<AdversarialBehaviorCategory>();

    // Group detections by category for consolidated remediation
    const byCategory = new Map<AdversarialBehaviorCategory, AdversarialBehaviorDetection[]>();
    for (const detection of detections) {
      if (!byCategory.has(detection.category)) {
        byCategory.set(detection.category, []);
      }
      byCategory.get(detection.category)!.push(detection);
    }

    // Generate remediations by category
    for (const [category, categoryDetections] of byCategory) {
      if (addressedCategories.has(category)) continue;
      addressedCategories.add(category);

      this.remediationCounter++;
      const remediation = this.createRemediationForCategory(
        category,
        categoryDetections
      );
      if (remediation) {
        remediations.push(remediation);
      }
    }

    // Sort by priority
    remediations.sort((a, b) => a.priority - b.priority);

    return remediations;
  }

  /**
   * Create a specific remediation for a behavior category.
   */
  private createRemediationForCategory(
    category: AdversarialBehaviorCategory,
    detections: AdversarialBehaviorDetection[]
  ): BehaviorRemediation | null {
    const detectionIds = detections.map(d => d.id);
    const maxSeverity = detections.reduce(
      (max, d) => {
        const order: Record<BehaviorSeverity, number> = { critical: 3, high: 2, medium: 1, low: 0 };
        return order[d.severity] > order[max] ? d.severity : max;
      },
      'low' as BehaviorSeverity
    );

    const remediations: Record<AdversarialBehaviorCategory, Omit<BehaviorRemediation, 'id' | 'addressesDetections'>> = {
      reasoning_fallacy: {
        description: 'Address logical fallacies in reasoning chain',
        type: 'adjust',
        effort: 'medium',
        steps: [
          'Review each inference step for logical validity',
          'Ensure conclusions follow from premises',
          'Add missing premises or weaken conclusions',
          'Consider alternative explanations',
        ],
        priority: 1,
      },
      evasion: {
        description: 'Provide direct response to the question asked',
        type: 'clarify',
        effort: 'low',
        steps: [
          'Identify the core question being asked',
          'Provide a direct answer if possible',
          'If unable to answer, explain specific reasons',
          'Offer alternative approaches if applicable',
        ],
        priority: 2,
      },
      misdirection: {
        description: 'Address the original topic directly',
        type: 'adjust',
        effort: 'low',
        steps: [
          'Return focus to the original question',
          'Address tangential points only after answering main question',
          'Clearly distinguish between direct answers and related observations',
        ],
        priority: 2,
      },
      overconfidence: {
        description: 'Calibrate confidence to match evidence',
        type: 'adjust',
        effort: 'medium',
        steps: [
          'Review evidence supporting each claim',
          'Add appropriate hedging language where evidence is limited',
          'Distinguish between facts and inferences',
          'Acknowledge uncertainty explicitly',
        ],
        priority: 1,
      },
      underconfidence: {
        description: 'Make clearer assertions where evidence supports them',
        type: 'clarify',
        effort: 'low',
        steps: [
          'Identify claims with strong supporting evidence',
          'State well-supported claims more directly',
          'Reserve hedging for genuinely uncertain claims',
        ],
        priority: 3,
      },
      circular_reasoning: {
        description: 'Provide independent evidence for conclusions',
        type: 'rollback',
        effort: 'high',
        steps: [
          'Identify circular reasoning patterns',
          'Find independent evidence for conclusions',
          'Restructure argument with proper premise-conclusion flow',
          'Verify each step adds new information',
        ],
        priority: 1,
      },
      appeal_to_authority: {
        description: 'Provide substantive evidence beyond authority claims',
        type: 'adjust',
        effort: 'medium',
        steps: [
          'Identify claims relying solely on authority',
          'Add substantive evidence (data, methodology, reasoning)',
          'Verify authority relevance to specific domain',
          'Distinguish expert consensus from individual opinion',
        ],
        priority: 2,
      },
      hallucination_pattern: {
        description: 'Verify or remove potentially fabricated details',
        type: 'abort',
        effort: 'critical',
        steps: [
          'Flag all specific citations for verification',
          'Remove unverifiable specific details',
          'Replace with general statements if specific details cannot be confirmed',
          'Add explicit uncertainty markers for unverified information',
        ],
        priority: 0,
      },
      sycophancy: {
        description: 'Provide substantive analysis rather than agreement',
        type: 'clarify',
        effort: 'low',
        steps: [
          'Replace gratuitous praise with substantive response',
          'Offer genuine critical analysis where appropriate',
          'Focus on information value over social validation',
        ],
        priority: 3,
      },
      refusal_gaming: {
        description: 'Reconsider refusal appropriateness',
        type: 'escalate',
        effort: 'medium',
        steps: [
          'Review the actual request for legitimacy',
          'Determine if refusal is appropriate',
          'If legitimate request, provide helpful response',
          'If truly problematic, explain specific concerns',
        ],
        priority: 2,
      },
      context_manipulation: {
        description: 'Verify context claims against actual history',
        type: 'rollback',
        effort: 'high',
        steps: [
          'Review all claims about prior context',
          'Verify each claim against actual conversation history',
          'Remove or correct false context claims',
          'Base response only on verified information',
        ],
        priority: 1,
      },
    };

    const config = remediations[category];
    if (!config) return null;

    // Adjust effort based on severity
    let effort = config.effort;
    if (maxSeverity === 'critical' && effort !== 'critical') {
      effort = 'high';
    }

    return {
      id: `remediation_${this.remediationCounter}`,
      ...config,
      effort,
      addressesDetections: detectionIds,
    };
  }

  /**
   * Build a summary of the analysis.
   */
  private buildSummary(
    detections: AdversarialBehaviorDetection[],
    score: number
  ): string {
    if (detections.length === 0) {
      return 'No adversarial behavior patterns detected.';
    }

    const criticalCount = detections.filter(d => d.severity === 'critical').length;
    const highCount = detections.filter(d => d.severity === 'high').length;
    const categories = [...new Set(detections.map(d => d.category))];

    let summary = `Detected ${detections.length} potential issue(s) across ${categories.length} category(ies). `;

    if (criticalCount > 0) {
      summary += `${criticalCount} critical issue(s) require immediate attention. `;
    }
    if (highCount > 0) {
      summary += `${highCount} high-severity issue(s) detected. `;
    }

    summary += `Overall adversarial score: ${(score * 100).toFixed(1)}%. `;

    if (score > 0.7) {
      summary += 'Recommend thorough review before proceeding.';
    } else if (score > 0.5) {
      summary += 'Some concerns warrant attention.';
    } else if (score > 0.3) {
      summary += 'Minor issues detected; consider addressing.';
    } else {
      summary += 'Low-risk; proceed with standard review.';
    }

    return summary;
  }

  /**
   * Simple string similarity using Jaccard index on word tokens.
   */
  private stringSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2));

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) intersection++;
    }

    const union = new Set([...wordsA, ...wordsB]).size;
    return intersection / union;
  }
}

// ============================================================================
// QUALITY GATES INTEGRATION
// ============================================================================

/**
 * Convert adversarial behavior report to quality gate compatible format.
 * This enables integration with the course correction system.
 */
export function convertToGateViolations(
  report: AdversarialBehaviorReport
): Array<{
  criterionId: string;
  description: string;
  severity: 'minor' | 'major' | 'critical';
  score: number;
  threshold: number;
  explanation: string;
}> {
  return report.detections.map(detection => ({
    criterionId: `adversarial_${detection.category}`,
    description: `Adversarial behavior: ${detection.category.replace(/_/g, ' ')}`,
    severity: detection.severity === 'critical' ? 'critical' :
              detection.severity === 'high' ? 'major' : 'minor',
    score: 1 - detection.confidence, // Invert: higher confidence in detection = lower score
    threshold: 0.7,
    explanation: detection.explanation,
  }));
}

/**
 * Convert behavior remediations to quality gate remediation format.
 */
export function convertToGateRemediations(
  report: AdversarialBehaviorReport
): Array<{
  id: string;
  description: string;
  type: 'clarify' | 'adjust' | 'rollback' | 'pivot' | 'abort' | 'hotfix';
  effort: 'trivial' | 'low' | 'medium' | 'high' | 'critical';
  steps: string[];
  addressesViolations: string[];
}> {
  return report.remediations.map(remediation => ({
    id: remediation.id,
    description: remediation.description,
    type: remediation.type === 'escalate' ? 'clarify' : remediation.type, // Map escalate to clarify
    effort: remediation.effort,
    steps: remediation.steps,
    addressesViolations: remediation.addressesDetections.map(
      id => `adversarial_${report.detections.find(d => d.id === id)?.category || 'unknown'}`
    ),
  }));
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create an AdversarialBehaviorDetector instance
 */
export function createAdversarialBehaviorDetector(): AdversarialBehaviorDetector {
  return new AdversarialBehaviorDetector();
}
