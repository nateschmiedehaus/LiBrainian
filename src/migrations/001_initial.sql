-- Metadata table
CREATE TABLE IF NOT EXISTS librarian_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Functions table
CREATE TABLE IF NOT EXISTS librarian_functions (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  name TEXT NOT NULL,
  signature TEXT NOT NULL,
  purpose TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  is_pure INTEGER NOT NULL DEFAULT 0,
  has_side_effects INTEGER NOT NULL DEFAULT 0,
  modifies_params INTEGER NOT NULL DEFAULT 0,
  throws INTEGER NOT NULL DEFAULT 0,
  return_depends_on_inputs INTEGER NOT NULL DEFAULT 0,
  effect_signature TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.5,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed TEXT,
  validation_count INTEGER NOT NULL DEFAULT 0,
  outcome_successes INTEGER NOT NULL DEFAULT 0,
  outcome_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(file_path, name)
);

CREATE INDEX IF NOT EXISTS idx_functions_file ON librarian_functions(file_path);
CREATE INDEX IF NOT EXISTS idx_functions_confidence ON librarian_functions(confidence DESC);

-- Modules table
CREATE TABLE IF NOT EXISTS librarian_modules (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL,
  exports TEXT NOT NULL,
  dependencies TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Context packs table
CREATE TABLE IF NOT EXISTS librarian_context_packs (
  pack_id TEXT PRIMARY KEY,
  pack_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_facts TEXT NOT NULL,
  code_snippets TEXT NOT NULL,
  related_files TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_outcome TEXT DEFAULT 'unknown',
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  version_string TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 1,
  invalidation_triggers TEXT NOT NULL,
  invalidated INTEGER NOT NULL DEFAULT 0,
  UNIQUE(target_id, pack_type)
);

CREATE INDEX IF NOT EXISTS idx_packs_target ON librarian_context_packs(target_id);
CREATE INDEX IF NOT EXISTS idx_packs_type ON librarian_context_packs(pack_type);

-- Embeddings table
CREATE TABLE IF NOT EXISTS librarian_embeddings (
  entity_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  embedding BLOB NOT NULL,
  model_id TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0
);

-- Multi-vector embeddings (per entity)
CREATE TABLE IF NOT EXISTS librarian_multi_vectors (
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  model_id TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_id, entity_type)
);
CREATE INDEX IF NOT EXISTS idx_multi_vectors_type ON librarian_multi_vectors(entity_type);

-- Indexing history table
CREATE TABLE IF NOT EXISTS librarian_indexing_history (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  files_processed INTEGER NOT NULL,
  functions_indexed INTEGER NOT NULL,
  modules_indexed INTEGER NOT NULL,
  context_packs_created INTEGER NOT NULL,
  errors TEXT NOT NULL,
  version_string TEXT NOT NULL
);

-- Bootstrap history table
CREATE TABLE IF NOT EXISTS librarian_bootstrap_history (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  phases TEXT NOT NULL,
  total_files INTEGER NOT NULL,
  total_functions INTEGER NOT NULL,
  total_context_packs INTEGER NOT NULL,
  version_string TEXT NOT NULL,
  success INTEGER NOT NULL,
  error TEXT
);
