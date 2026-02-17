# Offline-First Architecture for LiBrainian

## Executive Summary

This document presents a comprehensive architecture for making LiBrainian work offline for **structural retrieval and deterministic outputs**, while gracefully enhancing the index when LLM-backed cognition is available. The design prioritizes local-first embeddings using `@xenova/transformers`, clear disclosure when LLM enrichment is unavailable, cached provider responses for reuse, and background synchronization when online. Semantic synthesis remains LLM‑required and must fail closed when providers are unavailable.

## Current State Analysis

### Existing Capabilities (Already Offline-Capable)

1. **Local Embeddings via @xenova/transformers**
   - File: `src/api/embedding_providers/real_embeddings.ts`
   - Model: `all-MiniLM-L6-v2` (384 dimensions)
   - Status: Already works offline once the model is cached locally
   - Provider priority: `xenova` (pure JS) > `sentence-transformers` (Python)

2. **SQLite Storage**
   - File: `src/storage/sqlite_storage.ts`
   - Status: Fully local, no network required
   - Already supports content-addressable caching (`src/storage/content_cache.ts`)

3. **AST Parsing**
   - Parser registry in `src/agents/parser_registry.ts`
   - Status: Pure local, no network dependency

### Current Network Dependencies (Problem Areas)

1. **Provider Readiness Gate** (`src/api/provider_gate.ts`)
   - Blocks bootstrap if LLM not available (line 182: `ready = llmReady && embeddingReady`)
   - Should allow embedding-only *structural indexing* while keeping LLM‑required phases fail‑closed

2. **Bootstrap Requires LLM** (`src/api/bootstrap.ts`)
   - Line 829: `await requireProviders({ llm: true, embedding: true })`
   - Knowledge generation phase requires LLM (correct)
   - Structural/AST/embedding phases should run without LLM when embeddings exist, with explicit disclosures

3. **LLM Purpose Extraction** (`src/api/embedding_providers/llm_purpose_extractor.ts`)
   - Uses LLM for semantic enrichment
   - Line 236: Throws on provider unavailable unless `allowHeuristics: true`
   - Heuristic fallback must be constrained to **structural** descriptors only, never semantic claims

4. **Query Synthesis** (`src/api/query_synthesis.ts`)
   - Requires LLM for answer synthesis
   - Should fall back to returning raw context packs and verification plan (no semantic narrative)

## Design Requirements

| Requirement | Priority | Description |
|-------------|----------|-------------|
| R1 | P0 | Local embeddings by default using @xenova/transformers |
| R2 | P0 | Structural retrieval works without network; semantic synthesis requires LLM and must fail closed |
| R3 | P1 | Graceful degradation: skip LLM enrichment but complete indexing without semantic claims |
| R4 | P1 | Cache LLM responses for reuse across sessions |
| R5 | P2 | Background sync to enhance index when network returns |

---

## Architecture Design

### 1. Offline Mode Configuration

#### New Configuration Types

```typescript
// File: src/types.ts - Add to BootstrapConfig

export type NetworkMode =
  | 'offline'           // No network access expected
  | 'online'            // Full network access
  | 'opportunistic';    // Use network when available

export interface OfflineModeConfig {
  /** Operating mode for network access */
  networkMode: NetworkMode;

  /** Skip LLM enrichment entirely in offline mode */
  skipLlmEnrichment?: boolean;

  /** Use heuristic fallbacks when LLM unavailable */
  useHeuristicFallbacks?: boolean;

  /** Queue LLM enrichment for later sync */
  deferLlmEnrichment?: boolean;

  /** Background sync interval in ms (0 = disabled) */
  backgroundSyncIntervalMs?: number;
}

// In BootstrapConfig:
export interface BootstrapConfig {
  // ... existing fields ...

  /** Offline mode configuration */
  offlineMode?: OfflineModeConfig;
}
```

#### Environment Variable Support

