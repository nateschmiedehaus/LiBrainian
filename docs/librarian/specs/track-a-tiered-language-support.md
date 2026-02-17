# Track A: Tiered Language Support Specification

> **Extracted from**: `docs/LiBrainian/THEORETICAL_CRITIQUE.md` (Part XVII.A)
> **Source**: Turing's insight: "If a human can understand it, a system with an oracle (LLM) can attempt understanding with explicit confidence."
> **Status**: Specification complete, implementation pending
>
> **LiBrainian Story**: Chapter 6 (The Universality) - Making LiBrainian work for ANY language.
>
> **Related Specifications**:
> - [track-b-bootstrap.md](./track-b-bootstrap.md) - Bootstrap pipeline with tier-aware processing
> - [track-d-quantification.md](./track-d-quantification.md) - ConfidenceValue types used for tier confidence
> - [track-c-hierarchical-knowledge.md](./track-c-hierarchical-knowledge.md) - Hierarchical storage with tier metadata

---

## Executive Summary

Track A addresses the fundamental language coverage problem of LiBrainian: **How does an intelligent system understand code in languages without Tree-sitter parsers?**

This specification covers:
- **Four-Tier Language Support** - From full AST to multimodal understanding
- **Tier Detection and Selection** - Automatic tier assignment with fallback chain
- **Chunking Strategies** - Semantic chunking for parser-less languages
- **LLM-Assisted Extraction** - When and how to invoke LLM for entity extraction
- **Confidence Propagation** - Tier-based confidence bounds

---

## 1. Problem Statement

### The Parser Coverage Gap

LiBrainian currently relies on Tree-sitter parsers for code understanding. This creates a coverage gap:

| Language Category | Tree-sitter Support | LiBrainian Status |
|------------------|---------------------|------------------|
| TypeScript, JavaScript, Python | Full parser | Full understanding |
| Rust, Go, Java, C, C++ | Full parser | Full understanding |
| Kotlin, Swift, Scala | Partial parser | Degraded understanding |
| COBOL, Fortran, legacy DSLs | No parser | **No understanding** |
| Configuration files (HCL, TOML) | Varies | Inconsistent |
| Non-code artifacts (diagrams) | N/A | **No understanding** |

### The Confidence Problem

When a parser succeeds, extraction confidence is deterministic (1.0). But:
- What confidence do we assign to heuristic extraction?
- What confidence do we assign to LLM-based extraction?
- How do we compose confidence across tiers?

### What We Need

A tiered language support system that:
1. **Excludes no language** - Every file can be processed at some tier
2. **Explicit confidence** - Each tier has principled confidence bounds
3. **Graceful degradation** - Higher tiers fail safely to lower tiers
4. **Composable extraction** - Same entity interface regardless of tier

### Theoretical Foundation

**Turing's Insight**: If a human can understand it, a system with an oracle (LLM) can attempt understanding with explicit confidence. The key word is "explicit" - we must know how confident we are.

**The Principled Approach**: Following Track D (CONFIDENCE_REDESIGN.md), all tier confidence values must be `ConfidenceValue` types - deterministic, derived, measured, bounded, or absent. No arbitrary numbers.

---

## 2. Four-Tier Language Support

### Tier Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ TIER 1: Full AST Support (Tree-sitter)                              │
│ Confidence: Deterministic (1.0 for parse success)                   │
│ Capability: Complete AST, full entity extraction, type info         │
│ Languages: TypeScript, JavaScript, Python, Rust, Go, Java, C, C++   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (fallback when parser incomplete)
┌─────────────────────────────────────────────────────────────────────┐
│ TIER 2: Hybrid Support (Partial AST + Heuristics)                   │
│ Confidence: Bounded (0.7-0.95 based on grammar coverage)            │
│ Capability: Skeleton AST, semantic completion via heuristics        │
│ Languages: Kotlin, Swift, Scala, Elixir, newer languages            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (fallback when no parser available)
┌─────────────────────────────────────────────────────────────────────┐
│ TIER 3: Semantic Chunking (No AST)                                  │
│ Confidence: Bounded (0.4-0.7 based on chunking strategy)            │
│ Capability: Function-level chunks, LLM entity extraction            │
│ Languages: COBOL, Fortran, legacy systems, DSLs, configs            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (fallback for non-text artifacts)
┌─────────────────────────────────────────────────────────────────────┐
│ TIER 4: Multimodal (Binary/Visual)                                  │
│ Confidence: Bounded (0.3-0.6 based on artifact type)                │
│ Capability: Visual understanding, binary metadata extraction        │
│ Artifacts: Architecture diagrams, wireframes, compiled binaries     │
└─────────────────────────────────────────────────────────────────────┘
```

### Tier Summary Table

| Tier | Parser | Confidence Type | Confidence Range | Use Case |
|------|--------|-----------------|------------------|----------|
| 1 | Tree-sitter | Deterministic | 1.0 (success) / 0.0 (failure) | Mature language support |
| 2 | Hybrid | Bounded | 0.7 - 0.95 | Partial grammar coverage |
| 3 | None | Bounded | 0.4 - 0.7 | Legacy/DSL languages |
| 4 | None | Bounded | 0.3 - 0.6 | Non-text artifacts |

---

## 3. Core Interfaces

### LanguageTier Type

```typescript
/**
 * The four tiers of language support.
 * Lower tiers have higher confidence but narrower coverage.
 */
