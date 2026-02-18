import { startStdioServer } from '../../mcp/server.js';

type McpClient = 'claude' | 'cursor' | 'vscode' | 'windsurf' | 'gemini';
type LauncherMode = 'installed' | 'npx';

interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface McpConfigBundle {
  client: McpClient;
  configPath: string;
  snippet: Record<string, unknown>;
}

export interface McpCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

function resolveLauncher(rawArgs: string[]): LauncherMode {
  const index = rawArgs.indexOf('--launcher');
  const value = index >= 0 ? rawArgs[index + 1] : undefined;
  return value === 'npx' ? 'npx' : 'installed';
}

function resolveClient(rawArgs: string[]): McpClient | 'all' {
  const index = rawArgs.indexOf('--client');
  const value = index >= 0 ? rawArgs[index + 1] : undefined;
  if (value === 'claude' || value === 'cursor' || value === 'vscode' || value === 'windsurf' || value === 'gemini') {
    return value;
  }
  return 'all';
}

function buildServerEntry(workspace: string, launcher: LauncherMode): McpServerEntry {
  if (launcher === 'npx') {
    return {
      command: 'npx',
      args: ['-y', 'librainian', 'mcp', '--stdio'],
      env: { LIBRARIAN_WORKSPACE: workspace },
    };
  }

  return {
    command: 'librarian',
    args: ['mcp', '--stdio'],
    env: { LIBRARIAN_WORKSPACE: workspace },
  };
}

function buildClientBundles(workspace: string, launcher: LauncherMode): McpConfigBundle[] {
  const serverEntry = buildServerEntry(workspace, launcher);
  const mcpServers = { librarian: serverEntry };

  return [
    {
      client: 'claude',
      configPath: '~/.claude/settings.json',
      snippet: { mcpServers },
    },
    {
      client: 'cursor',
      configPath: '~/.cursor/mcp.json',
      snippet: { mcpServers },
    },
    {
      client: 'vscode',
      configPath: '~/.config/Code/User/settings.json',
      snippet: { mcp: { servers: mcpServers } },
    },
    {
      client: 'windsurf',
      configPath: '~/.windsurf/mcp.json',
      snippet: { mcpServers },
    },
    {
      client: 'gemini',
      configPath: '~/.gemini/settings.json',
      snippet: { mcpServers },
    },
  ];
}

function printHumanBundles(bundles: McpConfigBundle[]): void {
  for (const bundle of bundles) {
    console.log(`# ${bundle.client} (${bundle.configPath})`);
    console.log(JSON.stringify(bundle.snippet, null, 2));
    console.log('');
  }
}

export async function mcpCommand(options: McpCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;
  const launcher = resolveLauncher(rawArgs);
  const client = resolveClient(rawArgs);
  const printConfig = rawArgs.includes('--print-config');
  const json = rawArgs.includes('--json');

  const allBundles = buildClientBundles(workspace, launcher);
  const bundles = client === 'all' ? allBundles : allBundles.filter((bundle) => bundle.client === client);

  if (printConfig) {
    if (json) {
      const payload = bundles.reduce<Record<string, unknown>>((acc, bundle) => {
        acc[bundle.client] = {
          configPath: bundle.configPath,
          snippet: bundle.snippet,
        };
        return acc;
      }, {});
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    printHumanBundles(bundles);
    return;
  }

  // Avoid writing to stdout before stdio MCP transport starts.
  console.error('[MCP] Starting LiBrainian MCP server over stdio');
  console.error('[MCP] Config snippet (Claude):');
  console.error(JSON.stringify(bundles.find((bundle) => bundle.client === 'claude')?.snippet ?? bundles[0]?.snippet ?? {}, null, 2));

  await startStdioServer({
    authorization: {
      enabledScopes: ['read', 'write'],
      requireConsent: true,
    },
  });
}
