import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('eval-self-understanding script guardrails', () => {
  it('caps caller probe packs and records per-query latency telemetry', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'eval-self-understanding.ts');
    const script = fs.readFileSync(scriptPath, 'utf8');

    expect(script).toContain('const CALLER_PACK_LIMIT = 20;');
    expect(script).toContain("question.type === 'callers'");
    expect(script).toContain('caller query ${question.id} returned ${packs.length} packs; capping to');
    expect(script).toContain('[eval-self-understanding] query=${question.id}');
    expect(script).toContain('withTimeout(');
    expect(script).toContain("context: `self-understanding query ${question.id}`");
  });
});
