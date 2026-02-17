# Track D: Cross-Language Contract Tracing (Polyglot Contracts)

> **Addresses**: Part XVII.F from `docs/LiBrainian/THEORETICAL_CRITIQUE.md` - Cross-Language Contract Tracing
> **Problem**: Modern codebases are polyglot (Python backend, TypeScript frontend, Go services). LiBrainian cannot trace contracts across language boundaries.
> **Current Rating**: Limited (Single-language contract analysis only)
>
> **LiBrainian Story**: Chapter 10 (The Polyglot) - Making LiBrainian understand contracts that span language boundaries.
>
> **Related Specifications**:
> - [track-e-domain.md](./track-e-domain.md) - API design primitives for universal domain support
> - [track-i-multi-repo.md](./track-i-multi-repo.md) - Cross-repo contracts in federated systems
> - [track-a-core-pipeline.md](./track-a-core-pipeline.md) - Contract-aware analysis in core pipeline
>
> **Theory Reference**: All confidence values MUST use `ConfidenceValue` from Track D. See [GLOSSARY.md](./GLOSSARY.md).

---

## Executive Summary

Track D addresses the fundamental polyglot contract problem: **How does an intelligent system trace and validate contracts that are defined in one language and consumed in another?**

Modern software systems routinely span multiple languages:
- Pydantic models (Python) defining API contracts consumed by Zod schemas (TypeScript)
- OpenAPI specifications generating clients in multiple languages
- Protobuf definitions compiled to Go, Python, TypeScript implementations
- GraphQL schemas driving resolvers and client code

This specification covers:
- **Contract Type Taxonomy** - Classification of cross-language contracts
- **Schema Contract Registry** - Central registry for tracking contracts
- **Cross-Language Detection** - Detecting contracts across language boundaries
- **Contract Violation Checking** - Validating implementations against contracts
- **Polyglot Primitives** - Operations for contract tracing and validation
- **Common Patterns** - Standard polyglot contract patterns

---

## 1. Problem Statement

### The Polyglot Reality

Modern software development is inherently polyglot:

```
+---------------------------------------------------------------------+
|                    TYPICAL POLYGLOT ARCHITECTURE                     |
|                                                                     |
|  Python Backend                TypeScript Frontend                  |
|  +-------------------+        +-------------------+                 |
|  | Pydantic Models   |        | Zod Schemas       |                 |
|  | class User:       |  <-->  | const UserSchema  |                 |
|  |   name: str       |        |   = z.object({    |                 |
|  |   email: str      |        |     name: z.str() |                 |
|  |   age: int        |        |     email: z.str()|                 |
|  +-------------------+        |     age: z.num()  |                 |
|                               +-------------------+                 |
|                                                                     |
|  OpenAPI Spec                 Generated Clients                     |
|  +-------------------+        +-------------------+                 |
|  | openapi: 3.0.0    | --->   | TypeScript client |                 |
|  | paths:            |        | Python client     |                 |
|  |   /users:         |        | Go client         |                 |
|  |     get: ...      |        | Java client       |                 |
|  +-------------------+        +-------------------+                 |
|                                                                     |
|  Questions that CANNOT be answered without cross-language tracing:  |
|  - "Does my TypeScript Zod schema match my Python Pydantic model?"  |
|  - "Which generated clients are out of sync with the OpenAPI spec?" |
|  - "What breaks if I add a required field to the Protobuf?"         |
|  - "Are there nullability mismatches between languages?"            |
+---------------------------------------------------------------------+
```

### What Single-Language Analysis Cannot Do

| Question | Single-Language Answer | What's Actually Needed |
|----------|------------------------|------------------------|
| "Does the frontend contract match the backend?" | Unknown | Cross-language structural comparison |
| "Are all API clients up to date?" | Can check one language | Check all generated clients |
| "Is this field nullable in all consumers?" | Can check this language | Check all language implementations |
| "What happens if I change this schema?" | Impact in this language | Impact across all consuming languages |

### Liskov's Insight

**Barbara Liskov's Substitutability Principle extends to cross-language contracts**: If a contract C is defined in language A and consumed in language B, the implementation in B must be substitutable for any valid instance of C in A.

This means:
- Type structures must be compatible across boundaries
- Nullability semantics must be preserved
- Constraints must be honored
- Field additions/removals must be detected

---

## 2. Contract Types

### Contract Type Taxonomy

