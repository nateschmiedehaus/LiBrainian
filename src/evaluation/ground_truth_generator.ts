/**
 * @fileoverview Ground Truth Generator
 *
 * Automatically generates machine-verifiable query/answer pairs for evaluation
 * using AST facts extracted from source code. Each generated query has:
 * - A natural language question
 * - An expected answer with type (exact, contains, exists, count)
 * - Evidence (the AST facts that prove the answer)
 *
 * @packageDocumentation
 */

import {
  ASTFactExtractor,
  createASTFactExtractor,
  type ASTFact,
  type FunctionDefDetails,
  type ImportDetails,
  type ClassDetails,
  type CallDetails,
} from './ast_fact_extractor.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A query category based on what aspect of code it tests
 */
export type StructuralQueryCategory = 'structural' | 'behavioral' | 'architectural';

/**
 * Query difficulty level
 */
export type StructuralQueryDifficulty = 'easy' | 'medium' | 'hard';

/**
 * Type of expected answer verification
 */
export type AnswerType = 'exact' | 'contains' | 'exists' | 'count';

/**
 * Expected answer for a ground truth query
 */
export interface StructuralGroundTruthAnswer {
  /** How to verify the answer */
  type: AnswerType;
  /** The expected value */
  value: string | string[] | number | boolean;
  /** AST facts that prove this answer */
  evidence: ASTFact[];
}

/**
 * A machine-verifiable ground truth query
 */
export interface StructuralGroundTruthQuery {
  /** Unique identifier for this query */
  id: string;
  /** Natural language question */
  query: string;
  /** What category of knowledge this tests */
  category: StructuralQueryCategory;
  /** How difficult this query is */
  difficulty: StructuralQueryDifficulty;
  /** The expected answer with evidence */
  expectedAnswer: StructuralGroundTruthAnswer;
}

/**
 * Coverage statistics for generated ground truth
 */
export interface GroundTruthCoverage {
  /** Number of functions covered */
  functions: number;
  /** Number of classes covered */
  classes: number;
  /** Number of imports covered */
  imports: number;
  /** Number of exports covered */
  exports: number;
}

/**
 * Complete ground truth corpus for a repository
 */
export interface StructuralGroundTruthCorpus {
  /** Name of the repository */
  repoName: string;
  /** Path to the repository */
  repoPath: string;
  /** When the corpus was generated (ISO timestamp) */
  generatedAt: string;
  /** Generated queries */
  queries: StructuralGroundTruthQuery[];
  /** Total number of facts extracted */
  factCount: number;
  /** Coverage statistics */
  coverage: GroundTruthCoverage;
}

// ============================================================================
// GROUND TRUTH GENERATOR
// ============================================================================

/**
 * Generates machine-verifiable ground truth queries from AST facts
 */
export class GroundTruthGenerator {
  private extractor: ASTFactExtractor;

  constructor(extractor?: ASTFactExtractor) {
    this.extractor = extractor ?? createASTFactExtractor();
  }

  /**
   * Generate ground truth corpus for a repository
   */
  async generateForRepo(repoPath: string, repoName: string): Promise<StructuralGroundTruthCorpus> {
    // Reset counter for deterministic ID generation
    this.idCounter = 0;
    const facts = await this.extractor.extractFromDirectory(repoPath);

    if (facts.length === 0) {
      return {
        repoName,
        repoPath,
        generatedAt: new Date().toISOString(),
        queries: [],
        factCount: 0,
        coverage: {
          functions: 0,
          classes: 0,
          imports: 0,
          exports: 0,
        },
      };
    }

    const queries: StructuralGroundTruthQuery[] = [
      ...this.generateFunctionQueries(facts),
      ...this.generateImportQueries(facts),
      ...this.generateClassQueries(facts),
      ...this.generateCallGraphQueries(facts),
    ];

    const coverage = this.computeCoverage(facts);

    return {
      repoName,
      repoPath,
      generatedAt: new Date().toISOString(),
      queries,
      factCount: facts.length,
      coverage,
    };
  }

