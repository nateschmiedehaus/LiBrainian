import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createError } from '../errors.js';

export type InitEditorClient = 'vscode' | 'cursor' | 'continue' | 'claude' | 'jetbrains' | 'windsurf';

type ConfigTargetFormat = 'json_vscode_workspace' | 'json_vscode_global' | 'json_mcp_servers' | 'yaml_continue' | 'xml_jetbrains';

type ActionStatus = 'written' | 'would_write' | 'already_configured' | 'skipped' | 'error';

interface ConfigTarget {
  editor: InitEditorClient;
  configPath: string;
  format: ConfigTargetFormat;
}

export interface EditorMcpAction {
  editor: InitEditorClient;
  path: string;
  status: ActionStatus;
  reason?: string;
  diff?: string;
}

export interface ConfigureEditorMcpForInitOptions {
  workspace: string;
  editor?: string;
  dryRun?: boolean;
  globalConfig?: boolean;
}

export interface ConfigureEditorMcpForInitReport {
  dryRun: boolean;
  globalConfig: boolean;
  selectedEditors: InitEditorClient[];
  detectedEditors: InitEditorClient[];
  actions: EditorMcpAction[];
  written: number;
  wouldWrite: number;
  alreadyConfigured: number;
  skipped: number;
  errors: number;
  warnings: string[];
  nextSteps: string[];
}

interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const SUPPORTED_EDITORS: InitEditorClient[] = ['vscode', 'cursor', 'continue', 'claude', 'jetbrains', 'windsurf'];
const SERVER_NAMES = ['librainian', 'librarian'];
const PRIMARY_SERVER_NAME = 'librainian';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function makeServerEntry(workspace: string): McpServerEntry {
  return {
    command: 'npx',
    args: ['-y', 'librainian', 'mcp', '--stdio'],
    env: {
      LIBRARIAN_WORKSPACE: workspace,
    },
  };
}

