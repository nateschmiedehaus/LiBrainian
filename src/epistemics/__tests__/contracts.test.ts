/**
 * @fileoverview Tier-0 Tests for Primitive Contracts
 *
 * Deterministic tests that verify the Contract system implementation.
 * These tests require no external providers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ContractExecutor,
  ContractViolation,
  ContractViolationError,
  getContractRegistry,
  getGlobalContractRegistry,
  registerContract,
  getContract,
  resetContractRegistry,
  createContractId,
  createPrimitiveId,
  createPrecondition,
  createPostcondition,
  createInvariant,
  createContract,
  validateContract,
  createConfidenceFactor,
  createExpectedError,
  DEFAULT_RETRY_POLICY,
  DEFAULT_ERROR_SPEC,
  DEFAULT_CONFIDENCE_DERIVATION,
  SYNTACTIC_CONFIDENCE_CONTRACT,
  SEQUENCE_CONFIDENCE_CONTRACT,
  PARALLEL_ALL_CONFIDENCE_CONTRACT,
  PARALLEL_ANY_CONFIDENCE_CONTRACT,
  UNCALIBRATED_CONFIDENCE_CONTRACT,
  MEASURED_CONFIDENCE_CONTRACT,
  registerBuiltInContracts,
  type PrimitiveContract,
  type ExecutionContext,
} from '../contracts.js';
import { createSessionId } from '../evidence_ledger.js';

// Test types
interface TestInput {
  value: number;
  shouldFail?: boolean;
}

interface TestOutput {
  result: number;
  processed: boolean;
}

describe('PrimitiveContracts', () => {
  beforeEach(() => {
    resetContractRegistry();
  });

  afterEach(() => {
    resetContractRegistry();
  });

  function createTestContext(): ExecutionContext {
    return {
      sessionId: createSessionId('test_session'),
      providers: { llm: true, embedding: true, storage: true },
      now: new Date(),
      budget: { tokensRemaining: 10000, timeRemainingMs: 30000 },
    };
  }

  describe('ContractRegistry', () => {
    it('registers and retrieves contracts', () => {
      const registry = getContractRegistry();

      const contract: PrimitiveContract<TestInput, TestOutput> = {
        id: createContractId('contract_test'),
        name: 'Test Contract',
        description: 'A test contract for testing',
        version: '1.0.0',
        primitiveId: createPrimitiveId('tp_test'),
        preconditions: [],
        postconditions: [],
        invariants: [],
        confidenceDerivation: {
          factors: [],
          combiner: 'min',
        },
        errorSpec: {
          expectedErrors: [],
          retryPolicy: DEFAULT_RETRY_POLICY,
          fallback: 'throw',
        },
      };

      registry.register(contract);

      expect(registry.has(createPrimitiveId('tp_test'))).toBe(true);
      expect(registry.get(createPrimitiveId('tp_test'))).toEqual(contract);
    });

    it('prevents duplicate registration', () => {
      const registry = getContractRegistry();

      const contract: PrimitiveContract<TestInput, TestOutput> = {
        id: createContractId('contract_test'),
        name: 'Test Contract',
        description: 'A test contract',
        version: '1.0.0',
        primitiveId: createPrimitiveId('tp_test'),
        preconditions: [],
        postconditions: [],
        invariants: [],
        confidenceDerivation: { factors: [], combiner: 'min' },
        errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
      };

      registry.register(contract);

      expect(() => registry.register(contract)).toThrow('already registered');
    });

    it('lists all registered contracts', () => {
      const registry = getContractRegistry();

      registry.register({
        id: createContractId('contract_1'),
        name: 'Contract 1',
        description: 'First test contract',
        version: '1.0.0',
        primitiveId: createPrimitiveId('tp_1'),
        preconditions: [],
        postconditions: [],
        invariants: [],
        confidenceDerivation: { factors: [], combiner: 'min' },
        errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
      });

      registry.register({
        id: createContractId('contract_2'),
        name: 'Contract 2',
        description: 'Second test contract',
        version: '1.0.0',
        primitiveId: createPrimitiveId('tp_2'),
        preconditions: [],
        postconditions: [],
        invariants: [],
        confidenceDerivation: { factors: [], combiner: 'min' },
        errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
      });

      const list = registry.list();
      expect(list).toHaveLength(2);
    });

    it('returns null for unknown primitive', () => {
      const registry = getContractRegistry();
      expect(registry.get(createPrimitiveId('tp_unknown'))).toBeNull();
    });
  });

  describe('ContractExecutor', () => {
    describe('preconditions', () => {
      it('passes execution when preconditions pass', async () => {
        const registry = getContractRegistry();

        registry.register<TestInput, TestOutput>({
          id: createContractId('contract_pre_pass'),
          name: 'Precondition Pass Contract',
          description: 'Tests that preconditions pass correctly',
          version: '1.0.0',
          primitiveId: createPrimitiveId('tp_pre_pass'),
          preconditions: [
            createPrecondition('positive_value', 'Value must be positive', (input) => input.value > 0),
          ],
          postconditions: [],
          invariants: [],
          confidenceDerivation: { factors: [], combiner: 'min' },
          errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
        });

        const executor = new ContractExecutor(registry);
        const context = createTestContext();

        const result = await executor.execute<TestInput, TestOutput>(
          createPrimitiveId('tp_pre_pass'),
          { value: 10 },
          async (input) => ({ result: input.value * 2, processed: true }),
          context
        );

        expect(result.output.result).toBe(20);
        expect(result.verification.preconditionsPassed).toContain('positive_value');
      });

      it('throws ContractViolation when critical precondition fails', async () => {
        const registry = getContractRegistry();

        registry.register<TestInput, TestOutput>({
          id: createContractId('contract_pre_fail'),
          name: 'Precondition Fail Contract',
          description: 'Tests that critical precondition violations throw',
          version: '1.0.0',
          primitiveId: createPrimitiveId('tp_pre_fail'),
          preconditions: [
            createPrecondition(
              'positive_value',
              'Value must be positive',
              (input) => input.value > 0,
              { onViolation: 'throw', severity: 'critical' }
            ),
          ],
          postconditions: [],
          invariants: [],
          confidenceDerivation: { factors: [], combiner: 'min' },
          errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
        });

        const executor = new ContractExecutor(registry);
        const context = createTestContext();

        await expect(
          executor.execute<TestInput, TestOutput>(
            createPrimitiveId('tp_pre_fail'),
            { value: -5 },
            async (input) => ({ result: input.value * 2, processed: true }),
            context
          )
        ).rejects.toThrow(ContractViolation);
      });

      it('records warning when warning precondition fails', async () => {
        const registry = getContractRegistry();

        registry.register<TestInput, TestOutput>({
          id: createContractId('contract_pre_warn'),
          name: 'Precondition Warn Contract',
          description: 'Tests warning preconditions',
          version: '1.0.0',
          primitiveId: createPrimitiveId('tp_pre_warn'),
          preconditions: [
            createPrecondition(
              'large_value',
              'Value should be large',
              (input) => input.value > 100,
              { onViolation: 'warn', severity: 'warning' }
            ),
          ],
          postconditions: [],
          invariants: [],
          confidenceDerivation: { factors: [], combiner: 'min' },
          errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
        });

        const executor = new ContractExecutor(registry);
        const context = createTestContext();

        const result = await executor.execute<TestInput, TestOutput>(
          createPrimitiveId('tp_pre_warn'),
          { value: 50 },
          async (input) => ({ result: input.value * 2, processed: true }),
          context
        );

        expect(result.output.result).toBe(100);
        expect(result.verification.warnings).toHaveLength(1);
        expect(result.verification.warnings[0].conditionId).toBe('large_value');
      });
    });

    describe('postconditions', () => {
      it('passes when postconditions pass', async () => {
        const registry = getContractRegistry();

        registry.register<TestInput, TestOutput>({
          id: createContractId('contract_post_pass'),
          name: 'Postcondition Pass Contract',
          description: 'Tests postcondition success',
          version: '1.0.0',
          primitiveId: createPrimitiveId('tp_post_pass'),
          preconditions: [],
          postconditions: [
            createPostcondition(
              'result_positive',
              'Result must be positive',
              (_, output) => output.result > 0
            ),
          ],
          invariants: [],
          confidenceDerivation: { factors: [], combiner: 'min' },
          errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
        });

        const executor = new ContractExecutor(registry);
        const context = createTestContext();

        const result = await executor.execute<TestInput, TestOutput>(
          createPrimitiveId('tp_post_pass'),
          { value: 10 },
          async (input) => ({ result: input.value * 2, processed: true }),
          context
        );

        expect(result.verification.postconditionsPassed).toContain('result_positive');
      });

      it('throws ContractViolation when postcondition fails', async () => {
        const registry = getContractRegistry();

        registry.register<TestInput, TestOutput>({
          id: createContractId('contract_post_fail'),
          name: 'Postcondition Fail Contract',
          description: 'Tests postcondition failure',
          version: '1.0.0',
          primitiveId: createPrimitiveId('tp_post_fail'),
          preconditions: [],
          postconditions: [
            createPostcondition(
              'result_positive',
              'Result must be positive',
              (_, output) => output.result > 0,
              { onViolation: 'throw' }
            ),
          ],
          invariants: [],
          confidenceDerivation: { factors: [], combiner: 'min' },
          errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
        });

        const executor = new ContractExecutor(registry);
        const context = createTestContext();

        await expect(
          executor.execute<TestInput, TestOutput>(
            createPrimitiveId('tp_post_fail'),
            { value: -10 },
            async (input) => ({ result: input.value * 2, processed: true }),
            context
          )
        ).rejects.toThrow(ContractViolation);
      });
    });

    describe('retry', () => {
      it('retries on transient error', async () => {
        const registry = getContractRegistry();
        let attemptCount = 0;

        registry.register<TestInput, TestOutput>({
          id: createContractId('contract_retry'),
          name: 'Retry Contract',
          description: 'Tests retry on transient error',
          version: '1.0.0',
          primitiveId: createPrimitiveId('tp_retry'),
          preconditions: [],
          postconditions: [],
          invariants: [],
          confidenceDerivation: { factors: [], combiner: 'min' },
          errorSpec: {
            expectedErrors: [
              { code: 'TRANSIENT', transient: true, handling: 'retry', description: 'Transient' },
            ],
            retryPolicy: { maxAttempts: 3, baseDelayMs: 10, backoffMultiplier: 2, maxDelayMs: 100 },
            fallback: 'throw',
          },
        });

        const executor = new ContractExecutor(registry);
        const context = createTestContext();

        const result = await executor.execute<TestInput, TestOutput>(
          createPrimitiveId('tp_retry'),
          { value: 10 },
          async (input) => {
            attemptCount++;
            if (attemptCount < 2) {
              const error = new Error('Transient error') as Error & { code: string };
              error.code = 'TRANSIENT';
              throw error;
            }
            return { result: input.value * 2, processed: true };
          },
          context
        );

        expect(result.output.result).toBe(20);
        expect(result.execution.retryCount).toBe(1);
        expect(attemptCount).toBe(2);
      });

      it('respects max retries', async () => {
        const registry = getContractRegistry();
        let attemptCount = 0;

        registry.register<TestInput, TestOutput>({
          id: createContractId('contract_max_retry'),
          name: 'Max Retry Contract',
          description: 'Tests max retry limit',
          version: '1.0.0',
          primitiveId: createPrimitiveId('tp_max_retry'),
          preconditions: [],
          postconditions: [],
          invariants: [],
          confidenceDerivation: { factors: [], combiner: 'min' },
          errorSpec: {
            expectedErrors: [],
            retryPolicy: { maxAttempts: 2, baseDelayMs: 10, backoffMultiplier: 2, maxDelayMs: 100 },
            fallback: 'throw',
          },
        });

        const executor = new ContractExecutor(registry);
        const context = createTestContext();

        await expect(
          executor.execute<TestInput, TestOutput>(
            createPrimitiveId('tp_max_retry'),
            { value: 10 },
            async () => {
              attemptCount++;
              throw new Error('Always fails');
            },
            context
          )
        ).rejects.toThrow('Always fails');

        expect(attemptCount).toBe(3); // Initial + 2 retries
      });
    });

    describe('confidence derivation', () => {
      it('derives confidence from factors', async () => {
        const registry = getContractRegistry();

        registry.register<TestInput, TestOutput>({
          id: createContractId('contract_confidence'),
          name: 'Confidence Contract',
          description: 'Tests confidence derivation',
          version: '1.0.0',
          primitiveId: createPrimitiveId('tp_confidence'),
          preconditions: [],
          postconditions: [],
          invariants: [],
          confidenceDerivation: {
            factors: [
              { id: 'factor_a', source: 'execution_quality', baseWeight: 0.5 },
              { id: 'factor_b', source: 'input_confidence', baseWeight: 0.5 },
            ],
            combiner: 'weighted_average',
          },
          errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
        });

        const executor = new ContractExecutor(registry);
        const context = createTestContext();

        const result = await executor.execute<TestInput, TestOutput>(
          createPrimitiveId('tp_confidence'),
          { value: 10 },
          async (input) => ({ result: input.value * 2, processed: true }),
          context
        );

        expect(result.confidence).toBeDefined();
        expect(result.confidence.type).toBe('derived');
      });

      it('returns absent confidence when no factors', async () => {
        const registry = getContractRegistry();

        registry.register<TestInput, TestOutput>({
          id: createContractId('contract_no_conf'),
          name: 'No Confidence Contract',
          description: 'Tests absent confidence',
          version: '1.0.0',
          primitiveId: createPrimitiveId('tp_no_conf'),
          preconditions: [],
          postconditions: [],
          invariants: [],
          confidenceDerivation: {
            factors: [],
            combiner: 'min',
          },
          errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
        });

        const executor = new ContractExecutor(registry);
        const context = createTestContext();

        const result = await executor.execute<TestInput, TestOutput>(
          createPrimitiveId('tp_no_conf'),
          { value: 10 },
          async (input) => ({ result: input.value * 2, processed: true }),
          context
        );

        expect(result.confidence.type).toBe('absent');
      });
    });

    describe('execution metadata', () => {
      it('records execution timing', async () => {
        const registry = getContractRegistry();

        registry.register<TestInput, TestOutput>({
          id: createContractId('contract_timing'),
          name: 'Timing Contract',
          description: 'Tests execution timing',
          version: '1.0.0',
          primitiveId: createPrimitiveId('tp_timing'),
          preconditions: [],
          postconditions: [],
          invariants: [],
          confidenceDerivation: { factors: [], combiner: 'min' },
          errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
        });

        const executor = new ContractExecutor(registry);
        const context = createTestContext();

        const result = await executor.execute<TestInput, TestOutput>(
          createPrimitiveId('tp_timing'),
          { value: 10 },
          async (input) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { result: input.value * 2, processed: true };
          },
          context
        );

        expect(result.execution.startTime).toBeInstanceOf(Date);
        expect(result.execution.endTime).toBeInstanceOf(Date);
        // Timer resolution can vary slightly, allow 1ms tolerance
        expect(result.execution.durationMs).toBeGreaterThanOrEqual(9);
        expect(result.execution.retryCount).toBe(0);
      });
    });
  });

  describe('ContractViolation', () => {
    it('contains all violation details', () => {
      const violation = new ContractViolation(
        createContractId('contract_test'),
        'condition_id',
        'precondition',
        'Test violation message',
        { value: 10 },
        undefined
      );

      expect(violation.contractId).toBe('contract_test');
      expect(violation.conditionId).toBe('condition_id');
      expect(violation.conditionType).toBe('precondition');
      expect(violation.message).toContain('Test violation message');
      expect(violation.input).toEqual({ value: 10 });
      expect(violation.name).toBe('ContractViolation');
    });
  });

  describe('Contract Validation', () => {
    it('validates a complete contract successfully', () => {
      const contract: PrimitiveContract<TestInput, TestOutput> = {
        id: createContractId('contract_valid'),
        name: 'Valid Contract',
        description: 'A valid test contract',
        version: '1.0.0',
        primitiveId: createPrimitiveId('tp_valid'),
        preconditions: [
          createPrecondition('test_pre', 'Test precondition', () => true),
        ],
        postconditions: [],
        invariants: [],
        confidenceDerivation: { factors: [], combiner: 'min' },
        errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
      };

      const result = validateContract(contract);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('reports errors for missing required fields', () => {
      const result = validateContract({});

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.field === 'id')).toBe(true);
      expect(result.errors.some((e) => e.field === 'name')).toBe(true);
      expect(result.errors.some((e) => e.field === 'description')).toBe(true);
      expect(result.errors.some((e) => e.field === 'version')).toBe(true);
    });

    it('warns about non-semver version', () => {
      const contract: PrimitiveContract<TestInput, TestOutput> = {
        id: createContractId('contract_version'),
        name: 'Version Contract',
        description: 'Test version warning',
        version: 'latest', // Not semver
        primitiveId: createPrimitiveId('tp_version'),
        preconditions: [],
        postconditions: [],
        invariants: [],
        confidenceDerivation: { factors: [], combiner: 'min' },
        errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
      };

      const result = validateContract(contract);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.field === 'version')).toBe(true);
    });

    it('warns when no conditions are defined', () => {
      const contract: PrimitiveContract<TestInput, TestOutput> = {
        id: createContractId('contract_no_cond'),
        name: 'No Conditions Contract',
        description: 'No conditions defined',
        version: '1.0.0',
        primitiveId: createPrimitiveId('tp_no_cond'),
        preconditions: [],
        postconditions: [],
        invariants: [],
        confidenceDerivation: { factors: [], combiner: 'min' },
        errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
      };

      const result = validateContract(contract);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.field === 'conditions')).toBe(true);
    });

    it('validates condition fields', () => {
      const contract = {
        id: createContractId('contract_bad_cond'),
        name: 'Bad Conditions',
        description: 'Invalid conditions',
        version: '1.0.0',
        primitiveId: createPrimitiveId('tp_bad_cond'),
        preconditions: [{ id: '', description: 'No ID', check: () => true }],
        postconditions: [],
        invariants: [],
        confidenceDerivation: { factors: [], combiner: 'min' as const },
        errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' as const },
      };

      const result = validateContract(contract as unknown as PrimitiveContract<unknown, unknown>);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('preconditions'))).toBe(true);
    });
  });

  describe('Contract Factory', () => {
    it('creates a contract with defaults', () => {
      const contract = createContract<TestInput, TestOutput>({
        id: 'contract_factory',
        name: 'Factory Contract',
        description: 'Created via factory',
        primitiveId: 'tp_factory',
      });

      expect(contract.id).toBe('contract_factory');
      expect(contract.version).toBe('1.0.0');
      expect(contract.preconditions).toEqual([]);
      expect(contract.postconditions).toEqual([]);
      expect(contract.invariants).toEqual([]);
      expect(contract.confidenceDerivation).toEqual(DEFAULT_CONFIDENCE_DERIVATION);
      expect(contract.errorSpec).toEqual(DEFAULT_ERROR_SPEC);
    });

    it('merges provided options with defaults', () => {
      const contract = createContract<TestInput, TestOutput>({
        id: 'contract_merged',
        name: 'Merged Contract',
        description: 'Merged options',
        version: '2.0.0',
        primitiveId: 'tp_merged',
        preconditions: [
          createPrecondition('pre1', 'Precondition 1', () => true),
        ],
        errorSpec: {
          fallback: 'return_empty',
        },
      });

      expect(contract.version).toBe('2.0.0');
      expect(contract.preconditions).toHaveLength(1);
      expect(contract.errorSpec.fallback).toBe('return_empty');
      expect(contract.errorSpec.retryPolicy).toEqual(DEFAULT_RETRY_POLICY); // Default preserved
    });

    it('throws on invalid contract options', () => {
      expect(() =>
        createContract<TestInput, TestOutput>({
          id: '',
          name: '',
          description: '',
          primitiveId: '',
        })
      ).toThrow('Invalid contract');
    });
  });

  describe('Helper Functions', () => {
    it('createInvariant creates valid invariant', () => {
      const inv = createInvariant<TestInput, TestOutput>(
        'inv1',
        'Test invariant',
        () => true,
        'safety'
      );

      expect(inv.id).toBe('inv1');
      expect(inv.description).toBe('Test invariant');
      expect(inv.category).toBe('safety');
      expect(typeof inv.check).toBe('function');
    });

    it('createConfidenceFactor creates valid factor', () => {
      const factor = createConfidenceFactor(
        'factor1',
        'execution_quality',
        0.5,
        'sqrt'
      );

      expect(factor.id).toBe('factor1');
      expect(factor.source).toBe('execution_quality');
      expect(factor.baseWeight).toBe(0.5);
      expect(factor.transform).toBe('sqrt');
    });

    it('createExpectedError creates valid error definition', () => {
      const error = createExpectedError('TIMEOUT', 'Operation timed out', {
        transient: true,
        handling: 'retry',
      });

      expect(error.code).toBe('TIMEOUT');
      expect(error.description).toBe('Operation timed out');
      expect(error.transient).toBe(true);
      expect(error.handling).toBe('retry');
    });

    it('createExpectedError uses defaults', () => {
      const error = createExpectedError('FATAL', 'Fatal error');

      expect(error.transient).toBe(false);
      expect(error.handling).toBe('throw');
    });
  });

  describe('Global Registry Functions', () => {
    it('getGlobalContractRegistry returns the same instance as getContractRegistry', () => {
      const registry1 = getContractRegistry();
      const registry2 = getGlobalContractRegistry();

      expect(registry1).toBe(registry2);
    });

    it('registerContract adds contract to global registry', () => {
      const registry = getContractRegistry();

      const contract = createContract<TestInput, TestOutput>({
        id: 'contract_global_register',
        name: 'Global Register Contract',
        description: 'Testing global registerContract',
        primitiveId: 'tp_global_register',
      });

      registerContract(contract);

      expect(registry.has(createPrimitiveId('tp_global_register'))).toBe(true);
    });

    it('getContract retrieves contract by contract ID', () => {
      const contract = createContract<TestInput, TestOutput>({
        id: 'contract_get_by_id',
        name: 'Get By ID Contract',
        description: 'Testing getContract by ID',
        primitiveId: 'tp_get_by_id',
      });

      registerContract(contract);

      const retrieved = getContract('contract_get_by_id');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('contract_get_by_id');
    });

    it('getContract returns null for unknown contract ID', () => {
      const retrieved = getContract('nonexistent_contract_id');
      expect(retrieved).toBeNull();
    });
  });

  describe('ContractViolationError', () => {
    it('has violationType property matching conditionType', () => {
      const violation = new ContractViolationError(
        createContractId('contract_test'),
        'condition_id',
        'precondition',
        'Test message'
      );

      expect(violation.violationType).toBe('precondition');
      expect(violation.conditionType).toBe('precondition');
    });

    it('accepts details parameter', () => {
      const violation = new ContractViolation(
        createContractId('contract_details'),
        'condition_id',
        'invariant',
        'Test message',
        { inputValue: 5 },
        { outputValue: 10 },
        { phase: 'after', category: 'safety' }
      );

      expect(violation.details).toEqual({ phase: 'after', category: 'safety' });
    });

    it('ContractViolationError is alias for ContractViolation', () => {
      expect(ContractViolationError).toBe(ContractViolation);
    });
  });

  describe('Invariant Checking', () => {
    it('checks invariants and records them in verification', async () => {
      const registry = getContractRegistry();

      registry.register<TestInput, TestOutput>({
        id: createContractId('contract_invariant_pass'),
        name: 'Invariant Pass Contract',
        description: 'Tests invariant checking',
        version: '1.0.0',
        primitiveId: createPrimitiveId('tp_invariant_pass'),
        preconditions: [],
        postconditions: [],
        invariants: [
          createInvariant('inv_positive', 'Value must be positive', (input: TestInput) => input.value > 0, 'safety'),
        ],
        confidenceDerivation: { factors: [], combiner: 'min' },
        errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
      });

      const executor = new ContractExecutor(registry);
      const context = createTestContext();

      const result = await executor.execute<TestInput, TestOutput>(
        createPrimitiveId('tp_invariant_pass'),
        { value: 10 },
        async (input) => ({ result: input.value * 2, processed: true }),
        context
      );

      expect(result.verification.invariantsHeld).toContain('inv_positive');
    });

    it('throws ContractViolation when invariant fails', async () => {
      const registry = getContractRegistry();

      registry.register<TestInput, TestOutput>({
        id: createContractId('contract_invariant_fail'),
        name: 'Invariant Fail Contract',
        description: 'Tests invariant failure',
        version: '1.0.0',
        primitiveId: createPrimitiveId('tp_invariant_fail'),
        preconditions: [],
        postconditions: [],
        invariants: [
          createInvariant('inv_positive', 'Value must be positive', (input: TestInput) => input.value > 0, 'safety'),
        ],
        confidenceDerivation: { factors: [], combiner: 'min' },
        errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
      });

      const executor = new ContractExecutor(registry);
      const context = createTestContext();

      await expect(
        executor.execute<TestInput, TestOutput>(
          createPrimitiveId('tp_invariant_fail'),
          { value: -5 },
          async (input) => ({ result: input.value * 2, processed: true }),
          context
        )
      ).rejects.toThrow(ContractViolation);
    });

    it('invariant violation includes phase in details', async () => {
      const registry = getContractRegistry();

      registry.register<TestInput, TestOutput>({
        id: createContractId('contract_inv_details'),
        name: 'Invariant Details Contract',
        description: 'Tests invariant details',
        version: '1.0.0',
        primitiveId: createPrimitiveId('tp_inv_details'),
        preconditions: [],
        postconditions: [],
        invariants: [
          createInvariant('inv_always_fail', 'Always fails', () => false, 'safety'),
        ],
        confidenceDerivation: { factors: [], combiner: 'min' },
        errorSpec: { expectedErrors: [], retryPolicy: DEFAULT_RETRY_POLICY, fallback: 'throw' },
      });

      const executor = new ContractExecutor(registry);
      const context = createTestContext();

      try {
        await executor.execute<TestInput, TestOutput>(
          createPrimitiveId('tp_inv_details'),
          { value: 10 },
          async (input) => ({ result: input.value * 2, processed: true }),
          context
        );
        expect(true).toBe(false); // Should not reach here
      } catch (e) {
        expect(e).toBeInstanceOf(ContractViolation);
        const violation = e as ContractViolation;
        expect(violation.conditionType).toBe('invariant');
        expect(violation.details?.phase).toBe('before');
      }
    });
  });

  describe('Built-in Primitive Contracts', () => {
    it('registerBuiltInContracts registers all standard contracts', () => {
      resetContractRegistry();
      const contracts = registerBuiltInContracts();

      expect(contracts.length).toBeGreaterThan(0);
      expect(contracts.length).toBe(9); // D1-D6 + calibration + ledger append/query
    });

    it('built-in contracts have valid structure', () => {
      expect(SYNTACTIC_CONFIDENCE_CONTRACT.id).toBe('contract_syntactic_confidence');
      expect(SEQUENCE_CONFIDENCE_CONTRACT.id).toBe('contract_sequence_confidence');
      expect(PARALLEL_ALL_CONFIDENCE_CONTRACT.id).toBe('contract_parallel_all_confidence');
      expect(PARALLEL_ANY_CONFIDENCE_CONTRACT.id).toBe('contract_parallel_any_confidence');
      expect(UNCALIBRATED_CONFIDENCE_CONTRACT.id).toBe('contract_uncalibrated_confidence');
      expect(MEASURED_CONFIDENCE_CONTRACT.id).toBe('contract_measured_confidence');
    });

    it('syntactic confidence contract validates deterministic output', () => {
      // Check postcondition for deterministic output
      const postcondition = SYNTACTIC_CONFIDENCE_CONTRACT.postconditions.find(
        (p: { id: string }) => p.id === 'output_is_deterministic'
      );
      expect(postcondition).toBeDefined();
      expect(
        postcondition!.check(
          { success: true },
          { type: 'deterministic', value: 1.0, reason: 'test' },
          createTestContext()
        )
      ).toBe(true);
    });

    it('registerBuiltInContracts is idempotent', () => {
      resetContractRegistry();
      const contracts1 = registerBuiltInContracts();
      const contracts2 = registerBuiltInContracts(); // Second call should not throw

      expect(contracts1.length).toBe(contracts2.length);
    });
  });
});