```typescript
/**
 * Classification of contract types across language boundaries.
 *
 * INSIGHT: Different contract types have different detection
 * strategies and violation semantics.
 */
type ContractType =
  | 'schema'    // JSON Schema, OpenAPI, AsyncAPI
  | 'type'      // TypeScript types, Pydantic models, Zod schemas
  | 'protocol'  // Protobuf, Thrift, gRPC service definitions
  | 'api'       // REST endpoints, GraphQL operations
  | 'event'     // Event schemas, message formats (Kafka, RabbitMQ)
  | 'config';   // Configuration schemas, environment contracts

/**
 * Contract type metadata for detection and validation.
 */
interface ContractTypeMetadata {
  type: ContractType;

  /** Languages this contract type can be defined in */
  definitionLanguages: string[];

  /** Languages this contract type can be consumed in */
  consumptionLanguages: string[];

  /** File patterns for detection */
  filePatterns: string[];

  /** AST markers for detection */
  astMarkers: ASTMarker[];

  /** Generation tools that produce this type */
  generationTools: string[];
}

/**
 * Contract type registry.
 */
const CONTRACT_TYPE_METADATA: Map<ContractType, ContractTypeMetadata> = new Map([
  ['schema', {
    type: 'schema',
    definitionLanguages: ['json', 'yaml', 'openapi'],
    consumptionLanguages: ['typescript', 'python', 'go', 'java', 'rust'],
    filePatterns: ['*.schema.json', 'openapi.yaml', 'asyncapi.yaml'],
    astMarkers: [{ type: 'json_schema_keyword', values: ['$schema', 'type', 'properties'] }],
    generationTools: ['openapi-generator', 'swagger-codegen', 'quicktype'],
  }],
  ['type', {
    type: 'type',
    definitionLanguages: ['typescript', 'python', 'go', 'rust'],
    consumptionLanguages: ['typescript', 'python', 'go', 'rust', 'java'],
    filePatterns: ['*.types.ts', 'models.py', 'types.go'],
    astMarkers: [
      { type: 'decorator', values: ['@dataclass', 'BaseModel'] },
      { type: 'function_call', values: ['z.object', 'z.string', 'z.number'] },
    ],
    generationTools: ['pydantic2ts', 'ts-to-zod', 'typeshare'],
  }],
  ['protocol', {
    type: 'protocol',
    definitionLanguages: ['protobuf', 'thrift', 'avro'],
    consumptionLanguages: ['python', 'typescript', 'go', 'java', 'rust', 'cpp'],
    filePatterns: ['*.proto', '*.thrift', '*.avsc'],
    astMarkers: [{ type: 'keyword', values: ['message', 'service', 'rpc'] }],
    generationTools: ['protoc', 'thrift', 'avro-tools'],
  }],
  ['api', {
    type: 'api',
    definitionLanguages: ['openapi', 'graphql', 'grpc'],
    consumptionLanguages: ['typescript', 'python', 'go', 'java', 'swift', 'kotlin'],
    filePatterns: ['openapi.yaml', 'schema.graphql', '*.proto'],
    astMarkers: [
      { type: 'graphql_keyword', values: ['type Query', 'type Mutation', 'schema'] },
    ],
    generationTools: ['graphql-codegen', 'openapi-typescript', 'grpc-tools'],
  }],
  ['event', {
    type: 'event',
    definitionLanguages: ['json', 'avro', 'protobuf', 'asyncapi'],
    consumptionLanguages: ['typescript', 'python', 'go', 'java'],
    filePatterns: ['events/*.json', 'asyncapi.yaml', '*.avsc'],
    astMarkers: [{ type: 'asyncapi_keyword', values: ['asyncapi', 'channels', 'messages'] }],
    generationTools: ['asyncapi-generator', 'confluent-schema-registry'],
  }],
  ['config', {
    type: 'config',
    definitionLanguages: ['json', 'yaml', 'typescript', 'python'],
    consumptionLanguages: ['typescript', 'python', 'go', 'rust'],
    filePatterns: ['config.schema.json', '.env.example', 'settings.py'],
    astMarkers: [{ type: 'env_pattern', values: ['process.env', 'os.environ', 'os.Getenv'] }],
    generationTools: ['json-schema-to-typescript', 'pydantic-settings'],
  }],
]);

interface ASTMarker {
  type: 'decorator' | 'function_call' | 'keyword' | 'json_schema_keyword' | 'graphql_keyword' | 'asyncapi_keyword' | 'env_pattern';
  values: string[];
}
```

---

## 3. Schema Contract Registry

### Core Registry Interface

```typescript
/**
 * Central registry for tracking schema contracts across language boundaries.
 *
 * INVARIANT: Every contract has exactly one source of truth
 * INVARIANT: All implementations must reference their source contract
 * INVARIANT: Violations are detected on registration and on demand
 */
interface SchemaContractRegistry {
  /** All registered contracts by ID */
  contracts: Map<ContractId, SchemaContract>;

  /** Implementations indexed by contract ID */
  implementations: Map<ContractId, Implementation[]>;

  /** Detected violations */
  violations: ContractViolation[];

  /** Registry metadata */
  metadata: RegistryMetadata;
}

type ContractId = string & { readonly __brand: 'ContractId' };

interface RegistryMetadata {
  /** When registry was created */
  createdAt: Date;

  /** When registry was last updated */
  lastUpdatedAt: Date;

  /** Total contracts registered */
  contractCount: number;

  /** Total implementations tracked */
  implementationCount: number;

  /** Total violations detected */
  violationCount: number;

  /** Registry health confidence */
  healthConfidence: ConfidenceValue;
}
```

### Schema Contract Definition

```typescript
/**
 * A schema contract defines a structure that must be honored
 * across language boundaries.
 */
interface SchemaContract {
  /** Unique identifier */
  id: ContractId;

  /** Contract type classification */
  type: ContractType;

  /** Source location of the canonical definition */
  source: SourceLocation;

  /** The actual schema definition */
  schema: JSONSchema | TypeDefinition | ProtobufDefinition;

  /** Language of the source definition */
  language: string;

  /** Name of the schema/type */
  name: string;

  /** Version of the contract (if versioned) */
  version?: string;

  /** Known consumers of this contract */
  consumers: Consumer[];

  /** Contract constraints */
  constraints: ContractConstraint[];

  /** Detection confidence */
  confidence: ConfidenceValue;
}

interface SourceLocation {
  /** File path */
  filePath: string;

  /** Start line */
  startLine: number;

  /** End line */
  endLine: number;

  /** Repository (for cross-repo contracts) */
  repository?: string;

  /** Git commit hash */
  commitHash?: string;
}

interface Consumer {
  /** Consumer identifier */
  id: string;

  /** Language of the consumer */
  language: string;

  /** Consumer location */
  location: SourceLocation;

  /** How this consumer was detected */
  detectionMethod: 'import' | 'generation' | 'manual' | 'inference';

  /** Consumer confidence */
  confidence: ConfidenceValue;
}

interface ContractConstraint {
  /** Constraint type */
  type: 'required_field' | 'type_bound' | 'nullability' | 'enum_values' | 'pattern' | 'range';

  /** Field or property this applies to */
  target: string;

  /** Constraint value */
  value: unknown;

  /** Human-readable description */
  description: string;
}
```