export type LanguageTier = 1 | 2 | 3 | 4;
```

### TieredLanguageSupport Interface

```typescript
import { ConfidenceValue } from './confidence.js';

/**
 * Configuration for a language at a specific tier.
 *
 * INVARIANT: Every language MUST be assignable to at least Tier 3.
 * No language is excluded - understanding quality varies with tier.
 */
export interface TieredLanguageSupport {
  tier: LanguageTier;
  language: string;
  parser: ParserType;
  confidence: ConfidenceValue;  // MUST use principled type, not raw number
  capabilities: TierCapabilities;
}

export type ParserType =
  | 'tree-sitter'
  | 'hybrid'
  | 'chunking'
  | 'multimodal';
```

### TierCapabilities Interface

```typescript
/**
 * Capabilities available at each tier.
 * Lower tiers have more capabilities.
 */
export interface TierCapabilities {
  /** Can extract named entities (functions, classes, variables) */
  entityExtraction: boolean;

  /** Can detect relationships between entities (calls, imports, inheritance) */
  relationshipDetection: boolean;

  /** Can extract type information (parameter types, return types) */
  typeInformation: boolean;

  /** Can provide semantic understanding (purpose, behavior) */
  semanticUnderstanding: boolean;

  /** Can detect code boundaries (functions, blocks) */
  boundaryDetection: boolean;
}

/**
 * Default capabilities per tier.
 */
export const TIER_CAPABILITIES: Record<LanguageTier, TierCapabilities> = {
  1: {
    entityExtraction: true,
    relationshipDetection: true,
    typeInformation: true,
    semanticUnderstanding: true,
    boundaryDetection: true,
  },
  2: {
    entityExtraction: true,
    relationshipDetection: true,
    typeInformation: false,  // Partial - may be incomplete
    semanticUnderstanding: true,
    boundaryDetection: true,
  },
  3: {
    entityExtraction: true,  // Via LLM
    relationshipDetection: false,  // Limited to explicit references
    typeInformation: false,
    semanticUnderstanding: true,  // Via LLM
    boundaryDetection: true,  // Via chunking heuristics
  },
  4: {
    entityExtraction: true,  // Via LLM vision
    relationshipDetection: false,
    typeInformation: false,
    semanticUnderstanding: true,  // Via LLM vision
    boundaryDetection: false,  // N/A for visual artifacts
  },
};
```

### Tier Confidence Definitions

```typescript
import { BoundedConfidence, DeterministicConfidence } from './confidence.js';

/**
 * Confidence bounds for each tier.
 *
 * These are BOUNDED values with explicit basis, not arbitrary numbers.
 * Basis: empirical observation of extraction quality across tier strategies.
 */
export const TIER_CONFIDENCE_BOUNDS: Record<LanguageTier, ConfidenceValue> = {
  1: {
    type: 'deterministic',
    value: 1.0,
    reason: 'tree_sitter_parse_success',
  } as DeterministicConfidence,

  2: {
    type: 'bounded',
    low: 0.7,
    high: 0.95,
    basis: 'theoretical',
    citation: 'Hybrid parsing: AST provides structure (high confidence), heuristics fill gaps (lower confidence). Range based on grammar coverage percentage.',
  } as BoundedConfidence,

  3: {
    type: 'bounded',
    low: 0.4,
    high: 0.7,
    basis: 'literature',
    citation: 'LLM entity extraction without AST guidance. Based on semantic similarity literature showing 40-70% accuracy for unstructured code analysis.',
  } as BoundedConfidence,

  4: {
    type: 'bounded',
    low: 0.3,
    high: 0.6,
    basis: 'literature',
    citation: 'LLM vision for code diagrams. Based on VLM benchmark results for technical diagram understanding.',
  } as BoundedConfidence,
};
```

---

## 4. Tier Detection and Selection

### Language Registry

```typescript
/**
 * Registry mapping languages to their tier support.
 *
 * ALGORITHM:
 * 1. Check extension → known language mapping
 * 2. Check content signatures (shebang, magic bytes)
 * 3. Fall back to Tier 3 (semantic chunking)
 * 4. For binary/images, use Tier 4
 */
export class UniversalLanguageRegistry {
  private tiers = new Map<string, TieredLanguageSupport>();

  /**
   * Detect language tier for a file.
   *
   * @param filePath - Path to file (for extension detection)
   * @param content - File content (for signature detection)
   * @returns Tier assignment with confidence
   */
  detectLanguageTier(
    filePath: string,
    content: string | Buffer
  ): TierDetectionResult;

  /**
   * Register a language at a specific tier.
   *
   * @param language - Language identifier (e.g., 'typescript', 'cobol')
   * @param support - Tier configuration
   */
  register(language: string, support: TieredLanguageSupport): void;

  /**
   * Get all registered languages for a tier.
   */
  getLanguagesForTier(tier: LanguageTier): string[];
}

export interface TierDetectionResult {
  tier: LanguageTier;
  language: string;
  confidence: ConfidenceValue;
  detectionMethod: 'extension' | 'signature' | 'content_analysis' | 'fallback';
}
```

### Default Language Registry

```typescript
/**
 * Default language tier assignments.
 *
 * TIER 1: Languages with mature Tree-sitter grammars
 */