```typescript
// File: src/config/offline_mode.ts (NEW)

export function resolveNetworkMode(): NetworkMode {
  const envMode = process.env.LIBRARIAN_NETWORK_MODE;
  if (envMode === 'offline' || envMode === 'online' || envMode === 'opportunistic') {
    return envMode;
  }

  // Auto-detect: check if we can reach any provider
  return 'opportunistic';
}

export function resolveOfflineModeConfig(): OfflineModeConfig {
  return {
    networkMode: resolveNetworkMode(),
    skipLlmEnrichment: process.env.LIBRARIAN_SKIP_LLM === 'true',
    useHeuristicFallbacks: process.env.LIBRARIAN_HEURISTIC_FALLBACK !== 'false',
    deferLlmEnrichment: process.env.LIBRARIAN_DEFER_LLM !== 'false',
    backgroundSyncIntervalMs: parseInt(process.env.LIBRARIAN_SYNC_INTERVAL_MS || '0', 10),
  };
}
```

---

### 2. Provider Gate Modifications

#### File: `src/api/provider_gate.ts`

**Current Problem**: `ready = llmReady && embeddingReady` blocks offline use.

**Solution**: Support embedding-only readiness.

```typescript
// Modify runProviderReadinessGate return logic

export interface ProviderGateResult {
  // ... existing fields ...

  /** Whether offline mode is viable (embedding-only) */
  offlineViable: boolean;

  /** Deferred enrichment queue path */
  deferredEnrichmentPath?: string;
}

// In runProviderReadinessGate():
const offlineMode = options.offlineMode ?? resolveOfflineModeConfig();
const offlineViable = embeddingReady; // Embeddings are enough for offline

// Modify ready calculation:
const ready = offlineMode.networkMode === 'offline'
  ? offlineViable
  : (llmReady && embeddingReady);

// Return additional context:
const result: ProviderGateResult = {
  ready,
  offlineViable,
  // ... other fields ...
};
```

---

### 3. Modified Bootstrap Flow

#### File: `src/api/bootstrap.ts`

**Changes Required**:

1. Make LLM requirement conditional
2. Add deferred enrichment queue
3. Store incomplete enrichment state

```typescript
// Current (line 829):
await requireProviders({ llm: true, embedding: true }, { workspaceRoot, forceProbe });

// Proposed change:
const offlineMode = config.offlineMode ?? resolveOfflineModeConfig();
const requireLlm = offlineMode.networkMode !== 'offline' && !offlineMode.skipLlmEnrichment;

await requireProviders(
  { llm: requireLlm, embedding: true },
  { workspaceRoot, forceProbe, allowOffline: !requireLlm }
);

// Track what was deferred for later sync:
if (!requireLlm && offlineMode.deferLlmEnrichment) {
  await initializeDeferredEnrichmentQueue(workspace);
}
```

#### New Phase: knowledge_generation_deferred

```typescript
// In BOOTSTRAP_PHASES array, modify knowledge_generation:

{
  name: 'knowledge_generation',
  description: 'Generating universal knowledge records',
  parallel: true,
  targetDurationMs: 30_000,
  optional: true,  // NEW: Can be skipped in offline mode
  offlineFallback: 'defer_to_sync',  // NEW: Strategy when offline
}
```

---

### 4. Deferred Enrichment Queue

#### File: `src/offline/deferred_enrichment.ts` (NEW)

```typescript
/**
 * @fileoverview Deferred Enrichment Queue
 *
 * Queues entities that need LLM enrichment when offline.
 * Processes queue when network becomes available.
 */

import type { LibrarianStorage } from '../storage/types.js';

export interface DeferredEnrichmentEntry {
  id: string;
  entityId: string;
  entityType: 'function' | 'module' | 'file';
  enrichmentType: 'purpose' | 'semantics' | 'rationale' | 'security';
  priority: number;
  createdAt: string;
  attempts: number;
  lastError?: string;
  contentHash: string;  // For cache validation
}

export interface DeferredEnrichmentQueue {
  /** Add entity to enrichment queue */
  enqueue(entry: Omit<DeferredEnrichmentEntry, 'id' | 'createdAt' | 'attempts'>): Promise<void>;

  /** Get pending entries (ordered by priority) */
  getPending(limit?: number): Promise<DeferredEnrichmentEntry[]>;

  /** Mark entry as complete */
  complete(id: string): Promise<void>;

  /** Mark entry as failed (increment attempt counter) */
  fail(id: string, error: string): Promise<void>;

  /** Get queue statistics */
  getStats(): Promise<{ pending: number; failed: number; completed: number }>;

  /** Clear completed entries older than age */
  prune(maxAgeMs: number): Promise<number>;
}

// SQLite implementation
export class SqliteDeferredEnrichmentQueue implements DeferredEnrichmentQueue {
  constructor(private readonly storage: LibrarianStorage) {}

  // Implementation uses new table: librarian_deferred_enrichment
  // Schema: id, entity_id, entity_type, enrichment_type, priority,
  //         created_at, attempts, last_error, content_hash, status
}
```

