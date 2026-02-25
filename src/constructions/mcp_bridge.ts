import { getNumericValue } from '../epistemics/confidence.js';
import type { ConstructionError } from './base/construction_base.js';
import { isConstructionOutcome, type Construction, type ConstructionEvent, type ConstructionManifest, type ConstructionSchema, type Context } from './types.js';

export interface MCPToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError: boolean;
}

export interface MCPConstructionTool {
  name: string;
  description: string;
  inputSchema: ConstructionSchema;
  outputSchema: ConstructionSchema;
  annotations: {
    readOnlyHint: true;
    idempotentHint: true;
    openWorldHint: false;
  };
  execute(rawInput: unknown): Promise<MCPToolResult>;
  executeStream(rawInput: unknown): AsyncIterable<MCPToolResult>;
}

export interface ToMCPToolOptions {
  signal?: AbortSignal;
  sessionId?: string;
  tokenBudget?: number;
}

interface SchemaValidationResult {
  valid: boolean;
  issues: string[];
}

function makeSessionId(): string {
  return `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function renderResult(result: Record<string, unknown>, isError: boolean): MCPToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
    isError,
  };
}

function describeValueType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function checkPrimitiveType(expected: string, value: unknown): boolean {
  switch (expected) {
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return typeof value === expected;
  }
}

function validateSchemaNode(
  schema: ConstructionSchema,
  value: unknown,
  path: string,
  issues: string[],
): void {
  const unconstrainedObjectSchema = schema.type === 'object'
    && !schema.properties
    && (!schema.required || schema.required.length === 0)
    && schema.additionalProperties === true
    && !schema.items
    && !schema.enum
    && !schema.oneOf
    && !schema.anyOf
    && !schema.allOf;
  if (unconstrainedObjectSchema) {
    return;
  }

  if (schema.enum && schema.enum.length > 0) {
    const match = schema.enum.some((candidate) => Object.is(candidate, value));
    if (!match) {
      issues.push(`${path}: expected one of [${schema.enum.join(', ')}], got ${JSON.stringify(value)}`);
      return;
    }
  }

  if (schema.oneOf && schema.oneOf.length > 0) {
    const oneOfValid = schema.oneOf.some((candidate) => validateSchema(candidate, value).valid);
    if (!oneOfValid) {
      issues.push(`${path}: value does not match any oneOf schema`);
    }
    return;
  }

  if (schema.anyOf && schema.anyOf.length > 0) {
    const anyOfValid = schema.anyOf.some((candidate) => validateSchema(candidate, value).valid);
    if (!anyOfValid) {
      issues.push(`${path}: value does not match any anyOf schema`);
    }
  }

  if (schema.allOf && schema.allOf.length > 0) {
    for (const candidate of schema.allOf) {
      validateSchemaNode(candidate, value, path, issues);
    }
  }

  const inferredType = schema.type
    ?? ((schema.properties || schema.required) ? 'object' : undefined)
    ?? (schema.items ? 'array' : undefined);

  if (inferredType) {
    if (!checkPrimitiveType(inferredType, value)) {
      issues.push(`${path}: expected ${inferredType}, got ${describeValueType(value)}`);
      return;
    }
  }

  if ((schema.type === 'object' || (!schema.type && (schema.properties || schema.required)))
      && typeof value === 'object'
      && value !== null
      && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(record, required)) {
        issues.push(`${path}.${required}: required property is missing`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) {
        continue;
      }
      validateSchemaNode(childSchema, record[key], `${path}.${key}`, issues);
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(record)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
          issues.push(`${path}.${key}: additional property is not allowed`);
        }
      }
    }
  }

  if ((schema.type === 'array' || (!schema.type && schema.items)) && Array.isArray(value)) {
    if (Array.isArray(schema.items)) {
      for (let index = 0; index < value.length; index += 1) {
        const tupleSchema = schema.items[index];
        if (tupleSchema) {
          validateSchemaNode(tupleSchema, value[index], `${path}[${index}]`, issues);
        }
      }
      return;
    }
    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) {
        validateSchemaNode(schema.items, value[index], `${path}[${index}]`, issues);
      }
    }
  }
}

export function validateSchema(schema: ConstructionSchema, value: unknown): SchemaValidationResult {
  const issues: string[] = [];
  validateSchemaNode(schema, value, '$', issues);
  return {
    valid: issues.length === 0,
    issues,
  };
}

function extractConfidenceValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  const numeric = getNumericValue(value as any);
  return numeric ?? value;
}

function buildSuccessPayload(constructionId: string, output: unknown): Record<string, unknown> {
  const resultObject = (typeof output === 'object' && output !== null)
    ? output as Record<string, unknown>
    : undefined;

  return {
    constructionId,
    result: output,
    confidence: extractConfidenceValue(resultObject?.confidence),
    confidenceInterval: resultObject?.confidenceInterval,
    evidenceRefs: Array.isArray(resultObject?.evidenceRefs)
      ? (resultObject?.evidenceRefs as unknown[]).filter((item): item is string => typeof item === 'string')
      : [],
    analysisTimeMs: typeof resultObject?.analysisTimeMs === 'number' ? resultObject.analysisTimeMs : undefined,
    predictionId: typeof resultObject?.predictionId === 'string' ? resultObject.predictionId : undefined,
  };
}

function buildFailureSuggestions(error: ConstructionError): string[] {
  const suggestions: string[] = [];
  if (error.message.toLowerCase().includes('capability')) {
    suggestions.push('Run list_constructions to identify alternatives with fewer requiredCapabilities.');
    suggestions.push('Provide required dependencies (workspace, LiBrainian runtime) before retrying invoke_construction.');
  } else {
    suggestions.push('Check input fields against list_constructions output inputSchema and retry.');
    suggestions.push('Use describe_construction for expected input/output details before invoking again.');
  }
  return suggestions;
}

async function* defaultConstructionEventStream<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  input: I,
  context: Context<R>,
): AsyncIterable<ConstructionEvent<O, E>> {
  const execution = await construction.execute(input, context);
  if (!isConstructionOutcome<O, E>(execution)) {
    yield { kind: 'completed', result: execution as O };
    return;
  }
  if (execution.ok) {
    yield { kind: 'completed', result: execution.value };
    return;
  }
  yield {
    kind: 'failed',
    error: execution.error,
    partial: execution.partial,
  };
}

export function toMCPTool<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  manifest: ConstructionManifest,
  deps: R,
  options: ToMCPToolOptions = {},
): MCPConstructionTool {
  return {
    name: manifest.id,
    description: manifest.agentDescription,
    inputSchema: manifest.inputSchema,
    outputSchema: manifest.outputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async *executeStream(rawInput: unknown): AsyncIterable<MCPToolResult> {
      const validation = validateSchema(manifest.inputSchema, rawInput);
      if (!validation.valid) {
        yield renderResult(
          {
            error: 'INPUT_VALIDATION_FAILED',
            message: `Invalid input for Construction ${manifest.id}`,
            constructionId: manifest.id,
            validationFailures: validation.issues,
            schemaRef: `construction:${manifest.id}:input`,
            inputSchema: manifest.inputSchema,
          },
          true,
        );
        return;
      }

      const context: Context<R> = {
        deps,
        signal: options.signal ?? new AbortController().signal,
        sessionId: options.sessionId ?? makeSessionId(),
        tokenBudget: options.tokenBudget,
      };
      const stream = construction.stream
        ? construction.stream(rawInput as I, context)
        : defaultConstructionEventStream(construction, rawInput as I, context);

      try {
        for await (const event of stream) {
          if (event.kind === 'completed') {
            yield renderResult(buildSuccessPayload(manifest.id, event.result), false);
            return;
          }
          if (event.kind === 'failed') {
            yield renderResult(
              {
                error: 'CONSTRUCTION_FAILED',
                message: event.error.message,
                constructionId: manifest.id,
                errorType: event.error.name,
                suggestions: buildFailureSuggestions(event.error),
                partial: event.partial,
              },
              true,
            );
            return;
          }

          yield renderResult(
            {
              constructionId: manifest.id,
              event,
            },
            false,
          );
        }

        yield renderResult(
          {
            error: 'CONSTRUCTION_FAILED',
            message: `Construction ${manifest.id} stream ended without terminal event`,
            constructionId: manifest.id,
          },
          true,
        );
      } catch (error) {
        yield renderResult(
          {
            error: 'CONSTRUCTION_FAILED',
            message: error instanceof Error ? error.message : `Construction execution failed: ${String(error)}`,
            constructionId: manifest.id,
            suggestions: [
              'Retry invoke_construction once to rule out transient failures.',
              'Use describe_construction and verify required capabilities before retrying.',
            ],
          },
          true,
        );
      }
    },
    async execute(rawInput: unknown): Promise<MCPToolResult> {
      const validation = validateSchema(manifest.inputSchema, rawInput);
      if (!validation.valid) {
        return renderResult(
          {
            error: 'INPUT_VALIDATION_FAILED',
            message: `Invalid input for Construction ${manifest.id}`,
            constructionId: manifest.id,
            validationFailures: validation.issues,
            schemaRef: `construction:${manifest.id}:input`,
            inputSchema: manifest.inputSchema,
          },
          true,
        );
      }

      const context: Context<R> = {
        deps,
        signal: options.signal ?? new AbortController().signal,
        sessionId: options.sessionId ?? makeSessionId(),
        tokenBudget: options.tokenBudget,
      };

      try {
        const execution = await construction.execute(rawInput as I, context);
        if (!isConstructionOutcome<O, E>(execution)) {
          return renderResult(buildSuccessPayload(manifest.id, execution), false);
        }

        if (!execution.ok) {
          return renderResult(
            {
              error: 'CONSTRUCTION_FAILED',
              message: execution.error.message,
              constructionId: manifest.id,
              errorType: execution.error.name,
              suggestions: buildFailureSuggestions(execution.error),
            },
            true,
          );
        }

        return renderResult(buildSuccessPayload(manifest.id, execution.value), false);
      } catch (error) {
        return renderResult(
          {
            error: 'CONSTRUCTION_FAILED',
            message: error instanceof Error ? error.message : `Construction execution failed: ${String(error)}`,
            constructionId: manifest.id,
            suggestions: [
              'Retry invoke_construction once to rule out transient failures.',
              'Use describe_construction and verify required capabilities before retrying.',
            ],
          },
          true,
        );
      }
    },
  };
}
