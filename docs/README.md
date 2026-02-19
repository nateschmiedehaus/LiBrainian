# Documentation Index

Start here for the fastest path:

- `/docs/START_HERE.md` — install, first query, contributor loop

Public docs (user-facing):

- `/docs/librarian/README.md` — canonical docs entry
- `/docs/integrations/README.md` — universal integration decision tree (MCP, CLI, OpenAPI/REST, UTCP, A2A, Python SDK)
- `/docs/librarian/API.md` — API reference
- `/docs/librarian/AGENT_INTEGRATION.md` — integration patterns
- `/docs/librarian/MCP_SERVER.md` — MCP usage
- `/docs/constructions/quickstart.md` — construction zero-to-working tutorial
- `/docs/constructions/operators.md` — operator decision guide
- `/docs/constructions/cookbook.md` — end-to-end construction recipes
- `/docs/constructions/testing.md` — deterministic construction testing guide
- `/docs/constructions/migration.md` — class-style to operator-style migration
- `/docs/mcp-setup.md` — end-to-end MCP client setup
- `/docs/mcp-design-principles.md` — MCP tool design standards
- `/docs/librarian/validation.md` — validation and gates

Project docs:

- `/CONTRIBUTING.md` — contributor workflow
- `/ARCHITECTURE.md` — architecture overview
- `/SECURITY.md` — security policy

Maintainer-only historical planning docs:

- `/docs/internal/README.md` — internal/archive boundary and references

If you are evaluating production readiness, run:

```bash
npm test -- --run
npm run typecheck
npm run package:assert-identity
npm run package:install-smoke
npm run eval:publish-gate -- --json
```
