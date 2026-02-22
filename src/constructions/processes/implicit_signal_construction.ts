import type { Construction } from '../types.js';
import { ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export interface ImplicitSignalInput {
  stdout: string;
  stderr?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs?: number;
  timeoutMs?: number;
}

export interface ImplicitSignalOutput {
  fellBackToGrep: boolean;
  catInsteadOfContext: boolean;
  commandsFailed: number;
  abortedEarly: boolean;
  timeoutRatio: number;
  stderrAnomalies: string[];
}

export function createImplicitSignalConstruction(): Construction<
  ImplicitSignalInput,
  ImplicitSignalOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'implicit-signal-detector',
    name: 'Implicit Signal Detector',
    description: 'Infers behavioral fallbacks and failure patterns from raw agent output.',
    async execute(input: ImplicitSignalInput) {
      const output = `${input.stdout}\n${input.stderr ?? ''}`.toLowerCase();
      const commandsFailed = (output.match(/\b(command not found|enoent|exit code\s*[1-9]|fatal error|permission denied)\b/g) ?? []).length;
      const timeoutRatio =
        typeof input.durationMs === 'number' && typeof input.timeoutMs === 'number' && input.timeoutMs > 0
          ? Math.max(0, Math.min(1, input.durationMs / input.timeoutMs))
          : 0;

      const anomalies: string[] = [];
      if ((input.stderr ?? '').trim()) anomalies.push('stderr_present');
      if (commandsFailed > 0) anomalies.push('command_failures_detected');
      if (input.timedOut) anomalies.push('timeout_detected');

      return ok<ImplicitSignalOutput, ConstructionError>({
        fellBackToGrep: /\b(rg|ripgrep|grep -|grep\s)/.test(output),
        catInsteadOfContext: /\b(cat\s+|sed -n|head -\d+|tail -\d+)/.test(output),
        commandsFailed,
        abortedEarly: Boolean(input.exitCode && input.exitCode !== 0),
        timeoutRatio,
        stderrAnomalies: anomalies,
      });
    },
  };
}
