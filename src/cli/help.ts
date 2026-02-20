/**
 * @fileoverview Detailed help text for librarian CLI commands
 */

const HELP_TEXT = {
  main: `
LiBrainian CLI

USAGE:
    librainian <command> [options]
    librarian <command> [options]     # compatibility alias

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
    bootstrap           Initialize or refresh the knowledge index
    embed               Repair and backfill semantic embeddings
    uninstall           Remove LiBrainian bootstrap artifacts from workspace
    install-openclaw-skill Install official OpenClaw skill and config wiring
    openclaw-daemon     Manage OpenClaw daemon registration and state
    memory-bridge       Show MEMORY.md bridge state and manage session core memory
    test-integration    Run quantitative integration benchmark suites
    benchmark           Run local performance SLA diagnostics
    privacy-report      Summarize privacy audit evidence
    export              Export portable .librarian index bundle
    import              Import portable .librarian index bundle
    features            Show dynamic feature registry and current status
    mcp                 Start MCP stdio server / print client config snippets
    eject-docs          Remove injected librarian docs from CLAUDE.md files
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
    librainian export --output state/exports/librarian-index.tar.gz
    librainian import --input state/exports/librarian-index.tar.gz
    librainian features --json
    librainian mcp --print-config --client claude
    librainian generate-docs --include tools,context,rules
    librainian compose "Prepare a release plan" --limit 1
    librainian constructions search "security audit"
    librainian publish-gate --profile release --json

For command-specific details:
    librainian help <command>
`,

  status: `
librarian status - Show current librarian status and index health

USAGE:
    librarian status [options]

OPTIONS:
    --verbose           Show detailed statistics
    --format text|json  Output format (default: text)
    --json              Alias for --format json
    --out <path>        Write JSON output to file (requires --json/--format json)
    --workspace-set <path>  Load monorepo workspace-set config and report per-package status

DESCRIPTION:
    Displays the current state of the librarian knowledge index, including:
    - Bootstrap status and version
    - Number of indexed files, functions, and modules
    - Context pack statistics
    - Provider availability
    - Index health indicators

EXAMPLES:
    librarian status
    librarian status --verbose
    librarian status --json --out /tmp/librarian-status.json
`,

  stats: `
librarian stats - Summarize evidence-ledger tool-call cost/performance telemetry

USAGE:
    librarian stats [options]

OPTIONS:
    --days <n>          Rolling window in days (default: 7)
    --limit <n>         Number of top tools in breakdown (default: 5)
    --json              Output machine-readable JSON report

DESCRIPTION:
    Aggregates MCP tool-call telemetry from .librarian/evidence_ledger.db:
    - Total calls, estimated cost, average duration, cache-hit rate
    - Top expensive tools in the selected time window
    - Daily trend snapshot and optimization recommendations

EXAMPLES:
    librarian stats
    librarian stats --days 30 --limit 10
    librarian stats --json
`,

  query: `
librarian query - Run a query against the knowledge base

USAGE:
    librarian query "<intent>" [options]

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
    Queries the librarian knowledge base for context packs matching your intent.
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
    librarian query "How does authentication work?"
    librarian query "Find error handling patterns" --depth L2
    librarian query "Show prior related tasks" --depth L3
    librarian query "What tests cover login?" --files src/auth/login.ts
    librarian query "Assess impact" --uc UC-041,UC-042 --uc-priority high
    librarian query "API endpoint structure" --json
    librarian query "API endpoint structure" --json --out /tmp/librarian-query.json
    librarian query "Quick overview" --token-budget 2000 --token-reserve 500
    librarian query "Test reproducibility" --deterministic --json
    librarian query "list all CLI commands" --enumerate
    librarian query "how many test files" --enumerate --json
    librarian query "what depends on SqliteStorage" --exhaustive --transitive
    librarian query "How does auth work?" --session new --json
    librarian query "What about token refresh?" --session sess_abc123 --json
    librarian query --session sess_abc123 --drill-down src/auth/session.ts --json
`,

  'repo-map': `
librarian repo-map - Generate a compact repo map ranked by symbol centrality

USAGE:
    librarian repo-map [options]

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
    librarian repo-map
    librarian repo-map --max-tokens 4096
    librarian repo-map --focus src/auth,src/api
    librarian repo-map --style detailed
    librarian repo-map --json
`,

  feedback: `
librarian feedback - Submit outcome feedback for a prior query

USAGE:
    librarian feedback <feedbackToken> --outcome <success|failure|partial> [options]

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
    - feedbackToken comes from librarian query output (feedbackToken field)
    - Use --ratings/--ratings-file for explicit per-pack relevance control
    - Without custom ratings, outcome-level feedback applies to all packs

EXAMPLES:
    librarian feedback fbk_123 --outcome success
    librarian feedback fbk_123 --outcome failure --missing-context "Need auth token lifecycle docs"
    librarian feedback fbk_123 --outcome partial --ratings-file state/ratings.json --json
`,

  bootstrap: `
librarian bootstrap - Initialize or refresh the knowledge index

USAGE:
    librarian bootstrap [options]

OPTIONS:
    --force             Force full reindex even if data exists
    --force-resume      Resume bootstrap even if workspace fingerprint changed
    --scope <name>      Bootstrap scope: full | librarian (default: full)
    --mode <name>       Bootstrap mode: fast | full (default: full)
    --workspace-set <path>  Bootstrap all packages from a workspace-set config JSON
    --emit-baseline     Write OnboardingBaseline.v1 after successful bootstrap
    --update-agent-docs Opt in to updating AGENTS.md / CLAUDE.md / CODEX.md
    --no-claude-md      Skip CLAUDE.md injection even when updating agent docs
    --install-grammars  Install missing tree-sitter grammar packages
    --llm-provider <p>  Force LLM provider: claude | codex (default: auto)
    --llm-model <id>    Force LLM model id (default: daily selection)

DESCRIPTION:
    Initializes the librarian knowledge index by:
    1. Scanning the workspace directory structure
    2. Indexing all code files (functions, modules, exports)
    3. Generating embeddings for semantic search
    4. Building relationship graphs (imports, calls)
    5. Creating pre-computed context packs

    This command MUST complete before any agent work can proceed.
    It automatically detects and upgrades older librarian data.

PROGRESS INDICATORS:
    The bootstrap process shows real-time progress with:
    - Current phase name and description
    - Progress percentage
    - Estimated time remaining
    - Files processed count

EXAMPLES:
    librarian bootstrap
    librarian bootstrap --force
    librarian bootstrap --force-resume
    librarian bootstrap --scope librarian
    librarian bootstrap --scope librarian --llm-provider codex --llm-model gpt-4o-mini
    librarian bootstrap --emit-baseline
`,

  embed: `
librarian embed - Repair and backfill semantic embeddings

USAGE:
    librarian embed --fix [--json]

OPTIONS:
    --fix               Run embedding backfill remediation (required)
    --json              Emit machine-readable JSON output

DESCRIPTION:
    Forces a fast bootstrap pass with embeddings enabled to recover semantic
    retrieval coverage. This command fails closed if the embedding provider is
    unavailable.

EXAMPLES:
    librarian embed --fix
    librarian embed --fix --json
`,

  uninstall: `
librarian uninstall - Remove LiBrainian bootstrap artifacts

USAGE:
    librarian uninstall [options]

OPTIONS:
    --dry-run           Preview changes without modifying files
    --keep-index        Keep .librarian index data while removing docs/config artifacts
    --force             Skip confirmation prompt
    --json              Output machine-readable JSON summary
    --no-install        Skip npm install after package.json dependency removal

DESCRIPTION:
    Removes LiBrainian-managed workspace artifacts in one flow:
    - Strips injected <!-- LIBRARIAN_DOCS_START --> blocks from known agent docs
    - Removes librainian/librarian dependencies from package.json when present
    - Deletes generated directories (.librarian, state) unless --keep-index
    - Deletes .librainian-manifest.json uninstall record

    If .librainian-manifest.json exists, uninstall uses it as source-of-truth.
    If missing, uninstall falls back to a deterministic scan of known artifacts.

EXAMPLES:
    librarian uninstall --dry-run
    librarian uninstall --force
    librarian uninstall --force --keep-index
    librarian uninstall --json --force
`,

  'audit-skill': `
librarian audit-skill - Audit a SKILL.md file for malicious patterns

USAGE:
    librarian audit-skill <path-to-SKILL.md> [options]

OPTIONS:
    --json              Emit machine-readable JSON report

DESCRIPTION:
    Runs SkillAuditConstruction on a SKILL.md file and reports:
    - risk score (0-100)
    - verdict (safe | suspicious | malicious)
    - detected malicious/suspicious patterns
    - recommendation for install safety

EXAMPLES:
    librarian audit-skill ./skills/openclaw/SKILL.md
    librarian audit-skill ./SKILL.md --json
`,

  'install-openclaw-skill': `
librarian install-openclaw-skill - Install the official OpenClaw LiBrainian skill

USAGE:
    librarian install-openclaw-skill [options]

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
    librarian install-openclaw-skill
    librarian install-openclaw-skill --dry-run
    librarian install-openclaw-skill --openclaw-root /tmp/.openclaw --json
`,

  'openclaw-daemon': `
librarian openclaw-daemon - Manage OpenClaw daemon registration and local state

USAGE:
    librarian openclaw-daemon <start|status|stop> [options]

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
    librarian openclaw-daemon start
    librarian openclaw-daemon status --json
    librarian openclaw-daemon stop --state-root /tmp/librainian-state
`,

  'memory-bridge': `
librarian memory-bridge - Inspect memory bridge state and manage session core memory

USAGE:
    librarian memory-bridge status [options]
    librarian memory-bridge remember <key> <value> [--json]
    librarian memory-bridge add <content> [--scope codebase|module|function] [--scope-key <id>] [--json]
    librarian memory-bridge search <query> [--limit <n>] [--json]
    librarian memory-bridge update <id> <content> [--json]
    librarian memory-bridge delete <id> [--json]

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
    Stores a key/value fact in .librarian/session.json core memory so future
    queries can receive session-core-memory disclosure context.

    add/search/update/delete:
    Manages persistent semantic memory facts in .librarian/memory.db.
    Add operations are dedupe-aware: similar facts update existing records
    instead of creating duplicates.

EXAMPLES:
    librarian memory-bridge status
    librarian memory-bridge status --memory-file /tmp/.openclaw/memory/MEMORY.md --json
    librarian memory-bridge remember auth_model "JWT expires in 1 hour"
    librarian memory-bridge add "validateToken has race condition under refresh" --scope function --scope-key validateToken
    librarian memory-bridge search "token validation race"
`,

  'test-integration': `
librarian test-integration - Run quantitative integration benchmark suites

USAGE:
    librarian test-integration --suite openclaw [options]

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
    librarian test-integration --suite openclaw
    librarian test-integration --suite openclaw --scenario skill-audit --json
    librarian test-integration --suite openclaw --strict --out state/eval/openclaw/benchmark.json
`,

  'benchmark': `
librarian benchmark - Run local performance SLA diagnostics

USAGE:
    librarian benchmark [options]

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
    librarian benchmark
    librarian benchmark --queries 12 --incremental-files 10
    librarian benchmark --json --out state/eval/performance/PerformanceSLAReport.v1.json --fail-on block
`,

  'privacy-report': `
librarian privacy-report - Summarize strict privacy-mode audit evidence

USAGE:
    librarian privacy-report [options]

OPTIONS:
    --since <ISO-8601>     Only include events at/after this timestamp
    --format <fmt>         Output format: text|json (default: text)
    --json                 Shortcut for --format json
    --out <path>           Write JSON report to file (requires --json)

DESCRIPTION:
    Reads .librarian/audit/privacy.log and produces a compliance summary:
    - total privacy-audit events
    - blocked operations in strict mode
    - local-only operations
    - external content transmissions (must be zero for strict compliance)

EXAMPLES:
    librarian privacy-report
    librarian privacy-report --since 2026-02-01T00:00:00Z
    librarian privacy-report --json --out state/audits/privacy-report.json
`,

  'export': `
librarian export - Export a portable .librarian index bundle

USAGE:
    librarian export [options]

OPTIONS:
    --output <path>      Output bundle path (default: .librarian/exports/librarian-index.tar.gz)
    --json               Emit machine-readable JSON output
    --out <path>         Write JSON output to file

DESCRIPTION:
    Creates a transportable archive of current index artifacts for team sharing
    and CI warm-starts. Export includes:
    - librarian.sqlite
    - knowledge.db (if present)
    - evidence_ledger.db (if present)
    - hnsw.bin (if present)
    - manifest.json with schema/version/git SHA metadata

    Absolute workspace paths in SQLite text columns are rewritten to a
    placeholder token, so bundles can be imported on different machines.

EXAMPLES:
    librarian export
    librarian export --output state/exports/librarian-index.tar.gz
    librarian export --json --out state/exports/index-export.json
`,

  'import': `
librarian import - Import a portable .librarian index bundle

USAGE:
    librarian import --input <bundle.tar.gz> [options]

OPTIONS:
    --input <path>       Path to exported bundle tarball
    --json               Emit machine-readable JSON output
    --out <path>         Write JSON output to file

DESCRIPTION:
    Imports an exported index bundle into the current workspace .librarian
    directory, validates manifest compatibility/checksums, and rewrites the
    workspace placeholder token back to this machine's absolute workspace root.
    If git HEAD differs from the bundle SHA, import warns and suggests running:
      librarian update --since <bundleSha>

EXAMPLES:
    librarian import --input state/exports/librarian-index.tar.gz
    librarian import --input ./librarian-index.tar.gz --json
`,

  'features': `
librarian features - Show dynamic feature registry with status and config hints

USAGE:
    librarian features [options]

OPTIONS:
    --json               Emit machine-readable feature registry
    --verbose            Include docs links and configuration hints in text output
    --out <path>         Write JSON output to file (requires --json)

DESCRIPTION:
    Lists core and experimental LiBrainian capabilities, their runtime status
    (active/limited/inactive/not_implemented), and where to configure or learn
    more. This command is designed to run quickly without deep index scans.

EXAMPLES:
    librarian features
    librarian features --verbose
    librarian features --json --out state/features.json
`,

  mcp: `
librarian mcp - Start MCP stdio server and print client setup snippets

USAGE:
    librarian mcp [options]

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
    librarian mcp
    librarian mcp --print-config
    librarian mcp --print-config --client claude
    librarian mcp --print-config --launcher npx --json
`,

  'eject-docs': `
librarian eject-docs - Remove injected librarian docs from CLAUDE.md files

USAGE:
    librarian eject-docs [options]

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
    librarian eject-docs
    librarian eject-docs --dry-run
    librarian eject-docs --json
`,

  'generate-docs': `
librarian generate-docs - Generate prompt-injection docs (TOOLS/CONTEXT/RULES)

USAGE:
    librarian generate-docs [options]

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
    librarian generate-docs
    librarian generate-docs --output-dir docs/generated --combined
    librarian generate-docs --include tools,context --json
`,

  quickstart: `
librarian quickstart - Smooth onboarding and recovery flow

USAGE:
    librarian quickstart [options]

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
    Runs a full onboarding recovery flow to get Librarian operational:
    - Auto-detects workspace root
    - Heals configuration issues
    - Recovers storage (stale locks/WAL)
    - Bootstraps if required (fast by default)
    - Emits a baseline audit (unless skipped)

    If embeddings or LLMs are unavailable, quickstart proceeds in degraded mode.

EXAMPLES:
    librarian quickstart
    librarian setup --depth quick --ci --no-mcp
    librarian init --depth full
    librarian quickstart --mode full
    librarian quickstart --force --skip-baseline
    librarian quickstart --update-agent-docs
    librarian quickstart --json
`,

  setup: `
librarian setup - Alias for quickstart onboarding

USAGE:
    librarian setup [options]

DESCRIPTION:
    Runs the same onboarding flow as:
    librarian quickstart [options]

    Common setup invocation:
    librarian setup --depth quick --ci --no-mcp

See:
    librarian help quickstart
`,
  init: `
librarian init - Scaffold constructions/MCP/CLAUDE.md with quickstart fallback

USAGE:
    librarian init [--construction <name>] [--mcp-config] [--claude-md] [--force] [--json]
    librarian init [--editor vscode|cursor|continue|claude|jetbrains|windsurf|all] [--dry-run] [--global] [quickstart options]
    librarian init [quickstart options]

OPTIONS:
    --construction <name>  Create .librarian construction + test + docs scaffolding
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
    librarian quickstart [options]

EXAMPLES:
    librarian init --construction SafeRefactorAdvisor
    librarian init --mcp-config --claude-md
    librarian init --construction SafeRefactorAdvisor --mcp-config --json
    librarian init --depth quick --ci --no-mcp

See:
    librarian help quickstart
`,
  smoke: `
librarian smoke - Run external repo smoke harness

USAGE:
    librarian smoke [options]

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
    librarian smoke
    librarian smoke --max-repos 3
    librarian smoke --timeout-ms 120000 --artifacts-dir state/eval/smoke
    librarian smoke --repos-root ./eval-corpus/external-repos --json
`,

  journey: `
librarian journey - Run agentic journey simulations

USAGE:
    librarian journey [options]

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
    librarian journey
    librarian journey --max-repos 3 --deterministic
    librarian journey --strict-objective --timeout-ms 120000
    librarian journey --llm optional --json
`,

  'live-fire': `
librarian live-fire - Run continuous objective trial matrix

USAGE:
    librarian live-fire [options]

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
    librarian live-fire --list-profiles
    librarian live-fire --profile baseline --profiles-file config/live_fire_profiles.json
    librarian live-fire --matrix --profiles baseline,hardcore --profiles-file config/live_fire_profiles.json
    librarian live-fire --strict-objective --include-smoke
    librarian live-fire --rounds 2 --llm-modes disabled,optional --json
`,

  inspect: `
librarian inspect - Inspect a module or function's knowledge

USAGE:
    librarian inspect <path-or-name> [options]

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
    librarian inspect src/auth/login.ts
    librarian inspect loginUser --type function
    librarian inspect src/api/handlers/ --json
`,

  compose: `
librarian compose - Compose construction pipelines or technique bundles

USAGE:
    librarian compose "<intent>" [options]

OPTIONS:
    --mode <m>         Compose mode: constructions|techniques (default: constructions)
    --limit <n>         Limit number of bundles returned
    --include-primitives  Include primitive definitions in output
    --pretty            Pretty-print JSON output

DESCRIPTION:
    constructions mode:
    - Runs composable construction bricks with shared context and prior findings
    - Produces normalized findings/recommendations across knowledge, refactoring, and security
    - Reuses context through a single pipeline pass for agent workflows

    techniques mode:
    - Compiles technique composition bundles from intent using the plan compiler
    - Outputs template + primitive bundles for downstream automation

EXAMPLES:
    librarian compose "Investigate payment auth regression"
    librarian compose "Prepare a release plan" --mode techniques
    librarian compose "Performance regression triage" --mode techniques --limit 2
    librarian compose "Release readiness" --mode techniques --include-primitives --pretty
`,

  constructions: `
librarian constructions - Browse, search, describe, install, run, and validate constructions

USAGE:
    librarian constructions <subcommand> [options]

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
    librarian constructions list
    librarian constructions list --all
    librarian constructions list --trust-tier official --limit 20
    librarian constructions search "blast radius change impact"
    librarian constructions describe librainian:security-audit-helper
    librarian constructions install librainian:security-audit-helper --dry-run
    librarian constructions run librainian:security-audit-helper --input '{"files":["src/auth.ts"],"checkTypes":["auth"]}'
    librarian constructions validate ./construction.manifest.json --json
`,

  confidence: `
librarian confidence - Show confidence scores for an entity

USAGE:
    librarian confidence <entity-id> [options]

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
    librarian confidence function:loginUser:src/auth/login.ts
    librarian confidence module:src/api/handlers.ts --history
`,

  validate: `
librarian validate - Validate constraints for a file

USAGE:
    librarian validate <file-path> [options]

OPTIONS:
    --before <content>  Previous file content (for change validation)
    --after <content>   New file content (for change validation)
    --json              Output results as JSON

DESCRIPTION:
    Validates a file against architectural constraints, including:
    - Explicit constraints from .librarian/constraints.yaml
    - Inferred layer boundary constraints
    - Pattern-based constraints (no console.log, no test imports)

    Returns:
    - Blocking violations (errors)
    - Non-blocking warnings
    - Suggestions for resolution

EXAMPLES:
    librarian validate src/api/handler.ts
    librarian coverage
    librarian coverage --output state/audits/librarian/coverage/custom.json --strict
    librarian validate src/auth/login.ts --json
`,

  coverage: `
librarian coverage - Generate UC x method x scenario coverage audit

USAGE:
    librarian coverage [options]

OPTIONS:
    --output <path>     Output path for coverage matrix JSON
    --strict            Fail if any UC/method/scenario entry is missing PASS

DESCRIPTION:
    Generates the UC × method × scenario matrix required by validation.
    The report is written to state/audits/librarian/coverage/.

EXAMPLES:
    librarian coverage
    librarian coverage --output state/audits/librarian/coverage/custom.json --strict
`,

  'check-providers': `
librarian check-providers - Check provider availability and authentication

USAGE:
    librarian check-providers [options]

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
    librarian check-providers
    librarian check-providers --json
    librarian check-providers --json --out /tmp/librarian-providers.json
`,

  watch: `
librarian watch - Watch for file changes and auto-reindex

USAGE:
    librarian watch [options]

OPTIONS:
    --debounce <ms>     Debounce interval in milliseconds (default: 200)
    --quiet             Suppress output except errors

DESCRIPTION:
    Starts a file watcher that automatically reindexes changed files,
    keeping the librarian knowledge base up-to-date as you code.

    The watcher will:
    - Detect file changes in real-time
    - Debounce rapid changes (configurable)
    - Automatically reindex changed .ts, .js, .py, .go, .rs files
    - Update embeddings, context packs, and relationships
    - Log all indexing activity

    Press Ctrl+C to stop the watcher.

EXAMPLES:
    librarian watch
    librarian watch --debounce 500
    librarian watch --quiet
`,

  health: `
librarian health - Show current Librarian health status

USAGE:
    librarian health [options]

OPTIONS:
    --verbose           Show detailed health metrics
    --format <fmt>      Output format: text | json | prometheus (default: text)

DESCRIPTION:
    Shows the current health status of the Librarian system, including:
    - Overall health score
    - Individual health dimensions
    - Active issues and warnings
    - Recommended actions

EXAMPLES:
    librarian health
    librarian health --verbose
    librarian health --format json
`,

  check: `
librarian check - Run diff-aware CI integrity checks

USAGE:
    librarian check [options]

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
    librarian check
    librarian check --diff HEAD~1..HEAD --format text
    librarian check --diff origin/main --json
    librarian check --diff HEAD~1..HEAD --format junit --out reports/librarian-check.xml
`,

  heal: `
librarian heal - Run homeostatic healing loop until healthy

USAGE:
    librarian heal [options]

OPTIONS:
    --max-cycles <N>    Maximum healing cycles (default: 10)
    --budget-tokens <N> Token budget per cycle
    --dry-run           Show what would be healed without making changes

DESCRIPTION:
    Runs automated healing to restore Librarian health, including:
    - Fixing stale or invalid data
    - Rebuilding broken relationships
    - Refreshing embeddings
    - Resolving detected issues

EXAMPLES:
    librarian heal
    librarian heal --max-cycles 5
    librarian heal --dry-run
`,

  evolve: `
librarian evolve - Run evolutionary improvement loop

USAGE:
    librarian evolve [options]

OPTIONS:
    --cycles <N>        Number of evolution cycles (default: 1)
    --candidates <N>    Number of candidates per cycle (default: 3)
    --dry-run           Show what would evolve without making changes
    --format <fmt>      Output format: text | json (default: text)

DESCRIPTION:
    Runs evolutionary improvement to enhance Librarian quality, including:
    - Generating improvement candidates
    - Evaluating candidates against fitness criteria
    - Selecting and applying best improvements
    - Recording outcomes for learning

EXAMPLES:
    librarian evolve
    librarian evolve --cycles 3 --candidates 5
    librarian evolve --dry-run
`,

  eval: `
librarian eval - Produce FitnessReport.v1 for current state

USAGE:
    librarian eval [options]

OPTIONS:
    --output <path>     Output path for the report
    --save-baseline     Save as baseline for future comparisons
    --stages <range>    Evaluation stages to run: 0-4 (default: 0-4)
    --format <fmt>      Output format: text | json (default: text)

DESCRIPTION:
    Evaluates the current Librarian state and produces a fitness report:
    - Stage 0: Basic structural checks
    - Stage 1: Semantic quality metrics
    - Stage 2: Relationship integrity
    - Stage 3: Coverage analysis
    - Stage 4: Performance benchmarks

EXAMPLES:
    librarian eval
    librarian eval --save-baseline
    librarian eval --stages 0-2 --format json
`,

  replay: `
librarian replay - Replay an evolution cycle or variant for analysis

USAGE:
    librarian replay <cycle-id|variant-id> [options]

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
    librarian replay cycle-2025-01-18-001
    librarian replay variant-abc123 --verbose
`,

  index: `
librarian index - Incrementally index specific files

USAGE:
    librarian index --force <file...> [options]
    librarian index --force --incremental [options]
    librarian index --force --staged [options]
    librarian index --force --since <ref> [options]

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
    LOST. Recovery requires running 'librarian bootstrap' to regenerate.
    The --force flag is required to acknowledge this risk.

EXAMPLES:
    librarian index --force src/new_feature.ts
    librarian index --force src/auth/*.ts --verbose
    librarian index --force file1.ts file2.ts file3.ts
    librarian index --force --incremental
    librarian index --force --staged
    librarian index --force --since origin/main
`,

  update: `
librarian update - Hook-friendly alias for incremental indexing

USAGE:
    librarian update <file...> [options]
    librarian update --incremental [options]
    librarian update --staged [options]
    librarian update --since <ref> [options]

OPTIONS:
    --incremental       Index changed files from git status (modified + added + untracked)
    --staged            Index only staged files from git diff --cached
    --since <ref>       Index files changed since a git ref (for CI branch comparison)
    --verbose           Show detailed indexing output

DESCRIPTION:
    Equivalent to \`librarian index --force ...\` and intended for pre-commit
    tooling (lint-staged, lefthook, pre-commit). This command still performs
    context-pack invalidation/rebuild behavior from indexCommand. Empty
    selector results are treated as no-op success for CI stability.

EXAMPLES:
    librarian update --staged
    librarian update src/auth/session.ts src/api/mcp.ts
    librarian update --since origin/main
`,

  scan: `
librarian scan - Security redaction scan reporting

USAGE:
    librarian scan --secrets [options]

OPTIONS:
    --secrets           Report secret redaction totals from latest audit report
    --json              Emit machine-readable JSON output
    --format text|json  Output format (default: text)

DESCRIPTION:
    Reports redaction totals captured by LiBrainian's secret-redaction pipeline.
    This command reads the latest:
      state/audits/librarian/redaction/*/RedactionAuditReport.v1.json

    and prints total redactions plus per-type counts.

EXAMPLES:
    librarian scan --secrets
    librarian scan --secrets --json
`,

  analyze: `
librarian analyze - Run static analysis on the codebase

USAGE:
    librarian analyze --dead-code [options]
    librarian analyze --dead-weight [options]
    librarian analyze --complexity [options]

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
    librarian analyze --dead-code
    librarian analyze --dead-weight
    librarian analyze --dead-weight --format json
    librarian analyze --dead-code --format json
    librarian analyze --complexity
    librarian analyze --complexity --threshold 15
    librarian analyze --complexity --format json
`,

  config: `
librarian config - Configuration management commands

USAGE:
    librarian config heal [options]

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
    librarian config heal                    # Diagnose and fix issues
    librarian config heal --dry-run          # Preview changes only
    librarian config heal --diagnose-only    # Diagnosis report only
    librarian config heal --rollback         # Undo last healing
    librarian config heal --history          # View effectiveness history
    librarian config heal --risk-tolerance safe  # Only apply safest fixes
    librarian config heal --format json      # JSON output for automation
`,

	  doctor: `
	librarian doctor - Run health diagnostics to identify issues

USAGE:
    librarian doctor [options]

OPTIONS:
    --verbose           Show detailed diagnostic information
    --json              Output results as JSON
    --heal              Attempt automatic healing (config + bootstrap)
    --fix               Purge invalid embeddings and re-embed via bootstrap
    --check-consistency Run strict referential integrity checks across store tables
    --install-grammars  Install missing tree-sitter grammar packages
    --risk-tolerance    Max risk for config fixes (safe|low|medium)

DESCRIPTION:
    Runs comprehensive health diagnostics on the Librarian system to identify
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
    librarian doctor
    librarian doctor --verbose
    librarian doctor --json
    librarian doctor --verbose --json
    librarian doctor --heal
    librarian doctor --fix
    librarian doctor --check-consistency --json
	    librarian doctor --heal --risk-tolerance safe
	    librarian doctor --install-grammars
		`,

	  'publish-gate': `
	librarian publish-gate - Run strict publish-readiness gate checks

	USAGE:
	    librarian publish-gate [options]

	OPTIONS:
	    --profile broad|release
	                      broad: block on all status drift and all unmet metrics
	                      release: block on release evidence + release-critical metrics
	    --gates-file <path>   override gates file path (default: docs/librarian/GATES.json)
	    --status-file <path>  override status file path (default: docs/librarian/STATUS.md)
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
	    Evaluates whether Librarian is publish-ready using evidence-backed artifacts.
	    Broad profile is backlog-complete and blocks on all status drift.
	    Release profile is publish-focused: live-fire, strict A/B, strict use-case
	    review, and external smoke evidence must be fresh and passing; smoke must
	    demonstrate multi-language coverage; release-critical metrics must be met.
	    Reports machine-actionable blockers with remediation hints.

	EXAMPLES:
	    librarian publish-gate
	    librarian publish-gate --json
	    librarian publish-gate --profile broad --json
	    librarian publish-gate --gates-file /tmp/GATES.json --status-file /tmp/STATUS.md --json
	`,

	  repair: `
	librarian repair - Run DETECT->FIX->VERIFY loop and write an audit report

	USAGE:
	    librarian repair [options]

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
	    librarian repair
	    librarian repair --mode full
	    librarian repair --mode full --max-cycles 3 --json
	`,

	  ralph: `
	librarian ralph - Deprecated alias for librarian repair

	USAGE:
	    librarian ralph [options]

	DESCRIPTION:
	    This command still works for backward compatibility, but is deprecated.
	    Use \`librarian repair\` for all new scripts and documentation.
	`,

	  'external-repos': `
	librarian external-repos - Sync external repo corpus from manifest.json

	USAGE:
	    librarian external-repos sync [options]

	OPTIONS:
	    --repos-root <path>   directory containing manifest.json (default: eval-corpus/external-repos)
	    --max-repos <n>       sync only first n repos from manifest
	    --verify              run smoke verification after sync
	    --json                emit JSON report to stdout

	DESCRIPTION:
	    Ensures the external repo evaluation corpus is present on disk and pinned
	    to the commits recorded in manifest.json. This is used by:
	    - librarian smoke
	    - evaluation harnesses that require real repos

	EXAMPLES:
	    librarian external-repos sync
	    librarian external-repos sync --verify
	    librarian external-repos sync --max-repos 3 --json
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
