#!/usr/bin/env node
/**
 * @fileoverview Librarian CLI - Developer Experience Interface
 *
 * Commands:
 *   librarian status              - Show current librarian status
 *   librarian query <intent>      - Run a query against the knowledge base
 *   librarian feedback <token>    - Submit outcome feedback for a prior query
 *   librarian bootstrap [--force] - Run bootstrap to initialize/refresh index
 *   librarian mcp                 - Start MCP stdio server / print client config
 *   librarian eject-docs          - Remove injected librarian docs from CLAUDE.md
 *   librarian index --force <...> - Incrementally index specific files or git-selected changes
 *   librarian inspect <module>    - Inspect a module's knowledge
 *   librarian confidence <entity> - Show confidence scores for an entity
 *   librarian validate <file>     - Validate constraints for a file
 *   librarian check-providers     - Check provider availability
 *   librarian visualize           - Generate codebase visualizations
 *   librarian quickstart          - Smooth onboarding and recovery flow
 *   librarian setup               - Quickstart alias (setup-oriented naming)
 *   librarian init                - Quickstart alias (init-oriented naming)
 *   librarian smoke               - Run external repo smoke harness
 *   librarian journey             - Run agentic journey simulations
 *   librarian live-fire           - Run continuous objective trial matrix
 *   librarian watch               - Watch for file changes and auto-reindex
 *   librarian contract            - Show system contract and provenance
 *   librarian diagnose            - Diagnose Librarian self-knowledge drift
 *   librarian health              - Show health status (EvolutionOps)
 *   librarian heal                - Run homeostatic healing loop
 *   librarian evolve              - Run evolutionary improvement loop
 *   librarian eval                - Produce FitnessReport.v1
 *   librarian replay              - Replay evolution cycle or variant
 *   librarian analyze             - Run static analysis (dead code, complexity)
 *   librarian config heal         - Auto-detect and fix suboptimal config
 *   librarian doctor              - Run health diagnostics to identify issues
 *   librarian publish-gate        - Run strict publish-readiness gate checks
 *
 * @packageDocumentation
 */

import { parseArgs } from 'node:util';
import { showHelp } from './help.js';
import { statusCommand } from './commands/status.js';
import { queryCommand } from './commands/query.js';
import { feedbackCommand } from './commands/feedback.js';
import { bootstrapCommand } from './commands/bootstrap.js';
import { mcpCommand } from './commands/mcp.js';
import { ejectDocsCommand } from './commands/eject_docs.js';
import { inspectCommand } from './commands/inspect.js';
import { confidenceCommand } from './commands/confidence.js';
import { validateCommand } from './commands/validate.js';
import { checkProvidersCommand } from './commands/check_providers.js';
import { visualizeCommand } from './commands/visualize.js';
import { coverageCommand } from './commands/coverage.js';
import { quickstartCommand } from './commands/quickstart.js';
import { smokeCommand } from './commands/smoke.js';
import { journeyCommand } from './commands/journey.js';
import { liveFireCommand } from './commands/live_fire.js';
import { healthCommand } from './commands/health.js';
import { healCommand } from './commands/heal.js';
import { evolveCommand } from './commands/evolve.js';
import { evalCommand } from './commands/eval.js';
import { replayCommand } from './commands/replay.js';
import { watchCommand } from './commands/watch.js';
import { indexCommand } from './commands/index.js';
import { contractCommand } from './commands/contract.js';
import { diagnoseCommand } from './commands/diagnose.js';
import { composeCommand } from './commands/compose.js';
import { analyzeCommand } from './commands/analyze.js';
import { configHealCommand } from './commands/config_heal.js';
import { doctorCommand } from './commands/doctor.js';
import { publishGateCommand } from './commands/publish_gate.js';
import { ralphCommand } from './commands/ralph.js';
import { externalReposCommand } from './commands/external_repos.js';
import { resolveWorkspaceArg } from './workspace_arg.js';
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

type Command = 'status' | 'query' | 'feedback' | 'bootstrap' | 'mcp' | 'eject-docs' | 'inspect' | 'confidence' | 'validate' | 'check-providers' | 'visualize' | 'coverage' | 'quickstart' | 'setup' | 'init' | 'smoke' | 'journey' | 'live-fire' | 'health' | 'heal' | 'evolve' | 'eval' | 'replay' | 'watch' | 'index' | 'contract' | 'diagnose' | 'compose' | 'analyze' | 'config' | 'doctor' | 'publish-gate' | 'ralph' | 'external-repos' | 'help';

