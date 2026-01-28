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
