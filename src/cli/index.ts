#!/usr/bin/env node
/**
 * @fileoverview LiBrainian CLI - Developer Experience Interface
 *
 * The supported public command surface is derived from COMMANDS plus
 * INTERNAL_COMMANDS below. Keep this header intentionally minimal so it does
 * not drift from the gated release contract.
 *
 * @packageDocumentation
 */

import { parseArgs } from 'node:util';
import { showHelp } from './help.js';
import { statusCommand } from './commands/status.js';
import { queryCommand } from './commands/query.js';
import { contextCommand } from './commands/context.js';
import { repoMapCommand } from './commands/repo_map.js';
import { bootstrapCommand } from './commands/bootstrap.js';
import { embedCommand } from './commands/embed.js';
import { uninstallCommand } from './commands/uninstall.js';
import { mcpCommand } from './commands/mcp.js';
import { checkProvidersCommand } from './commands/check_providers.js';
import { quickstartCommand } from './commands/quickstart.js';
import { initCommand } from './commands/init.js';
import { indexCommand } from './commands/index.js';
import { doctorCommand } from './commands/doctor.js';
import { exportIndexStateCommand, importIndexStateCommand } from './commands/index_state_bundle.js';
import { featuresCommand } from './commands/features.js';
import { capabilitiesCommand } from './commands/capabilities.js';
import { resolveWorkspaceArg } from './workspace_arg.js';
import { deriveCliRuntimeMode, applyCliRuntimeMode } from './runtime_mode.js';
import { shouldForceCliExit } from './exit_policy.js';
import {
  CliError,
  formatError,
  classifyError,
  formatErrorWithHints,
  formatErrorJson,
  getExitCode,
  createErrorEnvelope,
  type ErrorEnvelope,
} from './errors.js';

type Command = 'status' | 'stats' | 'calibration' | 'query' | 'context' | 'briefing' | 'repo-map' | 'feedback' | 'bootstrap' | 'embed' | 'uninstall' | 'mcp' | 'eject-docs' | 'generate-docs' | 'inspect' | 'confidence' | 'validate' | 'check-providers' | 'audit-skill' | 'visualize' | 'coverage' | 'quickstart' | 'setup' | 'init' | 'smoke' | 'journey' | 'live-fire' | 'health' | 'check' | 'heal' | 'watch' | 'index' | 'update' | 'scan' | 'triage' | 'contract' | 'diagnose' | 'compose' | 'constructions' | 'analyze' | 'config' | 'doctor' | 'publish-gate' | 'external-repos' | 'memory-bridge' | 'test-integration' | 'benchmark' | 'privacy-report' | 'export' | 'import' | 'features' | 'capabilities' | 'help';

const INTERNAL_COMMANDS = new Set<Command>([
  'stats',
  'calibration',
  'briefing',
  'feedback',
  'eject-docs',
  'generate-docs',
  'inspect',
  'confidence',
  'validate',
  'audit-skill',
  'visualize',
  'coverage',
  'smoke',
  'journey',
  'live-fire',
  'health',
  'check',
  'heal',
  'watch',
  'update',
  'scan',
  'triage',
  'contract',
  'diagnose',
  'compose',
  'constructions',
  'analyze',
  'config',
  'publish-gate',
  'external-repos',
  'memory-bridge',
  'test-integration',
  'benchmark',
  'privacy-report',
]);

function internalCommandsEnabled(): boolean {
  return process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS === '1';
}

function isCommandPubliclyAvailable(command: Command): boolean {
  return !INTERNAL_COMMANDS.has(command) || internalCommandsEnabled();
}

function getPublicCommandNames(): Command[] {
  return (Object.keys(COMMANDS) as Command[]).filter((command) => isCommandPubliclyAvailable(command));
}

function hasInitScaffoldingFlags(rawArgs: string[]): boolean {
  return rawArgs.includes('--construction')
    || rawArgs.includes('--mcp-config')
    || rawArgs.includes('--claude-md');
}

/**
 * Check if --json flag is present in arguments
 */
function hasJsonFlag(args: string[]): boolean {
  return args.includes('--json');
}

/**
 * Output a structured error for agent consumption
 */
function outputStructuredError(envelope: ErrorEnvelope, useJson: boolean, debug: boolean): void {
  if (useJson) {
    // JSON mode: output structured error
    console.error(formatErrorJson(envelope));
  } else {
    // Human mode: formatted error with hints
    console.error(formatErrorWithHints(envelope, { debug }));
  }
}

