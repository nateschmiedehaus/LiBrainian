import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  process.stderr.write(`[canon_guard] ${message}\n`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Failed to parse JSON: ${filePath} (${error instanceof Error ? error.message : String(error)})`);
  }
}

const root = process.cwd();
const canonPath = path.join(root, 'config', 'canon.json');
if (!fs.existsSync(canonPath)) {
  fail('Missing config/canon.json (expected machine-readable canonical commands and policy).');
}

const canon = readJson(canonPath);
if (typeof canon.schema_version !== 'number') {
  fail('config/canon.json must declare a numeric schema_version.');
}

if (!canon.commands || typeof canon.commands !== 'object') {
  fail('config/canon.json must declare a commands object.');
}

const requiredCommands = [
  'ci_test',
  'qualification',
  'typecheck',
  'lint',
  'canon_guard',
  'complexity_check',
  'tier1_dogfood',
];

for (const key of requiredCommands) {
  if (typeof canon.commands[key] !== 'string' || canon.commands[key].trim().length === 0) {
    fail(`config/canon.json commands.${key} must be a non-empty string.`);
  }
}

const pkgPath = path.join(root, 'package.json');
if (!fs.existsSync(pkgPath)) {
  fail('Missing package.json at workspace root.');
}

const pkg = readJson(pkgPath);
const scripts = (pkg && pkg.scripts && typeof pkg.scripts === 'object') ? pkg.scripts : {};

function verifyCommandRef(command) {
  const npmRun = command.match(/^npm run ([^\\s]+)(?:\\s|$)/);
  if (npmRun) {
    const scriptName = npmRun[1];
    if (typeof scripts[scriptName] !== 'string') {
      fail(`Canonical command references missing npm script: ${scriptName}`);
    }
    return;
  }

  const nodeRun = command.match(/^node ([^\\s]+)(?:\\s|$)/);
  if (nodeRun) {
    const rel = nodeRun[1];
    const target = path.isAbsolute(rel) ? rel : path.join(root, rel);
    if (!fs.existsSync(target)) {
      fail(`Canonical command references missing node entry: ${rel}`);
    }
  }
}

for (const command of Object.values(canon.commands)) {
  verifyCommandRef(command);
}

const scriptsDir = path.join(root, 'scripts');
if (fs.existsSync(scriptsDir)) {
  const forbiddenScripts = fs.readdirSync(scriptsDir)
    .filter((entry) => /^tmp[_-]/i.test(entry));
  if (forbiddenScripts.length > 0) {
    fail(`Forbidden temporary scripts found: ${forbiddenScripts.join(', ')}`);
  }
}

// Success: keep stdout empty to preserve JSON pipelines.
process.exit(0);
