/**
 * @fileoverview Evidence Record Schema (WU-PROV-002)
 *
 * W3C PROV-based evidence schema with cryptographic hashing.
 * Provides a structured way to create, verify, and export evidence records
 * with full provenance tracking.
 *
 * Key features:
 * - Content-addressable IDs via SHA-256 hashing
 * - Cryptographic signatures for tamper detection
 * - W3C PROV-JSON export for interoperability
 * - Integration with ConfidenceValue type system
 *
 * @see https://www.w3.org/TR/prov-dm/
 * @see https://www.w3.org/TR/prov-json/
 * @packageDocumentation
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { ConfidenceValue } from './confidence.js';
import { absent, isConfidenceValue } from './confidence.js';

// ============================================================================
// SCHEMA VERSION
// ============================================================================

/**
 * Schema version for evidence records.
 * Follows semantic versioning for forward compatibility.
 */
export const EVIDENCE_RECORD_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Types of evidence that can be recorded.
 */
export type EvidenceType =
  | 'source_code'
  | 'documentation'
  | 'test_result'
  | 'llm_output'
  | 'user_feedback'
  | 'tool_output';

/**
 * Types of activities that generate evidence.
 * Based on W3C PROV Activity concept.
 */
export type ActivityType = 'retrieval' | 'inference' | 'verification' | 'user_input';

/**
 * Types of agents that can generate or be responsible for evidence.
 * Based on W3C PROV Agent concept.
 */
export type AgentType = 'llm' | 'tool' | 'user' | 'system';

/**
 * W3C PROV-based Activity representation.
 *
 * An Activity is something that occurs over a period of time and
 * acts upon or with entities (evidence records in our case).
 */
export interface Activity {
  /** Unique identifier for this activity */
  id: string;
  /** Type of activity */
  type: ActivityType;
  /** When the activity started (ISO 8601) */
  startedAtTime: Date;
  /** When the activity ended (optional) */
  endedAtTime?: Date;
  /** Evidence record IDs used as inputs to this activity */
  usedInputs: string[];
}

/**
 * W3C PROV-based Agent representation.
 *
 * An Agent is something that bears some form of responsibility
 * for an activity taking place or for the existence of an entity.
 */
export interface Agent {
  /** Unique identifier for this agent */
  id: string;
  /** Type of agent */
  type: AgentType;
  /** Human-readable name */
  name: string;
  /** Optional version information */
  version?: string;
}

/**
 * W3C PROV-based Evidence Record.
 *
 * An evidence record is an Entity in PROV terms - a physical, digital,
 * conceptual, or other kind of thing with some fixed aspects.
 *
 * This implementation adds:
 * - Content-addressable IDs via SHA-256
 * - Optional cryptographic signatures
 * - Integration with ConfidenceValue type system
 */
export interface EvidenceRecord {
  // W3C PROV core
  /** Content-addressable identifier (based on SHA-256 hash) */
  id: string;
  /** When this record was generated */
  generatedAtTime: Date;
  /** The activity that generated this record */
  wasGeneratedBy: Activity;
  /** Optional chain of records this was derived from */
  wasDerivedFrom?: EvidenceRecord[];
  /** The agent responsible for this record */
  wasAttributedTo: Agent;

  // Librarian-specific
  /** Type of evidence */
  evidenceType: EvidenceType;
  /** The actual content being recorded */
  content: string;
  /** SHA-256 hash of content for integrity verification */
  contentHash: string;
  /** Confidence value following the ConfidenceValue type system */
  confidence: ConfidenceValue;
  /** Optional cryptographic signature for tamper detection */
  signature?: string;
}

/**
 * Metadata required to create an evidence record.
 */
export interface RecordMetadata {
  /** Type of evidence being recorded */
  evidenceType: EvidenceType;
  /** Activity that generated this record */
  activity: Activity;
  /** Agent responsible for this record */
  agent: Agent;
  /** Optional records this is derived from */
  derivedFrom?: EvidenceRecord[];
  /** Optional explicit confidence value */
  confidence?: ConfidenceValue;
}

// ============================================================================
// PROV DOCUMENT TYPES
// ============================================================================

/**
 * W3C PROV-JSON Entity representation.
 */
export interface ProvEntity {
  'prov:type'?: string | string[];
  'prov:label'?: string;
  [key: `librarian:${string}`]: unknown;
}

