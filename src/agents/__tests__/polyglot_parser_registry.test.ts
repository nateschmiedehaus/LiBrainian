import { describe, it, expect } from 'vitest';
import { ParserRegistry } from '../parser_registry.js';

const registry = ParserRegistry.getInstance();

function assertParserOrDiagnostic(
  extension: string,
  source: string,
  expectations: { languageModule: string; functionName: string; dependency?: string }
): void {
  let error: Error | null = null;
  let result: ReturnType<ParserRegistry['parseFile']> | null = null;

  try {
    result = registry.parseFile(`sample${extension}`, source);
  } catch (err) {
    error = err as Error;
  }

  if (!error) {
    expect(error).toBeNull();
    expect(result).toBeTruthy();
    expect(result?.functions.some((fn) => fn.name === expectations.functionName)).toBe(true);
    if (expectations.dependency) {
      expect(result?.module.dependencies).toContain(expectations.dependency);
    }
  } else {
    expect(error).toBeTruthy();
    expect(error?.message).toContain('unverified_by_trace(parser_unavailable)');
    expect(error?.message).toContain(expectations.languageModule);
    expect(error?.message.toLowerCase()).toContain('install');
  }
}

describe('ParserRegistry polyglot coverage', () => {
  it('parses Python when available or returns actionable diagnostics', () => {
    const pythonSource = `
import os
from typing import List

def add(a, b):
    return a + b
`;
    assertParserOrDiagnostic('.py', pythonSource, {
      languageModule: 'tree-sitter-python',
      functionName: 'add',
      dependency: 'os',
    });
  });

  it('parses Go when available or returns actionable diagnostics', () => {
    const goSource = `
package main

import "fmt"

func add(a int, b int) int {
    return a + b
}
`;
    assertParserOrDiagnostic('.go', goSource, {
      languageModule: 'tree-sitter-go',
      functionName: 'add',
      dependency: 'fmt',
    });
  });

  it('parses Kotlin when available or uses deterministic fallback', () => {
    const kotlinSource = `
package demo

import kotlin.io.println

fun add(a: Int, b: Int): Int {
  return a + b
}
`;
    assertParserOrDiagnostic('.kt', kotlinSource, {
      languageModule: 'tree-sitter-kotlin',
      functionName: 'add',
      dependency: 'kotlin.io.println',
    });
  });
});
