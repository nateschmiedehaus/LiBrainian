/**
 * @fileoverview Semantics Extractor
 *
 * Extracts semantic information (questions 16-45):
 * - Purpose: why this exists, what problem it solves
 * - Domain: business concepts, bounded context
 * - Intent: use cases, anti-patterns
 * - Mechanism: how it works, algorithm, patterns
 * - Complexity: time/space, cognitive
 *
 * LLM-ONLY: Per VISION architecture, semantic claims require LLM synthesis.
 * There is no heuristic fallback - extraction fails with unverified_by_trace
 * if LLM is unavailable.
 */

import type { EntitySemantics } from '../universal_types.js';
import { resolveLlmServiceAdapter } from '../../adapters/llm_service.js';
import { resolveLibrarianModelId } from '../../api/llm_env.js';
import { buildLlmEvidence, type LlmEvidence } from './llm_evidence.js';

export interface SemanticsExtraction {
  semantics: EntitySemantics;
  confidence: number;
  wisdom?: SemanticWisdom;
  llmEvidence?: LlmEvidence;
}

export interface SemanticWisdom {
  tribal: string[];
  gotchas: string[];
  tips: string[];
  learningPath: Array<{ order: number; description: string }>;
}

export interface SemanticsInput {
  name: string;
  signature?: string;
  content?: string;
  docstring?: string;
  existingPurpose?: string;
  filePath: string;
}

export interface LLMSemanticsConfig {
  llmProvider: 'claude' | 'codex';
  llmModelId?: string;
  /** Governor context for token tracking and budget enforcement */
  governor?: import('../../api/governor_context.js').GovernorContext;
}

/**
 * Extract semantic information using LLM (PRODUCTION).
 * Provides deep understanding of code purpose, domain, and mechanism.
 */
export async function extractSemanticsWithLLM(
  input: SemanticsInput,
  config: LLMSemanticsConfig
): Promise<SemanticsExtraction> {
  const llmService = resolveLlmServiceAdapter();

  const codeContext = buildCodeContext(input);
  const prompt = buildSemanticPrompt(input, codeContext);

  // Build messages with system prompt as first message
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: SEMANTIC_EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];

  const modelId = config.llmModelId
    || resolveLibrarianModelId(config.llmProvider)
    || 'claude-haiku-4-5-20241022';
  const llmEvidence = await buildLlmEvidence({
    provider: config.llmProvider,
    modelId,
    messages,
  });

  try {
    const response = await llmService.chat({
      provider: config.llmProvider,
      modelId,
      messages,
      maxTokens: 1500,
      governorContext: config.governor,
    });

    const parsed = parseSemanticResponse(response.content, input);
    return {
      semantics: parsed.semantics,
      confidence: parsed.confidence,
      wisdom: parsed.wisdom,
      llmEvidence,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const prefix = message.includes('unverified_by_trace')
      ? message
      : `unverified_by_trace(semantic_extraction_failed): ${message}`;
    throw new Error(prefix);
  }
}

const SEMANTIC_EXTRACTION_SYSTEM_PROMPT = `You are a code analysis expert. Analyze code entities to extract deep semantic understanding.

Return a JSON object with these fields:
{
  "purpose": {
    "summary": "One sentence (max 160 chars) explaining what this does",
    "explanation": "Detailed explanation (1-3 sentences)",
    "problemSolved": "What problem this addresses",
    "valueProp": "What breaks or is missing without this"
  },
  "domain": {
    "concepts": ["domain terms used"],
    "boundedContext": "DDD bounded context if applicable",
    "businessRules": ["encoded business logic"]
  },
  "intent": {
    "primaryUseCase": "Main usage scenario",
    "secondaryUseCases": ["other valid uses"],
    "antiUseCases": ["what NOT to use this for"]
  },
  "mechanism": {
    "explanation": "How it works in plain English",
    "algorithm": "Named algorithm if applicable",
    "approach": "Implementation approach",
    "patterns": ["design patterns used"]
  },
  "complexity": {
    "time": "Big-O time complexity",
    "space": "Big-O space complexity",
    "cognitive": "trivial|simple|moderate|complex|very_complex"
  },
  "wisdom": {
    "gotchas": ["things that trip up newcomers"],
    "tips": ["usage patterns that work well"],
    "learningPath": [{"order": 1, "description": "start here"}],
    "tribal": ["undocumented conventions or history"]
  }
}

Be precise and evidence-based. Only claim what the code demonstrates.`;

