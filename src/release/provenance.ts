export interface ReleaseProvenanceInput {
  packageName: string;
  packageVersion: string;
  currentHead: string;
  localTags: string[];
  tagCommit?: string;
  publishedVersions: string[];
  expectedTag?: string;
}

export interface ReleaseProvenanceResult {
  ok: boolean;
  expectedTag: string;
  issues: string[];
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

function parseSemver(version: string): ParsedSemver | null {
  const trimmed = version.trim();
  const match = trimmed.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4],
  };
}

function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && !b.prerelease) return 0;

  return a.prerelease!.localeCompare(b.prerelease!);
}

function getHighestPublishedVersion(versions: string[]): string | undefined {
  let best: { raw: string; parsed: ParsedSemver } | undefined;
  for (const version of versions) {
    const parsed = parseSemver(version);
    if (!parsed) continue;
    if (!best || compareSemver(parsed, best.parsed) > 0) {
      best = { raw: version, parsed };
    }
  }
  return best?.raw;
}

export function evaluateReleaseProvenance(input: ReleaseProvenanceInput): ReleaseProvenanceResult {
  const issues: string[] = [];
  const expectedTag = (input.expectedTag?.trim() || `v${input.packageVersion}`).trim();

  if (!parseSemver(input.packageVersion)) {
    issues.push(`package.json version \"${input.packageVersion}\" is not a valid semver value.`);
  }

  const hasExpectedTag = input.localTags.includes(expectedTag);
  if (!hasExpectedTag) {
    issues.push(`expected git tag \"${expectedTag}\" is missing locally.`);
  }

  if (hasExpectedTag) {
    if (!input.tagCommit) {
      issues.push(`could not resolve commit for git tag \"${expectedTag}\".`);
    } else if (input.tagCommit !== input.currentHead) {
      issues.push(
        `git tag \"${expectedTag}\" points to ${input.tagCommit.slice(0, 12)}, but HEAD is ${input.currentHead.slice(0, 12)}.`
      );
    }
  }

  if (input.publishedVersions.includes(input.packageVersion)) {
    issues.push(
      `npm version \"${input.packageVersion}\" for ${input.packageName} is already published.`
    );
  }

  const highestPublished = getHighestPublishedVersion(input.publishedVersions);
  const parsedCurrent = parseSemver(input.packageVersion);
  const parsedHighest = highestPublished ? parseSemver(highestPublished) : null;
  if (parsedCurrent && parsedHighest && compareSemver(parsedCurrent, parsedHighest) <= 0) {
    issues.push(
      `package.json version \"${input.packageVersion}\" is not greater than latest published version \"${highestPublished}\".`
    );
  }

  return {
    ok: issues.length === 0,
    expectedTag,
    issues,
  };
}
