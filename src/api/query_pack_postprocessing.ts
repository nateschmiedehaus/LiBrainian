import type { ContextPack } from '../types.js';
import { noResult } from './empty_values.js';

export function dedupePacks(packs: ContextPack[]): ContextPack[] {
  const map = new Map<string, ContextPack>();
  for (const pack of packs) {
    if (!map.has(pack.packId)) {
      map.set(pack.packId, pack);
    }
  }
  return Array.from(map.values());
}

export function buildExplanation(
  parts: string[],
  averageScore: number,
  candidateCount: number
): string {
  const explanation = parts.slice();
  if (candidateCount > 0 && Number.isFinite(averageScore)) {
    explanation.push(`Ranked ${candidateCount} candidates (avg score ${averageScore.toFixed(2)}).`);
  }
  return explanation.join(' ');
}

export function resolveEvidenceEntityType(pack: ContextPack): 'function' | 'module' | null {
  if (pack.packType === 'function_context') return 'function';
  if (
    pack.packType === 'module_context'
    || pack.packType === 'change_impact'
    || pack.packType === 'pattern_context'
    || pack.packType === 'decision_context'
    || pack.packType === 'doc_context'
  ) {
    return 'module';
  }
  return noResult();
}
