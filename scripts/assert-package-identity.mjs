import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJsonPath = path.join(root, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const issues = [];

if (packageJson.name !== 'librainian') {
  issues.push(`package name must be "librainian" (received "${packageJson.name ?? 'undefined'}")`);
}

const expectedBinPath = './dist/cli/index.js';
if (packageJson.bin?.librainian !== expectedBinPath) {
  issues.push(`bin.librainian must be "${expectedBinPath}"`);
}
if (packageJson.bin?.librarian !== expectedBinPath) {
  issues.push(`bin.librarian must be "${expectedBinPath}"`);
}

if (issues.length > 0) {
  console.error('[package:assert-identity] failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log('[package:assert-identity] ok');
