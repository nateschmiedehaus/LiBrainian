/**
 * @fileoverview Intent-behavior coherence scoring utilities.
 */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when',
  'where', 'what', 'your', 'their', 'then', 'than', 'only', 'use', 'using',
  'local', 'helper', 'skill', 'agent', 'code', 'task', 'tasks', 'tool',
]);

export function tokenizeForIntentBehavior(value: string): Set<string> {
  const tokens = new Set<string>();
  const matches = value.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  for (const token of matches) {
    if (!STOPWORDS.has(token)) {
      tokens.add(token);
    }
  }
  return tokens;
}

export function computeIntentBehaviorCoherence(
  description: string,
  instructions: string,
): number {
  const descTokens = tokenizeForIntentBehavior(description);
  if (descTokens.size === 0) return 1;
  const instructionTokens = tokenizeForIntentBehavior(instructions);
  let overlap = 0;
  for (const token of descTokens) {
    if (instructionTokens.has(token)) overlap += 1;
  }
  return overlap / descTokens.size;
}
