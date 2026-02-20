import type { LlmChatMessage, LlmServiceAdapter } from '../adapters/llm_service.js';

export type StructuredParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface StructuredGenerateOptions<T> {
  llmService: LlmServiceAdapter;
  provider: string;
  modelId: string;
  messages: LlmChatMessage[];
  parse: (response: string) => StructuredParseResult<T>;
  maxTokens?: number;
  temperature?: number;
  outputSchema?: Record<string, unknown>;
  maxAttempts?: number;
  buildRepairMessages?: (params: {
    baseMessages: LlmChatMessage[];
    previousOutput: string;
    parseError: string;
    attempt: number;
    outputSchema?: Record<string, unknown>;
  }) => LlmChatMessage[];
}

export type StructuredGenerateResult<T> =
  | {
      ok: true;
      value: T;
      rawResponse: string;
      attempts: number;
    }
  | {
      ok: false;
      error: string;
      rawResponse: string;
      attempts: number;
    };

const DEFAULT_MAX_ATTEMPTS = 3;

const DEFAULT_REPAIR_SYSTEM = 'You are a strict JSON formatter. Return one valid JSON object only. No markdown fences.';

export async function generateStructuredWithRetries<T>(
  options: StructuredGenerateOptions<T>
): Promise<StructuredGenerateResult<T>> {
  const {
    llmService,
    provider,
    modelId,
    messages,
    parse,
    maxTokens,
    temperature,
    outputSchema,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    buildRepairMessages,
  } = options;

  const attempts = Number.isFinite(maxAttempts) ? Math.max(1, Math.floor(maxAttempts)) : DEFAULT_MAX_ATTEMPTS;
  const baseMessages = messages;
  let requestMessages = messages;
  let lastError = 'invalid_structured_output';
  let lastResponse = '';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await llmService.chat({
      provider,
      modelId,
      messages: requestMessages,
      maxTokens,
      temperature,
      outputSchema: outputSchema ? JSON.stringify(outputSchema) : undefined,
    });

    lastResponse = response.content;
    const parsed = parse(lastResponse);
    if (parsed.ok) {
      return {
        ok: true,
        value: parsed.value,
        rawResponse: lastResponse,
        attempts: attempt,
      };
    }

    lastError = parsed.error || 'invalid_structured_output';
    if (attempt >= attempts) {
      break;
    }

    requestMessages = buildRepairMessages
      ? buildRepairMessages({
          baseMessages,
          previousOutput: lastResponse,
          parseError: lastError,
          attempt,
          outputSchema,
        })
      : [
          { role: 'system', content: DEFAULT_REPAIR_SYSTEM },
          ...baseMessages,
          {
            role: 'user',
            content: [
              `Previous response failed validation: ${lastError}`,
              outputSchema ? `Required schema:\n${JSON.stringify(outputSchema, null, 2)}` : '',
              'Rewrite and return strict JSON only.',
              `Previous output:\n${lastResponse}`,
            ].filter(Boolean).join('\n\n'),
          },
        ];
  }

  return {
    ok: false,
    error: lastError,
    rawResponse: lastResponse,
    attempts,
  };
}
