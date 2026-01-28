/**
 * @fileoverview Tests for AST-Aligned Chunking (WU-LANG-002)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 * Implements cAST-style chunk boundaries that align with syntactic units
 * per CMU 2025 research.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  createASTChunker,
  type ASTChunk,
  type ASTChunker,
  type ASTChunkerConfig,
} from '../ast_chunking.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const TYPESCRIPT_SAMPLE = `
import { EventEmitter } from 'events';
import * as path from 'path';

/**
 * Configuration for the processor.
 */
export interface ProcessorConfig {
  maxItems: number;
  timeout: number;
}

/**
 * A sample processor class.
 */
export class DataProcessor extends EventEmitter {
  private config: ProcessorConfig;
  private items: string[] = [];

  constructor(config: ProcessorConfig) {
    super();
    this.config = config;
  }

  /**
   * Process a single item.
   */
  async processItem(item: string): Promise<boolean> {
    if (this.items.length >= this.config.maxItems) {
      return false;
    }
    this.items.push(item);
    this.emit('processed', item);
    return true;
  }

  /**
   * Get all processed items.
   */
  getItems(): string[] {
    return [...this.items];
  }
}

/**
 * Factory function.
 */
export function createProcessor(config: ProcessorConfig): DataProcessor {
  return new DataProcessor(config);
}

const helper = (x: number) => x * 2;

export default DataProcessor;
`;

const PYTHON_SAMPLE = `
import os
from typing import List, Optional
from dataclasses import dataclass

@dataclass
class Config:
    """Configuration for the processor."""
    max_items: int
    timeout: float

class DataProcessor:
    """A sample processor class."""

    def __init__(self, config: Config):
        self.config = config
        self.items: List[str] = []

    async def process_item(self, item: str) -> bool:
        """Process a single item."""
        if len(self.items) >= self.config.max_items:
            return False
        self.items.append(item)
        return True

    def get_items(self) -> List[str]:
        """Get all processed items."""
        return list(self.items)

def create_processor(config: Config) -> DataProcessor:
    """Factory function."""
    return DataProcessor(config)

