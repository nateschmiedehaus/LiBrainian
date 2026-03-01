import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('eval-self-understanding script guardrails', () => {
  it('caps packs by question type and records per-query latency telemetry', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'eval-self-understanding.ts');
    const script = fs.readFileSync(scriptPath, 'utf8');

    expect(script).toContain('const CALLER_PACK_LIMIT = 20;');
    expect(script).toContain('const IMPLEMENTATION_PACK_LIMIT = 40;');
    expect(script).toContain('const GENERAL_PACK_LIMIT = 80;');
    expect(script).toContain('const packLimit = resolvePackLimit(question.type);');
    expect(script).toContain('const cappedPacks = packs.slice(0, packLimit);');
    expect(script).toContain("case 'callers':");
    expect(script).toContain('${question.type} query ${question.id} returned ${packs.length} packs; capping to');
    expect(script).toContain('[eval-self-understanding] query=${question.id}');
    expect(script).toContain('withTimeout(');
    expect(script).toContain("context: `self-understanding query ${question.id}`");
    expect(script).toContain("includeEngines: false");
  });
});
