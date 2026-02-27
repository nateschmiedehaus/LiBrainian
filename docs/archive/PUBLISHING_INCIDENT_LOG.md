# Publishing Incident Log

This log tracks release/publish failures with concrete fixes and prevention checks.

## 2026-02-20: npm publish freshness blocked (`0.2.1` local vs `0.2.0` npm latest)

- Symptom:
  - `npm run test:e2e:cadence` failed at `policy:npm:fresh`.
- Root cause:
  - Local package version advanced, but npm registry was still at prior version.
- Resolution:
  - Ran release workflow and strict tarball reality tests before publish retry.
- Prevention:
  - Keep `policy:npm:fresh` as hard gate before claiming publish/E2E readiness.
  - Require successful publish workflow completion before scheduled full reality E2E.

## 2026-02-20: strict tarball E2E parser failure in release workflow

- Symptom:
  - Release verify failed with `Unable to parse npm pack output for tarball install source`.
- Root cause:
  - `scripts/npm-external-blackbox-e2e.mjs` parsed JSON using `lastIndexOf('[')`, which can select nested arrays from package metadata output.
- Resolution:
  - Parser updated to slice from first `[` to last `]` before JSON parse.
  - Validated with `npm run test:e2e:reality:tarball`.
- Prevention:
  - Keep strict tarball E2E in release verify.
  - Preserve parser test coverage around nested-array output shapes.

## 2026-02-20: trusted publishing failed (`ENEEDAUTH`) in GitHub Actions

- Symptom:
  - `publish-manual` job failed at `npm publish` with `ENEEDAUTH`.
- Root cause:
  - Publish workflow used Node 20, which can run an npm CLI version below trusted-publishing requirements.
  - npm trusted publishing requires Node >= 22.14 and npm >= 11.5.1.
  - npm trusted publisher mapping may still need verification after runtime correction.
- Resolution:
  - Confirmed npm trusted publisher is configured to workflow file `publish-npm.yml` and environment `npm-publish`.
  - Upgraded publish workflow runtime to Node 24.
  - Added trusted-publish runtime guard:
    - `scripts/assert-trusted-publish-runtime.mjs`
  - Updated workflow references and tests:
    - `.github/workflows/publish-npm.yml`
    - `scripts/gh-autoland.mjs`
    - `src/__tests__/npm_publish_workflow.test.ts`
- Prevention:
  - Keep publish workflow identity test in CI.
  - Keep trusted runtime guard in publish jobs so Node/npm drift fails fast.
  - Treat npm trusted publisher/workflow identity mismatch as first-check diagnostic.

## 2026-02-20: local npm auth fallback unavailable

- Symptom:
  - `npm whoami` failed with `E401`; local token also invalid.
- Root cause:
  - No valid local npm auth for manual fallback publishing.
- Resolution:
  - Use GitHub trusted publish workflow path as the primary publish mechanism.
- Prevention:
  - Avoid relying on local token fallback for release-critical publish paths.
  - Keep trusted publisher mapping healthy and validated.

## 2026-02-20: generated tarball artifact churn in working tree

- Symptom:
  - `librainian-0.2.1.tgz` repeatedly appears as untracked after pack/release checks.
- Root cause:
  - Expected byproduct of `npm pack` during local and workflow-adjacent validation.
- Resolution:
  - Ignore artifact during commit staging; do not include in source commits.
- Prevention:
  - Add a guard/checklist step before commit to confirm tarball artifacts are excluded.

## 2026-02-20: automation limits slowed issue delegation throughput

- Symptom:
  - Sub-agent parallelization attempts failed with runtime agent limit reached.
- Root cause:
  - Platform cap on simultaneously active agent threads.
- Resolution:
  - Continue work in single-agent mode until threads are reclaimed.
- Prevention:
  - Add a delegation readiness preflight:
    - verify active thread count
    - close completed/stale sessions
    - then allocate 4-way issue batches.
