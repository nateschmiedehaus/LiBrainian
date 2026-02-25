#!/usr/bin/env node
/**
 * Agent Patrol: Free-form agentic E2E testing for LiBrainian.
 *
 * Deploys a real Claude Code agent onto real projects with LiBrainian installed
 * from the current branch, lets it work naturally, and extracts qualitative signal.
 *
 * Usage:
 *   node scripts/agent-patrol.mjs [options]
 *     --mode quick|full|release        (default: quick)
 *     --repo <name>                    target specific repo from manifest
 *     --max-repos <n>                  override repo count
 *     --timeout-ms <n>                 per-repo agent timeout
 *     --keep                           keep sandbox after run
 *     --artifact <path>                output path for report JSON
 *     --no-issues                      skip GH issue creation intent
 *     --agent-bin <path>               agent binary (default: auto-detect)
 *     --interactive, -i                pause between sandbox stages for manual inspection
 *
 * Storage hygiene controls (env):
 *   LIBRARIAN_PATROL_MAX_STORAGE_GIB      total retained transient storage cap (default: 20)
 *   LIBRARIAN_PATROL_MAX_ARTIFACT_AGE_HOURS max artifact age before deletion (default: 24)
 *   LIBRARIAN_PATROL_MAX_STORAGE_ENTRIES  max retained transient entries (default: 64)
 */

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const REPO_ROOT = process.cwd();
const MANIFEST_PATH = path.join(REPO_ROOT, 'eval-corpus/external-repos/manifest.json');
const PROMPT_TEMPLATE_PATH = path.join(REPO_ROOT, 'scripts/patrol-agent-prompt.md');
const CHILD_OUTPUT_MAX_CHARS = 200_000;
const OBS_START = 'PATROL_OBSERVATION_JSON_START';
const OBS_END = 'PATROL_OBSERVATION_JSON_END';

const MODE_DEFAULTS = {
  quick:   { maxRepos: 1, timeoutMs: 2_400_000 },  // 40 min per repo -- agent needs time to finish
  full:    { maxRepos: 5, timeoutMs: 3_600_000 },   // 60 min per repo -- full depth
  release: { maxRepos: 8, timeoutMs: 3_600_000 },   // 60 min per repo -- full depth
};

const TASK_VARIANTS = ['explore', 'guided', 'construction'];

const PATROL_POLICY_KIND = 'PatrolPolicyEnforcementArtifact.v1';
const BYTES_PER_GIB = 1024 ** 3;
const HOURS_TO_MS = 60 * 60 * 1000;