export const TIER_1_LANGUAGES = [
  'typescript', 'javascript', 'tsx', 'jsx',
  'python',
  'rust',
  'go',
  'java',
  'c', 'cpp', 'c++',
  'ruby',
  'php',
  'c#', 'csharp',
  'bash', 'shell',
  'json', 'yaml', 'toml',
  'html', 'css',
  'sql',
  'markdown',
] as const;

/**
 * TIER 2: Languages with partial Tree-sitter support or hybrid parsing
 */
export const TIER_2_LANGUAGES = [
  'kotlin',
  'swift',
  'scala',
  'elixir',
  'erlang',
  'haskell',
  'ocaml',
  'clojure',
  'lua',
  'r',
  'julia',
  'dart',
  'zig',
] as const;

/**
 * TIER 3: Languages without parsers (chunking only)
 */
export const TIER_3_LANGUAGES = [
  'cobol',
  'fortran',
  'ada',
  'pascal',
  'delphi',
  'vb', 'vba', 'visual-basic',
  'perl',
  'tcl',
  'awk',
  'sed',
  'prolog',
  'lisp', 'common-lisp', 'scheme',
  'assembly', 'asm',
  // DSLs
  'hcl', 'terraform',
  'graphql',
  'protobuf',
  'thrift',
] as const;

/**
 * TIER 4: Non-text artifacts
 */
export const TIER_4_ARTIFACTS = [
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'application/pdf',
  'application/octet-stream',  // binaries
] as const;
```

### Fallback Chain

```typescript
/**
 * Fallback chain for tier selection.
 *
 * ALGORITHM:
 * 1. Try Tier 1 (Tree-sitter) - if grammar exists and parses
 * 2. Fall to Tier 2 (Hybrid) - if partial grammar exists
 * 3. Fall to Tier 3 (Chunking) - for any text content
 * 4. Fall to Tier 4 (Multimodal) - for binary/visual content
 *
 * INVARIANT: Every file gets assigned a tier. No file is rejected.
 */
export async function selectTierWithFallback(
  filePath: string,
  content: string | Buffer,
  registry: UniversalLanguageRegistry
): Promise<TierSelectionResult> {
  // Detect language and initial tier
  const detection = registry.detectLanguageTier(filePath, content);

  // If Tier 1, verify parser actually works
  if (detection.tier === 1) {
    const parseResult = await attemptTreeSitterParse(content, detection.language);
    if (parseResult.success) {
      return {
        tier: 1,
        language: detection.language,
        confidence: {
          type: 'deterministic',
          value: 1.0,
          reason: 'tree_sitter_parse_success',
        },
        fallbackPath: [],
      };
    }
    // Parser failed - fall to Tier 2
  }

  // If Tier 2, verify hybrid parsing works
  if (detection.tier <= 2) {
    const hybridResult = await attemptHybridParse(content, detection.language);
    if (hybridResult.coverage > 0.7) {
      return {
        tier: 2,
        language: detection.language,
        confidence: {
          type: 'bounded',
          low: 0.7,
          high: hybridResult.coverage,
          basis: 'theoretical',
          citation: `Hybrid parse achieved ${(hybridResult.coverage * 100).toFixed(0)}% coverage`,
        },
        fallbackPath: detection.tier === 1 ? ['tier1_parse_failed'] : [],
      };
    }
    // Hybrid insufficient - fall to Tier 3
  }

  // Tier 3: Semantic chunking (always works for text)
  if (typeof content === 'string') {
    return {
      tier: 3,
      language: detection.language,
      confidence: TIER_CONFIDENCE_BOUNDS[3],
      fallbackPath: detection.tier < 3
        ? ['tier1_parse_failed', 'tier2_coverage_insufficient']
        : [],
    };
  }

  // Tier 4: Binary/visual content
  return {
    tier: 4,
    language: detection.language,
    confidence: TIER_CONFIDENCE_BOUNDS[4],
    fallbackPath: ['binary_content'],
  };
}

export interface TierSelectionResult {
  tier: LanguageTier;
  language: string;
  confidence: ConfidenceValue;
  fallbackPath: string[];  // Trail of fallback reasons
}
```

---

## 5. Chunking Strategies for Tier 3

### Chunking Strategy Interface

```typescript
/**
 * Strategy for chunking code without AST support.
 *
 * GOAL: Produce semantically meaningful chunks that can be fed to LLM
 * for entity extraction.
 */
export interface ChunkingStrategy {
  id: string;
  name: string;
  description: string;

  /**
   * Chunk the content into semantically meaningful pieces.
   */
  chunk(content: string, options?: ChunkingOptions): Chunk[];

  /**
   * Confidence bound for this chunking strategy.
   */
  confidence: BoundedConfidence;
}

export interface Chunk {
  content: string;
  startLine: number;
  endLine: number;
  type: 'function' | 'class' | 'block' | 'section' | 'unknown';
  hints: ChunkHints;
}

export interface ChunkHints {
  /** Likely entity name (from pattern matching) */
  likelyName?: string;
  /** Likely entity type */
  likelyType?: 'function' | 'class' | 'variable' | 'constant';
  /** Indentation level */
  indentLevel: number;
  /** Contains definition keywords */
  hasDefinitionKeywords: boolean;
}

