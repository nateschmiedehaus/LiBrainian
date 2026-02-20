#!/usr/bin/env node

import { execSync } from 'node:child_process';

const MIN_NODE = '22.14.0';
const MIN_NPM = '11.5.1';

function parseVersion(raw) {
  const clean = String(raw).trim().replace(/^v/, '');
  const parts = clean.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }
  return parts;
}

function gteVersion(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) {
      return true;
    }
    if (a[index] < b[index]) {
      return false;
    }
  }
  return true;
}

const nodeVersionRaw = process.versions.node;
const npmVersionRaw = execSync('npm -v', { encoding: 'utf8' }).trim();

const nodeVersion = parseVersion(nodeVersionRaw);
const npmVersion = parseVersion(npmVersionRaw);
const minNodeVersion = parseVersion(MIN_NODE);
const minNpmVersion = parseVersion(MIN_NPM);

if (!nodeVersion || !npmVersion || !minNodeVersion || !minNpmVersion) {
  console.error(
    '[trusted-publish-runtime] Failed to parse version values.',
    JSON.stringify({ nodeVersionRaw, npmVersionRaw, MIN_NODE, MIN_NPM }),
  );
  process.exit(1);
}

const nodeOk = gteVersion(nodeVersion, minNodeVersion);
const npmOk = gteVersion(npmVersion, minNpmVersion);

if (!nodeOk || !npmOk) {
  console.error(
    `[trusted-publish-runtime] incompatible runtime: node=${nodeVersionRaw}, npm=${npmVersionRaw}; required node>=${MIN_NODE}, npm>=${MIN_NPM}`,
  );
  process.exit(1);
}

console.log(
  `[trusted-publish-runtime] ok: node=${nodeVersionRaw}, npm=${npmVersionRaw}; required node>=${MIN_NODE}, npm>=${MIN_NPM}`,
);
