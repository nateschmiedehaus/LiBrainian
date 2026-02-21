import { parseArgs } from 'node:util';
import * as mcpServerModule from '../../mcp/server.js';
import { emitJsonOutput } from '../json_output.js';
import { buildCapabilityInventory } from '../../capabilities/inventory.js';

export interface CapabilitiesCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
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

function resolveMcpTools(workspace: string): ToolSummary[] {
  const MCPServerCtor = resolveMcpServerCtor();
  const server = new MCPServerCtor({
    workspaces: [workspace],
    authorization: {
      enabledScopes: ['read', 'write', 'execute', 'network', 'admin'],
      requireConsent: false,
    },
    audit: {
      enabled: false,
      retentionDays: 1,
      logPath: '.librarian/audit/mcp',
    },
  });
  return server.getAvailableTools();
}

export async function capabilitiesCommand(options: CapabilitiesCommandOptions): Promise<void> {
  const { values } = parseArgs({
    args: options.rawArgs.slice(1),
    options: {
      json: { type: 'boolean', default: true },
      out: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const out = typeof values.out === 'string' ? values.out : undefined;
  const tools = resolveMcpTools(options.workspace);
  const inventory = buildCapabilityInventory({ mcpTools: tools });
  await emitJsonOutput(inventory, out);
}
