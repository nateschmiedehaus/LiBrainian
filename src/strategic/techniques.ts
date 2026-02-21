import type { VerificationPlan } from './verification_plan.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';

const TECHNIQUE_CATEGORY_IDS = [
  'general',
  'framing',
  'analysis',
  'planning',
  'design',
  'implementation',
  'execution',
  'testing',
  'verification',
  'quality',
  'risk',
  'security',
  'compliance',
  'governance',
  'research',
  'coordination',
  'operations',
  'observability',
  'artifact',
  'evidence',
  'recovery',
  'optimization',
  'meta',
] as const;

export const TECHNIQUE_PRIMITIVE_CATEGORIES = TECHNIQUE_CATEGORY_IDS;

export type TechniquePrimitiveCategory = (typeof TECHNIQUE_CATEGORY_IDS)[number];

const TECHNIQUE_PROFILE_IDS = [
  'general',
  'framing',
  'analysis',
  'planning',
  'design',
  'implementation',
  'execution',
  'testing',
  'verification',
  'quality',
  'risk',
  'security',
  'compliance',
  'governance',
  'research',
  'coordination',
  'operations',
  'observability',
  'artifact',
  'evidence',
  'recovery',
  'optimization',
  'meta',
] as const;

export const TECHNIQUE_SEMANTIC_PROFILE_IDS = TECHNIQUE_PROFILE_IDS;

export type TechniqueSemanticProfileId = (typeof TECHNIQUE_PROFILE_IDS)[number];

const TECHNIQUE_DOMAIN_IDS = [
  'analysis',
  'planning',
  'design',
  'implementation',
  'testing',
  'verification',
  'quality',
  'security',
  'compliance',
  'governance',
  'research',
  'coordination',
  'operations',
  'observability',
  'artifact',
  'evidence',
  'performance',
  'reliability',
  'resilience',
  'economics',
  'safety',
  'product',
  'ux',
  'data',
  'platform',
  'tooling',
  'policy',
  'risk',
  'recovery',
  'optimization',
  'meta',
] as const;

export const TECHNIQUE_DOMAIN_TAGS = TECHNIQUE_DOMAIN_IDS;

export type TechniqueDomainId = (typeof TECHNIQUE_DOMAIN_IDS)[number] | `custom:${string}`;

const TECHNIQUE_PRIMITIVE_KIND_IDS = [
  'cognitive',
  'procedural',
  'epistemic',
  'diagnostic',
  'orchestrating',
] as const;

export const TECHNIQUE_PRIMITIVE_KINDS = TECHNIQUE_PRIMITIVE_KIND_IDS;

export type TechniquePrimitiveKind = (typeof TECHNIQUE_PRIMITIVE_KIND_IDS)[number];

const TECHNIQUE_ABSTRACTION_LEVEL_IDS = [
  'meta',
  'strategic',
  'tactical',
  'operational',
] as const;

export const TECHNIQUE_ABSTRACTION_LEVELS = TECHNIQUE_ABSTRACTION_LEVEL_IDS;

export type TechniqueAbstractionLevel = (typeof TECHNIQUE_ABSTRACTION_LEVEL_IDS)[number];

const TECHNIQUE_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'null',
  'unknown',
] as const;

export type TechniqueFieldType = (typeof TECHNIQUE_FIELD_TYPES)[number];

const TECHNIQUE_FIELD_ORIGINS = [
  'declared',
  'inferred',
  'unspecified',
] as const;

export type TechniqueFieldOrigin = (typeof TECHNIQUE_FIELD_ORIGINS)[number];

export interface TechniqueFieldSpec {
  name: string;
  type?: TechniqueFieldType;
  origin?: TechniqueFieldOrigin;
  required: boolean;
  description?: string;
}

export interface TechniqueVerificationSpec {
  automatedChecks?: string[];
  manualChecks?: string[];
  expectedObservations?: string[];
}

export interface TechniqueExecutionExample {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  notes?: string;
}

export type JsonSchemaType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

export interface JsonSchemaProperty {
  type?: JsonSchemaType | readonly JsonSchemaType[];
  description?: string;
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  additionalProperties?: boolean | JsonSchemaProperty;
}

export interface JsonSchemaObject {
  type: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaProperty;
}