export interface ChunkingOptions {
  minChunkLines?: number;  // Default: 3
  maxChunkLines?: number;  // Default: 100
  preserveContext?: boolean;  // Include surrounding lines
}
```

### Function Block Chunking

```typescript
/**
 * Chunk by detecting function-like patterns.
 *
 * Works for: Most procedural/OO languages
 * Patterns: def, function, func, fn, sub, proc, method, etc.
 */
export const functionBlockChunking: ChunkingStrategy = {
  id: 'function_blocks',
  name: 'Function Block Detection',
  description: 'Detect function boundaries using common definition patterns',

  confidence: {
    type: 'bounded',
    low: 0.5,
    high: 0.7,
    basis: 'theoretical',
    citation: 'Function keywords are language-universal; boundary detection via dedent is ~70% accurate across languages',
  },

  chunk(content: string, options?: ChunkingOptions): Chunk[] {
    const lines = content.split('\n');
    const chunks: Chunk[] = [];

    // Patterns that typically start function definitions
    const functionPatterns = [
      /^[\t ]*(def|function|func|fn|sub|proc|method|procedure)\s+(\w+)/,
      /^[\t ]*(\w+)\s*[=:]\s*(function|\(.*\)\s*=>|\(.*\)\s*->)/,
      /^[\t ]*(public|private|protected|static)?\s*(async\s+)?(function|def|fn)\s+(\w+)/,
      /^[\t ]*class\s+(\w+)/,
      /^[\t ]*interface\s+(\w+)/,
      /^[\t ]*struct\s+(\w+)/,
    ];

    let currentChunk: { startLine: number; lines: string[]; name?: string } | null = null;
    let baseIndent = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const indent = line.match(/^[\t ]*/)?.[0].length ?? 0;

      // Check if line starts a new definition
      for (const pattern of functionPatterns) {
        const match = line.match(pattern);
        if (match) {
          // Save previous chunk
          if (currentChunk && currentChunk.lines.length >= (options?.minChunkLines ?? 3)) {
            chunks.push(createChunk(currentChunk, content));
          }

          // Start new chunk
          currentChunk = {
            startLine: i,
            lines: [line],
            name: match[2] ?? match[1],
          };
          baseIndent = indent;
          break;
        }
      }

      // Continue current chunk if we're still in its scope
      if (currentChunk && i > currentChunk.startLine) {
        if (line.trim() === '' || indent > baseIndent) {
          currentChunk.lines.push(line);
        } else if (indent <= baseIndent && line.trim() !== '') {
          // Dedent detected - end chunk
          if (currentChunk.lines.length >= (options?.minChunkLines ?? 3)) {
            chunks.push(createChunk(currentChunk, content));
          }
          currentChunk = null;
        }
      }
    }

    // Handle final chunk
    if (currentChunk && currentChunk.lines.length >= (options?.minChunkLines ?? 3)) {
      chunks.push(createChunk(currentChunk, content));
    }

    return chunks;
  },
};
```

### Indentation-Based Chunking

```typescript
/**
 * Chunk by indentation changes.
 *
 * Works for: Python, YAML, indentation-significant languages
 * Also useful as fallback for any language
 */
export const indentationChunking: ChunkingStrategy = {
  id: 'indentation',
  name: 'Indentation-Based Chunking',
  description: 'Use indentation changes as chunk boundaries',

  confidence: {
    type: 'bounded',
    low: 0.4,
    high: 0.6,
    basis: 'theoretical',
    citation: 'Indentation correlates with semantic blocks in most languages, but may split logical units',
  },

  chunk(content: string, options?: ChunkingOptions): Chunk[] {
    const lines = content.split('\n');
    const chunks: Chunk[] = [];

    // Detect indent unit (tabs vs spaces, space count)
    const indentUnit = detectIndentUnit(lines);

    let currentChunk: string[] = [];
    let currentIndent = 0;
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const indent = getIndentLevel(line, indentUnit);

      // Significant dedent = new chunk
      if (indent < currentIndent && currentChunk.length > 0) {
        if (currentChunk.length >= (options?.minChunkLines ?? 3)) {
          chunks.push({
            content: currentChunk.join('\n'),
            startLine,
            endLine: i - 1,
            type: 'block',
            hints: {
              indentLevel: currentIndent,
              hasDefinitionKeywords: hasDefinitionKeywords(currentChunk.join('\n')),
            },
          });
        }
        currentChunk = [];
        startLine = i;
      }

      currentChunk.push(line);
      currentIndent = indent;

      // Enforce max chunk size
      if (currentChunk.length >= (options?.maxChunkLines ?? 100)) {
        chunks.push({
          content: currentChunk.join('\n'),
          startLine,
          endLine: i,
          type: 'block',
          hints: {
            indentLevel: currentIndent,
            hasDefinitionKeywords: hasDefinitionKeywords(currentChunk.join('\n')),
          },
        });
        currentChunk = [];
        startLine = i + 1;
      }
    }

    // Final chunk
    if (currentChunk.length >= (options?.minChunkLines ?? 3)) {
      chunks.push({
        content: currentChunk.join('\n'),
        startLine,
        endLine: lines.length - 1,
        type: 'block',
        hints: {
          indentLevel: currentIndent,
          hasDefinitionKeywords: hasDefinitionKeywords(currentChunk.join('\n')),
        },
      });
    }

    return chunks;
  },
};
```

### Blank-Line Delimited Chunking

```typescript
/**
 * Chunk by blank line groups.
 *
 * Works for: Configuration files, documentation, markup
 */
