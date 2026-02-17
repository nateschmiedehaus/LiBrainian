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
npx librainian status --format json
npx librainian health --format json
npx librainian compose "Plan a safe refactor for auth token refresh"
```

## 4) Programmatic integration

```typescript
import { initializeLibrarian } from 'librainian';

const session = await initializeLibrarian(process.cwd());
const context = await session.query('Add request-id tracing to API handlers');
```

## 5) Contributor loop

```bash
npm run build
npm test -- --run
npm run typecheck
```

Before opening a PR:

```bash
npm run package:assert-identity
npm run package:install-smoke
npm run eval:publish-gate -- --json
```

## 6) If something fails

- run `npx librainian doctor --heal`
- rerun `npx librainian quickstart`
- open a GitHub issue with command + output + environment details
- ask setup questions in Discussions: <https://github.com/nateschmiedehaus/LiBrainian/discussions>
