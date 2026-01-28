/**
 * @fileoverview Hierarchical Agent Orchestrator
 *
 * Implements WU-AGENT-001: 2-layer agent hierarchy for task orchestration.
 *
 * Architecture:
 * - Planner layer: Decomposes complex tasks into manageable subtasks
 * - Worker layer: Executes subtasks in parallel, respecting dependencies
 *
 * Key features:
 * - Task decomposition with dependency tracking
 * - Parallel worker execution with configurable concurrency
 * - Graceful failure handling with optional replanning
 * - Clear role separation between planner and workers
 *
 * Based on multi-agent orchestration patterns from research.
 */

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Role definition for agents in the hierarchy.
 */
export interface AgentRole {
  /** Unique identifier for this role */
  id: string;
  /** Type of role: planner or worker */
  type: 'planner' | 'worker';
  /** Capabilities this role provides */
  capabilities: string[];
  /** Maximum concurrent tasks this role can handle */
  maxConcurrentTasks: number;
}

/**
 * Represents a subtask broken down from the main task.
 */
export interface Subtask {
  /** Unique identifier for this subtask */
  id: string;
  /** Human-readable description */
  description: string;
  /** ID of the worker assigned to this subtask */
  assignedWorker?: string;
  /** Current execution status */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  /** Result of execution (if completed) */
  result?: unknown;
  /** IDs of subtasks that must complete before this one */
  dependencies: string[];
}

/**
 * Result of task decomposition by the planner.
 */
export interface TaskDecomposition {
  /** The original task description */
  originalTask: string;
  /** Subtasks created from decomposition */
  subtasks: Subtask[];
  /** Explicit dependency relationships */
  dependencies: { from: string; to: string }[];
  /** Estimated complexity score (1-10) */
  estimatedComplexity: number;
}

/**
 * Configuration for the orchestrator.
 */
export interface OrchestrationConfig {
  /** Maximum number of workers to run concurrently */
  maxWorkers: number;
  /** The planner role definition */
  plannerRole: AgentRole;
  /** Available worker role definitions */
  workerRoles: AgentRole[];
  /** Timeout for the entire orchestration (ms) */
  timeout: number;
}

/**
 * Result of orchestrating a task.
 */
export interface OrchestrationResult {
  /** The original task */
  task: string;
  /** How the task was decomposed */
  decomposition: TaskDecomposition;
  /** Results from each worker */
  workerResults: Map<string, unknown>;
  /** Whether orchestration succeeded */
  success: boolean;
  /** Duration in milliseconds */
  duration: number;
  /** Errors encountered */
  errors: string[];
}

/**
 * Current state of the orchestrator.
 */
export interface OrchestrationState {
  /** Whether orchestration is currently running */
  isRunning: boolean;
  /** Current decomposition (if any) */
  currentDecomposition?: TaskDecomposition;
  /** Completed subtask count */
  completedSubtasks: number;
  /** Failed subtask count */
  failedSubtasks: number;
}

/**
 * Function type for worker execution.
 */
export type WorkerExecutor = (
  subtask: Subtask,
  context?: Map<string, unknown>
) => Promise<unknown>;

/**
 * Strategy interface for custom planning.
 */
