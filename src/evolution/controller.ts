/**
 * @fileoverview Evolution Controller
 *
 * Orchestrates the self-evolution system:
 * - Manages evolution cycles
 * - Coordinates emitters, evaluators, and archive
 * - Handles budget allocation via bandit
 * - Implements conservative merge policy
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  EvolutionConfig,
  EvolutionCycleResult,
  Variant,
  FitnessReport,
  ResourceUsage,
  Emitter,
  EvaluationContext,
} from './types.js';
import { DEFAULT_EVOLUTION_CONFIG } from './types.js';
import { EvolutionArchive, createArchive } from './archive.js';
import { UCB1Bandit, createBandit } from './bandit.js';
import { runStagedEvaluation } from './staged_evaluators.js';
import { createDefaultEmitters } from './emitters/index.js';

// ============================================================================
// EVOLUTION CONTROLLER
// ============================================================================

/**
 * Controller for the self-evolution system.
 */
export class EvolutionController {
  private config: EvolutionConfig;
  private archive: EvolutionArchive;
  private bandit: UCB1Bandit;
  private emitters: Emitter[];
  private baselineReport: FitnessReport | null = null;
  private readonly workspaceRoot: string;
  private readonly auditPath: string;

  constructor(options: {
    workspaceRoot?: string;
    config?: Partial<EvolutionConfig>;
    auditPath?: string;
  } = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.auditPath = options.auditPath ?? path.join(this.workspaceRoot, 'state/audits/evolution');
    this.config = { ...DEFAULT_EVOLUTION_CONFIG, ...options.config };

    this.archive = createArchive({
      maxSize: this.config.maxArchiveSize,
      archivePath: path.join(this.auditPath, 'archive.json'),
    });

    this.bandit = createBandit({
      explorationConstant: this.config.explorationConstant,
      statePath: path.join(this.auditPath, 'bandit_state.json'),
    });

    this.emitters = createDefaultEmitters();
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initialize the controller, loading persisted state.
   */
  async initialize(): Promise<void> {
    // Ensure audit directory exists
    if (!fs.existsSync(this.auditPath)) {
      fs.mkdirSync(this.auditPath, { recursive: true });
    }

    // Load persisted state
    await this.archive.load(this.auditPath);
    await this.bandit.load(this.auditPath);

    // Load baseline if exists
    const baselinePath = path.join(this.auditPath, 'baseline/FitnessReport.v1.json');
    if (fs.existsSync(baselinePath)) {
      const raw = fs.readFileSync(baselinePath, 'utf8');
      this.baselineReport = JSON.parse(raw) as FitnessReport;
    }
  }

  /**
   * Set the baseline report for comparison.
   */
  setBaseline(report: FitnessReport): void {
    this.baselineReport = report;
  }

  // ==========================================================================
  // EVOLUTION CYCLES
  // ==========================================================================

  /**
   * Run a single evolution cycle.
   */
  async runCycle(providerAvailable: boolean = false): Promise<EvolutionCycleResult> {
    const cycleId = `cycle_${Date.now().toString(36)}`;
    const startedAt = new Date().toISOString();

    const context: EvaluationContext = {
      workspaceRoot: this.workspaceRoot,
      baselineReport: this.baselineReport ?? undefined,
      budget: this.config.budgetPerCycle,
      providerAvailable,
    };

    const candidatesGenerated: Variant[] = [];
    const evaluatedVariants: Array<{ variant: Variant; fitness: number }> = [];
    const resourceUsage: ResourceUsage = {
      tokensUsed: 0,
      embeddingsUsed: 0,
      providerCallsUsed: 0,
      durationMs: 0,
    };

    // Generate candidates
    for (let i = 0; i < this.config.candidatesPerCycle; i++) {
      // Select emitter using bandit
      const emitter = this.bandit.selectEmitter(this.emitters);

      // Generate candidate
      const archiveCells = this.archive.getCells();
      const candidate = await emitter.emit(null, archiveCells);
      candidatesGenerated.push(candidate);

      // Evaluate candidate
      const result = await runStagedEvaluation(candidate, context, { stopOnFailure: true });

      // Track resources
      resourceUsage.tokensUsed += result.resourceUsage.tokensUsed;
      resourceUsage.embeddingsUsed += result.resourceUsage.embeddingsUsed;
      resourceUsage.providerCallsUsed += result.resourceUsage.providerCallsUsed;
      resourceUsage.durationMs += result.resourceUsage.durationMs;

      // Check budget
      if (resourceUsage.tokensUsed > context.budget.maxTokens) {
        break;
      }

      // Record fitness
      const measuredFitness = result.fitnessReport.scoringIntegrity.status === 'measured';
      const fitness = measuredFitness ? result.fitnessReport.fitness.overall : 0;
      candidate.evaluated = true;
      candidate.fitnessReport = result.fitnessReport;
      evaluatedVariants.push({ variant: candidate, fitness });

      // Compute reward for bandit with multi-component signal
      const baselineFitness = this.baselineReport?.fitness.overall ?? 0;
      const fitnessDelta = measuredFitness ? fitness - baselineFitness : 0;

      const reward = this.bandit.computeReward(
        fitnessDelta,
        {
          tokens: emitter.estimatedCost.tokens,
          embeddings: emitter.estimatedCost.embeddings,
        },
        {
          fitnessBefore: baselineFitness,
          fitnessAfter: fitness,
          behaviorDescriptor: result.fitnessReport.behaviorDescriptors
            ? Object.values(result.fitnessReport.behaviorDescriptors)
            : undefined,
        }
      );

      // Try to add to archive
      const improved = measuredFitness
        ? this.archive.tryAdd(
            candidate,
            fitness,
            result.fitnessReport.behaviorDescriptors
          )
        : false;

      // Record trial
      this.bandit.recordTrial(emitter.id, reward, improved);
    }

    // Save state
    await this.archive.save(this.auditPath);
    await this.bandit.save(this.auditPath);

    // Find improvements
    const improvements = evaluatedVariants.filter(({ variant }) => {
      if (!variant.fitnessReport?.baselineDelta) return false;
      return this.meetsAcceptancePolicy(variant.fitnessReport.baselineDelta);
    });

    const bestVariant = evaluatedVariants.length > 0
      ? evaluatedVariants.reduce((a, b) => a.fitness > b.fitness ? a : b).variant
      : undefined;

    return {
      cycleId,
      startedAt,
      completedAt: new Date().toISOString(),
      candidatesGenerated: candidatesGenerated.length,
      candidatesEvaluated: evaluatedVariants.length,
      improvementsFound: improvements.length,
      archiveUpdates: this.archive.improvements,
      bestVariant,
      resourceUsage,
    };
  }

  /**
   * Run multiple evolution cycles.
   */
  async runEvolution(
    cycles?: number,
    providerAvailable: boolean = false
  ): Promise<{
    results: EvolutionCycleResult[];
    totalResourceUsage: ResourceUsage;
    bestVariant: Variant | null;
  }> {
    const maxCycles = cycles ?? this.config.maxCycles;
    const results: EvolutionCycleResult[] = [];
    const totalResourceUsage: ResourceUsage = {
      tokensUsed: 0,
      embeddingsUsed: 0,
      providerCallsUsed: 0,
      durationMs: 0,
    };

    for (let i = 0; i < maxCycles; i++) {
      const result = await this.runCycle(providerAvailable);
      results.push(result);

      // Accumulate resources
      totalResourceUsage.tokensUsed += result.resourceUsage.tokensUsed;
      totalResourceUsage.embeddingsUsed += result.resourceUsage.embeddingsUsed;
      totalResourceUsage.providerCallsUsed += result.resourceUsage.providerCallsUsed;
      totalResourceUsage.durationMs += result.resourceUsage.durationMs;

      // Save cycle result
      const resultPath = path.join(
        this.auditPath,
        'cycles',
        `${result.cycleId}.json`
      );
      const resultDir = path.dirname(resultPath);
      if (!fs.existsSync(resultDir)) {
        fs.mkdirSync(resultDir, { recursive: true });
      }
      fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));

      // Check if we should stop early (no improvements in recent cycles)
      const recentResults = results.slice(-3);
      const recentImprovements = recentResults.reduce(
        (sum, r) => sum + r.improvementsFound,
        0
      );
      if (recentResults.length >= 3 && recentImprovements === 0) {
        break; // Convergence detected
      }
    }