/**
 * Check if --json flag is present in arguments
 */
function hasJsonFlag(args: string[]): boolean {
  return args.includes('--json');
}

/**
 * Output a structured error for agent consumption
 */
function outputStructuredError(envelope: ErrorEnvelope, useJson: boolean): void {
  if (useJson) {
    // JSON mode: output structured error
    console.error(formatErrorJson(envelope));
  } else {
    // Human mode: formatted error with hints
    console.error(formatErrorWithHints(envelope));
  }
}

const COMMANDS: Record<Command, { description: string; usage: string }> = {
  'status': {
    description: 'Show current librarian status',
    usage: 'librarian status [--verbose] [--format text|json] [--out <path>]',
  },
  'query': {
    description: 'Run a query against the knowledge base',
    usage: 'librarian query "<intent>" [--depth L0|L1|L2|L3] [--files <paths>] [--session new|<id>] [--drill-down <entity>] [--json] [--out <path>] [--no-bootstrap]',
  },
  'feedback': {
    description: 'Submit task outcome feedback for a prior query',
    usage: 'librarian feedback <feedbackToken> --outcome success|failure|partial [--missing-context "..."] [--json]',
  },
  'bootstrap': {
    description: 'Initialize or refresh the knowledge index',
    usage: 'librarian bootstrap [--force] [--force-resume] [--emit-baseline] [--install-grammars] [--no-claude-md]',
  },
  'mcp': {
    description: 'Start MCP stdio server or print client config snippets',
    usage: 'librarian mcp [--print-config] [--client claude|cursor|vscode|windsurf|gemini] [--launcher installed|npx] [--json]',
  },
  'eject-docs': {
    description: 'Remove injected librarian docs from CLAUDE.md files',
    usage: 'librarian eject-docs [--dry-run] [--json]',
  },
  'inspect': {
    description: 'Inspect a module or function\'s knowledge',
    usage: 'librarian inspect <path-or-name>',
  },
  'confidence': {
    description: 'Show confidence scores for an entity',
    usage: 'librarian confidence <entity-id>',
  },
  'validate': {
    description: 'Validate constraints for a file',
    usage: 'librarian validate <file-path>',
  },
  'check-providers': {
    description: 'Check provider availability and authentication',
    usage: 'librarian check-providers [--format text|json] [--out <path>]',
  },
  'visualize': {
    description: 'Generate codebase visualizations',
    usage: 'librarian visualize [--type dependency|call|tree|health] [--format ascii|mermaid] [--focus <path>]',
  },
  'coverage': {
    description: 'Generate UC x method x scenario coverage audit',
    usage: 'librarian coverage [--output <path>] [--strict]',
  },
  'quickstart': {
    description: 'Smooth onboarding and recovery flow',
    usage: 'librarian quickstart [--mode fast|full|--depth quick|full] [--risk-tolerance safe|low|medium] [--force] [--skip-baseline] [--ci] [--no-mcp]',
  },
  'setup': {
    description: 'Setup-oriented alias for quickstart onboarding',
    usage: 'librarian setup [--depth quick|full] [--ci] [--no-mcp] [--mode fast|full]',
  },
  'init': {
    description: 'Init-oriented alias for quickstart onboarding',
    usage: 'librarian init [--depth quick|full] [--ci] [--no-mcp] [--mode fast|full]',
  },
  'smoke': {
    description: 'Run external repo smoke harness',
    usage: 'librarian smoke [--repos-root <path>] [--max-repos N] [--repo a,b] [--timeout-ms N] [--artifacts-dir <path>] [--json]',
  },
  'journey': {
    description: 'Run agentic journey simulations',
    usage: 'librarian journey [--repos-root <path>] [--max-repos N] [--llm disabled|optional] [--deterministic] [--strict-objective] [--timeout-ms N] [--artifacts-dir <path>] [--json]',
  },
  'live-fire': {
    description: 'Run continuous objective trial matrix',
    usage: 'librarian live-fire [--profile <name>|--profiles <a,b>] [--matrix] [--profiles-file <path>] [--repos-root <path>] [--rounds N] [--llm-modes disabled,optional] [--strict-objective] [--include-smoke] [--json]',
  },
  'health': {
    description: 'Show current Librarian health status',
    usage: 'librarian health [--verbose] [--completeness] [--format text|json|prometheus]',
  },
  'heal': {
    description: 'Run homeostatic healing loop until healthy',
    usage: 'librarian heal [--max-cycles N] [--budget-tokens N] [--dry-run]',
  },
  'evolve': {
    description: 'Run evolutionary improvement loop',
    usage: 'librarian evolve [--cycles N] [--candidates N] [--dry-run]',
  },
  'eval': {
    description: 'Produce FitnessReport.v1 for current state',
    usage: 'librarian eval [--output <path>] [--save-baseline] [--stages 0-4]',
  },
  'replay': {
    description: 'Replay an evolution cycle or variant for analysis',
    usage: 'librarian replay <cycle-id|variant-id> [--verbose]',
  },
  'watch': {
    description: 'Watch for file changes and auto-reindex',
    usage: 'librarian watch [--debounce <ms>] [--quiet]',
  },
  'contract': {
    description: 'Show system contract and provenance',
    usage: 'librarian contract [--pretty]',
  },
  'diagnose': {
    description: 'Diagnose Librarian self-knowledge drift',
    usage: 'librarian diagnose [--pretty] [--config] [--heal] [--risk-tolerance safe|low|medium]',
  },
  'compose': {
    description: 'Compose construction pipelines or technique bundles from intent',
    usage: 'librarian compose "<intent>" [--mode constructions|techniques] [--limit N] [--include-primitives] [--pretty]',
  },
  'index': {
    description: 'Incrementally index specific files (no full bootstrap)',
    usage: 'librarian index --force <file...>|--incremental|--staged|--since <ref> [--verbose]',
  },
  'analyze': {
    description: 'Run static analysis (dead code, complexity)',
    usage: 'librarian analyze --dead-code | --complexity [--format text|json]',
  },
  'config': {
    description: 'Configuration management (heal, diagnose)',
    usage: 'librarian config heal [--dry-run] [--diagnose-only] [--rollback] [--history]',
  },
  'doctor': {
    description: 'Run health diagnostics to identify issues',
    usage: 'librarian doctor [--verbose] [--json] [--heal] [--fix] [--install-grammars] [--risk-tolerance safe|low|medium]',
  },
  'publish-gate': {
    description: 'Run strict publish-readiness gate checks',
    usage: 'librarian publish-gate [--profile broad|release] [--gates-file <path>] [--status-file <path>] [--json]',
  },
  'ralph': {
    description: 'Run DETECT->FIX->VERIFY loop and write an audit report',
    usage: 'librarian ralph [--mode fast|full] [--max-cycles N] [--json] [--output <path>] [--skip-eval]',
  },
  'external-repos': {
    description: 'Sync external repo corpus from manifest.json',
    usage: 'librarian external-repos sync [--repos-root <path>] [--max-repos N] [--json] [--verify]',
  },
  'help': {
    description: 'Show help information',
    usage: 'librarian help [command]',
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
      workspace: { type: 'string', short: 'w', default: process.cwd() },
      verbose: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.version) {
    const { LIBRARIAN_VERSION } = await import('../index.js');
    console.log(`librarian ${LIBRARIAN_VERSION.string}`);
    return;
  }

  const command = positionals[0] as Command | undefined;
  let commandArgs = positionals.slice(1);
  const defaultWorkspace = values.workspace as string;
  const verbose = values.verbose as boolean;
  if (verbose) {
    process.env.LIBRARIAN_VERBOSE = '1';
  }

  if (values.help || !command || command === 'help') {
    const helpCommand = command === 'help' ? commandArgs[0] : undefined;
    showHelp(helpCommand);
    return;
  }

  // Check for --json flag early for structured error output
  const jsonMode = hasJsonFlag(args);
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

  if (!(command in COMMANDS)) {
    const envelope = createErrorEnvelope(
      'EINVALID_ARGUMENT',
      `Unknown command: ${command}`,
      {
        recoveryHints: [
          `Run 'librarian help' for usage information`,
          `Available commands: ${Object.keys(COMMANDS).join(', ')}`,
        ],
        context: { command },
      },
    );
    outputStructuredError(envelope, jsonMode);
    process.exitCode = getExitCode(envelope);
    return;
  }

  try {
    switch (command) {
      case 'status':
        await statusCommand({
          workspace,
          verbose,
          format: defaultFormat as 'text' | 'json',
          out: getStringArg(args, '--out') ?? undefined,
        });
        break;

      case 'query':
        await queryCommand({ workspace, args: commandArgs, rawArgs: args });
        break;

      case 'feedback':
        await feedbackCommand({ workspace, args: commandArgs, rawArgs: args });
        break;

      case 'bootstrap':
        await bootstrapCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'mcp':
        await mcpCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'eject-docs':
        await ejectDocsCommand({ workspace, args: commandArgs, rawArgs: args });
        break;

      case 'inspect':
        await inspectCommand({ workspace, args: commandArgs });
        break;

      case 'confidence':
        await confidenceCommand({ workspace, args: commandArgs });
        break;

      case 'validate':
        await validateCommand({ workspace, args: commandArgs });
        break;

      case 'check-providers':
        await checkProvidersCommand({
          workspace,
          format: defaultFormat as 'text' | 'json',
          out: getStringArg(args, '--out') ?? undefined,
        });
        break;

      case 'visualize':
        await visualizeCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'coverage':
        await coverageCommand({ workspace, args: commandArgs });
        break;
      case 'quickstart':
      case 'setup':
      case 'init':
        await quickstartCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'smoke':
        await smokeCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'journey':
        await journeyCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'live-fire':
        await liveFireCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
      case 'health':
        await healthCommand({
          workspace,
          verbose,
          format: getFormatArg(args) as 'text' | 'json' | 'prometheus',
          completeness: args.includes('--completeness'),
        });
        break;
      case 'heal':
        await healCommand({
          workspace,
          verbose,
          maxCycles: getNumericArg(args, '--max-cycles'),
          budgetTokens: getNumericArg(args, '--budget-tokens'),
          dryRun: args.includes('--dry-run'),
        });
        break;
      case 'evolve':
        await evolveCommand({
          workspace,
          verbose,
          cycles: getNumericArg(args, '--cycles'),
          candidates: getNumericArg(args, '--candidates'),
          dryRun: args.includes('--dry-run'),
          format: getFormatArg(args) as 'text' | 'json',
        });
        break;
      case 'eval':
        await evalCommand({
          workspace,
          verbose,
          output: getStringArg(args, '--output'),
          saveBaseline: args.includes('--save-baseline'),
          stages: getStringArg(args, '--stages') ?? '0-4',
          format: getFormatArg(args) as 'text' | 'json',
        });
        break;
      case 'replay':
        await replayCommand({
          workspace,
          target: commandArgs[0] ?? '',
          verbose,
          format: getFormatArg(args) as 'text' | 'json',
        });
        break;
      case 'watch':
        await watchCommand({
          workspace,
          debounceMs: getNumericArg(args, '--debounce'),
          quiet: args.includes('--quiet'),
        });
        break;
      case 'contract':
        await contractCommand({
          workspace,
          pretty: args.includes('--pretty'),
        });
        break;
      case 'diagnose':
        {
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
        await composeCommand({
          workspace,
          args: commandArgs,
          rawArgs: args,
        });
        break;
      case 'index':
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
            force: args.includes('--force'),
            files: normalizedFiles,
            incremental: args.includes('--incremental'),
            staged: args.includes('--staged'),
            since: since ?? undefined,
          });
        }
        break;
      case 'analyze':
        await analyzeCommand({
          workspace,
          args: commandArgs,
          rawArgs: args,
        });
        break;
      case 'config':
        // Sub-command handling for config
        if (commandArgs[0] === 'heal') {
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
          console.error('Unknown config subcommand. Use: librarian config heal');
          process.exitCode = 1;
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
		            installGrammars: args.includes('--install-grammars'),
		            riskTolerance,
		          });
		        }
	        break;
      case 'publish-gate':
        await publishGateCommand({ workspace, args: commandArgs, rawArgs: args });
        break;
	      case 'ralph':
	        await ralphCommand({ workspace, args: commandArgs, rawArgs: args });
	        break;
	      case 'external-repos':
	        await externalReposCommand({ workspace, args: commandArgs, rawArgs: args });
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
    outputStructuredError(envelope, jsonMode);

    // Set exit code based on error type
    process.exitCode = getExitCode(envelope);
  }
}

const CLI_NON_EXITING_COMMANDS = new Set(['watch', 'mcp']);

main()
  .catch((error) => {
    // Fatal errors also get structured output if possible
    const jsonMode = process.argv.includes('--json');
    const envelope = classifyError(error);
    outputStructuredError(envelope, jsonMode);
    process.exitCode = getExitCode(envelope);
  })
  .finally(() => {
    const command = process.argv[2]?.toLowerCase() ?? '';
    const shouldForceExit = !CLI_NON_EXITING_COMMANDS.has(command);
    if (!shouldForceExit) return;
    setImmediate(() => {
      process.exit(process.exitCode ?? 0);
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
