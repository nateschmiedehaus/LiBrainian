#!/usr/bin/env node
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RETENTION_POLICY_KIND = 'LiBrainianArtifactRetentionPolicy.v1';
const RETENTION_AUDIT_KIND = 'LiBrainianArtifactRetentionAudit.v1';
const OVERRIDE_FILENAME = '.librainian-retention.json';
const PROTECTED_CLASS_IDS = new Set(['releaseEvidence']);

const DEFAULT_POLICY_BY_CONTEXT = {
  repo: {
    releaseEvidence: { maxAgeDays: 180, maxCount: null, protected: true },
    patrolReports: { maxAgeDays: 30, maxCount: 60, protected: false },
    temporarySandboxes: { maxAgeDays: 2, maxCount: 10, protected: false },
    transientPackages: { maxAgeDays: 2, maxCount: 4, protected: false },
  },
  installed: {
    releaseEvidence: { maxAgeDays: 30, maxCount: null, protected: true },
    patrolReports: { maxAgeDays: 14, maxCount: 20, protected: false },
    temporarySandboxes: { maxAgeDays: 1, maxCount: 5, protected: false },
    transientPackages: { maxAgeDays: 1, maxCount: 2, protected: false },
  },
};

function toMsFromDays(days) {
  if (days === null || days === undefined) return null;
  if (!Number.isFinite(days) || days < 0) {
    throw new Error(`Invalid retention day value: ${String(days)}`);
  }
  return Math.floor(days * 24 * 60 * 60 * 1000);
}

function resolveContext(workspaceRoot, explicitContext) {
  if (explicitContext === 'repo' || explicitContext === 'installed') {
    return explicitContext;
  }
  return existsSync(path.join(workspaceRoot, '.git')) ? 'repo' : 'installed';
}

async function readOverrideConfig(workspaceRoot) {
  const overridePath = path.join(workspaceRoot, OVERRIDE_FILENAME);
  if (!existsSync(overridePath)) {
    return { path: overridePath, content: null };
  }
  const raw = await fs.readFile(overridePath, 'utf8');
  const parsed = JSON.parse(raw);
  return { path: overridePath, content: parsed };
}

export async function resolveRetentionPolicy({
  workspaceRoot = process.cwd(),
  context = 'auto',
} = {}) {
  const effectiveContext = resolveContext(workspaceRoot, context);
  const defaults = DEFAULT_POLICY_BY_CONTEXT[effectiveContext];
  if (!defaults) {
    throw new Error(`Unknown retention context: ${effectiveContext}`);
  }

  const override = await readOverrideConfig(workspaceRoot);
  const overrideClasses =
    override.content && typeof override.content === 'object' && override.content.classes
      ? override.content.classes
      : {};

  const classes = {};
  for (const [classId, config] of Object.entries(defaults)) {
    const classOverride = overrideClasses[classId] ?? {};
    const protectedFlag = classOverride.protected ?? config.protected;
    if (PROTECTED_CLASS_IDS.has(classId) && protectedFlag !== true) {
      throw new Error(
        `Retention override attempted to unprotect ${classId}. Protected evidence cannot be downgraded.`
      );
    }
    classes[classId] = {
      maxAgeMs: toMsFromDays(classOverride.maxAgeDays ?? config.maxAgeDays),
      maxCount: classOverride.maxCount ?? config.maxCount,
      protected: protectedFlag,
    };
  }

  return {
    kind: RETENTION_POLICY_KIND,
    context: effectiveContext,
    source: {
      defaults: effectiveContext,
      overridePath: override.path,
      overrideApplied: Boolean(override.content),
    },
    classes,
  };
}

async function listEntries(relativeDir, workspaceRoot, predicate) {
  const dirPath = path.join(workspaceRoot, relativeDir);
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const results = [];
  for (const entry of entries) {
    if (!predicate(entry)) continue;
    const absolutePath = path.join(dirPath, entry.name);
    const stat = await fs.stat(absolutePath);
    results.push({
      relativePath: path.relative(workspaceRoot, absolutePath),
      absolutePath,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      isDirectory: stat.isDirectory(),
    });
  }
  return results;
}

async function collectClassCandidates(classId, workspaceRoot) {
  switch (classId) {
    case 'releaseEvidence': {
      const dogfood = await listEntries('state/dogfood', workspaceRoot, (entry) => {
        return entry.isFile() && /^clean-clone-self-hosting.*\.json$/iu.test(entry.name);
      });
      const patrol = await listEntries('state/patrol', workspaceRoot, (entry) => {
        return (
          entry.isFile() &&
          /^(patrol-summary\.json|patrol-summary\.md|patrol-policy-gate\.json|evidence-ledger\.json)$/iu.test(entry.name)
        );
      });
      return [...dogfood, ...patrol];
    }
    case 'patrolReports':
      return listEntries('state/patrol', workspaceRoot, (entry) => {
        return entry.isFile() && /^patrol-run-.*\.json$/iu.test(entry.name);
      });
    case 'temporarySandboxes':
      return listEntries('.patrol-tmp', workspaceRoot, (entry) => {
        return entry.isDirectory() && /^sandbox-/iu.test(entry.name);
      });
    case 'transientPackages':
      return listEntries('.', workspaceRoot, (entry) => {
        return entry.isFile() && /^librainian-.*\.tgz$/iu.test(entry.name);
      });
    default:
      return [];
  }
}