    return {
      results,
      totalResourceUsage,
      bestVariant: this.archive.getBestVariant(),
    };
  }

  // ==========================================================================
  // ACCEPTANCE POLICY
  // ==========================================================================

  /**
   * Check if a fitness delta meets the acceptance policy.
   */
  private meetsAcceptancePolicy(delta: FitnessReport['baselineDelta']): boolean {
    if (!delta) return false;

    switch (this.config.acceptancePolicy) {
      case 'pareto':
        return delta.isParetoImprovement;

      case 'any_improvement':
        return delta.improvements.length > 0;

      case 'weighted':
        // Allow improvement if gains outweigh regressions
        return delta.improvements.length > delta.regressions.length;

      default:
        return delta.isParetoImprovement;
    }
  }

  // ==========================================================================
  // QUERIES
  // ==========================================================================

  /**
   * Get current archive statistics.
   */
  getArchiveStats(): ReturnType<EvolutionArchive['getCoverageStats']> {
    return this.archive.getCoverageStats();
  }

  /**
   * Get emitter statistics.
   */
  getEmitterStats(): ReturnType<UCB1Bandit['getStats']> {
    return this.bandit.getStats();
  }

  /**
   * Get the best variant from the archive.
   */
  getBestVariant(): Variant | null {
    return this.archive.getBestVariant();
  }

  /**
   * Get diverse parents for manual selection.
   */
  getDiverseVariants(count: number): Variant[] {
    return this.archive.getDiverseParents(count);
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createEvolutionController(options?: {
  workspaceRoot?: string;
  config?: Partial<EvolutionConfig>;
  auditPath?: string;
}): EvolutionController {
  return new EvolutionController(options);
}