export const blankLineChunking: ChunkingStrategy = {
  id: 'blank_line_delimited',
  name: 'Blank Line Delimited Chunking',
  description: 'Use groups of blank lines as chunk boundaries',

  confidence: {
    type: 'bounded',
    low: 0.4,
    high: 0.5,
    basis: 'theoretical',
    citation: 'Blank lines often separate logical sections, but correlation varies by file type',
  },

  chunk(content: string, options?: ChunkingOptions): Chunk[] {
    const lines = content.split('\n');
    const chunks: Chunk[] = [];

    let currentChunk: string[] = [];
    let startLine = 0;
    let blankCount = 0;
    const blankThreshold = 2;  // Number of blanks to trigger split

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim() === '') {
        blankCount++;
        if (blankCount >= blankThreshold && currentChunk.length > 0) {
          chunks.push({
            content: currentChunk.join('\n'),
            startLine,
            endLine: i - blankCount,
            type: 'section',
            hints: {
              indentLevel: 0,
              hasDefinitionKeywords: hasDefinitionKeywords(currentChunk.join('\n')),
            },
          });
          currentChunk = [];
          startLine = i + 1;
          blankCount = 0;
        }
      } else {
        blankCount = 0;
        currentChunk.push(line);
      }
    }

    // Final chunk
    if (currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.join('\n'),
        startLine,
        endLine: lines.length - 1,
        type: 'section',
        hints: {
          indentLevel: 0,
          hasDefinitionKeywords: hasDefinitionKeywords(currentChunk.join('\n')),
        },
      });
    }

    return chunks;
  },
};
```

### Comment-Guided Chunking

```typescript
/**
 * Chunk by comment markers (documentation blocks, section headers).
 *
 * Works for: Well-commented legacy code, literate programming
 */
export const commentGuidedChunking: ChunkingStrategy = {
  id: 'comment_guided',
  name: 'Comment-Guided Chunking',
  description: 'Use documentation blocks and comment headers as chunk boundaries',

  confidence: {
    type: 'bounded',
    low: 0.5,
    high: 0.7,
    basis: 'theoretical',
    citation: 'Documentation blocks typically precede semantic units; effectiveness depends on comment quality',
  },

  chunk(content: string, options?: ChunkingOptions): Chunk[] {
    // Comment patterns that often mark section boundaries
    const sectionMarkers = [
      /^[\t ]*#+\s+[\w\s]+$/,           // # Section headers
      /^[\t ]*\/\/+\s*={3,}/,            // //===== dividers
      /^[\t ]*\/\/+\s*-{3,}/,            // //----- dividers
      /^[\t ]*\/\*{2,}/,                 // /** doc blocks
      /^[\t ]*'''\s*$/,                  // ''' Python docstrings
      /^[\t ]*"""\s*$/,                  // """ Python docstrings
      /^[\t ]*\*{3,}/,                   // *** dividers
      /^[\t ]*REM\s+={3,}/i,             // REM === COBOL/BASIC
    ];

    const lines = content.split('\n');
    const chunks: Chunk[] = [];

    let currentChunk: string[] = [];
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if this line is a section marker
      const isMarker = sectionMarkers.some(p => p.test(line));

      if (isMarker && currentChunk.length >= (options?.minChunkLines ?? 3)) {
        chunks.push({
          content: currentChunk.join('\n'),
          startLine,
          endLine: i - 1,
          type: 'section',
          hints: {
            indentLevel: 0,
            hasDefinitionKeywords: hasDefinitionKeywords(currentChunk.join('\n')),
          },
        });
        currentChunk = [line];
        startLine = i;
      } else {
        currentChunk.push(line);
      }
    }

    // Final chunk
    if (currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.join('\n'),
        startLine,
        endLine: lines.length - 1,
        type: 'section',
        hints: {
          indentLevel: 0,
          hasDefinitionKeywords: hasDefinitionKeywords(currentChunk.join('\n')),
        },
      });
    }

    return chunks;
  },
};
```

### Chunking Strategy Selection

```typescript
/**
 * Select the best chunking strategy for a language/content.
 */
export function selectChunkingStrategy(
  language: string,
  content: string
): ChunkingStrategy {
  // Python, YAML, etc. - use indentation
  if (['python', 'yaml', 'yml', 'coffeescript'].includes(language.toLowerCase())) {
    return indentationChunking;
  }

  // COBOL, Fortran - use comment-guided (often well-sectioned)
  if (['cobol', 'fortran', 'f90', 'f95'].includes(language.toLowerCase())) {
    return commentGuidedChunking;
  }

  // Config files - use blank-line delimited
  if (['ini', 'conf', 'cfg', 'properties'].includes(language.toLowerCase())) {
    return blankLineChunking;
  }

  // Default: function block detection
  return functionBlockChunking;
}
```

---

## 6. LLM-Assisted Extraction

### When to Invoke LLM

```typescript
/**
 * Determine when LLM extraction is needed.
 *
 * RULES:
 * 1. Tier 1: Never (AST is deterministic)
 * 2. Tier 2: For semantic details AST can't provide
 * 3. Tier 3: Always (primary extraction method)
 * 4. Tier 4: Always (vision-based understanding)
 */
