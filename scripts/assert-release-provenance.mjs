import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function parseSemver(version) {
  const trimmed = String(version ?? '').trim();
  const match = trimmed.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4],
  };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && !b.prerelease) return 0;

  return a.prerelease.localeCompare(b.prerelease);
}

function getHighestPublishedVersion(versions) {
  let best = null;
  for (const version of versions) {
    const parsed = parseSemver(version);
    if (!parsed) continue;
    if (!best || compareSemver(parsed, best.parsed) > 0) {
      best = { raw: version, parsed };
    }
  }
  return best?.raw;
}

function parsePublishedVersions(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === 'string');
    }
    if (typeof parsed === 'string') {
      return [parsed];
    }
    return [];
  } catch {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
}

if (process.env.LIBRARIAN_SKIP_RELEASE_PROVENANCE_CHECK === '1') {
  console.log('[release:provenance] skipped via LIBRARIAN_SKIP_RELEASE_PROVENANCE_CHECK=1');
  process.exit(0);
}

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageName = packageJson.name;
const packageVersion = packageJson.version;
const expectedTag = (process.env.LIBRARIAN_RELEASE_EXPECT_TAG || `v${packageVersion}`).trim();

const issues = [];

if (!parseSemver(packageVersion)) {
  issues.push(`package.json version "${packageVersion}" is not a valid semver value.`);
}

const headSha = run('git', ['rev-parse', 'HEAD']);
const localTags = run('git', ['tag', '--list', expectedTag])
  .split(/\r?\n/)
  .map((value) => value.trim())
  .filter(Boolean);

const hasExpectedTag = localTags.includes(expectedTag);
if (!hasExpectedTag) {
  issues.push(`expected git tag "${expectedTag}" is missing locally.`);
}

if (hasExpectedTag) {
  let tagCommit = '';
  try {
    tagCommit = run('git', ['rev-list', '-n', '1', expectedTag]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(`could not resolve commit for git tag "${expectedTag}": ${message}`);
  }

  if (tagCommit && tagCommit !== headSha) {
    issues.push(`git tag "${expectedTag}" points to ${tagCommit.slice(0, 12)}, but HEAD is ${headSha.slice(0, 12)}.`);
  }
}

let publishedVersions = [];
try {
  const npmViewOutput = run('npm', ['view', packageName, 'versions', '--json']);
  publishedVersions = parsePublishedVersions(npmViewOutput);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  issues.push(`failed to read npm registry versions for ${packageName}: ${message}`);
}

if (publishedVersions.includes(packageVersion)) {
  issues.push(`npm version "${packageVersion}" for ${packageName} is already published.`);
}

const highestPublished = getHighestPublishedVersion(publishedVersions);
const parsedCurrent = parseSemver(packageVersion);
const parsedHighest = highestPublished ? parseSemver(highestPublished) : null;
if (parsedCurrent && parsedHighest && compareSemver(parsedCurrent, parsedHighest) <= 0) {
  issues.push(`package.json version "${packageVersion}" is not greater than latest published version "${highestPublished}".`);
}

if (issues.length > 0) {
  console.error('[release:provenance] failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  console.error('Remediation: bump package.json version, create/push matching git tag, then re-run publish.');
  process.exit(1);
}

console.log(`[release:provenance] ok (version=${packageVersion}, tag=${expectedTag})`);
