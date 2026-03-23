# LiBrainian Start Here

This page is the fastest path from first visit to productive usage.

## 1) Install

```bash
npm install librainian
```

## 2) First successful run

```bash
npx librainian quickstart
npx librainian query "What are the core modules and how do they connect?"
```

Healthy output includes:
- summary text
- related files
- confidence value

## 3) Common next commands

```bash
npx librainian status --json
npx librainian doctor --json
npx librainian repo-map --json
```

## 4) Programmatic integration

```typescript
import { initializeLibrarian } from 'librainian';

const session = await initializeLibrarian(process.cwd());
const context = await session.query('Add request-id tracing to API handlers');
```

## 5) Contributor loop

Maintainer-only source-checkout validation lives in
[`CONTRIBUTING.md`](https://github.com/nateschmiedehaus/LiBrainian/blob/main/CONTRIBUTING.md).

Contributor validation and maintainer release qualification are source-checkout
workflows. Use
[`CONTRIBUTING.md`](https://github.com/nateschmiedehaus/LiBrainian/blob/main/CONTRIBUTING.md)
for build, test, packaging, and release commands.

## 6) If something fails

- run `npx librainian doctor --heal`
- rerun `npx librainian quickstart`
- open a GitHub issue with command + output + environment details
- ask setup questions in Discussions: <https://github.com/nateschmiedehaus/LiBrainian/discussions>