#### Storage Schema Addition

```sql
-- Add to SQLite schema in sqlite_storage.ts

CREATE TABLE IF NOT EXISTS librarian_deferred_enrichment (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('function', 'module', 'file')),
  enrichment_type TEXT NOT NULL CHECK(enrichment_type IN ('purpose', 'semantics', 'rationale', 'security')),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX idx_deferred_enrichment_status ON librarian_deferred_enrichment(status, priority DESC);
CREATE INDEX idx_deferred_enrichment_entity ON librarian_deferred_enrichment(entity_id, entity_type);
```

---

### 5. LLM Response Cache

#### File: `src/offline/llm_response_cache.ts` (NEW)

```typescript
/**
 * @fileoverview LLM Response Cache
 *
 * Caches LLM responses by content hash for reuse across sessions.
 * Uses SQLite for persistence with LRU eviction.
 */

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface LlmCacheEntry {
  promptHash: string;
  modelId: string;
  response: string;
  createdAt: string;
  accessCount: number;
  lastAccessedAt: string;
  tokensUsed: { input: number; output: number };
}

export interface LlmCacheKey {
  /** The prompt or input text */
  prompt: string;
  /** Model identifier */
  modelId: string;
  /** Temperature (0 = deterministic, cacheable) */
  temperature: number;
}

export interface LlmResponseCacheConfig {
  /** Maximum cache entries */
  maxEntries?: number;
  /** Maximum cache size in bytes */
  maxSizeBytes?: number;
  /** TTL for cache entries in ms (0 = never expire) */
  ttlMs?: number;
  /** Only cache deterministic responses (temperature = 0) */
  deterministicOnly?: boolean;
}

export class LlmResponseCache {
  private readonly db: Database.Database;
  private readonly config: Required<LlmResponseCacheConfig>;

  constructor(db: Database.Database, config: LlmResponseCacheConfig = {}) {
    this.db = db;
    this.config = {
      maxEntries: config.maxEntries ?? 10_000,
      maxSizeBytes: config.maxSizeBytes ?? 100 * 1024 * 1024,
      ttlMs: config.ttlMs ?? 0,
      deterministicOnly: config.deterministicOnly ?? true,
    };
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS librarian_llm_cache (
        prompt_hash TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        response TEXT NOT NULL,
        created_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TEXT NOT NULL,
        tokens_input INTEGER NOT NULL,
        tokens_output INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_llm_cache_model ON librarian_llm_cache(model_id);
      CREATE INDEX IF NOT EXISTS idx_llm_cache_lru ON librarian_llm_cache(last_accessed_at);
    `);
  }

  computeKey(input: LlmCacheKey): string {
    const normalized = JSON.stringify({
      prompt: input.prompt,
      modelId: input.modelId,
      temperature: input.temperature,
    });
    return createHash('sha256').update(normalized).digest('hex');
  }

  async get(key: LlmCacheKey): Promise<string | undefined> {
    if (this.config.deterministicOnly && key.temperature !== 0) {
      return undefined;
    }

    const promptHash = this.computeKey(key);
    const row = this.db.prepare(`
      SELECT response, created_at FROM librarian_llm_cache
      WHERE prompt_hash = ? AND model_id = ?
    `).get(promptHash, key.modelId) as { response: string; created_at: string } | undefined;

    if (!row) return undefined;

    // Check TTL
    if (this.config.ttlMs > 0) {
      const age = Date.now() - new Date(row.created_at).getTime();
      if (age > this.config.ttlMs) {
        this.db.prepare('DELETE FROM librarian_llm_cache WHERE prompt_hash = ?').run(promptHash);
        return undefined;
      }
    }

    // Update access stats
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE librarian_llm_cache
      SET access_count = access_count + 1, last_accessed_at = ?
      WHERE prompt_hash = ?
    `).run(now, promptHash);

    return row.response;
  }

  async set(key: LlmCacheKey, response: string, tokens: { input: number; output: number }): Promise<void> {
    if (this.config.deterministicOnly && key.temperature !== 0) {
      return;
    }

    const promptHash = this.computeKey(key);
    const now = new Date().toISOString();
    const sizeBytes = Buffer.byteLength(response, 'utf-8');

    this.db.prepare(`
      INSERT INTO librarian_llm_cache
        (prompt_hash, model_id, response, created_at, access_count, last_accessed_at, tokens_input, tokens_output, size_bytes)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
      ON CONFLICT(prompt_hash) DO UPDATE SET
        response = excluded.response,
        last_accessed_at = excluded.last_accessed_at,
        tokens_input = excluded.tokens_input,
        tokens_output = excluded.tokens_output,
        size_bytes = excluded.size_bytes
    `).run(promptHash, key.modelId, response, now, now, tokens.input, tokens.output, sizeBytes);

    await this.evictIfNeeded();
  }

  private async evictIfNeeded(): Promise<void> {
    // Count-based eviction
    const count = (this.db.prepare('SELECT COUNT(*) as count FROM librarian_llm_cache').get() as { count: number }).count;
    if (count > this.config.maxEntries) {
      const toEvict = count - this.config.maxEntries + Math.floor(this.config.maxEntries * 0.1);
      this.db.prepare(`
        DELETE FROM librarian_llm_cache WHERE prompt_hash IN (
          SELECT prompt_hash FROM librarian_llm_cache
          ORDER BY last_accessed_at ASC
          LIMIT ?
        )
      `).run(toEvict);
    }

    // Size-based eviction
    const totalSize = (this.db.prepare('SELECT COALESCE(SUM(size_bytes), 0) as total FROM librarian_llm_cache').get() as { total: number }).total;
    if (totalSize > this.config.maxSizeBytes) {
      this.db.prepare(`
        DELETE FROM librarian_llm_cache WHERE prompt_hash IN (
          SELECT prompt_hash FROM librarian_llm_cache
          ORDER BY last_accessed_at ASC
          LIMIT ?
        )
      `).run(Math.max(1, Math.floor(count * 0.2)));
    }
  }
}
```

---

### 6. Modified LLM Service Adapter

#### File: `src/adapters/llm_service.ts`

Add caching wrapper:

```typescript
import { LlmResponseCache } from '../offline/llm_response_cache.js';

export interface CachingLlmServiceAdapterConfig {
  adapter: LlmServiceAdapter;
  cache: LlmResponseCache;
  fallbackToCache: boolean;  // Use cache if provider unavailable
}

export class CachingLlmServiceAdapter implements LlmServiceAdapter {
  constructor(private readonly config: CachingLlmServiceAdapterConfig) {}

  async chat(options: LlmChatOptions): Promise<{ content: string; provider: string }> {
    const cacheKey: LlmCacheKey = {
      prompt: options.messages.map(m => `${m.role}:${m.content}`).join('\n'),
      modelId: options.modelId,
      temperature: options.temperature ?? 0,
    };

    // Try cache first
    const cached = await this.config.cache.get(cacheKey);
    if (cached !== undefined) {
      return { content: cached, provider: `${options.provider}:cached` };
    }

    // Try live provider
    try {
      const result = await this.config.adapter.chat(options);

      // Cache the result (only deterministic by default)
      await this.config.cache.set(cacheKey, result.content, {
        input: estimateTokens(cacheKey.prompt),
        output: estimateTokens(result.content),
      });

      return result;
    } catch (error) {
      // If provider fails and fallback enabled, return cached (if available)
      if (this.config.fallbackToCache && cached !== undefined) {
        return { content: cached, provider: `${options.provider}:cached_fallback` };
      }
      throw error;
    }
  }

  // Pass-through health checks
  checkClaudeHealth = (force?: boolean) => this.config.adapter.checkClaudeHealth(force);
  checkCodexHealth = (force?: boolean) => this.config.adapter.checkCodexHealth(force);
}
```

---

### 7. Background Sync Service

#### File: `src/offline/background_sync.ts` (NEW)

```typescript
/**
 * @fileoverview Background Sync Service
 *
 * Processes deferred enrichment queue when network is available.
 * Runs as a background task during idle periods.
 */

import type { LibrarianStorage } from '../storage/types.js';
import type { DeferredEnrichmentQueue, DeferredEnrichmentEntry } from './deferred_enrichment.js';
import type { LlmServiceAdapter } from '../adapters/llm_service.js';
import { checkProviderSnapshot } from '../api/provider_check.js';

export interface BackgroundSyncConfig {
  /** Storage instance */
  storage: LibrarianStorage;

  /** Deferred enrichment queue */
  queue: DeferredEnrichmentQueue;

  /** LLM service for enrichment */
  llmService: LlmServiceAdapter;

  /** Workspace path for provider checks */
  workspacePath: string;

  /** Check interval in ms */
  checkIntervalMs?: number;

  /** Batch size for processing */
  batchSize?: number;

  /** Max retries per entry */
  maxRetries?: number;

  /** Callback on sync progress */
  onProgress?: (stats: SyncProgress) => void;
}

export interface SyncProgress {
  pending: number;
  processed: number;
  failed: number;
  isOnline: boolean;
}

export class BackgroundSyncService {
  private readonly config: Required<Omit<BackgroundSyncConfig, 'onProgress'>> & Pick<BackgroundSyncConfig, 'onProgress'>;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(config: BackgroundSyncConfig) {
    this.config = {
      ...config,
      checkIntervalMs: config.checkIntervalMs ?? 5 * 60_000, // 5 minutes
      batchSize: config.batchSize ?? 10,
      maxRetries: config.maxRetries ?? 3,
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.config.checkIntervalMs);
    // Run immediately on start
    setImmediate(() => this.tick());
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Check if we're online
      const providerStatus = await checkProviderSnapshot({ workspaceRoot: this.config.workspacePath });
      const isOnline = providerStatus.status.llm.available;

      if (!isOnline) {
        const stats = await this.config.queue.getStats();
        this.config.onProgress?.({ ...stats, processed: 0, isOnline: false });
        return;
      }

      // Process pending entries
      const pending = await this.config.queue.getPending(this.config.batchSize);
      let processed = 0;
      let failed = 0;

      for (const entry of pending) {
        try {
          await this.processEntry(entry);
          await this.config.queue.complete(entry.id);
          processed++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.config.queue.fail(entry.id, message);

          if (entry.attempts + 1 >= this.config.maxRetries) {
            failed++;
          }
        }
      }

      const stats = await this.config.queue.getStats();
      this.config.onProgress?.({ ...stats, processed, isOnline: true });

    } finally {
      this.isProcessing = false;
    }
  }

  private async processEntry(entry: DeferredEnrichmentEntry): Promise<void> {
    // Load entity from storage
    const entity = await this.loadEntity(entry.entityId, entry.entityType);
    if (!entity) {
      throw new Error(`Entity not found: ${entry.entityId}`);
    }

    // Check if content changed (invalidates deferred enrichment)
    const currentHash = computeContentHash(entity.content ?? '');
    if (currentHash !== entry.contentHash) {
      // Content changed, skip enrichment (will be re-queued on next index)
      return;
    }

    // Perform enrichment based on type
    switch (entry.enrichmentType) {
      case 'purpose':
        await this.enrichPurpose(entity);
        break;
      case 'semantics':
        await this.enrichSemantics(entity);
        break;
      case 'rationale':
        await this.enrichRationale(entity);
        break;
      case 'security':
        await this.enrichSecurity(entity);
        break;
    }
  }

  // Implementation details for each enrichment type...
}
```

---

### 8. Modified Query Flow

#### File: `src/api/query.ts`

Ensure queries return **structural outputs** without LLM (no semantic narrative):

```typescript
// In queryLibrarian():

const offlineMode = config.offlineMode ?? resolveOfflineModeConfig();
const llmAvailable = await isLlmAvailable(storage);

// Determine if synthesis should be attempted
const canSynthesize = llmAvailable && !offlineMode.skipLlmEnrichment;

// If synthesis not available, return with raw context packs + disclosure
if (!canSynthesize && query.synthesize) {
  const response = buildResponseWithoutSynthesis(contextPacks, query);
  response.warnings = response.warnings ?? [];
  response.warnings.push('unverified_by_trace(llm_required): LLM synthesis unavailable. Returning structural packs only.');
  return response;
}
```

---

### 9. Embedding Model Pre-download

#### File: `src/offline/model_preload.ts` (NEW)

```typescript
/**
 * @fileoverview Embedding Model Pre-download
 *
 * Ensures the Xenova embedding model is downloaded and cached locally
 * before any offline operation is needed.
 */

import { pipeline, env } from '@xenova/transformers';

export interface ModelPreloadConfig {
  /** Model to preload */
  modelId?: string;
  /** Custom cache directory */
  cacheDir?: string;
  /** Progress callback */
  onProgress?: (progress: number) => void;
}

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

export async function preloadEmbeddingModel(config: ModelPreloadConfig = {}): Promise<{
  success: boolean;
  modelPath?: string;
  error?: string;
}> {
  const modelId = config.modelId ?? DEFAULT_MODEL;

  if (config.cacheDir) {
    env.cacheDir = config.cacheDir;
  }

  try {
    // This will download the model if not already cached
    const pipe = await pipeline('feature-extraction', modelId, {
      quantized: true,
      progress_callback: (progress: any) => {
        if (progress.status === 'downloading' && typeof progress.progress === 'number') {
          config.onProgress?.(progress.progress);
        }
      },
    });

    // Verify the model works
    const testEmbedding = await pipe('test', { pooling: 'mean', normalize: true });
    if (!testEmbedding || !testEmbedding.data) {
      throw new Error('Model verification failed');
    }

    return {
      success: true,
      modelPath: env.cacheDir,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getModelCacheStatus(): {
  cached: boolean;
  modelPath?: string;
  sizeBytes?: number;
} {
  // Check if model files exist in cache directory
  // Implementation depends on Xenova cache structure
  return { cached: false }; // Placeholder
}
```

---

### 10. CLI Commands

#### File: `src/cli/commands/offline.ts` (NEW)

```typescript
/**
 * @fileoverview Offline mode CLI commands
 */

export const offlineCommand = {
  name: 'offline',
  description: 'Manage offline mode and background sync',
  subcommands: {
    status: {
      description: 'Show offline mode status and sync queue',
      handler: async (args: string[]) => {
        // Show:
        // - Current network mode
        // - Embedding model cache status
        // - Deferred enrichment queue stats
        // - Background sync status
      },
    },
    preload: {
      description: 'Pre-download models for offline use',
      handler: async (args: string[]) => {
        // Download embedding model
        // Optionally download other resources
      },
    },
    sync: {
      description: 'Manually trigger background sync',
      handler: async (args: string[]) => {
        // Force process deferred enrichment queue
      },
    },
    'clear-queue': {
      description: 'Clear deferred enrichment queue',
      handler: async (args: string[]) => {
        // Clear pending/failed entries
      },
    },
  },
};
```

---

## Implementation Plan

### Phase 1: Core Offline Support (Week 1-2)

1. **Add network mode configuration**
   - Add `OfflineModeConfig` to types
   - Implement `resolveOfflineModeConfig()`
   - Add environment variable support

2. **Modify provider gate**
   - Add `offlineViable` to result
   - Support embedding-only mode
   - Update bootstrap to use new gate behavior

3. **Ensure embedding pre-download**
   - Implement model preload utility
   - Add CLI command for preloading

### Phase 2: Deferred Enrichment (Week 3-4)

4. **Implement deferred enrichment queue**
   - Add SQLite schema
   - Implement queue interface
   - Integrate with bootstrap

5. **Modify knowledge generator**
   - Add heuristic fallback by default
   - Queue LLM enrichment when offline
   - Track enrichment status per entity

### Phase 3: LLM Response Caching (Week 5-6)

6. **Implement LLM response cache**
   - Add cache table to SQLite
   - Implement caching LLM adapter
   - Configure cache eviction

7. **Integrate cache with existing LLM calls**
   - Purpose extraction
   - Semantic extraction
   - Query synthesis

### Phase 4: Background Sync (Week 7-8)

8. **Implement background sync service**
   - Network status detection
   - Queue processing
   - Progress reporting

9. **Add homeostasis integration**
   - Register with daemon
   - Trigger sync on network recovery
   - Report sync health

### Phase 5: Testing and Polish (Week 9-10)

10. **Comprehensive testing**
    - Offline bootstrap tests
    - Deferred enrichment tests
    - Cache hit/miss tests
    - Sync service tests

11. **Documentation and CLI**
    - Add offline CLI commands
    - Update documentation
    - Add migration guide

---

## File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/types.ts` | Modify | Add `NetworkMode`, `OfflineModeConfig` |
| `src/config/offline_mode.ts` | New | Configuration resolution |
| `src/api/provider_gate.ts` | Modify | Support offline-viable mode |
| `src/api/bootstrap.ts` | Modify | Conditional LLM requirement |
| `src/offline/deferred_enrichment.ts` | New | Deferred enrichment queue |
| `src/offline/llm_response_cache.ts` | New | LLM response caching |
| `src/offline/background_sync.ts` | New | Background sync service |
| `src/offline/model_preload.ts` | New | Embedding model pre-download |
| `src/adapters/llm_service.ts` | Modify | Add caching wrapper |
| `src/storage/sqlite_storage.ts` | Modify | Add new tables |
| `src/api/query.ts` | Modify | Handle missing LLM gracefully |
| `src/knowledge/generator.ts` | Modify | Use heuristics when offline |
| `src/api/embedding_providers/llm_purpose_extractor.ts` | Modify | Default `allowHeuristics: true` |
| `src/homeostasis/daemon.ts` | Modify | Integrate sync service |
| `src/cli/commands/offline.ts` | New | Offline CLI commands |
| `src/cli/index.ts` | Modify | Register offline commands |

---

## Configuration Examples

### Fully Offline Mode

```bash
export LIBRARIAN_NETWORK_MODE=offline
export LIBRARIAN_SKIP_LLM=true

LiBrainian bootstrap --mode fast
```

### Opportunistic Mode (Default)

```bash
# Uses LLM when available, defers when not
export LIBRARIAN_NETWORK_MODE=opportunistic
export LIBRARIAN_DEFER_LLM=true

LiBrainian bootstrap
```

### Force Online Mode

```bash
export LIBRARIAN_NETWORK_MODE=online

# This will fail if LLM is unavailable
LiBrainian bootstrap
```

---

## Testing Strategy

### Unit Tests

```typescript
// src/offline/__tests__/deferred_enrichment.test.ts
describe('DeferredEnrichmentQueue', () => {
  it('should enqueue entities when offline', async () => {});
  it('should process queue in priority order', async () => {});
  it('should handle content hash changes', async () => {});
  it('should respect max retry limit', async () => {});
});

// src/offline/__tests__/llm_response_cache.test.ts
describe('LlmResponseCache', () => {
  it('should cache deterministic responses', async () => {});
  it('should not cache non-deterministic responses', async () => {});
  it('should evict by LRU when full', async () => {});
  it('should respect TTL', async () => {});
});
```

### Integration Tests

```typescript
// src/__tests__/offline_bootstrap.test.ts
describe('Offline Bootstrap', () => {
  it('should complete bootstrap without LLM', async () => {
    // Set offline mode
    // Bootstrap
    // Verify embeddings generated
    // Verify LLM enrichment deferred
  });

  it('should query successfully in offline mode', async () => {
    // Bootstrap offline
    // Run query
    // Verify response uses context packs
    // Verify no synthesis (but no error)
  });
});
```

---

## Rollback Strategy

If issues arise:

1. **Environment variable escape hatch**: Set `LIBRARIAN_NETWORK_MODE=online` to force original behavior
2. **Feature flag**: Add `LIBRARIAN_OFFLINE_FEATURES=false` to disable all offline features
3. **Database migration**: New tables are additive; can be ignored by old code

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Offline bootstrap success rate | 100% | CI tests in offline mode |
| Offline query latency | < 2x online | Benchmark comparison |
| Cache hit rate (after warm-up) | > 80% | Production metrics |
| Sync queue processing time | < 10 min for 1000 entities | Load test |
| Memory footprint (offline) | < 500MB | Resource monitoring |

---

## Appendix: Zero-Knowledge Protocol Alignment

The offline-first design aligns with the existing zero-knowledge bootstrap protocol (`src/api/zero_knowledge_bootstrap.ts`):

1. **structural_inventory** - Fully offline (AST parsing)
2. **naming_inference** - Fully offline (pattern matching)
3. **structural_inference** - Fully offline (graph analysis)
4. **behavioral_probing** - Mostly offline (build/test execution)
5. **semantic_extraction** - **Deferred when offline**
6. **verification_loop** - Partially offline (cross-check available data)

The offline architecture ensures **structural levels 1–3** are always achievable; semantic understanding (level 4) is **LLM‑required** and must be deferred with explicit disclosure until providers are available.