export function shouldInvokeLLM(
  tier: LanguageTier,
  extractionGoal: ExtractionGoal
): boolean {
  switch (tier) {
    case 1:
      // Only for semantic understanding, not structure
      return extractionGoal === 'semantic_understanding';
    case 2:
      // For anything AST can't fully provide
      return extractionGoal !== 'structure_only';
    case 3:
    case 4:
      // Always required
      return true;
  }
}

export type ExtractionGoal =
  | 'structure_only'      // Just names and locations
  | 'relationships'       // Who calls whom
  | 'semantic_understanding';  // What does it do
```

### Entity Extraction Prompts

```typescript
/**
 * Prompt templates for LLM entity extraction.
 *
 * PRINCIPLES:
 * 1. Request structured JSON output
 * 2. Include confidence self-assessment
 * 3. Language-specific context when available
 */
export const ENTITY_EXTRACTION_PROMPTS = {
  /**
   * Generic entity extraction for unknown languages.
   */
  generic: `You are analyzing code in an unfamiliar language. Extract entities from the following code chunk.

For each entity found, provide:
- name: The identifier name
- type: One of [function, class, variable, constant, type, module, unknown]
- purpose: A one-sentence description of what it does
- parameters: For functions, list parameter names
- returnType: For functions, describe what is returned
- dependencies: Other entities this references
- confidence: Your confidence in this extraction (0.0-1.0)

Respond with a JSON array of entities.

Code:
\`\`\`
{content}
\`\`\``,

  /**
   * COBOL-specific extraction.
   */
  cobol: `You are analyzing COBOL code. Extract entities following COBOL conventions.

Focus on:
- DIVISION, SECTION, and PARAGRAPH names
- WORKING-STORAGE variables
- PROCEDURE names
- PERFORM targets
- COPY statements (dependencies)

For each entity, provide:
- name: The COBOL identifier
- type: One of [division, section, paragraph, variable, copybook]
- purpose: What this entity represents
- dependencies: Referenced copybooks or called paragraphs
- confidence: Your confidence (0.0-1.0)

Respond with a JSON array.

Code:
\`\`\`cobol
{content}
\`\`\``,

  /**
   * Configuration file extraction.
   */
  config: `You are analyzing a configuration file. Extract the configuration structure.

For each configuration entity, provide:
- name: The configuration key or section name
- type: One of [section, key, list, map, reference]
- value: The configured value (if simple)
- purpose: What this configuration controls
- dependencies: Other configs or external resources referenced
- confidence: Your confidence (0.0-1.0)

Respond with a JSON array.

Configuration:
\`\`\`
{content}
\`\`\``,
};
```

### LLM Extraction Function

```typescript
import { ConfidenceValue, DerivedConfidence } from './confidence.js';

/**
 * Extract entities from chunks using LLM.
 *
 * @param chunks - Code chunks to analyze
 * @param language - Language identifier
 * @param llmService - LLM service instance
 * @returns Extracted entities with tier-adjusted confidence
 */
export async function extractEntitiesFromChunks(
  chunks: Chunk[],
  language: string,
  tierConfidence: ConfidenceValue,
  llmService: LLMService
): Promise<ExtractedEntity[]> {
  // Select appropriate prompt
  const promptTemplate = selectPromptTemplate(language);

  // Process chunks in parallel (with concurrency limit)
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const prompt = promptTemplate.replace('{content}', chunk.content);

      const response = await llmService.structured<LLMEntityResponse[]>(
        prompt,
        EntityArraySchema
      );

      // Convert LLM response to ExtractedEntity with confidence derivation
      return response.map(entity => ({
        ...entity,
        location: {
          startLine: chunk.startLine,
          endLine: chunk.endLine,
        },
        extractionSource: 'llm_tier3' as const,
        confidence: deriveEntityConfidence(
          tierConfidence,
          entity.confidence,
          chunk.hints
        ),
      }));
    })
  );

  return results.flat();
}

/**
 * Derive final entity confidence from tier confidence and LLM self-assessment.
 *
 * Formula: final = tier_multiplier * llm_self_assessment * hint_bonus
 */
function deriveEntityConfidence(
  tierConfidence: ConfidenceValue,
  llmSelfAssessment: number,
  hints: ChunkHints
): DerivedConfidence {
  // Get tier multiplier
  const tierValue = tierConfidence.type === 'bounded'
    ? tierConfidence.low  // Conservative: use lower bound
    : tierConfidence.type === 'deterministic'
      ? tierConfidence.value
      : 0.5;  // Absent: assume middle

  // Hint bonus: if chunking detected definition keywords, slight boost
  const hintBonus = hints.hasDefinitionKeywords ? 1.1 : 1.0;

  // Cap at tier's upper bound
  const upperBound = tierConfidence.type === 'bounded'
    ? tierConfidence.high
    : 1.0;

  const finalValue = Math.min(
    tierValue * llmSelfAssessment * hintBonus,
    upperBound
  );

  return {
    type: 'derived',
    value: finalValue,
    formula: 'min(tier_low * llm_assessment * hint_bonus, tier_high)',
    inputs: [
      { name: 'tier_confidence', confidence: tierConfidence },
      {
        name: 'llm_self_assessment',
        confidence: {
          type: 'bounded',
          low: llmSelfAssessment * 0.8,  // LLM tends to overestimate
          high: llmSelfAssessment,
          basis: 'theoretical',
          citation: 'LLM self-assessment calibrated down 20% based on overconfidence literature',
        }
      },
    ],
  };
}
```

### Confidence Calibration for LLM Extraction

```typescript
/**
 * Calibration data for LLM extraction confidence.
 *
 * This will be upgraded from 'bounded' to 'measured' as we collect
 * outcome data from actual usage.
 */
