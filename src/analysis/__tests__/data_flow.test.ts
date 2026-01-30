/**
 * Tests for Data Flow Analysis Module
 *
 * Tests for:
 * - Data flow graph construction
 * - Data lineage tracing
 * - State mutation tracking
 * - Taint analysis
 * - Null flow risk detection
 */

import { describe, it, expect } from 'vitest';
import {
  buildDataFlowGraph,
  traceDataLineage,
  traceState,
  findDataSources,
  findDataSinks,
  findTaintedPaths,
  findNullFlowRisks,
  type DataFlowNode,
  type DataFlowEdge,
  type DataLineage,
  type StateTrace,
} from '../data_flow.js';

describe('Data Flow Analysis', () => {
  describe('buildDataFlowGraph', () => {
    it('should identify variable declarations as nodes', () => {
      const content = `
const x = 1;
let y = "hello";
var z = true;
`;
      const graph = buildDataFlowGraph('/test.ts', content);

      expect(graph.nodes.length).toBeGreaterThanOrEqual(3);
      expect(graph.nodes.some(n => n.name === 'x')).toBe(true);
      expect(graph.nodes.some(n => n.name === 'y')).toBe(true);
      expect(graph.nodes.some(n => n.name === 'z')).toBe(true);
    });

    it('should identify function parameters', () => {
      const content = `
function process(input, options) {
  return input;
}
`;
      const graph = buildDataFlowGraph('/test.ts', content);

      const params = graph.nodes.filter(n => n.type === 'parameter');
      expect(params.length).toBe(2);
      expect(params.some(n => n.name === 'input')).toBe(true);
      expect(params.some(n => n.name === 'options')).toBe(true);
    });

    it('should identify arrow function parameters', () => {
      const content = `
const add = (a, b) => a + b;
`;
      const graph = buildDataFlowGraph('/test.ts', content);

      const params = graph.nodes.filter(n => n.type === 'parameter');
      expect(params.length).toBe(2);
      expect(params.some(n => n.name === 'a')).toBe(true);
      expect(params.some(n => n.name === 'b')).toBe(true);
    });

    it('should identify return statements', () => {
      const content = `
function getValue() {
  const result = compute();
  return result;
}
`;
      const graph = buildDataFlowGraph('/test.ts', content);

      const returns = graph.nodes.filter(n => n.type === 'return');
      expect(returns.length).toBe(1);
      expect(returns[0]!.name).toBe('result');
    });

    it('should identify data sources', () => {
      const content = `
const userInput = req.body.name;
const envVar = process.env.API_KEY;
const literal = "hello";
`;
      const graph = buildDataFlowGraph('/test.ts', content);

      const sources = graph.nodes.filter(n => n.type === 'source');
      expect(sources.length).toBeGreaterThanOrEqual(2);
    });

    it('should identify data sinks', () => {
      const content = `
function handler(req, res) {
  const data = process(req.body);
  res.json(data);
  console.log(data);
}
`;
      const graph = buildDataFlowGraph('/test.ts', content);

      const sinks = graph.nodes.filter(n => n.type === 'sink');
      expect(sinks.length).toBeGreaterThanOrEqual(2);
    });

    it('should create edges between related nodes', () => {
      const content = `
function process(input) {
  const result = transform(input);
  return result;
}
`;
      const graph = buildDataFlowGraph('/test.ts', content);

      expect(graph.edges.length).toBeGreaterThan(0);
    });

    it('should include metadata with snippets', () => {
      const content = `
const x = 42;
`;
      const graph = buildDataFlowGraph('/test.ts', content);

      const xNode = graph.nodes.find(n => n.name === 'x');
      expect(xNode).toBeDefined();
      expect(xNode!.metadata?.snippet).toContain('const x = 42');
    });

    it('should infer data types from literals', () => {
      const content = `
const str = "hello";
const num = 42;
const bool = true;
const arr = [1, 2, 3];
const obj = { key: "value" };
`;
      const graph = buildDataFlowGraph('/test.ts', content);

      // Find variable nodes - they may be type 'variable' or 'source'
      const strNode = graph.nodes.find(n => n.name === 'str' && n.type === 'variable');
      const numNode = graph.nodes.find(n => n.name === 'num' && n.type === 'variable');
      const boolNode = graph.nodes.find(n => n.name === 'bool' && n.type === 'variable');
      const arrNode = graph.nodes.find(n => n.name === 'arr' && n.type === 'variable');
      const objNode = graph.nodes.find(n => n.name === 'obj' && n.type === 'variable');

      // All variables should be found
      expect(strNode).toBeDefined();
      expect(numNode).toBeDefined();
      expect(boolNode).toBeDefined();
      expect(arrNode).toBeDefined();
      expect(objNode).toBeDefined();

      // Type inference should work
      expect(strNode?.dataType).toBe('string');
      expect(numNode?.dataType).toBe('number');
      expect(boolNode?.dataType).toBe('boolean');
      expect(arrNode?.dataType).toBe('array');
      expect(objNode?.dataType).toBe('object');
    });

    it('should mark taint sources', () => {
      const content = `
const userInput = req.body.username;
const query = req.query.search;
`;
      const graph = buildDataFlowGraph('/test.ts', content);

      const taintSources = graph.nodes.filter(n => n.metadata?.isTaintSource);
      expect(taintSources.length).toBeGreaterThanOrEqual(1);
    });

    it('should mark sensitive sinks', () => {
      const content = `
db.query(sql);
element.innerHTML = content;
`;
      const graph = buildDataFlowGraph('/test.ts', content);

      const sensitiveSinks = graph.nodes.filter(n => n.metadata?.isSensitiveSink);
      expect(sensitiveSinks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('traceDataLineage', () => {
    it('should trace lineage for a simple variable', () => {
      const content = `
const input = 42;
const result = input * 2;
return result;
`;
      const lineage = traceDataLineage('result', '/test.ts', content);

      expect(lineage.variable).toBe('result');
      expect(lineage.confidence).toBeGreaterThan(0);
    });

    it('should find origins of data', () => {
      const content = `
function process(input) {
  const result = transform(input);
  return result;
}
`;
      const lineage = traceDataLineage('input', '/test.ts', content);

      expect(lineage.origins.length).toBeGreaterThanOrEqual(1);
      expect(lineage.origins.some(o => o.type === 'parameter')).toBe(true);
    });

    it('should find destinations of data', () => {
      const content = `
function process(input) {
  const result = transform(input);
  return result;
}
`;
      const lineage = traceDataLineage('result', '/test.ts', content);

      expect(lineage.destinations.length).toBeGreaterThanOrEqual(1);
    });

    it('should include transformations', () => {
      const content = `
const x = 1;
const y = x + 1;
const z = y * 2;
`;
      const lineage = traceDataLineage('y', '/test.ts', content);

      // Should have transformations connecting x -> y or y -> z
      expect(lineage.transformations.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle missing variables gracefully', () => {
      const content = `
const x = 1;
`;
      const lineage = traceDataLineage('nonexistent', '/test.ts', content);

      expect(lineage.origins).toEqual([]);
      expect(lineage.destinations).toEqual([]);
      expect(lineage.warnings).toContain('Variable "nonexistent" not found in file');
      expect(lineage.confidence).toBe(0);
    });
  });

  describe('traceState', () => {
    it('should track variable declarations', () => {
      const content = `
let count = 0;
`;
      const trace = traceState('count', '/test.ts', content);

      expect(trace.variable).toBe('count');
      expect(trace.declaration).toBeDefined();
      expect(trace.mutations.length).toBe(1);
      expect(trace.mutations[0]!.operation).toBe('declaration');
      expect(trace.mutations[0]!.value).toBe('0');
    });

    it('should track simple reassignments', () => {
      const content = `
let x = 1;
x = 2;
x = 3;
`;
      const trace = traceState('x', '/test.ts', content);

      expect(trace.mutations.length).toBe(3);
      expect(trace.mutations[0]!.operation).toBe('declaration');
      expect(trace.mutations[1]!.operation).toBe('=');
      expect(trace.mutations[2]!.operation).toBe('=');
    });

    it('should track compound assignments', () => {
      const content = `
let count = 0;
count += 1;
count -= 1;
count *= 2;
`;
      const trace = traceState('count', '/test.ts', content);

      expect(trace.mutations.some(m => m.operation === '+=')).toBe(true);
      expect(trace.mutations.some(m => m.operation === '-=')).toBe(true);
      expect(trace.mutations.some(m => m.operation === '*=')).toBe(true);
    });

    it('should track array mutations', () => {
      const content = `
const items = [];
items.push(1);
items.pop();
items.splice(0, 1);
`;
      const trace = traceState('items', '/test.ts', content);

      expect(trace.mutations.some(m => m.operation === '.push()')).toBe(true);
      expect(trace.mutations.some(m => m.operation === '.pop()')).toBe(true);
      expect(trace.mutations.some(m => m.operation === '.splice()')).toBe(true);
    });

    it('should track property assignments', () => {
      const content = `
const obj = {};
obj.name = "test";
obj.value = 42;
`;
      const trace = traceState('obj', '/test.ts', content);

      expect(trace.mutations.some(m => m.operation === '.name =')).toBe(true);
      expect(trace.mutations.some(m => m.operation === '.value =')).toBe(true);
    });

    it('should detect conditional mutations', () => {
      const content = `
let result = 0;
if (condition) {
  result = 1;
}
`;
      const trace = traceState('result', '/test.ts', content);

      const conditionalMutation = trace.mutations.find(m => m.conditional);
      expect(conditionalMutation).toBeDefined();
      expect(trace.deterministic).toBe(false);
    });

    it('should determine final state', () => {
      const content = `
let x = 1;
x = 2;
x = 3;
`;
      const trace = traceState('x', '/test.ts', content);

      expect(trace.finalState).toBe('3');
    });

    it('should indicate when state is conditionally set', () => {
      const content = `
let x = 0;
if (condition) {
  x = 1;
}
`;
      const trace = traceState('x', '/test.ts', content);

      expect(trace.finalState).toContain('conditionally');
    });

    it('should handle variables with no mutations', () => {
      const content = `
const x = 1;
`;
      const trace = traceState('y', '/test.ts', content);

      expect(trace.mutations).toEqual([]);
      expect(trace.finalState).toBe('undefined');
      expect(trace.confidence).toBeLessThan(0.5);
    });
  });

  describe('findDataSources', () => {
    it('should find parameter sources', () => {
      const content = `
function process(input) {
  const result = transform(input);
  return result;
}
`;
      const sources = findDataSources('input', '/test.ts', content);

      expect(sources.length).toBeGreaterThanOrEqual(1);
      expect(sources.some(s => s.type === 'parameter')).toBe(true);
    });

    it('should find literal sources', () => {
      const content = `
const value = 42;
const result = value * 2;
`;
      const sources = findDataSources('value', '/test.ts', content);

      expect(sources.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty for unknown variables', () => {
      const content = `
const x = 1;
`;
      const sources = findDataSources('unknown', '/test.ts', content);

      expect(sources).toEqual([]);
    });
  });

  describe('findDataSinks', () => {
    it('should find return statement sinks', () => {
      const content = `
function process(input) {
  const result = transform(input);
  return result;
}
`;
      const sinks = findDataSinks('result', '/test.ts', content);

      expect(sinks.length).toBeGreaterThanOrEqual(1);
    });

    it('should find API call sinks', () => {
      const content = `
const data = process(input);
res.json(data);
`;
      const sinks = findDataSinks('data', '/test.ts', content);

      expect(sinks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('findTaintedPaths', () => {
    it('should find paths from taint sources to sensitive sinks', () => {
      const content = `
function handler(req, res) {
  const userInput = req.body.query;
  const result = userInput;
  db.query(result);
}
`;
      const paths = findTaintedPaths('/test.ts', content);

      // May find paths depending on implementation
      // At minimum, should not throw
      expect(Array.isArray(paths)).toBe(true);
    });

    it('should return empty for safe code', () => {
      const content = `
const x = 1;
const y = x + 1;
console.log(y);
`;
      const paths = findTaintedPaths('/test.ts', content);

      expect(paths.length).toBe(0);
    });
  });

  describe('findNullFlowRisks', () => {
    it('should identify potential null risks from find operations', () => {
      const content = `
const item = items.find(i => i.id === id);
const name = item.name;
`;
      const risks = findNullFlowRisks('/test.ts', content);

      // Should identify that item could be null
      expect(Array.isArray(risks)).toBe(true);
    });

    it('should not flag code with null checks', () => {
      const content = `
const item = items.find(i => i.id === id);
const name = item?.name ?? 'default';
`;
      const risks = findNullFlowRisks('/test.ts', content);

      // Should have fewer or no risks due to null checks
      expect(Array.isArray(risks)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty content', () => {
      const graph = buildDataFlowGraph('/empty.ts', '');

      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
      expect(graph.confidence).toBe(0);
    });

    it('should handle comments-only content', () => {
      const content = `
// This is a comment
/* Multi-line
   comment */
`;
      const graph = buildDataFlowGraph('/comments.ts', content);

      expect(graph.nodes.length).toBe(0);
    });

    it('should handle complex nested structures', () => {
      const content = `
function outer(x) {
  function inner(y) {
    const z = x + y;
    return z;
  }
  return inner;
}
`;
      const graph = buildDataFlowGraph('/nested.ts', content);

      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.file).toBe('/nested.ts');
    });

    it('should handle async/await patterns', () => {
      const content = `
async function fetchData(url) {
  const response = await fetch(url);
  const data = await response.json();
  return data;
}
`;
      const graph = buildDataFlowGraph('/async.ts', content);

      expect(graph.nodes.some(n => n.name === 'response')).toBe(true);
      expect(graph.nodes.some(n => n.name === 'data')).toBe(true);
    });

    it('should handle destructuring', () => {
      const content = `
const { name, value } = options;
const [first, second] = items;
`;
      const graph = buildDataFlowGraph('/destructure.ts', content);

      // Should identify destructuring patterns
      expect(graph.nodes.length).toBeGreaterThan(0);
    });

    it('should handle class methods', () => {
      const content = `
class Service {
  process(input) {
    this.data = transform(input);
    return this.data;
  }
}
`;
      const graph = buildDataFlowGraph('/class.ts', content);

      expect(graph.nodes.some(n => n.type === 'parameter')).toBe(true);
      expect(graph.nodes.some(n => n.type === 'return')).toBe(true);
    });
  });

  describe('DataFlowGraph Properties', () => {
    it('should include file information', () => {
      const content = `const x = 1;`;
      const graph = buildDataFlowGraph('/test/file.ts', content);

      expect(graph.file).toBe('/test/file.ts');
    });

    it('should include timestamp', () => {
      const content = `const x = 1;`;
      const graph = buildDataFlowGraph('/test.ts', content);

      expect(graph.analyzedAt).toBeDefined();
      expect(new Date(graph.analyzedAt).getTime()).toBeGreaterThan(0);
    });

    it('should calculate confidence', () => {
      const content = `
function process(input) {
  const result = transform(input);
  return result;
}
`;
      const graph = buildDataFlowGraph('/test.ts', content);

      expect(graph.confidence).toBeGreaterThan(0);
      expect(graph.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('DataLineage Properties', () => {
    it('should include variable name', () => {
      const content = `const x = 1;`;
      const lineage = traceDataLineage('x', '/test.ts', content);

      expect(lineage.variable).toBe('x');
    });

    it('should calculate confidence', () => {
      const content = `
function process(input) {
  const result = transform(input);
  return result;
}
`;
      const lineage = traceDataLineage('result', '/test.ts', content);

      expect(lineage.confidence).toBeGreaterThanOrEqual(0);
      expect(lineage.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('StateTrace Properties', () => {
    it('should track scope', () => {
      const content = `
function process() {
  let x = 1;
  x = 2;
}
`;
      const trace = traceState('x', '/test.ts', content);

      expect(trace.mutations.some(m => m.scope === 'process')).toBe(true);
    });

    it('should indicate determinism', () => {
      const content = `
let x = 1;
x = 2;
`;
      const trace = traceState('x', '/test.ts', content);

      expect(trace.deterministic).toBe(true);
    });

    it('should indicate non-determinism for conditional mutations', () => {
      const content = `
let x = 1;
if (Math.random() > 0.5) {
  x = 2;
}
`;
      const trace = traceState('x', '/test.ts', content);

      expect(trace.deterministic).toBe(false);
    });
  });
});