export interface PlannerStrategy {
  decompose(task: string): Promise<TaskDecomposition>;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: OrchestrationConfig = {
  maxWorkers: 4,
  plannerRole: {
    id: 'default-planner',
    type: 'planner',
    capabilities: ['decompose', 'analyze', 'prioritize'],
    maxConcurrentTasks: 1,
  },
  workerRoles: [
    {
      id: 'default-worker-1',
      type: 'worker',
      capabilities: ['execute', 'compute'],
      maxConcurrentTasks: 3,
    },
    {
      id: 'default-worker-2',
      type: 'worker',
      capabilities: ['execute', 'io'],
      maxConcurrentTasks: 3,
    },
  ],
  timeout: 60000, // 60 seconds
};

// ============================================================================
// DEFAULT PLANNER STRATEGY
// ============================================================================

/**
 * Default heuristic-based planner strategy.
 * Decomposes tasks based on keywords and patterns.
 */
class DefaultPlannerStrategy implements PlannerStrategy {
  async decompose(task: string): Promise<TaskDecomposition> {
    // Simple heuristic decomposition based on task analysis
    const subtasks: Subtask[] = [];
    const dependencies: { from: string; to: string }[] = [];

    // Analyze the task to determine complexity
    const taskLower = task.toLowerCase();
    const complexity = this.estimateComplexity(taskLower);

    // Generate subtasks based on common patterns
    if (complexity === 1) {
      // Simple task - single subtask
      subtasks.push({
        id: 'sub-1',
        description: task,
        status: 'pending',
        dependencies: [],
      });
    } else {
      // Complex task - multiple phases
      const phases = this.identifyPhases(taskLower);

      phases.forEach((phase, index) => {
        const subtask: Subtask = {
          id: `sub-${index + 1}`,
          description: phase,
          status: 'pending',
          dependencies: index > 0 ? [`sub-${index}`] : [],
        };
        subtasks.push(subtask);

        // Add dependency edges
        if (index > 0) {
          dependencies.push({
            from: `sub-${index}`,
            to: `sub-${index + 1}`,
          });
        }
      });
    }

    return {
      originalTask: task,
      subtasks,
      dependencies,
      estimatedComplexity: complexity,
    };
  }

  private estimateComplexity(task: string): number {
    let complexity = 1;

    // Keywords that increase complexity
    const complexKeywords = [
      'build',
      'create',
      'implement',
      'develop',
      'design',
      'analyze',
      'test',
      'deploy',
      'integrate',
      'refactor',
    ];

    for (const keyword of complexKeywords) {
      if (task.includes(keyword)) {
        complexity++;
      }
    }

    // Length-based complexity
    if (task.length > 50) complexity++;
    if (task.length > 100) complexity++;

    return Math.min(complexity, 10);
  }

  private identifyPhases(task: string): string[] {
    const phases: string[] = [];

    // Common development phases
    if (task.includes('build') || task.includes('create') || task.includes('implement')) {
      phases.push('Analyze requirements and dependencies');
      phases.push('Design solution architecture');
      phases.push('Implement core functionality');
      if (task.includes('test')) {
        phases.push('Write and run tests');
      }
      phases.push('Validate and finalize');
    } else if (task.includes('analyze')) {
      phases.push('Gather data and context');
      phases.push('Perform analysis');
      phases.push('Generate insights and report');
    } else if (task.includes('refactor')) {
      phases.push('Analyze current implementation');
      phases.push('Identify improvement areas');
      phases.push('Apply refactoring changes');
      phases.push('Verify behavior preservation');
    } else {
      // Generic phases for unknown tasks
      phases.push('Prepare and plan');
      phases.push('Execute main work');
      phases.push('Review and complete');
    }

    return phases;
  }
}

// ============================================================================
// HIERARCHICAL ORCHESTRATOR
// ============================================================================

/**
 * Orchestrator implementing 2-layer agent hierarchy.
 */
export class HierarchicalOrchestrator {
  private config: OrchestrationConfig;
  private plannerStrategy: PlannerStrategy;
  private workerExecutor: WorkerExecutor | null = null;
  private replanningEnabled: boolean = false;
  private state: OrchestrationState = {
    isRunning: false,
    completedSubtasks: 0,
    failedSubtasks: 0,
  };

