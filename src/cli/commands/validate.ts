/**
 * @fileoverview Validate command - Validate constraints for a file
 */

import { parseArgs } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { isBootstrapRequired } from '../../api/bootstrap.js';
import { ConstraintEngine } from '../../engines/constraint_engine.js';
import { createError } from '../errors.js';
import { printKeyValue, printTable } from '../progress.js';

export interface ValidateCommandOptions {
  workspace: string;
  args: string[];
}

export async function validateCommand(options: ValidateCommandOptions): Promise<void> {
  const { workspace, args } = options;

  // Parse command-specific options
  const { values, positionals } = parseArgs({
    args,
    options: {
      before: { type: 'string' },
      after: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const filePath = positionals.join(' ');
  if (!filePath) {
    throw createError('INVALID_ARGUMENT', 'File path is required. Usage: librainian validate <file-path>');
  }

  const beforeContent = values.before as string | undefined;
  const afterContent = values.after as string | undefined;
  const outputJson = values.json as boolean;

  // Resolve file path
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(workspace, filePath);
  const relativePath = path.relative(workspace, absolutePath);

  // Initialize storage
  const dbPath = await resolveDbPath(workspace);
  const storage = createSqliteStorage(dbPath, workspace);
  await storage.initialize();

  try {
    // Check if bootstrapped
    const bootstrapCheck = await isBootstrapRequired(workspace, storage);
    if (bootstrapCheck.required) {
      throw createError('NOT_BOOTSTRAPPED', bootstrapCheck.reason);
    }

    // Read file content if not provided
    let currentContent = '';
    try {
      currentContent = await fs.readFile(absolutePath, 'utf8');
    } catch (error) {
      if (!afterContent) {
        throw createError('VALIDATION_FAILED', `Cannot read file: ${filePath}`);
      }
    }

    const before = beforeContent ?? '';
    const after = afterContent ?? currentContent;

    // Create constraint engine
    const engine = new ConstraintEngine(storage, workspace);

    // Get applicable constraints
    const constraints = await engine.getApplicableConstraints([relativePath]);

    // Validate the file
    const result = await engine.validateChange(relativePath, before, after);

    // Get boundaries
    const boundaries = await engine.getBoundaries(relativePath);

    // Get inferred constraints
    const inferred = await engine.inferConstraints();

    // Output results
    if (outputJson) {
      console.log(JSON.stringify({
        file: relativePath,
        constraints: constraints.length,
        violations: result.violations,
        warnings: result.warnings,
        blocking: result.blocking,
        proceedReason: result.proceedReason,
        boundaries,
        inferred: inferred.map((i) => ({
          id: i.constraint.id,
          rule: i.constraint.rule,
          confidence: i.constraint.confidence,
          examples: i.examples,
        })),
      }, null, 2));
      return;
    }

    console.log('Constraint Validation Results');
    console.log('=============================\n');

    printKeyValue([
      { key: 'File', value: relativePath },
      { key: 'Absolute Path', value: absolutePath },
      { key: 'Constraints Checked', value: constraints.length },
      { key: 'Blocking', value: result.blocking },
    ]);
    console.log();

    // Show applicable constraints
    if (constraints.length > 0) {
      console.log('Applicable Constraints:');
      for (const constraint of constraints) {
        const severity = constraint.severity === 'error' ? '[ERROR]' : constraint.severity === 'warning' ? '[WARN]' : '[INFO]';
        console.log(`  ${severity} ${constraint.rule}`);
        console.log(`      ID: ${constraint.id}, Confidence: ${constraint.confidence.toFixed(2)}`);
      }
      console.log();
    } else {
      console.log('No applicable constraints for this file.\n');
    }

    // Show violations
    if (result.violations.length > 0) {
      console.log('Violations (Blocking):');
      for (const violation of result.violations) {
        console.log(`\n  [${violation.constraint.severity.toUpperCase()}] ${violation.constraint.rule}`);
        console.log(`  Location: ${violation.location.file}${violation.location.line ? `:${violation.location.line}` : ''}`);
        console.log(`  Explanation: ${violation.explanation}`);
        console.log(`  Suggestion: ${violation.suggestion}`);
        console.log(`  Confidence: ${violation.confidence.toFixed(2)}`);
        console.log(`  Auto-fixable: ${violation.autoFixable}`);
      }
      console.log();
    }

    // Show warnings
    if (result.warnings.length > 0) {
      console.log('Warnings (Non-blocking):');
      for (const warning of result.warnings) {
        console.log(`\n  [WARN] ${warning.constraint.rule}`);
        console.log(`  Location: ${warning.location.file}${warning.location.line ? `:${warning.location.line}` : ''}`);
        console.log(`  Explanation: ${warning.explanation}`);
        if (warning.suggestion) {
          console.log(`  Suggestion: ${warning.suggestion}`);
        }
      }
      console.log();
    }

    // Show boundaries
    if (boundaries.length > 0) {
      console.log('Layer Boundaries:');
      for (const boundary of boundaries) {
        console.log(`\n  Layer: ${boundary.layer}`);
        console.log(`  Directories: ${boundary.directories.join(', ')}`);
        console.log(`  Allowed Dependencies: ${boundary.allowedDependencies.join(', ') || 'None'}`);
        if (boundary.violations.length > 0) {
          console.log(`  Violations: ${boundary.violations.length}`);
        }
      }
      console.log();
    }

    // Show inferred constraints summary
    if (inferred.length > 0) {
      console.log('Inferred Constraints:');
      printTable(
        ['Type', 'Rule', 'Confidence'],
        inferred.slice(0, 10).map((i) => [
          i.constraint.type,
          i.constraint.rule.substring(0, 50) + (i.constraint.rule.length > 50 ? '...' : ''),
          i.constraint.confidence.toFixed(2),
        ]),
      );
      if (inferred.length > 10) {
        console.log(`  ... and ${inferred.length - 10} more inferred constraints`);
      }
      console.log();
    }

    // Final verdict
    if (result.blocking) {
      console.log('Result: BLOCKED');
      console.log('The file has blocking violations that must be resolved.');
    } else if (result.warnings.length > 0) {
      console.log('Result: PASSED WITH WARNINGS');
      console.log(result.proceedReason || 'Proceed with caution.');
    } else {
      console.log('Result: PASSED');
      console.log('No constraint violations detected.');
    }

  } finally {
    await storage.close();
  }
}
