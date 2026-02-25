import { z } from 'zod';
import type { Librarian } from '../api/librarian.js';
import { generatePredictionId } from './calibration_tracker.js';
import {
  ConstructionCapabilityError,
  ConstructionError,
  ConstructionInputError,
} from './base/construction_base.js';
import {
  CONSTRUCTION_REGISTRY,
} from './registry.js';
import {
  seq,
  fanout,
  fallback,
  dimap,
  map,
  contramap,
  mapError,
} from './operators.js';
import type {
  CapabilityId,
  Construction,
  ConstructionEvent,
  ConstructionId,
  ConstructionManifest,
  ConstructionOutcome,
  ConstructionSchema,
  Context,
  LibrarianContext,
} from './types.js';
import { fail, ok } from './types.js';
import type { ConstructionError as ConstructionErrorType } from './base/construction_base.js';
import type { StorageCapabilities } from '../storage/types.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';

export interface ConstructionSpec<
  I,
  O,
  E extends ConstructionErrorType = ConstructionErrorType,
  R = LibrarianContext,
> {
  id: ConstructionId;
  name: string;
  description?: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  requiredCapabilities?: CapabilityId[];
  execute: (input: I, context: Context<R>) => Promise<ConstructionOutcome<O, E>>;
  stream?: (input: I, context: Context<R>) => AsyncIterable<ConstructionEvent<O, E>>;
  tags?: string[];
  agentDescription?: string;
}

export type FactoryConstruction<
  I,
  O,
  E extends ConstructionErrorType = ConstructionErrorType,
  R = LibrarianContext,
> = Construction<I, O, E, R> & {
  then: <O2, E2 extends ConstructionErrorType = ConstructionErrorType>(
    next: Construction<O, O2, E2, R>,
  ) => Construction<I, O2, E | E2, R>;
  fanout: <O2>(
    other: Construction<I, O2, E, R>,
  ) => Construction<I, [O, O2], E, R>;
  fallback: (
    backup: Construction<I, O, E, R>,
  ) => Construction<I, O, E, R>;
  dimap: <I2, O2>(
    pre: (input: I2) => I,
    post: (output: O) => O2,
  ) => Construction<I2, O2, E, R>;
  map: <O2>(fn: (output: O) => O2) => Construction<I, O2, E, R>;
  contramap: <I2>(fn: (input: I2) => I) => Construction<I2, O, E, R>;
  mapError: <E2 extends ConstructionErrorType>(
    fn: (error: E) => E2,
  ) => Construction<I, O, E2, R>;
};

type MutableOutput = {
  confidence?: ConfidenceValue;
  analysisTimeMs?: number;
  predictionId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMutableOutput(value: unknown): value is MutableOutput & Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (!('confidence' in value)) return false;
  return true;
}

function hasCapability(
  librarian: Librarian | undefined,
  capability: string,
): boolean {
  if (capability === 'librarian') return librarian !== undefined;
  if (!librarian) return false;

  if (capability === 'query' || capability === 'symbol-search' || capability === 'debug-analysis') {
    return typeof (librarian as unknown as { queryOptional?: unknown }).queryOptional === 'function';
  }

  const getCapabilities =
    (librarian as unknown as { getStorageCapabilities?: () => StorageCapabilities }).getStorageCapabilities;
  if (typeof getCapabilities !== 'function') {
    return false;
  }

  const capabilities = getCapabilities();
  const normalized = capability.toLowerCase().replace(/[\s_]/g, '-');
  const optional = capabilities.optional;
  const optionalLookup: Record<string, boolean> = {
    embeddings: optional.embeddings,
    'embedding-search': optional.embeddings,
    'function-semantics': optional.embeddings,
    'quality-analysis': optional.embeddings || optional.graphMetrics,
    'security-analysis': optional.embeddings || optional.graphMetrics,
    'architecture-analysis': optional.graphMetrics,
    'impact-analysis': optional.graphMetrics,
    'call-graph': optional.graphMetrics,
    'graph-metrics': optional.graphMetrics,
  };
  if (normalized in optionalLookup) {
    return optionalLookup[normalized];
  }

  if (normalized in capabilities.core) {
    return true;
  }

  return false;
}