export interface TechniquePrimitiveContract {
  inputs: TechniqueFieldSpec[];
  outputs: TechniqueFieldSpec[];
  inputSchema?: JsonSchemaObject;
  outputSchema?: JsonSchemaObject;
  preconditions?: string[];
  postconditions?: string[];
  invariants?: string[];
  verification?: TechniqueVerificationSpec;
  examples?: TechniqueExecutionExample[];
}

export interface TechniqueFormalSemantics {
  preconditions: string[];
  postconditions: string[];
  invariants?: string[];
  evidenceRequirements?: string[];
  termination: 'always' | 'conditional' | 'unknown';
  determinism: 'deterministic' | 'probabilistic' | 'unknown';
  complexity: 'constant' | 'linear' | 'quadratic' | 'unbounded' | 'unknown';
}

export interface TechniquePrimitive {
  id: string;
  name: string;
  intent: string;
  category?: TechniquePrimitiveCategory;
  semanticProfileId?: TechniqueSemanticProfileId;
  primitiveKind?: TechniquePrimitiveKind;
  abstractionLevel?: TechniqueAbstractionLevel;
  domains?: string[];
  semantics?: TechniqueFormalSemantics;
  contract?: TechniquePrimitiveContract;
  confidence?: ConfidenceValue;
  triggers: string[];
  inputsRequired: string[];
  actions: string[];
  verification?: VerificationPlan;
  failureModes: string[];
  outputs: string[];
  createdAt: string;
  updatedAt: string;
}

export const TECHNIQUE_OPERATOR_TYPES = [
  'sequence',
  'parallel',
  'conditional',
  'loop',
  'gate',
  'fallback',
  'merge',
  'fanout',
  'fanin',
  'retry',
  'escalate',
  'checkpoint',
  'interrupt',
  'timebox',
  'budget_cap',
  'throttle',
  'quorum',
  'consensus',
  'backoff',
  'circuit_breaker',
  'monitor',
  'persist',
  'replay',
  'cache',
  'reduce',
] as const;

export type BuiltinTechniqueOperatorType = (typeof TECHNIQUE_OPERATOR_TYPES)[number];
export type TechniqueOperatorType = BuiltinTechniqueOperatorType | `custom:${string}`;

export interface TechniqueOperator {
  id: string;
  type: TechniqueOperatorType;
  label?: string;
  inputs?: string[];
  outputs?: string[];
  conditions?: string[];
  parameters?: Record<string, unknown>;
}

export const TECHNIQUE_RELATIONSHIP_TYPES = [
  'depends_on',
  'blocks',
  'parallel_with',
  'enables',
  'verifies',
  'produces',
  'consumes',
  'refines',
  'supersedes',
  'fallback_for',
  'validates',
  'reinforces',
  'conflicts_with',
  'evidence_for',
  'invalidates',
  'derived_from',
  'requires_context',
  'affects',
  'causes',
  'mitigates',
  'covers',
  'duplicate_of',
  'equivalent_to',
  'alternative_to',
] as const;

export type BuiltinTechniqueRelationshipType = (typeof TECHNIQUE_RELATIONSHIP_TYPES)[number];
export type TechniqueRelationshipType = BuiltinTechniqueRelationshipType | `custom:${string}`;

const CUSTOM_TYPE_PATTERN = /^custom:[a-zA-Z0-9_]+$/;

export function isCustomOperatorType(value: string): value is `custom:${string}` {
  return CUSTOM_TYPE_PATTERN.test(value);
}

export function isCustomRelationshipType(value: string): value is `custom:${string}` {
  return CUSTOM_TYPE_PATTERN.test(value);
}

export function isBuiltinOperatorType(value: string): value is BuiltinTechniqueOperatorType {
  return TECHNIQUE_OPERATOR_TYPES.includes(value as BuiltinTechniqueOperatorType);
}

export function isBuiltinRelationshipType(value: string): value is BuiltinTechniqueRelationshipType {
  return TECHNIQUE_RELATIONSHIP_TYPES.includes(value as BuiltinTechniqueRelationshipType);
}

export type TechniqueCompositionGraphVersion = 1 | 2;

export interface TechniqueRelationship {
  fromId: string;
  toId: string;
  type: TechniqueRelationshipType;
  condition?: string;
  weight?: number;
  notes?: string;
}

export interface TechniqueComposition {
  id: string;
  name: string;
  description: string;
  primitiveIds: string[];
  operators?: TechniqueOperator[];
  relationships?: TechniqueRelationship[];
  graphVersion?: TechniqueCompositionGraphVersion;
  createdAt: string;
  updatedAt: string;
}