export interface LLMExtractionCalibration {
  language: string;
  chunkingStrategy: string;

  /** Current confidence (bounded until calibrated) */
  confidence: ConfidenceValue;

  /** Calibration status */
  calibrationStatus: 'uncalibrated' | 'partial' | 'calibrated';

  /** If calibrated, the measurement data */
  measurement?: {
    datasetId: string;
    sampleSize: number;
    accuracy: number;
    confidenceInterval: [number, number];
    measuredAt: string;
  };
}

/**
 * Get calibration data for a language/strategy combination.
 */
export function getExtractionCalibration(
  language: string,
  strategy: string
): LLMExtractionCalibration {
  // Initially, all are uncalibrated with bounded confidence
  return {
    language,
    chunkingStrategy: strategy,
    confidence: {
      type: 'bounded',
      low: 0.4,
      high: 0.7,
      basis: 'theoretical',
      citation: 'Default Tier 3 bounds; upgrade to measured after calibration',
    },
    calibrationStatus: 'uncalibrated',
  };
}
```

---

## 7. Integration Points

### Integration with Track B (Bootstrap)

```typescript
/**
 * Tier-aware bootstrap integration.
 *
 * The bootstrap pipeline (track-b-bootstrap.md) must be aware of tiers
 * because different tiers have different confidence characteristics.
 */
export interface TierAwareBootstrap {
  /**
   * Bootstrap Phase 1 (Structural Inventory) enhanced with tier detection.
   */
  structuralInventoryWithTiers(): Promise<{
    files: FileInventory[];
    tierDistribution: Map<LanguageTier, number>;
    overallTierConfidence: ConfidenceValue;
  }>;

  /**
   * Confidence aggregation across mixed-tier extractions.
   *
   * RULE: Overall confidence is LIMITED by the lowest tier with significant content.
   * A codebase with 90% Tier 1 and 10% Tier 3 has Tier 3 confidence for
   * cross-cutting queries.
   */
  aggregateTierConfidence(
    tierCounts: Map<LanguageTier, number>
  ): ConfidenceValue;
}

/**
 * Aggregate confidence across tiers.
 */
export function aggregateTierConfidence(
  tierCounts: Map<LanguageTier, number>
): DerivedConfidence {
  const total = Array.from(tierCounts.values()).reduce((a, b) => a + b, 0);
  if (total === 0) {
    return {
      type: 'derived',
      value: 0,
      formula: 'no_files',
      inputs: [],
    };
  }

  // Weight by file count, use lower bound of each tier
  let weightedSum = 0;
  const inputs: { name: string; confidence: ConfidenceValue }[] = [];

  for (const [tier, count] of tierCounts) {
    const tierConf = TIER_CONFIDENCE_BOUNDS[tier];
    const tierValue = tierConf.type === 'bounded' ? tierConf.low : tierConf.value;
    const weight = count / total;
    weightedSum += tierValue * weight;
    inputs.push({
      name: `tier_${tier}_weight_${(weight * 100).toFixed(0)}pct`,
      confidence: tierConf,
    });
  }

  return {
    type: 'derived',
    value: weightedSum,
    formula: 'weighted_sum(tier_confidence * tier_file_count / total)',
    inputs,
  };
}
```

### Integration with Track D (Quantification)

```typescript
/**
 * Tier confidence uses Track D's ConfidenceValue types.
 *
 * All tier confidence values MUST be one of:
 * - DeterministicConfidence (Tier 1 success)
 * - BoundedConfidence (Tier 2-4 ranges)
 * - DerivedConfidence (aggregated/composed)
 * - AbsentConfidence (extraction failed)
 *
 * NO RAW NUMBERS like `confidence: 0.7`
 */
export function validateTierConfidence(conf: ConfidenceValue): boolean {
  switch (conf.type) {
    case 'deterministic':
      return conf.value === 1.0 || conf.value === 0.0;
    case 'bounded':
      return conf.low >= 0 && conf.high <= 1 && conf.low <= conf.high;
    case 'derived':
      return conf.inputs.length > 0 && typeof conf.formula === 'string';
    case 'measured':
      return conf.measurement.sampleSize > 0;
    case 'absent':
      return ['uncalibrated', 'insufficient_data', 'not_applicable'].includes(conf.reason);
    default:
      return false;
  }
}
```

### Integration with Knowledge Store

```typescript
/**
 * Entity storage with tier metadata.
 *
 * Every stored entity includes tier information for:
 * 1. Confidence interpretation
 * 2. Re-extraction decisions
 * 3. Quality reporting
 */
export interface StoredEntity extends Entity {
  /** Tier at which this entity was extracted */
  extractionTier: LanguageTier;

  /** Chunking strategy used (Tier 3 only) */
  chunkingStrategy?: string;

  /** LLM model used for extraction (Tier 3-4) */
  llmModel?: string;

