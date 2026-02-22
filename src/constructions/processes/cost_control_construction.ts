import type { Construction } from '../types.js';
import { ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export interface CostBudget {
  maxDurationMs?: number;
  maxTokens?: number;
  maxUsd?: number;
}

export interface CostUsage {
  durationMs?: number;
  tokens?: number;
  usd?: number;
}

export interface CostControlInput {
  budget?: CostBudget;
  usage?: CostUsage;
}

export interface CostControlOutput {
  allowed: boolean;
  breaches: string[];
  usage: CostUsage;
}

export function createCostControlConstruction(): Construction<
  CostControlInput,
  CostControlOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'cost-controller',
    name: 'Cost Controller',
    description: 'Evaluates runtime/token/spend usage against process budget constraints.',
    async execute(input: CostControlInput) {
      const budget = input.budget ?? {};
      const usage = input.usage ?? {};
      const breaches: string[] = [];

      if (typeof budget.maxDurationMs === 'number' && typeof usage.durationMs === 'number' && usage.durationMs > budget.maxDurationMs) {
        breaches.push(`duration_ms:${usage.durationMs}>${budget.maxDurationMs}`);
      }
      if (typeof budget.maxTokens === 'number' && typeof usage.tokens === 'number' && usage.tokens > budget.maxTokens) {
        breaches.push(`tokens:${usage.tokens}>${budget.maxTokens}`);
      }
      if (typeof budget.maxUsd === 'number' && typeof usage.usd === 'number' && usage.usd > budget.maxUsd) {
        breaches.push(`usd:${usage.usd}>${budget.maxUsd}`);
      }

      return ok<CostControlOutput, ConstructionError>({
        allowed: breaches.length === 0,
        breaches,
        usage,
      });
    },
  };
}
