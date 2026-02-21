/**
 * @fileoverview Detailed help text for librainian CLI commands
 */

const HELP_TEXT = {
  main: `
LiBrainian CLI

USAGE:
    librainian <command> [options]
    librainian <command> [options]     # compatibility alias

START HERE:
    librainian quickstart
    librainian setup --depth quick
    librainian query "How does authentication work?"
    librainian status --format json
    librainian stats --json

COMMANDS:
    quickstart          Smooth onboarding and recovery flow
    setup               Alias for quickstart (setup-oriented naming)
    init                Scaffold templates or run quickstart/editor onboarding
    query <intent>      Run a query against the knowledge base
    repo-map            Generate a compact, ranked symbol map of the repository
    feedback <token>    Submit outcome feedback for a prior query
    status              Show current index and health status
    stats               Summarize tool-call cost/performance telemetry
    calibration         Build confidence calibration dashboard from patrol artifacts
    bootstrap           Initialize or refresh the knowledge index
    embed               Repair and backfill semantic embeddings
    uninstall           Remove LiBrainian bootstrap artifacts from workspace
    install-openclaw-skill Install official OpenClaw skill and config wiring
    openclaw-daemon     Manage OpenClaw daemon registration and state
    memory-bridge       Show MEMORY.md bridge state and manage session core memory
    test-integration    Run quantitative integration benchmark suites
    benchmark           Run local performance SLA diagnostics
    privacy-report      Summarize privacy audit evidence
    export              Export portable .librainian index bundle
    import              Import portable .librainian index bundle
    features            Show dynamic feature registry and current status
    capabilities        Emit machine-readable capability inventory
    mcp                 Start MCP stdio server / print client config snippets
    eject-docs          Remove injected librainian docs from CLAUDE.md files
    generate-docs       Generate TOOLS/CONTEXT/RULES prompt docs
    check-providers     Check provider availability and authentication
    audit-skill         Audit a SKILL.md for malicious patterns
    watch               Watch for file changes and auto-reindex
    check               Run diff-aware CI integrity checks
    scan                Show security redaction scan results
    compose             Compose construction pipelines or technique bundles
    constructions       Browse/search/describe/install/validate constructions
    doctor              Run diagnostics and recovery hints
    health              Show current LiBrainian health status
    check               Run CI integrity checks for changed files
    smoke               Run external repo smoke harness
    journey             Run agentic journey simulations
    live-fire           Run continuous objective trial matrix
    publish-gate        Run strict publish-readiness gate checks
    help [command]      Show help for a command

ADVANCED:
    inspect <module>    Inspect a module or function's knowledge
    confidence <entity> Show confidence scores for an entity
    validate <file>     Validate constraints for a file
    visualize           Generate codebase visualizations
    coverage            Generate UC x method x scenario coverage audit
    heal                Run homeostatic healing loop until healthy
    evolve              Run evolutionary improvement loop
    eval                Produce FitnessReport.v1 for current state
    replay              Replay an evolution cycle or variant
    index --force ...        Incrementally index explicit files or git-selected changes
    update              Hook-friendly alias for incremental index updates
    scan --secrets      Report secret redaction audit totals
    analyze             Run static analysis (dead code, complexity)
    config heal         Auto-detect and fix suboptimal configuration
    repair              Run DETECT->FIX->VERIFY loop and write an audit report
    ralph               Deprecated alias for repair
    external-repos      Sync external repo corpus from manifest.json
    export              Export portable index bundle for team/CI reuse
    import              Import portable index bundle from another machine

GLOBAL OPTIONS:
    -h, --help          Show help information
    -v, --version       Show version information
    -y, --yes           Non-interactive defaults (assume yes for confirmations)
    -q, --quiet         Suppress non-error output (ignored with --json)
    -w, --workspace     Set workspace directory (default: current directory)
    --ci                Force CI/non-interactive runtime mode
    --no-progress       Disable spinner/progress output
    --no-color          Disable ANSI colors (also respects NO_COLOR)
    --offline           Disable remote LLM/provider network calls (local embeddings only)
    --no-telemetry      Disable local telemetry logging output
    --local-only        Force fully local operation (implies --offline)
    --verbose           Enable verbose output
    --debug             Include stack traces and verbose error diagnostics
    --json              Enable JSON output for errors (agent friendly)

EXAMPLES:
    librainian quickstart
    librainian query "How does the payment flow work?"
    librainian bootstrap --force
    librainian check --diff HEAD~1..HEAD --format junit
    librainian uninstall --dry-run
    librainian audit-skill ./SKILL.md --json
    librainian install-openclaw-skill --dry-run
    librainian openclaw-daemon start --json
    librainian memory-bridge status --json
    librainian memory-bridge remember auth_model "JWT expires in 1 hour"
    librainian test-integration --suite openclaw --json
    librainian benchmark --json
    librainian privacy-report --since 2026-02-01T00:00:00Z --json
    librainian export --output state/exports/librainian-index.tar.gz
    librainian import --input state/exports/librainian-index.tar.gz
    librainian features --json
    librainian capabilities --json --out state/capabilities.json
    librainian mcp --print-config --client claude
    librainian generate-docs --include tools,context,rules
    librainian compose "Prepare a release plan" --limit 1
    librainian constructions search "security audit"
    librainian publish-gate --profile release --json

For command-specific details:
    librainian help <command>
`,

  status: `
librainian status - Show current librainian status and index health

USAGE:
    librainian status [options]

OPTIONS:
    --verbose           Show detailed statistics
    --format text|json  Output format (default: text)
    --json              Alias for --format json
    --out <path>        Write JSON output to file (requires --json/--format json)
    --costs             Include per-query/session cost telemetry from evidence ledger
    --cost-budget-usd <n>  Override session budget threshold used for cost alerts
    --cost-window-days <n> Rolling telemetry window in days (default: 7)
    --cost-limit <n>    Number of recent query rows to include (default: 10, max: 20)
    --workspace-set <path>  Load monorepo workspace-set config and report per-package status

DESCRIPTION:
    Displays the current state of the librainian knowledge index, including:
    - Bootstrap status and version
    - Number of indexed files, functions, and modules
    - Context pack statistics
    - Provider availability
    - Index health indicators
    - Optional per-query cost/runtime telemetry when --costs is enabled

EXAMPLES:
    librainian status
    librainian status --verbose
    librainian status --costs --cost-budget-usd 0.50
    librainian status --json --out /tmp/librainian-status.json
`,

  stats: `
librainian stats - Summarize evidence-ledger tool-call cost/performance telemetry

USAGE:
    librainian stats [options]

OPTIONS:
    --days <n>          Rolling window in days (default: 7)
    --limit <n>         Number of top tools in breakdown (default: 5)
    --json              Output machine-readable JSON report

DESCRIPTION:
    Aggregates MCP tool-call telemetry from .librainian/evidence_ledger.db:
    - Total calls, estimated cost, average duration, cache-hit rate
    - Top expensive tools in the selected time window
    - Daily trend snapshot and optimization recommendations

EXAMPLES:
    librainian stats
    librainian stats --days 30 --limit 10
    librainian stats --json
`,

  calibration: `
librainian calibration - Build confidence calibration dashboard from patrol runs

USAGE:
    librainian calibration [options]

OPTIONS:
    --patrol-dir <path>    Path to patrol artifacts directory (default: state/patrol)
    --bucket-count <n>     Number of reliability buckets (default: 10)
    --min-samples <n>      Minimum required sample count for readiness (default: 50)
    --json                 Output machine-readable JSON report

DESCRIPTION:
    Reads patrol-run artifacts and computes calibration health, including:
    - Reliability buckets (stated confidence vs observed correctness)
    - Expected Calibration Error (ECE)
    - Maximum Calibration Error (MCE)
    - Overconfidence ratio
    - Per-run trend over time

    Also emits actionable recommendations when calibration quality is weak
    or sample volume is insufficient.

EXAMPLES:
    librainian calibration
    librainian calibration --bucket-count 12 --min-samples 80
    librainian calibration --patrol-dir state/patrol --json
`,

  query: `
librainian query - Run a query against the knowledge base

USAGE:
    librainian query "<intent>" [options]

OPTIONS:
    --depth <level>     Query depth: L0 (shallow), L1 (default), L2 (deep), L3 (comprehensive)
    --files <paths>     Comma-separated list of affected files
    --scope <path>      Workspace-relative scope alias (maps to filter.pathPrefix)
    --diversify         Enable MMR diversification to reduce redundant packs
    --diversity-lambda <n>  MMR lambda in [0,1] (1=relevance, 0=diversity, default: 0.5)
    --no-synthesis      Disable LLM synthesis/method hints (retrieval only)
    --deterministic     Enable deterministic mode for testing (skips LLM, stable sorting)
    --llm-provider <p>  Override LLM provider for synthesis: claude | codex (default: stored bootstrap setting or env)
    --llm-model <id>    Override LLM model id for synthesis (default: stored bootstrap setting or env)
    --uc <ids>          Comma-separated UC IDs (e.g., UC-041,UC-042)
    --uc-priority <p>   UC priority: low|medium|high
    --uc-evidence <n>   Evidence threshold (0.0-1.0)
    --uc-freshness-days <n>  Max staleness in days
    --token-budget <n>  Maximum tokens for response (enables intelligent truncation)
    --token-reserve <n> Reserve tokens for agent response (subtracted from budget)
    --token-priority <p> Truncation priority: relevance|recency|diversity (default: relevance)
    --enumerate         Enable enumeration mode for listing queries (returns complete lists)
    --exhaustive        Enable exhaustive mode for dependency queries (returns all dependents)
    --transitive        Include transitive dependencies (with --exhaustive)
    --max-depth <n>     Maximum depth for transitive traversal (default: 10)
    --session <id>      Session mode: "new" starts a session, existing id continues it
    --drill-down <id>   Drill into an entity/file within an existing session
    --json              Output results as JSON
    --out <path>        Write JSON output to file (requires --json)

DESCRIPTION:
    Queries the librainian knowledge base for context packs matching your intent.
    The intent should describe what you want to understand or accomplish.

    Depth levels:
    - L0: Quick lookup, cached results preferred
    - L1: Standard search with semantic matching (default)
    - L2: Deep search including graph analysis and community expansion
    - L3: Comprehensive search including patterns, decisions, and similar tasks

    Token budgeting:
    Agents have finite context windows. Use --token-budget to limit response size.
    When truncation is needed, packs are removed by relevance score (highest kept).
    The response includes metadata about truncation (tokensUsed, truncationStrategy).

    Deterministic mode:
    For testing and verification, --deterministic produces reproducible results by:
    - Skipping LLM synthesis (inherently non-deterministic)
    - Using stable sorting (by ID when relevance scores tie)
    - Using fixed timestamps and deterministic IDs
    - Setting latency to 0 for reproducibility
    The response includes a disclosure: "deterministic_mode: ..."

    Enumeration mode:
    For listing queries like "list all CLI commands" or "how many test files":
    - Auto-detected from query intent, or force with --enumerate
    - Returns COMPLETE lists, not top-k semantic matches
    - Supports 14+ entity categories: cli_command, test_file, interface, class, etc.
    - Groups results by directory for readability

    Exhaustive mode:
    For dependency queries like "what depends on X":
    - Auto-detected from query intent, or force with --exhaustive
    - Uses graph traversal instead of semantic search
    - Returns ALL dependents/dependencies, critical for refactoring
    - Use --transitive to include indirect dependencies

EXAMPLES:
    librainian query "How does authentication work?"
    librainian query "Find error handling patterns" --depth L2
    librainian query "Show prior related tasks" --depth L3
    librainian query "What tests cover login?" --files src/auth/login.ts
    librainian query "Assess impact" --uc UC-041,UC-042 --uc-priority high
    librainian query "API endpoint structure" --json
    librainian query "API endpoint structure" --json --out /tmp/librainian-query.json
    librainian query "Quick overview" --token-budget 2000 --token-reserve 500
    librainian query "Test reproducibility" --deterministic --json
    librainian query "list all CLI commands" --enumerate
    librainian query "how many test files" --enumerate --json
    librainian query "what depends on SqliteStorage" --exhaustive --transitive
    librainian query "How does auth work?" --session new --json
    librainian query "What about token refresh?" --session sess_abc123 --json
    librainian query --session sess_abc123 --drill-down src/auth/session.ts --json
`,

  'repo-map': `
librainian repo-map - Generate a compact repo map ranked by symbol centrality

USAGE:
    librainian repo-map [options]

OPTIONS:
    --style <value>      Output style: compact | detailed | json (default: compact)
    --focus <list>       Comma-separated file/path focus hints (boosts matching entries)
    --max-tokens <n>     Token budget cap for included entries (default: 4096)
    --json               Emit machine-readable JSON output (same as --style json)

DESCRIPTION:
    Generates a fast structural overview of the indexed codebase suitable for:
    - Session-start orientation
    - Prompt context injection with bounded token cost
    - Quickly identifying high-centrality files and exported signatures

    Results are ranked by function-level centrality metrics when available
    (falling back to symbol density), then truncated to the requested token budget.

EXAMPLES:
    librainian repo-map
    librainian repo-map --max-tokens 4096
    librainian repo-map --focus src/auth,src/api
    librainian repo-map --style detailed
    librainian repo-map --json
`,

  feedback: `
librainian feedback - Submit outcome feedback for a prior query

USAGE:
    librainian feedback <feedbackToken> --outcome <success|failure|partial> [options]

OPTIONS:
    --outcome <value>        Task outcome: success | failure | partial
    --agent-id <id>          Agent identifier (e.g., codex-cli)
    --missing-context <txt>  Missing context description
    --ratings <json>         JSON array with per-pack ratings
    --ratings-file <path>    Path to JSON file with per-pack ratings
    --json                   Emit machine-readable JSON output

DESCRIPTION:
    Records feedback against a prior query result so LiBrainian can update
    context-pack confidence and track retrieval gaps.

    Notes:
    - feedbackToken comes from librainian query output (feedbackToken field)
    - Use --ratings/--ratings-file for explicit per-pack relevance control
    - Without custom ratings, outcome-level feedback applies to all packs

EXAMPLES:
    librainian feedback fbk_123 --outcome success
    librainian feedback fbk_123 --outcome failure --missing-context "Need auth token lifecycle docs"
    librainian feedback fbk_123 --outcome partial --ratings-file state/ratings.json --json
`,

  bootstrap: `
librainian bootstrap - Initialize or refresh the knowledge index

USAGE:
    librainian bootstrap [options]

OPTIONS:
    --force             Force full reindex even if data exists
    --force-resume      Resume bootstrap even if workspace fingerprint changed
    --scope <name>      Bootstrap scope: full | librainian (default: full)
    --mode <name>       Bootstrap mode: fast | full (default: full)
    --workspace-set <path>  Bootstrap all packages from a workspace-set config JSON
    --emit-baseline     Write OnboardingBaseline.v1 after successful bootstrap
    --update-agent-docs Opt in to updating AGENTS.md / CLAUDE.md / CODEX.md
    --no-claude-md      Skip CLAUDE.md injection even when updating agent docs
    --install-grammars  Install missing tree-sitter grammar packages
    --llm-provider <p>  Force LLM provider: claude | codex (default: auto)
    --llm-model <id>    Force LLM model id (default: daily selection)

DESCRIPTION:
    Initializes the librainian knowledge index by:
    1. Scanning the workspace directory structure
    2. Indexing all code files (functions, modules, exports)
    3. Generating embeddings for semantic search
    4. Building relationship graphs (imports, calls)
    5. Creating pre-computed context packs

    This command MUST complete before any agent work can proceed.
    It automatically detects and upgrades older librainian data.

PROGRESS INDICATORS:
    The bootstrap process shows real-time progress with:
    - Current phase name and description
    - Progress percentage
    - Estimated time remaining
    - Files processed count

EXAMPLES:
    librainian bootstrap
    librainian bootstrap --force
    librainian bootstrap --force-resume
    librainian bootstrap --scope librainian
    librainian bootstrap --scope librainian --llm-provider codex --llm-model gpt-4o-mini
    librainian bootstrap --emit-baseline
`,

  embed: `
librainian embed - Repair and backfill semantic embeddings

USAGE:
    librainian embed --fix [--json]

OPTIONS:
    --fix               Run embedding backfill remediation (required)
    --json              Emit machine-readable JSON output

DESCRIPTION:
    Forces a fast bootstrap pass with embeddings enabled to recover semantic
    retrieval coverage. This command fails closed if the embedding provider is
    unavailable.

EXAMPLES:
    librainian embed --fix
    librainian embed --fix --json
`,

  uninstall: `
librainian uninstall - Remove LiBrainian bootstrap artifacts

USAGE:
    librainian uninstall [options]

OPTIONS:
    --dry-run           Preview changes without modifying files
    --keep-index        Keep .librainian index data while removing docs/config artifacts
    --force             Skip confirmation prompt
    --json              Output machine-readable JSON summary
    --no-install        Skip npm install after package.json dependency removal

DESCRIPTION:
    Removes LiBrainian-managed workspace artifacts in one flow:
    - Strips injected <!-- LIBRARIAN_DOCS_START --> blocks from known agent docs
    - Removes librainian/librainian dependencies from package.json when present
    - Deletes generated directories (.librainian, state) unless --keep-index
    - Deletes .librainian-manifest.json uninstall record

    If .librainian-manifest.json exists, uninstall uses it as source-of-truth.
    If missing, uninstall falls back to a deterministic scan of known artifacts.

EXAMPLES:
    librainian uninstall --dry-run
    librainian uninstall --force
    librainian uninstall --force --keep-index
    librainian uninstall --json --force
`,

  'audit-skill': `
librainian audit-skill - Audit a SKILL.md file for malicious patterns

USAGE:
    librainian audit-skill <path-to-SKILL.md> [options]

OPTIONS:
    --json              Emit machine-readable JSON report

DESCRIPTION:
    Runs SkillAuditConstruction on a SKILL.md file and reports:
    - risk score (0-100)
    - verdict (safe | suspicious | malicious)
    - detected malicious/suspicious patterns
    - recommendation for install safety

EXAMPLES:
    librainian audit-skill ./skills/openclaw/SKILL.md
    librainian audit-skill ./SKILL.md --json
`,

  'install-openclaw-skill': `
librainian install-openclaw-skill - Install the official OpenClaw LiBrainian skill

USAGE:
    librainian install-openclaw-skill [options]

OPTIONS:
    --openclaw-root <path>  Override OpenClaw root directory (default: ~/.openclaw)
    --dry-run               Preview install and config wiring without writing files
    --json                  Emit machine-readable JSON report

DESCRIPTION:
    Installs the official LiBrainian OpenClaw skill and applies deterministic
    local configuration updates:
    - Writes SKILL.md to ~/.openclaw/skills/librainian/SKILL.md
    - Updates ~/.openclaw/openclaw.json under skills.entries.librainian
    - Verifies required MCP tools are present in LiBrainian's schema registry
    - Prints a test invocation for immediate validation

EXAMPLES:
    librainian install-openclaw-skill
    librainian install-openclaw-skill --dry-run
    librainian install-openclaw-skill --openclaw-root /tmp/.openclaw --json
`,

  'openclaw-daemon': `
librainian openclaw-daemon - Manage OpenClaw daemon registration and local state

USAGE:
    librainian openclaw-daemon <start|status|stop> [options]

OPTIONS:
    --openclaw-root <path>  Override OpenClaw root directory (default: ~/.openclaw)
    --state-root <path>     Override daemon state directory (default: ~/.librainian/openclaw-daemon)
    --json                  Emit machine-readable JSON report

DESCRIPTION:
    Provides a deterministic control surface for OpenClaw integration:
    - start: registers librainian in ~/.openclaw/config.yaml backgroundServices
             and marks daemon state as running
    - status: reports daemon running state + registration metadata
    - stop: marks daemon state as stopped without deleting registration

EXAMPLES:
    librainian openclaw-daemon start
    librainian openclaw-daemon status --json
    librainian openclaw-daemon stop --state-root /tmp/librainian-state
`,

  'memory-bridge': `
librainian memory-bridge - Inspect memory bridge state and manage session core memory

USAGE:
    librainian memory-bridge status [options]
    librainian memory-bridge remember <key> <value> [--json]
    librainian memory-bridge add <content> [--scope codebase|module|function] [--scope-key <id>] [--json]
    librainian memory-bridge search <query> [--limit <n>] [--json]
    librainian memory-bridge update <id> <content> [--json]
    librainian memory-bridge delete <id> [--json]

OPTIONS:
    --memory-file <path>    Override MEMORY.md location (default: <workspace>/.openclaw/memory/MEMORY.md)
    --json                  Emit machine-readable JSON report

DESCRIPTION:
    status:
    Reads the memory-bridge state file adjacent to MEMORY.md and reports:
    - total harvested entries
    - active (non-defeated, non-expired) entries
    - defeated entries
    - state freshness metadata

    remember:
    Stores a key/value fact in .librainian/session.json core memory so future
    queries can receive session-core-memory disclosure context.

    add/search/update/delete:
    Manages persistent semantic memory facts in .librainian/memory.db.
    Add operations are dedupe-aware: similar facts update existing records
    instead of creating duplicates.

EXAMPLES:
    librainian memory-bridge status
    librainian memory-bridge status --memory-file /tmp/.openclaw/memory/MEMORY.md --json
    librainian memory-bridge remember auth_model "JWT expires in 1 hour"
    librainian memory-bridge add "validateToken has race condition under refresh" --scope function --scope-key validateToken
    librainian memory-bridge search "token validation race"
`,

  'test-integration': `
librainian test-integration - Run quantitative integration benchmark suites

USAGE:
    librainian test-integration --suite openclaw [options]

OPTIONS:
    --suite <name>          Integration suite name (currently: openclaw)
    --scenario <name>       Scenario selector: all|cold-start|staleness|navigation|budget-gate|skill-audit|calibration
    --fixtures-root <path>  Override fixture root (default: test/fixtures/openclaw)
    --strict                Exit non-zero when any scenario fails thresholds
    --json                  Emit machine-readable JSON report
    --out <path>            Write report JSON to file

DESCRIPTION:
    Runs six quantitative OpenClaw integration scenarios:
    1. cold-start context efficiency
    2. memory staleness detection
    3. semantic navigation accuracy
    4. context exhaustion prevention
    5. malicious skill detection
    6. calibration convergence

EXAMPLES:
    librainian test-integration --suite openclaw
    librainian test-integration --suite openclaw --scenario skill-audit --json
    librainian test-integration --suite openclaw --strict --out state/eval/openclaw/benchmark.json
`,

  'benchmark': `
librainian benchmark - Run local performance SLA diagnostics

USAGE:
    librainian benchmark [options]

OPTIONS:
    --queries <n>            Number of query samples to run (default: 8)
    --incremental-files <n>  Number of files for incremental reindex benchmark (default: 10)
    --no-bootstrap           Fail if index is missing instead of running fast local bootstrap
    --fail-on <mode>         Failure threshold: never | alert | block (default: never)
    --json                   Emit machine-readable JSON report
    --out <path>             Write JSON report to path (requires --json)

DESCRIPTION:
    Runs SLA-oriented performance checks for:
    - Query latency (cold-start, p50, p95, p99)
    - Full index duration target by codebase size bucket
    - Incremental reindex duration for sampled files
    - Runtime and indexing RSS memory budgets

    Alert policy:
    - >20% over target => alert
    - >100% over target (>2x) => block

EXAMPLES:
    librainian benchmark
    librainian benchmark --queries 12 --incremental-files 10
    librainian benchmark --json --out state/eval/performance/PerformanceSLAReport.v1.json --fail-on block
`,

  'privacy-report': `
librainian privacy-report - Summarize strict privacy-mode audit evidence

USAGE:
    librainian privacy-report [options]

OPTIONS:
    --since <ISO-8601>     Only include events at/after this timestamp
    --format <fmt>         Output format: text|json (default: text)
    --json                 Shortcut for --format json
    --out <path>           Write JSON report to file (requires --json)

DESCRIPTION:
    Reads .librainian/audit/privacy.log and produces a compliance summary:
    - total privacy-audit events
    - blocked operations in strict mode
    - local-only operations
    - external content transmissions (must be zero for strict compliance)

EXAMPLES:
    librainian privacy-report
    librainian privacy-report --since 2026-02-01T00:00:00Z
    librainian privacy-report --json --out state/audits/privacy-report.json
`,

  'export': `
librainian export - Export a portable .librainian index bundle

USAGE:
    librainian export [options]

OPTIONS:
    --output <path>      Output bundle path (default: .librainian/exports/librainian-index.tar.gz)
    --json               Emit machine-readable JSON output
    --out <path>         Write JSON output to file

DESCRIPTION:
    Creates a transportable archive of current index artifacts for team sharing
    and CI warm-starts. Export includes:
    - librainian.sqlite
    - knowledge.db (if present)
    - evidence_ledger.db (if present)
    - hnsw.bin (if present)
    - manifest.json with schema/version/git SHA metadata

    Absolute workspace paths in SQLite text columns are rewritten to a
    placeholder token, so bundles can be imported on different machines.

EXAMPLES:
    librainian export
    librainian export --output state/exports/librainian-index.tar.gz
    librainian export --json --out state/exports/index-export.json
`,

  'import': `
librainian import - Import a portable .librainian index bundle

USAGE:
    librainian import --input <bundle.tar.gz> [options]

OPTIONS:
    --input <path>       Path to exported bundle tarball
    --json               Emit machine-readable JSON output
    --out <path>         Write JSON output to file

DESCRIPTION:
    Imports an exported index bundle into the current workspace .librainian
    directory, validates manifest compatibility/checksums, and rewrites the
    workspace placeholder token back to this machine's absolute workspace root.
    If git HEAD differs from the bundle SHA, import warns and suggests running:
      librainian update --since <bundleSha>

EXAMPLES:
    librainian import --input state/exports/librainian-index.tar.gz
    librainian import --input ./librainian-index.tar.gz --json
`,

  'features': `
librainian features - Show dynamic feature registry with status and config hints

USAGE:
    librainian features [options]

OPTIONS:
    --json               Emit machine-readable feature registry
    --verbose            Include docs links and configuration hints in text output
    --out <path>         Write JSON output to file (requires --json)

DESCRIPTION:
    Lists core and experimental LiBrainian capabilities, their runtime status
    (active/limited/inactive/not_implemented), and where to configure or learn
    more. This command is designed to run quickly without deep index scans.

EXAMPLES:
    librainian features
    librainian features --verbose
    librainian features --json --out state/features.json
`,

  'capabilities': `
librainian capabilities - Emit machine-readable capability inventory

USAGE:
    librainian capabilities [options]

OPTIONS:
    --json               Emit machine-readable inventory (default)
    --out <path>         Write JSON output to a file

DESCRIPTION:
    Returns a versioned capability inventory for agent startup/discovery that includes:
    - MCP tools (name, description, input schema, example usage)
    - Registered constructions (name/id, description, input schema, example usage)
    - Available technique compositions (name/id, description, input schema, example usage)

    The output includes inventoryVersion so agents can detect capability set changes.

EXAMPLES:
    librainian capabilities
    librainian capabilities --json
    librainian capabilities --out state/capabilities.json
`,

  mcp: `
librainian mcp - Start MCP stdio server and print client setup snippets

USAGE:
    librainian mcp [options]

OPTIONS:
    --print-config        Print config snippets and exit (do not start server)
    --client <name>       Target a single client: claude|cursor|vscode|windsurf|gemini
    --launcher <mode>     Command style: installed|npx (default: installed)
    --json                Emit JSON when used with --print-config
    --stdio               Accepted for compatibility; stdio is always used

DESCRIPTION:
    Runs the LiBrainian MCP server over stdio for MCP-compatible clients.
    Use --print-config to generate copy-ready JSON snippets for client setup.

EXAMPLES:
    librainian mcp
    librainian mcp --print-config
    librainian mcp --print-config --client claude
    librainian mcp --print-config --launcher npx --json
`,

  'eject-docs': `
librainian eject-docs - Remove injected librainian docs from CLAUDE.md files

USAGE:
    librainian eject-docs [options]

OPTIONS:
    --dry-run           Report files that would be changed without writing
    --json              Output results as JSON

DESCRIPTION:
    Removes all sections between:
    - <!-- LIBRARIAN_DOCS_START -->
    - <!-- LIBRARIAN_DOCS_END -->

    from CLAUDE.md files while preserving user-authored content.
    Safe to run multiple times.

EXAMPLES:
    librainian eject-docs
    librainian eject-docs --dry-run
    librainian eject-docs --json
`,

  'generate-docs': `
librainian generate-docs - Generate prompt-injection docs (TOOLS/CONTEXT/RULES)

USAGE:
    librainian generate-docs [options]

OPTIONS:
    --output-dir <path>      Output directory (default: workspace root)
    --include <list>         Comma-separated docs: tools,context,rules
    --no-tools               Exclude LIBRAINIAN_TOOLS.md
    --no-context             Exclude LIBRAINIAN_CONTEXT.md
    --no-rules               Exclude LIBRAINIAN_RULES.md
    --max-tokens <n>         Per-file token budget cap (default: 1800, max: 2000)
    --combined               Also write LIBRAINIAN_PROMPT_DOCS.md
    --json                   Output generation summary as JSON

DESCRIPTION:
    Generates separated markdown docs intended for agent prompt injection:
    - LIBRAINIAN_TOOLS.md: MCP tool catalog with compact invocation examples
    - LIBRAINIAN_CONTEXT.md: workspace language/module/entrypoint/index summary
    - LIBRAINIAN_RULES.md: retrieval, confidence, and evidence handling rules

    Docs can be toggled per-workspace through config keys:
    - promptDocs.tools / promptDocs.context / promptDocs.rules
    - prompt_docs.tools / prompt_docs.context / prompt_docs.rules

EXAMPLES:
    librainian generate-docs
    librainian generate-docs --output-dir docs/generated --combined
    librainian generate-docs --include tools,context --json
`,

  quickstart: `
librainian quickstart - Smooth onboarding and recovery flow

USAGE:
    librainian quickstart [options]

OPTIONS:
    --mode <name>       Bootstrap mode: fast | full (default: fast)
    --depth <name>      Setup depth alias: quick | full (quick maps to fast)
    --risk-tolerance <t>  Config heal risk: safe | low | medium (default: low)
    --force             Force bootstrap even if not required
    --skip-baseline     Skip writing OnboardingBaseline.v1
    --update-agent-docs Opt in to updating AGENTS.md / CLAUDE.md / CODEX.md
    --ci                CI-friendly mode (non-interactive, skips MCP registration)
    --no-mcp            Skip MCP registration/setup steps
    --json              Output results as JSON

DESCRIPTION:
    Runs a full onboarding recovery flow to get LiBrainian operational:
    - Auto-detects workspace root
    - Heals configuration issues
    - Recovers storage (stale locks/WAL)
    - Bootstraps if required (fast by default)
    - Emits a baseline audit (unless skipped)

    If embeddings or LLMs are unavailable, quickstart proceeds in degraded mode.

EXAMPLES:
    librainian quickstart
    librainian setup --depth quick --ci --no-mcp
    librainian init --depth full
    librainian quickstart --mode full
    librainian quickstart --force --skip-baseline
    librainian quickstart --update-agent-docs
    librainian quickstart --json
`,

  setup: `
librainian setup - Alias for quickstart onboarding

USAGE:
    librainian setup [options]

DESCRIPTION:
    Runs the same onboarding flow as:
    librainian quickstart [options]

    Common setup invocation:
    librainian setup --depth quick --ci --no-mcp

See:
    librainian help quickstart
`,
  init: `
librainian init - Scaffold constructions/MCP/CLAUDE.md with quickstart fallback

USAGE:
    librainian init [--construction <name>] [--mcp-config] [--claude-md] [--force] [--json]
    librainian init [--editor vscode|cursor|continue|claude|jetbrains|windsurf|all] [--dry-run] [--global] [quickstart options]
    librainian init [quickstart options]

OPTIONS:
    --construction <name>  Create .librainian construction + test + docs scaffolding
    --mcp-config           Create or merge .mcp.json with librainian MCP server entry
    --claude-md            Create/update LIBRARIAN_DOCS section in CLAUDE.md
    --force                Overwrite conflicting scaffold files/entries when safe
    --json                 Emit machine-readable action report for scaffolding mode

DESCRIPTION:
    When one or more scaffolding flags are present, init creates opinionated
    templates for extending LiBrainian:
    - Construction source/test/docs skeleton
    - MCP config entry for \`librainian mcp\`
    - CLAUDE.md operating notes injection block

    Without scaffolding flags, init falls back to:
    librainian quickstart [options]

EXAMPLES:
    librainian init --construction SafeRefactorAdvisor
    librainian init --mcp-config --claude-md
    librainian init --construction SafeRefactorAdvisor --mcp-config --json
    librainian init --depth quick --ci --no-mcp

See:
    librainian help quickstart
`,
  smoke: `
librainian smoke - Run external repo smoke harness

USAGE:
    librainian smoke [options]

OPTIONS:
    --repos-root <path>  Root folder with external repos (default: eval-corpus/external-repos)
    --max-repos <n>      Limit number of repos to test
    --repo <a,b,c>       Restrict to specific repos by manifest name
    --timeout-ms <n>     Fail closed if smoke run exceeds timeout
    --artifacts-dir <path>  Write per-run artifacts and latest pointer
    --json               Output results as JSON

DESCRIPTION:
    Runs a lightweight, agent-style smoke test across real external repos.
    Uses a short query set to verify that overview and file-scoped context work.

EXAMPLES:
    librainian smoke
    librainian smoke --max-repos 3
    librainian smoke --timeout-ms 120000 --artifacts-dir state/eval/smoke
    librainian smoke --repos-root ./eval-corpus/external-repos --json
`,

  journey: `
librainian journey - Run agentic journey simulations

USAGE:
    librainian journey [options]

OPTIONS:
    --repos-root <path>  Root folder with external repos (default: eval-corpus/external-repos)
    --max-repos <n>      Limit number of repos to test
    --llm <mode>         LLM mode: disabled | optional (default: disabled)
    --deterministic      Enable deterministic query mode
    --strict-objective   Require retrieved context for pass
    --timeout-ms <n>     Fail closed if journey run exceeds timeout
    --artifacts-dir <path>  Write per-run artifacts and latest pointer
    --json               Output results as JSON

DESCRIPTION:
    Runs a multi-step agent workflow across real repos:
    - Project overview and module discovery queries
    - Onboarding path query
    - File-scoped context query
    - Glance card + recommendations (when available)
    - Constraint validation on a representative file

EXAMPLES:
    librainian journey
    librainian journey --max-repos 3 --deterministic
    librainian journey --strict-objective --timeout-ms 120000
    librainian journey --llm optional --json
`,

  'live-fire': `
librainian live-fire - Run continuous objective trial matrix

USAGE:
    librainian live-fire [options]

OPTIONS:
    --repos-root <path>            Root folder with external repos (default: eval-corpus/external-repos)
    --profile <name>               Run one named profile (baseline, hardcore, soak, etc.)
    --profiles <a,b,c>             Run selected profiles as a matrix
    --profiles-file <path>         Load additional/override profiles from JSON
    --matrix                        Run all available profiles (or --profiles selection)
    --list-profiles                Print profiles and exit
    --rounds <n>                   Number of repeated trial rounds (default: 3)
    --max-repos <n>                Limit number of repos to test
    --repo <a,b,c>                 Restrict to specific repo names
    --llm-modes <modes>            Comma-separated: disabled,optional (default: disabled)
    --deterministic                Enable deterministic query mode
    --strict-objective             Require retrieved context for pass
    --include-smoke                Include smoke checks in each run
    --min-journey-pass-rate <r>    Pass threshold in [0,1]
    --min-retrieved-context-rate <r>  Retrieved context threshold in [0,1]
    --max-blocking-validation-rate <r> Blocking validation ceiling in [0,1]
    --journey-timeout-ms <n>       Timeout for each journey run (default from profile/runner)
    --smoke-timeout-ms <n>         Timeout for each smoke run (default from profile/runner)
    --output <path>                Write JSON report to file
    --json                         Output report as JSON

DESCRIPTION:
    Executes objective journey trials on real external repos with hard gates for:
    - Journey pass rate
    - Retrieved-context rate
    - Blocking validation rate
    - Optional smoke failures

    Profile mode provides reproducible "hardcore" presets for CLI end-to-end
    trial-by-fire testing. Matrix mode runs multiple profiles and emits a
    LiveFireMatrixReport.v1 plus per-profile artifacts.

EXAMPLES:
    librainian live-fire --list-profiles
    librainian live-fire --profile baseline --profiles-file config/live_fire_profiles.json
    librainian live-fire --matrix --profiles baseline,hardcore --profiles-file config/live_fire_profiles.json
    librainian live-fire --strict-objective --include-smoke
    librainian live-fire --rounds 2 --llm-modes disabled,optional --json
`,

  inspect: `
librainian inspect - Inspect a module or function's knowledge

USAGE:
    librainian inspect <path-or-name> [options]

OPTIONS:
    --type <type>       Entity type: function, module, or auto (default)
    --json              Output results as JSON

DESCRIPTION:
    Shows detailed knowledge about a specific module or function, including:
    - Purpose and summary
    - Exports and dependencies
    - Related files
    - Confidence score
    - Access statistics
    - Related context packs

EXAMPLES:
    librainian inspect src/auth/login.ts
    librainian inspect loginUser --type function
    librainian inspect src/api/handlers/ --json
`,

  compose: `
librainian compose - Compose construction pipelines or technique bundles

USAGE:
    librainian compose "<intent>" [options]

OPTIONS:
    --mode <m>         Compose mode: constructions|techniques (default: constructions)
    --limit <n>         Limit number of bundles returned
    --include-primitives  Include primitive definitions in output
    --pretty            Pretty-print JSON output
    --timeout <ms>      Timeout in milliseconds (default: 300000)
    --verbose           Emit stage-level compose progress logs

DESCRIPTION:
    constructions mode:
    - Runs composable construction bricks with shared context and prior findings
    - Produces normalized findings/recommendations across knowledge, refactoring, and security
    - Reuses context through a single pipeline pass for agent workflows

    techniques mode:
    - Compiles technique composition bundles from intent using the plan compiler
    - Outputs template + primitive bundles for downstream automation

EXAMPLES:
    librainian compose "Investigate payment auth regression"
    librainian compose "Prepare a release plan" --mode techniques
    librainian compose "Performance regression triage" --mode techniques --limit 2
    librainian compose "Release readiness" --mode techniques --include-primitives --pretty
    librainian compose "Release readiness" --timeout 120000 --verbose
`,

  constructions: `
librainian constructions - Browse, search, describe, install, run, and validate constructions

USAGE:
    librainian constructions <subcommand> [options]

SUBCOMMANDS:
    list                    List available constructions (grouped by trust tier)
    search "<query>"        Rank constructions by semantic relevance
    describe <id>           Show full manifest details and example usage
    install <id>            Install/activate construction (built-in or npm)
    run <id>                Execute a construction directly
    validate [manifest]     Validate a local construction manifest JSON

OPTIONS:
    --json                  Output machine-readable JSON
    --limit <n>             Maximum results (list/search)
    --offset <n>            Pagination offset (list)
    --tags <a,b,c>          Filter list by tags
    --capabilities <a,b>    Filter list by required capabilities
    --trust-tier <tier>     official | partner | community
    --language <lang>       Filter list by language
    --available-only        List only constructions executable in current runtime
    --all                   Include discovery-only constructions in list output
    --dry-run               For install: validate only, skip npm install
    --input <json|string>   For run: input payload (JSON preferred)
    --path <file>           For validate: explicit manifest path

DESCRIPTION:
    This command group surfaces the construction registry directly in the CLI.
    It supports discovery and validation workflows without requiring MCP setup.

EXAMPLES:
    librainian constructions list
    librainian constructions list --all
    librainian constructions list --trust-tier official --limit 20
    librainian constructions search "blast radius change impact"
    librainian constructions describe librainian:security-audit-helper
    librainian constructions install librainian:security-audit-helper --dry-run
    librainian constructions run librainian:security-audit-helper --input '{"files":["src/auth.ts"],"checkTypes":["auth"]}'
    librainian constructions validate ./construction.manifest.json --json
`,

  confidence: `
librainian confidence - Show confidence scores for an entity

USAGE:
    librainian confidence <entity-id> [options]

OPTIONS:
    --history           Show confidence history over time
    --json              Output results as JSON

DESCRIPTION:
    Displays confidence scoring information for a knowledge entity, including:
    - Current confidence score (0.0 - 1.0)
    - Calibration status
    - Uncertainty metrics
    - Outcome history (successes/failures)
    - Access count

    Confidence scores indicate how reliable the knowledge is:
    - 0.9+: High confidence, validated by outcomes
    - 0.7-0.9: Good confidence, some validation
    - 0.5-0.7: Moderate confidence, needs more validation
    - <0.5: Low confidence, treat with caution

EXAMPLES:
    librainian confidence function:loginUser:src/auth/login.ts
    librainian confidence module:src/api/handlers.ts --history
`,

  validate: `
librainian validate - Validate constraints for a file

USAGE:
    librainian validate <file-path> [options]

OPTIONS:
    --before <content>  Previous file content (for change validation)
    --after <content>   New file content (for change validation)
    --json              Output results as JSON

DESCRIPTION:
    Validates a file against architectural constraints, including:
    - Explicit constraints from .librainian/constraints.yaml
    - Inferred layer boundary constraints
    - Pattern-based constraints (no console.log, no test imports)

    Returns:
    - Blocking violations (errors)
    - Non-blocking warnings
    - Suggestions for resolution

EXAMPLES:
    librainian validate src/api/handler.ts
    librainian coverage
    librainian coverage --output state/audits/librainian/coverage/custom.json --strict
    librainian validate src/auth/login.ts --json
`,

  coverage: `
librainian coverage - Generate UC x method x scenario coverage audit

USAGE:
    librainian coverage [options]

OPTIONS:
    --output <path>     Output path for coverage matrix JSON
    --strict            Fail if any UC/method/scenario entry is missing PASS

DESCRIPTION:
    Generates the UC × method × scenario matrix required by validation.
    The report is written to state/audits/librainian/coverage/.

EXAMPLES:
    librainian coverage
    librainian coverage --output state/audits/librainian/coverage/custom.json --strict
`,

  'check-providers': `
librainian check-providers - Check provider availability and authentication

USAGE:
    librainian check-providers [options]

OPTIONS:
    --json              Output results as JSON
    --format text|json  Output format (default: text)
    --out <path>        Write JSON output to file (requires --json/--format json)

DESCRIPTION:
    Checks the availability and authentication status of:
    - LLM providers (Claude, Codex)
    - Embedding providers

    Shows:
    - Provider status (available/unavailable)
    - Model ID being used
    - Authentication status
    - Latency measurements
    - Remediation steps if unavailable

EXAMPLES:
    librainian check-providers
    librainian check-providers --json
    librainian check-providers --json --out /tmp/librainian-providers.json
`,

  watch: `
librainian watch - Watch for file changes and auto-reindex

USAGE:
    librainian watch [options]

OPTIONS:
    --debounce <ms>     Debounce interval in milliseconds (default: 200)
    --quiet             Suppress output except errors

DESCRIPTION:
    Starts a file watcher that automatically reindexes changed files,
    keeping the librainian knowledge base up-to-date as you code.

    The watcher will:
    - Detect file changes in real-time
    - Debounce rapid changes (configurable)
    - Automatically reindex changed .ts, .js, .py, .go, .rs files
    - Update embeddings, context packs, and relationships
    - Log all indexing activity

    Press Ctrl+C to stop the watcher.

EXAMPLES:
    librainian watch
    librainian watch --debounce 500
    librainian watch --quiet
`,

  health: `
librainian health - Show current LiBrainian health status

USAGE:
    librainian health [options]

OPTIONS:
    --verbose           Show detailed health metrics
    --format <fmt>      Output format: text | json | prometheus (default: text)

DESCRIPTION:
    Shows the current health status of the LiBrainian system, including:
    - Overall health score
    - Individual health dimensions
    - Active issues and warnings
    - Recommended actions

EXAMPLES:
    librainian health
    librainian health --verbose
    librainian health --format json
`,

  check: `
librainian check - Run diff-aware CI integrity checks

USAGE:
    librainian check [options]

OPTIONS:
    --diff <spec>       Diff selector: HEAD~1..HEAD | <base-ref> | working-tree (default: working-tree)
    --format <fmt>      Output format: text | json | junit (default: text)
    --json              Alias for --format json
    --out <path>        Write output payload to file

DESCRIPTION:
    Evaluates changed files for agentic knowledge integrity before merge:
    - stale context packs for changed files
    - broken import edges after deletes/renames
    - orphaned claim evidence tied to changed files
    - context-pack coverage regression on changed files
    - call-graph impact outside the current diff

    Exit codes are CI-friendly:
    - 0: pass/warn
    - 1: fail
    - 2: unchecked (bootstrap/index missing)

EXAMPLES:
    librainian check
    librainian check --diff HEAD~1..HEAD --format text
    librainian check --diff origin/main --json
    librainian check --diff HEAD~1..HEAD --format junit --out reports/librainian-check.xml
`,

  heal: `
librainian heal - Run homeostatic healing loop until healthy

USAGE:
    librainian heal [options]

OPTIONS:
    --max-cycles <N>    Maximum healing cycles (default: 10)
    --budget-tokens <N> Token budget per cycle
    --dry-run           Show what would be healed without making changes

DESCRIPTION:
    Runs automated healing to restore LiBrainian health, including:
    - Fixing stale or invalid data
    - Rebuilding broken relationships
    - Refreshing embeddings
    - Resolving detected issues

EXAMPLES:
    librainian heal
    librainian heal --max-cycles 5
    librainian heal --dry-run
`,

  evolve: `
librainian evolve - Run evolutionary improvement loop

USAGE:
    librainian evolve [options]

OPTIONS:
    --cycles <N>        Number of evolution cycles (default: 1)
    --candidates <N>    Number of candidates per cycle (default: 3)
    --dry-run           Show what would evolve without making changes
    --format <fmt>      Output format: text | json (default: text)

DESCRIPTION:
    Runs evolutionary improvement to enhance LiBrainian quality, including:
    - Generating improvement candidates
    - Evaluating candidates against fitness criteria
    - Selecting and applying best improvements
    - Recording outcomes for learning

EXAMPLES:
    librainian evolve
    librainian evolve --cycles 3 --candidates 5
    librainian evolve --dry-run
`,

  eval: `
librainian eval - Produce FitnessReport.v1 for current state

USAGE:
    librainian eval [options]

OPTIONS:
    --output <path>     Output path for the report
    --save-baseline     Save as baseline for future comparisons
    --stages <range>    Evaluation stages to run: 0-4 (default: 0-4)
    --format <fmt>      Output format: text | json (default: text)

DESCRIPTION:
    Evaluates the current LiBrainian state and produces a fitness report:
    - Stage 0: Basic structural checks
    - Stage 1: Semantic quality metrics
    - Stage 2: Relationship integrity
    - Stage 3: Coverage analysis
    - Stage 4: Performance benchmarks

EXAMPLES:
    librainian eval
    librainian eval --save-baseline
    librainian eval --stages 0-2 --format json
`,

  replay: `
librainian replay - Replay an evolution cycle or variant for analysis

USAGE:
    librainian replay <cycle-id|variant-id> [options]

OPTIONS:
    --verbose           Show detailed replay information
    --format <fmt>      Output format: text | json (default: text)

DESCRIPTION:
    Replays a previous evolution cycle or variant for analysis:
    - Shows what changes were made
    - Displays fitness scores before/after
    - Explains selection decisions
    - Useful for debugging evolution issues

EXAMPLES:
    librainian replay cycle-2025-01-18-001
    librainian replay variant-abc123 --verbose
`,

  index: `
librainian index - Incrementally index specific files

USAGE:
    librainian index --force <file...> [options]
    librainian index --force --incremental [options]
    librainian index --force --staged [options]
    librainian index --force --since <ref> [options]

OPTIONS:
    --force             REQUIRED. Acknowledge risk of context pack loss on failure
    --incremental       Index changed files from git status (modified + added + untracked)
    --staged            Index only staged files from git diff --cached
    --since <ref>       Index files changed since a git ref (for CI branch comparison)
    --verbose           Show detailed indexing output

DESCRIPTION:
    Indexes specific files without requiring a full bootstrap.
    Use this when:
    - You've added new files that haven't been indexed yet
    - You want to update the index for specific files
    - AutoWatch isn't running and you want targeted updates

    The index command calls reindexFiles() internally, which:
    - Updates or creates knowledge entries for the specified files
    - Generates embeddings for semantic search
    - Updates relationship graphs
    - Invalidates and rebuilds affected context packs

    Unlike bootstrap, this command:
    - Only processes the specified files
    - Does NOT overwrite the entire database
    - Is much faster for targeted updates
    - Treats empty git selectors as a no-op success (CI-friendly)

    CAUTION: Context packs are invalidated BEFORE reindexing. If indexing
    fails mid-operation, context packs for target files will be PERMANENTLY
    LOST. Recovery requires running 'librainian bootstrap' to regenerate.
    The --force flag is required to acknowledge this risk.

EXAMPLES:
    librainian index --force src/new_feature.ts
    librainian index --force src/auth/*.ts --verbose
    librainian index --force file1.ts file2.ts file3.ts
    librainian index --force --incremental
    librainian index --force --staged
    librainian index --force --since origin/main
`,

  update: `
librainian update - Hook-friendly alias for incremental indexing

USAGE:
    librainian update <file...> [options]
    librainian update --incremental [options]
    librainian update --staged [options]
    librainian update --since <ref> [options]

OPTIONS:
    --incremental       Index changed files from git status (modified + added + untracked)
    --staged            Index only staged files from git diff --cached
    --since <ref>       Index files changed since a git ref (for CI branch comparison)
    --verbose           Show detailed indexing output

DESCRIPTION:
    Equivalent to \`librainian index --force ...\` and intended for pre-commit
    tooling (lint-staged, lefthook, pre-commit). This command still performs
    context-pack invalidation/rebuild behavior from indexCommand. Empty
    selector results are treated as no-op success for CI stability.

EXAMPLES:
    librainian update --staged
    librainian update src/auth/session.ts src/api/mcp.ts
    librainian update --since origin/main
`,

  scan: `
librainian scan - Security redaction scan reporting

USAGE:
    librainian scan --secrets [options]

OPTIONS:
    --secrets           Report secret redaction totals from latest audit report
    --json              Emit machine-readable JSON output
    --format text|json  Output format (default: text)

DESCRIPTION:
    Reports redaction totals captured by LiBrainian's secret-redaction pipeline.
    This command reads the latest:
      state/audits/librainian/redaction/*/RedactionAuditReport.v1.json

    and prints total redactions plus per-type counts.

EXAMPLES:
    librainian scan --secrets
    librainian scan --secrets --json
`,

  analyze: `
librainian analyze - Run static analysis on the codebase

USAGE:
    librainian analyze --dead-code [options]
    librainian analyze --dead-weight [options]
    librainian analyze --complexity [options]

OPTIONS:
    --dead-code         Detect dead/unused code
    --dead-weight       Rank dead-weight file/script candidates
    --complexity        Report function complexity metrics
    --format <fmt>      Output format: text | json (default: text)
    --threshold <n>     Complexity threshold for flagging (default: 10)

DESCRIPTION:
    Runs static analysis on the codebase without requiring LLM or embeddings.

    Dead Code Analysis (--dead-code):
    - Detects unreachable code (after return/throw/break/continue)
    - Finds unused exports (exported but never imported)
    - Identifies unused variables and parameters
    - Locates unused private functions
    - Flags commented-out code blocks

    Dead-Weight Analysis (--dead-weight):
    - Aggregates dead-code candidates by file
    - Scores files using import-graph pressure and test proximity
    - Ranks likely cleanup targets with reasons and confidence

    Complexity Analysis (--complexity):
    - Reports cyclomatic complexity for all functions
    - Measures maximum nesting depth
    - Counts lines and parameters
    - Flags functions above threshold

    Both analyses output:
    - File paths (absolute or relative)
    - Line numbers
    - Confidence scores (for dead code)
    - Actionable recommendations

EXAMPLES:
    librainian analyze --dead-code
    librainian analyze --dead-weight
    librainian analyze --dead-weight --format json
    librainian analyze --dead-code --format json
    librainian analyze --complexity
    librainian analyze --complexity --threshold 15
    librainian analyze --complexity --format json
`,

  config: `
librainian config - Configuration management commands

USAGE:
    librainian config heal [options]

SUBCOMMANDS:
    heal                Auto-detect and fix suboptimal configuration settings

OPTIONS (for 'heal'):
    --dry-run           Show what would be healed without making changes
    --diagnose-only     Only diagnose issues, don't apply fixes
    --rollback          Rollback to previous configuration state
    --history           Show configuration effectiveness history
    --risk-tolerance <level>  Risk tolerance: safe | low | medium (default: low)
    --format <fmt>      Output format: text | json (default: text)
    --verbose           Show detailed output

DESCRIPTION:
    The config heal command automatically detects and fixes suboptimal
    configuration settings. It includes:

    DRIFT DETECTION:
    - Detects when codebase has changed enough that config is stale
    - Identifies structural changes (new directories, files)
    - Recommends include/exclude pattern updates

    STALENESS CHECKS:
    - Tracks when knowledge becomes outdated
    - Monitors component update timestamps
    - Flags stale embeddings, indices, and knowledge

    AUTO-OPTIMIZATION:
    - Adjusts config based on usage patterns
    - Optimizes batch sizes and concurrency
    - Fixes resource limit issues

    The self-healing system integrates with the homeostasis daemon for
    continuous autonomous healing when running in daemon mode.

EXAMPLES:
    librainian config heal                    # Diagnose and fix issues
    librainian config heal --dry-run          # Preview changes only
    librainian config heal --diagnose-only    # Diagnosis report only
    librainian config heal --rollback         # Undo last healing
    librainian config heal --history          # View effectiveness history
    librainian config heal --risk-tolerance safe  # Only apply safest fixes
    librainian config heal --format json      # JSON output for automation
`,

	  doctor: `
	librainian doctor - Run health diagnostics to identify issues

USAGE:
    librainian doctor [options]

OPTIONS:
    --verbose           Show detailed diagnostic information
    --json              Output results as JSON
    --heal              Attempt automatic healing (config + bootstrap)
    --fix               Purge invalid embeddings and re-embed via bootstrap
    --check-consistency Run strict referential integrity checks across store tables
    --install-grammars  Install missing tree-sitter grammar packages
    --risk-tolerance    Max risk for config fixes (safe|low|medium)

DESCRIPTION:
    Runs comprehensive health diagnostics on the LiBrainian system to identify
    potential issues and provide actionable suggestions. Checks include:

    DATABASE ACCESS:
    - Verifies database file exists and is accessible
    - Checks file permissions and size
    - Validates metadata and schema

    BOOTSTRAP STATUS:
    - Checks if bootstrap has been run
    - Verifies bootstrap completed successfully
    - Detects if rebootstrapping is needed

    FUNCTIONS/EMBEDDINGS CORRELATION:
    - Compares function count to embedding count
    - Reports embedding coverage percentage
    - Flags missing or incomplete embeddings

    MODULES INDEXED:
    - Verifies module extraction completed
    - Reports total modules indexed

    CONTEXT PACKS HEALTH:
    - Checks pack generation status
    - Reports pack types and counts
    - Identifies low-confidence or stale packs

    VECTOR INDEX:
    - Verifies HNSW index population
    - Checks for dimension mismatches
    - Reports multi-vector status

    GRAPH EDGES:
    - Validates relationship graph
    - Reports edge types and counts
    - Flags missing or incomplete graphs

    KNOWLEDGE CONFIDENCE:
    - Reports average confidence level
    - Flags low overall confidence

    EMBEDDING PROVIDER:
    - Verifies embedding model availability
    - Reports provider status

    LLM PROVIDER:
    - Checks LLM availability for synthesis
    - Reports authentication status

    PARSER COVERAGE:
    - Detects languages in the workspace
    - Flags missing tree-sitter configs or grammars
    - Optionally installs missing grammar packages

OUTPUT:
    Each check reports one of three statuses:
    - [OK]     Check passed, component is healthy
    - [WARN]   Check passed with warnings, may need attention
    - [ERROR]  Check failed, requires action

    Exit codes:
    - 0: All checks passed or only warnings
    - 1: One or more errors detected

EXAMPLES:
    librainian doctor
    librainian doctor --verbose
    librainian doctor --json
    librainian doctor --verbose --json
    librainian doctor --heal
    librainian doctor --fix
    librainian doctor --check-consistency --json
	    librainian doctor --heal --risk-tolerance safe
	    librainian doctor --install-grammars
		`,

	  'publish-gate': `
	librainian publish-gate - Run strict publish-readiness gate checks

	USAGE:
	    librainian publish-gate [options]

	OPTIONS:
	    --profile broad|release
	                      broad: block on all status drift and all unmet metrics
	                      release: block on release evidence + release-critical metrics
	    --gates-file <path>   override gates file path (default: docs/librainian/GATES.json)
	    --status-file <path>  override status file path (default: docs/librainian/STATUS.md)
	    --max-artifact-age-hours <n>
	                      max allowed age for release evidence artifacts (default: 168)
	    --live-fire-pointer <path>
	                      override live-fire quick pointer path
	    --ab-report <path>    override A/B harness report path
	    --use-case-report <path>
	                      override agentic use-case review report path
	    --smoke-report <path> override external smoke report path
	    --json                emit JSON report to stdout

	DESCRIPTION:
	    Evaluates whether LiBrainian is publish-ready using evidence-backed artifacts.
	    Broad profile is backlog-complete and blocks on all status drift.
	    Release profile is publish-focused: live-fire, strict A/B, strict use-case
	    review, and external smoke evidence must be fresh and passing; smoke must
	    demonstrate multi-language coverage; release-critical metrics must be met.
	    Reports machine-actionable blockers with remediation hints.

	EXAMPLES:
	    librainian publish-gate
	    librainian publish-gate --json
	    librainian publish-gate --profile broad --json
	    librainian publish-gate --gates-file /tmp/GATES.json --status-file /tmp/STATUS.md --json
	`,

	  repair: `
	librainian repair - Run DETECT->FIX->VERIFY loop and write an audit report

	USAGE:
	    librainian repair [options]

	OPTIONS:
	    --mode fast|full       fast bootstraps without LLM; full enables evaluation (default: fast)
	    --max-cycles <n>       maximum loop cycles (default: 2)
	    --skip-eval            disable evaluation even in full mode
	    --output <path>        write report to an explicit path (default: state/audits/ralph/)
	    --json                 emit JSON report to stdout

	DESCRIPTION:
	    Runs a pragmatic operational loop intended to take a repo from error-prone
	    to a stable baseline:
	    - Runs onboarding recovery (storage recovery, config heal, bootstrap)
	    - Captures a state report
	    - Optionally runs staged evaluation (FitnessReport) in full mode
	    - Writes a single audit artifact for evidence and debugging

	EXAMPLES:
	    librainian repair
	    librainian repair --mode full
	    librainian repair --mode full --max-cycles 3 --json
	`,

	  ralph: `
	librainian ralph - Deprecated alias for librainian repair

	USAGE:
	    librainian ralph [options]

	DESCRIPTION:
	    This command still works for backward compatibility, but is deprecated.
	    Use \`librainian repair\` for all new scripts and documentation.
	`,

	  'external-repos': `
	librainian external-repos - Sync external repo corpus from manifest.json

	USAGE:
	    librainian external-repos sync [options]

	OPTIONS:
	    --repos-root <path>   directory containing manifest.json (default: eval-corpus/external-repos)
	    --max-repos <n>       sync only first n repos from manifest
	    --verify              run smoke verification after sync
	    --json                emit JSON report to stdout

	DESCRIPTION:
	    Ensures the external repo evaluation corpus is present on disk and pinned
	    to the commits recorded in manifest.json. This is used by:
	    - librainian smoke
	    - evaluation harnesses that require real repos

	EXAMPLES:
	    librainian external-repos sync
	    librainian external-repos sync --verify
	    librainian external-repos sync --max-repos 3 --json
	`,
	};