  /**
   * Generate queries about functions
   */
  generateFunctionQueries(facts: ASTFact[]): StructuralGroundTruthQuery[] {
    const queries: StructuralGroundTruthQuery[] = [];
    const functionFacts = facts.filter((f) => f.type === 'function_def');

    if (functionFacts.length === 0) {
      return [];
    }

    // Group functions by file
    const byFile = this.groupByFile(functionFacts);

    // Generate per-file count queries
    for (const [file, fileFacts] of Object.entries(byFile)) {
      const fileName = this.getFileName(file);
      queries.push({
        id: this.generateId('func-count', file),
        query: `How many functions are in file ${fileName}?`,
        category: 'structural',
        difficulty: 'easy',
        expectedAnswer: {
          type: 'count',
          value: fileFacts.length,
          evidence: fileFacts,
        },
      });
    }

    // Generate per-function queries
    for (const fact of functionFacts) {
      const details = fact.details as FunctionDefDetails;
      const funcName = fact.identifier;

      // Parameter query
      if (details.parameters && details.parameters.length > 0) {
        const paramNames = details.parameters.map((p) => p.name);
        queries.push({
          id: this.generateId('func-params', funcName),
          query: `What parameters does function ${funcName} accept?`,
          category: 'structural',
          difficulty: 'easy',
          expectedAnswer: {
            type: 'exact',
            value: paramNames,
            evidence: [fact],
          },
        });

        // Individual parameter type query
        for (const param of details.parameters) {
          if (param.type) {
            queries.push({
              id: this.generateId('func-param-type', `${funcName}-${param.name}`),
              query: `What is the type of parameter ${param.name} in function ${funcName}?`,
              category: 'structural',
              difficulty: 'medium',
              expectedAnswer: {
                type: 'exact',
                value: param.type,
                evidence: [fact],
              },
            });
          }
        }
      }

      // Return type query
      if (details.returnType) {
        queries.push({
          id: this.generateId('func-return', funcName),
          query: `What does function ${funcName} return?`,
          category: 'structural',
          difficulty: 'easy',
          expectedAnswer: {
            type: 'exact',
            value: details.returnType,
            evidence: [fact],
          },
        });
      }

      // Async query
      queries.push({
        id: this.generateId('func-async', funcName),
        query: `Is function ${funcName} async?`,
        category: 'structural',
        difficulty: 'easy',
        expectedAnswer: {
          type: 'exists',
          value: details.isAsync ?? false,
          evidence: [fact],
        },
      });

      // Export query
      queries.push({
        id: this.generateId('func-exported', funcName),
        query: `Is function ${funcName} exported?`,
        category: 'structural',
        difficulty: 'easy',
        expectedAnswer: {
          type: 'exists',
          value: details.isExported ?? false,
          evidence: [fact],
        },
      });

      // Class method query
      if (details.className) {
        queries.push({
          id: this.generateId('func-class', funcName),
          query: `What class does method ${funcName} belong to?`,
          category: 'structural',
          difficulty: 'easy',
          expectedAnswer: {
            type: 'exact',
            value: details.className,
            evidence: [fact],
          },
        });
      }
    }

    // Generate async function count query
    const asyncFunctions = functionFacts.filter((f) => (f.details as FunctionDefDetails).isAsync);
    if (asyncFunctions.length > 0) {
      queries.push({
        id: this.generateId('async-count', 'total'),
        query: 'How many async functions are there in total?',
        category: 'structural',
        difficulty: 'medium',
        expectedAnswer: {
          type: 'count',
          value: asyncFunctions.length,
          evidence: asyncFunctions,
        },
      });
    }

    return queries;
  }

