import type { EmbeddingService } from '../api/embeddings.js';
import { ensureLibrarianReady } from './first_run_gate.js';
import { logInfo } from '../telemetry/logger.js';

export interface OrchestratorLibrarianGateOptions {
  onProgress?: (phase: string, progress: number, message: string) => void;
  timeoutMs?: number;
  maxWaitForBootstrapMs?: number;
  embeddingService?: EmbeddingService;
}

const isDeterministicMode = (): boolean =>
  process.env.LIBRARIAN_DETERMINISTIC === '1' || process.env.WAVE0_TEST_MODE === 'true';

export async function ensureLibrarianReadyForOrchestrator(
  workspace: string,
  options: OrchestratorLibrarianGateOptions = {}
): Promise<void> {
  if (isDeterministicMode()) {
    logInfo('[librarian] Deterministic mode enabled; skipping librarian gate.');
    return;
  }

  const timeoutMs = options.timeoutMs ?? 0;
  const maxWaitForBootstrapMs = options.maxWaitForBootstrapMs ?? 0;

  await ensureLibrarianReady(workspace, {
    onProgress: options.onProgress,
    timeoutMs,
    maxWaitForBootstrapMs,
    throwOnFailure: true,
    embeddingService: options.embeddingService,
  });
}
