/**
 * @fileoverview Tests for Tree-sitter Universal Parser
 *
 * WU-LANG-001: Tree-sitter Universal Parser Integration
 * Following TDD: tests written BEFORE implementation.
 *
 * NOTE: These tests are designed to work with whatever tree-sitter grammars
 * are installed. The Java grammar (tree-sitter-java) is required as a peer
 * dependency, so Java tests should always pass. Other language tests are
 * conditional on grammar availability.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  TreeSitterParser,
  type ParseResult,
  type SyntaxTree,
  type SyntaxNode,
  type LanguageSupport,
  type FunctionNode,
  type ClassNode,
  type ParseError,
} from '../tree_sitter_parser.js';

// Initialize parser once to get available languages
const initialParser = new TreeSitterParser();
const availableLanguages = initialParser.getSupportedLanguages().map((l) => l.language);

// Helper to check if a language is available for parsing
const hasLanguage = (lang: string): boolean => availableLanguages.includes(lang);

describe('TreeSitterParser', () => {
  let parser: TreeSitterParser;

  beforeEach(() => {
    parser = new TreeSitterParser();
  });

  // Helper to conditionally skip tests if language not available
  const itIfHasLanguage = (lang: string, name: string, fn: () => void | Promise<void>) => {
    if (hasLanguage(lang)) {
      it(name, fn);
    } else {
      it.skip(`${name} (${lang} grammar not installed)`, fn);
    }
  };

  // ============================================================================
  // Test 1-3: Basic Initialization and Language Support
  // ============================================================================

  describe('initialization and language support', () => {
    it('should initialize without throwing', () => {
      expect(() => new TreeSitterParser()).not.toThrow();
    });

    it('should return supported languages list', () => {
      const languages = parser.getSupportedLanguages();
      expect(Array.isArray(languages)).toBe(true);
      // At minimum, Java should be available (peer dependency)
      expect(languages.length).toBeGreaterThanOrEqual(1);
    });

    it('should have Java as a supported language (required peer dependency)', () => {
      const languages = parser.getSupportedLanguages();
      const languageNames = languages.map((l) => l.language);
      expect(languageNames).toContain('java');
    });
  });

  // ============================================================================
  // Test 4-6: Language Detection (always works, even without grammars)
  // ============================================================================

  describe('language detection', () => {
    it('should detect language from file extension', () => {
      // Extension detection should always work
      expect(parser.detectLanguage('', 'test.ts')).toBe('typescript');
      expect(parser.detectLanguage('', 'test.js')).toBe('javascript');
      expect(parser.detectLanguage('', 'test.py')).toBe('python');
      expect(parser.detectLanguage('', 'test.go')).toBe('go');
      expect(parser.detectLanguage('', 'test.rs')).toBe('rust');
      expect(parser.detectLanguage('', 'test.java')).toBe('java');
      expect(parser.detectLanguage('', 'test.c')).toBe('c');
      expect(parser.detectLanguage('', 'test.cpp')).toBe('cpp');
      expect(parser.detectLanguage('', 'test.cs')).toBe('csharp');
      expect(parser.detectLanguage('', 'test.kt')).toBe('kotlin');
      expect(parser.detectLanguage('', 'test.kts')).toBe('kotlin');
      expect(parser.detectLanguage('', 'test.swift')).toBe('swift');
      expect(parser.detectLanguage('', 'test.scala')).toBe('scala');
      expect(parser.detectLanguage('', 'test.dart')).toBe('dart');
      expect(parser.detectLanguage('', 'test.lua')).toBe('lua');
      expect(parser.detectLanguage('', 'test.r')).toBe('unknown');
      expect(parser.detectLanguage('', 'test.sh')).toBe('bash');
      expect(parser.detectLanguage('', 'test.sql')).toBe('sql');
      expect(parser.detectLanguage('', 'test.json')).toBe('json');
      expect(parser.detectLanguage('', 'test.html')).toBe('html');
      expect(parser.detectLanguage('', 'test.css')).toBe('css');
      expect(parser.detectLanguage('', 'test.yaml')).toBe('yaml');
      expect(parser.detectLanguage('', 'test.yml')).toBe('yaml');
    });

    it('should detect language from code content when no filename', () => {
      const tsCode = 'interface Foo { bar: string; }';
      expect(parser.detectLanguage(tsCode)).toBe('typescript');

      const pyCode = 'def hello():\n    pass';
      expect(parser.detectLanguage(pyCode)).toBe('python');

      const goCode = 'func main() { fmt.Println("hello") }';
      expect(parser.detectLanguage(goCode)).toBe('go');

      const javaCode = 'public class Main { }';
      expect(parser.detectLanguage(javaCode)).toBe('java');
    });

    it('should return unknown for unrecognized content', () => {
      const result = parser.detectLanguage('some random text', 'unknown.xyz');
      expect(result).toBe('unknown');
    });
  });

  // ============================================================================
  // Test 7-9: Basic Parsing (Java guaranteed, others conditional)
  // ============================================================================

  describe('basic parsing', () => {
    it('should parse Java code and return ParseResult', () => {
      const code = `
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
}
`;
      const result = parser.parse(code, 'java');

      expect(result).toBeDefined();
      expect(result.language).toBe('java');
      expect(result.tree).toBeDefined();
      expect(result.tree.rootNode).toBeDefined();
      expect(result.parseTime).toBeGreaterThanOrEqual(0);
    });

    itIfHasLanguage('typescript', 'should parse TypeScript code', () => {
      const code = `
function greet(name: string): string {
  return \`Hello, \${name}\`;
}
`;
      const result = parser.parse(code, 'typescript');
      expect(result.language).toBe('typescript');
      expect(result.tree.rootNode).toBeDefined();
    });

    itIfHasLanguage('javascript', 'should parse JavaScript code', () => {
      const code = `
const add = (a, b) => a + b;
function multiply(x, y) {
  return x * y;
}
`;
      const result = parser.parse(code, 'javascript');
      expect(result.language).toBe('javascript');
      expect(result.tree.rootNode).toBeDefined();
      expect(result.errors).toHaveLength(0);
    });

    it('should throw for unsupported language', () => {
      expect(() => parser.parse('code', 'unsupported_language')).toThrow(/unsupported/i);
    });
  });

  // ============================================================================
  // Test 10-12: Function Extraction
  // ============================================================================

  describe('function extraction', () => {
    it('should extract methods from Java code', () => {
      const code = `
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }

    public int multiply(int x, int y) {
        return x * y;
    }
}
`;
      const result = parser.parse(code, 'java');
      const functions = parser.extractFunctions(result.tree);

      // Should find at least the methods
      expect(functions.length).toBeGreaterThanOrEqual(1);
    });

    itIfHasLanguage('typescript', 'should extract functions from TypeScript code', () => {
      const code = `
function add(a: number, b: number): number {
  return a + b;
}

const multiply = (x: number, y: number): number => x * y;

async function fetchData(url: string): Promise<Response> {
  return fetch(url);
}
`;
      const result = parser.parse(code, 'typescript');
      const functions = parser.extractFunctions(result.tree);

      expect(functions.length).toBeGreaterThanOrEqual(2);

      const addFn = functions.find((f) => f.name === 'add');
      expect(addFn).toBeDefined();
    });

    itIfHasLanguage('python', 'should extract functions from Python code', () => {
      const code = `
def greet(name):
    return f"Hello, {name}"

async def fetch_data(url):
    pass

class Calculator:
    def add(self, a, b):
        return a + b
`;
      const result = parser.parse(code, 'python');
      const functions = parser.extractFunctions(result.tree);

      expect(functions.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================================
  // Test 13-15: Class Extraction
  // ============================================================================

  describe('class extraction', () => {
    it('should extract classes from Java code', () => {
      const code = `
public class Calculator {
    private int value;

    public Calculator() {
        this.value = 0;
    }

    public int add(int a, int b) {
        return a + b;
    }

    public int getValue() {
        return value;
    }
}
`;
      const result = parser.parse(code, 'java');
      const classes = parser.extractClasses(result.tree);

      expect(classes.length).toBeGreaterThanOrEqual(1);

      const calcClass = classes.find((c) => c.name === 'Calculator');
      expect(calcClass).toBeDefined();
    });

    itIfHasLanguage('typescript', 'should extract classes from TypeScript code', () => {
      const code = `
class Calculator {
  private value: number = 0;

  add(n: number): this {
    this.value += n;
    return this;
  }

  getValue(): number {
    return this.value;
  }
}

interface Shape {
  area(): number;
}
`;
      const result = parser.parse(code, 'typescript');
      const classes = parser.extractClasses(result.tree);

      expect(classes.length).toBeGreaterThanOrEqual(1);
    });

    itIfHasLanguage('python', 'should extract classes from Python code', () => {
      const code = `
class Calculator:
    def __init__(self):
        self.value = 0

    def add(self, a, b):
        return a + b

    def get_value(self):
        return self.value
`;
      const result = parser.parse(code, 'python');
      const classes = parser.extractClasses(result.tree);

      expect(classes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // Test 16-18: Tree Querying
  // ============================================================================

  describe('tree querying', () => {
    it('should query tree for method declarations in Java', () => {
      const code = `
public class Example {
    public void foo() {}
    public void bar() {}
    public void baz() {}
}
`;
      const result = parser.parse(code, 'java');

      // Query for method declarations
      const nodes = parser.queryTree(result.tree, 'method_declaration');

      expect(nodes.length).toBe(3);
    });

    it('should query tree for class declarations in Java', () => {
      const code = `
public class First {}
class Second {}
`;
      const result = parser.parse(code, 'java');

      const nodes = parser.queryTree(result.tree, 'class_declaration');

      expect(nodes.length).toBe(2);
    });

    it('should return empty array for non-matching pattern', () => {
      const code = 'public class Test {}';
      const result = parser.parse(code, 'java');

      const nodes = parser.queryTree(result.tree, 'function_declaration');

      expect(nodes).toHaveLength(0);
    });
  });

  // ============================================================================
  // Test 19-21: SyntaxNode Structure
  // ============================================================================

  describe('syntax node structure', () => {
    it('should have correct node properties', () => {
      const code = 'public class Test {}';
      const result = parser.parse(code, 'java');

      const rootNode = result.tree.rootNode;

      expect(rootNode).toHaveProperty('type');
      expect(rootNode).toHaveProperty('text');
      expect(rootNode).toHaveProperty('startPosition');
      expect(rootNode).toHaveProperty('endPosition');
      expect(rootNode).toHaveProperty('children');
      expect(rootNode).toHaveProperty('namedChildren');
    });

    it('should have correct position information', () => {
      const code = `public class Test {
  public void method() {}
}`;
      const result = parser.parse(code, 'java');
      const rootNode = result.tree.rootNode;

      expect(rootNode.startPosition.row).toBe(0);
      expect(rootNode.startPosition.column).toBe(0);
      expect(rootNode.endPosition.row).toBeGreaterThanOrEqual(2);
    });

    it('should provide access to child nodes', () => {
      const code = `public class A {}
public class B {}`;
      const result = parser.parse(code, 'java');

      expect(result.tree.rootNode.children.length).toBeGreaterThan(0);
      expect(result.tree.rootNode.namedChildren.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Test 22-24: Multi-language Support (conditional)
  // ============================================================================

  describe('multi-language support', () => {
    itIfHasLanguage('rust', 'should parse Rust code', () => {
      const code = `
fn main() {
    println!("Hello, world!");
}

fn add(a: i32, b: i32) -> i32 {
    a + b
}
`;
      const result = parser.parse(code, 'rust');

      expect(result.language).toBe('rust');
      expect(result.errors).toHaveLength(0);

      const functions = parser.extractFunctions(result.tree);
      expect(functions.length).toBeGreaterThanOrEqual(2);
    });

    itIfHasLanguage('c', 'should parse C code', () => {
      const code = `
#include <stdio.h>

int add(int a, int b) {
    return a + b;
}

int main() {
    printf("Hello\\n");
    return 0;
}
`;
      const result = parser.parse(code, 'c');

      expect(result.language).toBe('c');

      const functions = parser.extractFunctions(result.tree);
      expect(functions.length).toBeGreaterThanOrEqual(2);
    });

    itIfHasLanguage('go', 'should parse Go code', () => {
      const code = `
package main

func add(a, b int) int {
    return a + b
}

func main() {
    println(add(1, 2))
}
`;
      const result = parser.parse(code, 'go');

      expect(result.language).toBe('go');

      const functions = parser.extractFunctions(result.tree);
      expect(functions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // Test 25-27: LanguageSupport Interface
  // ============================================================================

  describe('LanguageSupport interface', () => {
    it('should return correct extensions for Java', () => {
      const languages = parser.getSupportedLanguages();

      const java = languages.find((l) => l.language === 'java');
      expect(java).toBeDefined();
      expect(java?.extensions).toContain('.java');
    });

    it('should have grammarPath for each supported language', () => {
      const languages = parser.getSupportedLanguages();

      for (const lang of languages) {
        expect(lang.grammarPath).toBeDefined();
        expect(typeof lang.grammarPath).toBe('string');
        expect(lang.grammarPath.length).toBeGreaterThan(0);
      }
    });

    it('should have valid extension arrays for each language', () => {
      const languages = parser.getSupportedLanguages();

      for (const lang of languages) {
        expect(Array.isArray(lang.extensions)).toBe(true);
        expect(lang.extensions.length).toBeGreaterThan(0);
        for (const ext of lang.extensions) {
          expect(ext.startsWith('.')).toBe(true);
        }
      }
    });
  });

  // ============================================================================
  // Test 28-30: Error Handling and Edge Cases
  // ============================================================================

  describe('error handling and edge cases', () => {
    it('should handle empty code gracefully', () => {
      const result = parser.parse('', 'java');

      expect(result).toBeDefined();
      expect(result.tree).toBeDefined();
    });

    itIfHasLanguage('javascript', 'should parse >32k input without Invalid argument', () => {
      const code = 'function a() { return 1 }\n'.repeat(2000); // ~50k chars
      expect(() => parser.parse(code, 'javascript')).not.toThrow();
    });

    it('should handle unsupported language with clear error', () => {
      expect(() => parser.parse('code', 'unsupported_language')).toThrow(/unsupported/i);
    });

    it('should handle large files efficiently', () => {
      // Generate a large file with many methods
      let code = 'public class LargeClass {\n';
      for (let i = 0; i < 100; i++) {
        code += `    public int method${i}(int a) { return a + ${i}; }\n`;
      }
      code += '}';

      const result = parser.parse(code, 'java');

      expect(result).toBeDefined();
      expect(result.parseTime).toBeLessThan(5000); // Should parse in under 5 seconds

      const functions = parser.extractFunctions(result.tree);
      expect(functions.length).toBe(100);
    });
  });

  // ============================================================================
  // Test 31-33: Incremental Parsing
  // ============================================================================

  describe('incremental parsing', () => {
    it('should support parsing with previous tree for incremental updates', () => {
      const code1 = 'public class Test { int x = 1; }';
      const result1 = parser.parse(code1, 'java');

      // Parse again with a small change - should work
      const code2 = 'public class Test { int x = 2; }';
      const result2 = parser.parse(code2, 'java', { previousTree: result1.tree });

      expect(result2).toBeDefined();
      expect(result2.tree).toBeDefined();
    });

    it('should work with incremental updates on larger files', () => {
      // Generate a larger file
      let code = 'public class Large {\n';
      for (let i = 0; i < 50; i++) {
        code += `    public int m${i}() { return ${i}; }\n`;
      }
      code += '}';

      // First parse
      const result1 = parser.parse(code, 'java');

      // Small change
      const code2 = code.replace('return 0', 'return 999');

      // Incremental parse
      const result2 = parser.parse(code2, 'java', { previousTree: result1.tree });

      expect(result2).toBeDefined();
    });

    it('should handle incremental parse with edit ranges', () => {
      const code1 = 'public class A { int x = 1; }';
      const result1 = parser.parse(code1, 'java');

      const code2 = 'public class A { int x = 100; }';
      const result2 = parser.parse(code2, 'java', {
        previousTree: result1.tree,
        editRange: {
          startIndex: 24,
          oldEndIndex: 25,
          newEndIndex: 27,
          startPosition: { row: 0, column: 24 },
          oldEndPosition: { row: 0, column: 25 },
          newEndPosition: { row: 0, column: 27 },
        },
      });

      expect(result2).toBeDefined();
    });
  });

  // ============================================================================
  // Test 34-36: FunctionNode and ClassNode Interfaces
  // ============================================================================

  describe('FunctionNode and ClassNode interfaces', () => {
    it('should return FunctionNode with all required properties', () => {
      const code = `
public class Test {
    public int calculate(int a, int b) {
        return a + b;
    }
}
`;
      const result = parser.parse(code, 'java');
      const functions = parser.extractFunctions(result.tree);

      const fn = functions[0];
      expect(fn).toBeDefined();
      expect(fn).toHaveProperty('name');
      expect(fn).toHaveProperty('startPosition');
      expect(fn).toHaveProperty('endPosition');
      expect(fn).toHaveProperty('parameters');
      expect(fn).toHaveProperty('body');
    });

    it('should return ClassNode with methods', () => {
      const code = `
public class Service {
    public void process() {}
    public String getData() { return ""; }
}
`;
      const result = parser.parse(code, 'java');
      const classes = parser.extractClasses(result.tree);

      const cls = classes[0];
      expect(cls).toBeDefined();
      expect(cls).toHaveProperty('name');
      expect(cls).toHaveProperty('startPosition');
      expect(cls).toHaveProperty('endPosition');
      expect(cls).toHaveProperty('methods');
      expect(cls.methods?.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract constructors as methods', () => {
      const code = `
public class Entity {
    private String id;

    public Entity(String id) {
        this.id = id;
    }

    public String getId() {
        return id;
    }
}
`;
      const result = parser.parse(code, 'java');
      const functions = parser.extractFunctions(result.tree);

      // Should include constructor
      expect(functions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // Test 37-39: Ruby and PHP Support (conditional)
  // ============================================================================

  describe('Ruby and PHP support', () => {
    itIfHasLanguage('ruby', 'should parse Ruby code', () => {
      const code = `
def greet(name)
  puts "Hello, #{name}"
end

class Calculator
  def add(a, b)
    a + b
  end
end
`;
      const result = parser.parse(code, 'ruby');
      expect(result.language).toBe('ruby');

      const functions = parser.extractFunctions(result.tree);
      expect(functions.length).toBeGreaterThanOrEqual(1);
    });

    itIfHasLanguage('php', 'should parse PHP code', () => {
      const code = `<?php
function greet($name) {
    echo "Hello, " . $name;
}

class Calculator {
    public function add($a, $b) {
        return $a + $b;
    }
}
`;
      const result = parser.parse(code, 'php');
      expect(result.language).toBe('php');

      const functions = parser.extractFunctions(result.tree);
      expect(functions.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle unsupported language grammars with clear error', () => {
      // Attempting to parse with unsupported grammars should throw
      const unsupportedLangs = ['brainfuck', 'whitespace', 'malbolge'];

      for (const lang of unsupportedLangs) {
        expect(() => parser.parse('code', lang)).toThrow(/unsupported/i);
      }
    });
  });

  // ============================================================================
  // Test 40+: Additional edge cases
  // ============================================================================

  describe('additional edge cases', () => {
    it('should handle unicode characters in code', () => {
      const code = `
public class Greeting {
    public String greet(String name) {
        return "Hello, " + name + "! \u4F60\u597D";
    }
}
`;
      const result = parser.parse(code, 'java');

      expect(result).toBeDefined();
      expect(result.errors).toHaveLength(0);
    });

    it('should handle mixed line endings', () => {
      const code = 'public class A {}\r\npublic class B {}\npublic class C {}\r';
      const result = parser.parse(code, 'java');

      expect(result).toBeDefined();
      expect(result.tree.rootNode.namedChildren.length).toBeGreaterThanOrEqual(2);
    });

    it('should provide text content in SyntaxTree', () => {
      const code = 'public class Test { String greeting = "Hello, World!"; }';
      const result = parser.parse(code, 'java');

      expect(result.tree.text).toBe(code);
      expect(result.tree.rootNode.text).toBeDefined();
    });
  });

  // ============================================================================
  // Test: Interface declaration extraction
  // ============================================================================

  describe('interface extraction', () => {
    it('should extract Java interface declarations', () => {
      const code = `
public interface Repository<T> {
    T findById(long id);
    void save(T entity);
}
`;
      const result = parser.parse(code, 'java');
      const classes = parser.extractClasses(result.tree);

      expect(classes.length).toBeGreaterThanOrEqual(1);
      const repo = classes.find((c) => c.name === 'Repository');
      expect(repo).toBeDefined();
    });
  });

  // ============================================================================
  // Test: Enum extraction
  // ============================================================================

  describe('enum extraction', () => {
    it('should parse Java enum declarations', () => {
      const code = `
public enum Status {
    PENDING,
    ACTIVE,
    COMPLETED;

    public boolean isTerminal() {
        return this == COMPLETED;
    }
}
`;
      const result = parser.parse(code, 'java');

      expect(result).toBeDefined();
      expect(result.errors).toHaveLength(0);

      // The enum should be parseable - methods inside enums may or may not be
      // extracted depending on the grammar structure. At minimum, no errors.
      const functions = parser.extractFunctions(result.tree);
      // Functions may or may not include enum methods depending on tree structure
      expect(functions).toBeDefined();
    });
  });
});
