/**
 * @fileoverview Tests for W3C PROV-JSON export (WU-THIMPL-203)
 *
 * Tests cover:
 * - Basic PROV document structure
 * - Entity, Activity, Agent mapping
 * - Relation generation (wasGeneratedBy, wasDerivedFrom, wasAttributedTo)
 * - Export options (payloads, confidence, namespaces)
 * - JSON serialization
 * - Document validation
 */

import { describe, it, expect } from 'vitest';
import {
  exportToPROV,
  exportToPROVJSON,
  validatePROVDocument,
  DEFAULT_PROV_EXPORT_OPTIONS,
  type PROVDocument,
} from '../prov_export.js';
import type {
  EvidenceChain,
  EvidenceEntry,
  ExtractionEvidence,
  ClaimEvidence,
  EvidenceRelation,
} from '../evidence_ledger.js';
import { createEvidenceId } from '../evidence_ledger.js';
import { deterministic, absent } from '../confidence.js';

describe('W3C PROV Export (WU-THIMPL-203)', () => {
  // Helper to create a minimal evidence entry
  const createEntry = (
    id: string,
    kind: EvidenceEntry['kind'],
    payload: EvidenceEntry['payload'],
    relatedEntries: EvidenceEntry['relatedEntries'] = []
  ): EvidenceEntry => ({
    id: createEvidenceId(id),
    timestamp: new Date('2026-01-28T00:00:00Z'),
    kind,
    payload,
    provenance: {
      source: 'ast_parser',
      method: 'typescript_parser',
      agent: {
        type: 'ast',
        identifier: 'ts-morph',
        version: '22.0.0',
      },
    },
    relatedEntries,
    confidence: deterministic(true, 'verified'),
  });

  // Helper to create a minimal chain
  const createChain = (entries: EvidenceEntry[]): EvidenceChain => ({
    root: entries[0],
    evidence: entries,
    graph: new Map(entries.map(e => [e.id, []])),
    chainConfidence: deterministic(true, 'chain_verified'),
    contradictions: [],
  });

  describe('exportToPROV', () => {
    it('should create valid PROV document structure', () => {
      const entry = createEntry('ev_test1', 'extraction', {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'testFn', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);

      const chain = createChain([entry]);
      const doc = exportToPROV(chain);

      // Check structure
      expect(doc.prefix).toBeDefined();
      expect(doc.entity).toBeDefined();
      expect(doc.activity).toBeDefined();
      expect(doc.agent).toBeDefined();
      expect(doc.wasGeneratedBy).toBeDefined();
      expect(doc.wasDerivedFrom).toBeDefined();
      expect(doc.wasAttributedTo).toBeDefined();
    });

    it('should include standard PROV prefixes', () => {
      const entry = createEntry('ev_test2', 'extraction', {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'fn', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);

      const chain = createChain([entry]);
      const doc = exportToPROV(chain);

      expect(doc.prefix.prov).toBe('http://www.w3.org/ns/prov#');
      expect(doc.prefix.xsd).toBe('http://www.w3.org/2001/XMLSchema#');
      expect(doc.prefix.librarian).toBe('urn:librarian:evidence:');
    });

    it('should create entities for each evidence entry', () => {
      const entries = [
        createEntry('ev_entity1', 'extraction', {
          filePath: '/a.ts',
          extractionType: 'function',
          entity: { name: 'fnA', kind: 'function', location: { file: '/a.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence),
        createEntry('ev_entity2', 'extraction', {
          filePath: '/b.ts',
          extractionType: 'class',
          entity: { name: 'ClassB', kind: 'class', location: { file: '/b.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence),
      ];

      const chain = createChain(entries);
      const doc = exportToPROV(chain);

      expect(Object.keys(doc.entity)).toHaveLength(2);
      expect(doc.entity['librarian:ev_entity1']).toBeDefined();
      expect(doc.entity['librarian:ev_entity2']).toBeDefined();
    });

    it('should include confidence in entities by default', () => {
      const entry = createEntry('ev_conf', 'extraction', {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'fn', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);
      entry.confidence = deterministic(true, 'high_confidence');

      const chain = createChain([entry]);
      const doc = exportToPROV(chain);

      const entity = doc.entity['librarian:ev_conf'];
      expect(entity['librarian:confidence']).toBe(1);
    });

    it('should handle bounded confidence', () => {
      const entry = createEntry('ev_bounded', 'claim', {
        claim: 'Test claim',
        category: 'behavior',
        subject: { type: 'function', identifier: 'test' },
        supportingEvidence: [],
        knownDefeaters: [],
        confidence: { type: 'bounded', low: 0.6, high: 0.9, source: 'theoretical', method: 'test' },
      } satisfies ClaimEvidence);
      entry.confidence = { type: 'bounded', low: 0.6, high: 0.9, source: 'theoretical', method: 'test' };

      const chain = createChain([entry]);
      const doc = exportToPROV(chain);

      const entity = doc.entity['librarian:ev_bounded'];
      expect(entity['librarian:confidenceLow']).toBe(0.6);
      expect(entity['librarian:confidenceHigh']).toBe(0.9);
    });

    it('should handle absent confidence', () => {
      const entry = createEntry('ev_absent', 'synthesis', {
        request: 'test',
        output: 'result',
        model: { provider: 'test', modelId: 'test-model' },
        tokens: { input: 10, output: 5 },
        synthesisType: 'answer',
      });
      entry.confidence = absent('uncalibrated');

      const chain = createChain([entry]);
      const doc = exportToPROV(chain);

      const entity = doc.entity['librarian:ev_absent'];
      expect(entity['librarian:confidenceAbsent']).toBe('uncalibrated');
    });

    it('should create activities for each entry', () => {
      const entry = createEntry('ev_act', 'extraction', {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'fn', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);

      const chain = createChain([entry]);
      const doc = exportToPROV(chain);

      const activity = doc.activity['librarian:activity_ev_act'];
      expect(activity).toBeDefined();
      expect(activity['prov:type']).toBe('librarian:extraction_activity');
      expect(activity['prov:label']).toContain('typescript_parser');
    });

    it('should create agents from provenance', () => {
      const entry = createEntry('ev_agent', 'extraction', {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'fn', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);
      entry.provenance = {
        source: 'llm_synthesis',
        method: 'analysis',
        agent: {
          type: 'llm',
          identifier: 'claude-3-sonnet',
          version: '2024-01',
        },
      };

      const chain = createChain([entry]);
      const doc = exportToPROV(chain);

      // Agent should exist
      const agentKeys = Object.keys(doc.agent);
      expect(agentKeys.length).toBeGreaterThan(0);

      const agent = doc.agent[agentKeys[0]];
      expect(agent['prov:type']).toBe('prov:SoftwareAgent');
      expect(agent['librarian:agentIdentifier']).toBe('claude-3-sonnet');
      expect(agent['librarian:agentVersion']).toBe('2024-01');
    });

    it('should create wasGeneratedBy relations', () => {
      const entry = createEntry('ev_gen', 'extraction', {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'fn', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);

      const chain = createChain([entry]);
      const doc = exportToPROV(chain);

      const genRel = doc.wasGeneratedBy['librarian:gen_ev_gen'];
      expect(genRel).toBeDefined();
      expect(genRel['prov:entity']).toBe('librarian:ev_gen');
      expect(genRel['prov:activity']).toBe('librarian:activity_ev_gen');
      expect(genRel['prov:time']).toBe('2026-01-28T00:00:00.000Z');
    });

    it('should create wasDerivedFrom relations for related entries', () => {
      const source = createEntry('ev_source', 'extraction', {
        filePath: '/source.ts',
        extractionType: 'function',
        entity: { name: 'sourceFn', kind: 'function', location: { file: '/source.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);

      const derived = createEntry('ev_derived', 'claim', {
        claim: 'sourceFn is pure',
        category: 'behavior',
        subject: { type: 'function', identifier: 'sourceFn' },
        supportingEvidence: [source.id],
        knownDefeaters: [],
        confidence: deterministic(true, 'verified'),
      } satisfies ClaimEvidence, [
        { id: source.id, type: 'derived_from' } as EvidenceRelation,
      ]);

      const chain: EvidenceChain = {
        root: derived,
        evidence: [derived, source],
        graph: new Map([
          [derived.id, [source.id]],
          [source.id, []],
        ]),
        chainConfidence: deterministic(true, 'verified'),
        contradictions: [],
      };

      const doc = exportToPROV(chain);

      // Find derivation relation
      const derivRels = Object.entries(doc.wasDerivedFrom).filter(
        ([key]) => key.includes('ev_derived')
      );
      expect(derivRels.length).toBe(1);

      const [, rel] = derivRels[0];
      expect(rel['prov:generatedEntity']).toBe('librarian:ev_derived');
      expect(rel['prov:usedEntity']).toBe('librarian:ev_source');
      expect(rel['librarian:relationType']).toBe('derived_from');
    });

    it('should create wasAttributedTo relations', () => {
      const entry = createEntry('ev_attr', 'extraction', {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'fn', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);

      const chain = createChain([entry]);
      const doc = exportToPROV(chain);

      const attrRel = doc.wasAttributedTo['librarian:attr_ev_attr'];
      expect(attrRel).toBeDefined();
      expect(attrRel['prov:entity']).toBe('librarian:ev_attr');
      expect(attrRel['prov:agent']).toBeDefined();
    });

    it('should respect custom base URI', () => {
      const entry = createEntry('ev_custom', 'extraction', {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'fn', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);

      const chain = createChain([entry]);
      const doc = exportToPROV(chain, {
        baseUri: 'https://example.org/evidence/',
        namespacePrefix: 'ex',
      });

      expect(doc.prefix.ex).toBe('https://example.org/evidence/');
      expect(doc.entity['ex:ev_custom']).toBeDefined();
    });

    it('should include payloads when requested', () => {
      const payload: ExtractionEvidence = {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'myFunc', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      };

      const entry = createEntry('ev_payload', 'extraction', payload);
      const chain = createChain([entry]);

      // Without payloads (default)
      const docNoPayload = exportToPROV(chain, { includePayloads: false });
      expect(docNoPayload.entity['librarian:ev_payload']['librarian:payload']).toBeUndefined();

      // With payloads
      const docWithPayload = exportToPROV(chain, { includePayloads: true });
      expect(docWithPayload.entity['librarian:ev_payload']['librarian:payload']).toEqual(payload);
    });

    it('should exclude confidence when requested', () => {
      const entry = createEntry('ev_noconf', 'extraction', {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'fn', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);

      const chain = createChain([entry]);
      const doc = exportToPROV(chain, { includeConfidence: false });

      expect(doc.entity['librarian:ev_noconf']['librarian:confidence']).toBeUndefined();
    });
  });

  describe('exportToPROVJSON', () => {
    it('should return valid JSON string', () => {
      const entry = createEntry('ev_json', 'extraction', {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'fn', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);

      const chain = createChain([entry]);
      const json = exportToPROVJSON(chain);

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should pretty-print by default', () => {
      const entry = createEntry('ev_pretty', 'extraction', {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'fn', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);

      const chain = createChain([entry]);
      const json = exportToPROVJSON(chain, undefined, true);

      expect(json).toContain('\n');
      expect(json).toContain('  '); // Indentation
    });

    it('should minify when requested', () => {
      const entry = createEntry('ev_minify', 'extraction', {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'fn', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);

      const chain = createChain([entry]);
      const json = exportToPROVJSON(chain, undefined, false);

      expect(json).not.toContain('\n');
    });
  });

  describe('validatePROVDocument', () => {
    it('should validate well-formed documents', () => {
      const entry = createEntry('ev_valid', 'extraction', {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'fn', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);

      const chain = createChain([entry]);
      const doc = exportToPROV(chain);
      const result = validatePROVDocument(doc);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing entity references in wasGeneratedBy', () => {
      const doc: PROVDocument = {
        prefix: { librarian: 'urn:librarian:', prov: 'http://www.w3.org/ns/prov#' },
        entity: {},
        activity: { 'librarian:act1': { 'prov:type': 'test' } },
        agent: {},
        wasGeneratedBy: {
          'librarian:gen1': {
            'prov:entity': 'librarian:missing_entity',
            'prov:activity': 'librarian:act1',
          },
        },
        wasDerivedFrom: {},
        wasAttributedTo: {},
      };

      const result = validatePROVDocument(doc);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'wasGeneratedBy librarian:gen1: references unknown entity librarian:missing_entity'
      );
    });

    it('should detect missing activity references in wasGeneratedBy', () => {
      const doc: PROVDocument = {
        prefix: { librarian: 'urn:librarian:', prov: 'http://www.w3.org/ns/prov#' },
        entity: { 'librarian:ent1': { 'prov:type': 'test' } },
        activity: {},
        agent: {},
        wasGeneratedBy: {
          'librarian:gen1': {
            'prov:entity': 'librarian:ent1',
            'prov:activity': 'librarian:missing_activity',
          },
        },
        wasDerivedFrom: {},
        wasAttributedTo: {},
      };

      const result = validatePROVDocument(doc);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'wasGeneratedBy librarian:gen1: references unknown activity librarian:missing_activity'
      );
    });

    it('should detect missing entity references in wasDerivedFrom', () => {
      const doc: PROVDocument = {
        prefix: { librarian: 'urn:librarian:', prov: 'http://www.w3.org/ns/prov#' },
        entity: { 'librarian:ent1': { 'prov:type': 'test' } },
        activity: {},
        agent: {},
        wasGeneratedBy: {},
        wasDerivedFrom: {
          'librarian:deriv1': {
            'prov:generatedEntity': 'librarian:ent1',
            'prov:usedEntity': 'librarian:missing_used',
          },
        },
        wasAttributedTo: {},
      };

      const result = validatePROVDocument(doc);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('unknown used entity'))).toBe(true);
    });

    it('should detect missing agent references in wasAttributedTo', () => {
      const doc: PROVDocument = {
        prefix: { librarian: 'urn:librarian:', prov: 'http://www.w3.org/ns/prov#' },
        entity: { 'librarian:ent1': { 'prov:type': 'test' } },
        activity: {},
        agent: {},
        wasGeneratedBy: {},
        wasDerivedFrom: {},
        wasAttributedTo: {
          'librarian:attr1': {
            'prov:entity': 'librarian:ent1',
            'prov:agent': 'librarian:missing_agent',
          },
        },
      };

      const result = validatePROVDocument(doc);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('unknown agent'))).toBe(true);
    });
  });

  describe('Entity Labels', () => {
    it('should generate meaningful labels for extraction', () => {
      const entry = createEntry('ev_label_ext', 'extraction', {
        filePath: '/test.ts',
        extractionType: 'function',
        entity: { name: 'calculateSum', kind: 'function', location: { file: '/test.ts' } },
        quality: 'ast_verified',
      } satisfies ExtractionEvidence);

      const chain = createChain([entry]);
      const doc = exportToPROV(chain);

      expect(doc.entity['librarian:ev_label_ext']['prov:label']).toContain('calculateSum');
    });

    it('should generate meaningful labels for claims', () => {
      const entry = createEntry('ev_label_claim', 'claim', {
        claim: 'Function handles null inputs correctly',
        category: 'behavior',
        subject: { type: 'function', identifier: 'handleNull' },
        supportingEvidence: [],
        knownDefeaters: [],
        confidence: deterministic(true, 'verified'),
      } satisfies ClaimEvidence);

      const chain = createChain([entry]);
      const doc = exportToPROV(chain);

      expect(doc.entity['librarian:ev_label_claim']['prov:label']).toContain('Function handles');
    });
  });

  describe('Default Options', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_PROV_EXPORT_OPTIONS.baseUri).toBe('urn:librarian:evidence:');
      expect(DEFAULT_PROV_EXPORT_OPTIONS.includePayloads).toBe(false);
      expect(DEFAULT_PROV_EXPORT_OPTIONS.includeConfidence).toBe(true);
      expect(DEFAULT_PROV_EXPORT_OPTIONS.namespacePrefix).toBe('librarian');
    });
  });
});
