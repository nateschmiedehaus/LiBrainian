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

import type { EntitySemantics, TribalKnowledgeInfo } from '../universal_types.js';
import { resolveLlmServiceAdapter } from '../../adapters/llm_service.js';
import { resolveLibrarianModelId } from '../../api/llm_env.js';
import { buildLlmEvidence, type LlmEvidence } from './llm_evidence.js';

export interface SemanticsExtraction {
  semantics: EntitySemantics;
  confidence: number;
  wisdom?: TribalKnowledgeInfo;
  llmEvidence?: LlmEvidence;
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
    "gotchas": ["non-obvious pitfalls and failure modes"],
    "tips": ["practical usage patterns that work well"],
    "learningPath": [{"order": 1, "description": "specific step to understand this entity"}],
    "tribal": ["undocumented conventions or historical context"]
  }
}

The wisdom section is optional. If nothing notable exists, return empty arrays.
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

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    deduped.add(trimmed);
  }
  return Array.from(deduped);
}

function parseWisdom(value: unknown): TribalKnowledgeInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const gotchas = normalizeStringList(raw.gotchas);
  const tips = normalizeStringList(raw.tips);
  const tribal = normalizeStringList(raw.tribal);

  const learningPathInput = Array.isArray(raw.learningPath) ? raw.learningPath : [];
  const learningSteps = learningPathInput
    .map((step, index) => {
      if (typeof step === 'string') {
        const description = step.trim();
        if (!description) return null;
        return { order: index + 1, description };
      }
      if (!step || typeof step !== 'object') return null;
      const stepRecord = step as Record<string, unknown>;
      const description = typeof stepRecord.description === 'string' ? stepRecord.description.trim() : '';
      if (!description) return null;
      const orderCandidate = Number(stepRecord.order);
      return {
        order: Number.isFinite(orderCandidate) && orderCandidate > 0 ? Math.floor(orderCandidate) : index + 1,
        description,
      };
    })
    .filter((step): step is { order: number; description: string } => step !== null);

  if (gotchas.length === 0 && tips.length === 0 && tribal.length === 0 && learningSteps.length === 0) {
    return undefined;
  }

  return {
    tribal: tribal.map((knowledge) => ({
      knowledge,
      source: 'LLM semantic extraction',
      importance: 'important',
    })),
    gotchas: gotchas.map((description) => ({
      description,
      consequence: 'May cause unexpected behavior',
      prevention: 'Follow recommended usage pattern',
    })),
    tips: tips.map((description) => ({
      description,
      context: 'LLM semantic extraction',
    })),
    learningPath: learningSteps,
  };
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
      wisdom: parseWisdom(parsed.wisdom),
      confidence: 0.85, // LLM extraction has high confidence
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`unverified_by_trace(provider_invalid_output): ${message}`);
  }
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