### Implementation Tracking

```typescript
/**
 * An implementation of a contract in a specific language.
 */
interface Implementation {
  /** Implementation identifier */
  id: string;

  /** The contract this implements */
  contractId: ContractId;

  /** Implementation location */
  location: SourceLocation;

  /** Language of implementation */
  language: string;

  /** Name in this language */
  localName: string;

  /** How implementation was created */
  origin: ImplementationOrigin;

  /** Fields/properties in this implementation */
  fields: ImplementationField[];

  /** Implementation confidence */
  confidence: ConfidenceValue;
}

type ImplementationOrigin =
  | { type: 'generated'; tool: string; sourceFile: string; generatedAt?: Date }
  | { type: 'manual'; author?: string; reason?: string }
  | { type: 'inferred'; inferenceMethod: string };

interface ImplementationField {
  /** Field name */
  name: string;

  /** Type in this language */
  type: string;

  /** Whether field is optional */
  optional: boolean;

  /** Whether field is nullable */
  nullable: boolean;

  /** Default value if any */
  defaultValue?: unknown;
}
```

---

## 4. Cross-Language Detection

### Detection Strategies

```typescript
/**
 * Strategies for detecting contracts across language boundaries.
 *
 * INSIGHT: Different contract types require different detection approaches.
 * Some are explicit (imports), some are implicit (structural matching).
 */
interface CrossLanguageDetector {
  /**
   * Detect Pydantic model to TypeScript type correspondences.
   */
  detectPydanticToTypeScript(
    pythonEntities: Entity[],
    tsEntities: Entity[]
  ): Promise<ContractCorrespondence[]>;

  /**
   * Detect Zod schema to Python type correspondences.
   */
  detectZodToPython(
    tsEntities: Entity[],
    pythonEntities: Entity[]
  ): Promise<ContractCorrespondence[]>;

  /**
   * Detect OpenAPI spec to generated client correspondences.
   */
  detectOpenAPIToClients(
    openapiSpec: Entity,
    clientEntities: Entity[]
  ): Promise<ContractCorrespondence[]>;

  /**
   * Detect Protobuf to language binding correspondences.
   */
  detectProtobufToBindings(
    protoEntities: Entity[],
    bindingEntities: Entity[]
  ): Promise<ContractCorrespondence[]>;

  /**
   * Generic structural matching for unknown contract types.
   */
  detectByStructure(
    sourceEntities: Entity[],
    targetEntities: Entity[],
    similarityThreshold: number
  ): Promise<ContractCorrespondence[]>;
}

interface ContractCorrespondence {
  /** Source contract entity */
  source: Entity;

  /** Target implementation entity */
  target: Entity;

  /** Type of correspondence */
  correspondenceType: CorrespondenceType;

  /** Structural similarity score */
  similarity: number;

  /** Field-level mapping */
  fieldMapping: FieldMapping[];

  /** Detection confidence */
  confidence: ConfidenceValue;
}

type CorrespondenceType =
  | 'exact_match'        // Names and structures match exactly
  | 'structural_match'   // Structures match, names may differ
  | 'generated_from'     // Target was generated from source
  | 'implements'         // Target explicitly implements source
  | 'inferred';          // Inferred from usage patterns

interface FieldMapping {
  sourceField: string;
  targetField: string;
  typeMapping: TypeMapping;
  compatibilityStatus: 'compatible' | 'lossy' | 'incompatible';
}

interface TypeMapping {
  sourceType: string;
  targetType: string;
  isEquivalent: boolean;
  notes?: string;
}
```

### Language-Specific Detection

```typescript
/**
 * Pydantic to TypeScript detection.
 *
 * PATTERN: Pydantic models often have TypeScript interfaces
 * with the same name and similar structure.
 */
interface PydanticTypeScriptDetector {
  /**
   * Detect by naming convention.
   * Example: UserModel (Python) <-> User (TypeScript)
   */
  detectByNaming(
    pydanticModels: PydanticModel[],
    tsInterfaces: TSInterface[]
  ): ContractCorrespondence[];

  /**
   * Detect by structural similarity.
   * Compare field names, types, optionality.
   */
  detectByStructure(
    pydanticModels: PydanticModel[],
    tsInterfaces: TSInterface[]
  ): ContractCorrespondence[];

  /**
   * Detect by generation markers.
   * Look for pydantic2ts or similar tool markers.
   */
  detectByGenerationMarkers(
    pydanticModels: PydanticModel[],
    tsFiles: SourceFile[]
  ): ContractCorrespondence[];
}

/**
 * Pydantic to TypeScript type mapping.
 */
const PYDANTIC_TS_TYPE_MAP: Map<string, string> = new Map([
  ['str', 'string'],
  ['int', 'number'],
  ['float', 'number'],
  ['bool', 'boolean'],
  ['datetime', 'Date | string'],
  ['date', 'string'],
  ['UUID', 'string'],
  ['List[T]', 'T[]'],
  ['Dict[K, V]', 'Record<K, V>'],
  ['Optional[T]', 'T | null'],
  ['Any', 'unknown'],
]);

/**
 * Zod to Python detection.
 */
interface ZodPythonDetector {
  /**
   * Detect Zod schemas that correspond to Python types.
   */
  detectZodSchemas(
    zodSchemas: ZodSchema[],
    pythonTypes: PythonType[]
  ): ContractCorrespondence[];
}

/**
 * Zod to Python type mapping.
 */
const ZOD_PYTHON_TYPE_MAP: Map<string, string> = new Map([
  ['z.string()', 'str'],
  ['z.number()', 'float'],
  ['z.number().int()', 'int'],
  ['z.boolean()', 'bool'],
  ['z.date()', 'datetime'],
  ['z.array(T)', 'List[T]'],
  ['z.record(K, V)', 'Dict[K, V]'],
  ['z.optional(T)', 'Optional[T]'],
  ['z.nullable(T)', 'Optional[T]'],
  ['z.unknown()', 'Any'],
]);
```

