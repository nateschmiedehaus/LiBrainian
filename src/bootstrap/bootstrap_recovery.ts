import { INCLUDE_PATTERNS, EXCLUDE_PATTERNS } from '../universal_patterns.js';

export interface BootstrapRecoveryPlan {
  workspaceRoot?: string;
  scopeOverride?: 'full';
  include?: string[];
  exclude?: string[];
  reason: string;
}

export interface BootstrapRecoveryInput {
  workspaceRoot: string;
  scope: string;
  errorMessage: string;
}

const ROOT_DETECTED_REGEX = /root at ([^\.\n]+)/i;

function extractDetectedRoot(errorMessage: string): string | null {
  const match = errorMessage.match(ROOT_DETECTED_REGEX);
  if (!match) return null;
  return match[1]?.trim() ?? null;
}

export function planBootstrapRecovery(input: BootstrapRecoveryInput): BootstrapRecoveryPlan | null {
  const message = input.errorMessage ?? '';
  const detectedRoot = extractDetectedRoot(message);
  if (detectedRoot && detectedRoot !== input.workspaceRoot) {
    return {
      workspaceRoot: detectedRoot,
      reason: `Auto-retry with detected workspace root ${detectedRoot}`,
    };
  }

  if (/include patterns match(ed)? no files/i.test(message)) {
    if (input.scope === 'librarian') {
      return {
        scopeOverride: 'full',
        reason: 'Scope "librarian" matched no files; retrying with full scope',
      };
    }
    return {
      include: [...INCLUDE_PATTERNS],
      exclude: [...EXCLUDE_PATTERNS],
      reason: 'Include patterns matched no files; retrying with default patterns',
    };
  }

  if (/excluded by exclude patterns/i.test(message)) {
    return {
      include: [...INCLUDE_PATTERNS],
      exclude: [...EXCLUDE_PATTERNS],
      reason: 'Exclude patterns filtered all matches; retrying with default patterns',
    };
  }

  return null;
}
