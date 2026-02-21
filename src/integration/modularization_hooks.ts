/**
 * @fileoverview Modularization Hooks System
 *
 * Provides runtime enforcement and guidance for modularization-first development.
 * This hook system is integrated into:
 * 1. Agent prompts (via agent_protocol.ts)
 * 2. File write operations (via file_ops.ts)
 * 3. LiBrainian queries (via wave0_integration.ts)
 *
 * PHILOSOPHY (from Wave0 development standards):
 * - Search before creating: Always search for existing implementations before creating new files
 * - Descriptive names: Use meaningful file names that describe purpose, not generic names
 * - Consolidate related functionality: Keep related code together, avoid fragmentation
 * - Minimize file proliferation: Each new file must justify its existence
 *
 * @packageDocumentation
 */

import path from 'node:path';
import { getLiBrainian } from './first_run_gate.js';
import { logWarning, logInfo } from '../telemetry/logger.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ModularizationCheckResult {
  /** Whether the file creation should proceed */
  allowed: boolean;

  /** Reason for blocking (if blocked) */
  blockReason?: string;

  /** Existing files that may already provide similar functionality */
  similarFiles?: string[];

  /** Suggestions for where to add functionality instead */
  suggestions?: string[];

  /** Confidence in the check result (0-1) */
  confidence: number;
}

export interface ModularizationGuidance {
  /** Prompt section to inject */
  prompt: string;

  /** Version of the guidance */
  version: string;

  /** Last updated timestamp */
  updatedAt: string;
}

export interface FileCreationContext {
  /** The target file path (relative to workspace) */
  filePath: string;

  /** Content to be written (if available for analysis) */
  content?: string;

  /** Agent or task requesting the write */
  requesterId?: string;

  /** Workspace root path */
  workspace: string;

  /** Whether to allow override (e.g., after user confirmation) */
  allowOverride?: boolean;
}

// ============================================================================
// GUIDANCE CONSTANTS
// ============================================================================

export const MODULARIZATION_GUIDANCE_VERSION = 'v1.0.0';

/**
 * Prompt injection for modularization guidance.
 * This is injected into agent prompts to remind them of modularization principles.
 */
const MODULARIZATION_PROMPT = `## Modularization-First Development Protocol

CRITICAL: Before creating ANY new file, you MUST:

1. **Search First**: Search for existing implementations that could be extended
   - Use librainian query: "existing implementations of [functionality]"
   - Check related modules for similar patterns
   - Review AGENTS.md or similar guides for existing conventions

2. **Name Descriptively**: File names must describe purpose, not be generic
   - BAD: utils.ts, helpers.ts, types.ts, misc.ts
   - GOOD: confidence_calibration.ts, query_synthesis.ts, governor_context.ts

3. **Consolidate**: Add to existing files when functionality is related
   - Look for files with similar domain responsibility
   - Check if an existing module exports related functionality
   - Prefer extending over creating new

4. **Justify Creation**: New files require clear justification
   - New domain/responsibility not covered by existing files
   - Size threshold: existing file would exceed ~500 lines
   - Separation of concerns requires isolation

ENFORCEMENT: File writes to new paths will be checked against existing codebase.
If similar functionality exists, you will be asked to reconsider.`;

// ============================================================================
// FILE NAME ANTI-PATTERNS
// ============================================================================

/**
 * Generic file names that should be avoided.
 * These are red flags for poor modularization.
 */
const GENERIC_FILE_NAMES = new Set([
  'utils',
  'helpers',
  'misc',
  'common',
  'shared',
  'types', // Should be domain_types.ts
  'constants', // Should be domain_constants.ts
  'config', // Should be domain_config.ts
  'functions',
  'methods',
  'handlers',
  'stuff',
  'temp',
  'test', // Should be domain.test.ts
  'index', // Allowed but only as re-exports
]);

/**
 * Patterns that suggest poor file naming.
 */
