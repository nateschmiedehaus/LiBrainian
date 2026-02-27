#!/usr/bin/env node

/**
 * @fileoverview Adversarial Proof Validator
 *
 * Validates that a proof TEST ITSELF is rigorous enough to catch real failures.
 * This is a meta-test: it doesn't run the test -- it reads the test source code
 * and checks whether the test is too easy to game.
 *
 * The class of bugs this catches:
 *   - Substring-only matching that can't fail (e.g. mustInclude: ["ts"])
 *   - Missing anti-dominance assertions
 *   - Missing Jaccard diversity assertions
 *   - Missing minimum file count assertions
 *   - skip() calls that silently pass without explanation
 *   - Soft assertions (console.warn instead of expect().toBe())
 *
 * Usage:
 *   node scripts/adversarial-proof-validator.mjs src/__tests__/m0_self_development_proof.test.ts
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  /** Minimum length for mustInclude / expectFiles pattern entries */
  MIN_PATTERN_LENGTH: 8,
  /** Minimum number of distinct intents/queries a proof test should exercise */
  MIN_QUERY_COUNT: 3,
};

// ---------------------------------------------------------------------------
// Weakness detectors
// ---------------------------------------------------------------------------

/**
 * @typedef {{ id: string, severity: 'FAIL' | 'WARN', message: string, detail?: string, line?: number }} Weakness
 */