### OpenAPI and Protobuf Detection

```typescript
/**
 * OpenAPI to generated client detection.
 */
interface OpenAPIClientDetector {
  /**
   * Detect generated TypeScript clients.
   */
  detectTypeScriptClients(
    openapiSpec: OpenAPISpec,
    tsFiles: SourceFile[]
  ): ContractCorrespondence[];

  /**
   * Detect generated Python clients.
   */
  detectPythonClients(
    openapiSpec: OpenAPISpec,
    pythonFiles: SourceFile[]
  ): ContractCorrespondence[];

  /**
   * Detect by generation tool markers.
   */
  detectByGeneratorComments(
    files: SourceFile[],
    generatorPatterns: string[]
  ): GeneratedClientInfo[];
}

interface GeneratedClientInfo {
  file: SourceFile;
  generator: string;
  sourceSpec: string;
  generatedAt?: Date;
  version?: string;
}

/**
 * Protobuf to language binding detection.
 */
interface ProtobufBindingDetector {
  /**
   * Detect generated Go bindings.
   */
  detectGoBindings(
    protoFiles: ProtoFile[],
    goFiles: SourceFile[]
  ): ContractCorrespondence[];

  /**
   * Detect generated TypeScript bindings.
   */
  detectTypeScriptBindings(
    protoFiles: ProtoFile[],
    tsFiles: SourceFile[]
  ): ContractCorrespondence[];

  /**
   * Detect generated Python bindings.
   */
  detectPythonBindings(
    protoFiles: ProtoFile[],
    pythonFiles: SourceFile[]
  ): ContractCorrespondence[];
}
```

---

## 5. Contract Violation Checking

### Violation Types

```typescript
/**
 * Types of contract violations that can occur across language boundaries.
 */
type ViolationType =
  | 'missing_field'         // Required field not present in implementation
  | 'extra_field'           // Field present in implementation but not in contract
  | 'type_mismatch'         // Type incompatibility between contract and implementation
  | 'nullability_mismatch'  // Null handling differs (source allows null, target doesn't)
  | 'constraint_violation'  // Constraint not honored (e.g., enum value missing)
  | 'optionality_mismatch'  // Optional in source, required in target (or vice versa)
  | 'name_mismatch'         // Field name differs (potential mapping issue)
  | 'version_drift';        // Implementation is out of sync with contract version

/**
 * A contract violation detected during analysis.
 */
interface ContractViolation {
  /** The contract being violated */
  contract: ContractId;

  /** The implementation with the violation */
  implementation: SourceLocation;

  /** Type of violation */
  violation: ViolationType;

  /** Severity of the violation */
  severity: 'error' | 'warning' | 'info';

  /** Detailed description of the violation */
  details: string;

  /** Specific field or property involved */
  field?: string;

  /** Expected value/type from contract */
  expected?: string;

  /** Actual value/type in implementation */
  actual?: string;

  /** Suggested fix */
  suggestion: string;

  /** Violation detection confidence */
  confidence: ConfidenceValue;
}
```

### Violation Checker

```typescript
/**
 * Contract violation checker.
 *
 * PRINCIPLE: Every violation must be actionable - include specific
 * location, expected vs actual, and suggestion for fix.
 */
interface ContractViolationChecker {
  /**
   * Check all implementations against their contracts.
   */
  checkAllContracts(
    registry: SchemaContractRegistry
  ): Promise<ContractViolation[]>;

  /**
   * Check a specific implementation against its contract.
   */
  checkImplementation(
    contract: SchemaContract,
    implementation: Implementation
  ): Promise<ContractViolation[]>;

  /**
   * Check for field-level violations.
   */
  checkFieldViolations(
    contractFields: ContractField[],
    implementationFields: ImplementationField[],
    typeMapping: Map<string, string>
  ): FieldViolation[];

  /**
   * Check for constraint violations.
   */
  checkConstraintViolations(
    constraints: ContractConstraint[],
    implementation: Implementation
  ): ConstraintViolation[];
}

interface ContractField {
  name: string;
  type: string;
  required: boolean;
  nullable: boolean;
  constraints?: ContractConstraint[];
}

interface FieldViolation {
  field: string;
  violation: ViolationType;
  contractSpec: string;
  implementationSpec: string;
  severity: 'error' | 'warning' | 'info';
}

interface ConstraintViolation {
  constraint: ContractConstraint;
  violation: string;
  severity: 'error' | 'warning' | 'info';
}
```

### Violation Severity Rules

```typescript
/**
 * Rules for determining violation severity.
 *
 * INSIGHT: Severity depends on direction - missing required field
 * in consumer is worse than extra field.
 */
const VIOLATION_SEVERITY_RULES: Map<ViolationType, SeverityRule> = new Map([
  ['missing_field', {
    base: 'error',
    conditions: [
      { condition: 'field is optional in contract', severity: 'warning' },
      { condition: 'field has default value', severity: 'warning' },
    ],
  }],
  ['extra_field', {
    base: 'info',
    conditions: [
      { condition: 'strict mode enabled', severity: 'warning' },
    ],
  }],
  ['type_mismatch', {
    base: 'error',
    conditions: [
      { condition: 'types are coercible', severity: 'warning' },
    ],
  }],
  ['nullability_mismatch', {
    base: 'warning',
    conditions: [
      { condition: 'source allows null, target rejects', severity: 'error' },
    ],
  }],
  ['constraint_violation', {
    base: 'error',
    conditions: [],
  }],
  ['optionality_mismatch', {
    base: 'warning',
    conditions: [
      { condition: 'required in source, optional in target', severity: 'info' },
      { condition: 'optional in source, required in target', severity: 'error' },
    ],
  }],
  ['name_mismatch', {
    base: 'info',
    conditions: [
      { condition: 'no explicit mapping', severity: 'warning' },
    ],
  }],
  ['version_drift', {
    base: 'warning',
    conditions: [
      { condition: 'major version difference', severity: 'error' },
    ],
  }],
]);

interface SeverityRule {
  base: 'error' | 'warning' | 'info';
  conditions: Array<{
    condition: string;
    severity: 'error' | 'warning' | 'info';
  }>;
}
```