function convertZodToSchema(schema: z.ZodTypeAny): ConstructionSchema {
  if (schema instanceof z.ZodString) {
    return { type: 'string' };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: 'number' };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean' };
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: convertZodToSchema(schema.element),
    };
  }
  if (schema instanceof z.ZodLiteral) {
    const literalValue = schema.value;
    return {
      type: typeof literalValue as 'string' | 'number' | 'boolean',
      enum: [literalValue],
    };
  }
  if (schema instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: [...schema.options],
    };
  }
  if (schema instanceof z.ZodNativeEnum) {
    const values = Object.values(schema.enum).filter(
      (value): value is string | number => typeof value === 'string' || typeof value === 'number',
    );
    const numericValues = values.filter((value): value is number => typeof value === 'number');
    const hasNumericValues = numericValues.length > 0;
    return {
      type: hasNumericValues ? 'number' : 'string',
      enum: values,
    };
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, ConstructionSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convertZodToSchema(value);
      if (!value.isOptional()) {
        required.push(key);
      }
    }
    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    };
  }
  if (schema instanceof z.ZodUnion) {
    return { anyOf: schema.options.map((option: z.ZodTypeAny) => convertZodToSchema(option)) };
  }
  if (schema instanceof z.ZodNullable) {
    return {
      anyOf: [convertZodToSchema(schema.unwrap()), { type: 'null' }],
    };
  }
  if (schema instanceof z.ZodOptional) {
    return convertZodToSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    return convertZodToSchema(schema.removeDefault());
  }
  if (schema instanceof z.ZodRecord) {
    return {
      type: 'object',
      additionalProperties: true,
    };
  }
  return {
    type: 'object',
    additionalProperties: true,
  };
}

function registerConstructionManifest<
  I,
  O,
  E extends ConstructionErrorType,
  R,
>(
  spec: ConstructionSpec<I, O, E, R>,
  construction: Construction<I, O, E, R>,
): void {
  const manifest: ConstructionManifest = {
    id: spec.id,
    name: spec.name,
    scope: spec.id.startsWith('@')
      ? (spec.id.split('/')[0] as ConstructionManifest['scope'])
      : '@librainian',
    version: '0.0.0-runtime',
    description: spec.description ?? `${spec.name} runtime construction`,
    agentDescription: spec.agentDescription ?? spec.description ?? spec.name,
    inputSchema: convertZodToSchema(spec.inputSchema),
    outputSchema: convertZodToSchema(spec.outputSchema),
    requiredCapabilities: [...(spec.requiredCapabilities ?? [])],
    tags: [...(spec.tags ?? [])],
    trustTier: spec.id.startsWith('@librainian-community/') ? 'community' : 'official',
    examples: [
      {
        description: `Execute ${spec.name}`,
        input: {},
        expectedOutputSummary: `${spec.name} execution result`,
      },
    ],
    construction: construction as unknown as Construction<unknown, unknown, ConstructionErrorType, unknown>,
    available: true,
  };

  if (CONSTRUCTION_REGISTRY.has(spec.id)) {
    CONSTRUCTION_REGISTRY.replace(manifest);
    return;
  }
  CONSTRUCTION_REGISTRY.register(spec.id, manifest);
}

export function createConstruction<
  I,
  O,
  E extends ConstructionErrorType = ConstructionErrorType,
  R = LibrarianContext,