  /**
   * Generate queries about imports
   */
  generateImportQueries(facts: ASTFact[]): StructuralGroundTruthQuery[] {
    const queries: StructuralGroundTruthQuery[] = [];
    const importFacts = facts.filter((f) => f.type === 'import');

    if (importFacts.length === 0) {
      return [];
    }

    // Group imports by file
    const byFile = this.groupByFile(importFacts);

    for (const [file, fileFacts] of Object.entries(byFile)) {
      const fileName = this.getFileName(file);

      // What modules does file import
      const sources = fileFacts.map((f) => (f.details as ImportDetails).source);
      queries.push({
        id: this.generateId('import-modules', file),
        query: `What modules does file ${fileName} import?`,
        category: 'structural',
        difficulty: 'easy',
        expectedAnswer: {
          type: 'contains',
          value: sources,
          evidence: fileFacts,
        },
      });

      // Individual import queries
      for (const fact of fileFacts) {
        const details = fact.details as ImportDetails;

        // Where is this imported from
        queries.push({
          id: this.generateId('import-source', `${file}-${fact.identifier}`),
          query: `Where is ${fact.identifier} imported from in ${fileName}?`,
          category: 'structural',
          difficulty: 'easy',
          expectedAnswer: {
            type: 'exact',
            value: details.source,
            evidence: [fact],
          },
        });

        // Boolean check for specific import
        queries.push({
          id: this.generateId('import-exists', `${file}-${fact.identifier}`),
          query: `Does file ${fileName} import ${fact.identifier}?`,
          category: 'structural',
          difficulty: 'easy',
          expectedAnswer: {
            type: 'exists',
            value: true,
            evidence: [fact],
          },
        });

        // Specifiers query
        if (details.specifiers && details.specifiers.length > 0) {
          const specifierNames = details.specifiers.map((s) => s.name);
          queries.push({
            id: this.generateId('import-specifiers', `${file}-${details.source}`),
            query: `What specifiers are imported from ${details.source} in ${fileName}?`,
            category: 'structural',
            difficulty: 'medium',
            expectedAnswer: {
              type: 'contains',
              value: specifierNames,
              evidence: [fact],
            },
          });
        }
      }
    }

    return queries;
  }

  /**
   * Generate queries about classes
   */
  generateClassQueries(facts: ASTFact[]): StructuralGroundTruthQuery[] {
    const queries: StructuralGroundTruthQuery[] = [];
    const classFacts = facts.filter((f) => f.type === 'class');

    if (classFacts.length === 0) {
      return [];
    }

    // Group classes by file
    const byFile = this.groupByFile(classFacts);

    // Per-file class count
    for (const [file, fileFacts] of Object.entries(byFile)) {
      const fileName = this.getFileName(file);
      queries.push({
        id: this.generateId('class-count', file),
        query: `How many classes are in file ${fileName}?`,
        category: 'structural',
        difficulty: 'easy',
        expectedAnswer: {
          type: 'count',
          value: fileFacts.length,
          evidence: fileFacts,
        },
      });
    }

    // Per-class queries
    for (const fact of classFacts) {
      const details = fact.details as ClassDetails;
      const className = fact.identifier;

      // Extends query
      if (details.extends) {
        queries.push({
          id: this.generateId('class-extends', className),
          query: `What class does ${className} extend?`,
          category: 'structural',
          difficulty: 'easy',
          expectedAnswer: {
            type: 'exact',
            value: details.extends,
            evidence: [fact],
          },
        });
      }

      // Implements query
      if (details.implements && details.implements.length > 0) {
        queries.push({
          id: this.generateId('class-implements', className),
          query: `What interfaces does class ${className} implement?`,
          category: 'structural',
          difficulty: 'medium',
          expectedAnswer: {
            type: 'contains',
            value: details.implements,
            evidence: [fact],
          },
        });
      }

      // Methods query
      if (details.methods && details.methods.length > 0) {
        queries.push({
          id: this.generateId('class-methods', className),
          query: `What methods does class ${className} have?`,
          category: 'structural',
          difficulty: 'easy',
          expectedAnswer: {
            type: 'contains',
            value: details.methods,
            evidence: [fact],
          },
        });

        // Method count
        queries.push({
          id: this.generateId('class-method-count', className),
          query: `How many methods does class ${className} have?`,
          category: 'structural',
          difficulty: 'easy',
          expectedAnswer: {
            type: 'count',
            value: details.methods.length,
            evidence: [fact],
          },
        });
      }

      // Properties query
      if (details.properties && details.properties.length > 0) {
        queries.push({
          id: this.generateId('class-properties', className),
          query: `What properties does class ${className} have?`,
          category: 'structural',
          difficulty: 'medium',
          expectedAnswer: {
            type: 'contains',
            value: details.properties,
            evidence: [fact],
          },
        });
      }

      // Abstract query
      queries.push({
        id: this.generateId('class-abstract', className),
        query: `Is class ${className} abstract?`,
        category: 'structural',
        difficulty: 'easy',
        expectedAnswer: {
          type: 'exists',
          value: details.isAbstract ?? false,
          evidence: [fact],
        },
      });
    }

    return queries;
  }