const POOR_NAME_PATTERNS = [
  /^new_.*\.ts$/, // new_feature.ts
  /^old_.*\.ts$/, // old_implementation.ts
  /^temp_.*\.ts$/, // temp_fix.ts
  /^test_.*\.ts$/, // test_something.ts (should be something.test.ts)
  /^v\d+_.*\.ts$/, // v2_feature.ts
  /^copy_.*\.ts$/, // copy_of_something.ts
  /^\d+_.*\.ts$/, // 123_feature.ts
];

// ============================================================================
// MODULARIZATION CHECK
// ============================================================================

/**
 * Check if a file creation adheres to modularization principles.
 * This is the main hook called before file writes.
 */
export async function checkModularization(
  context: FileCreationContext
): Promise<ModularizationCheckResult> {
  const { filePath, content, workspace, allowOverride } = context;

  // Early return if override is allowed
  if (allowOverride) {
    return { allowed: true, confidence: 1.0 };
  }

  // Check if this is a new file (file doesn't exist yet)
  const isNewFile = await isNewFilePath(workspace, filePath);
  if (!isNewFile) {
    // Modifying existing file - always allowed
    return { allowed: true, confidence: 1.0 };
  }

  // Check for generic file names
  const genericNameCheck = checkGenericFileName(filePath);
  if (!genericNameCheck.allowed) {
    logWarning('Modularization hook: blocked generic file name', {
      file: filePath,
      reason: genericNameCheck.blockReason,
    });
    return genericNameCheck;
  }

  // Check for similar existing files
  const similarCheck = await checkSimilarFiles(workspace, filePath, content);
  if (!similarCheck.allowed) {
    logWarning('Modularization hook: similar files found', {
      file: filePath,
      similarFiles: similarCheck.similarFiles,
    });
    return similarCheck;
  }

  // Check for poor naming patterns
  const patternCheck = checkPoorNamingPatterns(filePath);
  if (!patternCheck.allowed) {
    return patternCheck;
  }

  logInfo('Modularization hook: file creation allowed', { file: filePath });
  return { allowed: true, confidence: 0.9 };
}

/**
 * Check if a file path is new (doesn't exist yet).
 */
async function isNewFilePath(workspace: string, relativePath: string): Promise<boolean> {
  try {
    const { promises: fs } = await import('node:fs');
    const fullPath = path.resolve(workspace, relativePath);
    await fs.access(fullPath);
    return false; // File exists
  } catch {
    return true; // File doesn't exist
  }
}

/**
 * Check for generic file names that should be avoided.
 */
function checkGenericFileName(filePath: string): ModularizationCheckResult {
  const basename = path.basename(filePath, path.extname(filePath)).toLowerCase();

  if (GENERIC_FILE_NAMES.has(basename)) {
    return {
      allowed: false,
      blockReason: `Generic file name "${basename}" violates modularization principles. Use a descriptive name that indicates purpose (e.g., "confidence_calibration.ts" not "utils.ts").`,
      suggestions: [
        `Rename to describe the specific functionality (e.g., "${basename}_for_[domain].ts")`,
        'Consider adding to an existing domain-specific file',
        'Use librainian query to find appropriate existing location',
      ],
      confidence: 0.95,
    };
  }

  return { allowed: true, confidence: 0.9 };
}

/**
 * Check for poor naming patterns.
 */
function checkPoorNamingPatterns(filePath: string): ModularizationCheckResult {
  const basename = path.basename(filePath);

  for (const pattern of POOR_NAME_PATTERNS) {
    if (pattern.test(basename)) {
      return {
        allowed: false,
        blockReason: `File name "${basename}" matches poor naming pattern. Avoid prefixes like "new_", "old_", "temp_", "v2_", etc.`,
        suggestions: [
          'Use a descriptive name that explains the purpose',
          'Follow domain_functionality.ts naming convention',
          'Check existing files for naming conventions in the same directory',
        ],
        confidence: 0.85,
      };
    }
  }

  return { allowed: true, confidence: 0.9 };
}

/**
 * Check for similar existing files using librainian.
 */