  constructor(config: Partial<OrchestrationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.plannerStrategy = new DefaultPlannerStrategy();
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get current configuration.
   */
  getConfig(): OrchestrationConfig {
    return { ...this.config };
  }

  /**
   * Get current orchestration state.
   */
  getState(): OrchestrationState {
    return { ...this.state };
  }

  /**
   * Set custom planner strategy.
   */
  setPlannerStrategy(strategy: PlannerStrategy): void {
    this.plannerStrategy = strategy;
  }

  /**
   * Set worker executor function.
   */
  setWorkerExecutor(executor: WorkerExecutor): void {
    this.workerExecutor = executor;
  }

  /**
   * Enable or disable replanning on failures.
   */
  enableReplanning(enabled: boolean): void {
    this.replanningEnabled = enabled;
  }

  // ============================================================================
  // Task Planning
  // ============================================================================

  /**
   * Decompose a task into subtasks.
   */
  async planTask(task: string): Promise<TaskDecomposition> {
    return this.plannerStrategy.decompose(task);
  }

  // ============================================================================
  // Subtask Assignment
  // ============================================================================

  /**
   * Assign subtasks to workers based on capabilities and load.
   */
  assignSubtasks(decomposition: TaskDecomposition): Map<string, Subtask[]> {
    const assignments = new Map<string, Subtask[]>();
    const workerLoads = new Map<string, number>();

    // Initialize worker loads
    for (const worker of this.config.workerRoles) {
      assignments.set(worker.id, []);
      workerLoads.set(worker.id, 0);
    }

    // Round-robin assignment with load balancing
    for (const subtask of decomposition.subtasks) {
      // Find worker with lowest load that hasn't exceeded max
      let selectedWorker: AgentRole | null = null;
      let minLoad = Infinity;

      for (const worker of this.config.workerRoles) {
        const currentLoad = workerLoads.get(worker.id) || 0;
        if (currentLoad < worker.maxConcurrentTasks && currentLoad < minLoad) {
          minLoad = currentLoad;
          selectedWorker = worker;
        }
      }

      if (selectedWorker) {
        const workerSubtasks = assignments.get(selectedWorker.id) || [];
        const assignedSubtask = { ...subtask, assignedWorker: selectedWorker.id };
        workerSubtasks.push(assignedSubtask);
        assignments.set(selectedWorker.id, workerSubtasks);
        workerLoads.set(selectedWorker.id, (workerLoads.get(selectedWorker.id) || 0) + 1);
      }
    }

    // Remove empty worker assignments
    for (const [workerId, subtasks] of assignments) {
      if (subtasks.length === 0) {
        assignments.delete(workerId);
      }
    }

    return assignments;
  }

  // ============================================================================
  // Worker Execution
  // ============================================================================

  /**
   * Execute subtasks through workers, respecting dependencies.
   */
  async executeWorkers(assignments: Map<string, Subtask[]>): Promise<Map<string, unknown>> {
    const results = new Map<string, unknown>();
    const completedSubtasks = new Set<string>();

    if (!this.workerExecutor) {
      throw new Error('Worker executor not set');
    }

    // Flatten all subtasks for dependency tracking
    const allSubtasks: Subtask[] = [];
    for (const subtasks of assignments.values()) {
      allSubtasks.push(...subtasks);
    }

    // Track pending subtasks by ID
    const pendingIds = new Set(allSubtasks.map((st) => st.id));
    const subtaskMap = new Map(allSubtasks.map((st) => [st.id, st]));

    // Execute a single subtask
    const executeSubtask = async (subtask: Subtask): Promise<void> => {
      // Build context from completed dependencies
      const context = new Map<string, unknown>();
      for (const depId of subtask.dependencies) {
        if (results.has(depId)) {
          context.set(depId, results.get(depId));
        }
      }

      try {
        subtask.status = 'in_progress';
        const result = await this.workerExecutor!(subtask, context.size > 0 ? context : undefined);
        subtask.status = 'completed';
        subtask.result = result;
        results.set(subtask.id, result);
      } catch (error) {
        subtask.status = 'failed';
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.set(subtask.id, { error: errorMessage });
        this.state.failedSubtasks++;
      }

      completedSubtasks.add(subtask.id);
      pendingIds.delete(subtask.id);
      this.state.completedSubtasks++;
    };

    // Get subtasks that are ready to execute (all dependencies met)
    const getReadySubtasks = (): Subtask[] => {
      const ready: Subtask[] = [];
      for (const id of pendingIds) {
        const subtask = subtaskMap.get(id);
        if (subtask && subtask.status === 'pending') {
          const depsReady = subtask.dependencies.every((dep) => completedSubtasks.has(dep));
          if (depsReady) {
            ready.push(subtask);
          }
        }
      }
      return ready;
    };

    // Process in waves, respecting maxWorkers
    let runningCount = 0;
    const maxConcurrent = this.config.maxWorkers;

    // Use a simple sequential approach with controlled parallelism
    while (pendingIds.size > 0) {
      const ready = getReadySubtasks();

      if (ready.length === 0) {
        // No ready tasks - check for deadlock (circular deps)
        if (runningCount === 0) {
          // Deadlock - break to avoid infinite loop
          break;
        }
        // Wait for running tasks
        await new Promise((resolve) => setTimeout(resolve, 5));
        continue;
      }

      // Start tasks up to maxConcurrent
      const toStart = ready.slice(0, maxConcurrent - runningCount);

      if (toStart.length === 0) {
        // At max concurrency, wait a bit
        await new Promise((resolve) => setTimeout(resolve, 5));
        continue;
      }

      // Execute batch and wait
      const promises = toStart.map((subtask) => {
        runningCount++;
        return executeSubtask(subtask).finally(() => {
          runningCount--;
        });
      });

      // Wait for at least one to complete before continuing
      await Promise.race(promises);

      // Give other tasks a chance to complete
      await Promise.all(promises.map((p) => p.catch(() => {})));
    }

    return results;
  }

  // ============================================================================
  // Result Aggregation
  // ============================================================================

  /**
   * Aggregate results from all workers into a unified result.
   */
  aggregateResults(results: Map<string, unknown>): unknown {
    const successful: unknown[] = [];
    const failed: unknown[] = [];
    const orderedResults: unknown[] = [];

    for (const [subtaskId, result] of results) {
      const resultObj = result as { error?: string };
      if (resultObj && typeof resultObj === 'object' && 'error' in resultObj) {
        failed.push({ subtaskId, ...resultObj });
      } else {
        successful.push({ subtaskId, result });
        orderedResults.push(result);
      }
    }

    return {
      results: orderedResults,
      successful,
      failed,
      summary: {
        total: results.size,
        successCount: successful.length,
        failureCount: failed.length,
      },
    };
  }

  // ============================================================================
  // Full Orchestration
  // ============================================================================

  /**
   * Orchestrate a complete task from planning through execution.
   */
  async orchestrate(
    task: string,
    config?: Partial<OrchestrationConfig>
  ): Promise<OrchestrationResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const effectiveConfig = config ? { ...this.config, ...config } : this.config;

    // Validate input
    if (!task || task.trim() === '') {
      return {
        task,
        decomposition: {
          originalTask: task,
          subtasks: [],
          dependencies: [],
          estimatedComplexity: 0,
        },
        workerResults: new Map(),
        success: false,
        duration: Date.now() - startTime,
        errors: ['Task cannot be empty'],
      };
    }

    this.state = {
      isRunning: true,
      completedSubtasks: 0,
      failedSubtasks: 0,
    };

    let decomposition: TaskDecomposition;
    let workerResults = new Map<string, unknown>();

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Orchestration timeout exceeded')), effectiveConfig.timeout);
      });