---

## 6. Polyglot Primitives

### tp_contract_detect

```typescript
/**
 * Detect contracts in a codebase.
 *
 * Scans for schema definitions, type contracts, protocol definitions,
 * and API specifications across all supported languages.
 */
export const tp_contract_detect: TechniquePrimitive = {
  id: 'tp_contract_detect',
  name: 'Contract Detection',
  description: 'Detect schema contracts, type definitions, and API specifications across languages',
  inputs: [
    { name: 'entities', type: 'Entity[]', description: 'All code entities to scan' },
    { name: 'contractTypes', type: 'ContractType[]', optional: true, description: 'Filter by contract type' },
    { name: 'languages', type: 'string[]', optional: true, description: 'Filter by language' },
  ],
  outputs: [
    { name: 'contracts', type: 'SchemaContract[]', description: 'Detected contracts' },
    { name: 'statistics', type: 'DetectionStatistics', description: 'Detection statistics' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 2,  // Requires structural analysis
};

interface DetectionStatistics {
  totalEntitiesScanned: number;
  contractsDetected: number;
  byType: Map<ContractType, number>;
  byLanguage: Map<string, number>;
  detectionDurationMs: number;
}
```

### tp_contract_match

```typescript
/**
 * Match contracts across language boundaries.
 *
 * Finds correspondences between contracts defined in one language
 * and their implementations in other languages.
 */
export const tp_contract_match: TechniquePrimitive = {
  id: 'tp_contract_match',
  name: 'Cross-Language Contract Matching',
  description: 'Match contracts defined in one language with implementations in other languages',
  inputs: [
    { name: 'sourceContracts', type: 'SchemaContract[]', description: 'Source contracts to match' },
    { name: 'targetEntities', type: 'Entity[]', description: 'Potential implementation entities' },
    { name: 'matchingStrategy', type: 'MatchingStrategy', optional: true, description: 'Matching approach' },
    { name: 'similarityThreshold', type: 'number', optional: true, description: 'Min similarity for structural matching' },
  ],
  outputs: [
    { name: 'correspondences', type: 'ContractCorrespondence[]', description: 'Matched contract pairs' },
    { name: 'unmatchedContracts', type: 'SchemaContract[]', description: 'Contracts without implementations' },
    { name: 'unmatchedEntities', type: 'Entity[]', description: 'Entities that might be missing contracts' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 3,  // Requires semantic understanding
};

type MatchingStrategy =
  | 'name_based'      // Match by name similarity
  | 'structural'      // Match by structural similarity
  | 'generation'      // Match by generation markers
  | 'hybrid';         // Combine all strategies
```

### tp_contract_validate

```typescript
/**
 * Validate implementations against their contracts.
 *
 * Checks for violations including missing fields, type mismatches,
 * nullability issues, and constraint violations.
 */
export const tp_contract_validate: TechniquePrimitive = {
  id: 'tp_contract_validate',
  name: 'Contract Validation',
  description: 'Validate that implementations correctly honor their contracts',
  inputs: [
    { name: 'registry', type: 'SchemaContractRegistry', description: 'Registry to validate' },
    { name: 'strictMode', type: 'boolean', optional: true, description: 'Enable strict checking' },
    { name: 'ignorePatterns', type: 'string[]', optional: true, description: 'Patterns to ignore' },
  ],
  outputs: [
    { name: 'violations', type: 'ContractViolation[]', description: 'All detected violations' },
    { name: 'summary', type: 'ValidationSummary', description: 'Validation summary' },
    { name: 'healthScore', type: 'number', description: 'Overall contract health (0-1)' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 2,  // Structural comparison
};

interface ValidationSummary {
  totalContracts: number;
  totalImplementations: number;
  violationsFound: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  validationDurationMs: number;
}
```

### tp_contract_drift_detect

```typescript
/**
 * Detect contract drift over time.
 *
 * Compares current state with historical states to detect
 * when contracts and implementations have diverged.
 */
export const tp_contract_drift_detect: TechniquePrimitive = {
  id: 'tp_contract_drift_detect',
  name: 'Contract Drift Detection',
  description: 'Detect when contracts and implementations have drifted apart over time',
  inputs: [
    { name: 'currentRegistry', type: 'SchemaContractRegistry', description: 'Current state' },
    { name: 'baselineRegistry', type: 'SchemaContractRegistry', optional: true, description: 'Baseline to compare' },
    { name: 'gitHistory', type: 'boolean', optional: true, description: 'Use git history for baseline' },
  ],
  outputs: [
    { name: 'drifts', type: 'ContractDrift[]', description: 'Detected drifts' },
    { name: 'timeline', type: 'DriftTimeline', description: 'When drifts occurred' },
    { name: 'riskAssessment', type: 'DriftRiskAssessment', description: 'Risk of current drift' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 3,  // Requires temporal analysis
};

interface ContractDrift {
  contractId: ContractId;
  driftType: 'source_changed' | 'implementation_changed' | 'both_changed' | 'new_mismatch';
  description: string;
  detectedAt: Date;
  severity: 'high' | 'medium' | 'low';
  affectedImplementations: SourceLocation[];
}

interface DriftTimeline {
  firstDrift: Date;
  lastDrift: Date;
  driftEvents: DriftEvent[];
}

interface DriftEvent {
  timestamp: Date;
  contractId: ContractId;
  change: string;
  commitHash?: string;
}

interface DriftRiskAssessment {
  overallRisk: 'high' | 'medium' | 'low';
  riskFactors: string[];
  recommendations: string[];
  confidence: ConfidenceValue;
}
```