const DEFAULT_EXIT_CODES_SECTION = `
EXIT CODES (DEFAULT):
    0      Success
    1      General failure (EUNKNOWN)
    2      Internal failure (EINTERNAL)
    3      Timeout (ETIMEOUT)
    10-13  Storage/index failures (missing, stale, corrupt, locked)
    20-23  Query failures
    30-34  Provider failures
    40-42  Bootstrap/preflight failures
    50-53  Invalid arguments or file selection errors

    In --json mode, inspect the "code" field for the exact machine-readable reason.
`;

const COMMAND_EXIT_CODE_APPENDIX: Partial<Record<keyof typeof HELP_TEXT, string>> = {
  status: `
STATUS EXIT CODES:
    0  Storage ready and freshness drift <= 5%
    1  Storage ready and freshness drift > 5%
    2  Storage/index not initialized
`,
};

function withExitCodes(command: keyof typeof HELP_TEXT, text: string): string {
  if (/exit codes:/i.test(text)) {
    return text;
  }

  const sections = [text.trimEnd()];
  const commandAppendix = COMMAND_EXIT_CODE_APPENDIX[command];
  if (commandAppendix) {
    sections.push(commandAppendix.trimEnd());
  }
  sections.push(DEFAULT_EXIT_CODES_SECTION.trimEnd());
  return `${sections.join('\n\n')}\n`;
}

function renderHelp(command?: string): string {
  if (command && command in HELP_TEXT) {
    return withExitCodes(command as keyof typeof HELP_TEXT, HELP_TEXT[command as keyof typeof HELP_TEXT]);
  }

  if (command) {
    return `Unknown command: ${command}\n${withExitCodes('main', HELP_TEXT.main)}`;
  }

  return withExitCodes('main', HELP_TEXT.main);
}

export function showHelp(command?: string): void {
  console.log(renderHelp(command));
}

export function getCommandHelp(command: string): string {
  return renderHelp(command);
}
