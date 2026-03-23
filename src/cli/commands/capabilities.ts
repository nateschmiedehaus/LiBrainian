import { parseArgs } from 'node:util';
import * as mcpServerModule from '../../mcp/server.js';
import { emitJsonOutput } from '../json_output.js';
import { buildCapabilityInventory, type CapabilitySurface } from '../../capabilities/inventory.js';
import { createError } from '../errors.js';

export interface CapabilitiesCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

function internalCommandsEnabled(): boolean {
  return process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS === '1';
}

type ToolSummary = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

type MCPServerConstructor = new (config: {
  workspaces: string[];
  authorization: {
    enabledScopes: string[];
    requireConsent: boolean;
  };
  audit: {
    enabled: boolean;
    retentionDays: number;
    logPath: string;
  };
}) => {
  getAvailableTools: () => ToolSummary[];
  getAdvertisedToolsForInventory?: () => ToolSummary[];
};

function resolveMcpServerCtor(): MCPServerConstructor {
  const moduleExports = mcpServerModule as unknown as {
    LiBrainianMCPServer?: MCPServerConstructor;
    LibrarianMCPServer?: MCPServerConstructor;
  };
  const ctor = moduleExports.LiBrainianMCPServer ?? moduleExports.LibrarianMCPServer;
  if (!ctor) {
    throw new Error('MCP server constructor is unavailable; expected LiBrainianMCPServer or LibrarianMCPServer export.');
  }
  return ctor;
}

function resolveMcpTools(workspace: string, surface: CapabilitySurface): ToolSummary[] {
  const MCPServerCtor = resolveMcpServerCtor();
  const server = new MCPServerCtor({
    workspaces: [workspace],
    authorization: {
      enabledScopes: surface === 'full'
        ? ['read', 'write', 'execute', 'network', 'admin']
        : ['read'],
      requireConsent: false,
    },
    audit: {
      enabled: false,
      retentionDays: 1,
      logPath: '.librarian/audit/mcp',
    },
  });
  return server.getAdvertisedToolsForInventory?.() ?? server.getAvailableTools();
}

export async function capabilitiesCommand(options: CapabilitiesCommandOptions): Promise<void> {
  const { values } = parseArgs({
    args: options.rawArgs.slice(1),
    options: {
      json: { type: 'boolean', default: true },
      full: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const out = typeof values.out === 'string' ? values.out : undefined;
  const surface: CapabilitySurface = values.full ? 'full' : 'public';

  if (surface === 'full' && !internalCommandsEnabled()) {
    throw createError(
      'INVALID_ARGUMENT',
      'The full capability inventory is unavailable in the public release surface. Set LIBRAINIAN_ENABLE_INTERNAL_COMMANDS=1 in a source checkout to access the full inventory.',
    );
  }

  const tools = resolveMcpTools(options.workspace, surface);
  const inventory = buildCapabilityInventory({ mcpTools: tools, surface });
  await emitJsonOutput(inventory, out);
}