### tp_contract_sync_suggest

```typescript
/**
 * Suggest contract synchronization actions.
 *
 * Given violations and drift, suggest specific changes to bring
 * contracts and implementations back into alignment.
 */
export const tp_contract_sync_suggest: TechniquePrimitive = {
  id: 'tp_contract_sync_suggest',
  name: 'Contract Sync Suggestions',
  description: 'Suggest changes to synchronize contracts with implementations',
  inputs: [
    { name: 'violations', type: 'ContractViolation[]', description: 'Current violations' },
    { name: 'registry', type: 'SchemaContractRegistry', description: 'Contract registry' },
    { name: 'syncDirection', type: 'SyncDirection', optional: true, description: 'Preferred sync direction' },
  ],
  outputs: [
    { name: 'suggestions', type: 'SyncSuggestion[]', description: 'Suggested changes' },
    { name: 'migrationPlan', type: 'MigrationPlan', description: 'Ordered migration steps' },
    { name: 'breakingChanges', type: 'BreakingChange[]', description: 'Breaking changes in suggestions' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },
  tier: 3,  // Requires semantic understanding
};

type SyncDirection =
  | 'contract_wins'       // Update implementations to match contract
  | 'implementation_wins' // Update contract to match implementation
  | 'suggest_both';       // Suggest changes in both directions

interface SyncSuggestion {
  target: SourceLocation;
  changeType: 'add_field' | 'remove_field' | 'change_type' | 'update_constraint';
  currentCode: string;
  suggestedCode: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  isBreaking: boolean;
}

interface MigrationPlan {
  phases: MigrationPhase[];
  totalEstimatedEffort: string;
  riskLevel: 'high' | 'medium' | 'low';
}

interface MigrationPhase {
  order: number;
  description: string;
  changes: SyncSuggestion[];
  dependencies: number[];  // Phase numbers that must complete first
}

interface BreakingChange {
  description: string;
  affectedConsumers: SourceLocation[];
  migrationPath: string;
}
```

---

## 7. Common Patterns

### Pattern 1: OpenAPI to TypeScript Client to Python Service

```typescript
/**
 * PATTERN: OpenAPI Spec -> TypeScript Client -> Python Service
 *
 * This is the most common polyglot pattern in web development.
 * The OpenAPI spec is the source of truth.
 *
 * Contract Flow:
 *   openapi.yaml (source)
 *     -> generated TypeScript client (openapi-typescript)
 *     -> Python FastAPI service (implicit implementation)
 *
 * Violation Risks:
 *   - TypeScript client out of date with spec
 *   - Python service not matching spec exactly
 *   - Nullability differences between languages
 */
const PATTERN_OPENAPI_TS_PYTHON: PolyglotPattern = {
  id: 'openapi_ts_python',
  name: 'OpenAPI to TypeScript/Python',
  description: 'OpenAPI spec as source, TS client and Python service as consumers',

  contractChain: [
    { role: 'source', language: 'openapi', filePattern: 'openapi.yaml' },
    { role: 'generated', language: 'typescript', generator: 'openapi-typescript' },
    { role: 'implementation', language: 'python', framework: 'fastapi' },
  ],

  commonViolations: [
    'TypeScript client has stale types after spec update',
    'Python endpoint signature differs from spec',
    'Enum values missing in one language',
    'Optional fields treated as required',
  ],

  recommendedChecks: [
    'Compare spec schemas with generated TS types',
    'Verify FastAPI route signatures match spec',
    'Check enum consistency across all three',
    'Validate nullability handling',
  ],
};
```

### Pattern 2: Protobuf to Go Server to TypeScript Client

```typescript
/**
 * PATTERN: Protobuf -> Go Server -> TypeScript Client
 *
 * Common in gRPC microservices with web frontends.
 * Protobuf definitions are the source of truth.
 *
 * Contract Flow:
 *   *.proto (source)
 *     -> Go server stubs (protoc-gen-go)
 *     -> TypeScript client (protobuf-ts or grpc-web)
 *
 * Violation Risks:
 *   - Field number changes breaking wire format
 *   - Optional vs required semantics differ by language
 *   - Enum handling differs (Go uses int, TS uses string)
 */
const PATTERN_PROTO_GO_TS: PolyglotPattern = {
  id: 'proto_go_ts',
  name: 'Protobuf to Go/TypeScript',
  description: 'Protobuf definitions with Go server and TypeScript client',

  contractChain: [
    { role: 'source', language: 'protobuf', filePattern: '*.proto' },
    { role: 'generated', language: 'go', generator: 'protoc-gen-go' },
    { role: 'generated', language: 'typescript', generator: 'protobuf-ts' },
  ],

  commonViolations: [
    'Field number reuse after deletion',
    'Required field added without default',
    'Enum value ordering mismatch',
    'Nested message structural drift',
  ],

  recommendedChecks: [
    'Verify proto file backward compatibility',
    'Compare generated Go structs with proto',
    'Compare generated TS interfaces with proto',
    'Check enum value consistency',
  ],
};
```

### Pattern 3: JSON Schema to Multiple Language Validators