async function checkSimilarFiles(
  workspace: string,
  filePath: string,
  content?: string
): Promise<ModularizationCheckResult> {
  const librainian = getLiBrainian(workspace);
  if (!librainian) {
    // LiBrainian not available - allow with lower confidence
    return { allowed: true, confidence: 0.5 };
  }

  try {
    // Extract potential purpose from file path and content
    const basename = path.basename(filePath, path.extname(filePath));
    const dirName = path.dirname(filePath);
    const purposeHints = extractPurposeHints(basename, content);

    if (purposeHints.length === 0) {
      return { allowed: true, confidence: 0.7 };
    }

    // Query librainian for similar functionality
    const response = await librainian.query({
      intent: `Find existing implementations for: ${purposeHints.join(', ')}`,
      affectedFiles: [filePath],
      depth: 'L1',
    });

    // Check if response indicates similar existing files
    if (response.packs.length > 0) {
      const similarFiles = response.packs
        .flatMap((p) => p.relatedFiles)
        .filter((f) => f !== filePath)
        .slice(0, 5);

      if (similarFiles.length > 0) {
        // Check if any similar files are in the same directory
        const sameDir = similarFiles.filter((f) => path.dirname(f) === dirName);

        if (sameDir.length > 0) {
          return {
            allowed: false,
            blockReason: `Similar functionality may already exist in the same directory. Consider extending existing files instead of creating new ones.`,
            similarFiles: sameDir,
            suggestions: [
              `Review ${sameDir[0]} for potential consolidation`,
              'Query librainian for detailed comparison',
              'If truly new functionality, explain why existing files cannot be extended',
            ],
            confidence: 0.75,
          };
        }

        // Similar files exist but in different directories - warn but allow
        return {
          allowed: true,
          similarFiles,
          suggestions: [
            `Consider if functionality could be consolidated with ${similarFiles[0]}`,
            'Check if domain boundaries justify separation',
          ],
          confidence: 0.7,
        };
      }
    }

    return { allowed: true, confidence: 0.85 };
  } catch (error) {
    // LiBrainian query failed - allow with lower confidence
    return { allowed: true, confidence: 0.5 };
  }
}

/**
 * Extract purpose hints from file name and content.
 */
function extractPurposeHints(basename: string, content?: string): string[] {
  const hints: string[] = [];

  // Extract from file name (split on underscores and camelCase)
  const nameWords = basename
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .split('_')
    .filter((w) => w.length > 2);

  hints.push(...nameWords);

  // Extract from content if available
  if (content) {
    // Look for export names
    const exportMatches = content.match(/export\s+(const|function|class|interface|type)\s+(\w+)/g);
    if (exportMatches) {
      for (const match of exportMatches.slice(0, 5)) {
        const name = match.split(/\s+/).pop();
        if (name && name.length > 3) {
          hints.push(name.toLowerCase());
        }
      }
    }

    // Look for class names
    const classMatches = content.match(/class\s+(\w+)/g);
    if (classMatches) {
      for (const match of classMatches.slice(0, 3)) {
        const name = match.split(/\s+/).pop();
        if (name) {
          hints.push(name.toLowerCase());
        }
      }
    }
  }

  // Deduplicate and filter
  return [...new Set(hints)].filter((h) => h.length > 2).slice(0, 10);
}

// ============================================================================
// PROMPT INJECTION
// ============================================================================

/**
 * Get modularization guidance for prompt injection.
 */
export function getModularizationGuidance(): ModularizationGuidance {
  return {
    prompt: MODULARIZATION_PROMPT,
    version: MODULARIZATION_GUIDANCE_VERSION,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Build the modularization prompt section for agent prompts.
 * This is called from prompt_builder.ts and agent_protocol.ts.
 */
export function buildModularizationPrompt(): string {
  return MODULARIZATION_PROMPT;
}

// ============================================================================
// EXPORTS FOR INTEGRATION
// ============================================================================

export {
  GENERIC_FILE_NAMES,
  POOR_NAME_PATTERNS,
  MODULARIZATION_PROMPT,
};