function parsePositiveNumber(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseStoragePolicyFromEnv(env = process.env) {
  const maxStorageGiB = parsePositiveNumber(env.LIBRARIAN_PATROL_MAX_STORAGE_GIB, 20);
  const maxArtifactAgeHours = parsePositiveNumber(env.LIBRARIAN_PATROL_MAX_ARTIFACT_AGE_HOURS, 24);
  const maxEntries = Math.floor(parsePositiveNumber(env.LIBRARIAN_PATROL_MAX_STORAGE_ENTRIES, 64));
  return {
    maxStorageBytes: Math.floor(maxStorageGiB * BYTES_PER_GIB),
    maxArtifactAgeMs: Math.floor(maxArtifactAgeHours * HOURS_TO_MS),
    maxEntries,
  };
}

const STORAGE_POLICY = parseStoragePolicyFromEnv();

function estimatePathBytes(targetPath) {
  try {
    const output = run('du', ['-sk', targetPath]);
    const kib = Number(output.split(/\s+/)[0] ?? '0');
    if (!Number.isFinite(kib) || kib < 0) {
      return 0;
    }
    return Math.floor(kib * 1024);
  } catch {
    return 0;
  }
}

function isProtectedPath(entryPath, protectedPaths) {
  for (const protectedPath of protectedPaths) {
    if (entryPath === protectedPath || entryPath.startsWith(`${protectedPath}${path.sep}`)) {
      return true;
    }
  }
  return false;
}

function sortByOldest(entries) {
  return [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
}

export function selectStorageEntriesForDeletion(
  entries,
  policy = STORAGE_POLICY,
  nowMs = Date.now(),
) {
  const candidates = entries.filter((entry) => !entry.protected);
  const marked = [];
  const survivors = [];
  for (const entry of sortByOldest(candidates)) {
    const ageMs = Math.max(0, nowMs - entry.mtimeMs);
    if (ageMs > policy.maxArtifactAgeMs) {
      marked.push(entry);
    } else {
      survivors.push(entry);
    }
  }

  let totalBytes = survivors.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  let totalCount = survivors.length;
  for (const entry of sortByOldest(survivors)) {
    if (totalBytes <= policy.maxStorageBytes && totalCount <= policy.maxEntries) {
      break;
    }
    marked.push(entry);
    totalBytes -= entry.sizeBytes;
    totalCount -= 1;
  }
  return marked;
}

async function collectStorageEntries(policy = STORAGE_POLICY, protectedPaths = new Set()) {
  const entries = [];
  const roots = [
    { dir: path.join(REPO_ROOT, '.patrol-tmp'), kind: 'sandbox' },
    { dir: path.join(REPO_ROOT, '.tmp', 'librainian'), kind: 'tmp' },
    { dir: path.join(REPO_ROOT, '.tmp', 'librarian'), kind: 'tmp' },
  ];

  for (const root of roots) {
    let dirEntries = [];
    try {
      dirEntries = await fs.readdir(root.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirEntry of dirEntries) {
      const targetPath = path.join(root.dir, dirEntry.name);
      const stat = await fs.stat(targetPath).catch(() => null);
      if (!stat) continue;
      entries.push({
        path: targetPath,
        kind: root.kind,
        mtimeMs: stat.mtimeMs,
        sizeBytes: estimatePathBytes(targetPath),
        protected: isProtectedPath(targetPath, protectedPaths),
      });
    }
  }

  let rootFiles = [];
  try {
    rootFiles = await fs.readdir(REPO_ROOT, { withFileTypes: true });
  } catch {
    rootFiles = [];
  }
  for (const dirEntry of rootFiles) {
    if (!dirEntry.isFile()) continue;
    if (!/^librainian-.*\.tgz$/i.test(dirEntry.name)) continue;
    const targetPath = path.join(REPO_ROOT, dirEntry.name);
    const stat = await fs.stat(targetPath).catch(() => null);
    if (!stat) continue;
    entries.push({
      path: targetPath,
      kind: 'tarball',
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
      protected: isProtectedPath(targetPath, protectedPaths),
    });
  }

  return entries;
}

async function enforceStorageHygiene(phase, protectedPaths = new Set(), policy = STORAGE_POLICY) {
  const entries = await collectStorageEntries(policy, protectedPaths);
  const beforeBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  const staleEntries = selectStorageEntriesForDeletion(entries, policy);

  let removedBytes = 0;
  let removedCount = 0;
  for (const entry of staleEntries) {
    await fs.rm(entry.path, { recursive: true, force: true }).catch(() => {});
    removedBytes += entry.sizeBytes;
    removedCount += 1;
  }

  const remainingEntries = await collectStorageEntries(policy, protectedPaths);
  const afterBytes = remainingEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0);

  return {
    phase,
    policy,
    beforeBytes,
    afterBytes,
    removedBytes,
    removedCount,
    entryCount: remainingEntries.length,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    stdio: opts.stdio ?? 'pipe',
    shell: false,
    env: opts.env ?? process.env,
  });
  if (result.status !== 0) {
    const stdout = result.stdout?.trim() ?? '';
    const stderr = result.stderr?.trim() ?? '';
    const output = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${output ? `\n${output}` : ''}`);
  }
  return result.stdout?.trim() ?? '';
}

function requiredEvidenceModeForMode(mode) {
  if (mode === 'release') return 'wet';
  if (mode === 'full') return 'mixed';
  return 'dry';
}

function inferObservedEvidenceMode(runs) {
  const successfulRuns = runs.filter((run) => run.agentExitCode === 0);
  if (successfulRuns.length === 0) return 'none';
  const withObservations = successfulRuns.filter(
    (run) => run.observations && run.timedOut !== true
  );
  if (withObservations.length === successfulRuns.length) return 'wet';
  if (withObservations.length > 0) return 'mixed';
  return 'none';
}

function evidenceSatisfiesRequiredMode(required, observed) {
  if (required === 'dry') return observed !== 'none';
  if (required === 'mixed') return observed === 'mixed' || observed === 'wet';
  return observed === 'wet';
}

export function evaluatePatrolPolicyGate(mode, runs) {
  const requiredEvidenceMode = requiredEvidenceModeForMode(mode);
  const observedEvidenceMode = inferObservedEvidenceMode(runs);
  const failClosed = requiredEvidenceMode !== 'dry';
  const sufficientEvidence = evidenceSatisfiesRequiredMode(
    requiredEvidenceMode,
    observedEvidenceMode,
  );
  const enforcement = failClosed && !sufficientEvidence ? 'blocked' : 'allowed';

  return {
    kind: PATROL_POLICY_KIND,
    schemaVersion: 1,
    mode,
    requiredEvidenceMode,
    observedEvidenceMode,
    failClosed,
    enforcement,
    reason: enforcement === 'blocked'
      ? `wet-testing policy fail-closed: required=${requiredEvidenceMode} observed=${observedEvidenceMode}`
      : `wet-testing policy satisfied: required=${requiredEvidenceMode} observed=${observedEvidenceMode}`,
  };
}

// ---------------------------------------------------------------------------
// Patrol + internal model resolution
// ---------------------------------------------------------------------------
// Patrol quality is sensitive to model capability. For Codex:
// - Patrol agent model: latest available medium tier
// - LiBrainian internal indexing/synthesis model: absolute cheapest available
// Embeddings stay local xenova (free).

// Models that must NEVER be used for patrol runs (too expensive).
// If the resolved model matches any of these, we refuse to proceed.
const BLOCKED_EXPENSIVE_MODELS = [
  'opus', 'sonnet',                         // Claude tier aliases
  'claude-opus', 'claude-sonnet',            // Partial matches
  'o3', 'o1', 'gpt-5',                      // OpenAI expensive tiers (non-mini)
];

function isBlockedModel(model, provider) {
  if (!model) return false;
  const lower = model.toLowerCase();
  if (provider === 'codex' && lower.includes('codex-medium')) return false;
  // Block if it matches an expensive tier AND is not a mini/haiku variant
  if (lower.includes('mini') || lower.includes('haiku')) return false;
  return BLOCKED_EXPENSIVE_MODELS.some((b) => lower.includes(b));
}

function pickNewest(models) {
  if (!models || models.length === 0) return null;
  return [...models].sort((a, b) => b.localeCompare(a))[0] ?? null;
}

export function resolveCheapestModels(agentBin, options = {}) {
  const basename = path.basename(agentBin);
  const isCodex = basename === 'codex' || basename.startsWith('codex');

  const result = {
    llmProvider: isCodex ? 'codex' : 'claude',
    llmModel: null,
    embeddingModel: 'all-MiniLM-L6-v2',
    embeddingProvider: 'xenova',
  };

  if (isCodex) {
    // Read codex models cache:
    // - patrol model => latest medium tier
    // - internal model => cheapest available tier
    const homeDir = options.homeDir ?? os.homedir();
    const cachePath = path.join(homeDir, '.codex', 'models_cache.json');
    try {
      const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
      const models = cache.models ?? [];
      const slugs = models
        .map((m) => String(m?.slug ?? '').trim())
        .filter(Boolean);

      const mediumModels = slugs.filter((slug) => slug.includes('medium'));
      const miniModels = slugs.filter((slug) => slug.includes('mini'));
      const lowModels = slugs.filter((slug) => slug.includes('low'));
      const sparkModels = slugs.filter((slug) => slug.includes('spark'));

      result.llmModel = pickNewest(mediumModels) ?? 'gpt-5-codex-medium';
      result.internalLlmModel =
        pickNewest(miniModels)
        ?? pickNewest(lowModels)
        ?? pickNewest(sparkModels)
        ?? 'gpt-5-codex-mini';
    } catch {
      result.llmModel = 'gpt-5-codex-medium';
      result.internalLlmModel = 'gpt-5-codex-mini';
    }
  } else {
    // Claude pricing (Feb 2026):
    //   Haiku 3:   $0.25/MTok in, $1.25/MTok out (deprecated, retires April 2026)
    //   Haiku 3.5: $0.80/MTok in, $4/MTok out
    //   Haiku 4.5: $1.00/MTok in, $5/MTok out
    // For the agent CLI (needs tool use), we use 'haiku' alias (resolves to 4.5).
    // For LiBrainian's internal API calls (simple synthesis), we use the cheapest.
    result.llmModel = 'haiku';
    // LiBrainian internal calls can use the absolute cheapest
    result.internalLlmModel = 'claude-3-haiku-20240307';
  }

  // Safety check: refuse to proceed if resolved model is expensive
  if (isBlockedModel(result.llmModel, result.llmProvider)) {
    throw new Error(
      `resolved model '${result.llmModel}' is on the blocked expensive list. ` +
      `Patrol must use the cheapest available model. ` +
      `Override with LIBRARIAN_LLM_MODEL env var if this is intentional.`
    );
  }

  return result;
}

/**
 * Build environment variables that force LiBrainian internal operations to use
 * the cheapest available model while patrol keeps its selected agent model.
 */
export function buildCheapModelEnv(cheapModels) {
  return {
    LIBRARIAN_LLM_PROVIDER: cheapModels.llmProvider,
    // Use the internal model for LiBrainian's API calls (can be cheaper than
    // the agent model, which needs full tool-use capability)
    LIBRARIAN_LLM_MODEL: cheapModels.internalLlmModel ?? cheapModels.llmModel,
    LIBRARIAN_EMBEDDING_MODEL: cheapModels.embeddingModel,
    LIBRARIAN_EMBEDDING_PROVIDER: cheapModels.embeddingProvider,
    // Cross-encoder is LOCAL (xenova/ms-marco-MiniLM) -- no API calls, so keep it enabled
    // for better retrieval quality at zero extra cost.
  };
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function getCommitSha() {
  try {
    return run('git', ['rev-parse', '--short', 'HEAD']);
  } catch {
    return 'unknown';
  }
}

function selectRepos(manifest, opts) {
  let repos = manifest.repos ?? [];

  // If a specific repo is requested, filter to it
  if (opts.repo) {
    repos = repos.filter((r) => r.name === opts.repo);
    if (repos.length === 0) {
      throw new Error(`repo '${opts.repo}' not found in manifest`);
    }
    return repos;
  }

  // For quick mode, pick a random repo
  if (opts.mode === 'quick') {
    const shuffled = [...repos].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, opts.maxRepos);
  }

  // For full/release, use language-diversity-weighted rotation
  const seen = new Set();
  const selected = [];
  // First pass: one per language
  for (const repo of repos) {
    const lang = repo.language ?? 'unknown';
    if (!seen.has(lang)) {
      seen.add(lang);
      selected.push(repo);
    }
    if (selected.length >= opts.maxRepos) break;
  }
  // Second pass: fill remaining slots
  if (selected.length < opts.maxRepos) {
    for (const repo of repos) {
      if (!selected.includes(repo)) {
        selected.push(repo);
      }
      if (selected.length >= opts.maxRepos) break;
    }
  }
  return selected;
}

function selectTaskVariant(index) {
  // Rotate through variants for diversity
  return TASK_VARIANTS[index % TASK_VARIANTS.length];
}

function buildPrompt(template, taskVariant, repoName) {
  let taskBlock;
  if (taskVariant === 'explore') {
    taskBlock = [
      '**Task: Understand this codebase using LiBrainian.**',
      '',
      '1. Run `librainian bootstrap` if needed, then `librainian status` to check health',
      '2. Use `librainian query` to ask 3+ questions about the codebase architecture, key modules, and how things connect',
      '3. Use `librainian context` to get focused context on at least one topic',
      '4. Run at least 1 construction via `librainian constructions run <id>`',
      '5. Try discovering available constructions via `librainian constructions list`',
      '6. Form an opinion on whether LiBrainian actually helped you understand the codebase better than just reading files',
    ].join('\n');
  } else if (taskVariant === 'construction') {
    taskBlock = [
      '**Task: Exercise the construction system thoroughly.**',
      '',
      '1. Run `librainian constructions list` to discover available constructions',
      '2. Run at least 3 individual constructions via CLI',
      '3. Attempt to compose a multi-construction pipeline',
      '4. Evaluate whether construction outputs are coherent, useful, and accurate',
      '5. Assess the registry -- is discovery easy? Are descriptions clear?',
      '6. If possible, assess work presets by running the WorkPresetsConstruction',
    ].join('\n');
  } else {
    // guided -- generic task since we don't have repo-specific tasks
    taskBlock = [
      `**Task: Explore ${repoName} and find something to improve using LiBrainian for guidance.**`,
      '',
      '1. Use LiBrainian to understand the codebase structure',
      '2. Identify a small improvement (documentation, code quality, test coverage)',
      '3. Use LiBrainian constructions to validate your proposed changes',
      '4. Report on whether LiBrainian was genuinely helpful for this workflow',
    ].join('\n');
  }

  return template.replace('{{TASK_BLOCK}}', taskBlock).replace('{{GUIDED_TASK}}', '');
}

// ---------------------------------------------------------------------------
// Implicit signal detection
// ---------------------------------------------------------------------------
function detectImplicitSignals(rawOutput) {
  const signals = {
    usedGrepInstead: false,
    catInsteadOfContext: false,
    commandsFailed: 0,
    abortedEarly: false,
    timeoutRatio: 0,
  };

  // Check for grep/find/cat fallback patterns
  const grepPatterns = [/\bgrep\s+-[rRn]/i, /\brg\s+/i, /\bfind\s+\.\s+-name/i];
  for (const p of grepPatterns) {
    if (p.test(rawOutput)) {
      signals.usedGrepInstead = true;
      break;
    }
  }

  const catPatterns = [/\bcat\s+[^\|]+\.(ts|js|py|go|rs|java)/i, /\bhead\s+-n/i, /\btail\s+-n/i];
  for (const p of catPatterns) {
    if (p.test(rawOutput)) {
      signals.catInsteadOfContext = true;
      break;
    }
  }

  // Count command failures
  const failurePatterns = [
    /command not found/gi,
    /Error:/gi,
    /ENOENT/gi,
    /failed with exit code/gi,
  ];
  for (const p of failurePatterns) {
    const matches = rawOutput.match(p);
    if (matches) signals.commandsFailed += matches.length;
  }

  // Check for early abort indicators
  if (rawOutput.length < 500 && !rawOutput.includes(OBS_START)) {
    signals.abortedEarly = true;
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------
const INCREMENTAL_OBS_PREFIX = 'PATROL_OBS: ';

/**
 * Extract incremental observations (PATROL_OBS: {...} lines) from output.
 * These are lightweight, structured observations emitted as the agent works.
 * Even if the agent times out, we get partial observations.
 */
function extractIncrementalObs(rawOutput) {
  const obs = [];
  for (const line of rawOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(INCREMENTAL_OBS_PREFIX)) continue;
    const jsonPart = trimmed.slice(INCREMENTAL_OBS_PREFIX.length).trim();
    try {
      obs.push(JSON.parse(jsonPart));
    } catch {
      // Skip malformed incremental obs
    }
  }
  return obs;
}

/**
 * Assemble incremental observations into the full observation schema.
 * This produces a best-effort observation from whatever the agent reported.
 */
function assembleFromIncremental(incrementalObs) {
  if (incrementalObs.length === 0) return null;

  const result = {
    sessionSummary: 'Assembled from incremental observations',
    bootstrapExperience: { durationFeeling: 'unknown', errors: [], surprises: [] },
    featuresUsed: [],
    constructionsUsed: [],
    compositionsAttempted: [],
    registryExperience: { discoveryEasy: null, documentationClear: null, availabilityIssues: [], missingConstructions: [] },
    negativeFindingsMandatory: [],
    positiveFindings: [],
    implicitBehavior: { fellBackToGrep: false, ignoredResults: false, retriedAfterFailure: false, detail: '' },
    overallVerdict: { wouldRecommend: null, productionReady: null, biggestStrength: '', biggestWeakness: '', npsScore: 0 },
    npsImprovementRoadmap: null,
    pathTo10: null,
    fixRecommendations: [],
  };

  for (const obs of incrementalObs) {
    switch (obs.type) {
      case 'feature':
        result.featuresUsed.push({
          feature: obs.feature ?? 'unknown',
          intent: obs.intent ?? '',
          outcome: obs.outcome ?? '',
          quality: obs.quality ?? 'unknown',
          wouldUseAgain: obs.wouldUseAgain ?? null,
          notes: obs.notes ?? '',
        });
        break;
      case 'construction':
        result.constructionsUsed.push({
          constructionId: obs.id ?? obs.constructionId ?? 'unknown',
          invokedVia: obs.invokedVia ?? 'cli',
          inputSummary: obs.input ?? '',
          outputQuality: obs.quality ?? 'unknown',
          confidenceReturned: obs.confidence ?? null,
          confidenceAccurate: obs.confidenceAccurate ?? null,
          useful: obs.useful ?? null,
          notes: obs.notes ?? '',
        });
        break;
      case 'negative':
        result.negativeFindingsMandatory.push({
          category: obs.category ?? 'other',
          severity: obs.severity ?? 'medium',
          title: obs.title ?? 'Untitled finding',
          detail: obs.detail ?? '',
          reproducible: obs.reproducible ?? null,
          suggestedFix: obs.suggestedFix ?? '',
        });
        break;
      case 'positive':
        result.positiveFindings.push({
          feature: obs.feature ?? 'unknown',
          detail: obs.detail ?? '',
        });
        break;
      case 'implicit':
        if (obs.fellBackToGrep) result.implicitBehavior.fellBackToGrep = true;
        if (obs.ignoredResults) result.implicitBehavior.ignoredResults = true;
        if (obs.reason) result.implicitBehavior.detail += obs.reason + '; ';
        break;
      case 'verdict':
        result.overallVerdict = {
          wouldRecommend: obs.wouldRecommend ?? null,
          productionReady: obs.productionReady ?? null,
          biggestStrength: obs.biggestStrength ?? '',
          biggestWeakness: obs.biggestWeakness ?? '',
          npsScore: obs.npsScore ?? 0,
        };
        break;
      case 'bootstrap':
        result.bootstrapExperience = {
          durationFeeling: obs.durationFeeling ?? 'unknown',
          errors: obs.errors ?? [],
          surprises: obs.surprises ?? [],
        };
        break;
      case 'nps_roadmap':
        result.npsImprovementRoadmap = {
          currentNps: obs.currentNps ?? 0,
          targetNps: obs.targetNps ?? 0,
          changes: obs.changes ?? [],
          quickWins: obs.quickWins ?? [],
          hardButWorthIt: obs.hardButWorthIt ?? [],
        };
        break;
      case 'path_to_10':
        result.pathTo10 = {
          vision: obs.vision ?? '',
          missingCapabilities: obs.missingCapabilities ?? [],
          currentBlockers: obs.currentBlockers ?? [],
          delightFactors: obs.delightFactors ?? [],
          competitorComparison: obs.competitorComparison ?? '',
        };
        break;
      case 'recommendation':
        result.fixRecommendations.push({
          findingTitle: obs.findingTitle ?? '',
          fix: obs.fix ?? '',
          effort: obs.effort ?? 'unknown',
          npsImpact: obs.npsImpact ?? 0,
          priority: obs.priority ?? 'medium',
        });
        break;
    }
  }

  return result;
}

/**
 * Extract the full observation JSON (PATROL_OBSERVATION_JSON_START/END markers).
 * Falls back to assembling from incremental observations if not found.
 */
function extractObservation(rawOutput) {
  // Try full JSON first
  const startIdx = rawOutput.indexOf(OBS_START);
  const endIdx = rawOutput.indexOf(OBS_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    let jsonText = rawOutput.slice(startIdx + OBS_START.length, endIdx).trim();
    jsonText = jsonText.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
    try {
      return JSON.parse(jsonText);
    } catch (e) {
      console.error(`[patrol] full observation JSON parse error: ${e.message}`);
    }
  }

  // Fall back to incremental observations
  const incremental = extractIncrementalObs(rawOutput);
  if (incremental.length > 0) {
    console.log(`[patrol] assembling from ${incremental.length} incremental observations`);
    return assembleFromIncremental(incremental);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Sandbox lifecycle
// ---------------------------------------------------------------------------

/**
 * Wait for user to press Enter (for --interactive pause points).
 */
function waitForEnter(message) {
  return new Promise((resolve) => {
    process.stdout.write(`[patrol] ${message} -- press Enter to continue (or wait 10s)...`);
    const timeout = setTimeout(() => {
      process.stdin.removeListener('data', onData);
      process.stdout.write(' (auto-continuing)\n');
      resolve();
    }, 10_000);
    const onData = () => {
      clearTimeout(timeout);
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
      resolve();
    };
    process.stdin.once('data', onData);
    // In case stdin is not a TTY (CI), auto-continue
    if (!process.stdin.isTTY) {
      clearTimeout(timeout);
      process.stdout.write(' (non-TTY, continuing)\n');
      resolve();
    }
  });
}

async function createSandbox(repo, tarballPath, cheapModelEnv = {}, interactive = false) {
  // Use a temp directory on the SAME volume as the project to avoid filling
  // the system disk. os.tmpdir() points to /var/folders (boot disk) which is
  // typically much smaller than the project volume.
  const localTmpDir = path.join(REPO_ROOT, '.patrol-tmp');
  await fs.mkdir(localTmpDir, { recursive: true });
  const tmpRoot = await fs.mkdtemp(path.join(localTmpDir, 'sandbox-'));
  const sandboxDir = path.join(tmpRoot, 'workspace');
  await fs.mkdir(sandboxDir, { recursive: true });

  // Print sandbox path immediately so users can cd into it and inspect
  console.log(`[patrol] sandbox path: ${sandboxDir}`);
  console.log(`[patrol]   → cd ${sandboxDir}  (inspect/modify while setup runs)`);

  // Clone the target repo into sandbox
  const repoDir = path.join(REPO_ROOT, 'eval-corpus/external-repos', repo.name);
  try {
    await fs.access(repoDir);
    console.log(`[patrol] copying ${repo.name} into sandbox...`);
    run('cp', ['-r', `${repoDir}/.`, sandboxDir]);
  } catch {
    if (repo.remote) {
      console.log(`[patrol] cloning ${repo.name} from ${repo.remote}...`);
      run('git', ['clone', '--depth', '1', repo.remote, sandboxDir]);
      if (repo.commit) {
        try {
          run('git', ['checkout', repo.commit], { cwd: sandboxDir });
        } catch {
          // shallow clone may not have the commit; proceed with HEAD
        }
      }
    } else {
      throw new Error(`repo ${repo.name}: no local clone and no remote URL`);
    }
  }

  // Create a package.json if it doesn't exist (for non-Node repos)
  const pkgPath = path.join(sandboxDir, 'package.json');
  try {
    await fs.access(pkgPath);
  } catch {
    await fs.writeFile(pkgPath, JSON.stringify({
      name: `patrol-sandbox-${repo.name}`,
      private: true,
      version: '0.0.0',
    }, null, 2), 'utf8');
  }

  if (interactive) {
    await waitForEnter('sandbox created, repo copied. Inspect/modify before npm install');
  }

  // Install LiBrainian from tarball -- stream output live
  console.log(`[patrol] npm install (tarball)...`);
  run('npm', ['install', '--no-save', tarballPath], { cwd: sandboxDir, stdio: 'inherit' });

  if (interactive) {
    await waitForEnter('npm install done. Inspect/modify before bootstrap');
  }

  // Run bootstrap with cheap model env -- stream output live so progress is visible
  const binPath = path.join(sandboxDir, 'node_modules', '.bin', 'librainian');
  const bootstrapEnv = { ...process.env, ...cheapModelEnv };
  console.log(`[patrol] bootstrap starting (live output below)...`);
  try {
    run(process.execPath, [binPath, 'bootstrap'], { cwd: sandboxDir, env: bootstrapEnv, stdio: 'inherit' });
    console.log(`[patrol] bootstrap complete`);
  } catch (e) {
    console.error(`[patrol] bootstrap warning for ${repo.name}: ${e.message}`);
    // Non-fatal -- agent will encounter this too
  }

  if (interactive) {
    await waitForEnter('bootstrap done. Inspect sandbox before agent dispatch');
  }

  return { tmpRoot, sandboxDir, binPath };
}

// ---------------------------------------------------------------------------
// Agent detection
// ---------------------------------------------------------------------------
function detectAgentBin(explicit) {
  // Explicit override wins
  if (explicit && explicit !== 'auto') return explicit;

  // Env var override
  const envBin = process.env.PATROL_AGENT_BIN?.trim();
  if (envBin) return envBin;

  // Auto-detect: try claude first, then codex
  for (const bin of ['claude', 'codex']) {
    const check = spawnSync('which', [bin], { encoding: 'utf8', stdio: 'pipe' });
    if (check.status === 0) return bin;
  }

  throw new Error(
    'no agent CLI found. Install claude (npm i -g @anthropic-ai/claude-code) ' +
    'or codex (npm i -g @openai/codex), or set PATROL_AGENT_BIN / --agent-bin'
  );
}

/**
 * Build the correct CLI args for the detected agent binary.
 * Both claude and codex support non-interactive stdin-piped execution,
 * but with different flag conventions.
 *
 * @param {object} cheapModels - resolved cheapest models (from resolveCheapestModels)
 */
function buildAgentArgs(agentBin, sandboxDir, cheapModels) {
  const basename = path.basename(agentBin);

  if (basename === 'codex' || basename.startsWith('codex')) {
    // Codex CLI: `codex exec --dangerously-bypass-approvals-and-sandbox -C <dir> -`
    const args = [
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '--color', 'never',
      '-C', sandboxDir,
    ];
    // Force cheapest model for the agent itself
    if (cheapModels?.llmModel) {
      args.push('--model', cheapModels.llmModel);
    }
    args.push('-');  // codex uses `-` to read from stdin
    return args;
  }

  // Claude CLI: `claude --print --dangerously-skip-permissions`
  // Working directory is set via cwd in spawn options.
  // Use stream-json output to get incremental output (otherwise --print only
  // flushes at the end, and timeouts produce 0 chars of captured output).
  const args = [
    '--print',
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
  ];
  // The agent "test user" should be competent enough to follow the patrol prompt,
  // exercise features thoroughly, and produce quality observations. Use Sonnet.
  // LiBrainian's internal operations (indexing, embeddings, queries) are separately
  // forced to the cheapest model via LIBRARIAN_LLM_MODEL env var.
  args.push('--model', 'sonnet');
  return args;
}

// ---------------------------------------------------------------------------
// Agent dispatch
// ---------------------------------------------------------------------------
/**
 * Write prompt to a file in the sandbox, then spawn the agent with it.
 * For Claude: pass prompt as positional arg (stdin pipe is unreliable for large prompts).
 * For Codex: pipe to stdin via `-` flag.
 *
 * Returns: { exitCode, stdout (assembled text), stderr, timedOut, error }
 */
async function spawnAgent(prompt, sandboxDir, agentBin, timeoutMs, extraEnv = {}, cheapModels = null) {
  const basename = path.basename(agentBin);
  const isClaude = !(basename === 'codex' || basename.startsWith('codex'));

  // Write prompt to file (more reliable than stdin pipe for large prompts)
  const promptFile = path.join(sandboxDir, '.patrol-prompt.md');
  await fs.writeFile(promptFile, prompt, 'utf8');

  return new Promise((resolve) => {
    const supportsProcessGroups = process.platform !== 'win32';
    const args = buildAgentArgs(agentBin, sandboxDir, cheapModels);

    // For Claude, pass the prompt as a positional argument (file contents)
    // For Codex, we'll pipe via stdin
    if (isClaude) {
      args.push(prompt);
    }

    console.log(`[patrol] spawning: ${agentBin} ${args.slice(0, -1).join(' ')} [prompt: ${prompt.length} chars]`);

    // Build child env: inherit everything (OAuth tokens, API keys, provider
    // configs), overlay cheap model env, and strip CLAUDECODE to avoid nested
    // session detection when patrol itself runs inside Claude Code.
    const childEnv = { ...process.env, ...extraEnv };
    delete childEnv.CLAUDECODE;

    const child = spawn(agentBin, args, {
      cwd: sandboxDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
      detached: supportsProcessGroups,
    });

    const killChildTree = () => {
      if (child.killed) return;
      if (supportsProcessGroups && typeof child.pid === 'number') {
        try { process.kill(-child.pid, 'SIGKILL'); return; } catch {}
      }
      try { child.kill('SIGKILL'); } catch {}
    };

    let timedOut = false;
    const watchdog = setTimeout(() => {
      timedOut = true;
      console.error(`[patrol] agent timeout (${timeoutMs}ms)`);
      killChildTree();
    }, timeoutMs);

    // Heartbeat: log a status line every 60s so we know the run is alive
    const spawnTime = Date.now();
    const heartbeat = setInterval(() => {
      const elapsed = Math.round((Date.now() - spawnTime) / 1000);
      console.log(`[patrol:heartbeat] agent running ${elapsed}s... assembled=${assembledText.length}chars stdout=${stdoutBuffer.length}chars stderr=${stderrBuffer.length}chars`);
    }, 60_000);

    // Handle stdin errors (e.g. EPIPE if child exits before we finish writing)
    child.stdin.on('error', () => {});
    if (!isClaude) {
      // Codex reads from stdin
      child.stdin.write(prompt);
    }
    child.stdin.end();

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let stdoutOverflow = false;
    // For Claude stream-json: events come on STDOUT (one JSON line per event).
    // We parse them to assemble the agent's text response and log live activity.
    let assembledText = '';
    // Line buffer for stream-json parsing: chunks may split across lines
    let streamLineBuf = '';

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      if (stdoutBuffer.length < CHILD_OUTPUT_MAX_CHARS) {
        stdoutBuffer += text.slice(0, CHILD_OUTPUT_MAX_CHARS - stdoutBuffer.length);
      } else if (!stdoutOverflow) {
        stdoutBuffer += '\n...<stdout truncated>';
        stdoutOverflow = true;
      }

      // For Claude stream-json: parse JSON events from stdout
      if (isClaude) {
        streamLineBuf += text;
        const lines = streamLineBuf.split('\n');
        streamLineBuf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed);

            // ---- LIVE LOGGING: show what the agent is doing ----
            if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'text') {
                  // Add newline separator between text blocks so PATROL_OBS
                  // lines at the start of a block don't merge with the
                  // previous block's trailing text during line-based extraction
                  assembledText += '\n' + block.text;
                  // Log text preview (first 200 chars of each block)
                  const preview = block.text.replace(/\n/g, ' ').slice(0, 200);
                  if (preview.trim()) {
                    console.log(`[patrol:agent] text: ${preview}${block.text.length > 200 ? '...' : ''}`);
                  }
                  // Highlight PATROL_OBS markers
                  if (block.text.includes('PATROL_OBS:')) {
                    for (const obsLine of block.text.split('\n')) {
                      if (obsLine.trim().startsWith('PATROL_OBS:')) {
                        console.log(`[patrol:obs] ${obsLine.trim()}`);
                      }
                    }
                  }
                } else if (block.type === 'tool_use') {
                  // Log tool calls for visibility
                  const inputPreview = JSON.stringify(block.input ?? {}).slice(0, 150);
                  console.log(`[patrol:agent] tool: ${block.name} ${inputPreview}`);
                }
              }
            } else if (event.type === 'result') {
              // Final result event
              console.log(`[patrol:agent] result: cost=${JSON.stringify(event.cost_usd ?? null)} duration=${event.duration_ms ?? '?'}ms`);
            }
          } catch {
            // Not JSON -- ignore non-event lines
          }
        }
      }
    });

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      if (stderrBuffer.length < CHILD_OUTPUT_MAX_CHARS) {
        stderrBuffer += text.slice(0, CHILD_OUTPUT_MAX_CHARS - stderrBuffer.length);
      }
    });

    let childError;
    child.on('error', (err) => { childError = err; });
    child.on('close', (code) => {
      clearTimeout(watchdog);
      clearInterval(heartbeat);
      // Flush remaining line buffer for stream-json parsing
      if (isClaude && streamLineBuf.trim()) {
        try {
          const event = JSON.parse(streamLineBuf.trim());
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text') {
                assembledText += block.text;
              }
            }
          }
        } catch {
          // Not JSON -- ignore
        }
      }
      // For Claude stream-json, use assembled text; for Codex, use raw stdout
      const effectiveOutput = isClaude && assembledText.length > 0
        ? assembledText
        : stdoutBuffer;
      resolve({
        exitCode: code ?? 1,
        stdout: effectiveOutput,
        stderr: stderrBuffer,
        timedOut,
        error: childError?.message,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------
function computeAggregate(runs) {
  const validObs = runs.filter((r) => r.observations);

  if (validObs.length === 0) {
    return {
      meanNps: 0,
      wouldRecommendRate: 0,
      avgNegativeFindings: 0,
      featureQualityDistribution: {},
      topNegativeThemes: [],
      implicitFallbackRate: 0,
      constructionCoverage: { exercised: 0, total: 0, coverageRate: 0 },
      compositionSuccessRate: 0,
      registryDiscoverabilityRate: 0,
    };
  }

  // NPS
  const npsScores = validObs
    .map((r) => r.observations?.overallVerdict?.npsScore)
    .filter((n) => typeof n === 'number');
  const meanNps = npsScores.length > 0
    ? npsScores.reduce((a, b) => a + b, 0) / npsScores.length
    : 0;

  // Would recommend
  const recommends = validObs
    .map((r) => r.observations?.overallVerdict?.wouldRecommend)
    .filter((v) => typeof v === 'boolean');
  const wouldRecommendRate = recommends.length > 0
    ? recommends.filter(Boolean).length / recommends.length
    : 0;

  // Negative findings
  const negCounts = validObs
    .map((r) => (r.observations?.negativeFindingsMandatory ?? []).length);
  const avgNegativeFindings = negCounts.length > 0
    ? negCounts.reduce((a, b) => a + b, 0) / negCounts.length
    : 0;

  // Feature quality distribution
  const qualityDist = {};
  for (const r of validObs) {
    for (const f of r.observations?.featuresUsed ?? []) {
      const q = f.quality ?? 'unknown';
      qualityDist[q] = (qualityDist[q] || 0) + 1;
    }
  }

  // Top negative themes
  const themes = {};
  for (const r of validObs) {
    for (const n of r.observations?.negativeFindingsMandatory ?? []) {
      const cat = n.category ?? 'other';
      themes[cat] = (themes[cat] || 0) + 1;
    }
  }
  const topNegativeThemes = Object.entries(themes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([theme, count]) => ({ theme, count }));

  // Implicit fallback rate
  const fallbackSignals = runs.map((r) => r.implicitSignals);
  const fallbackCount = fallbackSignals.filter((s) =>
    s?.usedGrepInstead || s?.catInsteadOfContext
  ).length;
  const implicitFallbackRate = runs.length > 0 ? fallbackCount / runs.length : 0;

  // Construction coverage
  const allConstructionIds = new Set();
  for (const r of validObs) {
    for (const c of r.observations?.constructionsUsed ?? []) {
      if (c.constructionId) allConstructionIds.add(c.constructionId);
    }
  }
  const constructionCoverage = {
    exercised: allConstructionIds.size,
    total: allConstructionIds.size, // We don't know total available without querying
    coverageRate: allConstructionIds.size > 0 ? 1 : 0,
  };

  // Composition success rate
  const allComps = validObs.flatMap((r) => r.observations?.compositionsAttempted ?? []);
  const compositionSuccessRate = allComps.length > 0
    ? allComps.filter((c) => c.worked).length / allComps.length
    : 0;

  // Registry discoverability
  const regExps = validObs
    .map((r) => r.observations?.registryExperience?.discoveryEasy)
    .filter((v) => typeof v === 'boolean');
  const registryDiscoverabilityRate = regExps.length > 0
    ? regExps.filter(Boolean).length / regExps.length
    : 0;

  return {
    meanNps: Math.round(meanNps * 100) / 100,
    wouldRecommendRate: Math.round(wouldRecommendRate * 1000) / 1000,
    avgNegativeFindings: Math.round(avgNegativeFindings * 100) / 100,
    featureQualityDistribution: qualityDist,
    topNegativeThemes,
    implicitFallbackRate: Math.round(implicitFallbackRate * 1000) / 1000,
    constructionCoverage,
    compositionSuccessRate: Math.round(compositionSuccessRate * 1000) / 1000,
    registryDiscoverabilityRate: Math.round(registryDiscoverabilityRate * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    mode: 'quick',
    repo: null,
    maxRepos: null,
    timeoutMs: null,
    keep: false,
    artifact: null,
    noIssues: false,
    agentBin: 'auto',
    interactive: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--mode') {
      if (!next || !MODE_DEFAULTS[next]) throw new Error(`--mode must be quick|full|release`);
      opts.mode = next; i++; continue;
    }
    if (arg === '--repo') {
      if (!next) throw new Error('--repo requires a value');
      opts.repo = next; i++; continue;
    }
    if (arg === '--max-repos') {
      const n = Number(next);
      if (!Number.isFinite(n) || n < 1) throw new Error('--max-repos must be >= 1');
      opts.maxRepos = n; i++; continue;
    }
    if (arg === '--timeout-ms') {
      const n = Number(next);
      if (!Number.isFinite(n) || n < 1000) throw new Error('--timeout-ms must be >= 1000');
      opts.timeoutMs = n; i++; continue;
    }
    if (arg === '--keep') { opts.keep = true; continue; }
    if (arg === '--artifact') {
      if (!next) throw new Error('--artifact requires a value');
      opts.artifact = next; i++; continue;
    }
    if (arg === '--no-issues') { opts.noIssues = true; continue; }
    if (arg === '--interactive' || arg === '-i') { opts.interactive = true; continue; }
    if (arg === '--agent-bin') {
      if (!next) throw new Error('--agent-bin requires a value');
      opts.agentBin = next; i++; continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  // Apply mode defaults
  const defaults = MODE_DEFAULTS[opts.mode];
  if (opts.maxRepos === null) opts.maxRepos = defaults.maxRepos;
  if (opts.timeoutMs === null) opts.timeoutMs = defaults.timeoutMs;
  if (opts.artifact === null) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    opts.artifact = `state/patrol/patrol-run-${ts}.json`;
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.warn(
    '[patrol] DEPRECATED: direct scripts/agent-patrol.mjs invocation is deprecated; use "librarian constructions run patrol-process" instead.',
  );
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `[patrol] storage policy: maxBytes=${STORAGE_POLICY.maxStorageBytes} maxAgeMs=${STORAGE_POLICY.maxArtifactAgeMs} maxEntries=${STORAGE_POLICY.maxEntries}`,
  );
  const startupStorage = await enforceStorageHygiene('startup');
  if (startupStorage.removedCount > 0) {
    console.log(
      `[patrol] startup cleanup removed=${startupStorage.removedCount} entries bytes=${startupStorage.removedBytes} remainingBytes=${startupStorage.afterBytes}`,
    );
  }

  // Detect agent binary (auto-detect from local env, supports claude or codex OAuth)
  const agentBin = detectAgentBin(opts.agentBin);
  console.log(`[patrol] mode=${opts.mode} maxRepos=${opts.maxRepos} timeoutMs=${opts.timeoutMs} agent=${agentBin}`);

  // Read manifest
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  const repos = selectRepos(manifest, opts);
  console.log(`[patrol] selected ${repos.length} repo(s): ${repos.map((r) => r.name).join(', ')}`);

  // Read prompt template
  const promptTemplate = await fs.readFile(PROMPT_TEMPLATE_PATH, 'utf8');

  // Pack tarball
  console.log('[patrol] creating tarball...');
  const packedName = run('npm', ['pack', '--silent']).split('\n').pop()?.trim();
  if (!packedName) throw new Error('npm pack did not return a tarball name');
  const tarballPath = path.join(REPO_ROOT, packedName);
  console.log(`[patrol] tarball: ${packedName}`);

  // Resolve cheapest available models for the detected provider
  const cheapModels = resolveCheapestModels(agentBin);
  const cheapModelEnv = buildCheapModelEnv(cheapModels);
  console.log(`[patrol] cheap models: provider=${cheapModels.llmProvider} llm=${cheapModels.llmModel} embedding=${cheapModels.embeddingModel}`);

  const commitSha = getCommitSha();
  const runs = [];
  const protectedPaths = new Set();
  let postRunStorage = null;

  try {
    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];
      const taskVariant = selectTaskVariant(i);
      console.log(`\n[patrol] === repo ${i + 1}/${repos.length}: ${repo.name} (${repo.language ?? 'unknown'}) task=${taskVariant} ===`);

      let sandbox;
      const startMs = Date.now();

      try {
        // Setup sandbox
        console.log(`[patrol] setting up sandbox for ${repo.name}...`);
        sandbox = await createSandbox(repo, tarballPath, cheapModelEnv, opts.interactive);
        console.log(`[patrol] sandbox ready: ${sandbox.sandboxDir}`);

        // Build prompt
        const prompt = buildPrompt(promptTemplate, taskVariant, repo.name);

        // Spawn agent
        console.log(`[patrol] dispatching agent (timeout=${opts.timeoutMs}ms)...`);
        const result = await spawnAgent(prompt, sandbox.sandboxDir, agentBin, opts.timeoutMs, cheapModelEnv, cheapModels);

        const durationMs = Date.now() - startMs;
        console.log(`[patrol] agent finished: exit=${result.exitCode} timeout=${result.timedOut} duration=${durationMs}ms output=${result.stdout.length}chars`);

        // For Claude, result.stdout is the assembled text from stream-json events.
        // For Codex, it's the raw stdout. Either way, this is the primary text to analyze.
        const agentOutput = result.stdout;

        // Extract observation from agent output
        const observations = extractObservation(agentOutput);
        const implicitSignals = detectImplicitSignals(agentOutput);

        if (observations) {
          const negCount = (observations.negativeFindingsMandatory ?? []).length;
          const conCount = (observations.constructionsUsed ?? []).length;
          console.log(`[patrol] observation extracted: nps=${observations.overallVerdict?.npsScore} negFindings=${negCount} constructions=${conCount}`);
        } else {
          console.log('[patrol] no observation found in agent output');
          // Show output preview for debugging
          const preview = agentOutput.trim().slice(0, 2000);
          if (preview) {
            console.log(`[patrol] output preview (first 2000 chars):\n${preview}`);
          } else {
            console.log('[patrol] agent produced no text output');
            // Check if stderr has anything useful
            const stderrPreview = result.stderr.trim().slice(0, 1000);
            if (stderrPreview) {
              console.log(`[patrol] stderr preview:\n${stderrPreview}`);
            }
          }
        }

        runs.push({
          repo: repo.name,
          language: repo.language ?? 'unknown',
          task: taskVariant,
          observations,
          implicitSignals,
          agentExitCode: result.exitCode,
          durationMs,
          rawOutputTruncated: agentOutput.length >= CHILD_OUTPUT_MAX_CHARS,
          timedOut: result.timedOut,
        });
      } catch (e) {
        const durationMs = Date.now() - startMs;
        console.error(`[patrol] error on ${repo.name}: ${e.message}`);
        runs.push({
          repo: repo.name,
          language: repo.language ?? 'unknown',
          task: taskVariant,
          observations: null,
          implicitSignals: null,
          agentExitCode: -1,
          durationMs,
          rawOutputTruncated: false,
          timedOut: false,
          error: e.message,
        });
      } finally {
        // Cleanup sandbox
        if (sandbox && !opts.keep) {
          await fs.rm(sandbox.tmpRoot, { recursive: true, force: true }).catch(() => {});
          console.log(`[patrol] sandbox removed`);
        } else if (sandbox && opts.keep) {
          console.log(`[patrol] sandbox kept: ${sandbox.sandboxDir}`);
          protectedPaths.add(sandbox.tmpRoot);
        }
      }
    }
  } finally {
    // Always clean up tarball
    await fs.rm(tarballPath, { force: true }).catch(() => {});
    postRunStorage = await enforceStorageHygiene('post-run', protectedPaths).catch(() => null);
  }

  // Compute aggregate
  const aggregate = computeAggregate(runs);

  // Build report
  const policy = evaluatePatrolPolicyGate(opts.mode, runs);
  const report = {
    kind: 'PatrolReport.v1',
    mode: opts.mode,
    createdAt: new Date().toISOString(),
    commitSha,
    runs,
    aggregate,
    policy,
    storageTelemetry: {
      startup: startupStorage,
      postRun: postRunStorage,
    },
  };

  // Write artifact
  const artifactPath = path.resolve(REPO_ROOT, opts.artifact);
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`\n[patrol] report written: ${opts.artifact}`);

  // Print summary
  console.log(`[patrol] === Summary ===`);
  console.log(`  Repos tested: ${runs.length}`);
  console.log(`  Observations extracted: ${runs.filter((r) => r.observations).length}`);
  console.log(`  Mean NPS: ${aggregate.meanNps}`);
  console.log(`  Would recommend rate: ${(aggregate.wouldRecommendRate * 100).toFixed(1)}%`);
  console.log(`  Avg negative findings: ${aggregate.avgNegativeFindings}`);
  console.log(`  Implicit fallback rate: ${(aggregate.implicitFallbackRate * 100).toFixed(1)}%`);
  console.log(`  Constructions exercised: ${aggregate.constructionCoverage.exercised}`);
  console.log(`  Composition success rate: ${(aggregate.compositionSuccessRate * 100).toFixed(1)}%`);
  console.log(
    `  Storage bytes (startup→post-run): ${startupStorage.afterBytes} -> ${postRunStorage?.afterBytes ?? startupStorage.afterBytes}`,
  );
  console.log(
    `  Storage cleanup removed entries: startup=${startupStorage.removedCount} post-run=${postRunStorage?.removedCount ?? 0}`,
  );
  console.log(
    `  Policy decision: required=${policy.requiredEvidenceMode} ` +
    `observed=${policy.observedEvidenceMode} enforcement=${policy.enforcement}`,
  );

  // Exit with error if no observations were extracted
  const obsCount = runs.filter((r) => r.observations).length;
  if (obsCount === 0) {
    console.error('[patrol] FAIL: no observations extracted from any run');
    process.exit(1);
  }

  if (policy.enforcement === 'blocked') {
    console.error(`[patrol] FAIL: ${policy.reason}`);
    process.exit(1);
  }
}

const mainHref = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';

if (mainHref && import.meta.url === mainHref) {
  main().catch((err) => {
    console.error('[patrol] fatal error:', err.message);
    process.exit(1);
  });
}
