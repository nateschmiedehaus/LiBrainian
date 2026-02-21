import fs from 'node:fs/promises';
import path from 'node:path';

import { sanitizePath } from '../security/sanitization.js';
import { safeJsonParse } from '../utils/safe_json.js';
import type { LCLExpression } from './lcl.js';
import type { PrimitiveId, NonEmptyArray } from './pattern_catalog.js';

const PRESET_DIR = '.librainian';
const PRESET_FILENAME = 'presets.json';
const MAX_PRESET_BYTES = 1_000_000;
const MAX_PRESET_KEYS = 200;
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

const DEFAULT_PRESETS: Record<string, LCLExpression> = {
  preset_quick_debug: {
    base: 'pattern',
    baseId: 'pattern_bug_investigation',
    overrides: {
      corePrimitives: ['tp_hypothesis', 'tp_bisect'] as unknown as NonEmptyArray<PrimitiveId>,
    },
  },
  preset_zero_knowledge_bootstrap: {
    base: 'primitives',
    primitiveIds: ['tp_arch_mapping', 'tp_search_history'],
    operators: [
      {
        type: 'sequence',
        inputs: ['tp_arch_mapping', 'tp_search_history'],
      },
    ],
  },
};

function resolveWorkspaceRoot(workspaceRoot?: string): string {
  const root = workspaceRoot ?? process.cwd();
  if (!path.isAbsolute(root)) {
    throw new Error('unverified_by_trace(preset_workspace_invalid): workspace must be absolute');
  }
  const result = sanitizePath(root, {
    allowAbsolute: true,
    blockedPatterns: BLOCKED_PATH_PATTERNS,
  });
  if (!result.valid || !result.value) {
    const message = result.errors.map((error) => error.message).join('; ');
    throw new Error(`unverified_by_trace(preset_workspace_invalid): ${message}`);
  }
  return result.value;
}

export function resolvePresetsPath(workspaceRoot?: string): string {
  const safeWorkspace = resolveWorkspaceRoot(workspaceRoot);
  return path.join(safeWorkspace, PRESET_DIR, PRESET_FILENAME);
}

function normalizePresets(input: unknown): Record<string, LCLExpression> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('unverified_by_trace(preset_parse_failed): presets must be an object');
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_PRESET_KEYS) {
    throw new Error('unverified_by_trace(preset_parse_failed): too many presets');
  }
  const out: Record<string, LCLExpression> = {};
  for (const [key, value] of entries) {
    const trimmed = key.trim();
    if (trimmed.length === 0) continue;
    if (!value || typeof value !== 'object') continue;
    out[trimmed] = value as LCLExpression;
  }
  return out;
}

export async function loadPresets(workspaceRoot?: string): Promise<Record<string, LCLExpression>> {
  const presetsPath = resolvePresetsPath(workspaceRoot);
  try {
    const raw = await fs.readFile(presetsPath, 'utf8');
    if (raw.length > MAX_PRESET_BYTES) {
      throw new Error('unverified_by_trace(preset_parse_failed): presets file too large');
    }
    const parsed = safeJsonParse<Record<string, LCLExpression>>(raw);
    if (!parsed.ok) {
      throw new Error('unverified_by_trace(preset_parse_failed): invalid JSON');
    }
    return normalizePresets(parsed.value);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
      return { ...DEFAULT_PRESETS };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('unverified_by_trace(preset_parse_failed)')) {
      throw error;
    }
    throw new Error(`unverified_by_trace(preset_load_failed): ${message}`);
  }
}

export async function savePresets(
  presets: Record<string, LCLExpression>,
  workspaceRoot?: string
): Promise<void> {
  const presetsPath = resolvePresetsPath(workspaceRoot);
  const dir = path.dirname(presetsPath);
  await fs.mkdir(dir, { recursive: true });
  const payload = JSON.stringify(presets, null, 2) + '\n';
  if (payload.length > MAX_PRESET_BYTES) {
    throw new Error('unverified_by_trace(preset_save_failed): presets payload too large');
  }
  await fs.writeFile(presetsPath, payload, 'utf8');
}

export function getDefaultPresets(): Record<string, LCLExpression> {
  return { ...DEFAULT_PRESETS };
}