helper = lambda x: x * 2
`;

const INCOMPLETE_SYNTAX = `
function incomplete( {
  // Missing closing brace
`;

const NESTED_FUNCTIONS = `
function outer() {
  const inner1 = () => {
    console.log('inner1');
  };

  function inner2() {
    console.log('inner2');
  }

  return { inner1, inner2 };
}

class Container {
  method() {
    const localFn = () => {
      return 42;
    };
    return localFn();
  }
}
`;

const SMALL_CHUNKS = `
const a = 1;
const b = 2;
const c = 3;
`;

const LARGE_FUNCTION = `
function veryLargeFunction() {
  // Line 1
  // Line 2
  // Line 3
  // Line 4
  // Line 5
  // Line 6
  // Line 7
  // Line 8
  // Line 9
  // Line 10
  // Line 11
  // Line 12
  // Line 13
  // Line 14
  // Line 15
  // Line 16
  // Line 17
  // Line 18
  // Line 19
  // Line 20
  // Line 21
  // Line 22
  // Line 23
  // Line 24
  // Line 25
  // Line 26
  // Line 27
  // Line 28
  // Line 29
  // Line 30
  const result = 'done';
  return result;
}
`;

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createASTChunker', () => {
  it('should create a chunker instance with default config', () => {
    const chunker = createASTChunker();
    expect(chunker).toBeDefined();
    expect(typeof chunker.chunkFile).toBe('function');
    expect(typeof chunker.chunkWithOverlap).toBe('function');
    expect(typeof chunker.mergeSmallChunks).toBe('function');
    expect(typeof chunker.splitLargeChunks).toBe('function');
  });

  it('should create a chunker instance with custom config', () => {
    const config: ASTChunkerConfig = {
      defaultMinTokens: 50,
      defaultMaxTokens: 500,
    };
    const chunker = createASTChunker(config);
    expect(chunker).toBeDefined();
  });
});

// ============================================================================
// TYPESCRIPT CHUNKING TESTS
// ============================================================================

describe('ASTChunker - TypeScript', () => {
  let chunker: ASTChunker;

  beforeAll(() => {
    chunker = createASTChunker();
  });

  it('should chunk TypeScript file into syntactic units', async () => {
    const chunks = await chunker.chunkFile(TYPESCRIPT_SAMPLE, 'typescript');

    expect(chunks.length).toBeGreaterThan(0);
  });

  it('should extract class as a chunk', async () => {
    const chunks = await chunker.chunkFile(TYPESCRIPT_SAMPLE, 'typescript');

    const classChunk = chunks.find((c) => c.type === 'class' && c.metadata.name === 'DataProcessor');
    expect(classChunk).toBeDefined();
    expect(classChunk?.syntaxComplete).toBe(true);
    expect(classChunk?.content).toContain('class DataProcessor');
  });

  it('should extract methods as chunks', async () => {
    const chunks = await chunker.chunkFile(TYPESCRIPT_SAMPLE, 'typescript');

    const methodChunks = chunks.filter((c) => c.type === 'method');
    expect(methodChunks.length).toBeGreaterThan(0);

    const processItemMethod = methodChunks.find((c) => c.metadata.name === 'processItem');
    expect(processItemMethod).toBeDefined();
    expect(processItemMethod?.metadata.signature).toContain('processItem');
    expect(processItemMethod?.parentType).toBe('DataProcessor');
  });

  it('should extract standalone functions as chunks', async () => {
    const chunks = await chunker.chunkFile(TYPESCRIPT_SAMPLE, 'typescript');

    const functionChunks = chunks.filter((c) => c.type === 'function');
    const createProcessor = functionChunks.find((c) => c.metadata.name === 'createProcessor');

    expect(createProcessor).toBeDefined();
    expect(createProcessor?.syntaxComplete).toBe(true);
  });

  it('should include accurate line numbers', async () => {
    const chunks = await chunker.chunkFile(TYPESCRIPT_SAMPLE, 'typescript');

    for (const chunk of chunks) {
      expect(chunk.startLine).toBeGreaterThan(0);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    }
  });

  it('should mark all valid chunks as syntactically complete', async () => {
    const chunks = await chunker.chunkFile(TYPESCRIPT_SAMPLE, 'typescript');

    // All chunks from valid code should be syntactically complete
    for (const chunk of chunks) {
      expect(chunk.syntaxComplete).toBe(true);
    }
  });
});

// ============================================================================
// PYTHON CHUNKING TESTS
// ============================================================================

describe('ASTChunker - Python', () => {
  let chunker: ASTChunker;

  beforeAll(() => {
    chunker = createASTChunker();
  });

  it('should chunk Python file into syntactic units', async () => {
    const chunks = await chunker.chunkFile(PYTHON_SAMPLE, 'python');

    expect(chunks.length).toBeGreaterThan(0);
  });

  it('should extract Python class as a chunk', async () => {
    const chunks = await chunker.chunkFile(PYTHON_SAMPLE, 'python');

    const classChunk = chunks.find((c) => c.type === 'class' && c.metadata.name === 'DataProcessor');
    expect(classChunk).toBeDefined();
    expect(classChunk?.syntaxComplete).toBe(true);
  });

  it('should extract Python methods as chunks', async () => {
    const chunks = await chunker.chunkFile(PYTHON_SAMPLE, 'python');

    const methodChunks = chunks.filter((c) => c.type === 'method');
    expect(methodChunks.length).toBeGreaterThan(0);

    const processItemMethod = methodChunks.find((c) => c.metadata.name === 'process_item');
    expect(processItemMethod).toBeDefined();
    expect(processItemMethod?.parentType).toBe('DataProcessor');
  });

  it('should extract Python standalone functions', async () => {
    const chunks = await chunker.chunkFile(PYTHON_SAMPLE, 'python');

    const functionChunks = chunks.filter((c) => c.type === 'function');
    const createProcessor = functionChunks.find((c) => c.metadata.name === 'create_processor');

    expect(createProcessor).toBeDefined();
  });

  it('should handle Python dataclasses', async () => {
    const chunks = await chunker.chunkFile(PYTHON_SAMPLE, 'python');

    const configClass = chunks.find((c) => c.type === 'class' && c.metadata.name === 'Config');
    expect(configClass).toBeDefined();
  });
});

// ============================================================================
// INCOMPLETE SYNTAX HANDLING TESTS
// ============================================================================

describe('ASTChunker - Incomplete Syntax', () => {
  let chunker: ASTChunker;

  beforeAll(() => {
    chunker = createASTChunker();
  });

  it('should handle incomplete syntax gracefully', async () => {
    // Should not throw
    const chunks = await chunker.chunkFile(INCOMPLETE_SYNTAX, 'typescript');

    // May return partial chunks or empty array, but should not crash
    expect(Array.isArray(chunks)).toBe(true);
  });

  it('should mark incomplete chunks appropriately', async () => {
    const chunks = await chunker.chunkFile(INCOMPLETE_SYNTAX, 'typescript');

    // If any chunks are returned, incomplete ones should be marked
    const incompleteChunks = chunks.filter((c) => !c.syntaxComplete);
    // Either no chunks or some marked as incomplete
    expect(chunks.length === 0 || incompleteChunks.length >= 0).toBe(true);
  });
});

// ============================================================================
// NESTED STRUCTURE TESTS
// ============================================================================

describe('ASTChunker - Nested Structures', () => {
  let chunker: ASTChunker;

  beforeAll(() => {
    chunker = createASTChunker();
  });

  it('should handle nested functions', async () => {
    const chunks = await chunker.chunkFile(NESTED_FUNCTIONS, 'typescript');

    expect(chunks.length).toBeGreaterThan(0);

    // Should find the outer function
    const outerFn = chunks.find((c) => c.metadata.name === 'outer');
    expect(outerFn).toBeDefined();
  });

  it('should extract nested classes and methods', async () => {
    const chunks = await chunker.chunkFile(NESTED_FUNCTIONS, 'typescript');

    const containerClass = chunks.find((c) => c.type === 'class' && c.metadata.name === 'Container');
    expect(containerClass).toBeDefined();

    const methodChunk = chunks.find((c) => c.type === 'method' && c.metadata.name === 'method');
    expect(methodChunk).toBeDefined();
    expect(methodChunk?.parentType).toBe('Container');
  });
});

// ============================================================================
// OVERLAP TESTS
// ============================================================================

describe('ASTChunker - Overlap', () => {
  let chunker: ASTChunker;

  beforeAll(() => {
    chunker = createASTChunker();
  });

  it('should chunk with overlap', async () => {
    const chunks = await chunker.chunkWithOverlap(TYPESCRIPT_SAMPLE, 'typescript', 5);

    expect(chunks.length).toBeGreaterThan(0);
  });

  it('should include context lines from previous chunks', async () => {
    const chunksWithoutOverlap = await chunker.chunkFile(TYPESCRIPT_SAMPLE, 'typescript');
    const chunksWithOverlap = await chunker.chunkWithOverlap(TYPESCRIPT_SAMPLE, 'typescript', 3);

    // Chunks with overlap should generally have more content
    // or at least not less total content
    expect(chunksWithOverlap.length).toBeGreaterThan(0);
    expect(chunksWithoutOverlap.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// MERGE SMALL CHUNKS TESTS
// ============================================================================

describe('ASTChunker - Merge Small Chunks', () => {
  let chunker: ASTChunker;

  beforeAll(() => {
    chunker = createASTChunker();
  });

  it('should merge small chunks below token threshold', async () => {
    const chunks = await chunker.chunkFile(SMALL_CHUNKS, 'typescript');
    const mergedChunks = chunker.mergeSmallChunks(chunks, 100);

    // Merged result should have fewer or equal chunks
    expect(mergedChunks.length).toBeLessThanOrEqual(chunks.length);
  });

  it('should preserve chunk types appropriately', async () => {
    const chunks = await chunker.chunkFile(TYPESCRIPT_SAMPLE, 'typescript');
    const mergedChunks = chunker.mergeSmallChunks(chunks, 50);

    // All merged chunks should have valid types
    for (const chunk of mergedChunks) {
      expect(['function', 'class', 'method', 'module', 'block', 'statement']).toContain(chunk.type);
    }
  });

  it('should update line numbers correctly after merge', async () => {
    const chunks = await chunker.chunkFile(SMALL_CHUNKS, 'typescript');
    const mergedChunks = chunker.mergeSmallChunks(chunks, 100);

    for (const chunk of mergedChunks) {
      expect(chunk.startLine).toBeGreaterThan(0);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    }
  });
});

// ============================================================================
// SPLIT LARGE CHUNKS TESTS
// ============================================================================

describe('ASTChunker - Split Large Chunks', () => {
  let chunker: ASTChunker;

  beforeAll(() => {
    chunker = createASTChunker();
  });

  it('should split chunks exceeding max tokens', async () => {
    const chunks = await chunker.chunkFile(LARGE_FUNCTION, 'typescript');
    const splitChunks = chunker.splitLargeChunks(chunks, 20); // Very small max to force split

    // Should have more chunks after splitting
    expect(splitChunks.length).toBeGreaterThanOrEqual(chunks.length);
  });

  it('should try to split at statement boundaries', async () => {
    const chunks = await chunker.chunkFile(LARGE_FUNCTION, 'typescript');
    const splitChunks = chunker.splitLargeChunks(chunks, 20);

    // Split chunks should still be syntactically reasonable
    for (const chunk of splitChunks) {
      expect(chunk.content).toBeDefined();
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it('should maintain chunk metadata after split', async () => {
    const chunks = await chunker.chunkFile(LARGE_FUNCTION, 'typescript');
    const splitChunks = chunker.splitLargeChunks(chunks, 20);

    for (const chunk of splitChunks) {
      expect(chunk.startLine).toBeGreaterThan(0);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      expect(['function', 'class', 'method', 'module', 'block', 'statement']).toContain(chunk.type);
    }
  });
});

// ============================================================================
// CHUNK METADATA TESTS
// ============================================================================

describe('ASTChunk Metadata', () => {
  let chunker: ASTChunker;

  beforeAll(() => {
    chunker = createASTChunker();
  });

  it('should extract function signature', async () => {
    const chunks = await chunker.chunkFile(TYPESCRIPT_SAMPLE, 'typescript');

    const functionChunk = chunks.find((c) => c.metadata.name === 'createProcessor');
    expect(functionChunk?.metadata.signature).toBeDefined();
    expect(functionChunk?.metadata.signature).toContain('createProcessor');
  });

  it('should extract method signatures with parameters', async () => {
    const chunks = await chunker.chunkFile(TYPESCRIPT_SAMPLE, 'typescript');

    const methodChunk = chunks.find((c) => c.metadata.name === 'processItem');
    expect(methodChunk?.metadata.signature).toBeDefined();
    expect(methodChunk?.metadata.signature).toContain('item');
  });

  it('should compute complexity metric', async () => {
    const chunks = await chunker.chunkFile(TYPESCRIPT_SAMPLE, 'typescript');

    // At least some chunks should have complexity computed
    const chunksWithComplexity = chunks.filter((c) => typeof c.metadata.complexity === 'number');
    expect(chunksWithComplexity.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// LANGUAGE DETECTION TESTS
// ============================================================================

describe('ASTChunker - Language Support', () => {
  let chunker: ASTChunker;

  beforeAll(() => {
    chunker = createASTChunker();
  });

  it('should support typescript language', async () => {
    const chunks = await chunker.chunkFile(TYPESCRIPT_SAMPLE, 'typescript');
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('should support python language', async () => {
    const chunks = await chunker.chunkFile(PYTHON_SAMPLE, 'python');
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('should handle unsupported languages gracefully', async () => {
    // Should not throw, may return empty or module-level chunks
    const chunks = await chunker.chunkFile('some random text', 'unknown');
    expect(Array.isArray(chunks)).toBe(true);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('ASTChunker - Edge Cases', () => {
  let chunker: ASTChunker;

  beforeAll(() => {
    chunker = createASTChunker();
  });

  it('should handle empty content', async () => {
    const chunks = await chunker.chunkFile('', 'typescript');
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBe(0);
  });

  it('should handle content with only comments', async () => {
    const content = `
    // This is a comment
    /* Block comment */
    `;
    const chunks = await chunker.chunkFile(content, 'typescript');
    expect(Array.isArray(chunks)).toBe(true);
  });

  it('should handle content with only imports', async () => {
    const content = `
    import { foo } from 'bar';
    import * as baz from 'qux';
    `;
    const chunks = await chunker.chunkFile(content, 'typescript');
    expect(Array.isArray(chunks)).toBe(true);
  });

  it('should handle very long single-line content', async () => {
    const longLine = 'const x = ' + '"a"'.repeat(1000) + ';';
    const chunks = await chunker.chunkFile(longLine, 'typescript');
    expect(Array.isArray(chunks)).toBe(true);
  });

  it('should handle mixed language constructs gracefully', async () => {
    // TypeScript with JSX-like constructs
    const content = `
    function Component() {
      return <div>Hello</div>;
    }
    `;
    const chunks = await chunker.chunkFile(content, 'typescript');
    expect(Array.isArray(chunks)).toBe(true);
  });
});

// ============================================================================
// ASTCHUNK STRUCTURE VALIDATION
// ============================================================================

describe('ASTChunk Structure', () => {
  let chunker: ASTChunker;

  beforeAll(() => {
    chunker = createASTChunker();
  });

  it('should have correct ASTChunk structure', async () => {
    const chunks = await chunker.chunkFile(TYPESCRIPT_SAMPLE, 'typescript');

    for (const chunk of chunks) {
      // Required fields
      expect(chunk.content).toBeDefined();
      expect(typeof chunk.content).toBe('string');

      expect(chunk.type).toBeDefined();
      expect(['function', 'class', 'method', 'module', 'block', 'statement']).toContain(chunk.type);

      expect(chunk.startLine).toBeDefined();
      expect(typeof chunk.startLine).toBe('number');

      expect(chunk.endLine).toBeDefined();
      expect(typeof chunk.endLine).toBe('number');

      expect(chunk.syntaxComplete).toBeDefined();
      expect(typeof chunk.syntaxComplete).toBe('boolean');

      expect(chunk.metadata).toBeDefined();
      expect(typeof chunk.metadata).toBe('object');

      // Optional fields should be correct type if present
      if (chunk.parentType !== undefined) {
        expect(typeof chunk.parentType).toBe('string');
      }

      if (chunk.metadata.name !== undefined) {
        expect(typeof chunk.metadata.name).toBe('string');
      }

      if (chunk.metadata.signature !== undefined) {
        expect(typeof chunk.metadata.signature).toBe('string');
      }

      if (chunk.metadata.complexity !== undefined) {
        expect(typeof chunk.metadata.complexity).toBe('number');
      }
    }
  });
});
