-- Migration 010: Advanced Analysis Tables
-- Enables deterministic (SCC, CFG), probabilistic (Bayesian), and hybrid (stability, feedback loops) analysis

-- 1. Strongly Connected Components
-- Stores pre-computed SCCs for cycle detection and dependency analysis
CREATE TABLE IF NOT EXISTS librainian_scc (
  component_id INTEGER NOT NULL,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  is_root INTEGER NOT NULL DEFAULT 0,
  component_size INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (entity_id, entity_type)
);
CREATE INDEX IF NOT EXISTS idx_scc_component ON librainian_scc(component_id);
CREATE INDEX IF NOT EXISTS idx_scc_size ON librainian_scc(component_size DESC);
CREATE INDEX IF NOT EXISTS idx_scc_roots ON librainian_scc(is_root) WHERE is_root = 1;

-- 2. Control Flow Edges (function-level CFG)
-- Stores basic block graph for control flow analysis
CREATE TABLE IF NOT EXISTS librainian_cfg_edges (
  function_id TEXT NOT NULL,
  from_block INTEGER NOT NULL,
  to_block INTEGER NOT NULL,
  edge_type TEXT NOT NULL,
  condition TEXT,
  source_line INTEGER,
  confidence REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (function_id, from_block, to_block, edge_type)
);
CREATE INDEX IF NOT EXISTS idx_cfg_function ON librainian_cfg_edges(function_id);
CREATE INDEX IF NOT EXISTS idx_cfg_edge_type ON librainian_cfg_edges(edge_type);

-- 3. Bayesian Confidence Tracking
-- Beta-Binomial conjugate prior for proper uncertainty quantification
CREATE TABLE IF NOT EXISTS librainian_bayesian_confidence (
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  prior_alpha REAL NOT NULL DEFAULT 1.0,
  prior_beta REAL NOT NULL DEFAULT 1.0,
  posterior_alpha REAL NOT NULL DEFAULT 1.0,
  posterior_beta REAL NOT NULL DEFAULT 1.0,
  observation_count INTEGER NOT NULL DEFAULT 0,
  last_observation TEXT,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (entity_id, entity_type)
);
CREATE INDEX IF NOT EXISTS idx_bayesian_type ON librainian_bayesian_confidence(entity_type);
CREATE INDEX IF NOT EXISTS idx_bayesian_observations ON librainian_bayesian_confidence(observation_count DESC);

-- 4. Stability Metrics (time-series analysis)
-- Tracks confidence volatility and trend for predictive analysis
CREATE TABLE IF NOT EXISTS librainian_stability_metrics (
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  volatility REAL NOT NULL,
  trend REAL NOT NULL,
  mean_reversion_rate REAL,
  half_life_days REAL,
  seasonality_period_days INTEGER,
  last_change_delta REAL,
  computed_at TEXT NOT NULL,
  window_days INTEGER NOT NULL DEFAULT 30,
  PRIMARY KEY (entity_id, entity_type)
);
CREATE INDEX IF NOT EXISTS idx_stability_volatility ON librainian_stability_metrics(volatility DESC);
CREATE INDEX IF NOT EXISTS idx_stability_trend ON librainian_stability_metrics(trend);

-- 5. Feedback Loop Detection
-- Stores detected cycles in dependency/data flow graphs
CREATE TABLE IF NOT EXISTS librainian_feedback_loops (
  loop_id TEXT PRIMARY KEY,
  loop_type TEXT NOT NULL,
  entities TEXT NOT NULL,
  severity TEXT NOT NULL,
  is_stable INTEGER NOT NULL,
  cycle_length INTEGER NOT NULL,
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_method TEXT
);
CREATE INDEX IF NOT EXISTS idx_loops_severity ON librainian_feedback_loops(severity);
CREATE INDEX IF NOT EXISTS idx_loops_type ON librainian_feedback_loops(loop_type);
CREATE INDEX IF NOT EXISTS idx_loops_unresolved ON librainian_feedback_loops(resolved_at);

-- 6. Graph Analysis Cache
-- Caches expensive graph computations with TTL
CREATE TABLE IF NOT EXISTS librainian_graph_cache (
  cache_key TEXT PRIMARY KEY,
  analysis_type TEXT NOT NULL,
  result TEXT NOT NULL,
  node_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  computation_ms INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_graph_cache_type ON librainian_graph_cache(analysis_type);
CREATE INDEX IF NOT EXISTS idx_graph_cache_expires ON librainian_graph_cache(expires_at);