const SEMANTIC_TERMINATION_VALUES = new Set(['always', 'conditional', 'unknown']);
const SEMANTIC_DETERMINISM_VALUES = new Set(['deterministic', 'probabilistic', 'unknown']);
const SEMANTIC_COMPLEXITY_VALUES = new Set(['constant', 'linear', 'quadratic', 'unbounded', 'unknown']);
const PRIMITIVE_KIND_VALUES = new Set<TechniquePrimitiveKind>(TECHNIQUE_PRIMITIVE_KINDS);
const ABSTRACTION_LEVEL_VALUES = new Set<TechniqueAbstractionLevel>(TECHNIQUE_ABSTRACTION_LEVELS);
const FIELD_TYPE_VALUES = new Set<TechniqueFieldType>(TECHNIQUE_FIELD_TYPES);
const FIELD_ORIGIN_VALUES = new Set<TechniqueFieldOrigin>(TECHNIQUE_FIELD_ORIGINS);
const JSON_SCHEMA_TYPES = new Set<JsonSchemaType>(['string', 'number', 'boolean', 'object', 'array', 'null']);
const JSON_SCHEMA_UNKNOWN_TYPES: readonly JsonSchemaType[] = ['string', 'number', 'boolean', 'object', 'array', 'null'];
const SAFE_SCHEMA_PROPERTY_PATTERN = /^[A-Za-z][A-Za-z0-9 _:/-]*$/;
const MAX_SCHEMA_PROPERTY_LENGTH = 200;
const FORBIDDEN_SCHEMA_PROPERTY_NAMES = new Set([
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'prototype',
  'constructor',
]);
const INTERNAL_SCHEMA_KEY_PREFIXES = ['__parallel_', '__operator_state', '__condition_'];
const MAX_SCHEMA_DEPTH = 12;

// Default mappings for category → kind/level. Override per-primitive as needed.
const DEFAULT_PRIMITIVE_KIND_BY_CATEGORY: Record<TechniquePrimitiveCategory, TechniquePrimitiveKind> = {
  general: 'procedural',
  framing: 'cognitive',
  analysis: 'diagnostic',
  planning: 'cognitive',
  design: 'cognitive',
  implementation: 'procedural',
  execution: 'procedural',
  testing: 'procedural',
  verification: 'epistemic',
  quality: 'diagnostic',
  risk: 'diagnostic',
  security: 'diagnostic',
  compliance: 'orchestrating',
  governance: 'orchestrating',
  research: 'epistemic',
  coordination: 'orchestrating',
  operations: 'procedural',
  observability: 'epistemic',
  artifact: 'procedural',
  evidence: 'epistemic',
  recovery: 'diagnostic',
  optimization: 'procedural',
  meta: 'cognitive',
};

const DEFAULT_PRIMITIVE_LEVEL_BY_CATEGORY: Record<TechniquePrimitiveCategory, TechniqueAbstractionLevel> = {
  general: 'tactical',
  framing: 'meta',
  analysis: 'strategic',
  planning: 'strategic',
  design: 'strategic',
  implementation: 'operational',
  execution: 'operational',
  testing: 'operational',
  verification: 'tactical',
  quality: 'tactical',
  risk: 'tactical',
  security: 'tactical',
  compliance: 'strategic',
  governance: 'strategic',
  research: 'strategic',
  coordination: 'strategic',
  operations: 'operational',
  observability: 'operational',
  artifact: 'operational',
  evidence: 'tactical',
  recovery: 'tactical',
  optimization: 'tactical',
  meta: 'meta',
};

function assertPrimitiveMappingCoverage(): void {
  for (const category of TECHNIQUE_PRIMITIVE_CATEGORIES) {
    if (!DEFAULT_PRIMITIVE_KIND_BY_CATEGORY[category]) {
      throw new Error(`unverified_by_trace(primitive_kind_mapping_missing): ${category}`);
    }
    if (!DEFAULT_PRIMITIVE_LEVEL_BY_CATEGORY[category]) {
      throw new Error(`unverified_by_trace(primitive_level_mapping_missing): ${category}`);
    }
  }
}

assertPrimitiveMappingCoverage();

function assertCategory(value: TechniquePrimitiveCategory | undefined): void {
  if (!value) return;
  if (!TECHNIQUE_PRIMITIVE_CATEGORIES.includes(value)) {
    throw new Error(`unverified_by_trace(invalid_technique_category): ${value}`);
  }
}

