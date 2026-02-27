#!/usr/bin/env node

/**
 * @fileoverview Proof Review Gate
 *
 * Structural validator for milestone proof artifacts. Catches the class of
 * false-pass bugs where:
 *   1. Tests checked plumbing (exit code 0) but not product quality
 *   2. Substring matching was too broad to actually fail
 *   3. Nobody read the results -- just checked `all_passed: true`
 *   4. The same person wrote the fix and the acceptance test
 *
 * Runs a battery of adversarial structural checks against a proof JSON.
 * Exits non-zero if ANY red flag fires.
 *
 * Usage:
 *   node scripts/proof-review-gate.mjs state/m0/self-dev-proof.json
 *   node scripts/proof-review-gate.mjs --all   (scan all proof artifacts under state/)
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Configuration — these thresholds are intentionally strict
// ---------------------------------------------------------------------------

const CONFIG = {
  /** Minimum distinct base files across ALL query results combined */
  MIN_TOTAL_DISTINCT_FILES: 6,
  /** If a single file appears in more than this fraction of result sets, flag it */
  MAX_FILE_APPEARANCE_RATIO: 0.5,
  /** mustInclude patterns shorter than this are suspiciously broad */
  MIN_PATTERN_LENGTH: 8,
  /** Maximum Jaccard similarity between any pair of result sets */
  MAX_JACCARD_SIMILARITY: 0.5,
  /** Minimum unique base files per individual query result */
  MIN_FILES_PER_RESULT: 3,
  /** Minimum number of queries for a proof to be meaningful */
  MIN_QUERIES: 2,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the base file path, stripping function-level suffixes.
 * E.g. "src/foo.ts:myFunction" -> "src/foo.ts"
 */
function toBaseFilePath(p) {
  const match = p.match(/^(.+\.\w+):/);
  return match ? match[1] : p;
}

/**
 * Compute Jaccard similarity between two Sets.
 */
function jaccardSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Locate all proof artifacts under state/.
 */
async function findProofArtifacts(root) {
  const stateDir = path.join(root, 'state');
  const artifacts = [];

  try {
    const entries = await fs.readdir(stateDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const proofPath = path.join(stateDir, entry.name, 'self-dev-proof.json');
      try {
        await fs.access(proofPath);
        artifacts.push(proofPath);
      } catch {
        // no proof artifact in this subdirectory
      }
    }
  } catch {
    // state/ does not exist
  }

  return artifacts;
}

// ---------------------------------------------------------------------------
// Red flag checks
// ---------------------------------------------------------------------------

/**
 * @typedef {{ id: string, severity: 'FAIL' | 'WARN', message: string, detail?: string }} RedFlag
 */

