CREATE TABLE IF NOT EXISTS librarian_conventions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  pattern TEXT NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  exceptions TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'mined',
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_librarian_conventions_category
  ON librarian_conventions(category, rule_type);

CREATE INDEX IF NOT EXISTS idx_librarian_conventions_source
  ON librarian_conventions(source);

CREATE INDEX IF NOT EXISTS idx_librarian_conventions_confidence
  ON librarian_conventions(confidence DESC);
