/**
 * @fileoverview Tests for HierarchicalOrchestrator
 *
 * Following TDD: this test file is created BEFORE implementation.
 * Tests should FAIL initially, then PASS after implementation.
 *
 * The Hierarchical Orchestrator implements a 2-layer agent hierarchy:
 * - Planner: Decomposes tasks into subtasks
 * - Workers: Execute subtasks in parallel
 *
 * Key features:
 * - Task decomposition with dependency tracking
 * - Parallel worker execution respecting dependencies
 * - Graceful failure handling
 * - Dynamic replanning support
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HierarchicalOrchestrator,
  createHierarchicalOrchestrator,
} from '../hierarchical_orchestrator.js';
import type {
  AgentRole,
  TaskDecomposition,
  Subtask,
  OrchestrationConfig,
  OrchestrationResult,
  WorkerExecutor,
  PlannerStrategy,
} from '../hierarchical_orchestrator.js';

describe('HierarchicalOrchestrator', () => {
  // ============================================================================
  // Test 1-3: Basic instantiation and configuration
  // ============================================================================

  describe('instantiation', () => {
    it('creates an orchestrator with default configuration', () => {
      const orchestrator = createHierarchicalOrchestrator();
      expect(orchestrator).toBeDefined();
      expect(orchestrator).toBeInstanceOf(HierarchicalOrchestrator);
    });

    it('creates an orchestrator with custom configuration', () => {
      const config: OrchestrationConfig = {
        maxWorkers: 4,
        plannerRole: {
          id: 'planner-1',
          type: 'planner',
          capabilities: ['decompose', 'analyze'],
          maxConcurrentTasks: 1,
        },
        workerRoles: [
          {
            id: 'worker-1',
            type: 'worker',
            capabilities: ['execute'],
            maxConcurrentTasks: 3,
          },
        ],
        timeout: 30000,
      };

      const orchestrator = createHierarchicalOrchestrator(config);
      expect(orchestrator).toBeDefined();
    });

    it('applies default timeout when not specified', () => {
      const orchestrator = createHierarchicalOrchestrator();
      const config = orchestrator.getConfig();
      expect(config.timeout).toBe(60000); // Default 60 seconds
    });
  });

  // ============================================================================
  // Test 4-6: Task planning
  // ============================================================================

  describe('planTask', () => {
    let orchestrator: HierarchicalOrchestrator;

    beforeEach(() => {
      orchestrator = createHierarchicalOrchestrator();
    });

    it('decomposes a simple task into subtasks', async () => {
      const decomposition = await orchestrator.planTask('Build a web application');

      expect(decomposition.originalTask).toBe('Build a web application');
      expect(decomposition.subtasks.length).toBeGreaterThan(0);
      expect(decomposition.estimatedComplexity).toBeGreaterThan(0);
    });

    it('tracks dependencies between subtasks', async () => {
      const decomposition = await orchestrator.planTask('Build a web application');

      // Each subtask should have a dependencies array
      for (const subtask of decomposition.subtasks) {
        expect(Array.isArray(subtask.dependencies)).toBe(true);
      }

      // If there are dependencies, they should reference valid subtask IDs
      const subtaskIds = new Set(decomposition.subtasks.map((s) => s.id));
      for (const dep of decomposition.dependencies) {
        expect(subtaskIds.has(dep.from)).toBe(true);
        expect(subtaskIds.has(dep.to)).toBe(true);
      }
    });

    it('initializes subtasks with pending status', async () => {
      const decomposition = await orchestrator.planTask('Simple task');

      for (const subtask of decomposition.subtasks) {
        expect(subtask.status).toBe('pending');
      }
    });
  });

  // ============================================================================
  // Test 7-9: Subtask assignment
  // ============================================================================

  describe('assignSubtasks', () => {
    let orchestrator: HierarchicalOrchestrator;

    beforeEach(() => {
      orchestrator = createHierarchicalOrchestrator({
        maxWorkers: 2,
        plannerRole: {
          id: 'planner-1',
          type: 'planner',
          capabilities: ['decompose'],
          maxConcurrentTasks: 1,
        },
        workerRoles: [
          {
            id: 'worker-1',
            type: 'worker',
            capabilities: ['compute', 'analyze'],
            maxConcurrentTasks: 2,
          },
          {
            id: 'worker-2',
            type: 'worker',
            capabilities: ['fetch', 'io'],
            maxConcurrentTasks: 2,
          },
        ],
        timeout: 60000,
      });
    });

    it('assigns subtasks to workers based on capabilities', async () => {
      const decomposition: TaskDecomposition = {
        originalTask: 'Test task',
        subtasks: [
          {
            id: 'sub-1',
            description: 'Compute result',
            status: 'pending',
            dependencies: [],
          },
          {
            id: 'sub-2',
            description: 'Fetch data',
            status: 'pending',
            dependencies: [],
          },
        ],
        dependencies: [],
        estimatedComplexity: 2,
      };

      const assignments = orchestrator.assignSubtasks(decomposition);

      // Should have assignments
      expect(assignments.size).toBeGreaterThan(0);

      // Each worker should have their assigned subtasks
      for (const [workerId, subtasks] of assignments) {
        expect(Array.isArray(subtasks)).toBe(true);
        for (const subtask of subtasks) {
          expect(subtask.assignedWorker).toBe(workerId);
        }
      }
    });

    it('respects maxConcurrentTasks for each worker', async () => {
      const decomposition: TaskDecomposition = {
        originalTask: 'Many tasks',
        subtasks: [
          { id: 'sub-1', description: 'Task 1', status: 'pending', dependencies: [] },
          { id: 'sub-2', description: 'Task 2', status: 'pending', dependencies: [] },
          { id: 'sub-3', description: 'Task 3', status: 'pending', dependencies: [] },
          { id: 'sub-4', description: 'Task 4', status: 'pending', dependencies: [] },
          { id: 'sub-5', description: 'Task 5', status: 'pending', dependencies: [] },
        ],
        dependencies: [],
        estimatedComplexity: 5,
      };

      const assignments = orchestrator.assignSubtasks(decomposition);

      // Each worker should not exceed their maxConcurrentTasks
      for (const [workerId, subtasks] of assignments) {
        const worker = orchestrator.getConfig().workerRoles.find((w) => w.id === workerId);
        if (worker) {
          expect(subtasks.length).toBeLessThanOrEqual(worker.maxConcurrentTasks);
        }
      }
    });

    it('distributes work across available workers', async () => {
      const decomposition: TaskDecomposition = {
        originalTask: 'Distributed task',
        subtasks: [
          { id: 'sub-1', description: 'Task 1', status: 'pending', dependencies: [] },
          { id: 'sub-2', description: 'Task 2', status: 'pending', dependencies: [] },
          { id: 'sub-3', description: 'Task 3', status: 'pending', dependencies: [] },
          { id: 'sub-4', description: 'Task 4', status: 'pending', dependencies: [] },
        ],
        dependencies: [],
        estimatedComplexity: 4,
      };

      const assignments = orchestrator.assignSubtasks(decomposition);

      // With 2 workers and 4 tasks, both workers should have work
      expect(assignments.size).toBe(2);
    });
  });

  // ============================================================================
  // Test 10-12: Worker execution
  // ============================================================================

  describe('executeWorkers', () => {
    let orchestrator: HierarchicalOrchestrator;
    let mockExecutor: WorkerExecutor;

    beforeEach(() => {
      orchestrator = createHierarchicalOrchestrator();
      mockExecutor = vi.fn().mockImplementation(async (subtask: Subtask) => {
        return { subtaskId: subtask.id, result: `Result for ${subtask.id}` };
      });
      orchestrator.setWorkerExecutor(mockExecutor);
    });

    it('executes subtasks in parallel when no dependencies', async () => {
      const assignments = new Map<string, Subtask[]>([
        [
          'worker-1',
          [
            { id: 'sub-1', description: 'Task 1', status: 'pending', dependencies: [] },
            { id: 'sub-2', description: 'Task 2', status: 'pending', dependencies: [] },
          ],
        ],
      ]);

      const results = await orchestrator.executeWorkers(assignments);

      expect(results.size).toBe(2);
      expect(results.get('sub-1')).toBeDefined();
      expect(results.get('sub-2')).toBeDefined();
    });

    it('respects dependency order during execution', async () => {
      const executionOrder: string[] = [];
      const delayedExecutor: WorkerExecutor = vi.fn().mockImplementation(async (subtask: Subtask) => {
        executionOrder.push(subtask.id);
        return { subtaskId: subtask.id, result: `Result for ${subtask.id}` };
      });
      orchestrator.setWorkerExecutor(delayedExecutor);

      // sub-2 depends on sub-1
      const assignments = new Map<string, Subtask[]>([
        [
          'worker-1',
          [
            { id: 'sub-1', description: 'First task', status: 'pending', dependencies: [] },
            { id: 'sub-2', description: 'Depends on first', status: 'pending', dependencies: ['sub-1'] },
          ],
        ],
      ]);

      await orchestrator.executeWorkers(assignments);

      // sub-1 should be executed before sub-2
      expect(executionOrder.indexOf('sub-1')).toBeLessThan(executionOrder.indexOf('sub-2'));
    });

    it('handles worker failures gracefully', async () => {
      const failingExecutor: WorkerExecutor = vi.fn().mockImplementation(async (subtask: Subtask) => {
        if (subtask.id === 'sub-2') {
          throw new Error('Worker failed');
        }
        return { subtaskId: subtask.id, result: `Result for ${subtask.id}` };
      });
      orchestrator.setWorkerExecutor(failingExecutor);

      const assignments = new Map<string, Subtask[]>([
        [
          'worker-1',
          [
            { id: 'sub-1', description: 'Task 1', status: 'pending', dependencies: [] },
            { id: 'sub-2', description: 'Task 2', status: 'pending', dependencies: [] },
            { id: 'sub-3', description: 'Task 3', status: 'pending', dependencies: [] },
          ],
        ],
      ]);

      const results = await orchestrator.executeWorkers(assignments);

      // sub-1 and sub-3 should succeed
      expect(results.get('sub-1')).toBeDefined();
      expect(results.get('sub-3')).toBeDefined();
      // sub-2 should have error info
      expect(results.get('sub-2')).toHaveProperty('error');
    });
  });

  // ============================================================================
  // Test 13-15: Result aggregation
  // ============================================================================

  describe('aggregateResults', () => {
    let orchestrator: HierarchicalOrchestrator;

    beforeEach(() => {
      orchestrator = createHierarchicalOrchestrator();
    });

    it('combines results from all workers', () => {
      const results = new Map<string, unknown>([
        ['sub-1', { value: 10 }],
        ['sub-2', { value: 20 }],
        ['sub-3', { value: 30 }],
      ]);

      const aggregated = orchestrator.aggregateResults(results);

      expect(aggregated).toBeDefined();
      expect(typeof aggregated).toBe('object');
    });

    it('handles partial failures in aggregation', () => {
      const results = new Map<string, unknown>([
        ['sub-1', { value: 10 }],
        ['sub-2', { error: 'Failed' }],
        ['sub-3', { value: 30 }],
      ]);

      const aggregated = orchestrator.aggregateResults(results) as {
        successful: unknown[];
        failed: unknown[];
      };

      expect(aggregated.successful).toBeDefined();
      expect(aggregated.failed).toBeDefined();
      expect(aggregated.failed.length).toBe(1);
    });

    it('preserves order based on subtask dependencies', () => {
      const results = new Map<string, unknown>([
        ['sub-1', { step: 1, output: 'A' }],
        ['sub-2', { step: 2, output: 'B' }],
        ['sub-3', { step: 3, output: 'C' }],
      ]);

      const aggregated = orchestrator.aggregateResults(results) as { results: unknown[] };

      // Results should maintain logical order
      expect(Array.isArray(aggregated.results)).toBe(true);
    });
  });

  // ============================================================================
  // Test 16-17: Full orchestration
  // ============================================================================

  describe('orchestrate', () => {
    let orchestrator: HierarchicalOrchestrator;
    let mockExecutor: WorkerExecutor;

    beforeEach(() => {
      orchestrator = createHierarchicalOrchestrator();
      mockExecutor = vi.fn().mockImplementation(async (subtask: Subtask) => {
        return { subtaskId: subtask.id, result: `Result for ${subtask.id}` };
      });
      orchestrator.setWorkerExecutor(mockExecutor);
    });

    it('orchestrates complete task from planning to result', async () => {
      const result = await orchestrator.orchestrate('Build a component');

      expect(result.task).toBe('Build a component');
      expect(result.decomposition).toBeDefined();
      expect(result.decomposition.subtasks.length).toBeGreaterThan(0);
      expect(result.workerResults.size).toBeGreaterThan(0);
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.duration).toBe('number');
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('marks orchestration as successful when all subtasks complete', async () => {
      const result = await orchestrator.orchestrate('Simple task');

      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });

  // ============================================================================
  // Test 18: Dynamic replanning
  // ============================================================================

  describe('dynamic replanning', () => {
    let orchestrator: HierarchicalOrchestrator;

    beforeEach(() => {
      orchestrator = createHierarchicalOrchestrator();
    });

    it('supports replanning when subtasks fail', async () => {
      // Track attempts per subtask ID
      const attemptsBySubtask = new Map<string, number>();

      const replanningExecutor: WorkerExecutor = vi.fn().mockImplementation(async (subtask: Subtask) => {
        const attempts = (attemptsBySubtask.get(subtask.id) || 0) + 1;
        attemptsBySubtask.set(subtask.id, attempts);

        // First attempt for any subtask fails
        if (attempts === 1) {
          throw new Error('Initial failure');
        }
        return { subtaskId: subtask.id, result: 'Success on retry' };
      });
      orchestrator.setWorkerExecutor(replanningExecutor);
      orchestrator.enableReplanning(true);

      const result = await orchestrator.orchestrate('Task that needs replanning');

      // Verify replanning was attempted - at least one subtask should have been retried
      const retriedSubtasks = Array.from(attemptsBySubtask.values()).filter((v) => v > 1);
      expect(retriedSubtasks.length).toBeGreaterThan(0);
      // Should eventually succeed through replanning
      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // Test 19: Timeout handling
  // ============================================================================

  describe('timeout handling', () => {
    it('fails orchestration when timeout is exceeded', async () => {
      const orchestrator = createHierarchicalOrchestrator({
        maxWorkers: 1,
        plannerRole: {
          id: 'planner-1',
          type: 'planner',
          capabilities: ['decompose'],
          maxConcurrentTasks: 1,
        },
        workerRoles: [
          {
            id: 'worker-1',
            type: 'worker',
            capabilities: ['execute'],
            maxConcurrentTasks: 1,
          },
        ],
        timeout: 100, // 100ms timeout
      });

      const slowExecutor: WorkerExecutor = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms delay
        return { result: 'slow' };
      });
      orchestrator.setWorkerExecutor(slowExecutor);

      const result = await orchestrator.orchestrate('Slow task');

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes('timeout'))).toBe(true);
    });
  });

  // ============================================================================
  // Test 20: Custom planner strategy
  // ============================================================================

  describe('custom planner strategy', () => {
    it('allows custom planning strategy', async () => {
      const customPlanner: PlannerStrategy = {
        decompose: vi.fn().mockResolvedValue({
          originalTask: 'Custom task',
          subtasks: [
            { id: 'custom-1', description: 'Custom subtask', status: 'pending', dependencies: [] },
          ],
          dependencies: [],
          estimatedComplexity: 1,
        }),
      };

      const orchestrator = createHierarchicalOrchestrator();
      orchestrator.setPlannerStrategy(customPlanner);

      const decomposition = await orchestrator.planTask('Any task');

      expect(customPlanner.decompose).toHaveBeenCalledWith('Any task');
      expect(decomposition.subtasks[0].id).toBe('custom-1');
    });
  });

  // ============================================================================
  // Test 21: Worker communication
  // ============================================================================

  describe('worker communication', () => {
    let orchestrator: HierarchicalOrchestrator;

    beforeEach(() => {
      orchestrator = createHierarchicalOrchestrator();
    });

    it('passes results from completed subtasks to dependent subtasks', async () => {
      const receivedContext: Map<string, unknown> = new Map();

      const contextAwareExecutor: WorkerExecutor = vi.fn().mockImplementation(
        async (subtask: Subtask, context?: Map<string, unknown>) => {
          if (context) {
            receivedContext.set(subtask.id, context);
          }
          return { subtaskId: subtask.id, result: `Result from ${subtask.id}` };
        }
      );
      orchestrator.setWorkerExecutor(contextAwareExecutor);

      // sub-2 depends on sub-1
      const assignments = new Map<string, Subtask[]>([
        [
          'worker-1',
          [
            { id: 'sub-1', description: 'First', status: 'pending', dependencies: [] },
            { id: 'sub-2', description: 'Second', status: 'pending', dependencies: ['sub-1'] },
          ],
        ],
      ]);

      await orchestrator.executeWorkers(assignments);

      // sub-2 should have received context from sub-1
      const sub2Context = receivedContext.get('sub-2') as Map<string, unknown> | undefined;
      expect(sub2Context).toBeDefined();
      if (sub2Context) {
        expect(sub2Context.has('sub-1')).toBe(true);
      }
    });
  });

  // ============================================================================
  // Test 22: Concurrent execution limits
  // ============================================================================

  describe('concurrent execution limits', () => {
    it('respects global maxWorkers limit', async () => {
      const orchestrator = createHierarchicalOrchestrator({
        maxWorkers: 2,
        plannerRole: {
          id: 'planner-1',
          type: 'planner',
          capabilities: ['decompose'],
          maxConcurrentTasks: 1,
        },
        workerRoles: [
          { id: 'worker-1', type: 'worker', capabilities: ['execute'], maxConcurrentTasks: 5 },
          { id: 'worker-2', type: 'worker', capabilities: ['execute'], maxConcurrentTasks: 5 },
          { id: 'worker-3', type: 'worker', capabilities: ['execute'], maxConcurrentTasks: 5 },
        ],
        timeout: 60000,
      });

      let concurrentCount = 0;
      let maxConcurrent = 0;

      const trackingExecutor: WorkerExecutor = vi.fn().mockImplementation(async (subtask: Subtask) => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise((resolve) => setTimeout(resolve, 50));
        concurrentCount--;
        return { subtaskId: subtask.id, result: 'done' };
      });
      orchestrator.setWorkerExecutor(trackingExecutor);

      const assignments = new Map<string, Subtask[]>([
        [
          'worker-1',
          [
            { id: 'sub-1', description: 'Task 1', status: 'pending', dependencies: [] },
            { id: 'sub-2', description: 'Task 2', status: 'pending', dependencies: [] },
          ],
        ],
        [
          'worker-2',
          [
            { id: 'sub-3', description: 'Task 3', status: 'pending', dependencies: [] },
            { id: 'sub-4', description: 'Task 4', status: 'pending', dependencies: [] },
          ],
        ],
        [
          'worker-3',
          [
            { id: 'sub-5', description: 'Task 5', status: 'pending', dependencies: [] },
            { id: 'sub-6', description: 'Task 6', status: 'pending', dependencies: [] },
          ],
        ],
      ]);

      await orchestrator.executeWorkers(assignments);

      // Only 2 workers should execute concurrently due to maxWorkers: 2
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  // ============================================================================
  // Test 23: Error collection
  // ============================================================================

  describe('error collection', () => {
    it('collects all errors during orchestration', async () => {
      const orchestrator = createHierarchicalOrchestrator();

      const multiFailExecutor: WorkerExecutor = vi.fn().mockImplementation(async (subtask: Subtask) => {
        if (subtask.id === 'sub-1') {
          throw new Error('Error 1');
        }
        if (subtask.id === 'sub-3') {
          throw new Error('Error 3');
        }
        return { subtaskId: subtask.id, result: 'ok' };
      });
      orchestrator.setWorkerExecutor(multiFailExecutor);

      const result = await orchestrator.orchestrate('Task with multiple failures');

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('Error 1'))).toBe(true);
    });
  });

  // ============================================================================
  // Test 24: State inspection
  // ============================================================================

  describe('state inspection', () => {
    it('provides access to current orchestration state', async () => {
      const orchestrator = createHierarchicalOrchestrator();
      orchestrator.setWorkerExecutor(async (subtask: Subtask) => {
        return { subtaskId: subtask.id, result: 'done' };
      });

      // Start orchestration
      const resultPromise = orchestrator.orchestrate('Inspectable task');

      // Can inspect state
      const state = orchestrator.getState();
      expect(state).toBeDefined();
      expect(typeof state.isRunning).toBe('boolean');

      await resultPromise;
    });
  });

  // ============================================================================
  // Test 25: Edge cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles empty task gracefully', async () => {
      const orchestrator = createHierarchicalOrchestrator();
      orchestrator.setWorkerExecutor(async (subtask: Subtask) => {
        return { subtaskId: subtask.id, result: 'done' };
      });

      const result = await orchestrator.orchestrate('');

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes('empty'))).toBe(true);
    });

    it('handles circular dependencies in subtasks', async () => {
      const orchestrator = createHierarchicalOrchestrator();

      // Create a decomposition with circular dependency
      const decomposition: TaskDecomposition = {
        originalTask: 'Circular task',
        subtasks: [
          { id: 'sub-1', description: 'Task 1', status: 'pending', dependencies: ['sub-2'] },
          { id: 'sub-2', description: 'Task 2', status: 'pending', dependencies: ['sub-1'] },
        ],
        dependencies: [
          { from: 'sub-1', to: 'sub-2' },
          { from: 'sub-2', to: 'sub-1' },
        ],
        estimatedComplexity: 2,
      };

      const hasCircular = orchestrator.detectCircularDependencies(decomposition);
      expect(hasCircular).toBe(true);
    });
  });
});