function buildCodeContext(input: SemanticsInput): string {
  const parts: string[] = [];

  if (input.signature) {
    parts.push(`Signature: ${input.signature}`);
  }
  if (input.docstring) {
    parts.push(`Documentation: ${input.docstring}`);
  }
  if (input.content) {
    // Limit content to avoid token limits
    const truncated = input.content.length > 2000
      ? input.content.slice(0, 2000) + '\n... (truncated)'
      : input.content;
    parts.push(`Code:\n${truncated}`);
  }

  return parts.join('\n\n');
}

function buildSemanticPrompt(input: SemanticsInput, context: string): string {
  return `Analyze this code entity and extract its semantic meaning:

Name: ${input.name}
File: ${input.filePath}

${context}

Provide a JSON response with purpose, domain, intent, mechanism, complexity, and optional wisdom.`;
}

function parseSemanticResponse(
  response: string,
  input: SemanticsInput
): SemanticsExtraction {
  try {
    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (
      !parsed?.purpose?.summary ||
      !parsed?.mechanism?.explanation ||
      !parsed?.intent?.primaryUseCase
    ) {
      throw new Error('missing required semantic fields');
    }

    const wisdom = parseSemanticWisdom(parsed?.wisdom);

    return {
      semantics: {
        purpose: {
          summary: parsed.purpose?.summary,
          explanation: parsed.purpose?.explanation || '',
          problemSolved: parsed.purpose?.problemSolved || '',
          valueProp: parsed.purpose?.valueProp || '',
        },
        domain: {
          concepts: parsed.domain?.concepts || [],
          boundedContext: parsed.domain?.boundedContext,
          businessRules: parsed.domain?.businessRules || [],
        },
        intent: {
          primaryUseCase: parsed.intent?.primaryUseCase || '',
          secondaryUseCases: parsed.intent?.secondaryUseCases || [],
          antiUseCases: parsed.intent?.antiUseCases || [],
        },
        mechanism: {
          explanation: parsed.mechanism?.explanation || '',
          algorithm: parsed.mechanism?.algorithm,
          approach: parsed.mechanism?.approach || '',
          approachRationale: '',
          patterns: parsed.mechanism?.patterns || [],
          dataStructures: [],
        },
        complexity: {
          time: parsed.complexity?.time || 'O(?)',
          space: parsed.complexity?.space || 'O(?)',
          cognitive: parsed.complexity?.cognitive || 'moderate',
        },
      },
      confidence: 0.85, // LLM extraction has high confidence
      wisdom,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`unverified_by_trace(provider_invalid_output): ${message}`);
  }
}

function parseSemanticWisdom(raw: unknown): SemanticWisdom {
  const wisdom = asRecord(raw);
  return {
    gotchas: normalizeStringArray(wisdom?.gotchas),
    tips: normalizeStringArray(wisdom?.tips),
    tribal: normalizeStringArray(wisdom?.tribal),
    learningPath: normalizeLearningPath(wisdom?.learningPath),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeStringArray(value: unknown, limit = 5): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return dedupeCaseInsensitive(normalized).slice(0, limit);
}

function normalizeLearningPath(value: unknown): Array<{ order: number; description: string }> {
  if (!Array.isArray(value)) return [];
  const parsed = value
    .map((entry, index) => {
      const record = asRecord(entry);
      if (!record) return null;
      const description = typeof record.description === 'string'
        ? record.description.trim()
        : '';
      if (description.length === 0) return null;
      const maybeOrder = typeof record.order === 'number' && Number.isFinite(record.order)
        ? Math.trunc(record.order)
        : index + 1;
      return {
        order: maybeOrder > 0 ? maybeOrder : index + 1,
        description,
      };
    })
    .filter((entry): entry is { order: number; description: string } => entry !== null);
  const deduped = dedupeByKey(parsed, (entry) => entry.description.toLowerCase());
  return deduped
    .sort((a, b) => a.order - b.order)
    .slice(0, 8)
    .map((entry, index) => ({ order: index + 1, description: entry.description }));
}

function dedupeCaseInsensitive(items: string[]): string[] {
  return dedupeByKey(items, (item) => item.toLowerCase());
}

function dedupeByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * Extract semantic information from a code entity.
 *
 * @deprecated ALWAYS THROWS - Use extractSemanticsWithLLM() instead.
 * Per VISION architecture, semantic claims require LLM synthesis.
 * Heuristic extraction is forbidden - there is no fallback.
 */
export function extractSemantics(_input: SemanticsInput): SemanticsExtraction {
  throw new Error(
    'unverified_by_trace(semantics_llm_required): extractSemantics() is forbidden. ' +
    'Semantic claims require LLM synthesis. Use extractSemanticsWithLLM() instead.'
  );
}
