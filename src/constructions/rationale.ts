/**
 * @fileoverview Rationale Construction for WHY Questions
 *
 * This construction provides the ability to answer WHY questions about
 * design decisions, technology choices, and architectural rationale.
 *
 * Problem solved:
 * - Queries like "Why use SQLite instead of PostgreSQL" return code that
 *   USES SQLite, not the RATIONALE for choosing it.
 * - Current semantic search finds implementations, not design justifications.
 *
 * Solution:
 * - Create a dedicated RationaleIndex that collects and indexes rationale
 *   from multiple sources (ADRs, comments, commit messages, code patterns)
 * - Detect WHY queries and route them to rationale lookup FIRST
 * - Generate inferred rationale when no explicit documentation exists
 *
 * @packageDocumentation
 */

import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { Librarian } from '../api/librarian.js';
import type { LibrarianStorage } from '../storage/types.js';
import type { AdrRecord } from '../ingest/adr_indexer.js';
import type { ContextPack } from '../types.js';
import type { ConfidenceValue, DerivedConfidence } from '../epistemics/confidence.js';
import { getNumericValue } from '../epistemics/confidence.js';
import { BaseConstruction, type ConstructionResult } from './base/construction_base.js';

// ============================================================================
// COMMIT RATIONALE EXTRACTION
// ============================================================================

/**
 * Rationale extracted from a git commit message.
 */
export interface CommitRationale {
  /** Git commit hash */
  hash: string;
  /** Full commit message */
  message: string;
  /** Commit author */
  author: string;
  /** Commit date (ISO format) */
  date: string;
  /** Extracted rationale text */
  rationale: string;
  /** Files affected by this commit */
  affectedFiles: string[];
  /** Type of decision documented in the commit */
  decisionType: 'why' | 'tradeoff' | 'alternative' | 'constraint' | 'general';
}

/**
 * Patterns that indicate rationale in commit messages.
 * These patterns capture common ways developers explain "why" in commits.
 */
const COMMIT_RATIONALE_PATTERNS = [
  /because\s+(.+)/i,
  /in order to\s+(.+)/i,
  /this is needed for\s+(.+)/i,
  /changed from .+ to .+ (because|since|as)\s+(.+)/i,
  /chose .+ over .+ (because|since|as)\s+(.+)/i,
  /trade-?off:\s*(.+)/i,
  /decision:\s*(.+)/i,
  /rationale:\s*(.+)/i,
  /reason:\s*(.+)/i,
  /why:\s*(.+)/i,
];

/**
 * Detect the type of decision documented in a commit message.
 *
 * @param message - The commit message to analyze
 * @returns The decision type classification
 */
function detectCommitDecisionType(message: string): CommitRationale['decisionType'] {
  if (/trade-?off|versus|vs\.|instead of/i.test(message)) return 'tradeoff';
  if (/alternative|option|could have|might have/i.test(message)) return 'alternative';
  if (/constraint|must|requirement|required/i.test(message)) return 'constraint';
  if (/because|since|reason|why/i.test(message)) return 'why';
  return 'general';
}

/**
 * Extract rationale from git commit messages.
 *
 * This function analyzes recent commits looking for messages that explain
 * "why" decisions were made, not just "what" was changed.
 *
 * @param workspace - The workspace/git repository root
 * @param limit - Maximum number of commits to analyze (default 200)
 * @returns Array of commits containing rationale
 */
