import { describe, expect, it } from 'vitest';
import {
  OPENCLAW_REQUIRED_TOOL_NAMES,
  getOpenclawToolRegistryStatus,
  getOpenclawToolRoutingTable,
} from '../openclaw_tools.js';

describe('OpenClaw MCP tool wrapper', () => {
  it('keeps required OpenClaw tool names registered in schema', () => {
    const status = getOpenclawToolRegistryStatus();
    expect(status.missing).toEqual([]);
    expect(status.available).toEqual(OPENCLAW_REQUIRED_TOOL_NAMES);
  });

  it('exposes routing entries aligned to required tools', () => {
    const rows = getOpenclawToolRoutingTable();
    expect(rows.length).toBeGreaterThanOrEqual(OPENCLAW_REQUIRED_TOOL_NAMES.length);
    for (const toolName of OPENCLAW_REQUIRED_TOOL_NAMES) {
      expect(rows.some((row) => row.tool === toolName)).toBe(true);
    }
  });
});
