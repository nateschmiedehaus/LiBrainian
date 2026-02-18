#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });

  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim();
    const stdout = String(result.stdout ?? '').trim();
    const output = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${output ? `\n${output}` : ''}`);
  }

  return String(result.stdout ?? '').trim();
}

function sanitizeScope(rawScope) {
  const normalized = String(rawScope ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!normalized) return '';
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    throw new Error(`Invalid package scope "${rawScope}". Expected letters, numbers, or dashes.`);
  }
  return normalized;
}

function sanitizePackageName(rawName) {
  const normalized = String(rawName ?? '').trim().replace(/^@[^/]+\//, '').toLowerCase();
  if (!normalized) return '';
  if (!/^[a-z0-9._-]+$/.test(normalized)) {
    throw new Error(`Invalid package name "${rawName}".`);
  }
  return normalized;
}

function resolveGithubRepository(packageJson) {
  const envRepo = String(process.env.GITHUB_REPOSITORY ?? '').trim();
  if (/^[^/\s]+\/[^/\s]+$/.test(envRepo)) {
    const [owner, repo] = envRepo.split('/');
    return {
      owner: owner.toLowerCase(),
      repo,
      slug: `${owner.toLowerCase()}/${repo}`,
    };
  }

  const repositoryValue = typeof packageJson.repository === 'string'
    ? packageJson.repository
    : packageJson.repository?.url;
  const repositoryText = String(repositoryValue ?? '').trim();
  const match = repositoryText.match(/github\.com[:/](?<owner>[^/\s]+)\/(?<repo>[^/\s.]+)(?:\.git)?/i);
  if (match?.groups?.owner && match?.groups?.repo) {
    const owner = match.groups.owner.toLowerCase();
    const repo = match.groups.repo;
    return {
      owner,
      repo,
      slug: `${owner}/${repo}`,
    };
  }

  throw new Error(
    'Missing GitHub repository metadata. Set GITHUB_REPOSITORY=owner/repo or provide package.json repository.url.'
  );
}

function resolveScopedName(packageJson) {
  const scope = sanitizeScope(process.env.LIBRARIAN_GH_PACKAGE_SCOPE || process.env.GITHUB_REPOSITORY_OWNER || '');
  if (!scope) {
    throw new Error('Missing GitHub package scope. Set LIBRARIAN_GH_PACKAGE_SCOPE or GITHUB_REPOSITORY_OWNER.');
  }

  const sourceName = process.env.LIBRARIAN_GH_PACKAGE_NAME || packageJson.name;
  const packageName = sanitizePackageName(sourceName);
  if (!packageName) {
    throw new Error(`Unable to resolve package name from "${sourceName}".`);
  }

  return `@${scope}/${packageName}`;
}

function ensureBuildArtifacts(root) {
  const distDir = path.join(root, 'dist');
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    throw new Error('Missing dist/ directory. Run `npm run build` before publishing to GitHub Packages.');
  }
}

function copyIfExists(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.cpSync(source, destination, { recursive: true });
}

function main() {
  const root = process.cwd();
  const nodeAuthToken = String(process.env.NODE_AUTH_TOKEN ?? '').trim();
  if (!nodeAuthToken) {
    throw new Error('NODE_AUTH_TOKEN is required to publish to GitHub Packages.');
  }
  const registryInput = String(process.env.LIBRARIAN_GH_PACKAGE_REGISTRY ?? 'https://npm.pkg.github.com').trim();
  const registry = registryInput.replace(/\/+$/, '');
  const registryUrl = new URL(registry.startsWith('http://') || registry.startsWith('https://')
    ? registry
    : `https://${registry}`);

  ensureBuildArtifacts(root);

  const packagePath = path.join(root, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const scopedName = resolveScopedName(packageJson);
  const githubRepo = resolveGithubRepository(packageJson);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'librainian-ghpkg-'));
  const stagingDir = path.join(tempRoot, 'package');
  fs.mkdirSync(stagingDir, { recursive: true });

  try {
    copyIfExists(path.join(root, 'dist'), path.join(stagingDir, 'dist'));
    copyIfExists(path.join(root, 'README.md'), path.join(stagingDir, 'README.md'));
    copyIfExists(path.join(root, 'LICENSE'), path.join(stagingDir, 'LICENSE'));
    copyIfExists(path.join(root, 'CHANGELOG.md'), path.join(stagingDir, 'CHANGELOG.md'));

    const stagedPackageJson = {
      ...packageJson,
      name: scopedName,
      repository: {
        type: 'git',
        url: `git+https://github.com/${githubRepo.slug}.git`,
      },
      bugs: {
        url: `https://github.com/${githubRepo.slug}/issues`,
      },
      homepage: `https://github.com/${githubRepo.slug}#readme`,
      publishConfig: {
        ...(packageJson.publishConfig ?? {}),
        registry: `${registryUrl.origin}/`,
      },
    };
    fs.writeFileSync(path.join(stagingDir, 'package.json'), `${JSON.stringify(stagedPackageJson, null, 2)}\n`, 'utf8');

    const npmrc = [
      `@${scopedName.split('/')[0].replace(/^@/, '')}:registry=${registryUrl.origin}`,
      `//${registryUrl.host}/:_authToken=\${NODE_AUTH_TOKEN}`,
      'always-auth=true',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(stagingDir, '.npmrc'), npmrc, 'utf8');

    const publishTag = String(process.env.NPM_TAG ?? '').trim();
    const publishArgs = ['publish', `--registry=${registryUrl.origin}`, '--ignore-scripts'];
    if (publishTag) {
      publishArgs.push('--tag', publishTag);
    }

    run('npm', publishArgs, {
      cwd: stagingDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_AUTH_TOKEN: nodeAuthToken,
      },
    });

    console.log(`[release:github-packages] published ${scopedName}@${stagedPackageJson.version}`);
    console.log(`[release:github-packages] package listing: https://github.com/${githubRepo.slug}/packages`);
    console.log(`[release:github-packages] owner packages: https://github.com/${githubRepo.owner}?tab=packages`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
