/**
 * @fileoverview Official OpenClaw skill template for LiBrainian.
 */

import {
  getOpenclawToolDefinitions,
  getOpenclawToolRoutingTable,
} from '../mcp/openclaw_tools.js';

function renderToolDefinitionsBlock(): string {
  const definitions = getOpenclawToolDefinitions();
  return definitions
    .map((entry) => `- name: ${entry.name}\n  description: ${entry.description}\n  required: true`)
    .join('\n');
}

function renderRoutingTable(): string {
  const rows = getOpenclawToolRoutingTable();
  const header = '| Query Type | LiBrainian MCP Tool | Instead of |';
  const separator = '|---|---|---|';
  const body = rows.map((row) => `| ${row.queryType} | \`${row.tool}\` | ${row.insteadOf} |`).join('\n');
  return [header, separator, body].join('\n');
}

export const OPENCLAW_SKILL_MARKDOWN = `---
name: librainian
description: "Semantic codebase intelligence with context packs, blast radius reasoning, and call graph navigation."
version: 1.0.0
metadata:
  {"openclaw":{"requires":{"bins":["librarian"]},"trust":"verified"}}
triggers:
  - "code"
  - "refactor"
  - "debug"
  - "codebase"
  - "architecture"
---

# LiBrainian Skill for OpenClaw

Use this skill when handling software engineering tasks in non-trivial codebases.

Core rule:
When doing code-related work, call \`get_context_pack\` first before reading large files.

## TOOL_DEFINITIONS
${renderToolDefinitionsBlock()}

## Routing Table
${renderRoutingTable()}

## SKILL_INSTRUCTIONS
1. Start with \`get_session_briefing\` if repository orientation is unclear.
2. Call \`estimate_budget\` before broad retrieval or multi-step analysis.
3. For most tasks, call \`get_context_pack\` with the current coding intent and token budget.
4. Use \`find_callers\` and \`find_callees\` to navigate call graph neighborhoods.
5. Use \`invoke_construction\` for construction-level operations (including blast-radius style analysis).
6. Prefer evidence-backed answers: include file paths and symbol names.
7. If confidence is low or retrieval is uncertain, surface uncertainty explicitly and request human review.
8. At session wrap-up, call \`harvest_session_knowledge\` to sync validated claims into annotated MEMORY.md via the memory bridge.
`;
