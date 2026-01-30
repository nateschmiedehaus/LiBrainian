import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { computeCanonRef, computeEnvironmentRef } from '../spine/refs.js';
import type { GovernorContextSnapshot } from './governor_context.js';

// ============================================================================
// AUTO-CONCURRENCY DETECTION
// ============================================================================

export interface SystemResources {
  cpuCores: number;
  totalMemoryGB: number;
  freeMemoryGB: number;
  loadAverage: number;
}

export interface ProjectMetrics {
  fileCount: number;
  estimatedComplexity: 'small' | 'medium' | 'large' | 'massive';
}

export interface ConcurrencyRecommendation {
  workers: number;
  reasoning: string[];
  constraints: string[];
}

/**
 * Detect system resources for concurrency calculation.
 */
export function detectSystemResources(): SystemResources {
  const cpuCores = os.cpus().length;
  const totalMemoryGB = os.totalmem() / (1024 ** 3);
  const freeMemoryGB = os.freemem() / (1024 ** 3);
  const loadAverage = os.loadavg()[0] ?? 0; // 1-minute load average

  return { cpuCores, totalMemoryGB, freeMemoryGB, loadAverage };
}

/**
 * Estimate project complexity from file count.
 */
export function estimateProjectComplexity(fileCount: number): ProjectMetrics['estimatedComplexity'] {
  if (fileCount < 50) return 'small';
  if (fileCount < 200) return 'medium';
  if (fileCount < 1000) return 'large';
  return 'massive';
}

/**
 * Calculate optimal concurrent workers based on system resources and project size.
 *
 * Principles:
 * - Never use more workers than CPU cores (to avoid context switching overhead)
 * - Reserve ~2GB RAM per worker for embeddings and LLM context
 * - Scale down if system is already under load
 * - Ensure at least 1 worker always
 * - Cap at reasonable maximum to avoid API rate limits
 */
export function calculateOptimalConcurrency(
  resources: SystemResources,
  projectMetrics: ProjectMetrics
): ConcurrencyRecommendation {
  const reasoning: string[] = [];
  const constraints: string[] = [];

  // Start with CPU-based calculation (leave 1-2 cores for system)
  const cpuBasedMax = Math.max(1, resources.cpuCores - 2);
  reasoning.push(`CPU cores: ${resources.cpuCores}, leaving 2 for system → max ${cpuBasedMax}`);

  // Memory-based calculation (~2GB per worker for safety)
  const memoryPerWorkerGB = 2;
  const memoryBasedMax = Math.max(1, Math.floor(resources.freeMemoryGB / memoryPerWorkerGB));
  reasoning.push(`Free memory: ${resources.freeMemoryGB.toFixed(1)}GB, ${memoryPerWorkerGB}GB/worker → max ${memoryBasedMax}`);

  // Load-based adjustment (reduce if system is busy)
  let loadMultiplier = 1.0;
  if (resources.loadAverage > resources.cpuCores * 0.7) {
    loadMultiplier = 0.5;
    constraints.push(`High system load (${resources.loadAverage.toFixed(1)}), reducing by 50%`);
  } else if (resources.loadAverage > resources.cpuCores * 0.5) {
    loadMultiplier = 0.75;
    constraints.push(`Moderate system load (${resources.loadAverage.toFixed(1)}), reducing by 25%`);
  }

  // Project size adjustment
  let projectMultiplier = 1.0;
  switch (projectMetrics.estimatedComplexity) {
    case 'small':
      // Small projects don't benefit from many workers (overhead dominates)
      projectMultiplier = 0.5;
      reasoning.push(`Small project (${projectMetrics.fileCount} files), fewer workers needed`);
      break;
    case 'medium':
      projectMultiplier = 0.75;
      break;
    case 'large':
      projectMultiplier = 1.0;
      reasoning.push(`Large project (${projectMetrics.fileCount} files), full parallelism beneficial`);
      break;
    case 'massive':
      projectMultiplier = 1.0;
      reasoning.push(`Massive project (${projectMetrics.fileCount} files), maximum parallelism`);
      break;
  }

  // Calculate final worker count
  const baseWorkers = Math.min(cpuBasedMax, memoryBasedMax);
  let workers = Math.round(baseWorkers * loadMultiplier * projectMultiplier);

  // Apply absolute bounds
  const MIN_WORKERS = 1;
  const MAX_WORKERS = 16; // Cap to avoid API rate limits and diminishing returns

  if (workers < MIN_WORKERS) {
    workers = MIN_WORKERS;
    constraints.push(`Minimum 1 worker enforced`);
  }
  if (workers > MAX_WORKERS) {
    workers = MAX_WORKERS;
    constraints.push(`Capped at ${MAX_WORKERS} to avoid rate limits`);
  }

  reasoning.push(`Final calculation: min(${cpuBasedMax}, ${memoryBasedMax}) × ${loadMultiplier} × ${projectMultiplier} = ${workers}`);

  return { workers, reasoning, constraints };
}

/**
 * Auto-detect optimal governor config based on system and project.
 */