>(spec: ConstructionSpec<I, O, E, R>): FactoryConstruction<I, O, E, R> {
  const executeWrapped = async (
    input: I,
    context?: Context<R>,
  ): Promise<ConstructionOutcome<O, E>> => {
    const startedAtMs = Date.now();
    const parsed = spec.inputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const fieldPath = issue?.path?.map((segment) => String(segment)).join('.') || undefined;
      return fail<O, E>(
        new ConstructionInputError(
          `Input validation failed for ${spec.id}: ${issue?.message ?? parsed.error.message}`,
          fieldPath,
          spec.id,
        ) as E,
        undefined,
        spec.id,
      );
    }

    const librarian = (context?.deps as { librarian?: Librarian } | undefined)?.librarian;
    for (const capability of spec.requiredCapabilities ?? []) {
      if (!hasCapability(librarian, capability)) {
        return fail<O, E>(
          new ConstructionCapabilityError(capability, spec.id) as unknown as E,
          undefined,
          spec.id,
        );
      }
    }

    if (!context) {
      return fail<O, E>(
        new ConstructionError(
          `Construction ${spec.id} requires execution context with deps and signal`,
          spec.id,
        ) as E,
        undefined,
        spec.id,
      );
    }

    try {
      const outcome = await spec.execute(parsed.data, context);
      if (!outcome.ok) {
        return outcome;
      }

      if (isMutableOutput(outcome.value)) {
        if (typeof outcome.value.analysisTimeMs !== 'number') {
          outcome.value.analysisTimeMs = Date.now() - startedAtMs;
        }

        const tracker = (context.deps as { calibrationTracker?: unknown } | undefined)?.calibrationTracker;
        if (
          tracker
          && typeof (tracker as { recordPrediction?: unknown }).recordPrediction === 'function'
          && outcome.value.confidence !== undefined
        ) {
          const predictionId = generatePredictionId(spec.id);
          (
            tracker as {
              recordPrediction: (
                constructionId: string,
                predictionId: string,
                confidence: ConfidenceValue,
                claim: string,
                metadata?: Record<string, unknown>,
              ) => void;
            }
          ).recordPrediction(
            spec.id,
            predictionId,
            outcome.value.confidence,
            `${spec.name} execution`,
            { sessionId: context.sessionId },
          );
          outcome.value.predictionId = predictionId;
        }
      }

      return outcome;
    } catch (error) {
      const normalizedError = error instanceof ConstructionError
        ? error
        : new ConstructionError(
          error instanceof Error
            ? `Construction ${spec.id} failed: ${error.message}`
            : `Construction ${spec.id} failed: ${String(error)}`,
          spec.id,
          error instanceof Error ? error : undefined,
        );
      return fail<O, E>(normalizedError as E, undefined, spec.id);
    }
  };

  let construction: FactoryConstruction<I, O, E, R>;

  const streamWrapped = spec.stream ?? (async function* (
    input: I,
    context: Context<R>,
  ): AsyncIterable<ConstructionEvent<O, E>> {
    yield {
      kind: 'progress',
      step: 'executing',
      percentComplete: 0,
    };
    const outcome = await executeWrapped(input, context);
    if (outcome.ok) {
      yield {
        kind: 'completed',
        result: outcome.value,
      };
      return;
    }
    yield {
      kind: 'failed',
      error: outcome.error,
      partial: outcome.partial,
    };
  });

  construction = {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    execute: executeWrapped,
    stream: streamWrapped,
    then: <O2, E2 extends ConstructionErrorType = ConstructionErrorType>(
      next: Construction<O, O2, E2, R>,
    ): Construction<I, O2, E | E2, R> => seq(construction, next),
    fanout: <O2>(
      other: Construction<I, O2, E, R>,
    ): Construction<I, [O, O2], E, R> => fanout(construction, other),
    fallback: (
      backup: Construction<I, O, E, R>,
    ): Construction<I, O, E, R> => fallback(construction, backup),
    dimap: <I2, O2>(
      pre: (input: I2) => I,
      post: (output: O) => O2,
    ): Construction<I2, O2, E, R> => dimap(construction, pre, post),
    map: <O2>(
      fn: (output: O) => O2,
    ): Construction<I, O2, E, R> => map(construction, fn),
    contramap: <I2>(
      fn: (input: I2) => I,
    ): Construction<I2, O, E, R> => contramap(construction, fn),
    mapError: <E2 extends ConstructionErrorType>(
      fn: (error: E) => E2,
    ): Construction<I, O, E2, R> => mapError(construction, fn),
  };

  registerConstructionManifest(spec, construction);
  return construction;
}
