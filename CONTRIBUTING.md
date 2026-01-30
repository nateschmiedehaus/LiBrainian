# Contributing to Librarian

First off, thank you for considering contributing to Librarian! It's people like you that make Librarian such a great tool for the developer community.

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

1. Check existing [issues](https://github.com/librarian-ai/librarian/issues) and [PRs](https://github.com/librarian-ai/librarian/pulls)
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
git clone https://github.com/librarian-ai/librarian.git
cd librarian

# Install dependencies
npm install

# Build the project
npm run build

# Run tests to verify setup
npm test

# Start development mode
npm run dev
```

### Environment Variables

For full functionality, set these (all optional):

```bash
# LLM providers (optional - works without)
export ANTHROPIC_API_KEY=your-key
export OPENAI_API_KEY=your-key

# Development
export DEBUG=librarian:*
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
5. **Run the full test suite**
6. **Submit a PR**

## Submitting Changes

### Pull Request Process

1. **Update the README.md** with details of changes if applicable
2. **Add tests** that prove your fix/feature works
3. **Ensure CI passes** - all tests and linting must pass
4. **Request review** from maintainers
5. **Address feedback** promptly

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
- Code comments - Inline documentation

### Documentation Style

```typescript
/**
 * Query the librarian for relevant context.
 *
 * @param options - Query options
 * @param options.intent - What you're trying to accomplish
 * @param options.depth - Context depth (L0-L3)
 * @returns Query result with context packs and summary
 *
 * @example
 * ```typescript
 * const result = await librarian.query({
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
- **GitHub Discussions**: [Ask questions](https://github.com/librarian-ai/librarian/discussions)
- **Issues**: [Report bugs](https://github.com/librarian-ai/librarian/issues)

### Recognition

Contributors are recognized in:
- `CONTRIBUTORS.md`
- Release notes
- Our Discord #contributors channel

## Thank You!

Your contributions make Librarian better for everyone. We appreciate your time and effort!

---

*Questions? Reach out on Discord or open an issue.*
