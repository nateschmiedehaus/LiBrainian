import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

describe('embed help', () => {
  it('documents embedding remediation command', () => {
    const help = getCommandHelp('embed');
    expect(help).toContain('librainian embed - Repair and backfill semantic embeddings');
    expect(help).toContain('librainian embed --fix');
  });
});
