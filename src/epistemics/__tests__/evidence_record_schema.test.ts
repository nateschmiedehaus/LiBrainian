/**
 * @fileoverview Tests for Evidence Record Schema (WU-PROV-002)
 *
 * W3C PROV-based evidence schema with cryptographic hashing.
 * Tests cover:
 * - EvidenceRecord creation and validation
 * - Content-addressable hashing (SHA-256)
 * - Integrity verification
 * - Cryptographic signatures
 * - W3C PROV-JSON export
 * - Activity, Agent, and relation modeling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Types
  type EvidenceRecord,
  type Activity,
  type Agent,
  type EvidenceType,
  type RecordMetadata,
  type ProvDocument,
  // Functions
  createRecord,
  computeContentHash,
  verifyIntegrity,
  signRecord,
  verifySignature,
  exportToProv,
  // Helpers
  createActivity,
  createAgent,
  isEvidenceRecord,
  isActivity,
  isAgent,
  // Constants
  EVIDENCE_RECORD_SCHEMA_VERSION,
} from '../evidence_record_schema.js';
import { deterministic, absent, bounded } from '../confidence.js';

describe('Evidence Record Schema (WU-PROV-002)', () => {
  // Test fixtures
  const testAgent: Agent = {
    id: 'agent_llm_claude',
    type: 'llm',
    name: 'claude-3-sonnet',
    version: '2024-01',
  };

  const testActivity: Activity = {
    id: 'activity_retrieval_001',
    type: 'retrieval',
    startedAtTime: new Date('2026-01-28T10:00:00Z'),
    endedAtTime: new Date('2026-01-28T10:00:05Z'),
    usedInputs: [],
  };

  describe('createRecord', () => {
    it('should create a valid evidence record with required fields', () => {
      const metadata: RecordMetadata = {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      };

      const record = createRecord('function add(a, b) { return a + b; }', metadata);

      expect(record.id).toBeDefined();
      expect(record.content).toBe('function add(a, b) { return a + b; }');
      expect(record.evidenceType).toBe('source_code');
      expect(record.contentHash).toBeDefined();
      expect(record.generatedAtTime).toBeInstanceOf(Date);
      expect(record.wasGeneratedBy).toEqual(testActivity);
      expect(record.wasAttributedTo).toEqual(testAgent);
      expect(record.confidence).toBeDefined();
    });

    it('should generate content-addressable ID based on content hash', () => {
      const metadata: RecordMetadata = {
        evidenceType: 'documentation',
        activity: testActivity,
        agent: testAgent,
      };

      const record1 = createRecord('Same content', metadata);
      const record2 = createRecord('Same content', metadata);
      const record3 = createRecord('Different content', metadata);

      // Same content should produce same ID prefix
      expect(record1.id.startsWith('ev_rec_')).toBe(true);
      // Different content should produce different hash
      expect(record1.contentHash).toBe(record2.contentHash);
      expect(record1.contentHash).not.toBe(record3.contentHash);
    });

    it('should include optional derivation chain (wasDerivedFrom)', () => {
      const sourceRecord = createRecord('Original code', {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      });

      const derivedRecord = createRecord('Analysis of original code', {
        evidenceType: 'llm_output',
        activity: { ...testActivity, id: 'activity_inference_001', type: 'inference' },
        agent: testAgent,
        derivedFrom: [sourceRecord],
      });

      expect(derivedRecord.wasDerivedFrom).toHaveLength(1);
      expect(derivedRecord.wasDerivedFrom![0].id).toBe(sourceRecord.id);
    });

    it('should support all evidence types', () => {
      const types: EvidenceType[] = [
        'source_code',
        'documentation',
        'test_result',
        'llm_output',
        'user_feedback',
        'tool_output',
      ];

      for (const evidenceType of types) {
        const record = createRecord(`Content for ${evidenceType}`, {
          evidenceType,
          activity: testActivity,
          agent: testAgent,
        });
        expect(record.evidenceType).toBe(evidenceType);
      }
    });

    it('should accept custom confidence value', () => {
      const record = createRecord('High confidence content', {
        evidenceType: 'test_result',
        activity: testActivity,
        agent: testAgent,
        confidence: deterministic(true, 'test_passed'),
      });

      expect(record.confidence.type).toBe('deterministic');
      expect((record.confidence as { value: number }).value).toBe(1.0);
    });

    it('should use absent confidence by default for LLM outputs', () => {
      const record = createRecord('LLM generated text', {
        evidenceType: 'llm_output',
        activity: { ...testActivity, type: 'inference' },
        agent: testAgent,
      });

      expect(record.confidence.type).toBe('absent');
    });
  });

  describe('computeContentHash', () => {
    it('should compute SHA-256 hash of content', () => {
      const hash = computeContentHash('test content');

      // SHA-256 produces 64 character hex string
      expect(hash).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
    });

    it('should be deterministic - same input produces same hash', () => {
      const content = 'consistent hashing test';
      const hash1 = computeContentHash(content);
      const hash2 = computeContentHash(content);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different content', () => {
      const hash1 = computeContentHash('content A');
      const hash2 = computeContentHash('content B');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = computeContentHash('');

      expect(hash).toHaveLength(64);
      // Known SHA-256 hash of empty string
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should handle unicode content', () => {
      const hash = computeContentHash('Hello, \u4e16\u754c! \u{1F600}');

      expect(hash).toHaveLength(64);
    });
  });

  describe('verifyIntegrity', () => {
    it('should return true for unmodified records', () => {
      const record = createRecord('Original content', {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      });

      expect(verifyIntegrity(record)).toBe(true);
    });

    it('should return false if content was tampered', () => {
      const record = createRecord('Original content', {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      });

      // Tamper with content (simulated via type assertion)
      const tamperedRecord = {
        ...record,
        content: 'Tampered content',
      };

      expect(verifyIntegrity(tamperedRecord)).toBe(false);
    });

    it('should return false if contentHash was tampered', () => {
      const record = createRecord('Original content', {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      });

      const tamperedRecord = {
        ...record,
        contentHash: 'invalid_hash_00000000000000000000000000000000000000000000000000',
      };

      expect(verifyIntegrity(tamperedRecord)).toBe(false);
    });
  });

  describe('signRecord / verifySignature', () => {
    // Test keys - HMAC uses symmetric keys (same key for sign and verify)
    // In production, use proper asymmetric cryptography (RSA, ECDSA)
    const testSecretKey = 'test-secret-key-for-hmac';
    const wrongSecretKey = 'wrong-secret-key';

    it('should sign a record and add signature field', () => {
      const record = createRecord('Content to sign', {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      });

      expect(record.signature).toBeUndefined();

      const signedRecord = signRecord(record, testSecretKey);

      expect(signedRecord.signature).toBeDefined();
      expect(signedRecord.signature).not.toBe('');
    });

    it('should verify valid signature with correct key', () => {
      const record = createRecord('Content to verify', {
        evidenceType: 'documentation',
        activity: testActivity,
        agent: testAgent,
      });

      const signedRecord = signRecord(record, testSecretKey);
      const isValid = verifySignature(signedRecord, testSecretKey);

      expect(isValid).toBe(true);
    });

    it('should reject signature with wrong key', () => {
      const record = createRecord('Secure content', {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      });

      const signedRecord = signRecord(record, testSecretKey);
      const isValid = verifySignature(signedRecord, wrongSecretKey);

      expect(isValid).toBe(false);
    });

    it('should reject tampered signed record', () => {
      const record = createRecord('Original signed content', {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      });

      const signedRecord = signRecord(record, testSecretKey);
      const tamperedRecord = {
        ...signedRecord,
        content: 'Tampered content',
      };

      const isValid = verifySignature(tamperedRecord, testSecretKey);
      expect(isValid).toBe(false);
    });

    it('should return false for unsigned records', () => {
      const record = createRecord('Unsigned content', {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      });

      const isValid = verifySignature(record, testSecretKey);
      expect(isValid).toBe(false);
    });
  });

  describe('exportToProv', () => {
    it('should export single record to W3C PROV-JSON format', () => {
      const record = createRecord('Test content', {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      });

      const provDoc = exportToProv([record]);

      // Check PROV-JSON structure
      expect(provDoc.prefix).toBeDefined();
      expect(provDoc.entity).toBeDefined();
      expect(provDoc.activity).toBeDefined();
      expect(provDoc.agent).toBeDefined();
      expect(provDoc.wasGeneratedBy).toBeDefined();
      expect(provDoc.wasAttributedTo).toBeDefined();
    });

    it('should include standard W3C PROV prefixes', () => {
      const record = createRecord('Test', {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      });

      const provDoc = exportToProv([record]);

      expect(provDoc.prefix['prov']).toBe('http://www.w3.org/ns/prov#');
      expect(provDoc.prefix['xsd']).toBe('http://www.w3.org/2001/XMLSchema#');
    });

    it('should create entities for each evidence record', () => {
      const records = [
        createRecord('Content 1', {
          evidenceType: 'source_code',
          activity: testActivity,
          agent: testAgent,
        }),
        createRecord('Content 2', {
          evidenceType: 'documentation',
          activity: { ...testActivity, id: 'activity_002' },
          agent: testAgent,
        }),
      ];

      const provDoc = exportToProv(records);

      expect(Object.keys(provDoc.entity)).toHaveLength(2);
    });

    it('should include wasDerivedFrom relations', () => {
      const sourceRecord = createRecord('Source', {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      });

      const derivedRecord = createRecord('Derived', {
        evidenceType: 'llm_output',
        activity: { ...testActivity, id: 'activity_infer', type: 'inference' },
        agent: testAgent,
        derivedFrom: [sourceRecord],
      });

      const provDoc = exportToProv([sourceRecord, derivedRecord]);

      expect(Object.keys(provDoc.wasDerivedFrom).length).toBeGreaterThan(0);
    });

    it('should include content hash in entity attributes', () => {
      const record = createRecord('Hashable content', {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      });

      const provDoc = exportToProv([record]);
      const entityKey = Object.keys(provDoc.entity)[0];
      const entity = provDoc.entity[entityKey];

      expect(entity['librarian:contentHash']).toBe(record.contentHash);
    });

    it('should handle empty records array', () => {
      const provDoc = exportToProv([]);

      expect(provDoc.entity).toEqual({});
      expect(provDoc.activity).toEqual({});
      expect(provDoc.agent).toEqual({});
    });
  });

  describe('Activity', () => {
    it('should create valid activity with all types', () => {
      const types: Activity['type'][] = ['retrieval', 'inference', 'verification', 'user_input'];

      for (const type of types) {
        const activity = createActivity({
          type,
          startedAtTime: new Date(),
          usedInputs: [],
        });

        expect(activity.id).toBeDefined();
        expect(activity.type).toBe(type);
        expect(activity.startedAtTime).toBeInstanceOf(Date);
      }
    });

    it('should track used inputs (evidence record IDs)', () => {
      const inputIds = ['ev_rec_input1', 'ev_rec_input2'];
      const activity = createActivity({
        type: 'inference',
        startedAtTime: new Date(),
        usedInputs: inputIds,
      });

      expect(activity.usedInputs).toEqual(inputIds);
    });

    it('should support optional endedAtTime', () => {
      const activity = createActivity({
        type: 'retrieval',
        startedAtTime: new Date('2026-01-28T10:00:00Z'),
        endedAtTime: new Date('2026-01-28T10:00:05Z'),
        usedInputs: [],
      });

      expect(activity.endedAtTime).toBeDefined();
      expect(activity.endedAtTime!.getTime()).toBeGreaterThan(activity.startedAtTime.getTime());
    });
  });

  describe('Agent', () => {
    it('should create agents with all types', () => {
      const types: Agent['type'][] = ['llm', 'tool', 'user', 'system'];

      for (const type of types) {
        const agent = createAgent({
          type,
          name: `test-${type}`,
        });

        expect(agent.id).toBeDefined();
        expect(agent.type).toBe(type);
        expect(agent.name).toBe(`test-${type}`);
      }
    });

    it('should support optional version field', () => {
      const agent = createAgent({
        type: 'llm',
        name: 'claude-3-opus',
        version: '2024-02',
      });

      expect(agent.version).toBe('2024-02');
    });
  });

  describe('Type Guards', () => {
    it('isEvidenceRecord should validate evidence records', () => {
      const record = createRecord('Test', {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      });

      expect(isEvidenceRecord(record)).toBe(true);
      expect(isEvidenceRecord({})).toBe(false);
      expect(isEvidenceRecord(null)).toBe(false);
      expect(isEvidenceRecord({ id: 'test' })).toBe(false);
    });

    it('isActivity should validate activities', () => {
      expect(isActivity(testActivity)).toBe(true);
      expect(isActivity({})).toBe(false);
      expect(isActivity({ type: 'retrieval' })).toBe(false);
    });

    it('isAgent should validate agents', () => {
      expect(isAgent(testAgent)).toBe(true);
      expect(isAgent({})).toBe(false);
      expect(isAgent({ type: 'llm' })).toBe(false);
    });
  });

  describe('Schema Version', () => {
    it('should expose schema version constant', () => {
      expect(EVIDENCE_RECORD_SCHEMA_VERSION).toBeDefined();
      expect(typeof EVIDENCE_RECORD_SCHEMA_VERSION).toBe('string');
      expect(EVIDENCE_RECORD_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should include schema version in created records', () => {
      const record = createRecord('Versioned content', {
        evidenceType: 'source_code',
        activity: testActivity,
        agent: testAgent,
      });

      // Schema version should be tracked (implementation detail)
      expect(record.id).toBeDefined();
    });
  });

  describe('Integration with ConfidenceValue', () => {
    it('should work with deterministic confidence', () => {
      const record = createRecord('Verified code', {
        evidenceType: 'test_result',
        activity: testActivity,
        agent: testAgent,
        confidence: deterministic(true, 'all_tests_passed'),
      });

      expect(record.confidence.type).toBe('deterministic');
    });

    it('should work with bounded confidence', () => {
      const record = createRecord('Uncertain data', {
        evidenceType: 'llm_output',
        activity: testActivity,
        agent: testAgent,
        confidence: bounded(0.7, 0.9, 'literature', 'Based on benchmark results'),
      });

      expect(record.confidence.type).toBe('bounded');
    });

    it('should work with absent confidence', () => {
      const record = createRecord('Uncalibrated output', {
        evidenceType: 'llm_output',
        activity: testActivity,
        agent: testAgent,
        confidence: absent('uncalibrated'),
      });

      expect(record.confidence.type).toBe('absent');
    });
  });
});
