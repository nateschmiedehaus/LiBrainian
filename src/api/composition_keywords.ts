import type { TechniqueComposition } from '../strategic/techniques.js';

const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/g;
const TOKEN_PATTERN = /[a-z0-9]+/g;

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'your',
  'our',
  'their',
  'plan',
  'work',
  'workflow',
  'process',
  'system',
  'technique',
  'composition',
  'method',
  'guide',
]);

export const COMPOSITION_KEYWORDS: Record<string, string[]> = {
  tc_agentic_review_v1: ['review', 'audit', 'code review', 'risk review'],
  tc_root_cause_recovery: ['root cause', 'failure', 'incident', 'bug', 'regression'],
  tc_release_readiness: ['release', 'rollout', 'deploy', 'migration'],
  tc_repo_rehab_triage: ['rehab', 'triage', 'stabilize', 'legacy', 'debt'],
  tc_performance_reliability: ['performance', 'latency', 'throughput', 'scaling'],
  tc_security_review: ['security', 'threat', 'abuse', 'vulnerability', 'audit'],
  tc_ux_discovery: ['ux', 'user journey', 'usability', 'onboarding', 'experience'],
  tc_scaling_readiness: ['scaling readiness', 'capacity', 'throughput', 'scale'],
  tc_cross_repo_contract_drift: ['cross repo', 'cross-repo', 'contract drift', 'schema drift', 'api drift', 'dependency compatibility'],
  tc_migration_safety_rollout: ['schema migration', 'data migration', 'rollback', 'migration safety', 'rollout safety'],
  tc_incident_hotfix_governed: ['incident hotfix', 'hotfix', 'blast radius', 'audit trail', 'urgent fix'],
  tc_social_platform: ['social platform', 'social', 'community', 'feed', 'sharing'],
  tc_video_platform: ['video platform', 'video', 'streaming', 'media'],
  tc_industrial_backend: ['industrial', 'backend', 'logistics', 'operations', 'pipeline'],
  tc_developer_tool: ['developer tool', 'devtool', 'cli', 'sdk', 'framework'],
  tc_dashboard: ['dashboard', 'analytics', 'admin', 'reporting'],
  tc_landing_page: ['landing page', 'marketing site', 'homepage'],
  tc_payment_system: ['payment', 'billing', 'checkout', 'subscription'],
  tc_e_commerce: ['e-commerce', 'commerce', 'store', 'cart'],
  tc_search_system: ['search', 'query', 'indexing', 'ranking'],
  tc_notification: ['notification', 'email', 'sms', 'push'],
};

export interface CompositionKeywordSelection {
  id: string;
  score: number;
  matchedKeywords: string[];
  composition: TechniqueComposition;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(CONTROL_CHAR_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text).match(TOKEN_PATTERN) ?? [];
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function deriveKeywords(composition: TechniqueComposition): string[] {
  const source = [
    composition.name,
    composition.description,
    composition.primitiveIds.join(' '),
  ].filter(Boolean).join(' ');
  const tokens = tokenize(source)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
  return uniqueInOrder(tokens);
}

export function getCompositionKeywords(composition: TechniqueComposition): string[] {
  const curated = COMPOSITION_KEYWORDS[composition.id] ?? [];
  const derived = deriveKeywords(composition);
  return uniqueInOrder([...curated, ...derived]);
}

function matchKeywords(
  normalizedIntent: string,
  intentTokens: Set<string>,
  keywords: string[]
): string[] {
  const matches: string[] = [];
  for (const keyword of keywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedKeyword) continue;
    if (normalizedKeyword.includes(' ')) {
      if (normalizedIntent.includes(normalizedKeyword)) {
        matches.push(keyword);
      }
      continue;
    }
    if (intentTokens.has(normalizedKeyword)) {
      matches.push(keyword);
    }
  }
  return matches;
}

function scoreKeywordMatches(
  normalizedIntent: string,
  intentTokens: Set<string>,
  matches: string[]
): number {
  let score = 0;
  for (const match of matches) {
    const normalizedKeyword = normalizeText(match);
    if (!normalizedKeyword) continue;
    if (normalizedKeyword.includes(' ')) {
      const phraseLength = normalizedKeyword.split(/\s+/).filter(Boolean).length;
      score += 4 + phraseLength;
      if (normalizedIntent.startsWith(normalizedKeyword)) {
        score += 1;
      }
      continue;
    }
    if (intentTokens.has(normalizedKeyword)) {
      score += 2;
    }
  }
  return score;
}

function specificityBoost(composition: TechniqueComposition, matchedKeywords: string[]): number {
  if (matchedKeywords.length === 0) return 0;
  const averageKeywordLength = matchedKeywords
    .map((keyword) => normalizeText(keyword))
    .filter(Boolean)
    .reduce((sum, keyword) => sum + keyword.length, 0) / matchedKeywords.length;
  const compositionNamePenalty = composition.id === 'tc_agentic_review_v1' ? -0.5 : 0;
  return averageKeywordLength / 20 + compositionNamePenalty;
}

export function rankTechniqueCompositionsByKeyword(
  intent: string,
  compositions: TechniqueComposition[]
): CompositionKeywordSelection[] {
  const normalizedIntent = normalizeText(intent);
  if (!normalizedIntent) return [];
  const intentTokens = new Set(tokenize(normalizedIntent));

  const ranked = compositions.map((composition) => {
    const keywords = getCompositionKeywords(composition);
    const matchedKeywords = matchKeywords(normalizedIntent, intentTokens, keywords);
    const rawScore = scoreKeywordMatches(normalizedIntent, intentTokens, matchedKeywords);
    const score = rawScore + specificityBoost(composition, matchedKeywords);
    return {
      id: composition.id,
      score,
      matchedKeywords,
      composition,
    };
  }).filter((item) => item.matchedKeywords.length > 0);

  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.matchedKeywords.length !== left.matchedKeywords.length) {
      return right.matchedKeywords.length - left.matchedKeywords.length;
    }
    return left.id.localeCompare(right.id);
  });

  return ranked;
}

export function matchCompositionKeywords(intent: string, composition: TechniqueComposition): string[] {
  const normalizedIntent = normalizeText(intent);
  if (!normalizedIntent) return [];
  const intentTokens = new Set(tokenize(normalizedIntent));
  return matchKeywords(normalizedIntent, intentTokens, getCompositionKeywords(composition));
}

export function selectTechniqueCompositionsByKeyword(
  intent: string,
  compositions: TechniqueComposition[]
): TechniqueComposition[] {
  return rankTechniqueCompositionsByKeyword(intent, compositions)
    .map((selection) => selection.composition);
}
