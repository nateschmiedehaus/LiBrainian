import type { EmbeddingService } from '../api/embeddings.js';
import { ensureLiBrainianReady } from './first_run_gate.js';
import { logInfo } from '../telemetry/logger.js';

export interface OrchestratorLiBrainianGateOptions {
  onProgress?: (phase: string, progress: number, message: string) => void;
  timeoutMs?: number;
  maxWaitForBootstrapMs?: number;
  embeddingService?: EmbeddingService;
}

const isDeterministicMode = (): boolean =>
  process.env.LIBRARIAN_DETERMINISTIC === '1' || process.env.WAVE0_TEST_MODE === 'true';

export async function ensureLiBrainianReadyForOrchestrator(
  workspace: string,
  options: OrchestratorLiBrainianGateOptions = {}
): Promise<void> {
  if (isDeterministicMode()) {
    logInfo('[librainian] Deterministic mode enabled; skipping librainian gate.');
    return;
  }

  const timeoutMs = options.timeoutMs ?? 0;
  const maxWaitForBootstrapMs = options.maxWaitForBootstrapMs ?? 0;

  await ensureLiBrainianReady(workspace, {
    onProgress: options.onProgress,
    timeoutMs,
    maxWaitForBootstrapMs,
    throwOnFailure: true,
    embeddingService: options.embeddingService,
  });
}
