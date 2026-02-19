/**
 * @fileoverview OpenClaw skill-facing MCP tool wrappers.
 *
 * This module is intentionally thin: it references already-implemented LiBrainian
 * MCP tools and provides a stable mapping table for OpenClaw skill instructions.
 */

import { getToolSchema, listToolSchemas } from './schema.js';

export const OPENCLAW_REQUIRED_TOOL_NAMES = [
  'get_context_pack',
  'invoke_construction',
  'find_callers',
  'find_callees',
  'estimate_budget',
  'get_session_briefing',
] as const;

export type OpenclawRequiredToolName = typeof OPENCLAW_REQUIRED_TOOL_NAMES[number];

export interface OpenclawToolRoutingEntry {
  queryType: string;
  tool: OpenclawRequiredToolName;
  insteadOf: string;
}

export interface OpenclawToolDefinition {
  name: OpenclawRequiredToolName;
  description: string;
  required: true;
}

const ROUTING_TABLE: OpenclawToolRoutingEntry[] = [
  {
    queryType: 'How does X work?',
    tool: 'get_context_pack',
    insteadOf: 'Read(large_file)',
  },
  {
    queryType: 'What breaks if I change Y?',
    tool: 'invoke_construction',
    insteadOf: 'grep -r across repo',
  },
  {
    queryType: 'Who calls function Z?',
    tool: 'find_callers',
    insteadOf: 'grep + manual trace',
  },
  {
    queryType: 'What does function Z call?',
    tool: 'find_callees',
    insteadOf: 'grep + manual trace',
  },
  {
    queryType: 'How much context will this take?',
    tool: 'estimate_budget',
    insteadOf: 'No estimate / surprise token exhaustion',
  },
  {
    queryType: 'Orient me to this codebase',
    tool: 'get_session_briefing',
    insteadOf: '40-60k token cold-start dump',
  },
];

const TOOL_DESCRIPTIONS: Record<OpenclawRequiredToolName, string> = {
  'get_context_pack': 'Token-budgeted context assembly for coding intents.',
  'invoke_construction': 'Invoke built-in constructions (including blast-radius workflows).',
  'find_callers': 'Find inbound call graph edges for a symbol.',
  'find_callees': 'Find outbound call graph edges for a symbol.',
  'estimate_budget': 'Estimate token budget feasibility before retrieval.',
  'get_session_briefing': 'Generate concise repository orientation briefing.',
};

export function getOpenclawToolRoutingTable(): OpenclawToolRoutingEntry[] {
  return [...ROUTING_TABLE];
}

export function getOpenclawToolDefinitions(): OpenclawToolDefinition[] {
  return OPENCLAW_REQUIRED_TOOL_NAMES.map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    required: true,
  }));
}

export function getOpenclawToolRegistryStatus(): {
  available: OpenclawRequiredToolName[];
  missing: OpenclawRequiredToolName[];
} {
  const registered = new Set(listToolSchemas());
  const missing = OPENCLAW_REQUIRED_TOOL_NAMES.filter((name) => !registered.has(name));
  const available = OPENCLAW_REQUIRED_TOOL_NAMES.filter((name) => registered.has(name));
  return { available, missing };
}

export function getOpenclawRequiredToolSchemas(): Array<{
  name: OpenclawRequiredToolName;
}> {
  const entries: Array<{
    name: OpenclawRequiredToolName;
  }> = [];
  for (const name of OPENCLAW_REQUIRED_TOOL_NAMES) {
    const schema = getToolSchema(name);
    if (schema) {
      entries.push({ name });
    }
  }
  return entries;
}
