type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

const TRUTHY_PATTERN = /^(?!\s*$)(?!0$)(?!false$)(?!off$)(?!no$)/i;

export const CLAUDE_NESTED_SESSION_ENV_VARS: readonly string[] = [
  'CLAUDE_CODE',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_SESSION',
  'SESSION_ID',
  'ANTHROPIC_CLAUDE_CODE',
  'ANTHROPIC_CLAUDE_CODE_SESSION',
];

function hasTruthyEnvValue(value: string | undefined): boolean {
  return Boolean(value && TRUTHY_PATTERN.test(value));
}

export interface NestedClaudeSessionDetection {
  isNested: boolean;
  markers: string[];
}

export function detectNestedClaudeSession(env: EnvLike = process.env): NestedClaudeSessionDetection {
  const markers: string[] = [];
  for (const key of CLAUDE_NESTED_SESSION_ENV_VARS) {
    if (hasTruthyEnvValue(env[key])) {
      markers.push(key);
    }
  }

  if (markers.length === 1 && markers[0] === 'SESSION_ID') {
    return { isNested: false, markers: [] };
  }

  if (!markers.includes('SESSION_ID') && hasTruthyEnvValue(env.SESSION_ID) && hasTruthyEnvValue(env.CLAUDE_MODEL)) {
    markers.push('SESSION_ID');
  }

  const uniqueMarkers = Array.from(new Set(markers));
  return { isNested: uniqueMarkers.length > 0, markers: uniqueMarkers };
}

export function formatNestedSessionReason(env: EnvLike = process.env): string | undefined {
  const detection = detectNestedClaudeSession(env);
  if (!detection.isNested) return undefined;
  const markerList = detection.markers.length > 0 ? detection.markers.join(', ') : 'unknown markers';
  return `Nested Claude Code session detected (${markerList})`;
}