export async function autoDetectGovernorConfig(
  workspace: string,
  fileCount?: number
): Promise<{ config: Partial<GovernorConfig>; recommendation: ConcurrencyRecommendation }> {
  const resources = detectSystemResources();

  // If file count not provided, do a quick count
  let actualFileCount = fileCount ?? 0;
  if (!fileCount) {
    try {
      const { glob } = await import('glob');
      const files = await glob('**/*.{ts,tsx,js,jsx,mjs,py,go,rs,java}', {
        cwd: workspace,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
      });
      actualFileCount = files.length;
    } catch {
      actualFileCount = 100; // Default estimate
    }
  }

  const projectMetrics: ProjectMetrics = {
    fileCount: actualFileCount,
    estimatedComplexity: estimateProjectComplexity(actualFileCount),
  };

  const recommendation = calculateOptimalConcurrency(resources, projectMetrics);

  return {
    config: {
      maxConcurrentWorkers: recommendation.workers,
    },
    recommendation,
  };
}

/**
 * Configuration for adaptive resource management.
 * Controls how the system monitors and adapts to available system resources.
 */
export interface ResourceManagementConfig {
  mode: 'auto' | 'manual' | 'conservative' | 'aggressive';
  targetMemoryUtilization?: number;   // 0-1, default 0.7
  targetCpuUtilization?: number;      // 0-1, default 0.8
  minReservedMemoryPercent?: number;  // 0-1, default 0.2
  minReservedCpuCores?: number;       // default 2
  monitorIntervalMs?: number;         // default 5000
  oomKillThreshold?: number;          // 0-1, default 0.95
}

export interface GovernorConfig {
  maxTokensPerFile: number;
  maxTokensPerPhase: number;
  maxTokensPerRun: number;
  maxFilesPerPhase: number;
  maxWallTimeMs: number;
  maxRetries: number;
  maxConcurrentWorkers: number;
  maxEmbeddingsPerBatch: number;
  resourceManagement?: ResourceManagementConfig;
}

// ============================================================================
// GOVERNOR CONFIGURATION - World-Class Knowledge Solution
// ============================================================================
//
// DESIGN PRINCIPLES:
// 1. No timeouts or retry caps - correctness over speed
// 2. No token ceilings by default - avoid partial indexing
// 3. Concurrency remains bounded to respect provider limits
// 4. Diagnostics remain mandatory when failures occur
//

/**
 * Default resource management configuration.
 * Provides balanced defaults for adaptive resource monitoring.
 */
export const DEFAULT_RESOURCE_MANAGEMENT: ResourceManagementConfig = {
  mode: 'auto',
  targetMemoryUtilization: 0.7,
  targetCpuUtilization: 0.8,
  minReservedMemoryPercent: 0.2,
  minReservedCpuCores: 2,
  monitorIntervalMs: 5000,
  oomKillThreshold: 0.95,
};

export const DEFAULT_GOVERNOR_CONFIG: GovernorConfig = {
  maxTokensPerFile: 0,         // 0 = unlimited
  maxTokensPerPhase: 0,        // 0 = unlimited
  maxTokensPerRun: 0,          // 0 = unlimited
  maxFilesPerPhase: 0,         // 0 = unlimited
  maxWallTimeMs: 0,            // 0 = unlimited
  maxRetries: 0,               // 0 = unlimited retries
  maxConcurrentWorkers: 4,     // Parallel processing - balanced for API rate limits
  maxEmbeddingsPerBatch: 10,   // Batch size for embedding generation
  resourceManagement: DEFAULT_RESOURCE_MANAGEMENT,
};

export type GovernorBudgetOutcome =
  | { status: 'success' }
  | { status: 'unverified_by_trace'; reason: string; message?: string };

export interface GovernorBudgetReportV1 {
  kind: 'GovernorBudgetReport.v1';
  schema_version: 1;
  created_at: string;
  canon: Awaited<ReturnType<typeof computeCanonRef>>;
  environment: ReturnType<typeof computeEnvironmentRef>;
  phase: string;
  budget_limits: GovernorConfig;
  usage: GovernorContextSnapshot['usage'];
  outcome: GovernorBudgetOutcome;
}

export async function createGovernorBudgetReport(
  snapshot: GovernorContextSnapshot,
  outcome: GovernorBudgetOutcome
): Promise<GovernorBudgetReportV1> {
  const createdAt = new Date().toISOString();
  return {
    kind: 'GovernorBudgetReport.v1',
    schema_version: 1,
    created_at: createdAt,
    canon: await computeCanonRef(process.cwd()),
    environment: computeEnvironmentRef(),
    phase: snapshot.phase,
    budget_limits: snapshot.config,
    usage: snapshot.usage,
    outcome,
  };
}

export async function writeGovernorBudgetReport(
  workspaceRoot: string,
  report: GovernorBudgetReportV1
): Promise<string> {
  const timestamp = report.created_at.replace(/[:.]/g, '-');
  const dir = path.join(workspaceRoot, 'state', 'audits', 'librarian', 'governor', timestamp);
  await fs.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, 'GovernorBudgetReport.v1.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return reportPath;
}
