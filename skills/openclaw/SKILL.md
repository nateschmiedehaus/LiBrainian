---
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
When doing code-related work, call `get_context_pack` first before reading large files.

## TOOL_DEFINITIONS
- name: get_context_pack
  description: Token-budgeted context assembly for coding intents.
  required: true
- name: invoke_construction
  description: Invoke built-in constructions (including blast-radius workflows).
  required: true
- name: find_callers
  description: Find inbound call graph edges for a symbol.
  required: true
- name: find_callees
  description: Find outbound call graph edges for a symbol.
  required: true
- name: estimate_budget
  description: Estimate token budget feasibility before retrieval.
  required: true
- name: get_session_briefing
  description: Generate concise repository orientation briefing.
  required: true

## Routing Table
| Query Type | LiBrainian MCP Tool | Instead of |
|---|---|---|
| How does X work? | `get_context_pack` | Read(large_file) |
| What breaks if I change Y? | `invoke_construction` | grep -r across repo |
| Who calls function Z? | `find_callers` | grep + manual trace |
| What does function Z call? | `find_callees` | grep + manual trace |
| How much context will this take? | `estimate_budget` | No estimate / surprise token exhaustion |
| Orient me to this codebase | `get_session_briefing` | 40-60k token cold-start dump |

## SKILL_INSTRUCTIONS
1. Start with `get_session_briefing` if repository orientation is unclear.
2. Call `estimate_budget` before broad retrieval or multi-step analysis.
3. For most tasks, call `get_context_pack` with the current coding intent and token budget.
4. Use `find_callers` and `find_callees` to navigate call graph neighborhoods.
5. Use `invoke_construction` for construction-level operations (including blast-radius style analysis).
6. Prefer evidence-backed answers: include file paths and symbol names.
7. If confidence is low or retrieval is uncertain, surface uncertainty explicitly and request human review.