export async function extractCommitRationale(workspace: string, limit: number = 200): Promise<CommitRationale[]> {
  const rationales: CommitRationale[] = [];

  try {
    // Get recent commits with full messages
    // Format: hash|author|date|subject, followed by body, then delimiter
    const output = execSync(
      `git log --pretty=format:"%H|%an|%ad|%s%n%b|||COMMIT_END|||" --date=short -n ${limit}`,
      { cwd: workspace, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );

    const commits = output.split('|||COMMIT_END|||').filter(Boolean);

    for (const commitBlock of commits) {
      const lines = commitBlock.trim().split('\n');
      if (lines.length === 0) continue;

      const [headerLine, ...bodyLines] = lines;
      if (!headerLine) continue;

      const parts = headerLine.split('|');
      const hash = parts[0] ?? '';
      const author = parts[1] ?? '';
      const date = parts[2] ?? '';
      const subject = parts[3] ?? '';

      const body = bodyLines.join('\n');
      const fullMessage = `${subject}\n${body}`;

      // Check for rationale patterns
      for (const pattern of COMMIT_RATIONALE_PATTERNS) {
        const match = fullMessage.match(pattern);
        if (match) {
          const rationale = match[2] || match[1] || match[0];

          // Get affected files for this commit
          let affectedFiles: string[] = [];
          try {
            const filesOutput = execSync(`git show --name-only --pretty=format: ${hash}`,
              { cwd: workspace, encoding: 'utf-8' });
            affectedFiles = filesOutput.trim().split('\n').filter(Boolean);
          } catch {
            // Ignore errors fetching file list
          }

          rationales.push({
            hash,
            message: fullMessage.trim(),
            author,
            date,
            rationale: rationale.trim(),
            affectedFiles,
            decisionType: detectCommitDecisionType(fullMessage),
          });
          break; // One rationale per commit
        }
      }
    }
  } catch {
    // Not a git repo or git not available - silently return empty
  }

  return rationales;
}

/**
 * Convert commit rationale to a rationale entry for the index.
 *
 * @param commit - The commit rationale to convert
 * @returns A RationaleEntry suitable for the index
 */
function commitRationaleToEntry(commit: CommitRationale): RationaleEntry {
  // Extract a topic from the commit - use the first affected file's directory or the decision type
  const topic = commit.affectedFiles.length > 0
    ? commit.affectedFiles[0].split('/')[0] ?? commit.decisionType
    : commit.decisionType;

  return {
    topic,
    reasoning: commit.rationale,
    source: 'commit_message',
    confidence: 0.75, // Commits are reasonably reliable but less formal than ADRs
    sourcePath: commit.affectedFiles[0],
    context: `Commit ${commit.hash.slice(0, 8)} by ${commit.author} on ${commit.date}: ${commit.message.split('\n')[0]}`,
  };
}

/**
 * Create a derived confidence value for rationale results.
 *
 * This follows the epistemic framework by creating a DerivedConfidence
 * with proper provenance.
 */
function createRationaleConfidence(
  value: number,
  formula: string,
  source: 'explicit_rationale' | 'inferred_rationale'
): DerivedConfidence {
  return {
    type: 'derived',
    value: Math.max(0, Math.min(1, value)),
    formula,
    inputs: [
      {
        name: source,
        confidence: {
          type: 'deterministic',
          value: value >= 0.5 ? 1.0 : 0.0,
          reason: source,
        },
      },
    ],
  };
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Sources of rationale information.
 *
 * - 'adr': Explicit Architecture Decision Record
 * - 'readme': README or documentation file
 * - 'comment': Code comment with rationale
 * - 'commit_message': Git commit explaining why
 * - 'inferred': Inferred from code patterns
 */
export type RationaleSource = 'adr' | 'readme' | 'comment' | 'commit_message' | 'inferred';

/**
 * A single piece of rationale information.
 */
export interface RationaleEntry {
  /** The topic this rationale addresses (e.g., "SQLite", "storage backend") */
  topic: string;
  /** The reasoning or justification */
  reasoning: string;
  /** Where this rationale came from */
  source: RationaleSource;
  /** Confidence in this rationale (0-1) */
  confidence: number;
  /** Optional path to source file */
  sourcePath?: string;
  /** Optional line number in source */
  sourceLine?: number;
  /** Optional related context */
  context?: string;
}

/**
 * Result of a WHY query.
 */
export interface RationaleAnswer {
  /** The original question */
  question: string;
  /** Whether we found explicit rationale */
  hasExplicitRationale: boolean;
  /** All relevant rationale entries */
  entries: RationaleEntry[];
  /** Summary answer (human-readable) */
  summary: string;
  /** Overall confidence in the answer */
  confidence: number;
  /** Any caveats or limitations */
  caveats: string[];
}

/**
 * Input for the rationale construction.
 */
export interface RationaleInput {
  /** The WHY question to answer */
  question: string;
  /** Optional topic hints extracted from the question */
  topics?: string[];
  /** Maximum entries to return */
  maxEntries?: number;
}

/**
 * Output from the rationale construction.
 */
export interface RationaleResult extends ConstructionResult {
  /** The answer to the WHY question */
  answer: RationaleAnswer;
  /** Related context packs */
  relatedPacks: ContextPack[];
}

// ============================================================================
// WHY QUERY DETECTION
// ============================================================================

/**
 * Pattern for detecting WHY queries that need rationale routing.
 *
 * Matches questions like:
 * - "Why use SQLite instead of PostgreSQL?"
 * - "Why does this project use TypeScript?"
 * - "Why did we choose React?"
 * - "Why is there a singleton pattern here?"
 */
export const WHY_QUERY_PATTERN = /\bwhy\b.*\b(use[ds]?|choose|chose|chosen|have|is|are|does|did|was|were|prefer|pick|select|adopt|implement|went\s+with)\b/i;

/**
 * Secondary patterns for technology choice questions.
 */
const TECHNOLOGY_CHOICE_PATTERNS = [
  /\bwhy\b.*\binstead\s+of\b/i,        // "why X instead of Y"
  /\bwhy\b.*\bover\b/i,                // "why X over Y"
  /\bwhy\b.*\brather\s+than\b/i,       // "why X rather than Y"
  /\bwhy\b.*\bnot\b.*\b(use|have)\b/i, // "why not use X"
  /\breason(s)?\s+for\b/i,             // "reasons for using X"
  /\brationale\s+(for|behind)\b/i,     // "rationale for X"
  /\bjustification\s+for\b/i,          // "justification for X"
];

/**
 * Detect if a query is asking about rationale/reasons.
 *
 * @param query - The query text
 * @returns True if this is a WHY question
 */
export function isWhyQuery(query: string): boolean {
  if (WHY_QUERY_PATTERN.test(query)) {
    return true;
  }
  return TECHNOLOGY_CHOICE_PATTERNS.some(pattern => pattern.test(query));
}

/**
 * Classification result for WHY queries.
 */
export interface WhyQueryClassification {
  isWhyQuery: boolean;
  confidence: number;
  /** Primary topic being asked about */
  topic: string | null;
  /** Comparison topic (if "why X instead of Y") */
  comparisonTopic: string | null;
  /** Type of WHY question */
  questionType: 'technology_choice' | 'design_decision' | 'implementation' | 'general';
}

/**
 * Classify a WHY query to extract topic and type.
 *
 * @param query - The query text
 * @returns Classification details
 */
export function classifyWhyQuery(query: string): WhyQueryClassification {
  const isWhy = isWhyQuery(query);
  if (!isWhy) {
    return {
      isWhyQuery: false,
      confidence: 0,
      topic: null,
      comparisonTopic: null,
      questionType: 'general',
    };
  }

  // Extract primary topic
  const topicPatterns = [
    /why\s+(?:use|choose|chose|have|is|does|did)\s+([A-Za-z0-9_-]+)/i,
    /why\s+([A-Za-z0-9_-]+)\s+(?:instead|over|rather)/i,
    /why\s+not\s+(?:use|have)\s+([A-Za-z0-9_-]+)/i,
  ];

  let topic: string | null = null;
  for (const pattern of topicPatterns) {
    const match = pattern.exec(query);
    if (match?.[1]) {
      topic = match[1];
      break;
    }
  }

  // Extract comparison topic
  const comparisonPatterns = [
    /instead\s+of\s+([A-Za-z0-9_-]+)/i,
    /over\s+([A-Za-z0-9_-]+)/i,
    /rather\s+than\s+([A-Za-z0-9_-]+)/i,
  ];

  let comparisonTopic: string | null = null;
  for (const pattern of comparisonPatterns) {
    const match = pattern.exec(query);
    if (match?.[1]) {
      comparisonTopic = match[1];
      break;
    }
  }

  // Determine question type
  let questionType: WhyQueryClassification['questionType'] = 'general';
  const techKeywords = ['sqlite', 'postgres', 'mysql', 'mongodb', 'redis', 'react', 'vue', 'angular',
    'typescript', 'javascript', 'python', 'rust', 'go', 'java', 'graphql', 'rest', 'grpc'];

  if (topic && techKeywords.some(tech => topic!.toLowerCase().includes(tech))) {
    questionType = 'technology_choice';
  } else if (/pattern|design|architecture|approach/i.test(query)) {
    questionType = 'design_decision';
  } else if (/implementation|code|function|method/i.test(query)) {
    questionType = 'implementation';
  }

  // Calculate confidence based on match quality
  let confidence = 0.6;
  if (topic) confidence += 0.2;
  if (comparisonTopic) confidence += 0.1;
  if (questionType !== 'general') confidence += 0.1;

  return {
    isWhyQuery: true,
    confidence: Math.min(confidence, 1.0),
    topic,
    comparisonTopic,
    questionType,
  };
}

// ============================================================================
// RATIONALE INDEX
// ============================================================================

/**
 * Index for storing and querying rationale information.
 *
 * The index aggregates rationale from multiple sources:
 * 1. ADR documents (highest confidence)
 * 2. README/documentation files
 * 3. Code comments with @reason, @rationale, @why tags
 * 4. Commit messages explaining decisions
 * 5. Inferred rationale from code patterns
 */
export class RationaleIndex {
  private entries: RationaleEntry[] = [];
  private topicIndex = new Map<string, RationaleEntry[]>();

  constructor(
    private storage: LibrarianStorage,
    private workspace?: string
  ) {}

  /**
   * Initialize the index by loading rationale from storage, code comments, and git history.
   *
   * @param options - Optional configuration for initialization
   * @param options.commitLimit - Maximum number of commits to analyze (default 200)
   * @param options.extractComments - Whether to extract rationale from code comments (default true)
   */
  async initialize(options?: { commitLimit?: number; extractComments?: boolean }): Promise<void> {
    // Load ADR records from ingestion items
    const adrItems = await this.storage.getIngestionItems({ sourceType: 'adr' });
    for (const item of adrItems) {
      const adr = item.payload as AdrRecord;
      if (adr.decision || adr.context) {
        const entry = this.adrToRationaleEntry(adr);
        this.addEntry(entry);
      }
    }

    // Extract rationale from code comments in indexed files
    const shouldExtractComments = options?.extractComments !== false;
    if (shouldExtractComments) {
      const files = await this.storage.getFiles({ category: 'code', limit: 5000 });
      for (const file of files) {
        try {
          const content = await readFile(file.path, 'utf-8');
          const commentRationale = extractRationaleFromComments(content, file.path);
          for (const entry of commentRationale) {
            this.addEntry(entry);
          }
        } catch {
          // File may have been deleted or is unreadable - skip silently
        }
      }
    }

    // Load rationale from git commit messages
    if (this.workspace) {
      const commitLimit = options?.commitLimit ?? 200;
      const commitRationales = await extractCommitRationale(this.workspace, commitLimit);
      for (const commit of commitRationales) {
        const entry = commitRationaleToEntry(commit);
        this.addEntry(entry);
      }
    }

    // Build topic index
    this.rebuildTopicIndex();
  }

  /**
   * Convert an ADR record to a rationale entry.
   */
  private adrToRationaleEntry(adr: AdrRecord): RationaleEntry {
    // Extract the main topic from the ADR title
    const topic = this.extractTopicFromTitle(adr.title);

    // Build reasoning from decision and context
    let reasoning = '';
    if (adr.decision) {
      reasoning = adr.decision;
    }
    if (adr.context && adr.context !== adr.decision) {
      reasoning = reasoning ? `${reasoning}\n\nContext: ${adr.context}` : adr.context;
    }
    if (adr.consequences) {
      reasoning = reasoning ? `${reasoning}\n\nConsequences: ${adr.consequences}` : adr.consequences;
    }

    return {
      topic,
      reasoning: reasoning || adr.summary,
      source: 'adr',
      confidence: 0.9, // ADRs are high confidence
      sourcePath: adr.path,
      context: adr.title,
    };
  }

  /**
   * Extract a searchable topic from an ADR title.
   */
  private extractTopicFromTitle(title: string): string {
    // Remove common prefixes like "ADR-001:" or "Use X for Y"
    const cleaned = title
      .replace(/^(ADR[-\s]?\d+[:\s]*)/i, '')
      .replace(/^(use|choose|adopt|implement)\s+/i, '')
      .trim();

    // Extract the main subject
    const words = cleaned.split(/\s+/).slice(0, 5);
    return words.join(' ').toLowerCase();
  }

  /**
   * Add a rationale entry to the index.
   */
  addEntry(entry: RationaleEntry): void {
    this.entries.push(entry);
    this.indexByTopic(entry);
  }

  /**
   * Index an entry by its topic.
   */
  private indexByTopic(entry: RationaleEntry): void {
    const normalizedTopic = entry.topic.toLowerCase();
    const existing = this.topicIndex.get(normalizedTopic) || [];
    existing.push(entry);
    this.topicIndex.set(normalizedTopic, existing);

    // Also index individual words for fuzzy matching
    const words = normalizedTopic.split(/\s+/);
    for (const word of words) {
      if (word.length > 2) {
        const existing = this.topicIndex.get(word) || [];
        existing.push(entry);
        this.topicIndex.set(word, existing);
      }
    }
  }

  /**
   * Rebuild the topic index.
   */
  private rebuildTopicIndex(): void {
    this.topicIndex.clear();
    for (const entry of this.entries) {
      this.indexByTopic(entry);
    }
  }

  /**
   * Find rationale entries for a given topic.
   *
   * @param topic - The topic to search for
   * @returns Matching rationale entries, sorted by confidence
   */
  findRationaleFor(topic: string): RationaleEntry[] {
    const normalizedTopic = topic.toLowerCase();
    const results = new Set<RationaleEntry>();

    // Direct topic match
    const direct = this.topicIndex.get(normalizedTopic) || [];
    for (const entry of direct) {
      results.add(entry);
    }

    // Word-level matches
    const words = normalizedTopic.split(/\s+/);
    for (const word of words) {
      if (word.length > 2) {
        const matches = this.topicIndex.get(word) || [];
        for (const entry of matches) {
          results.add(entry);
        }
      }
    }

    // Fuzzy matching: check if topic contains the query
    for (const entry of this.entries) {
      if (entry.topic.includes(normalizedTopic) || normalizedTopic.includes(entry.topic)) {
        results.add(entry);
      }
    }

    // Sort by confidence
    return Array.from(results).sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Answer a WHY question.
   *
   * @param question - The WHY question
   * @returns The answer with rationale entries
   */
  answerWhy(question: string): RationaleAnswer {
    const classification = classifyWhyQuery(question);

    if (!classification.isWhyQuery) {
      return {
        question,
        hasExplicitRationale: false,
        entries: [],
        summary: 'This does not appear to be a WHY question.',
        confidence: 0.1,
        caveats: ['Query does not match WHY question patterns'],
      };
    }

    const entries: RationaleEntry[] = [];
    const caveats: string[] = [];

    // Find rationale for primary topic
    if (classification.topic) {
      const topicEntries = this.findRationaleFor(classification.topic);
      entries.push(...topicEntries);
    }

    // Find rationale for comparison topic
    if (classification.comparisonTopic) {
      const comparisonEntries = this.findRationaleFor(classification.comparisonTopic);
      // Add comparison entries that might explain "why not X"
      for (const entry of comparisonEntries) {
        if (!entries.includes(entry)) {
          entries.push(entry);
        }
      }
    }

    // Check if we found explicit rationale
    const hasExplicitRationale = entries.some(e => e.source !== 'inferred');

    // Build summary
    let summary: string;
    if (entries.length === 0) {
      summary = `No explicit rationale found for: "${question}"`;
      caveats.push('No ADRs, documentation, or comments explain this decision');
    } else if (hasExplicitRationale) {
      const topEntry = entries[0];
      summary = topEntry.reasoning;
      if (entries.length > 1) {
        summary += ` (${entries.length - 1} additional rationale sources found)`;
      }
    } else {
      summary = 'Only inferred rationale available: ' + entries[0].reasoning;
      caveats.push('No explicit documentation found - rationale was inferred from code patterns');
    }

    // Calculate overall confidence
    let confidence = 0.3; // Base confidence
    if (entries.length > 0) {
      const avgConfidence = entries.reduce((sum, e) => sum + e.confidence, 0) / entries.length;
      confidence = avgConfidence;
    }
    if (!hasExplicitRationale && entries.length > 0) {
      confidence *= 0.7; // Reduce confidence for inferred-only rationale
    }

    return {
      question,
      hasExplicitRationale,
      entries: entries.slice(0, 10), // Limit to top 10
      summary,
      confidence,
      caveats,
    };
  }

  /**
   * Get all entries in the index.
   */
  getAllEntries(): RationaleEntry[] {
    return [...this.entries];
  }

  /**
   * Get the number of entries in the index.
   */
  get size(): number {
    return this.entries.length;
  }
}

// ============================================================================
// INFERRED RATIONALE
// ============================================================================

/**
 * Common technology choices and their typical rationale (50+ technologies).
 *
 * This provides fallback rationale when no explicit documentation exists.
 */
const COMMON_RATIONALE: Record<string, { reasoning: string; confidence: number }> = {
  // Databases
  sqlite: { reasoning: 'SQLite chosen for: zero-config deployment, single-file storage, embedded database with no separate server process, local-first architecture, ACID compliance, excellent read performance for typical workloads.', confidence: 0.65 },
  postgres: { reasoning: 'PostgreSQL chosen for: ACID compliance, rich SQL feature set, excellent performance at scale, extensibility, strong community support, advanced data types (JSON, arrays, etc.).', confidence: 0.65 },
  postgresql: { reasoning: 'PostgreSQL chosen for: ACID compliance, rich SQL feature set, excellent performance at scale, extensibility, strong community support, advanced data types (JSON, arrays, etc.).', confidence: 0.65 },
  mysql: { reasoning: 'MySQL chosen for: proven reliability, wide hosting support, large community, good performance for web applications, mature replication features.', confidence: 0.65 },
  mongodb: { reasoning: 'MongoDB chosen for: flexible schema design, horizontal scaling, document model matching JSON, fast development iteration, good for unstructured data.', confidence: 0.65 },
  redis: { reasoning: 'Redis chosen for: in-memory performance, caching capabilities, pub/sub messaging, data structure support, session management, rate limiting.', confidence: 0.65 },
  dynamodb: { reasoning: 'DynamoDB chosen for: serverless architecture, auto-scaling, low-latency at scale, AWS integration, managed service, predictable performance.', confidence: 0.65 },

  // Languages
  typescript: { reasoning: 'TypeScript chosen for: static type checking, better IDE support, improved refactoring safety, self-documenting code, catch errors at compile time rather than runtime.', confidence: 0.65 },
  javascript: { reasoning: 'JavaScript chosen for: universal browser support, full-stack capability, large ecosystem, rapid prototyping, event-driven architecture.', confidence: 0.65 },
  python: { reasoning: 'Python chosen for: readability, rapid development, extensive libraries, data science/ML support, scripting capabilities, wide adoption.', confidence: 0.65 },
  rust: { reasoning: 'Rust chosen for: memory safety without garbage collection, performance comparable to C/C++, fearless concurrency, zero-cost abstractions.', confidence: 0.65 },
  go: { reasoning: 'Go chosen for: simplicity, fast compilation, built-in concurrency, efficient resource usage, excellent for microservices, strong standard library.', confidence: 0.65 },
  golang: { reasoning: 'Go chosen for: simplicity, fast compilation, built-in concurrency, efficient resource usage, excellent for microservices, strong standard library.', confidence: 0.65 },
  java: { reasoning: 'Java chosen for: platform independence, enterprise features, strong typing, extensive libraries, proven scalability, mature tooling.', confidence: 0.65 },

  // Frontend Frameworks
  react: { reasoning: 'React chosen for: component-based architecture, virtual DOM for performance, large ecosystem, excellent developer experience, strong community support.', confidence: 0.65 },
  vue: { reasoning: 'Vue chosen for: gentle learning curve, progressive adoption, excellent documentation, reactive data binding, flexible architecture.', confidence: 0.65 },
  angular: { reasoning: 'Angular chosen for: comprehensive framework, TypeScript-first, dependency injection, enterprise features, consistent architecture.', confidence: 0.65 },
  svelte: { reasoning: 'Svelte chosen for: compile-time optimizations, no virtual DOM overhead, smaller bundle sizes, simpler state management, reactive by default.', confidence: 0.65 },
  nextjs: { reasoning: 'Next.js chosen for: server-side rendering, static generation, file-based routing, API routes, excellent developer experience, Vercel integration.', confidence: 0.65 },

  // Backend Frameworks
  express: { reasoning: 'Express chosen for: minimalist web framework, middleware architecture, large ecosystem, flexibility, wide adoption.', confidence: 0.65 },
  fastify: { reasoning: 'Fastify chosen for: high performance, schema-based validation, plugin architecture, TypeScript support, developer experience.', confidence: 0.65 },
  nestjs: { reasoning: 'NestJS chosen for: Angular-inspired architecture, TypeScript-first, dependency injection, modular design, enterprise patterns.', confidence: 0.65 },
  django: { reasoning: 'Django chosen for: batteries-included approach, admin interface, ORM, security features, rapid development, Python ecosystem.', confidence: 0.65 },
  flask: { reasoning: 'Flask chosen for: lightweight, flexibility, microframework approach, easy to learn, extensible, Python ecosystem.', confidence: 0.65 },
  rails: { reasoning: 'Rails chosen for: convention over configuration, rapid development, mature ecosystem, full-stack framework, Ruby elegance.', confidence: 0.65 },
  fastapi: { reasoning: 'FastAPI chosen for: high performance, automatic API documentation, type hints, async support, data validation with Pydantic.', confidence: 0.65 },

  // State Management
  redux: { reasoning: 'Redux chosen for: predictable state management, time-travel debugging, middleware support, centralized store, unidirectional data flow.', confidence: 0.65 },
  mobx: { reasoning: 'MobX chosen for: simpler API than Redux, reactive programming, less boilerplate, automatic tracking, object-oriented approach.', confidence: 0.65 },
  zustand: { reasoning: 'Zustand chosen for: minimal boilerplate, TypeScript support, no providers needed, simple API, small bundle size.', confidence: 0.65 },

  // API & Communication
  graphql: { reasoning: 'GraphQL chosen for: flexible data fetching, strong typing, reduced over-fetching, self-documenting API, excellent developer experience.', confidence: 0.65 },
  rest: { reasoning: 'REST chosen for: simplicity, statelessness, cacheability, uniform interface, wide tooling support, easy to understand.', confidence: 0.65 },
  grpc: { reasoning: 'gRPC chosen for: high performance, protocol buffers, bidirectional streaming, code generation, strongly typed contracts.', confidence: 0.65 },
  websocket: { reasoning: 'WebSocket chosen for: real-time bidirectional communication, persistent connections, low latency, push notifications.', confidence: 0.65 },
  trpc: { reasoning: 'tRPC chosen for: end-to-end type safety, no code generation, TypeScript-first, RPC-style API calls, excellent DX.', confidence: 0.65 },

  // Message Queues
  kafka: { reasoning: 'Kafka chosen for: high throughput, distributed architecture, event streaming, durability, replay capability, real-time processing.', confidence: 0.65 },
  rabbitmq: { reasoning: 'RabbitMQ chosen for: reliable message delivery, routing flexibility, multiple protocols, management UI, mature ecosystem.', confidence: 0.65 },

  // Containerization
  docker: { reasoning: 'Docker chosen for: consistent environments, isolation, portability, microservices deployment, reproducible builds.', confidence: 0.65 },
  kubernetes: { reasoning: 'Kubernetes chosen for: container orchestration, auto-scaling, self-healing, declarative configuration, cloud-native deployment.', confidence: 0.65 },
  k8s: { reasoning: 'Kubernetes chosen for: container orchestration, auto-scaling, self-healing, declarative configuration, cloud-native deployment.', confidence: 0.65 },

  // Testing
  vitest: { reasoning: 'Vitest chosen for: native ESM support, fast execution, Vite integration, Jest-compatible API, excellent TypeScript support, watch mode performance.', confidence: 0.65 },
  jest: { reasoning: 'Jest chosen for: zero-config setup, snapshot testing, code coverage, mocking capabilities, parallel test execution, wide adoption.', confidence: 0.65 },
  cypress: { reasoning: 'Cypress chosen for: end-to-end testing, time-travel debugging, automatic waiting, real browser testing, excellent developer experience.', confidence: 0.65 },
  playwright: { reasoning: 'Playwright chosen for: cross-browser testing, auto-waiting, modern API, trace viewer, parallel execution, reliable selectors.', confidence: 0.65 },
  pytest: { reasoning: 'Pytest chosen for: simple syntax, powerful fixtures, extensive plugins, parametrized tests, excellent assertion introspection.', confidence: 0.65 },

  // Code Quality
  eslint: { reasoning: 'ESLint chosen for: configurable linting rules, TypeScript support, auto-fixing capabilities, large plugin ecosystem, integration with most IDEs.', confidence: 0.65 },
  prettier: { reasoning: 'Prettier chosen for: consistent code formatting, minimal configuration, integration with ESLint, supports multiple languages, eliminates style debates.', confidence: 0.65 },
  biome: { reasoning: 'Biome chosen for: all-in-one tooling, fast performance (Rust-based), formatting and linting, minimal configuration, ESLint/Prettier replacement.', confidence: 0.65 },

  // Build Tools
  vite: { reasoning: 'Vite chosen for: fast development server, native ES modules, optimized production builds, excellent DX, framework agnostic.', confidence: 0.65 },
  webpack: { reasoning: 'Webpack chosen for: mature ecosystem, extensive plugin system, code splitting, asset optimization, wide adoption.', confidence: 0.65 },
  esbuild: { reasoning: 'Esbuild chosen for: extremely fast builds, written in Go, simple API, bundling and minification, JavaScript/TypeScript support.', confidence: 0.65 },

  // Runtime & Platform
  nodejs: { reasoning: 'Node.js chosen for: JavaScript runtime, non-blocking I/O, large npm ecosystem, unified frontend/backend language, excellent for I/O-heavy applications.', confidence: 0.65 },
  deno: { reasoning: 'Deno chosen for: security by default, TypeScript built-in, modern APIs, single executable, standard library.', confidence: 0.65 },
  bun: { reasoning: 'Bun chosen for: fast JavaScript runtime, built-in bundler, native TypeScript, npm compatibility, performance focus.', confidence: 0.65 },

  // Embeddings & AI
  embeddings: { reasoning: 'Embeddings chosen for: semantic similarity search, vector representations, machine learning integration, capturing meaning beyond keywords.', confidence: 0.65 },
  vectors: { reasoning: 'Vector search chosen for: semantic similarity matching, efficient nearest-neighbor lookup, AI-powered retrieval, representing complex concepts.', confidence: 0.65 },
  openai: { reasoning: 'OpenAI chosen for: state-of-the-art language models, comprehensive API, embedding models, wide adoption, strong documentation.', confidence: 0.65 },
  llm: { reasoning: 'LLM chosen for: natural language understanding, text generation, semantic analysis, intelligent assistance, flexible applications.', confidence: 0.65 },

  // Caching
  caching: { reasoning: 'Caching chosen for: improved performance, reduced latency, decreased database load, cost efficiency, better user experience.', confidence: 0.65 },
  cache: { reasoning: 'Caching chosen for: improved performance, reduced latency, decreased database load, cost efficiency, better user experience.', confidence: 0.65 },
  memcached: { reasoning: 'Memcached chosen for: simple key-value caching, distributed architecture, low latency, horizontal scaling, session storage.', confidence: 0.65 },

  // Authentication
  jwt: { reasoning: 'JWT chosen for: stateless authentication, cross-domain support, self-contained tokens, mobile-friendly, scalable.', confidence: 0.65 },
  oauth: { reasoning: 'OAuth chosen for: delegated authorization, third-party login, secure token exchange, standardized protocol, user consent.', confidence: 0.65 },
  auth0: { reasoning: 'Auth0 chosen for: managed authentication, social logins, security compliance, easy integration, enterprise features.', confidence: 0.65 },

  // Cloud Providers
  aws: { reasoning: 'AWS chosen for: comprehensive services, global infrastructure, mature ecosystem, scalability, enterprise adoption.', confidence: 0.65 },
  vercel: { reasoning: 'Vercel chosen for: frontend deployment, serverless functions, edge network, excellent DX, Next.js integration.', confidence: 0.65 },
  cloudflare: { reasoning: 'Cloudflare chosen for: edge computing, CDN performance, security features, Workers platform, global network.', confidence: 0.65 },

  // Design Patterns
  singleton: { reasoning: 'Singleton pattern chosen for: single instance guarantee, global access point, resource management, configuration objects.', confidence: 0.65 },
  factory: { reasoning: 'Factory pattern chosen for: object creation abstraction, decoupling, flexibility, testing support, complex initialization.', confidence: 0.65 },
  microservices: { reasoning: 'Microservices chosen for: independent deployment, scalability, technology diversity, fault isolation, team autonomy.', confidence: 0.65 },
  monolith: { reasoning: 'Monolith chosen for: simplicity, easier debugging, no network overhead, simpler deployment, suitable for smaller teams.', confidence: 0.65 },
};

/**
 * Generate inferred rationale when no explicit documentation exists.
 *
 * @param topic - The technology or decision topic
 * @param context - Optional context about how it's used
 * @returns An inferred rationale entry
 */
export function generateInferredRationale(topic: string, context?: string): RationaleEntry | null {
  const normalizedTopic = topic.toLowerCase().replace(/[-_]/g, '');

  // Check for known technology rationale
  for (const [key, value] of Object.entries(COMMON_RATIONALE)) {
    if (normalizedTopic.includes(key) || key.includes(normalizedTopic)) {
      return {
        topic,
        reasoning: value.reasoning,
        source: 'inferred',
        confidence: value.confidence,
        context: context || `Inferred from common usage patterns for ${topic}`,
      };
    }
  }

  return null;
}

// ============================================================================
// COMMENT RATIONALE EXTRACTION
// ============================================================================

/**
 * Patterns for extracting rationale from code comments.
 *
 * Matches various comment formats including:
 * - JSDoc tags: @reason, @rationale, @why, @decision (with optional colon)
 * - Inline comments: // WHY:, // REASON:, // RATIONALE:, // DECISION:
 * - Block comments: /* REASON:, /* Trade-off:
 * - TODO/FIXME with "because" explanations
 */
const COMMENT_RATIONALE_PATTERNS = [
  // JSDoc tags (with optional colon after tag name)
  { pattern: /@reason:?\s+(.+?)(?=\n|\*\/|@)/gis, type: 'reason' as const },
  { pattern: /@rationale:?\s+(.+?)(?=\n|\*\/|@)/gis, type: 'rationale' as const },
  { pattern: /@why:?\s+(.+?)(?=\n|\*\/|@)/gis, type: 'why' as const },
  { pattern: /@decision:?\s+(.+?)(?=\n|\*\/|@)/gis, type: 'decision' as const },

  // Inline comments with rationale keywords (// WHY:, // REASON:, etc.)
  // Matches both uppercase (WHY) and title case (Why)
  { pattern: /\/\/\s*(?:WHY|Why):\s*(.+?)(?=\n|$)/gi, type: 'why' as const },
  { pattern: /\/\/\s*(?:REASON|Reason):\s*(.+?)(?=\n|$)/gi, type: 'reason' as const },
  { pattern: /\/\/\s*(?:RATIONALE|Rationale):\s*(.+?)(?=\n|$)/gi, type: 'rationale' as const },
  { pattern: /\/\/\s*(?:DECISION|Decision):\s*(.+?)(?=\n|$)/gi, type: 'decision' as const },

  // Block comments with rationale (/* REASON: ... */, etc.)
  { pattern: /\/\*\s*(?:WHY|Why):\s*(.+?)(?=\*\/)/gis, type: 'why' as const },
  { pattern: /\/\*\s*(?:REASON|Reason):\s*(.+?)(?=\*\/)/gis, type: 'reason' as const },
  { pattern: /\/\*\s*(?:RATIONALE|Rationale):\s*(.+?)(?=\*\/)/gis, type: 'rationale' as const },
  { pattern: /\/\*\s*(?:DECISION|Decision):\s*(.+?)(?=\*\/)/gis, type: 'decision' as const },

  // Trade-off comments (/* Trade-off: ..., // Tradeoff: ...)
  { pattern: /\/\/\s*(?:Trade-off|Tradeoff|TRADE-OFF|TRADEOFF):\s*(.+?)(?=\n|$)/gi, type: 'tradeoff' as const },
  { pattern: /\/\*\s*(?:Trade-off|Tradeoff|TRADE-OFF|TRADEOFF):\s*(.+?)(?=\*\/)/gis, type: 'tradeoff' as const },

  // Standalone uppercase keywords in multiline block comments (legacy pattern)
  { pattern: /(?:REASON|RATIONALE|WHY):\s*(.+?)(?=\n|$|\*\/)/gis, type: 'comment' as const },

  // TODO/FIXME with rationale
  { pattern: /TODO:\s*(.+?because.+?)(?=\n|$)/gi, type: 'todo' as const },
  { pattern: /FIXME:\s*(.+?because.+?)(?=\n|$)/gi, type: 'fixme' as const },
];

/**
 * Extract rationale from source code content.
 *
 * @param content - The source code content
 * @param filePath - Path to the file
 * @returns Extracted rationale entries
 */
export function extractRationaleFromComments(content: string, filePath: string): RationaleEntry[] {
  const entries: RationaleEntry[] = [];

  for (const { pattern, type } of COMMENT_RATIONALE_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const reasoning = match[1]?.trim();
      if (reasoning && reasoning.length > 10 && reasoning.length < 1000) {
        // Try to extract a topic from the reasoning
        const topicMatch = reasoning.match(/^(\w+(?:\s+\w+){0,3}):/);
        const topic = topicMatch?.[1] || type;

        entries.push({
          topic,
          reasoning: topicMatch ? reasoning.slice(topicMatch[0].length).trim() : reasoning,
          source: 'comment',
          confidence: 0.7,
          sourcePath: filePath,
          context: `Extracted from ${type} annotation`,
        });
      }
    }
  }

  return entries;
}

// ============================================================================
// RATIONALE CONSTRUCTION
// ============================================================================

/**
 * Rationale Construction for answering WHY questions.
 *
 * This construction:
 * 1. Detects WHY queries
 * 2. Searches the rationale index for matching entries
 * 3. Generates inferred rationale if no explicit documentation exists
 * 4. Returns a structured answer with confidence
 */
export class RationaleConstruction extends BaseConstruction<RationaleInput, RationaleResult> {
  readonly CONSTRUCTION_ID = 'RationaleConstruction';

  private index: RationaleIndex;
  private initialized = false;

  constructor(librarian: Librarian) {
    super(librarian);
    // Get storage and workspace from librarian (type assertion since we know the internal structure)
    const librarianInternal = librarian as unknown as {
      storage: LibrarianStorage;
      config: { workspace: string };
    };
    const storage = librarianInternal.storage;
    const workspace = librarianInternal.config?.workspace;
    this.index = new RationaleIndex(storage, workspace);
  }

  /**
   * Initialize the construction by loading the rationale index.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.index.initialize();
    this.initialized = true;
  }

  /**
   * Execute the rationale query.
   */
  async execute(input: RationaleInput): Promise<RationaleResult> {
    const startTime = Date.now();
    const evidenceRefs: ConstructionResult['evidenceRefs'] = [];

    // Ensure index is initialized
    await this.initialize();
    this.addEvidence(evidenceRefs, 'rationale_index_loaded');

    // Classify the query
    const classification = classifyWhyQuery(input.question);
    this.addEvidence(evidenceRefs, `query_classified:${classification.questionType}`);

    // Get answer from index
    let answer = this.index.answerWhy(input.question);
    this.addEvidence(evidenceRefs, `rationale_search:found_${answer.entries.length}`);

    // If no explicit rationale, try to generate inferred rationale
    if (!answer.hasExplicitRationale && classification.topic) {
      const inferred = generateInferredRationale(classification.topic);
      if (inferred) {
        answer = {
          ...answer,
          entries: [inferred, ...answer.entries],
          summary: inferred.reasoning,
          caveats: [
            ...answer.caveats,
            'Rationale was inferred from common usage patterns. Consider adding an ADR for explicit documentation.',
          ],
        };
        this.addEvidence(evidenceRefs, 'inferred_rationale_generated');
      }
    }

    // Build confidence value
    const confidenceValue = createRationaleConfidence(
      answer.confidence,
      `rationale_lookup(entries=${answer.entries.length})`,
      answer.hasExplicitRationale ? 'explicit_rationale' : 'inferred_rationale'
    );

    // Record prediction for calibration
    const predictionId = this.recordPrediction(
      `Rationale answer for: ${input.question}`,
      confidenceValue,
      { hasExplicitRationale: answer.hasExplicitRationale, entriesFound: answer.entries.length }
    );

    return {
      answer,
      relatedPacks: [], // Could be enhanced to include related context packs
      confidence: confidenceValue,
      evidenceRefs,
      analysisTimeMs: Date.now() - startTime,
      predictionId,
    };
  }
}

/**
 * Factory function to create a RationaleConstruction.
 */
export function createRationaleConstruction(librarian: Librarian): RationaleConstruction {
  return new RationaleConstruction(librarian);
}
