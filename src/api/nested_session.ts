/**
 * Shared helpers for detecting when LiBrainian is running inside a nested
 * Claude Code session (agent-inside-agent). Nested sessions cannot launch the
 * Claude CLI, so we proactively disable CLI provider paths when these markers
 * are present.
 */

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

const TRUTHY_PATTERN = /^(?!\s*$)(?!0$)(?!false$)(?!off$)(?!no$)/i;

/**
 * Environment variables that indicate a nested Claude Code session. These are
 * stripped before launching child processes and also used for runtime
 * detection.
 */
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
    const value = env[key];
    if (hasTruthyEnvValue(value)) {
      markers.push(key);
    }
  }

  // Reduce false positives for SESSION_ID by requiring another Claude marker.
  const hasSessionOnly = markers.length === 1 && markers[0] === 'SESSION_ID';
  if (hasSessionOnly) {
    return { isNested: false, markers: [] };
  }

  // SESSION_ID + CLAUDE_MODEL combo also indicates nested Claude session.
  if (!markers.includes('SESSION_ID') && hasTruthyEnvValue(env.SESSION_ID) && hasTruthyEnvValue(env.CLAUDE_MODEL)) {
    markers.push('SESSION_ID');
  }

  const uniqueMarkers = Array.from(new Set(markers));
  return { isNested: uniqueMarkers.length > 0, markers: uniqueMarkers };
}

export function isNestedClaudeSession(env: EnvLike = process.env): boolean {
  return detectNestedClaudeSession(env).isNested;
}

export function formatNestedSessionReason(env: EnvLike = process.env): string | undefined {
  const detection = detectNestedClaudeSession(env);
  if (!detection.isNested) return undefined;
  const markerList = detection.markers.length > 0 ? detection.markers.join(', ') : 'unknown markers';
  return `Nested Claude Code session detected (${markerList})`;
}