      // Plan the task
      decomposition = await Promise.race([this.planTask(task), timeoutPromise]);
      this.state.currentDecomposition = decomposition;

      // Check for empty decomposition
      if (decomposition.subtasks.length === 0) {
        return {
          task,
          decomposition,
          workerResults: new Map(),
          success: false,
          duration: Date.now() - startTime,
          errors: ['Task decomposition produced no subtasks'],
        };
      }

      // Detect circular dependencies
      if (this.detectCircularDependencies(decomposition)) {
        return {
          task,
          decomposition,
          workerResults: new Map(),
          success: false,
          duration: Date.now() - startTime,
          errors: ['Circular dependencies detected in task decomposition'],
        };
      }

      // Assign subtasks to workers
      const assignments = this.assignSubtasks(decomposition);

      // Execute with timeout
      workerResults = await Promise.race([
        this.executeWorkers(assignments),
        timeoutPromise,
      ]);

      // Collect errors from failed subtasks
      const failedSubtaskIds: string[] = [];
      for (const [subtaskId, result] of workerResults) {
        const resultObj = result as { error?: string };
        if (resultObj && typeof resultObj === 'object' && 'error' in resultObj) {
          errors.push(`Subtask ${subtaskId}: ${resultObj.error}`);
          failedSubtaskIds.push(subtaskId);
        }
      }