```typescript
/**
 * PATTERN: JSON Schema -> Multiple Language Validators
 *
 * JSON Schema as universal contract with validators in each language.
 *
 * Contract Flow:
 *   *.schema.json (source)
 *     -> TypeScript (zod, ajv)
 *     -> Python (pydantic, jsonschema)
 *     -> Go (gojsonschema)
 *
 * Violation Risks:
 *   - Different schema versions supported per language
 *   - Custom format validators differ
 *   - Ref resolution differences
 */
const PATTERN_JSON_SCHEMA_MULTI: PolyglotPattern = {
  id: 'json_schema_multi',
  name: 'JSON Schema Multi-Language',
  description: 'JSON Schema validated across multiple languages',

  contractChain: [
    { role: 'source', language: 'json_schema', filePattern: '*.schema.json' },
    { role: 'validator', language: 'typescript', library: 'ajv' },
    { role: 'validator', language: 'python', library: 'jsonschema' },
    { role: 'validator', language: 'go', library: 'gojsonschema' },
  ],

  commonViolations: [
    'Schema version not supported by validator',
    'Custom format not implemented',
    '$ref resolution differs',
    'additionalProperties handling varies',
  ],

  recommendedChecks: [
    'Verify schema version compatibility',
    'Test custom formats in all languages',
    'Validate ref resolution consistency',
    'Check additionalProperties behavior',
  ],
};
```

### Pattern 4: GraphQL Schema to Resolvers and Clients

```typescript
/**
 * PATTERN: GraphQL Schema -> Resolvers -> Clients
 *
 * GraphQL schema as contract with typed resolvers and clients.
 *
 * Contract Flow:
 *   schema.graphql (source)
 *     -> TypeScript resolvers (type-graphql, nexus)
 *     -> Generated clients (graphql-codegen)
 *
 * Violation Risks:
 *   - Resolver return type differs from schema
 *   - Client types out of date
 *   - Nullable field handling inconsistent
 */
const PATTERN_GRAPHQL: PolyglotPattern = {
  id: 'graphql_schema',
  name: 'GraphQL Schema Ecosystem',
  description: 'GraphQL schema with typed resolvers and generated clients',

  contractChain: [
    { role: 'source', language: 'graphql', filePattern: 'schema.graphql' },
    { role: 'implementation', language: 'typescript', framework: 'type-graphql' },
    { role: 'generated', language: 'typescript', generator: 'graphql-codegen' },
  ],

  commonViolations: [
    'Resolver returns wrong type',
    'Generated types stale after schema change',
    'Nullable mismatch between schema and resolver',
    'Custom scalar handling differs',
  ],

  recommendedChecks: [
    'Verify resolver types match schema',
    'Compare generated client types with schema',
    'Check nullable field handling',
    'Validate custom scalar implementations',
  ],
};
```

---

## 8. Integration Points

### Integration with Track E: Domain Primitives

```typescript
/**
 * Track D polyglot contracts integrate with Track E domain primitives
 * for comprehensive API and schema understanding.
 *
 * INTEGRATION: tp_contract_* primitives compose with domain primitives
 * to provide full polyglot domain analysis.
 */

// Example composition: API Design Review with Cross-Language Contracts
const tc_polyglot_api_review: TechniqueComposition = {
  id: 'tc_polyglot_api_review',
  name: 'Polyglot API Design Review',
  description: 'Review API design across all language implementations',
  primitives: [
    'tp_contract_detect',      // From Track D
    'tp_contract_match',       // From Track D
    'tp_contract_validate',    // From Track D
    'tp_assumption_audit',     // From Track E (API design)
    'tp_change_impact',        // From Track E
  ],
  inputs: [
    { name: 'apiSpec', type: 'Entity', description: 'API specification (OpenAPI, GraphQL, etc.)' },
    { name: 'implementations', type: 'Entity[]', description: 'All implementation entities' },
  ],
  outputs: [
    { name: 'violations', type: 'ContractViolation[]' },
    { name: 'assumptions', type: 'Assumption[]' },
    { name: 'impactReport', type: 'ImpactReport' },
  ],
  operator: 'sequence',
  confidence: { type: 'absent', reason: 'uncalibrated' },
};
```

### Integration with Track I: Multi-Repo Contracts

```typescript
/**
 * Cross-language contracts often span multiple repositories.
 * Track D integrates with Track I for multi-repo contract tracing.
 *
 * INTEGRATION: SchemaContractRegistry can be federated across repos.
 */

interface FederatedContractRegistry extends SchemaContractRegistry {
  /** Contracts indexed by repository */
  contractsByRepo: Map<RepoId, SchemaContract[]>;

  /** Cross-repo contract dependencies */
  crossRepoContracts: CrossRepoContract[];

  /** Federation metadata */
  federationId: FederationId;
}

interface CrossRepoContract {
  /** Contract defined in source repo */
  sourceContract: { repoId: RepoId; contractId: ContractId };

  /** Implementations in other repos */
  implementations: Array<{ repoId: RepoId; implementation: Implementation }>;

  /** Cross-repo violations */
  violations: ContractViolation[];
}

// Composition for cross-repo contract validation
const tc_cross_repo_contract_validate: TechniqueComposition = {
  id: 'tc_cross_repo_contract_validate',
  name: 'Cross-Repository Contract Validation',
  description: 'Validate contracts across federated repositories',
  primitives: [
    'tp_cross_repo_search',    // From Track I
    'tp_contract_detect',      // From Track D
    'tp_contract_match',       // From Track D
    'tp_contract_validate',    // From Track D
    'tp_cross_repo_impact',    // From Track I
  ],
  inputs: [
    { name: 'federationId', type: 'FederationId' },
    { name: 'contractTypes', type: 'ContractType[]', optional: true },
  ],
  outputs: [
    { name: 'federatedRegistry', type: 'FederatedContractRegistry' },
    { name: 'violations', type: 'ContractViolation[]' },
    { name: 'crossRepoImpact', type: 'CrossRepoImpactReport' },
  ],
  operator: 'sequence',
  confidence: { type: 'absent', reason: 'uncalibrated' },
};
```

