#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const out = { root: process.cwd() };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[i + 1];
      if (!value) throw new Error('Missing value for --root');
      out.root = path.resolve(value);
      i += 1;
    }
  }
  return out;
}

async function fileExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursively(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

async function resolvePackageRoot(root) {
  const packaged = path.join(root, 'packages', 'librarian');
  if (await fileExists(path.join(packaged, 'package.json'))) return packaged;
  return root;
}

async function main() {
  const { root } = parseArgs(process.argv);
  const failures = [];

  const pkgRoot = await resolvePackageRoot(root);
  const pkgJsonPath = path.join(pkgRoot, 'package.json');
  const srcRoot = path.join(pkgRoot, 'src');

  if (!(await fileExists(pkgJsonPath))) failures.push(`missing: ${path.relative(root, pkgJsonPath)}`);
  if (!(await fileExists(srcRoot))) failures.push(`missing: ${path.relative(root, srcRoot)}`);

  if (failures.length === 0) {
    const raw = await fs.readFile(pkgJsonPath, 'utf8');
    let pkg;
    try {
      pkg = JSON.parse(raw);
    } catch {
      failures.push(`invalid_json: ${path.relative(root, pkgJsonPath)}`);
      pkg = null;
    }

    if (pkg) {
      if (pkg.name !== 'librarian') failures.push(`package_name_expected:librarian got:${String(pkg.name)}`);
      if (pkg.type !== 'module') failures.push(`package_type_expected:module got:${String(pkg.type)}`);
      if (!pkg.exports || typeof pkg.exports !== 'object') failures.push('package_exports_missing');
      if (!pkg.bin || typeof pkg.bin !== 'object' || !pkg.bin.librarian) failures.push('package_bin_missing:librarian');
      if (!Array.isArray(pkg.files) || !pkg.files.includes('dist')) failures.push('package_files_missing:dist');
    }
  }

  // Static boundary check: Librarian package must not import Wave0 internals.
  if (await fileExists(srcRoot)) {
    const files = (await listFilesRecursively(srcRoot)).filter((p) => p.endsWith('.ts') || p.endsWith('.js'));
    for (const f of files) {
      const rel = path.relative(root, f);
      const text = await fs.readFile(f, 'utf8');

      // Disallow direct imports of Wave0 internal modules from within the package.
      if (text.includes("src/wave0/") || text.includes("src/orchestrator/")) {
        failures.push(`wave0_internal_import_found:${rel}`);
      }
      if (text.includes("from '../../wave0") || text.includes("from \"../../wave0")) {
        failures.push(`wave0_internal_import_found:${rel}`);
      }
    }
  }

  if (failures.length > 0) {
    process.stderr.write('[librarian_extraction_prereqs] FAIL\n');
    for (const item of failures) process.stderr.write(`- ${item}\n`);
    process.exit(1);
  }

  process.stdout.write('[librarian_extraction_prereqs] OK\n');
}

main().catch((err) => {
  process.stderr.write(`[librarian_extraction_prereqs] ERROR ${err?.message ?? String(err)}\n`);
  process.exit(1);
});
