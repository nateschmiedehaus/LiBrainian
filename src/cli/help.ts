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
    librainian query "How does authentication work?"
    librainian status --format json

COMMANDS:
    quickstart          Smooth onboarding and recovery flow
    query <intent>      Run a query against the knowledge base
    feedback <token>    Submit outcome feedback for a prior query
    status              Show current index and health status
    bootstrap           Initialize or refresh the knowledge index
    check-providers     Check provider availability and authentication
    watch               Watch for file changes and auto-reindex
    compose             Compose construction pipelines or technique bundles
    doctor              Run diagnostics and recovery hints
    health              Show current LiBrainian health status
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
    index --force <file...>  Incrementally index specific files
    analyze             Run static analysis (dead code, complexity)
    config heal         Auto-detect and fix suboptimal configuration
    ralph               Run DETECT->FIX->VERIFY loop and write an audit report
    external-repos      Sync external repo corpus from manifest.json

GLOBAL OPTIONS:
    -h, --help          Show help information
    -v, --version       Show version information
    -w, --workspace     Set workspace directory (default: current directory)
    --verbose           Enable verbose output
    --json              Enable JSON output for errors (agent friendly)

EXAMPLES:
    librainian quickstart
    librainian query "How does the payment flow work?"
    librainian bootstrap --force
    librainian compose "Prepare a release plan" --limit 1
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

  query: `
librarian query - Run a query against the knowledge base

USAGE:
    librarian query "<intent>" [options]

OPTIONS:
    --depth <level>     Query depth: L0 (shallow), L1 (default), L2 (deep), L3 (comprehensive)
    --files <paths>     Comma-separated list of affected files
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
    --emit-baseline     Write OnboardingBaseline.v1 after successful bootstrap
    --update-agent-docs Opt in to updating AGENTS.md / CLAUDE.md / CODEX.md
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

  quickstart: `
librarian quickstart - Smooth onboarding and recovery flow

USAGE:
    librarian quickstart [options]

OPTIONS:
    --mode <name>       Bootstrap mode: fast | full (default: fast)
    --risk-tolerance <t>  Config heal risk: safe | low | medium (default: low)
    --force             Force bootstrap even if not required
    --skip-baseline     Skip writing OnboardingBaseline.v1
    --update-agent-docs Opt in to updating AGENTS.md / CLAUDE.md / CODEX.md
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
    librarian quickstart --mode full
    librarian quickstart --force --skip-baseline
    librarian quickstart --update-agent-docs
    librarian quickstart --json
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

OPTIONS:
    --force             REQUIRED. Acknowledge risk of context pack loss on failure
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

    CAUTION: Context packs are invalidated BEFORE reindexing. If indexing
    fails mid-operation, context packs for target files will be PERMANENTLY
    LOST. Recovery requires running 'librarian bootstrap' to regenerate.
    The --force flag is required to acknowledge this risk.

EXAMPLES:
    librarian index --force src/new_feature.ts
    librarian index --force src/auth/*.ts --verbose
    librarian index --force file1.ts file2.ts file3.ts
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

	  ralph: `
	librarian ralph - Run DETECT->FIX->VERIFY loop and write an audit report

	USAGE:
	    librarian ralph [options]

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
	    librarian ralph
	    librarian ralph --mode full
	    librarian ralph --mode full --max-cycles 3 --json
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

export function showHelp(command?: string): void {
  if (command && command in HELP_TEXT) {
    console.log(HELP_TEXT[command as keyof typeof HELP_TEXT]);
  } else if (command) {
    console.log(`Unknown command: ${command}`);
    console.log(HELP_TEXT.main);
  } else {
    console.log(HELP_TEXT.main);
  }
}

export function getCommandHelp(command: string): string {
  return HELP_TEXT[command as keyof typeof HELP_TEXT] || HELP_TEXT.main;
}
