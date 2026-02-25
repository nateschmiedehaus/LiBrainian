# Contributing to LiBrainian

First off, thank you for considering contributing to LiBrainian! It's people like you that make LiBrainian such a great tool for the developer community.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Submitting Changes](#submitting-changes)
- [Style Guidelines](#style-guidelines)
- [Testing](#testing)
- [Documentation](#documentation)
- [Community](#community)

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
For security reports, see [SECURITY.md](SECURITY.md).

## Getting Started

### Types of Contributions

There are many ways to contribute:

- **Bug Reports**: Found a bug? Let us know!
- **Feature Requests**: Have an idea? We'd love to hear it!
- **Code**: Fix bugs or implement new features
- **Documentation**: Improve or add documentation
- **Testing**: Add or improve tests
- **Research**: Contribute to best practices databases

### Before You Start

1. Check existing [issues](https://github.com/nateschmiedehaus/LiBrainian/issues) and [PRs](https://github.com/nateschmiedehaus/LiBrainian/pulls)
2. For major changes, open an issue first to discuss
3. Read our architecture docs in `docs/`

## Development Setup

### Prerequisites

- Node.js 18+
- npm 9+
- Git

### Setup Steps

```bash
# Clone the repository
git clone https://github.com/nateschmiedehaus/LiBrainian.git
cd LiBrainian

# Install dependencies
npm install

# Build the project
npm run build

# Run tests to verify setup
npm test

# Start development mode
npm run dev
```

### 10-Minute Contributor Flow

```bash
npm install
npx librainian quickstart
npm test -- --run
npm run typecheck
```

If those pass, your environment is ready for editing and PR work.

### LiBrainian Dogfood Workflow (Required)

Before opening a PR, use LiBrainian on LiBrainian itself:

```bash
npx librainian status
npx librainian query "Where is the MCP server initialized?" --strategy heuristic --no-synthesis
npx librainian check --diff working-tree
```

Required expectation:
- `librainian status` reports a healthy index (no MVP bootstrap required)
- Query responses are non-empty and point to relevant files
- `librainian check` passes for your changed files before review

### Environment Variables

For full functionality, set these (all optional):

```bash
# LLM providers (optional - works without)
export ANTHROPIC_API_KEY=your-key
export OPENAI_API_KEY=your-key

# Development
export DEBUG=LiBrainian:*
```

## Making Changes

### Branch Naming

Use descriptive branch names:

```
feat/add-python-support
fix/query-timeout-issue
docs/improve-api-reference
test/add-quality-detector-tests
refactor/simplify-storage-layer
```

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting, no code change
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `test`: Adding or fixing tests
- `chore`: Build process or auxiliary tool changes

Examples:

```
feat(query): add support for file-scoped queries

fix(indexing): handle symlinks correctly

docs(readme): add MCP server setup instructions

test(quality): add tests for dead code detection
```

### Code Changes

1. **Create a branch** from `main`
2. **Make your changes** following our style guide
3. **Add tests** for new functionality
4. **Update docs** if needed
5. **Run staged validation (`npm run validate:fast`)**
6. **Submit a PR**

## Submitting Changes

### Pull Request Process

1. **Update the README.md** with details of changes if applicable
2. **Add tests** that prove your fix/feature works
3. **Ensure CI passes** - all tests and linting must pass
4. **Request review** from maintainers
5. **Address feedback** promptly

### Release-Grade Validation (Required Before Merge)

Run these before requesting final review:

```bash
npm run validate:fast
npm run validate:full
npm run test:agentic:strict
npm run typecheck
npm test -- --run
npm run repo:audit
npm run package:assert-identity
npm run package:install-smoke
npm run eval:publish-gate -- --json
```

Validation ladder:
- `npm run validate:fast` — typecheck + changed tests + public-surface checks (default PR path).
- `npm run validate:full` — deterministic full gate before merge.
- `npm run test:agentic:strict` — release-grade real-agent qualification.

### Streamlined npm Publish Flow

For maintainers, npm publishing is wired to GitHub Actions so publishing does not depend on local machine state.

1. Connect npm trusted publishing to this GitHub repo/workflow in npm settings (recommended).
2. Optionally set `NPM_TOKEN` or `NODE_AUTH_TOKEN` in GitHub secrets as a fallback path.
3. Run the `publish-npm` workflow:
   - `publish=false` for verification-only.
   - `publish=true` to publish after verification.
4. Or publish automatically by creating a GitHub Release (`published` event triggers the same flow).

The workflow now auto-selects auth mode:
- Uses registry token auth when `NPM_TOKEN`/`NODE_AUTH_TOKEN` is present **and valid**.
- Automatically switches to trusted publishing (OIDC) when token is missing/invalid.
- Clears inherited token env on the trusted path to avoid accidental invalid-token publishes.

Local verification helpers:

```bash
npm run release:pack
npm run release:dry-run
```

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## How Has This Been Tested?
Describe tests you ran

## Checklist
- [ ] My code follows the style guidelines
- [ ] I have added tests that prove my fix/feature works
- [ ] I have updated the documentation
- [ ] My changes generate no new warnings
```

## Style Guidelines

### TypeScript

We use TypeScript with strict mode:

```typescript
// Good
export function computeImportance(factors: ImportanceFactors): number {
  const { pagerank, fanIn, fanOut } = factors;
  return pagerank * 0.4 + Math.min(1, fanIn / 10) * 0.3 + Math.min(1, fanOut / 10) * 0.3;
}

// Avoid
export function computeImportance(f: any) {
  return f.pagerank * 0.4 + f.fanIn / 10 * 0.3 + f.fanOut / 10 * 0.3;
}
```

### Code Principles

1. **Explicit over implicit**: Make behavior obvious
2. **Small functions**: Each function does one thing
3. **Descriptive names**: Names should explain purpose
4. **No magic numbers**: Use named constants
5. **Error handling**: Handle errors explicitly
6. **Documentation**: Document public APIs

### File Organization

```
src/
├── core/           # Core types and utilities
├── api/            # Public API
├── quality/        # Quality detection
├── providers/      # LLM/auth providers
└── cli/            # CLI commands
```

### Formatting

We use Prettier and ESLint:

```bash
# Format code
npm run format

# Check formatting
npm run format:check

# Lint code
npm run lint

# Fix lint issues
npm run lint:fix
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test
npm test -- src/quality/issue_detector.test.ts

# Watch mode
npm run test:watch
```

### Writing Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { detectIssues } from './issue_detector';

describe('Issue Detector', () => {
  describe('detectLongMethod', () => {
    it('should flag functions over 100 lines', async () => {
      const fn = createMockFunction({ lines: 150 });
      const issues = await detectIssues([fn]);

      expect(issues).toHaveLength(1);
      expect(issues[0].category).toBe('size');
      expect(issues[0].severity).toBe('major');
    });

    it('should not flag functions under 100 lines', async () => {
      const fn = createMockFunction({ lines: 50 });
      const issues = await detectIssues([fn]);

      expect(issues).toHaveLength(0);
    });
  });
});
```

### Test Principles

1. **One concept per test**: Test one thing at a time
2. **Descriptive names**: Should read like documentation
3. **AAA pattern**: Arrange, Act, Assert
4. **No flaky tests**: Tests must be deterministic
5. **Fast tests**: Unit tests should be < 100ms

## Documentation

### Updating Docs

Documentation lives in:
- `README.md` - Main readme
- `docs/` - Detailed documentation
- `docs/api/` - API reference
- `docs/contributing/constructions.md` - How to write, test, and publish construction presets
- Code comments - Inline documentation

### Documentation Style

```typescript
/**
 * Query the LiBrainian for relevant context.
 *
 * @param options - Query options
 * @param options.intent - What you're trying to accomplish
 * @param options.depth - Context depth (L0-L3)
 * @returns Query result with context packs and summary
 *
 * @example
 * ```typescript
 * const result = await LiBrainian.query({
 *   intent: 'Add authentication',
 *   depth: 'L2',
 * });
 * console.log(result.summary);
 * ```
 */
export async function query(options: QueryOptions): Promise<QueryResult> {
  // ...
}
```

## Community

### Getting Help

- **Discord**: [Join our Discord](https://discord.gg/anthropic)
- **GitHub Discussions**: [Ask questions](https://github.com/nateschmiedehaus/LiBrainian/discussions)
- **Issues**: [Report bugs](https://github.com/nateschmiedehaus/LiBrainian/issues)

### Recognition

Contributors are recognized in:
- `CONTRIBUTORS.md`
- Release notes
- Our Discord #contributors channel

## Thank You!

Your contributions make LiBrainian better for everyone. We appreciate your time and effort!

---

*Questions? Reach out on Discord or open an issue.*
