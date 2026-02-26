#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'docs', 'librarian', 'releases', 'dry-runs');
const outPath = path.join(outDir, 'm1-release-dry-run-2026-02-26.md');
const now = new Date().toISOString();
let gitSha = 'unknown';

try {
  const { execSync } = await import('node:child_process');
  gitSha = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim();
} catch {
  // Keep bundle generation non-fatal even when git metadata is unavailable.
}

const lines = [
  '# M1 Release Dry-Run Bundle (2026-02-26)',
  '',
  `- Generated at: ${now}`,
  `- Git SHA: ${gitSha}`,
  '- Scope: M1 release-readiness rehearsal for docs + versioning + package release posture',
  '',
  '## Commands',
  '',
  '```bash',
  'npm run build',
  'npm test -- --run src/__tests__/github_readiness_docs.test.ts src/__tests__/package_release_scripts.test.ts src/__tests__/npm_publish_workflow.test.ts src/__tests__/m1_release_charter_docs.test.ts',
  'npm run test:agentic:strict',
  '```',
  '',
  '## Outcome Summary',
  '',
  '- Result: dry-run artifact generated',
  '- Notes: this bundle is generated for review and release checklist rehearsal; command execution status is captured in CI/local logs.',
  '- Reviewer checkpoint: ensure all M1 charter gates are green before milestone closure.',
  '',
];

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`Generated ${path.relative(root, outPath)}`);
