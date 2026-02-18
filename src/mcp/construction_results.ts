import { z } from 'zod';

export interface ConstructionMeta {
  constructionId: string;
  schemaName: string;
  workspace?: string;
  intent?: string;
  compositionId?: string;
}

export interface ConstructionResultEnvelope<T = unknown> {
  success: boolean;
  output: T;
  schema: string;
  evidence: string[];
  runId: string;
  tokensUsed: number;
  durationMs: number;
  trivialResult: boolean;
  meta: ConstructionMeta;
}

const TechniqueCompositionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  primitiveIds: z.array(z.string()),
}).passthrough();

const WorkTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
}).passthrough();

const TechniquePrimitiveSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  intent: z.string().optional(),
}).passthrough();

export const SelectTechniqueCompositionsOutputSchema = z.object({
  intent: z.string().min(1),
  compositions: z.array(TechniqueCompositionSchema),
  total: z.number().int().min(0),
  limited: z.number().int().min(0).optional(),
}).strict();

export const CompileTechniqueCompositionOutputSchema = z.object({
  compositionId: z.string().min(1),
  template: WorkTemplateSchema,
  missingPrimitiveIds: z.array(z.string()),
  primitives: z.array(TechniquePrimitiveSchema).optional(),
}).strict();

const IntentBundleSchema = z.object({
  template: WorkTemplateSchema.nullable(),
  missingPrimitiveIds: z.array(z.string()),
  primitives: z.array(TechniquePrimitiveSchema).optional(),
}).passthrough();

export const CompileIntentBundlesOutputSchema = z.object({
  intent: z.string().min(1),
  bundles: z.array(IntentBundleSchema),
  total: z.number().int().min(0),
  limited: z.number().int().min(0).optional(),
}).strict();

export interface MCPToolOutputSchemaHint {
  type: 'object';
  description: string;
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, unknown>;
}

export const DefaultToolOutputSchemaHint: MCPToolOutputSchemaHint = {
  type: 'object',
  description: 'Legacy output contract (z.unknown() fallback).',
  additionalProperties: true,
};

export const ConstructionOutputSchemaHints = {
  select_technique_compositions: {
    type: 'object',
    description: 'Typed ConstructionResult output for composition selection.',
    additionalProperties: false,
    required: ['intent', 'compositions', 'total'],
    properties: {
      intent: { type: 'string' },
      compositions: { type: 'array' },
      total: { type: 'number' },
      limited: { type: 'number' },
    },
  },
  compile_technique_composition: {
    type: 'object',
    description: 'Typed ConstructionResult output for compiled composition template.',
    additionalProperties: false,
    required: ['compositionId', 'template', 'missingPrimitiveIds'],
    properties: {
      compositionId: { type: 'string' },
      template: { type: 'object' },
      missingPrimitiveIds: { type: 'array' },
      primitives: { type: 'array' },
    },
  },
  compile_intent_bundles: {
    type: 'object',
    description: 'Typed ConstructionResult output for compiled intent bundles.',
    additionalProperties: false,
    required: ['intent', 'bundles', 'total'],
    properties: {
      intent: { type: 'string' },
      bundles: { type: 'array' },
      total: { type: 'number' },
      limited: { type: 'number' },
    },
  },
} as const satisfies Record<string, MCPToolOutputSchemaHint>;

export function validateConstructionOutput<T>(
  schema: z.ZodType<T>,
  output: unknown,
): { valid: true; data: T } | { valid: false; message: string; issues: string[] } {
  const parsed = schema.safeParse(output);
  if (parsed.success) {
    return { valid: true, data: parsed.data };
  }
  const issues = parsed.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `${path}: ${issue.message}`;
  });
  return {
    valid: false,
    message: 'Construction output schema validation failed',
    issues,
  };
}