  /**
   * Generate queries about call relationships
   */
  generateCallGraphQueries(facts: ASTFact[]): StructuralGroundTruthQuery[] {
    const queries: StructuralGroundTruthQuery[] = [];
    const callFacts = facts.filter((f) => f.type === 'call');

    if (callFacts.length === 0) {
      return [];
    }

    // Group by caller
    const byCaller: Record<string, ASTFact[]> = {};
    for (const fact of callFacts) {
      const details = fact.details as CallDetails;
      const caller = details.caller;
      if (!byCaller[caller]) {
        byCaller[caller] = [];
      }
      byCaller[caller].push(fact);
    }

    // Generate what-does-X-call queries
    for (const [caller, callerFacts] of Object.entries(byCaller)) {
      const callees = callerFacts.map((f) => (f.details as CallDetails).callee);
      const uniqueCallees = [...new Set(callees)];

      queries.push({
        id: this.generateId('calls-from', caller),
        query: `What functions does ${caller} call?`,
        category: 'behavioral',
        difficulty: 'medium',
        expectedAnswer: {
          type: 'contains',
          value: uniqueCallees,
          evidence: callerFacts,
        },
      });

      // Boolean queries for specific call relationships
      for (const callee of uniqueCallees.slice(0, 3)) {
        // Limit to avoid explosion
        queries.push({
          id: this.generateId('calls-check', `${caller}-${callee}`),
          query: `Does ${caller} call ${callee}?`,
          category: 'behavioral',
          difficulty: 'easy',
          expectedAnswer: {
            type: 'exists',
            value: true,
            evidence: callerFacts.filter((f) => (f.details as CallDetails).callee === callee),
          },
        });
      }
    }

    // Group by callee to find callers
    const byCallee: Record<string, ASTFact[]> = {};
    for (const fact of callFacts) {
      const details = fact.details as CallDetails;
      const callee = details.callee;
      if (!byCallee[callee]) {
        byCallee[callee] = [];
      }
      byCallee[callee].push(fact);
    }

    // Generate what-calls-X queries
    for (const [callee, calleeFacts] of Object.entries(byCallee)) {
      const callers = calleeFacts.map((f) => (f.details as CallDetails).caller);
      const uniqueCallers = [...new Set(callers)];

      // Skip common utility functions with too many callers
      if (uniqueCallers.length > 10) continue;

      queries.push({
        id: this.generateId('called-by', callee),
        query: `What functions or methods are callers of ${callee}? (Who called by ${callee})`,
        category: 'behavioral',
        difficulty: 'hard',
        expectedAnswer: {
          type: 'contains',
          value: uniqueCallers,
          evidence: calleeFacts,
        },
      });
    }

    return queries;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private computeCoverage(facts: ASTFact[]): GroundTruthCoverage {
    return {
      functions: facts.filter((f) => f.type === 'function_def').length,
      classes: facts.filter((f) => f.type === 'class').length,
      imports: facts.filter((f) => f.type === 'import').length,
      exports: facts.filter((f) => f.type === 'export').length,
    };
  }

  private groupByFile(facts: ASTFact[]): Record<string, ASTFact[]> {
    const byFile: Record<string, ASTFact[]> = {};
    for (const fact of facts) {
      if (!byFile[fact.file]) {
        byFile[fact.file] = [];
      }
      byFile[fact.file].push(fact);
    }
    return byFile;
  }

  private getFileName(filePath: string): string {
    const parts = filePath.split('/');
    return parts[parts.length - 1];
  }

  private idCounter = 0;

  private generateId(prefix: string, identifier: string): string {
    // Create a deterministic, URL-safe ID with counter to ensure uniqueness
    const sanitized = identifier.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const hash = this.simpleHash(`${prefix}-${identifier}`);
    this.idCounter++;
    return `${prefix}-${sanitized.slice(0, 30)}-${hash}-${this.idCounter}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36).slice(0, 8);
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new GroundTruthGenerator instance
 */
export function createGroundTruthGenerator(extractor?: ASTFactExtractor): GroundTruthGenerator {
  return new GroundTruthGenerator(extractor);
}