const COMMANDS: Record<Command, { description: string; usage: string }> = {
  'status': {
    description: 'Show current librainian status',
    usage: 'librainian status [--verbose] [--format text|json] [--out <path>] [--costs] [--cost-budget-usd <n>] [--cost-window-days <n>] [--cost-limit <n>] [--workspace-set <path>]',
  },
  'stats': {
    description: 'Summarize tool-call cost and performance from evidence ledger',
    usage: 'librainian stats [--days N] [--limit N] [--json]',
  },
  'calibration': {
    description: 'Build confidence calibration dashboard from patrol run artifacts',
    usage: 'librainian calibration [--patrol-dir <path>] [--bucket-count N] [--min-samples N] [--json]',
  },
  'query': {
    description: 'Run a query against the knowledge base',
    usage: 'librainian query "<intent>" [--depth L0|L1|L2|L3] [--files <paths>] [--scope <path>] [--diversify] [--diversity-lambda <0-1>] [--session new|<id>] [--drill-down <entity>] [--json] [--out <path>] [--no-bootstrap]',
  },
  'context': {
    description: 'Get focused deep context on a topic (alias for query --depth L3)',
    usage: 'librainian context "<topic>" [--depth L0|L1|L2|L3] [--files <paths>] [--scope <path>] [--json] [--out <path>] [--no-bootstrap]',
  },
  'briefing': {
    description: 'Generate ambient briefing for a file/module path',
    usage: 'librainian briefing <path> [--tier micro|standard|deep] [--max-tokens <n>] [--json]',
  },
  'repo-map': {
    description: 'Generate a compact codebase map ranked by function centrality',
    usage: 'librainian repo-map [--style compact|detailed|json] [--max-tokens N] [--focus pathA,pathB] [--json]',
  },
  'feedback': {
    description: 'Submit task outcome feedback for a prior query',
    usage: 'librainian feedback <feedbackToken> --outcome success|failure|partial [--missing-context "..."] [--json]',
  },
  'bootstrap': {
    description: 'Initialize or refresh the knowledge index',
    usage: 'librainian bootstrap [--force] [--force-resume] [--workspace-set <path>] [--emit-baseline] [--install-grammars]',
  },
  'embed': {
    description: 'Repair and backfill semantic embeddings',
    usage: 'librainian embed --fix [--json]',
  },
  'uninstall': {
    description: 'Remove LiBrainian-managed bootstrap artifacts',
    usage: 'librainian uninstall [--dry-run] [--keep-index] [--force] [--json] [--no-install]',
  },
  'mcp': {
    description: 'Start MCP stdio server or print client config snippets',
    usage: 'librainian mcp [--print-config] [--client claude|cursor|vscode|windsurf|gemini] [--launcher installed|npx] [--json]',
  },
  'eject-docs': {
    description: 'Remove injected librainian docs from CLAUDE.md files',
    usage: 'librainian eject-docs [--dry-run] [--json]',
  },
  'generate-docs': {
    description: 'Generate TOOLS/CONTEXT/RULES prompt docs for agent injection',
    usage: 'librainian generate-docs [--output-dir <path>] [--include tools,context,rules] [--no-tools] [--no-context] [--no-rules] [--max-tokens <n>] [--combined] [--json]',
  },
  'inspect': {
    description: 'Inspect a module or function\'s knowledge',
    usage: 'librainian inspect <path-or-name>',
  },
  'confidence': {
    description: 'Show confidence scores for an entity',
    usage: 'librainian confidence <entity-id>',
  },
  'validate': {
    description: 'Validate constraints for a file',
    usage: 'librainian validate <file-path>',
  },
  'check-providers': {
    description: 'Check provider availability and authentication',
    usage: 'librainian check-providers [--format text|json] [--out <path>] [--force-probe]',
  },
  'audit-skill': {
    description: 'Audit a SKILL.md for malicious or suspicious patterns',
    usage: 'librainian audit-skill <path-to-SKILL.md> [--json]',
  },
  'visualize': {
    description: 'Generate codebase visualizations',
    usage: 'librainian visualize [--type dependency|call|tree|health] [--format ascii|mermaid] [--focus <path>]',
  },
  'coverage': {
    description: 'Generate UC x method x scenario coverage audit',
    usage: 'librainian coverage [--output <path>] [--strict]',
  },
  'quickstart': {
    description: 'Smooth onboarding and recovery flow',
    usage: 'librainian quickstart [--mode fast|full|--depth quick|full] [--risk-tolerance safe|low|medium] [--force] [--skip-baseline] [--ci] [--no-mcp]',
  },
  'setup': {
    description: 'Setup-oriented alias for quickstart onboarding',
    usage: 'librainian setup [--depth quick|full] [--ci] [--no-mcp] [--mode fast|full]',
  },
  'init': {
    description: 'Alias for quickstart onboarding',
    usage: 'librainian init [quickstart options]',
  },
  'smoke': {
    description: 'Run external repo smoke harness',
    usage: 'librainian smoke [--repos-root <path>] [--max-repos N] [--repo a,b] [--timeout-ms N] [--artifacts-dir <path>] [--json]',
  },
  'journey': {
    description: 'Run agentic journey simulations',
    usage: 'librainian journey [--repos-root <path>] [--max-repos N] [--llm disabled|optional] [--deterministic] [--strict-objective] [--timeout-ms N] [--artifacts-dir <path>] [--json]',
  },
  'live-fire': {
    description: 'Run continuous objective trial matrix',
    usage: 'librainian live-fire [--profile <name>|--profiles <a,b>] [--matrix] [--profiles-file <path>] [--repos-root <path>] [--rounds N] [--llm-modes disabled,optional] [--strict-objective] [--include-smoke] [--json]',
  },
  'health': {
    description: 'Show current LiBrainian health status',
    usage: 'librainian health [--verbose] [--completeness] [--format text|json|prometheus]',
  },
  'check': {
    description: 'Run diff-aware CI integrity checks',
    usage: 'librainian check [--diff HEAD~1..HEAD|<base-ref>|working-tree] [--format text|json|junit] [--out <path>]',
  },
  'heal': {
    description: 'Run homeostatic healing loop until healthy',
    usage: 'librainian heal [--max-cycles N] [--budget-tokens N] [--dry-run]',
  },
  'watch': {
    description: 'Watch for file changes and auto-reindex',
    usage: 'librainian watch [--debounce <ms>] [--quiet]',
  },
  'contract': {
    description: 'Show system contract and provenance',
    usage: 'librainian contract [--pretty]',
  },
  'diagnose': {
    description: 'Diagnose LiBrainian self-knowledge drift',
    usage: 'librainian diagnose [--pretty] [--config] [--heal] [--risk-tolerance safe|low|medium]',
  },
  'compose': {
    description: 'Compose construction pipelines or technique bundles from intent',
    usage: 'librainian compose "<intent>" [--mode constructions|techniques] [--limit N] [--include-primitives] [--pretty] [--timeout <ms>] [--verbose]',
  },
  'constructions': {
    description: 'List/search/describe/install/run/validate constructions',
    usage: 'librainian constructions list|search|describe|install|run|validate [options]',
  },
  'index': {
    description: 'Incrementally index specific files (no full bootstrap)',
    usage: 'librainian index --force <file...>|--incremental|--staged|--since <ref> [--verbose]',
  },
  'scan': {
    description: 'Scan/redaction audit reporting for sensitive content',
    usage: 'librainian scan --secrets [--json|--format text|json]',
  },
  'triage': {
    description: 'Assess and cluster dirty worktree state with safe recovery strategies',
    usage: 'librainian triage [--threshold N] [--json] [--auto|--stash|--revert --confirm]',
  },
  'update': {
    description: 'Hook-friendly alias for incremental indexing (implies --force)',
    usage: 'librainian update <file...>|--incremental|--staged|--since <ref> [--verbose]',
  },
  'analyze': {
    description: 'Run static analysis (dead code, complexity)',
    usage: 'librainian analyze --dead-code | --complexity [--format text|json]',
  },
  'config': {
    description: 'Configuration management (heal, diagnose)',
    usage: 'librainian config heal [--dry-run] [--diagnose-only] [--rollback] [--history]',
  },
  'doctor': {
    description: 'Run health diagnostics to identify issues',
    usage: 'librainian doctor [--verbose] [--json] [--heal] [--fix] [--check-consistency] [--install-grammars] [--risk-tolerance safe|low|medium]',
  },
  'publish-gate': {
    description: 'Run strict publish-readiness gate checks',
    usage: 'librainian publish-gate [--profile broad|release] [--gates-file <path>] [--status-file <path>] [--json]',
  },
  'external-repos': {
    description: 'Sync external repo corpus from manifest.json',
    usage: 'librainian external-repos sync [--repos-root <path>] [--max-repos N] [--json] [--verify]',
  },
  'memory-bridge': {
    description: 'Show memory bridge entry and state-file health',
    usage: 'librainian memory-bridge status|remember|add|search|update|delete [options]',
  },
  'test-integration': {
    description: 'Run quantitative integration test suites (currently OpenClaw)',
    usage: 'librainian test-integration --suite openclaw [--scenario all|cold-start|staleness|navigation|budget-gate|skill-audit|calibration] [--fixtures-root <path>] [--strict] [--json]',
  },
  'benchmark': {
    description: 'Run local performance SLA diagnostics',
    usage: 'librainian benchmark [--queries N] [--incremental-files N] [--json] [--out <path>] [--fail-on never|alert|block]',
  },
  'privacy-report': {
    description: 'Summarize privacy-audit events and external content transmission',
    usage: 'librainian privacy-report [--since <ISO-8601>] [--format text|json] [--out <path>]',
  },
  'export': {
    description: 'Export portable .librainian index state bundle',
    usage: 'librainian export [--output <bundle.tar.gz>] [--json] [--out <path>]',
  },
  'import': {
    description: 'Import portable .librainian index state bundle',
    usage: 'librainian import --input <bundle.tar.gz> [--json] [--out <path>]',
  },
  'features': {
    description: 'List dynamic LiBrainian feature registry and current status',
    usage: 'librainian features [--json] [--verbose] [--out <path>]',
  },
  'capabilities': {
    description: 'Emit machine-readable capability inventory for the public MCP surface',
    usage: 'librainian capabilities [--json] [--out <path>]',
  },
  'help': {
    description: 'Show help information',
    usage: 'librainian help [command]',
  },
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse global options
  const { values, positionals } = parseArgs({
    args,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      quiet: { type: 'boolean', short: 'q', default: false },
      ci: { type: 'boolean', default: false },
      'no-progress': { type: 'boolean', default: false },
      'no-color': { type: 'boolean', default: false },
      offline: { type: 'boolean', default: false },
      'no-telemetry': { type: 'boolean', default: false },
      'local-only': { type: 'boolean', default: false },
      workspace: { type: 'string', short: 'w', default: process.cwd() },
      verbose: { type: 'boolean', default: false },
      debug: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.version) {
    const { LIBRAINIAN_PACKAGE_VERSION } = await import('../index.js');
    console.log(`librainian ${LIBRAINIAN_PACKAGE_VERSION}`);
    return;
  }

  const command = positionals[0] as Command | undefined;
  let commandArgs = positionals.slice(1);
  const defaultWorkspace = values.workspace as string;
  const debug = values.debug as boolean;
  const verbose = (values.verbose as boolean) || debug;
  if (verbose || debug) {
    process.env.LIBRARIAN_VERBOSE = '1';
  }
  if (debug) {
    process.env.LIBRARIAN_DEBUG = '1';
  }

  if (values.help || !command || command === 'help') {
    const helpCommand = command === 'help'
      ? commandArgs[0]
      : (values.help && command && command in COMMANDS ? command : undefined);
    showHelp(helpCommand);
    return;
  }

  // Check for --json flag early for structured error output
  const jsonMode = hasJsonFlag(args);
  const runtimeMode = deriveCliRuntimeMode({ args, jsonMode });
  const restoreConsole = applyCliRuntimeMode(runtimeMode);
  // In JSON mode, stdout is reserved for machine-readable output. Silence logs by default
  // unless the caller explicitly set a log level.
  if (jsonMode && !process.env.LIBRARIAN_LOG_LEVEL) {
    process.env.LIBRARIAN_LOG_LEVEL = 'silent';
  }
  const defaultFormat = jsonMode ? 'json' : getFormatArg(args);
  const diagnoseFormat = jsonMode
    ? 'json'
    : (args.includes('--format') ? (getFormatArg(args) as 'text' | 'json') : undefined);

  const resolved = resolveWorkspaceArg({
    command,
    commandArgs,
    rawArgs: args,
    defaultWorkspace,
  });
  const workspace = resolved.workspace;
  commandArgs = resolved.commandArgs;

  if (!(command in COMMANDS) || !isCommandPubliclyAvailable(command)) {
    const envelope = createErrorEnvelope(
      'EINVALID_ARGUMENT',
      !(command in COMMANDS)
        ? `Unknown command: ${command}`
        : `Command unavailable in the public release surface: ${command}`,
      {
        recoveryHints: [
          `Run 'librainian help' for usage information`,
          `Available commands: ${getPublicCommandNames().join(', ')}`,
          ...(command in COMMANDS ? ['Maintainers can re-enable hidden commands with LIBRAINIAN_ENABLE_INTERNAL_COMMANDS=1.'] : []),
        ],
        context: { command },
      },
    );
    outputStructuredError(envelope, jsonMode, debug);
    process.exitCode = getExitCode(envelope);
    return;
  }

  if (command === 'init' && hasInitScaffoldingFlags(args) && !internalCommandsEnabled()) {
    const envelope = createErrorEnvelope(
      'EINVALID_ARGUMENT',
      'Init scaffolding flags are unavailable in the public release surface.',
      {
        recoveryHints: [
          'Run `librainian init` or `librainian quickstart` for the supported public onboarding flow.',
          'Maintainers can re-enable init scaffolding with LIBRAINIAN_ENABLE_INTERNAL_COMMANDS=1.',
        ],
        context: { command, flags: args.filter((arg) => arg.startsWith('--')) },
      },
    );
    outputStructuredError(envelope, jsonMode, debug);
    process.exitCode = getExitCode(envelope);
    return;
  }

  try {
    switch (command) {
      case 'status':
        process.exitCode = await statusCommand({
          workspace,
          verbose,
          format: defaultFormat as 'text' | 'json',
          out: getStringArg(args, '--out') ?? undefined,
          rawArgs: args,
        });
        break;
      case 'stats':
        {
          const { statsCommand } = await import('./commands/stats.js');
          await statsCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;
      case 'calibration':
        {
          const { calibrationCommand } = await import('./commands/calibration.js');
          await calibrationCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;

      case 'query':
        await queryCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'context':
        await contextCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'briefing':
        {
          const { briefingCommand } = await import('./commands/briefing.js');
          await briefingCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;
      case 'repo-map':
        await repoMapCommand({ workspace, args: commandArgs, rawArgs: args });
        break;

      case 'feedback':
        {
          const { feedbackCommand } = await import('./commands/feedback.js');
          await feedbackCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;

      case 'bootstrap':
        await bootstrapCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'embed':
        await embedCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'uninstall':
        await uninstallCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'mcp':
        await mcpCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'eject-docs':
        {
          const { ejectDocsCommand } = await import('./commands/eject_docs.js');
          await ejectDocsCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;
      case 'generate-docs':
        {
          const { generateDocsCommand } = await import('./commands/generate_docs.js');
          await generateDocsCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;

      case 'inspect':
        {
          const { inspectCommand } = await import('./commands/inspect.js');
          await inspectCommand({ workspace, args: commandArgs });
        }
        break;

      case 'confidence':
        {
          const { confidenceCommand } = await import('./commands/confidence.js');
          await confidenceCommand({ workspace, args: commandArgs });
        }
        break;

      case 'validate':
        {
          const { validateCommand } = await import('./commands/validate.js');
          await validateCommand({ workspace, args: commandArgs });
        }
        break;

      case 'check-providers':
        await checkProvidersCommand({
          workspace,
          format: defaultFormat as 'text' | 'json',
          out: getStringArg(args, '--out') ?? undefined,
          forceProbe: args.includes('--force-probe'),
        });
        break;
      case 'audit-skill':
        {
          const { auditSkillCommand } = await import('./commands/audit_skill.js');
          await auditSkillCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;

      case 'visualize':
        {
          const { visualizeCommand } = await import('./commands/visualize.js');
          await visualizeCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;
      case 'coverage':
        {
          const { coverageCommand } = await import('./commands/coverage.js');
          await coverageCommand({ workspace, args: commandArgs });
        }
        break;
      case 'quickstart':
      case 'setup':
        await quickstartCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'init':
        await initCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'smoke':
        {
          const { smokeCommand } = await import('./commands/smoke.js');
          await smokeCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;
      case 'journey':
        {
          const { journeyCommand } = await import('./commands/journey.js');
          await journeyCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;
      case 'live-fire':
        {
          const { liveFireCommand } = await import('./commands/live_fire.js');
          await liveFireCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;
      case 'health':
        {
          const { healthCommand } = await import('./commands/health.js');
          await healthCommand({
            workspace,
            verbose,
            format: getFormatArg(args) as 'text' | 'json' | 'prometheus',
            completeness: args.includes('--completeness'),
          });
        }
        break;
      case 'check':
        if ((commandArgs[0] ?? '').toLowerCase() === 'completeness') {
          const { checkCompletenessCommand } = await import('./commands/check_completeness.js');
          process.exitCode = await checkCompletenessCommand({
            workspace,
            args: commandArgs.slice(1),
            rawArgs: args,
          });
        } else {
          const { checkCommand } = await import('./commands/check.js');
          process.exitCode = await checkCommand({
            workspace,
            args: commandArgs,
            rawArgs: args,
          });
        }
        break;
      case 'heal':
        {
          const { healCommand } = await import('./commands/heal.js');
          await healCommand({
            workspace,
            verbose,
            maxCycles: getNumericArg(args, '--max-cycles'),
            budgetTokens: getNumericArg(args, '--budget-tokens'),
            dryRun: args.includes('--dry-run'),
          });
        }
        break;
      case 'watch':
        {
          const { watchCommand } = await import('./commands/watch.js');
          await watchCommand({
            workspace,
            debounceMs: getNumericArg(args, '--debounce'),
            quiet: args.includes('--quiet'),
          });
        }
        break;
      case 'contract':
        {
          const { contractCommand } = await import('./commands/contract.js');
          await contractCommand({
            workspace,
            pretty: args.includes('--pretty'),
          });
        }
        break;
      case 'diagnose':
        {
          const { diagnoseCommand } = await import('./commands/diagnose.js');
          const riskToleranceRaw = getStringArg(args, '--risk-tolerance');
          const riskTolerance = (riskToleranceRaw === 'safe' || riskToleranceRaw === 'low' || riskToleranceRaw === 'medium')
            ? riskToleranceRaw
            : undefined;
          await diagnoseCommand({
            workspace,
            pretty: args.includes('--pretty'),
            config: args.includes('--config'),
            heal: args.includes('--heal'),
            riskTolerance,
            format: diagnoseFormat,
          });
        }
        break;
      case 'compose':
        {
          const { composeCommand } = await import('./commands/compose.js');
          await composeCommand({
            workspace,
            args: commandArgs,
            rawArgs: args,
          });
        }
        break;
      case 'constructions':
        {
          const { constructionsCommand } = await import('./commands/constructions.js');
          await constructionsCommand({
            workspace,
            args: commandArgs,
            rawArgs: args,
          });
        }
        break;
      case 'index':
      case 'update':
        {
          const since = getStringArg(args, '--since');
          if (args.includes('--since') && !since) {
            throw new CliError('Missing value for --since <ref>.', 'INVALID_ARGUMENT');
          }
          const normalizedFiles = commandArgs.filter((arg) =>
            arg !== '--force'
            && arg !== '--incremental'
            && arg !== '--staged'
            && (!since || arg !== since)
          );

          await indexCommand({
            workspace,
            verbose,
            force: command === 'update' ? true : args.includes('--force'),
            files: normalizedFiles,
            incremental: args.includes('--incremental'),
            staged: args.includes('--staged'),
            since: since ?? undefined,
            allowLockSkip: command === 'update',
          });
        }
        break;
      case 'scan':
        {
          const { scanCommand } = await import('./commands/scan.js');
          await scanCommand({
            workspace,
            args: commandArgs,
            rawArgs: args,
          });
        }
        break;
      case 'triage':
        {
          const { triageCommand } = await import('./commands/triage.js');
          await triageCommand({
            workspace,
            args: commandArgs,
            rawArgs: args,
          });
        }
        break;
      case 'analyze':
        {
          const { analyzeCommand } = await import('./commands/analyze.js');
          await analyzeCommand({
            workspace,
            args: commandArgs,
            rawArgs: args,
          });
        }
        break;
      case 'config':
        // Sub-command handling for config
        if (commandArgs[0] === 'heal') {
          const { configHealCommand } = await import('./commands/config_heal.js');
          await configHealCommand({
            workspace,
            dryRun: args.includes('--dry-run'),
            verbose,
            riskTolerance: getStringArg(args, '--risk-tolerance') as 'safe' | 'low' | 'medium' | undefined ?? 'low',
            format: getFormatArg(args) as 'text' | 'json',
            diagnoseOnly: args.includes('--diagnose-only'),
            rollback: args.includes('--rollback'),
            showHistory: args.includes('--history'),
          });
        } else {
          throw new CliError('Unknown config subcommand. Use: librainian config heal.', 'INVALID_ARGUMENT');
        }
        break;
		      case 'doctor':
		        {
		          const riskToleranceRaw = getStringArg(args, '--risk-tolerance');
		          const riskTolerance = (riskToleranceRaw === 'safe' || riskToleranceRaw === 'low' || riskToleranceRaw === 'medium')
		            ? riskToleranceRaw
		            : undefined;
              const fix = args.includes('--fix');
		          await doctorCommand({
		            workspace,
		            verbose,
		            json: jsonMode,
		            heal: args.includes('--heal'),
                fix,
                checkConsistency: args.includes('--check-consistency'),
		            installGrammars: args.includes('--install-grammars'),
		            riskTolerance,
		          });
		        }
	        break;
      case 'publish-gate':
        {
          const { publishGateCommand } = await import('./commands/publish_gate.js');
          await publishGateCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;
	      case 'external-repos':
	        {
	          const { externalReposCommand } = await import('./commands/external_repos.js');
	          await externalReposCommand({ workspace, args: commandArgs, rawArgs: args });
	        }
	        break;
      case 'memory-bridge':
        {
          const { memoryBridgeCommand } = await import('./commands/memory_bridge.js');
          await memoryBridgeCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;
      case 'test-integration':
        {
          const { testIntegrationCommand } = await import('./commands/test_integration.js');
          await testIntegrationCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;
      case 'benchmark':
        {
          const { benchmarkCommand } = await import('./commands/benchmark.js');
          await benchmarkCommand({ workspace, args: commandArgs, rawArgs: args });
        }
        break;
      case 'privacy-report':
        {
          const { privacyReportCommand } = await import('./commands/privacy_report.js');
          process.exitCode = await privacyReportCommand({
            workspace,
            since: getStringArg(args, '--since') ?? undefined,
            format: defaultFormat as 'text' | 'json',
            out: getStringArg(args, '--out') ?? undefined,
          });
        }
        break;
      case 'export':
        await exportIndexStateCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'import':
        await importIndexStateCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'features':
        await featuresCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'capabilities':
        await capabilitiesCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
	    }
  } catch (error) {
    // Convert error to structured envelope for programmatic handling
    const envelope = classifyError(error);

    // Add command context to the error
    if (envelope.context) {
      envelope.context.command = command;
    }

    // Output error in appropriate format
    outputStructuredError(envelope, jsonMode, debug);

    // Set exit code based on error type
    process.exitCode = getExitCode(envelope);
  } finally {
    restoreConsole();
  }
}

function flushStream(stream: NodeJS.WriteStream): Promise<void> {
  if (stream.destroyed || !stream.writable) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    stream.write('', () => resolve());
  });
}

async function flushProcessOutput(): Promise<void> {
  await Promise.all([
    flushStream(process.stdout),
    flushStream(process.stderr),
  ]);
}

main()
  .catch((error) => {
    // Fatal errors also get structured output if possible
    const jsonMode = process.argv.includes('--json');
    const debug = process.argv.includes('--debug');
    const envelope = classifyError(error);
    outputStructuredError(envelope, jsonMode, debug);
    process.exitCode = getExitCode(envelope);
  })
  .finally(() => {
    const command = process.argv[2]?.toLowerCase() ?? '';
    const shouldForceExit = shouldForceCliExit(command);
    if (!shouldForceExit) return;
    setImmediate(() => {
      flushProcessOutput()
        .catch(() => undefined)
        .finally(() => {
          process.exit(process.exitCode ?? 0);
        });
    });
  });

// Helper functions for argument parsing

function getNumericArg(args: string[], flag: string): number | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  const value = parseInt(args[index + 1], 10);
  return isNaN(value) ? undefined : value;
}

function getStringArg(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

function getFormatArg(args: string[]): string {
  const index = args.indexOf('--format');
  if (index === -1 || index + 1 >= args.length) return 'text';
  return args[index + 1];
}