function checkProofArtifact(proof, filePath) {
  /** @type {RedFlag[]} */
  const flags = [];

  // ---- STRUCTURAL: is this even a real proof? ----

  if (!proof || typeof proof !== 'object') {
    flags.push({
      id: 'INVALID_JSON',
      severity: 'FAIL',
      message: 'Proof artifact is not a valid JSON object',
    });
    return flags;
  }

  if (!Array.isArray(proof.results) || proof.results.length === 0) {
    flags.push({
      id: 'NO_RESULTS',
      severity: 'FAIL',
      message: 'Proof artifact has no results array or it is empty',
    });
    return flags;
  }

  // ---- CHECK 1: Minimum query count ----

  if (proof.results.length < CONFIG.MIN_QUERIES) {
    flags.push({
      id: 'TOO_FEW_QUERIES',
      severity: 'FAIL',
      message: `Only ${proof.results.length} queries in proof (minimum: ${CONFIG.MIN_QUERIES})`,
      detail: 'A meaningful proof requires testing multiple distinct intents',
    });
  }

  // ---- CHECK 2: Total distinct files across all results ----

  const allBaseFiles = new Set();
  for (const result of proof.results) {
    const files = result.baseFiles || result.files || [];
    for (const f of files) {
      allBaseFiles.add(toBaseFilePath(f));
    }
  }

  if (allBaseFiles.size < CONFIG.MIN_TOTAL_DISTINCT_FILES) {
    flags.push({
      id: 'TOO_FEW_DISTINCT_FILES',
      severity: 'FAIL',
      message: `Only ${allBaseFiles.size} distinct base files across all results (minimum: ${CONFIG.MIN_TOTAL_DISTINCT_FILES})`,
      detail: `Files found: ${Array.from(allBaseFiles).join(', ')}`,
    });
  }

  // ---- CHECK 3: Single file dominance ----

  const fileAppearances = new Map();
  const resultSets = [];

  for (const result of proof.results) {
    const files = result.baseFiles || result.files || [];
    const baseSet = new Set(files.map(toBaseFilePath));
    resultSets.push({ label: result.label, set: baseSet });

    for (const bf of baseSet) {
      fileAppearances.set(bf, (fileAppearances.get(bf) || 0) + 1);
    }
  }

  const totalResults = proof.results.length;
  const dominanceThreshold = Math.max(2, Math.ceil(totalResults * CONFIG.MAX_FILE_APPEARANCE_RATIO));

  for (const [file, count] of fileAppearances) {
    if (count > dominanceThreshold) {
      flags.push({
        id: 'FILE_DOMINANCE',
        severity: 'FAIL',
        message: `"${file}" appears in ${count}/${totalResults} result sets (max allowed: ${dominanceThreshold})`,
        detail: 'A single file appearing in most result sets suggests the query pipeline is returning the same files regardless of intent',
      });
    }
  }

  // Also flag if >50% of result sets share ANY single file even at lower thresholds
  const halfThreshold = Math.ceil(totalResults * 0.5);
  const filesInMajority = Array.from(fileAppearances.entries())
    .filter(([, count]) => count >= halfThreshold)
    .map(([file]) => file);

  if (filesInMajority.length > 0 && totalResults >= 3) {
    // Only flag if not already caught by dominance check
    for (const file of filesInMajority) {
      const count = fileAppearances.get(file);
      if (count <= dominanceThreshold) {
        flags.push({
          id: 'FILE_DOMINANCE_SOFT',
          severity: 'WARN',
          message: `"${file}" appears in ${count}/${totalResults} result sets (>= 50%)`,
          detail: 'Consider whether this file is genuinely relevant to all queries',
        });
      }
    }
  }

  // ---- CHECK 4: mustInclude patterns that are suspiciously broad ----

  for (const result of proof.results) {
    // Check the actual proof artifact for stored mustInclude (if present in query defs)
    // Also check if the matchedPattern looks suspiciously broad
    if (result.matchedPattern) {
      // Extract the pattern from "filename matched "pattern"" format
      const patternMatch = result.matchedPattern.match(/matched "(.+)"$/);
      if (patternMatch) {
        const pattern = patternMatch[1];
        if (pattern.length < CONFIG.MIN_PATTERN_LENGTH) {
          flags.push({
            id: 'BROAD_MATCH_PATTERN',
            severity: 'FAIL',
            message: `[${result.label}] Matched pattern "${pattern}" is only ${pattern.length} chars (minimum: ${CONFIG.MIN_PATTERN_LENGTH})`,
            detail: 'Short patterns like single words match too many files to be meaningful verification',
          });
        }
      }
    }
  }

  // ---- CHECK 5: Jaccard similarity between result pairs ----

  for (let i = 0; i < resultSets.length; i++) {
    for (let j = i + 1; j < resultSets.length; j++) {
      const similarity = jaccardSimilarity(resultSets[i].set, resultSets[j].set);
      if (similarity > CONFIG.MAX_JACCARD_SIMILARITY) {
        flags.push({
          id: 'HIGH_JACCARD_SIMILARITY',
          severity: 'FAIL',
          message: `Result sets "${resultSets[i].label}" and "${resultSets[j].label}" have Jaccard similarity ${(similarity * 100).toFixed(1)}% (max: ${(CONFIG.MAX_JACCARD_SIMILARITY * 100).toFixed(0)}%)`,
          detail: 'High similarity between different query intents means the system returns the same files regardless of what you ask',
        });
      }
    }
  }

  // ---- CHECK 6: quality_issues array ----

  if (!('quality_issues' in proof)) {
    flags.push({
      id: 'MISSING_QUALITY_ISSUES',
      severity: 'FAIL',
      message: 'Proof artifact has no quality_issues array',
      detail: 'The proof test must compute quality_issues and include them in the artifact. An artifact without this field was likely generated by a test that did not check quality.',
    });
  } else if (!Array.isArray(proof.quality_issues)) {
    flags.push({
      id: 'INVALID_QUALITY_ISSUES',
      severity: 'FAIL',
      message: 'quality_issues is not an array',
    });
  } else if (proof.quality_issues.length > 0) {
    flags.push({
      id: 'QUALITY_ISSUES_NOT_EMPTY',
      severity: 'FAIL',
      message: `quality_issues array has ${proof.quality_issues.length} issue(s)`,
      detail: proof.quality_issues.map((issue, i) => `  ${i + 1}. ${issue}`).join('\n'),
    });
  }

  // ---- CHECK 7: Per-result minimum file count ----

  for (const result of proof.results) {
    const files = result.baseFiles || result.files || [];
    const baseFiles = new Set(files.map(toBaseFilePath));

    if (baseFiles.size < CONFIG.MIN_FILES_PER_RESULT) {
      flags.push({
        id: 'TOO_FEW_FILES_IN_RESULT',
        severity: 'FAIL',
        message: `[${result.label}] Only ${baseFiles.size} unique base files (minimum: ${CONFIG.MIN_FILES_PER_RESULT})`,
        detail: `Files: ${Array.from(baseFiles).join(', ')}`,
      });
    }
  }

  // ---- CHECK 8: all_passed must be consistent with quality_issues ----

  if (proof.all_passed === true && Array.isArray(proof.quality_issues) && proof.quality_issues.length > 0) {
    flags.push({
      id: 'INCONSISTENT_PASS',
      severity: 'FAIL',
      message: 'all_passed is true but quality_issues is non-empty',
      detail: 'This is the exact false-pass scenario: the test said "pass" while recording known quality problems',
    });
  }

  // ---- CHECK 9: cross_query_metrics must exist ----

  if (!proof.cross_query_metrics) {
    flags.push({
      id: 'MISSING_CROSS_QUERY_METRICS',
      severity: 'FAIL',
      message: 'Proof artifact has no cross_query_metrics object',
      detail: 'The proof test must compute and record cross-query diversity metrics (dominant files, Jaccard pairs)',
    });
  } else {
    if (!Array.isArray(proof.cross_query_metrics.jaccard_pairs)) {
      flags.push({
        id: 'MISSING_JACCARD_PAIRS',
        severity: 'FAIL',
        message: 'cross_query_metrics.jaccard_pairs is missing or not an array',
      });
    }
    if (!Array.isArray(proof.cross_query_metrics.dominant_files)) {
      flags.push({
        id: 'MISSING_DOMINANT_FILES',
        severity: 'FAIL',
        message: 'cross_query_metrics.dominant_files is missing or not an array',
      });
    }
  }

  // ---- CHECK 10: mustIncludeMatched must exist on results ----

  for (const result of proof.results) {
    if (!('mustIncludeMatched' in result)) {
      flags.push({
        id: 'MISSING_MUST_INCLUDE_MATCHED',
        severity: 'FAIL',
        message: `[${result.label}] Result has no mustIncludeMatched field`,
        detail: 'Without mustIncludeMatched, we cannot verify that the query returned the RIGHT files',
      });
    } else if (result.mustIncludeMatched !== true) {
      flags.push({
        id: 'MUST_INCLUDE_NOT_MATCHED',
        severity: 'FAIL',
        message: `[${result.label}] mustIncludeMatched is ${result.mustIncludeMatched}`,
        detail: 'The query did not return any of its expected files',
      });
    }
  }

  // ---- CHECK 11: Timestamp freshness (proof should be recent, not stale) ----

  if (proof.timestamp) {
    const proofDate = new Date(proof.timestamp);
    const ageMs = Date.now() - proofDate.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > 7) {
      flags.push({
        id: 'STALE_PROOF',
        severity: 'WARN',
        message: `Proof artifact is ${ageDays.toFixed(1)} days old (generated ${proof.timestamp})`,
        detail: 'Consider re-running the proof test to ensure it still passes with current code',
      });
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(filePath, flags) {
  const failures = flags.filter((f) => f.severity === 'FAIL');
  const warnings = flags.filter((f) => f.severity === 'WARN');

  console.log('');
  console.log('='.repeat(72));
  console.log(`PROOF REVIEW GATE: ${filePath}`);
  console.log('='.repeat(72));

  if (flags.length === 0) {
    console.log('');
    console.log('  PASS: No structural red flags detected.');
    console.log('');
    console.log('='.repeat(72));
    return;
  }

  if (failures.length > 0) {
    console.log('');
    console.log(`  FAILURES (${failures.length}):`);
    console.log('');
    for (const flag of failures) {
      console.log(`  [FAIL] ${flag.id}`);
      console.log(`         ${flag.message}`);
      if (flag.detail) {
        for (const line of flag.detail.split('\n')) {
          console.log(`         ${line}`);
        }
      }
      console.log('');
    }
  }

  if (warnings.length > 0) {
    console.log(`  WARNINGS (${warnings.length}):`);
    console.log('');
    for (const flag of warnings) {
      console.log(`  [WARN] ${flag.id}`);
      console.log(`         ${flag.message}`);
      if (flag.detail) {
        for (const line of flag.detail.split('\n')) {
          console.log(`         ${line}`);
        }
      }
      console.log('');
    }
  }

  console.log('-'.repeat(72));
  console.log(`  SUMMARY: ${failures.length} failure(s), ${warnings.length} warning(s)`);
  if (failures.length > 0) {
    console.log('  VERDICT: BLOCKED -- fix the failures before declaring this milestone passed');
  } else {
    console.log('  VERDICT: PASS with warnings -- review the warnings');
  }
  console.log('='.repeat(72));
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const root = process.cwd();
  let filePaths = [];

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage:');
    console.log('  node scripts/proof-review-gate.mjs <proof-json-path> [<proof-json-path>...]');
    console.log('  node scripts/proof-review-gate.mjs --all');
    console.log('');
    console.log('Options:');
    console.log('  --all     Scan all state/*/self-dev-proof.json files');
    console.log('  --help    Show this help message');
    process.exit(0);
  }

  if (args.includes('--all')) {
    filePaths = await findProofArtifacts(root);
    if (filePaths.length === 0) {
      console.error('[proof-review-gate] No proof artifacts found under state/');
      process.exit(1);
    }
  } else if (args.length === 0) {
    console.error('[proof-review-gate] No proof artifact path provided. Use --all or provide a path.');
    console.error('Usage: node scripts/proof-review-gate.mjs state/m0/self-dev-proof.json');
    process.exit(1);
  } else {
    filePaths = args.filter((a) => !a.startsWith('--'));
  }

  let totalFailures = 0;

  for (const filePath of filePaths) {
    const resolvedPath = path.resolve(filePath);
    let raw;
    try {
      raw = await fs.readFile(resolvedPath, 'utf8');
    } catch (err) {
      console.error(`[proof-review-gate] Cannot read ${resolvedPath}: ${err.message}`);
      totalFailures++;
      continue;
    }

    let proof;
    try {
      proof = JSON.parse(raw);
    } catch (err) {
      console.error(`[proof-review-gate] Invalid JSON in ${resolvedPath}: ${err.message}`);
      totalFailures++;
      continue;
    }

    const flags = checkProofArtifact(proof, resolvedPath);
    printReport(resolvedPath, flags);

    const failures = flags.filter((f) => f.severity === 'FAIL');
    totalFailures += failures.length;
  }

  if (totalFailures > 0) {
    console.error(`[proof-review-gate] ${totalFailures} failure(s) detected. Proof is NOT credible.`);
    process.exit(1);
  }

  console.log('[proof-review-gate] All proof artifacts passed structural review.');
  process.exit(0);
}

main().catch((error) => {
  console.error(`[proof-review-gate] Fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
