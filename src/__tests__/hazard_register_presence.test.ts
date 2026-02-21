import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const hazardRegisterPath = resolve(process.cwd(), 'docs/librainian/hazard_register.md');
const requiredHazardIds = ['HZ-001', 'HZ-002', 'HZ-003', 'HZ-004', 'HZ-005'];

describe('Hazard register presence', () => {
  it('exists and contains required hazard IDs', () => {
    expect(existsSync(hazardRegisterPath)).toBe(true);

    const contents = readFileSync(hazardRegisterPath, 'utf-8');
    for (const hazardId of requiredHazardIds) {
      expect(contents).toContain(hazardId);
    }
  });
});
