import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const requiredMarkers = [
  'REAL_AGENT_REAL_LIBRAINIAN_ONLY',
  'NO_SYNTHETIC_OR_REFERENCE_FOR_RELEASE',
  'NO_RETRY_NO_FALLBACK_FOR_RELEASE_EVIDENCE',
  'PERFECT_RELEASE_EVIDENCE_ONLY',
];

const policyDocs = [
  'docs/TEST.md',
  'docs/librainian/README.md',
  'docs/librainian/validation.md',
  'docs/librainian/LIVE_FIRE_E2E.md',
  'docs/librainian/AGENT_INTEGRATION.md',
];

describe('real-agent release policy docs', () => {
  it('state release evidence policy markers in all critical docs', () => {
    for (const docPath of policyDocs) {
      const content = readFileSync(resolve(repoRoot, docPath), 'utf8');
      for (const marker of requiredMarkers) {
        expect(content).toContain(marker);
      }
    }
  });
});