function analyzeTestSource(source, filePath) {
  /** @type {Weakness[]} */
  const weaknesses = [];
  const lines = source.split('\n');

  // ---- CHECK 1: Short mustInclude / expectFiles patterns ----

  const patternArrayRegex = /mustInclude\s*:\s*\[([^\]]+)\]/gs;
  let match;
  while ((match = patternArrayRegex.exec(source)) !== null) {
    const arrayContent = match[1];
    // Extract string literals from the array
    const stringLiterals = arrayContent.match(/['"`]([^'"`]+)['"`]/g) || [];

    for (const literal of stringLiterals) {
      const value = literal.slice(1, -1); // strip quotes
      if (value.length < CONFIG.MIN_PATTERN_LENGTH) {
        const lineNum = source.slice(0, match.index).split('\n').length;
        weaknesses.push({
          id: 'SHORT_PATTERN',
          severity: 'FAIL',
          message: `mustInclude pattern "${value}" is only ${value.length} chars (minimum: ${CONFIG.MIN_PATTERN_LENGTH})`,
          detail: `Short patterns like "${value}" will match many unrelated files, making the test unable to fail`,
          line: lineNum,
        });
      }
    }
  }

  // Also check expectFiles arrays
  const expectFilesRegex = /expectFiles\s*:\s*\[([^\]]+)\]/gs;
  while ((match = expectFilesRegex.exec(source)) !== null) {
    const arrayContent = match[1];
    const stringLiterals = arrayContent.match(/['"`]([^'"`]+)['"`]/g) || [];

    for (const literal of stringLiterals) {
      const value = literal.slice(1, -1);
      if (value.length < CONFIG.MIN_PATTERN_LENGTH) {
        const lineNum = source.slice(0, match.index).split('\n').length;
        weaknesses.push({
          id: 'SHORT_EXPECT_PATTERN',
          severity: 'FAIL',
          message: `expectFiles pattern "${value}" is only ${value.length} chars`,
          detail: 'Suspiciously broad file matching pattern',
          line: lineNum,
        });
      }
    }
  }

  // ---- CHECK 2: Missing anti-dominance assertion ----

  const hasAntiDominance =
    source.includes('anti-dominance') ||
    source.includes('antiDominance') ||
    source.includes('anti_dominance') ||
    source.includes('dominantFiles') ||
    source.includes('dominant_files') ||
    source.includes('fileAppearanceCounts') ||
    source.includes('MAX_FILE_APPEARANCES') ||
    source.includes('file_appearances');

  const hasAntiDominanceExpect =
    hasAntiDominance &&
    (source.includes('expect(') || source.includes('assert('));

  if (!hasAntiDominance) {
    weaknesses.push({
      id: 'MISSING_ANTI_DOMINANCE',
      severity: 'FAIL',
      message: 'No anti-dominance check found in test',
      detail: 'Without checking that a single file does not dominate all result sets, the test cannot catch "always returns the same file" bugs',
    });
  } else if (!hasAntiDominanceExpect) {
    weaknesses.push({
      id: 'SOFT_ANTI_DOMINANCE',
      severity: 'WARN',
      message: 'Anti-dominance logic found but no hard assertion (expect/assert) detected nearby',
      detail: 'Logging dominance violations without failing the test makes them invisible',
    });
  }

  // ---- CHECK 3: Missing Jaccard diversity assertion ----

  const hasJaccard =
    source.includes('jaccard') ||
    source.includes('Jaccard') ||
    source.includes('jaccardSimilarity');

  const hasJaccardExpect =
    hasJaccard &&
    (source.includes('expect(') || source.includes('assert('));

  if (!hasJaccard) {
    weaknesses.push({
      id: 'MISSING_JACCARD_DIVERSITY',
      severity: 'FAIL',
      message: 'No Jaccard similarity / diversity check found in test',
      detail: 'Without checking pairwise result set similarity, the test cannot catch "all queries return the same files" bugs',
    });
  } else if (!hasJaccardExpect) {
    weaknesses.push({
      id: 'SOFT_JACCARD',
      severity: 'WARN',
      message: 'Jaccard logic found but no hard assertion detected',
    });
  }

  // ---- CHECK 4: Missing minimum file count assertion ----

  const hasMinFileCount =
    source.includes('MIN_UNIQUE_FILES') ||
    source.includes('MIN_FILES_PER') ||
    source.includes('minFileCount') ||
    source.includes('min_file_count') ||
    (source.includes('baseFiles.length') && source.includes('toBeGreaterThan'));

  if (!hasMinFileCount) {
    weaknesses.push({
      id: 'MISSING_MIN_FILE_COUNT',
      severity: 'FAIL',
      message: 'No minimum file count assertion found',
      detail: 'Without asserting that each query returns a minimum number of unique files, a test can pass with 0 or 1 result',
    });
  }

  // ---- CHECK 5: Suspicious skip() calls ----

  const skipRegex = /\.skip\(\)/g;
  const ctxSkipRegex = /ctx\.skip\(\)/g;
  const itSkipRegex = /it\.skip\(/g;
  const describeSkipRegex = /describe\.skip\(/g;

  let skipCount = 0;
  const skipLocations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      skipRegex.test(line) ||
      ctxSkipRegex.test(line) ||
      itSkipRegex.test(line) ||
      describeSkipRegex.test(line)
    ) {
      // Reset lastIndex since we're reusing regex
      skipRegex.lastIndex = 0;
      ctxSkipRegex.lastIndex = 0;
      itSkipRegex.lastIndex = 0;
      describeSkipRegex.lastIndex = 0;

      skipCount++;
      skipLocations.push(i + 1);
    }
  }

  if (skipCount > 0) {
    // Check if skips are conditional (which is OK) vs unconditional (which is bad)
    const unconditionalSkips = [];
    for (const lineNum of skipLocations) {
      const lineIdx = lineNum - 1;
      const prevLine = lineIdx > 0 ? lines[lineIdx - 1].trim() : '';
      const currentLine = lines[lineIdx].trim();

      // If the skip is not inside an if/conditional, flag it
      const isConditional =
        currentLine.includes('if (') ||
        currentLine.includes('if(') ||
        prevLine.includes('if (') ||
        prevLine.includes('if(') ||
        prevLine.endsWith('{');

      if (!isConditional && (currentLine.includes('it.skip(') || currentLine.includes('describe.skip('))) {
        unconditionalSkips.push(lineNum);
      }
    }

    if (unconditionalSkips.length > 0) {
      weaknesses.push({
        id: 'UNCONDITIONAL_SKIP',
        severity: 'FAIL',
        message: `${unconditionalSkips.length} unconditional skip() call(s) found at line(s): ${unconditionalSkips.join(', ')}`,
        detail: 'Unconditional skips mean the test NEVER runs, which is equivalent to deleting it',
      });
    }

    if (skipCount > unconditionalSkips.length) {
      const conditionalCount = skipCount - unconditionalSkips.length;
      weaknesses.push({
        id: 'CONDITIONAL_SKIP',
        severity: 'WARN',
        message: `${conditionalCount} conditional skip() call(s) found at line(s): ${skipLocations.join(', ')}`,
        detail: 'Conditional skips are OK if they check for prerequisites (e.g., index exists), but review that they do not silently pass the test',
      });
    }
  }

  // ---- CHECK 6: Soft assertions (warn without fail) ----

  const softAssertionPatterns = [
    { pattern: /console\.warn\([^)]*(?:pass|fail|quality|issue|error)/gi, label: 'console.warn with quality-related message' },
    { pattern: /console\.log\([^)]*(?:WARN|WARNING|ISSUE|PROBLEM|FAIL)/g, label: 'console.log with warning/failure language' },
  ];

  for (const { pattern, label } of softAssertionPatterns) {
    let softMatch;
    while ((softMatch = pattern.exec(source)) !== null) {
      const lineNum = source.slice(0, softMatch.index).split('\n').length;
      // Check if there's also a hard assertion nearby (within 10 lines)
      const startLine = Math.max(0, lineNum - 5);
      const endLine = Math.min(lines.length, lineNum + 5);
      const nearbyCode = lines.slice(startLine, endLine).join('\n');
      const hasNearbyAssert = nearbyCode.includes('expect(') || nearbyCode.includes('assert(');

      if (!hasNearbyAssert) {
        weaknesses.push({
          id: 'SOFT_ASSERTION',
          severity: 'WARN',
          message: `${label} at line ${lineNum} without a nearby hard assertion`,
          detail: 'Warnings without expect()/assert() calls mean failures get logged but the test still passes',
          line: lineNum,
        });
      }
    }
  }

  // ---- CHECK 7: all_passed used as sole gate ----

  const allPassedChecks = source.match(/all_passed/g) || [];
  if (allPassedChecks.length > 0) {
    // Check if all_passed is used in an assertion
    const allPassedAssert =
      source.includes("expect(proof.all_passed") ||
      source.includes("expect(result.all_passed") ||
      source.includes("assert(proof.all_passed") ||
      source.includes("assert(result.all_passed") ||
      source.includes("all_passed === true");

    if (allPassedAssert) {
      weaknesses.push({
        id: 'ALL_PASSED_ONLY_GATE',
        severity: 'WARN',
        message: 'Test appears to use all_passed as an assertion gate',
        detail: 'If the only check is "all_passed === true", the test is trusting the proof artifact rather than independently verifying quality. Ensure independent structural checks also run.',
      });
    }
  }

  // ---- CHECK 8: Minimum query count ----

  // Count distinct query/intent definitions
  const queryIntentMatches = source.match(/intent:\s*['"`]/g) || [];
  if (queryIntentMatches.length < CONFIG.MIN_QUERY_COUNT) {
    weaknesses.push({
      id: 'TOO_FEW_INTENTS',
      severity: 'FAIL',
      message: `Only ${queryIntentMatches.length} query intents found (minimum: ${CONFIG.MIN_QUERY_COUNT})`,
      detail: 'A meaningful proof test needs enough distinct queries to detect whether the system actually discriminates between intents',
    });
  }

  // ---- CHECK 9: Test must write proof artifact ----

  const writesProof =
    source.includes('self-dev-proof.json') ||
    source.includes('proof.json') ||
    source.includes('writeFile');

  if (!writesProof) {
    weaknesses.push({
      id: 'NO_PROOF_ARTIFACT_WRITE',
      severity: 'FAIL',
      message: 'Test does not appear to write a proof artifact',
      detail: 'Proof tests must write a machine-readable artifact that can be validated by proof-review-gate.mjs',
    });
  }

  // ---- CHECK 10: quality_issues computed and included ----

  const computesQualityIssues =
    source.includes('quality_issues') ||
    source.includes('qualityIssues');

  if (!computesQualityIssues) {
    weaknesses.push({
      id: 'NO_QUALITY_ISSUES_COMPUTED',
      severity: 'FAIL',
      message: 'Test does not compute a quality_issues array',
      detail: 'The proof artifact must include a quality_issues array so the proof-review-gate can verify it is empty',
    });
  }

  return weaknesses;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(filePath, weaknesses) {
  const failures = weaknesses.filter((w) => w.severity === 'FAIL');
  const warnings = weaknesses.filter((w) => w.severity === 'WARN');

  console.log('');
  console.log('='.repeat(72));
  console.log(`ADVERSARIAL PROOF VALIDATOR: ${filePath}`);
  console.log('='.repeat(72));

  if (weaknesses.length === 0) {
    console.log('');
    console.log('  PASS: No test rigor weaknesses detected.');
    console.log('');
    console.log('='.repeat(72));
    return;
  }

  if (failures.length > 0) {
    console.log('');
    console.log(`  WEAKNESSES FOUND (${failures.length} failures, ${warnings.length} warnings):`);
    console.log('');

    for (const w of failures) {
      const loc = w.line ? ` (line ${w.line})` : '';
      console.log(`  [FAIL] ${w.id}${loc}`);
      console.log(`         ${w.message}`);
      if (w.detail) {
        for (const line of w.detail.split('\n')) {
          console.log(`         ${line}`);
        }
      }
      console.log('');
    }
  }

  if (warnings.length > 0) {
    for (const w of warnings) {
      const loc = w.line ? ` (line ${w.line})` : '';
      console.log(`  [WARN] ${w.id}${loc}`);
      console.log(`         ${w.message}`);
      if (w.detail) {
        for (const line of w.detail.split('\n')) {
          console.log(`         ${line}`);
        }
      }
      console.log('');
    }
  }

  console.log('-'.repeat(72));
  console.log(`  SUMMARY: ${failures.length} failure(s), ${warnings.length} warning(s)`);
  if (failures.length > 0) {
    console.log('  VERDICT: TEST IS TOO EASY TO GAME -- strengthen the assertions');
  } else {
    console.log('  VERDICT: Test has minor rigor concerns -- review warnings');
  }
  console.log('='.repeat(72));
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage:');
    console.log('  node scripts/adversarial-proof-validator.mjs <test-file-path> [<test-file-path>...]');
    console.log('');
    console.log('Validates that a proof test is rigorous enough to catch real failures.');
    console.log('Reads the test SOURCE CODE and checks for structural weaknesses.');
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  let totalFailures = 0;

  for (const filePath of args) {
    if (filePath.startsWith('--')) continue;

    const resolvedPath = path.resolve(filePath);
    let source;
    try {
      source = await fs.readFile(resolvedPath, 'utf8');
    } catch (err) {
      console.error(`[adversarial-proof-validator] Cannot read ${resolvedPath}: ${err.message}`);
      totalFailures++;
      continue;
    }

    const weaknesses = analyzeTestSource(source, resolvedPath);
    printReport(resolvedPath, weaknesses);

    const failures = weaknesses.filter((w) => w.severity === 'FAIL');
    totalFailures += failures.length;
  }

  if (totalFailures > 0) {
    console.error(`[adversarial-proof-validator] ${totalFailures} weakness(es) found. Test is gameable.`);
    process.exit(1);
  }

  console.log('[adversarial-proof-validator] All proof tests passed adversarial review.');
  process.exit(0);
}

main().catch((error) => {
  console.error(`[adversarial-proof-validator] Fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
