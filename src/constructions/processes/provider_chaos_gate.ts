import type { Construction } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';
import {
  ProviderChaosMiddleware,
  type ProviderChaosMode,
  type ProviderExecResult,
} from '../../adapters/provider_chaos.js';

export interface ProviderChaosGateInput {
  maxDurationMs?: number;
  slowDelayMs?: number;
}

export interface ProviderChaosModeResult {
  mode: ProviderChaosMode;
  injectedFailure: boolean;
  recovered: boolean;
  stateCorrupted: boolean;
  attempts: number;
  finalOutput: string;
}

export interface ProviderChaosGateOutput {
  kind: 'ProviderChaosGateResult.v1';
  pass: boolean;
  modeResults: ProviderChaosModeResult[];
  findings: string[];
  durationMs: number;
  maxDurationMs: number;
}

const CHAOS_MODES: ProviderChaosMode[] = [
  'timeout',
  'error_response',
  'truncated_response',
  'garbage_response',
  'slow_response',
];

const DEFAULT_MAX_DURATION_MS = 60_000;
const DEFAULT_SLOW_DELAY_MS = 30;

function createHealthyRunner(state: { writes: number }): () => Promise<ProviderExecResult> {
  return async () => {
    state.writes += 1;
    return {
      exitCode: 0,
      stdout: `response-${state.writes}`,
      stderr: '',
    };
  };
}

function isInjectedFailure(mode: ProviderChaosMode, result: ProviderExecResult): boolean {
  if (mode === 'timeout' || mode === 'error_response') return result.exitCode !== 0;
  if (mode === 'truncated_response') return result.stdout.endsWith('...');
  if (mode === 'garbage_response') return result.stdout.includes('provider_chaos_garbage');
  return false;
}

function isStateCorrupted(output: string): boolean {
  return output.includes('provider_chaos') || output.includes('\u0000');
}

async function runChaosMode(mode: ProviderChaosMode, slowDelayMs: number): Promise<ProviderChaosModeResult> {
  const state = { writes: 0 };
  const chaos = new ProviderChaosMiddleware({
    enabled: true,
    rate: 1,
    modes: [mode],
    sequence: [mode],
    slowDelayMs,
    timeoutDelayMs: 1,
  });
  const healthy = new ProviderChaosMiddleware({
    enabled: false,
    rate: 0,
    modes: CHAOS_MODES,
    sequence: [],
    slowDelayMs: 0,
    timeoutDelayMs: 0,
  });
  const runner = createHealthyRunner(state);

  let attempts = 0;
  let injectedFailure = false;

  try {
    attempts += 1;
    const first = await chaos.execute(runner);
    injectedFailure = isInjectedFailure(mode, first);
  } catch {
    injectedFailure = true;
  }

  attempts += 1;
  const recovery = await healthy.execute(runner);
  const recovered = recovery.exitCode === 0 && !isStateCorrupted(recovery.stdout);
  const stateCorrupted = isStateCorrupted(recovery.stdout);

  return {
    mode,
    injectedFailure,
    recovered,
    stateCorrupted,
    attempts,
    finalOutput: recovery.stdout,
  };
}

export function createProviderChaosGateConstruction(): Construction<
  ProviderChaosGateInput,
  ProviderChaosGateOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'provider-chaos-gate',
    name: 'Provider Chaos Gate',
    description: 'Injects provider failure modes and verifies recovery and state integrity.',
    async execute(input: ProviderChaosGateInput = {}): Promise<ProviderChaosGateOutput> {
      const startedAt = Date.now();
      const maxDurationMs = input.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
      const slowDelayMs = input.slowDelayMs ?? DEFAULT_SLOW_DELAY_MS;
      const findings: string[] = [];

      const modeResults: ProviderChaosModeResult[] = [];
      for (const mode of CHAOS_MODES) {
        const result = await runChaosMode(mode, slowDelayMs);
        modeResults.push(result);

        if (!result.injectedFailure && mode !== 'slow_response') {
          findings.push(`Mode ${mode} did not inject an observable failure.`);
        }
        if (!result.recovered) {
          findings.push(`Mode ${mode} did not recover to a healthy response.`);
        }
        if (result.stateCorrupted) {
          findings.push(`Mode ${mode} left corrupted state after recovery.`);
        }
      }

      const durationMs = Date.now() - startedAt;
      if (durationMs > maxDurationMs) {
        findings.push(`Provider chaos gate exceeded duration budget: ${durationMs}ms > ${maxDurationMs}ms.`);
      }

      return {
        kind: 'ProviderChaosGateResult.v1',
        pass: findings.length === 0,
        modeResults,
        findings,
        durationMs,
        maxDurationMs,
      };
    },
  };
}