function shouldDeleteCandidate(candidateIndex, ageMs, classConfig) {
  if (classConfig.protected) return false;
  const exceededAge = classConfig.maxAgeMs !== null && ageMs > classConfig.maxAgeMs;
  const exceededCount =
    classConfig.maxCount !== null &&
    Number.isFinite(classConfig.maxCount) &&
    candidateIndex >= classConfig.maxCount;
  return exceededAge || exceededCount;
}

function decisionReason(candidateIndex, ageMs, classConfig) {
  if (classConfig.protected) return 'protected';
  const exceededAge = classConfig.maxAgeMs !== null && ageMs > classConfig.maxAgeMs;
  const exceededCount =
    classConfig.maxCount !== null &&
    Number.isFinite(classConfig.maxCount) &&
    candidateIndex >= classConfig.maxCount;
  if (exceededAge && exceededCount) return 'age_and_count_limit';
  if (exceededAge) return 'age_limit';
  if (exceededCount) return 'count_limit';
  return 'within_retention';
}

function defaultAuditPath(workspaceRoot, nowMs) {
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/gu, '-');
  return path.join(workspaceRoot, 'state', 'retention', `artifact-retention-${stamp}.json`);
}

export async function runArtifactRetention({
  workspaceRoot = process.cwd(),
  context = 'auto',
  dryRun = false,
  nowMs = Date.now(),
  auditOutPath,
} = {}) {
  const policy = await resolveRetentionPolicy({ workspaceRoot, context });
  const decisions = [];
  const classSummary = {};
  let kept = 0;
  let deleted = 0;
  let evaluated = 0;
  let bytesReclaimed = 0;

  for (const [classId, classConfig] of Object.entries(policy.classes)) {
    const candidates = await collectClassCandidates(classId, workspaceRoot);
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    let classKept = 0;
    let classDeleted = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const ageMs = Math.max(0, nowMs - candidate.mtimeMs);
      const deleteCandidate = shouldDeleteCandidate(index, ageMs, classConfig);
      const action = deleteCandidate ? 'delete' : 'keep';
      const reason = decisionReason(index, ageMs, classConfig);
      evaluated += 1;
      if (deleteCandidate) {
        classDeleted += 1;
        deleted += 1;
        bytesReclaimed += candidate.sizeBytes;
        if (!dryRun) {
          await fs.rm(candidate.absolutePath, {
            recursive: candidate.isDirectory,
            force: true,
          });
        }
      } else {
        classKept += 1;
        kept += 1;
      }

      decisions.push({
        classId,
        path: candidate.relativePath,
        action,
        reason,
        ageMs,
        sizeBytes: candidate.sizeBytes,
      });
    }

    classSummary[classId] = {
      matched: candidates.length,
      kept: classKept,
      deleted: classDeleted,
    };
  }

  const audit = {
    kind: RETENTION_AUDIT_KIND,
    generatedAt: new Date(nowMs).toISOString(),
    workspaceRoot,
    dryRun,
    policy,
    summary: {
      evaluated,
      kept,
      deleted,
      bytesReclaimed,
    },
    classes: classSummary,
    decisions,
  };

  const resolvedAuditPath = auditOutPath
    ? (path.isAbsolute(auditOutPath) ? auditOutPath : path.join(workspaceRoot, auditOutPath))
    : defaultAuditPath(workspaceRoot, nowMs);

  await fs.mkdir(path.dirname(resolvedAuditPath), { recursive: true });
  await fs.writeFile(resolvedAuditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');

  return {
    policy,
    audit,
    auditPath: resolvedAuditPath,
  };
}

function parseArgs(argv) {
  const options = {
    workspaceRoot: process.cwd(),
    context: 'auto',
    dryRun: false,
    auditOutPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') {
      const next = argv[index + 1];
      if (!next) throw new Error('--workspace requires a value');
      options.workspaceRoot = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === '--context') {
      const next = argv[index + 1];
      if (!next || !['auto', 'repo', 'installed'].includes(next)) {
        throw new Error('--context must be one of auto|repo|installed');
      }
      options.context = next;
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--audit-out') {
      const next = argv[index + 1];
      if (!next) throw new Error('--audit-out requires a value');
      options.auditOutPath = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runArtifactRetention(parseArgs(process.argv.slice(2)))
    .then((result) => {
      const summary = result.audit.summary;
      console.log(
        `[retention] dryRun=${result.audit.dryRun} evaluated=${summary.evaluated} deleted=${summary.deleted} kept=${summary.kept} bytesReclaimed=${summary.bytesReclaimed}`
      );
      console.log(`[retention] audit: ${result.auditPath}`);
    })
    .catch((error) => {
      console.error('[retention] FAILED');
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