      // Handle replanning if enabled and there were failures
      if (this.replanningEnabled && failedSubtaskIds.length > 0) {
        // Get the failed subtasks from the decomposition
        const failedSubtasks = decomposition.subtasks.filter((st) =>
          failedSubtaskIds.includes(st.id)
        );

        if (failedSubtasks.length > 0) {
          // Reset failed subtasks for retry
          for (const st of failedSubtasks) {
            st.status = 'pending';
            st.result = undefined;
          }

          // Re-assign and re-execute
          const reAssignments = this.assignSubtasks({
            ...decomposition,
            subtasks: failedSubtasks,
          });

          const reResults = await Promise.race([
            this.executeWorkers(reAssignments),
            timeoutPromise,
          ]);

          // Merge results (overwrite failed results with retry results)
          for (const [id, result] of reResults) {
            workerResults.set(id, result);
          }

          // Re-count errors from updated results
          errors.length = 0;
          for (const [subtaskId, result] of workerResults) {
            const resultObj = result as { error?: string };
            if (resultObj && typeof resultObj === 'object' && 'error' in resultObj) {
              errors.push(`Subtask ${subtaskId}: ${resultObj.error}`);
            }
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('timeout')) {
        errors.push('Orchestration timeout exceeded');
      } else {
        errors.push(errorMessage);
      }

      this.state.isRunning = false;

      return {
        task,
        decomposition: this.state.currentDecomposition || {
          originalTask: task,
          subtasks: [],
          dependencies: [],
          estimatedComplexity: 0,
        },
        workerResults,
        success: false,
        duration: Date.now() - startTime,
        errors,
      };
    }

    this.state.isRunning = false;

    return {
      task,
      decomposition,
      workerResults,
      success: errors.length === 0,
      duration: Date.now() - startTime,
      errors,
    };
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Detect circular dependencies in task decomposition.
   */
  detectCircularDependencies(decomposition: TaskDecomposition): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const subtaskMap = new Map(decomposition.subtasks.map((st) => [st.id, st]));

    const hasCycle = (subtaskId: string): boolean => {
      if (recursionStack.has(subtaskId)) {
        return true;
      }
      if (visited.has(subtaskId)) {
        return false;
      }

      visited.add(subtaskId);
      recursionStack.add(subtaskId);

      const subtask = subtaskMap.get(subtaskId);
      if (subtask) {
        for (const depId of subtask.dependencies) {
          if (hasCycle(depId)) {
            return true;
          }
        }
      }

      recursionStack.delete(subtaskId);
      return false;
    };

    for (const subtask of decomposition.subtasks) {
      if (hasCycle(subtask.id)) {
        return true;
      }
    }

    return false;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new HierarchicalOrchestrator instance.
 */
export function createHierarchicalOrchestrator(
  config?: Partial<OrchestrationConfig>
): HierarchicalOrchestrator {
  return new HierarchicalOrchestrator(config);
}