/**
 * W3C PROV-JSON Activity representation.
 */
export interface ProvActivity {
  'prov:startTime'?: string;
  'prov:endTime'?: string;
  'prov:type'?: string | string[];
  'prov:label'?: string;
  [key: `librarian:${string}`]: unknown;
}

/**
 * W3C PROV-JSON Agent representation.
 */
export interface ProvAgent {
  'prov:type'?: string | string[];
  'prov:label'?: string;
  [key: `librarian:${string}`]: unknown;
}

/**
 * W3C PROV-JSON Relation representation.
 */
export interface ProvRelation {
  'prov:entity'?: string;
  'prov:activity'?: string;
  'prov:agent'?: string;
  'prov:usedEntity'?: string;
  'prov:generatedEntity'?: string;
  'prov:time'?: string;
  [key: `librarian:${string}`]: unknown;
}

/**
 * Complete W3C PROV-JSON Document.
 *
 * @see https://www.w3.org/TR/prov-json/
 */
export interface ProvDocument {
  /** Namespace prefixes */
  prefix: Record<string, string>;
  /** Entities in the provenance graph */
  entity: Record<string, ProvEntity>;
  /** Activities in the provenance graph */
  activity: Record<string, ProvActivity>;
  /** Agents in the provenance graph */
  agent: Record<string, ProvAgent>;
  /** wasGeneratedBy relations */
  wasGeneratedBy: Record<string, ProvRelation>;
  /** wasDerivedFrom relations */
  wasDerivedFrom: Record<string, ProvRelation>;
  /** wasAttributedTo relations */
  wasAttributedTo: Record<string, ProvRelation>;
  /** used relations (optional) */
  used?: Record<string, ProvRelation>;
  /** wasAssociatedWith relations (optional) */
  wasAssociatedWith?: Record<string, ProvRelation>;
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Compute SHA-256 hash of content.
 *
 * @param content - The content to hash
 * @returns 64-character lowercase hex string
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Create a new evidence record with content-addressable ID.
 *
 * @param content - The content to record
 * @param metadata - Metadata for the record
 * @returns A new EvidenceRecord
 */
export function createRecord(content: string, metadata: RecordMetadata): EvidenceRecord {
  const contentHash = computeContentHash(content);

  // Generate content-addressable ID
  const id = `ev_rec_${contentHash.slice(0, 16)}`;

  // Determine default confidence based on evidence type
  let confidence: ConfidenceValue;
  if (metadata.confidence) {
    confidence = metadata.confidence;
  } else if (metadata.evidenceType === 'llm_output') {
    // LLM outputs are uncalibrated by default
    confidence = absent('uncalibrated');
  } else if (metadata.evidenceType === 'test_result') {
    // Test results have deterministic outcomes but default to absent
    confidence = absent('uncalibrated');
  } else {
    confidence = absent('uncalibrated');
  }

  return {
    id,
    generatedAtTime: new Date(),
    wasGeneratedBy: metadata.activity,
    wasDerivedFrom: metadata.derivedFrom,
    wasAttributedTo: metadata.agent,
    evidenceType: metadata.evidenceType,
    content,
    contentHash,
    confidence,
  };
}

/**
 * Verify the integrity of an evidence record.
 *
 * Checks that the contentHash matches the actual content,
 * detecting any tampering.
 *
 * @param record - The record to verify
 * @returns true if integrity is intact, false otherwise
 */
export function verifyIntegrity(record: EvidenceRecord): boolean {
  const computedHash = computeContentHash(record.content);
  return computedHash === record.contentHash;
}

/**
 * Sign an evidence record using HMAC-SHA256.
 *
 * In production, use proper asymmetric cryptography (RSA, ECDSA).
 * This implementation uses HMAC for simplicity and demonstration.
 *
 * @param record - The record to sign
 * @param privateKey - The private key for signing
 * @returns A new record with signature field populated
 */
export function signRecord(record: EvidenceRecord, privateKey: string): EvidenceRecord {
  // Create canonical representation for signing
  const dataToSign = JSON.stringify({
    id: record.id,
    contentHash: record.contentHash,
    evidenceType: record.evidenceType,
    generatedAtTime: record.generatedAtTime.toISOString(),
    wasGeneratedBy: record.wasGeneratedBy.id,
    wasAttributedTo: record.wasAttributedTo.id,
  });

  const signature = createHmac('sha256', privateKey)
    .update(dataToSign)
    .digest('hex');

  return {
    ...record,
    signature,
  };
}

/**
 * Verify the cryptographic signature of an evidence record.
 *
 * @param record - The signed record to verify
 * @param publicKey - The public key for verification (paired with signing key)
 * @returns true if signature is valid, false otherwise
 */
export function verifySignature(record: EvidenceRecord, publicKey: string): boolean {
  if (!record.signature) {
    return false;
  }

  // Verify content integrity first
  if (!verifyIntegrity(record)) {
    return false;
  }

  // Re-create the signed data
  const dataToSign = JSON.stringify({
    id: record.id,
    contentHash: record.contentHash,
    evidenceType: record.evidenceType,
    generatedAtTime: record.generatedAtTime.toISOString(),
    wasGeneratedBy: record.wasGeneratedBy.id,
    wasAttributedTo: record.wasAttributedTo.id,
  });

  // For HMAC, the "public key" is actually the same as the private key
  // In production, use proper asymmetric crypto
  const expectedSignature = createHmac('sha256', publicKey)
    .update(dataToSign)
    .digest('hex');

  return record.signature === expectedSignature;
}

/**
 * Export evidence records to W3C PROV-JSON format.
 *
 * @param records - Array of evidence records to export
 * @returns W3C PROV-JSON document
 */
export function exportToProv(records: EvidenceRecord[]): ProvDocument {
  const doc: ProvDocument = {
    prefix: {
      prov: 'http://www.w3.org/ns/prov#',
      xsd: 'http://www.w3.org/2001/XMLSchema#',
      librarian: 'urn:librarian:evidence:',
    },
    entity: {},
    activity: {},
    agent: {},
    wasGeneratedBy: {},
    wasDerivedFrom: {},
    wasAttributedTo: {},
    used: {},
    wasAssociatedWith: {},
  };

  // Track agents to avoid duplicates
  const agentIds = new Set<string>();

  for (const record of records) {
    const entityId = `librarian:${record.id}`;
    const activityId = `librarian:${record.wasGeneratedBy.id}`;
    const agentId = `librarian:${record.wasAttributedTo.id}`;

    // Create Entity
    doc.entity[entityId] = createProvEntity(record);

    // Create Activity
    doc.activity[activityId] = createProvActivity(record.wasGeneratedBy);

    // Create Agent (if not already created)
    if (!agentIds.has(agentId)) {
      doc.agent[agentId] = createProvAgent(record.wasAttributedTo);
      agentIds.add(agentId);
    }

    // wasGeneratedBy relation
    doc.wasGeneratedBy[`librarian:gen_${record.id}`] = {
      'prov:entity': entityId,
      'prov:activity': activityId,
      'prov:time': record.generatedAtTime.toISOString(),
    };

    // wasAttributedTo relation
    doc.wasAttributedTo[`librarian:attr_${record.id}`] = {
      'prov:entity': entityId,
      'prov:agent': agentId,
    };

    // wasAssociatedWith relation
    if (doc.wasAssociatedWith) {
      doc.wasAssociatedWith[`librarian:assoc_${record.id}`] = {
        'prov:activity': activityId,
        'prov:agent': agentId,
      };
    }

    // wasDerivedFrom relations
    if (record.wasDerivedFrom) {
      for (let i = 0; i < record.wasDerivedFrom.length; i++) {
        const sourceRecord = record.wasDerivedFrom[i];
        const sourceEntityId = `librarian:${sourceRecord.id}`;
        const derivationId = `librarian:deriv_${record.id}_${i}`;

        doc.wasDerivedFrom[derivationId] = {
          'prov:generatedEntity': entityId,
          'prov:usedEntity': sourceEntityId,
        };

        // used relation
        if (doc.used) {
          doc.used[`librarian:used_${record.id}_${i}`] = {
            'prov:activity': activityId,
            'prov:entity': sourceEntityId,
          };
        }
      }
    }
  }

  return doc;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a PROV Entity from an evidence record.
 */
function createProvEntity(record: EvidenceRecord): ProvEntity {
  const entity: ProvEntity = {
    'prov:type': `librarian:${record.evidenceType}`,
    'prov:label': `Evidence: ${record.evidenceType}`,
    'librarian:evidenceType': record.evidenceType,
    'librarian:contentHash': record.contentHash,
    'librarian:timestamp': record.generatedAtTime.toISOString(),
  };

  // Include confidence information
  if (record.confidence.type === 'deterministic' ||
      record.confidence.type === 'derived' ||
      record.confidence.type === 'measured') {
    entity['librarian:confidence'] = (record.confidence as { value: number }).value;
  } else if (record.confidence.type === 'bounded') {
    const bounded = record.confidence as { low: number; high: number };
    entity['librarian:confidenceLow'] = bounded.low;
    entity['librarian:confidenceHigh'] = bounded.high;
  } else {
    entity['librarian:confidenceAbsent'] = (record.confidence as { reason: string }).reason;
  }

  if (record.signature) {
    entity['librarian:signature'] = record.signature;
  }

  return entity;
}

/**
 * Create a PROV Activity from an Activity object.
 */
function createProvActivity(activity: Activity): ProvActivity {
  const provActivity: ProvActivity = {
    'prov:type': `librarian:${activity.type}_activity`,
    'prov:label': `${activity.type} activity`,
    'prov:startTime': activity.startedAtTime.toISOString(),
    'librarian:activityType': activity.type,
  };

  if (activity.endedAtTime) {
    provActivity['prov:endTime'] = activity.endedAtTime.toISOString();
  }

  if (activity.usedInputs.length > 0) {
    provActivity['librarian:usedInputs'] = activity.usedInputs;
  }

  return provActivity;
}

/**
 * Create a PROV Agent from an Agent object.
 */
function createProvAgent(agent: Agent): ProvAgent {
  const provAgent: ProvAgent = {
    'prov:type': mapAgentTypeToProvType(agent.type),
    'prov:label': agent.name,
    'librarian:agentType': agent.type,
    'librarian:agentName': agent.name,
  };

  if (agent.version) {
    provAgent['librarian:agentVersion'] = agent.version;
  }

  return provAgent;
}

/**
 * Map agent type to PROV agent type.
 */
function mapAgentTypeToProvType(type: AgentType): string {
  switch (type) {
    case 'llm':
    case 'tool':
    case 'system':
      return 'prov:SoftwareAgent';
    case 'user':
      return 'prov:Person';
    default:
      return 'prov:Agent';
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create input for Activity creation.
 */
export interface CreateActivityInput {
  type: ActivityType;
  startedAtTime: Date;
  endedAtTime?: Date;
  usedInputs: string[];
}

/**
 * Create a new Activity.
 *
 * @param input - Activity creation parameters
 * @returns A new Activity with generated ID
 */
export function createActivity(input: CreateActivityInput): Activity {
  return {
    id: `activity_${input.type}_${randomUUID().slice(0, 8)}`,
    type: input.type,
    startedAtTime: input.startedAtTime,
    endedAtTime: input.endedAtTime,
    usedInputs: input.usedInputs,
  };
}

/**
 * Create input for Agent creation.
 */
export interface CreateAgentInput {
  type: AgentType;
  name: string;
  version?: string;
}

/**
 * Create a new Agent.
 *
 * @param input - Agent creation parameters
 * @returns A new Agent with generated ID
 */
export function createAgent(input: CreateAgentInput): Agent {
  const safeName = input.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return {
    id: `agent_${input.type}_${safeName}`,
    type: input.type,
    name: input.name,
    version: input.version,
  };
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for EvidenceRecord.
 */
export function isEvidenceRecord(value: unknown): value is EvidenceRecord {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    obj.generatedAtTime instanceof Date &&
    isActivity(obj.wasGeneratedBy) &&
    isAgent(obj.wasAttributedTo) &&
    typeof obj.evidenceType === 'string' &&
    typeof obj.content === 'string' &&
    typeof obj.contentHash === 'string' &&
    isConfidenceValue(obj.confidence)
  );
}

/**
 * Type guard for Activity.
 */
export function isActivity(value: unknown): value is Activity {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.type === 'string' &&
    obj.startedAtTime instanceof Date &&
    Array.isArray(obj.usedInputs)
  );
}

/**
 * Type guard for Agent.
 */
export function isAgent(value: unknown): value is Agent {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.name === 'string'
  );
}