### Integration with Track A: Core Pipeline

```typescript
/**
 * Contract-aware analysis in the core pipeline.
 *
 * INTEGRATION: Bootstrap and indexing can detect contracts automatically.
 */

interface ContractAwareBootstrap {
  /**
   * Detect contracts during bootstrap.
   */
  detectContractsDuringBootstrap(
    entities: Entity[]
  ): Promise<SchemaContract[]>;

  /**
   * Add contract metadata to knowledge base.
   */
  enrichWithContractMetadata(
    knowledgeBase: KnowledgeBase,
    contracts: SchemaContract[]
  ): Promise<KnowledgeBase>;

  /**
   * Validate contracts as part of CI.
   */
  contractValidationGate(
    registry: SchemaContractRegistry,
    strictMode: boolean
  ): Promise<GateResult>;
}

interface GateResult {
  passed: boolean;
  violations: ContractViolation[];
  summary: string;
  confidence: ConfidenceValue;
}
```

---

## 9. Implementation Roadmap

### Phase 1: Core Types and Registry (~200 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/polyglot_contracts.ts (types)
// - src/LiBrainian/storage/contract_registry_storage.ts (persistence)

// Deliverables:
// - All type definitions from this spec
// - SchemaContractRegistry implementation
// - Contract storage adapter
// - Basic serialization/deserialization
```

**Estimated effort**: 2 days

### Phase 2: Contract Detection (~200 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/contract_detection.ts

// Deliverables:
// - tp_contract_detect implementation
// - Language-specific detectors (Pydantic, Zod, OpenAPI, Protobuf)
// - AST-based detection utilities
// - Generation marker detection
```

**Estimated effort**: 3 days

### Phase 3: Cross-Language Matching (~250 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/contract_matching.ts

// Deliverables:
// - tp_contract_match implementation
// - Structural similarity algorithms
// - Type mapping utilities
// - Field correspondence detection
```

**Estimated effort**: 3 days

### Phase 4: Violation Checking (~200 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/contract_validation.ts

// Deliverables:
// - tp_contract_validate implementation
// - Violation detection for all types
// - Severity classification
// - Suggestion generation
```

**Estimated effort**: 2 days

### Phase 5: Drift Detection and Sync (~150 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/contract_drift.ts
// - src/LiBrainian/api/contract_sync.ts

// Deliverables:
// - tp_contract_drift_detect implementation
// - tp_contract_sync_suggest implementation
// - Git history analysis
// - Migration plan generation
```

**Estimated effort**: 2 days

### Phase 6: Integration and Testing (~200 LOC)

```typescript
// Files to create:
// - src/LiBrainian/api/__tests__/polyglot_contracts.test.ts

// Deliverables:
// - Track E integration (domain primitives)
// - Track I integration (multi-repo)
// - Track A integration (core pipeline)
// - Comprehensive tests
// - Documentation
```

**Estimated effort**: 3 days

### Total Estimate

| Phase | LOC | Days |
|-------|-----|------|
| Core Types | 200 | 2 |
| Contract Detection | 200 | 3 |
| Cross-Language Matching | 250 | 3 |
| Violation Checking | 200 | 2 |
| Drift and Sync | 150 | 2 |
| Integration & Testing | 200 | 3 |
| **Total** | **~1,200** | **~15** |

---

## 10. Acceptance Criteria

### Contract Detection

- [ ] Pydantic models detected from Python files
- [ ] Zod schemas detected from TypeScript files
- [ ] OpenAPI specs detected and parsed
- [ ] Protobuf definitions detected and parsed
- [ ] GraphQL schemas detected and parsed
- [ ] JSON Schema files detected and parsed

### Cross-Language Matching

- [ ] Pydantic to TypeScript correspondences detected
- [ ] Zod to Python correspondences detected
- [ ] OpenAPI to generated client correspondences detected
- [ ] Protobuf to language binding correspondences detected
- [ ] Structural similarity matching works for unknown types

### Violation Checking

- [ ] Missing field violations detected
- [ ] Type mismatch violations detected
- [ ] Nullability mismatch violations detected
- [ ] Constraint violations detected
- [ ] Severity correctly classified
- [ ] Actionable suggestions generated

### Drift Detection

- [ ] Source changes detected
- [ ] Implementation changes detected
- [ ] Timeline of drift events generated
- [ ] Risk assessment provided

### Sync Suggestions

- [ ] Contract-wins suggestions generated
- [ ] Implementation-wins suggestions generated
- [ ] Migration plan generated
- [ ] Breaking changes identified

### Confidence

- [ ] All confidence values use `ConfidenceValue` type
- [ ] Operations use `absent` confidence until calibrated
- [ ] No raw numeric confidence values

---

## 11. Evidence Commands

```bash
# Run polyglot contract tests
cd packages/LiBrainian && npx vitest run src/api/__tests__/polyglot_contracts.test.ts

# Verify exports
node -e "import('LiBrainian').then(m => console.log(Object.keys(m).filter(k => k.includes('Contract') || k.includes('Polyglot'))))"

# Detect contracts in a polyglot codebase (when implemented)
cd packages/LiBrainian && npx tsx src/cli/index.ts contracts detect /path/to/codebase

# Validate contracts
cd packages/LiBrainian && npx tsx src/cli/index.ts contracts validate /path/to/codebase

# Check for drift
cd packages/LiBrainian && npx tsx src/cli/index.ts contracts drift /path/to/codebase

# Check implementation status
ls -la packages/LiBrainian/src/api/polyglot_contracts.ts
ls -la packages/LiBrainian/src/api/contract_detection.ts
ls -la packages/LiBrainian/src/api/contract_validation.ts
```

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification for Part XVII.F: Cross-Language Contract Tracing |