  /** Confidence with full provenance */
  confidence: ConfidenceValue;

  /** Timestamp of extraction */
  extractedAt: string;
}

/**
 * Query the knowledge store with tier-aware confidence filtering.
 */
export interface TierAwareQuery {
  /**
   * Filter results by minimum tier (higher = more confident).
   */
  minTier?: LanguageTier;

  /**
   * Include tier metadata in results.
   */
  includeTierMetadata?: boolean;

  /**
   * Aggregate confidence across result tiers.
   */
  aggregateConfidence?: boolean;
}
```

---

## 8. Implementation Roadmap

### Phase 1: Core Registry and Interfaces (~150 LOC)

**Deliverables**:
- `LanguageTier` type
- `TieredLanguageSupport` interface
- `TierCapabilities` interface
- `TIER_CONFIDENCE_BOUNDS` constants
- `UniversalLanguageRegistry` class (basic)

**Files**:
- `packages/LiBrainian/src/tiered/language_tier.ts`
- `packages/LiBrainian/src/tiered/language_registry.ts`

### Phase 2: Tier Detection and Fallback (~200 LOC)

**Deliverables**:
- `detectLanguageTier()` function
- `selectTierWithFallback()` function
- Extension-to-language mapping
- Content signature detection

**Files**:
- `packages/LiBrainian/src/tiered/tier_detection.ts`

### Phase 3: Chunking Strategies (~300 LOC)

**Deliverables**:
- `ChunkingStrategy` interface
- `functionBlockChunking` implementation
- `indentationChunking` implementation
- `blankLineChunking` implementation
- `commentGuidedChunking` implementation
- `selectChunkingStrategy()` function

**Files**:
- `packages/LiBrainian/src/tiered/chunking/index.ts`
- `packages/LiBrainian/src/tiered/chunking/function_blocks.ts`
- `packages/LiBrainian/src/tiered/chunking/indentation.ts`
- `packages/LiBrainian/src/tiered/chunking/blank_lines.ts`
- `packages/LiBrainian/src/tiered/chunking/comment_guided.ts`

### Phase 4: LLM Entity Extraction (~200 LOC)

**Deliverables**:
- `ENTITY_EXTRACTION_PROMPTS` templates
- `extractEntitiesFromChunks()` function
- `deriveEntityConfidence()` function
- Entity schema for structured output

**Files**:
- `packages/LiBrainian/src/tiered/llm_extraction.ts`
- `packages/LiBrainian/src/tiered/extraction_prompts.ts`

### Phase 5: Multimodal Support (~150 LOC)

**Deliverables**:
- Binary file detection
- Image artifact handling
- Vision-based extraction interface
- Tier 4 confidence handling

**Files**:
- `packages/LiBrainian/src/tiered/multimodal.ts`

### Phase 6: Integration and Tests (~300 LOC)

**Deliverables**:
- Integration with existing parser registry
- Integration with bootstrap pipeline
- Integration with knowledge store
- Comprehensive test suite

**Files**:
- `packages/LiBrainian/src/tiered/__tests__/language_tier.test.ts`
- `packages/LiBrainian/src/tiered/__tests__/chunking.test.ts`
- `packages/LiBrainian/src/tiered/__tests__/llm_extraction.test.ts`

### Total: ~1,300 LOC

---

## 9. Acceptance Criteria

### Core Functionality

- [ ] `UniversalLanguageRegistry` correctly assigns tiers to all test languages
- [ ] Fallback chain correctly degrades Tier 1 -> 2 -> 3 -> 4
- [ ] No file is rejected - every file gets a tier assignment
- [ ] All confidence values use `ConfidenceValue` types (no raw numbers)

### Chunking Strategies

- [ ] `functionBlockChunking` extracts function boundaries for C-like languages
- [ ] `indentationChunking` extracts blocks for Python-like languages
- [ ] `blankLineChunking` extracts sections for config files
- [ ] `commentGuidedChunking` extracts sections for well-commented code
- [ ] All strategies produce non-empty chunks for non-empty input

### LLM Extraction

- [ ] `extractEntitiesFromChunks()` produces valid entities
- [ ] Entity confidence is derived from tier confidence and LLM assessment
- [ ] Language-specific prompts are used when available
- [ ] Extraction handles LLM failures gracefully

### Integration

- [ ] Tier metadata is stored with extracted entities
- [ ] Bootstrap pipeline uses tier-aware extraction
- [ ] Confidence aggregation works across mixed-tier codebases
- [ ] Query API supports tier filtering

---

## 10. Evidence Commands

```bash
# Run tier detection tests
cd packages/LiBrainian && npx vitest run src/tiered/__tests__/language_tier.test.ts

# Run chunking strategy tests
cd packages/LiBrainian && npx vitest run src/tiered/__tests__/chunking.test.ts

# Run LLM extraction tests (requires provider)
cd packages/LiBrainian && npx vitest run src/tiered/__tests__/llm_extraction.test.ts

# Verify no raw confidence numbers
rg "confidence:\s*0\.\d" packages/LiBrainian/src/tiered --glob '*.ts' | wc -l
# Should return 0

# Verify tier exports
node -e "import('LiBrainian').then(m => console.log(Object.keys(m).filter(k => k.includes('Tier'))))"
```

---

## 11. Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification extracted from THEORETICAL_CRITIQUE.md Part XVII.A |
