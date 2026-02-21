import fs from 'node:fs/promises';
import path from 'node:path';

import { sanitizePath } from '../security/sanitization.js';
import { safeJsonParse } from '../utils/safe_json.js';

const POLICY_DIR = '.librainian';
const POLICY_FILENAME = 'epistemic_policy.json';
const BLOCKED_PATH_PATTERNS = [
  /\.\./,
  /^\/etc(?:\/|$)/i,
  /^\/proc(?:\/|$)/i,
  /^\/sys(?:\/|$)/i,
  /\$\{/,
  /\$\(/,
  /`/,
  /\x00/,
];

export interface EpistemicPolicy {
  claimThreshold: number;
  uncertaintyDisclosure: boolean;
  evidenceRequired: boolean;
  calibrationFeedback: boolean;
}

export interface EpistemicClaim {
  evidence?: unknown;
  evidenceChain?: unknown;
}

export const DEFAULT_EPISTEMIC_POLICY: EpistemicPolicy = {
  claimThreshold: 0.6,
  uncertaintyDisclosure: true,
  evidenceRequired: true,
  calibrationFeedback: true,
};

function resolveWorkspaceRoot(workspaceRoot?: string): string {
  const root = workspaceRoot ?? process.cwd();
  if (!path.isAbsolute(root)) {
    throw new Error('unverified_by_trace(epistemic_policy_invalid): workspace must be absolute');
  }
  const result = sanitizePath(root, {
    allowAbsolute: true,
    blockedPatterns: BLOCKED_PATH_PATTERNS,
  });
  if (!result.valid || !result.value) {
    const message = result.errors.map((error) => error.message).join('; ');
    throw new Error(`unverified_by_trace(epistemic_policy_invalid): ${message}`);
  }
  return result.value;
}

function resolvePolicyPath(workspaceRoot?: string): string {
  const safeWorkspace = resolveWorkspaceRoot(workspaceRoot);
  return path.join(safeWorkspace, POLICY_DIR, POLICY_FILENAME);
}

function coercePolicy(input: Record<string, unknown>): EpistemicPolicy {
  const thresholdValue = input.claimThreshold ?? DEFAULT_EPISTEMIC_POLICY.claimThreshold;
  if (typeof thresholdValue !== 'number' || !Number.isFinite(thresholdValue)) {
    throw new Error('unverified_by_trace(epistemic_policy_invalid): claimThreshold must be number');
  }
  if (thresholdValue < 0 || thresholdValue > 1) {
    throw new Error('unverified_by_trace(epistemic_policy_invalid): claimThreshold out of range');
  }
  const uncertaintyDisclosure =
    typeof input.uncertaintyDisclosure === 'boolean'
      ? input.uncertaintyDisclosure
      : DEFAULT_EPISTEMIC_POLICY.uncertaintyDisclosure;
  const evidenceRequired =
    typeof input.evidenceRequired === 'boolean'
      ? input.evidenceRequired
      : DEFAULT_EPISTEMIC_POLICY.evidenceRequired;
  const calibrationFeedback =
    typeof input.calibrationFeedback === 'boolean'
      ? input.calibrationFeedback
      : DEFAULT_EPISTEMIC_POLICY.calibrationFeedback;

  return {
    claimThreshold: thresholdValue,
    uncertaintyDisclosure,
    evidenceRequired,
    calibrationFeedback,
  };
}

export async function loadEpistemicPolicy(workspaceRoot?: string): Promise<EpistemicPolicy> {
  const policyPath = resolvePolicyPath(workspaceRoot);
  try {
    const raw = await fs.readFile(policyPath, 'utf8');
    const parsed = safeJsonParse<Record<string, unknown>>(raw);
    if (!parsed.ok) {
      throw new Error('invalid JSON');
    }
    return coercePolicy(parsed.value);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
      return { ...DEFAULT_EPISTEMIC_POLICY };
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`unverified_by_trace(epistemic_policy_invalid): ${message}`);
  }
}

function hasEvidence(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return Boolean(value);
}

export function applyEpistemicPolicy(
  claim: EpistemicClaim | null,
  confidence: number,
  policy: EpistemicPolicy
): boolean {
  if (!Number.isFinite(confidence)) return false;
  if (confidence < policy.claimThreshold) return false;
  if (policy.evidenceRequired) {
    const evidence = claim?.evidence ?? claim?.evidenceChain;
    if (!hasEvidence(evidence)) return false;
  }
  return true;
}
