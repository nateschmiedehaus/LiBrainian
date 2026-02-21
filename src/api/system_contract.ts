import type { LiBrainianMetadata, LiBrainianVersion, QualityTier } from '../types.js';
import type { WatchHealth } from '../state/watch_health.js';
import type { WatchState } from '../state/watch_state.js';

export interface SystemContract {
  generatedAt: string;
  workspace: string;
  version: LiBrainianVersion;
  invariants: {
    providerGatingRequired: boolean;
    semanticRequiresProviders: boolean;
    failClosedOnProviderUnavailable: boolean;
    fakeEmbeddingsForbidden: boolean;
  };
  indexProvenance: {
    version: LiBrainianVersion | null;
    qualityTier: QualityTier | null;
    lastBootstrap: string | null;
    lastIndexing: string | null;
    totalFiles: number | null;
    totalFunctions: number | null;
    totalContextPacks: number | null;
    workspaceHeadSha: string | null;
  };
  watchProvenance: {
    state: WatchState | null;
    health: WatchHealth | null;
  };
}

export function buildSystemContract(options: {
  workspace: string;
  version: LiBrainianVersion;
  metadata: LiBrainianMetadata | null;
  headSha: string | null;
  watchState: WatchState | null;
  watchHealth: WatchHealth | null;
}): SystemContract {
  return {
    generatedAt: new Date().toISOString(),
    workspace: options.workspace,
    version: options.version,
    invariants: {
      providerGatingRequired: true,
      semanticRequiresProviders: true,
      failClosedOnProviderUnavailable: true,
      fakeEmbeddingsForbidden: true,
    },
    indexProvenance: {
      version: options.metadata?.version ?? null,
      qualityTier: options.metadata?.qualityTier ?? null,
      lastBootstrap: options.metadata?.lastBootstrap ? options.metadata.lastBootstrap.toISOString() : null,
      lastIndexing: options.metadata?.lastIndexing ? options.metadata.lastIndexing.toISOString() : null,
      totalFiles: options.metadata?.totalFiles ?? null,
      totalFunctions: options.metadata?.totalFunctions ?? null,
      totalContextPacks: options.metadata?.totalContextPacks ?? null,
      workspaceHeadSha: options.headSha ?? null,
    },
    watchProvenance: {
      state: options.watchState,
      health: options.watchHealth,
    },
  };
}
