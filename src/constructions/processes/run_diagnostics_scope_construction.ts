import {
  classifyRunDiagnosticsScope,
  type RunDiagnosticsScopeInput,
  type RunDiagnosticsScopeReport,
} from '../../api/run_diagnostics_scope.js';
import type { Construction } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export interface RunDiagnosticsScopeConstructionOutput {
  kind: 'RunDiagnosticsScopeResult.v1';
  report: RunDiagnosticsScopeReport;
}

export function createRunDiagnosticsScopeConstruction(): Construction<
  RunDiagnosticsScopeInput,
  RunDiagnosticsScopeConstructionOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'run-diagnostics-scope',
    name: 'Run Diagnostics Scope',
    description: 'Classify mixed command output into must-fix, expected diagnostics, and deferred baseline findings for autonomous remediation.',
    async execute(input: RunDiagnosticsScopeInput): Promise<RunDiagnosticsScopeConstructionOutput> {
      const report = classifyRunDiagnosticsScope(input);
      return {
        kind: 'RunDiagnosticsScopeResult.v1',
        report,
      };
    },
  };
}
