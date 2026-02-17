# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Package identity hardening scripts:
  - `npm run package:assert-identity`
  - `npm run package:install-smoke`
- Publish-path safeguards in `prepublishOnly` and `release` scripts.
- GitHub governance docs:
  - `CODE_OF_CONDUCT.md`
  - `SECURITY.md`
  - `.github/CODEOWNERS`
  - `.github/ISSUE_TEMPLATE/config.yml`

### Changed
- npm package name from `librarian` to `librainian` to avoid npm registry collision.
- Added backward-compatible CLI bin alias so both `librainian` and `librarian` commands resolve.
- Updated public docs and examples to use `librainian` install/import commands.
- Replaced legacy Wave0-prefixed environment naming with `LIBRARIAN_` naming across active docs/scripts/tests.

## [0.2.0] - 2026-01-29

### Added

#### Epistemics Framework (5 New Modules)
- **Conative Attitudes** (`src/epistemics/conative_attitudes.ts`) - Action-directed reasoning with intentions, preferences, goals, desires, and BDI agent states. 110 tests.
- **Temporal Grounding** (`src/epistemics/temporal_grounding.ts`) - Time-based validity with decay functions, half-life calculations, and automatic staleness detection. 60 tests.
- **Intuitive Grounding** (`src/epistemics/intuitive_grounding.ts`) - Pattern recognition with articulability scoring and upgrade paths to formal justification. 80 tests.
- **Inference Auditing** (`src/epistemics/inference_auditor.ts`) - Fallacy detection (circular reasoning, hasty generalization, etc.) with suggested fixes. 99 tests.
- **Quality Gates** (`src/epistemics/quality_gates.ts`) - Course correction system for maintaining epistemic standards during agent operations. 68 tests.

#### Evaluation Framework (4 New Modules)
- **Adversarial Pattern Detection** (`src/evaluation/adversarial_patterns.ts`) - Detects prompt injection, jailbreak attempts, and manipulation patterns. 112 tests.
- **AST Fact Extractor** (`src/evaluation/ast_fact_extractor.ts`) - Extracts verifiable facts from code AST for claim verification. 65 tests.
- **Enhanced Citation Verifier** (`src/evaluation/enhanced_citation_verifier.ts`) - Multi-source citation verification with cross-validation. 56 tests.
- **Chain-of-Verification (CoVe)** (`src/evaluation/chain_of_verification.ts`) - Implements the CoVe research paper for systematic claim verification. 82 tests.

#### Analysis Framework (1 New Module)
- **Data Flow Analysis** (`src/analysis/data_flow.ts`) - Analyzes data flow through code including taint tracking, def-use chains, and reaching definitions. 48 tests.

#### Core Improvements
- **TypeScript Strict Mode** - Enabled strict type checking across the entire codebase
- **Calibration Laws** (`src/epistemics/calibration_laws.ts`) - Proper algebraic laws for confidence with semilattice structure
- **Formula AST** (`src/epistemics/formula_ast.ts`) - Proven formula AST with proof terms for derived confidence
- **Resource Monitoring** - Enhanced test infrastructure with memory-aware worker scaling

### Changed
- Migrated `DerivedConfidence` to use proven formulas with explicit proof terms
- Improved calibration system with isotonic calibration and PAC-based sample thresholds
- Enhanced evidence ledger with W3C PROV export support

### Test Coverage
- **780 new tests** across 10 new module test files
- All tests passing with 100% success rate
- Average statement coverage: ~93%
- Average function coverage: ~99%
- Average branch coverage: ~88%

### Documentation
- Added comprehensive `docs/librarian/EPISTEMICS.md` guide
- Added `docs/librarian/test-verification-report.md` with detailed test analysis
- Updated architecture documentation with new modules

## [0.1.0] - 2026-01-15

### Added
- Initial release of Librarian
- Core indexing and semantic query
- Quality issue detection with ROI ranking
- Best practices database
- MCP server for IDE integration
- Epistemic confidence framework (calibrated confidence, evidence ledger, defeaters)
- Universal coherence framework
- SQLite and in-memory storage backends
- CLI with bootstrap, query, quality, and research commands

### Core Modules
- **Confidence System** - Calibrated confidence with Bayesian updates
- **Evidence Ledger** - Append-only audit trail with W3C PROV export
- **Defeater Calculus** - Formal system for tracking claim defeat
- **Calibration Curves** - Isotonic calibration with proper scoring rules
- **Belief Functions** - Dempster-Shafer theory implementation
- **AGM Belief Revision** - Formal belief update with entrenchment
- **Credal Sets** - Interval arithmetic for uncertainty propagation
- **Multi-Agent Epistemics** - Social epistemics with testimony evaluation

---

[Unreleased]: https://github.com/nateschmiedehaus/librarian/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/nateschmiedehaus/librarian/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nateschmiedehaus/librarian/releases/tag/v0.1.0