function assertSemanticProfileId(value: TechniqueSemanticProfileId | undefined): void {
  if (!value) return;
  if (!TECHNIQUE_SEMANTIC_PROFILE_IDS.includes(value)) {
    throw new Error(`unverified_by_trace(invalid_semantic_profile): ${value}`);
  }
}

function assertPrimitiveKind(value: TechniquePrimitiveKind | undefined): void {
  if (!value) return;
  if (!PRIMITIVE_KIND_VALUES.has(value)) {
    throw new Error(`unverified_by_trace(invalid_technique_kind): ${value}`);
  }
}

function assertAbstractionLevel(value: TechniqueAbstractionLevel | undefined): void {
  if (!value) return;
  if (!ABSTRACTION_LEVEL_VALUES.has(value)) {
    throw new Error(`unverified_by_trace(invalid_technique_level): ${value}`);
  }
}

function assertDomains(value: string[] | undefined): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new Error('unverified_by_trace(invalid_technique_domains)');
  }
}

function assertSafeSchemaPropertyName(name: string): void {
  const trimmedName = name.trim();
  if (trimmedName.startsWith('__')) {
    if (FORBIDDEN_SCHEMA_PROPERTY_NAMES.has(trimmedName)) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
    if (INTERNAL_SCHEMA_KEY_PREFIXES.some((prefix) => trimmedName.startsWith(prefix))) {
      return;
    }
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  if (
    trimmedName.length === 0 ||
    trimmedName.length > MAX_SCHEMA_PROPERTY_LENGTH ||
    trimmedName !== name ||
    !SAFE_SCHEMA_PROPERTY_PATTERN.test(trimmedName) ||
    FORBIDDEN_SCHEMA_PROPERTY_NAMES.has(trimmedName)
  ) {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
}

function assertFieldSpec(field: TechniqueFieldSpec): void {
  if (!field.name || typeof field.name !== 'string') {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  assertSafeSchemaPropertyName(field.name);
  if (field.type !== undefined && !FIELD_TYPE_VALUES.has(field.type)) {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  if (!field.origin || !FIELD_ORIGIN_VALUES.has(field.origin)) {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  if (typeof field.required !== 'boolean') {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  if (field.description !== undefined && typeof field.description !== 'string') {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function schemaTypeAllows(
  typeValue: JsonSchemaProperty['type'],
  expected: JsonSchemaType
): boolean {
  if (!typeValue) return true;
  if (Array.isArray(typeValue)) {
    return typeValue.includes(expected);
  }
  return typeValue === expected;
}

function assertJsonSchemaProperty(value: unknown, depth = 0): void {
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  if (!isPlainObject(value)) {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  const property = value as JsonSchemaProperty;
  const typeValue = property.type;
  if (typeValue !== undefined) {
    if (Array.isArray(typeValue)) {
      if (typeValue.length === 0 || typeValue.some((entry) => !JSON_SCHEMA_TYPES.has(entry))) {
        throw new Error('unverified_by_trace(invalid_technique_contract)');
      }
    } else if (!JSON_SCHEMA_TYPES.has(typeValue as JsonSchemaType)) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
  }
  if (property.description !== undefined && typeof property.description !== 'string') {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  if (property.properties !== undefined) {
    if (!schemaTypeAllows(typeValue, 'object')) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
    if (!isPlainObject(property.properties)) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
    for (const [key, childSchema] of Object.entries(property.properties)) {
      assertSafeSchemaPropertyName(key);
      assertJsonSchemaProperty(childSchema, depth + 1);
    }
  }
  if (property.items !== undefined) {
    if (!schemaTypeAllows(typeValue, 'array')) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
    assertJsonSchemaProperty(property.items, depth + 1);
  }
  if (property.additionalProperties !== undefined) {
    if (!schemaTypeAllows(typeValue, 'object')) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
    const additional = property.additionalProperties;
    if (typeof additional !== 'boolean' && !isPlainObject(additional)) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
    if (typeof additional !== 'boolean') {
      assertJsonSchemaProperty(additional, depth + 1);
    }
  }
}

function assertJsonSchemaObject(value: unknown, depth = 0): asserts value is JsonSchemaObject {
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  if (!isPlainObject(value)) {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  if (value.type !== 'object') {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  if (value.properties !== undefined) {
    if (!isPlainObject(value.properties)) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
    for (const [key, property] of Object.entries(value.properties)) {
      assertSafeSchemaPropertyName(key);
      assertJsonSchemaProperty(property, depth + 1);
    }
  }
  if (value.required !== undefined) {
    if (!Array.isArray(value.required) || value.required.some((entry) => typeof entry !== 'string')) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
    if (!value.properties) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
    for (const entry of value.required) {
      if (!Object.prototype.hasOwnProperty.call(value.properties, entry)) {
        throw new Error('unverified_by_trace(invalid_technique_contract)');
      }
    }
  }
  if (value.additionalProperties !== undefined) {
    const additional = value.additionalProperties;
    if (typeof additional !== 'boolean' && !isPlainObject(additional)) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
    if (typeof additional !== 'boolean') {
      assertJsonSchemaProperty(additional, depth + 1);
    }
  }
}

function assertUniqueFieldNames(fields: TechniqueFieldSpec[], label: string): void {
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.name)) {
      throw new Error(`unverified_by_trace(invalid_technique_contract): duplicate_${label}`);
    }
    seen.add(field.name);
  }
}

function assertContract(value: TechniquePrimitiveContract | undefined): void {
  if (!value) return;
  if (!Array.isArray(value.inputs) || !Array.isArray(value.outputs)) {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  assertUniqueFieldNames(value.inputs, 'inputs');
  assertUniqueFieldNames(value.outputs, 'outputs');
  value.inputs.forEach(assertFieldSpec);
  value.outputs.forEach(assertFieldSpec);
  if (value.preconditions && !Array.isArray(value.preconditions)) {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  if (value.postconditions && !Array.isArray(value.postconditions)) {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  if (value.invariants && !Array.isArray(value.invariants)) {
    throw new Error('unverified_by_trace(invalid_technique_contract)');
  }
  if (value.verification) {
    if (value.verification.automatedChecks && !Array.isArray(value.verification.automatedChecks)) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
    if (value.verification.manualChecks && !Array.isArray(value.verification.manualChecks)) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
    if (value.verification.expectedObservations && !Array.isArray(value.verification.expectedObservations)) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
  }
  if (value.examples) {
    if (!Array.isArray(value.examples)) {
      throw new Error('unverified_by_trace(invalid_technique_contract)');
    }
    for (const example of value.examples) {
      if (!example || typeof example !== 'object') {
        throw new Error('unverified_by_trace(invalid_technique_contract)');
      }
    }
  }
  if (value.inputSchema !== undefined) {
    assertJsonSchemaObject(value.inputSchema);
  }
  if (value.outputSchema !== undefined) {
    assertJsonSchemaObject(value.outputSchema);
  }
}

function assertFormalSemantics(value: TechniqueFormalSemantics | undefined): void {
  if (!value) return;
  if (!Array.isArray(value.preconditions) || !Array.isArray(value.postconditions)) {
    throw new Error('unverified_by_trace(invalid_technique_semantics)');
  }
  if (value.invariants !== undefined && !Array.isArray(value.invariants)) {
    throw new Error('unverified_by_trace(invalid_technique_semantics)');
  }
  if (value.evidenceRequirements !== undefined && !Array.isArray(value.evidenceRequirements)) {
    throw new Error('unverified_by_trace(invalid_technique_semantics)');
  }
  if (!SEMANTIC_TERMINATION_VALUES.has(value.termination)) {
    throw new Error('unverified_by_trace(invalid_technique_semantics)');
  }
  if (!SEMANTIC_DETERMINISM_VALUES.has(value.determinism)) {
    throw new Error('unverified_by_trace(invalid_technique_semantics)');
  }
  if (!SEMANTIC_COMPLEXITY_VALUES.has(value.complexity)) {
    throw new Error('unverified_by_trace(invalid_technique_semantics)');
  }
}

function normalizeFieldSpec(field: TechniqueFieldSpec): TechniqueFieldSpec {
  const origin = field.origin ?? (field.type ? 'declared' : 'unspecified');
  return {
    ...field,
    origin,
    description: typeof field.description === 'string' ? field.description : undefined,
  };
}

function normalizeContract(contract: TechniquePrimitiveContract): TechniquePrimitiveContract {
  const inputSchema = contract.inputSchema ?? buildSchemaFromFieldSpecs(contract.inputs, 'input');
  const outputSchema = contract.outputSchema ?? buildSchemaFromFieldSpecs(contract.outputs, 'output');
  return {
    ...contract,
    inputs: contract.inputs.map((field) => normalizeFieldSpec(field)),
    outputs: contract.outputs.map((field) => normalizeFieldSpec(field)),
    inputSchema,
    outputSchema,
  };
}

function derivePrimitiveKind(category: TechniquePrimitiveCategory): TechniquePrimitiveKind {
  return DEFAULT_PRIMITIVE_KIND_BY_CATEGORY[category] ?? 'procedural';
}

function deriveAbstractionLevel(category: TechniquePrimitiveCategory): TechniqueAbstractionLevel {
  return DEFAULT_PRIMITIVE_LEVEL_BY_CATEGORY[category] ?? 'tactical';
}

// Keep in sync with MAX_CONDITION_COUNT in src/librainian/api/technique_contracts.ts.
const MAX_CONDITION_COUNT = 200;

function buildContractFromPrimitive(input: {
  inputsRequired: string[];
  outputs: string[];
  semantics?: TechniqueFormalSemantics;
  verification?: VerificationPlan;
}): TechniquePrimitiveContract {
  // Auto-generated fields keep origin=unspecified to avoid implying type safety.
  const inputs = input.inputsRequired.map((name) => ({ name, required: true, origin: 'unspecified' as const }));
  const outputs = input.outputs.map((name) => ({ name, required: true, origin: 'unspecified' as const }));
  const inputSchema = buildSchemaFromFieldSpecs(inputs, 'input');
  const outputSchema = buildSchemaFromFieldSpecs(outputs, 'output');
  const autoPreconditions = inputs
    .filter((field) => field.required)
    .map((field) => `exists(input[${JSON.stringify(field.name)}])`);
  const autoPostconditions = outputs
    .filter((field) => field.required)
    .map((field) => `exists(output[${JSON.stringify(field.name)}])`);
  // Preserve user-defined conditions without dedup to avoid silent drops.
  const preconditions = [
    ...autoPreconditions,
    ...(input.semantics?.preconditions ?? []),
  ];
  const postconditions = [
    ...autoPostconditions,
    ...(input.semantics?.postconditions ?? []),
  ];
  if (preconditions.length > MAX_CONDITION_COUNT) {
    throw new Error('unverified_by_trace(invalid_technique_contract): precondition_limit_exceeded');
  }
  if (postconditions.length > MAX_CONDITION_COUNT) {
    throw new Error('unverified_by_trace(invalid_technique_contract): postcondition_limit_exceeded');
  }
  const verification = input.verification
    ? {
        automatedChecks: input.verification.methods
          .filter((method) => method.automatable)
          .map((method) => formatVerificationMethod(method))
          .filter((value) => value.length > 0),
        manualChecks: input.verification.methods
          .filter((method) => !method.automatable)
          .map((method) => formatVerificationMethod(method))
          .filter((value) => value.length > 0),
        expectedObservations: input.verification.expectedObservations,
      }
    : {
        automatedChecks: [
          'schema_valid:input',
          'schema_valid:output',
          ...(preconditions.length ? ['preconditions_hold'] : []),
          ...(postconditions.length ? ['postconditions_hold'] : []),
        ],
      };
  return {
    inputs,
    outputs,
    inputSchema,
    outputSchema,
    preconditions,
    postconditions,
    invariants: input.semantics?.invariants ?? [],
    verification,
  };
}

function buildSchemaFromFieldSpecs(
  specs: TechniqueFieldSpec[],
  kind: 'input' | 'output'
): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = Object.create(null);
  for (const spec of specs) {
    if (Object.prototype.hasOwnProperty.call(properties, spec.name)) {
      throw new Error('unverified_by_trace(invalid_technique_contract): duplicate_field');
    }
    const description = spec.description ?? `${kind} ${spec.name}`;
    const type = !spec.type || spec.type === 'unknown'
      ? JSON_SCHEMA_UNKNOWN_TYPES
      : spec.type;
    properties[spec.name] = { description, type };
  }
  const required = specs.filter((spec) => spec.required).map((spec) => spec.name);
  return {
    type: 'object',
    properties,
    required,
    // Allow extra fields to avoid rejecting enriched inputs/outputs.
    additionalProperties: true,
  };
}

function formatVerificationMethod(method: VerificationPlan['methods'][number]): string {
  const type = typeof method.type === 'string' && method.type.length > 0 ? method.type : 'other';
  const command = typeof method.command === 'string' ? method.command.trim() : '';
  const description = typeof method.description === 'string' ? method.description.trim() : '';
  if (command) {
    return `${type}:${command}`;
  }
  return description || type;
}

export function createTechniquePrimitive(input: {
  id: string;
  name: string;
  intent: string;
  category?: TechniquePrimitiveCategory;
  semanticProfileId?: TechniqueSemanticProfileId;
  primitiveKind?: TechniquePrimitiveKind;
  abstractionLevel?: TechniqueAbstractionLevel;
  domains?: string[];
  semantics?: TechniqueFormalSemantics;
  contract?: TechniquePrimitiveContract;
  confidence?: ConfidenceValue;
  triggers?: string[];
  inputsRequired?: string[];
  actions?: string[];
  verification?: VerificationPlan;
  failureModes?: string[];
  outputs?: string[];
  createdAt?: string;
  updatedAt?: string;
}): TechniquePrimitive {
  const now = new Date().toISOString();
  const category = input.category ?? 'general';
  const semanticProfileId = input.semanticProfileId ?? 'general';
  const primitiveKind = input.primitiveKind ?? derivePrimitiveKind(category);
  const abstractionLevel = input.abstractionLevel ?? deriveAbstractionLevel(category);
  assertCategory(category);
  assertSemanticProfileId(semanticProfileId);
  assertPrimitiveKind(primitiveKind);
  assertAbstractionLevel(abstractionLevel);
  assertDomains(input.domains);
  assertFormalSemantics(input.semantics);
  const contract = input.contract ?? buildContractFromPrimitive({
    inputsRequired: input.inputsRequired ?? [],
    outputs: input.outputs ?? [],
    semantics: input.semantics,
    verification: input.verification,
  });
  const normalizedContract = normalizeContract(contract);
  assertContract(normalizedContract);
  return {
    id: input.id,
    name: input.name,
    intent: input.intent,
    category,
    semanticProfileId,
    primitiveKind,
    abstractionLevel,
    domains: input.domains ?? [],
    semantics: input.semantics,
    contract: normalizedContract,
    confidence: input.confidence,
    triggers: input.triggers ?? [],
    inputsRequired: input.inputsRequired ?? [],
    actions: input.actions ?? [],
    verification: input.verification,
    failureModes: input.failureModes ?? [],
    outputs: input.outputs ?? [],
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

export function normalizeTechniquePrimitive(primitive: TechniquePrimitive): TechniquePrimitive {
  const category = primitive.category ?? 'general';
  const semanticProfileId = primitive.semanticProfileId ?? 'general';
  const primitiveKind = primitive.primitiveKind ?? derivePrimitiveKind(category);
  const abstractionLevel = primitive.abstractionLevel ?? deriveAbstractionLevel(category);
  const inputsRequired = primitive.inputsRequired ?? [];
  const outputs = primitive.outputs ?? [];
  const contract = primitive.contract ?? buildContractFromPrimitive({
    inputsRequired,
    outputs,
    semantics: primitive.semantics,
    verification: primitive.verification,
  });
  const normalizedContract = normalizeContract(contract);
  assertCategory(category);
  assertSemanticProfileId(semanticProfileId);
  assertPrimitiveKind(primitiveKind);
  assertAbstractionLevel(abstractionLevel);
  assertDomains(primitive.domains);
  assertFormalSemantics(primitive.semantics);
  assertContract(normalizedContract);
  return {
    ...primitive,
    category,
    semanticProfileId,
    primitiveKind,
    abstractionLevel,
    inputsRequired,
    outputs,
    triggers: primitive.triggers ?? [],
    actions: primitive.actions ?? [],
    failureModes: primitive.failureModes ?? [],
    domains: primitive.domains ?? [],
    contract: normalizedContract,
  };
}

export function createTechniqueComposition(input: {
  id: string;
  name: string;
  description: string;
  primitiveIds: string[];
  operators?: TechniqueOperator[];
  relationships?: TechniqueRelationship[];
  graphVersion?: TechniqueCompositionGraphVersion;
  createdAt?: string;
  updatedAt?: string;
}): TechniqueComposition {
  const now = new Date().toISOString();
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    primitiveIds: input.primitiveIds,
    operators: input.operators,
    relationships: input.relationships,
    graphVersion: input.graphVersion ?? 2,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}
