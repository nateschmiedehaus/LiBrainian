import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { runInNewContext } from 'node:vm';
import { CliError } from '../errors.js';
import { OPENCLAW_SKILL_MARKDOWN } from '../../connectors/openclaw_skill_template.js';
import {
  OPENCLAW_REQUIRED_TOOL_NAMES,
  getOpenclawToolRegistryStatus,
} from '../../mcp/openclaw_tools.js';
import { createLibrarianMCPServer } from '../../mcp/server.js';

export interface InstallOpenclawSkillCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

interface InstallOpenclawSkillReport {
  success: boolean;
  dryRun: boolean;
  openclawRoot: string;
  skillPath: string;
  configPath: string;
  requiredTools: string[];
  missingTools: string[];
  mcpReachable: boolean;
  testInvocation: string;
  warnings: string[];
}

function resolveOpenclawRoot(raw: string | undefined): string {
  const home = os.homedir();
  const value = raw?.trim();
  if (!value) {
    return path.join(home, '.openclaw');
  }
  if (value === '~') {
    return home;
  }
  if (value.startsWith('~/')) {
    return path.join(home, value.slice(2));
  }
  return path.resolve(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseJson5LikeObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return {};
  const evaluated = runInNewContext(`(${trimmed})`, Object.create(null), { timeout: 500 });
  if (!evaluated || typeof evaluated !== 'object' || Array.isArray(evaluated)) {
    throw new Error('OpenClaw config root must be an object');
  }
  return JSON.parse(JSON.stringify(evaluated)) as Record<string, unknown>;
}

async function readOpenclawConfig(configPath: string): Promise<Record<string, unknown>> {
  if (!existsSync(configPath)) return {};
  const raw = await fs.readFile(configPath, 'utf8');
  try {
    return parseJson5LikeObject(raw);
  } catch (error) {
    throw new CliError(
      `Failed to parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      'INVALID_ARGUMENT',
    );
  }
}

function mergeOpenclawConfig(current: Record<string, unknown>): Record<string, unknown> {
  const next = { ...current };
  const skills = { ...asRecord(next.skills) };
  const entries = { ...asRecord(skills.entries) };
  const librainianEntry = { ...asRecord(entries.librainian) };
  const entryConfig = { ...asRecord(librainianEntry.config) };
  const toolNames = [...OPENCLAW_REQUIRED_TOOL_NAMES];

  entries.librainian = {
    ...librainianEntry,
    enabled: true,
    config: {
      ...entryConfig,
      mcpServer: 'librainian',
      mcpCommand: 'librarian mcp --stdio',
      mcpTools: toolNames,
      installSource: 'librainian install-openclaw-skill',
    },
  };

  skills.entries = entries;
  next.skills = skills;
  return next;
}

async function verifyMcpReachability(): Promise<boolean> {
  try {
    const server = await createLibrarianMCPServer({
      authorization: {
        enabledScopes: ['read', 'write'],
        requireConsent: false,
      },
    });
    const tools = ((server as unknown as { getAvailableTools?: () => Array<{ name: string }> }).getAvailableTools?.() ?? [])
      .map((tool) => tool.name);
    return OPENCLAW_REQUIRED_TOOL_NAMES.every((name) => tools.includes(name));
  } catch {
    return false;
  }
}

export async function installOpenclawSkillCommand(
  options: InstallOpenclawSkillCommandOptions,
): Promise<void> {
  const { values } = parseArgs({
    args: options.rawArgs.slice(1),
    options: {
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'openclaw-root': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const dryRun = Boolean(values['dry-run']);
  const json = Boolean(values.json);
  const openclawRoot = resolveOpenclawRoot(
    typeof values['openclaw-root'] === 'string' ? values['openclaw-root'] : undefined,
  );
  const skillPath = path.join(openclawRoot, 'skills', 'librainian', 'SKILL.md');
  const configPath = path.join(openclawRoot, 'openclaw.json');

  const registry = getOpenclawToolRegistryStatus();
  if (registry.missing.length > 0) {
    throw new CliError(
      `Cannot install OpenClaw skill because required MCP tools are missing: ${registry.missing.join(', ')}`,
      'STORAGE_ERROR',
    );
  }

  const mcpReachable = await verifyMcpReachability();
  const warnings: string[] = [];
  if (!mcpReachable) {
    warnings.push('MCP server reachability check failed; schema-level tool registration still passed.');
  }

  const mergedConfig = mergeOpenclawConfig(await readOpenclawConfig(configPath));

  if (!dryRun) {
    await fs.mkdir(path.dirname(skillPath), { recursive: true });
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(skillPath, OPENCLAW_SKILL_MARKDOWN, 'utf8');
    await fs.writeFile(configPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf8');
  }

  const report: InstallOpenclawSkillReport = {
    success: true,
    dryRun,
    openclawRoot,
    skillPath,
    configPath,
    requiredTools: [...OPENCLAW_REQUIRED_TOOL_NAMES],
    missingTools: [],
    mcpReachable,
    testInvocation: 'openclaw send "Use the librainian skill and start with get_context_pack for: investigate auth logout bug"',
    warnings,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('OpenClaw Skill Installation');
  console.log('===========================\n');
  console.log(`Mode: ${dryRun ? 'dry-run' : 'apply'}`);
  console.log(`OpenClaw root: ${openclawRoot}`);
  console.log(`Skill path: ${skillPath}`);
  console.log(`Config path: ${configPath}`);
  console.log(`Required MCP tools: ${OPENCLAW_REQUIRED_TOOL_NAMES.length}`);
  console.log(`MCP reachable: ${mcpReachable ? 'yes' : 'no'}`);
  if (warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
  }
  console.log('\nTest invocation:');
  console.log(`  ${report.testInvocation}`);
}