function buildDiff(before: string | null, after: string): string {
  const normalize = (input: string): string[] => input.replace(/\r\n/g, '\n').split('\n');
  const afterLines = normalize(after);

  if (before === null) {
    return afterLines
      .filter((line) => line.length > 0)
      .map((line) => `+ ${line}`)
      .join('\n');
  }

  if (before === after) return '';

  const beforeLines = normalize(before);
  return [
    '--- existing',
    ...beforeLines.filter((line) => line.length > 0).map((line) => `- ${line}`),
    '+++ updated',
    ...afterLines.filter((line) => line.length > 0).map((line) => `+ ${line}`),
  ].join('\n');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function commandExists(command: string): boolean {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookup, [command], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

function listContainsServerKey(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  return Object.keys(record).some((key) => {
    const normalized = key.toLowerCase();
    return SERVER_NAMES.some((name) => normalized.includes(name));
  });
}

function hasAnyRegisteredServer(config: Record<string, unknown>): boolean {
  if (listContainsServerKey(config.mcpServers)) return true;
  if (listContainsServerKey(config.servers)) return true;

  const mcp = asRecord(config.mcp);
  if (mcp && listContainsServerKey(mcp.servers)) return true;

  return false;
}

function getOrCreateObject(parent: Record<string, unknown>, key: string, pathLabel: string): Record<string, unknown> {
  const existing = parent[key];
  if (existing === undefined) {
    const created: Record<string, unknown> = {};
    parent[key] = created;
    return created;
  }

  const record = asRecord(existing);
  if (!record) {
    throw new Error(`Cannot configure ${pathLabel}: expected "${key}" to be an object.`);
  }
  return record;
}

function applyJsonConfig(
  format: ConfigTargetFormat,
  config: Record<string, unknown>,
  entry: McpServerEntry,
): void {
  if (format === 'json_vscode_workspace') {
    const servers = getOrCreateObject(config, 'servers', '.vscode/mcp.json');
    servers[PRIMARY_SERVER_NAME] = entry;
    return;
  }

  if (format === 'json_vscode_global') {
    const mcp = getOrCreateObject(config, 'mcp', 'VSCode user settings');
    const servers = getOrCreateObject(mcp, 'servers', 'VSCode user settings');
    servers[PRIMARY_SERVER_NAME] = entry;
    config['chat.mcp.discovery.enabled'] = true;
    return;
  }

  if (format === 'json_mcp_servers') {
    const mcpServers = getOrCreateObject(config, 'mcpServers', 'MCP settings');
    mcpServers[PRIMARY_SERVER_NAME] = entry;
    return;
  }

  throw new Error(`Unsupported JSON target format: ${format}`);
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function renderContinueYaml(entry: McpServerEntry): string {
  const args = entry.args.map((arg) => `      - ${arg}`).join('\n');
  return [
    'mcpServers:',
    `  ${PRIMARY_SERVER_NAME}:`,
    `    command: ${entry.command}`,
    '    args:',
    args,
    '    env:',
    `      LIBRARIAN_WORKSPACE: "${escapeYamlString(entry.env.LIBRARIAN_WORKSPACE ?? '')}"`,
    '',
  ].join('\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderJetBrainsServer(entry: McpServerEntry): string {
  return [
    '  <component name="McpServers">',
    `    <server name="${PRIMARY_SERVER_NAME}" command="${escapeXml(entry.command)}" args="${escapeXml(entry.args.join(' '))}">`,
    `      <env name="LIBRARIAN_WORKSPACE" value="${escapeXml(entry.env.LIBRARIAN_WORKSPACE ?? '')}" />`,
    '    </server>',
    '  </component>',
  ].join('\n');
}

function hasServerReference(raw: string): boolean {
  const normalized = raw.toLowerCase();
  return SERVER_NAMES.some((name) => normalized.includes(name));
}

function mergeJetBrainsXml(raw: string, entry: McpServerEntry): string {
  const normalized = raw.replace(/\r\n/g, '\n');
  const serverBlock = renderJetBrainsServer(entry);

  if (normalized.trim().length === 0) {
    return ['<application>', serverBlock, '</application>', ''].join('\n');
  }

  if (/<component\s+name=["']McpServers["'][^>]*>/i.test(normalized)) {
    return normalized.replace(
      /(<component\s+name=["']McpServers["'][^>]*>)([\s\S]*?)(<\/component>)/i,
      (_match, start: string, body: string, end: string) => {
        const insertion = [
          start,
          body.trimEnd(),
          body.trim().length > 0 ? '' : '    ',
          `    <server name="${PRIMARY_SERVER_NAME}" command="${escapeXml(entry.command)}" args="${escapeXml(entry.args.join(' '))}">`,
          `      <env name="LIBRARIAN_WORKSPACE" value="${escapeXml(entry.env.LIBRARIAN_WORKSPACE ?? '')}" />`,
          '    </server>',
          end,
        ];
        return insertion.join('\n').replace(/\n{3,}/g, '\n\n');
      },
    );
  }

  if (normalized.includes('</application>')) {
    return normalized.replace('</application>', `${serverBlock}\n</application>`);
  }

  return `${normalized.trimEnd()}\n${serverBlock}\n`;
}

function resolveVsCodeGlobalSettingsPath(home: string): string {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'Code', 'User', 'settings.json');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
  }
  return path.join(home, '.config', 'Code', 'User', 'settings.json');
}

function resolveClaudeDesktopConfigPath(home: string): string {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

function resolveJetBrainsRoots(home: string): string[] {
  const roots = [
    path.join(home, '.config', 'JetBrains'),
    path.join(home, 'Library', 'Application Support', 'JetBrains'),
  ];

  if (process.env.APPDATA) {
    roots.push(path.join(process.env.APPDATA, 'JetBrains'));
  }

  return Array.from(new Set(roots));
}

async function listJetBrainsProducts(home: string): Promise<string[]> {
  const productDirs: string[] = [];
  for (const root of resolveJetBrainsRoots(home)) {
    if (!existsSync(root)) continue;

    const rootOptionsDir = path.join(root, 'options');
    if (existsSync(rootOptionsDir)) {
      productDirs.push(root);
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      productDirs.push(path.join(root, entry.name));
    }
  }

  return Array.from(new Set(productDirs));
}

async function detectEditors(workspace: string, home: string): Promise<InitEditorClient[]> {
  const detected = new Set<InitEditorClient>();

  if (await pathExists(path.join(workspace, '.vscode')) || commandExists('code')) {
    detected.add('vscode');
  }

  if (await pathExists(path.join(workspace, '.cursor')) || await pathExists(path.join(home, '.cursor'))) {
    detected.add('cursor');
  }

  if (await pathExists(path.join(workspace, '.continue')) || await pathExists(path.join(home, '.continue'))) {
    detected.add('continue');
  }

  const claudeConfig = resolveClaudeDesktopConfigPath(home);
  if (await pathExists(claudeConfig) || await pathExists(path.dirname(claudeConfig))) {
    detected.add('claude');
  }

  if ((await listJetBrainsProducts(home)).length > 0) {
    detected.add('jetbrains');
  }

  const windsurfPath = path.join(home, '.windsurf', 'mcp.json');
  if (await pathExists(windsurfPath) || await pathExists(path.dirname(windsurfPath))) {
    detected.add('windsurf');
  }

  return SUPPORTED_EDITORS.filter((editor) => detected.has(editor));
}

function parseEditorSelection(raw: string | undefined): InitEditorClient[] | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0 || normalized === 'all') {
    return [...SUPPORTED_EDITORS];
  }

  const values = normalized.split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) {
    return [...SUPPORTED_EDITORS];
  }

  const unique = new Set<InitEditorClient>();
  for (const value of values) {
    if (!SUPPORTED_EDITORS.includes(value as InitEditorClient)) {
      throw createError(
        'INVALID_ARGUMENT',
        `Unknown editor "${value}". Use one of: ${SUPPORTED_EDITORS.join(', ')}, all.`,
      );
    }
    unique.add(value as InitEditorClient);
  }

  return Array.from(unique);
}

function fallbackJetBrainsPath(home: string): string {
  const root = resolveJetBrainsRoots(home)[0] ?? path.join(home, '.config', 'JetBrains');
  return path.join(root, 'IntelliJIdea', 'options', 'mcp.xml');
}

async function resolveTargets(options: {
  editor: InitEditorClient;
  workspace: string;
  home: string;
  globalConfig: boolean;
  explicitSelection: boolean;
}): Promise<ConfigTarget[]> {
  const { editor, workspace, home, globalConfig, explicitSelection } = options;

  if (editor === 'vscode') {
    return [{
      editor,
      configPath: globalConfig
        ? resolveVsCodeGlobalSettingsPath(home)
        : path.join(workspace, '.vscode', 'mcp.json'),
      format: globalConfig ? 'json_vscode_global' : 'json_vscode_workspace',
    }];
  }

  if (editor === 'cursor') {
    return [{
      editor,
      configPath: globalConfig
        ? path.join(home, '.cursor', 'mcp.json')
        : path.join(workspace, '.cursor', 'mcp.json'),
      format: 'json_mcp_servers',
    }];
  }

  if (editor === 'continue') {
    return [{
      editor,
      configPath: globalConfig
        ? path.join(home, '.continue', 'mcpServers', 'librainian.yaml')
        : path.join(workspace, '.continue', 'mcpServers', 'librainian.yaml'),
      format: 'yaml_continue',
    }];
  }

  if (editor === 'claude') {
    return [{
      editor,
      configPath: resolveClaudeDesktopConfigPath(home),
      format: 'json_mcp_servers',
    }];
  }

  if (editor === 'windsurf') {
    return [{
      editor,
      configPath: path.join(home, '.windsurf', 'mcp.json'),
      format: 'json_mcp_servers',
    }];
  }

  const products = await listJetBrainsProducts(home);
  if (products.length === 0) {
    if (!explicitSelection) return [];
    return [{
      editor,
      configPath: fallbackJetBrainsPath(home),
      format: 'xml_jetbrains',
    }];
  }

  return products.map((productDir) => ({
    editor,
    configPath: path.join(productDir, 'options', 'mcp.xml'),
    format: 'xml_jetbrains',
  }));
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function writeFileIfNeeded(filePath: string, content: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function applyJsonTarget(
  target: ConfigTarget,
  entry: McpServerEntry,
  dryRun: boolean,
): Promise<EditorMcpAction> {
  const previousRaw = await readOptionalText(target.configPath);
  let parsed: Record<string, unknown> = {};

  if (previousRaw && previousRaw.trim().length > 0) {
    try {
      const value = JSON.parse(previousRaw);
      const asObj = asRecord(value);
      if (!asObj) {
        return {
          editor: target.editor,
          path: target.configPath,
          status: 'error',
          reason: 'Existing config root is not an object; refusing to overwrite.',
        };
      }
      parsed = asObj;
    } catch {
      return {
        editor: target.editor,
        path: target.configPath,
        status: 'error',
        reason: 'Existing config is invalid JSON; refusing to overwrite.',
      };
    }
  }

  if (hasAnyRegisteredServer(parsed)) {
    return {
      editor: target.editor,
      path: target.configPath,
      status: 'already_configured',
    };
  }

  try {
    applyJsonConfig(target.format, parsed, entry);
  } catch (error) {
    return {
      editor: target.editor,
      path: target.configPath,
      status: 'error',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const nextRaw = `${JSON.stringify(parsed, null, 2)}\n`;
  await writeFileIfNeeded(target.configPath, nextRaw, dryRun);

  return {
    editor: target.editor,
    path: target.configPath,
    status: dryRun ? 'would_write' : 'written',
    diff: buildDiff(previousRaw, nextRaw),
  };
}

async function applyContinueYamlTarget(
  target: ConfigTarget,
  entry: McpServerEntry,
  dryRun: boolean,
): Promise<EditorMcpAction> {
  const previousRaw = await readOptionalText(target.configPath);
  if (previousRaw && hasServerReference(previousRaw)) {
    return {
      editor: target.editor,
      path: target.configPath,
      status: 'already_configured',
    };
  }

  if (previousRaw && previousRaw.trim().length > 0) {
    return {
      editor: target.editor,
      path: target.configPath,
      status: 'error',
      reason: 'Existing Continue MCP file is non-empty and unrecognized; refusing to overwrite.',
    };
  }

  const nextRaw = renderContinueYaml(entry);
  await writeFileIfNeeded(target.configPath, nextRaw, dryRun);

  return {
    editor: target.editor,
    path: target.configPath,
    status: dryRun ? 'would_write' : 'written',
    diff: buildDiff(previousRaw, nextRaw),
  };
}

async function applyJetBrainsXmlTarget(
  target: ConfigTarget,
  entry: McpServerEntry,
  dryRun: boolean,
): Promise<EditorMcpAction> {
  const previousRaw = await readOptionalText(target.configPath);
  if (previousRaw && hasServerReference(previousRaw)) {
    return {
      editor: target.editor,
      path: target.configPath,
      status: 'already_configured',
    };
  }

  const nextRaw = mergeJetBrainsXml(previousRaw ?? '', entry);
  await writeFileIfNeeded(target.configPath, nextRaw, dryRun);

  return {
    editor: target.editor,
    path: target.configPath,
    status: dryRun ? 'would_write' : 'written',
    diff: buildDiff(previousRaw, nextRaw),
  };
}

async function applyTarget(
  target: ConfigTarget,
  entry: McpServerEntry,
  dryRun: boolean,
): Promise<EditorMcpAction> {
  if (
    target.format === 'json_vscode_workspace'
    || target.format === 'json_vscode_global'
    || target.format === 'json_mcp_servers'
  ) {
    return applyJsonTarget(target, entry, dryRun);
  }

  if (target.format === 'yaml_continue') {
    return applyContinueYamlTarget(target, entry, dryRun);
  }

  return applyJetBrainsXmlTarget(target, entry, dryRun);
}

function nextStepFor(editor: InitEditorClient): string {
  switch (editor) {
    case 'vscode':
      return 'VSCode: restart the editor, open Copilot Chat, and verify @librainian appears.';
    case 'cursor':
      return 'Cursor: restart Cursor and verify the MCP server list includes librainian.';
    case 'continue':
      return 'Continue.dev: reload the extension and verify the librainian MCP server is available.';
    case 'claude':
      return 'Claude Desktop: restart Claude Desktop to load the updated MCP config.';
    case 'jetbrains':
      return 'JetBrains: restart IDEs and confirm Tools > AI Assistant > MCP Servers shows librainian.';
    case 'windsurf':
      return 'Windsurf: restart Windsurf and confirm librainian is listed in MCP settings.';
  }
}

export async function configureEditorMcpForInit(
  options: ConfigureEditorMcpForInitOptions,
): Promise<ConfigureEditorMcpForInitReport> {
  const workspace = path.resolve(options.workspace);
  const home = os.homedir();
  const dryRun = Boolean(options.dryRun);
  const globalConfig = Boolean(options.globalConfig);
  const explicitSelection = parseEditorSelection(options.editor);
  const detectedEditors = await detectEditors(workspace, home);
  const selectedEditors = explicitSelection ?? detectedEditors;

  const entry = makeServerEntry(workspace);
  const actions: EditorMcpAction[] = [];

  if (selectedEditors.length === 0) {
    actions.push({
      editor: 'vscode',
      path: workspace,
      status: 'skipped',
      reason: 'No supported editors were detected. Use --editor to target one explicitly.',
    });
  }

  for (const editor of selectedEditors) {
    const targets = await resolveTargets({
      editor,
      workspace,
      home,
      globalConfig,
      explicitSelection: explicitSelection !== null,
    });

    if (targets.length === 0) {
      actions.push({
        editor,
        path: workspace,
        status: 'skipped',
        reason: 'No install/config path detected for this editor.',
      });
      continue;
    }

    for (const target of targets) {
      actions.push(await applyTarget(target, entry, dryRun));
    }
  }

  const written = actions.filter((action) => action.status === 'written').length;
  const wouldWrite = actions.filter((action) => action.status === 'would_write').length;
  const alreadyConfigured = actions.filter((action) => action.status === 'already_configured').length;
  const skipped = actions.filter((action) => action.status === 'skipped').length;
  const errors = actions.filter((action) => action.status === 'error').length;

  const warnings = actions
    .filter((action) => action.status === 'error' || action.status === 'skipped')
    .map((action) => `${action.editor}: ${action.reason ?? action.status}`);

  const nextSteps = Array.from(new Set(
    actions
      .filter((action) => action.status === 'written' || action.status === 'would_write' || action.status === 'already_configured')
      .map((action) => nextStepFor(action.editor)),
  ));

  return {
    dryRun,
    globalConfig,
    selectedEditors,
    detectedEditors,
    actions,
    written,
    wouldWrite,
    alreadyConfigured,
    skipped,
    errors,
    warnings,
    nextSteps,
  };
}
