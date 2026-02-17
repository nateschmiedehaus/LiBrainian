# Blocker Resolution Guide

> **Purpose**: Exhaustive guide to resolving any blocker encountered during implementation.
> **Rule**: NEVER stop on a blocker. Always resolve it using this guide, then continue.

---

## Core Principle

**You have full autonomy to resolve blockers. Do not ask for permission. Do not stop.**

If this guide doesn't cover a blocker, add the resolution to this guide after you solve it.

---

## Environment Blockers

### `vitest: command not found` / `npm: command not found`
```bash
npm install
```

### `Cannot find module 'X'`
```bash
npm install
# If still fails, check if module is in package.json
# If not, add it: npm install X --save-dev (for dev deps) or --save (for runtime)
```

### `ENOENT: no such file or directory 'X'`
```bash
# Create parent directories
mkdir -p $(dirname X)
# Then create the file or let the write operation create it
```

### `Permission denied`
```bash
# Check if file should be writable
chmod +w <file>
# Or check if you're in the right directory
pwd
```

### `tsc: error TS2307: Cannot find module`
```bash
# Missing type definitions
npm install @types/<package> --save-dev
# Or check tsconfig.json paths
```

### `ENOMEM` / Out of memory
```bash
# Increase Node memory
export NODE_OPTIONS="--max-old-space-size=4096"
# Then retry
```

### External real repos unavailable
**Scenario**: GitHub/network access fails when trying to clone external repos.

**Resolution**:
1. Retry with different repos from `gh search repos`
2. If network is down, wait and retry later
3. Document which repos were successfully cloned in `eval-corpus/external-repos/manifest.json`
4. This is a required gate - do not skip with `unverified_by_trace`

---

## TypeScript Blockers

### `error TS2345: Argument of type 'X' is not assignable to type 'Y'`
**Resolution**: Fix the type. Common patterns:
```typescript
// Add type assertion if you're confident
const x = value as ExpectedType;

// Or fix the source type
interface FixedType { ... }

// Or use type guard
if (isExpectedType(value)) { ... }
```

### `error TS2339: Property 'X' does not exist on type 'Y'`
**Resolution**:
```typescript
// Add the property to the interface
interface Y {
  X: SomeType;
}

// Or use optional chaining if it might not exist
obj?.X

// Or extend the type
interface ExtendedY extends Y {
  X: SomeType;
}
```

### `error TS7006: Parameter 'x' implicitly has an 'any' type`
**Resolution**: Add explicit type annotation
```typescript
function foo(x: string) { ... }
```

### Circular dependency detected
**Resolution**:
1. Identify the cycle using `madge --circular src/`
2. Extract shared types to a separate file
3. Use dependency injection instead of direct imports
4. Use `import type` for type-only imports

---

## Test Blockers

**CRITICAL: Test failures are PRIORITY ZERO. Fix them before any other work.**

### Test file not found
```bash
# Create the test file
touch src/__tests__/missing_test.test.ts
# Add minimal test structure
```

### Test timeout
```typescript
// Increase timeout for slow tests
test('slow test', async () => { ... }, 30000);

// Or optimize the test
// Or mock slow dependencies
```

### Provider unavailable in test
**Resolution by tier**:
- **Tier-0**: Remove provider dependency. Tier-0 must be deterministic.
- **Tier-1**: Use `ctx.skip()` with disclosure
  ```typescript
  test('requires provider', async (ctx) => {
    if (!providerAvailable) {
      ctx.skip();
      return;
    }
    // ... test
  });
  ```
- **Tier-2**: Let it fail with honest error, document in STATUS.md

### `requireProviders` in Tier-0 test (test_tiering_guard failure)
**Error**: `test_tiering_guard.test.ts` fails because a test file uses `requireProviders` but is in Tier-0.

**Resolution**:
1. Open the offending test file (identified in error message)
2. Choose ONE of these fixes:
   - **Remove provider dependency**: If test doesn't actually need providers, remove the `requireProviders` call
   - **Move to Tier-1**: Add proper skip logic:
     ```typescript
     import { requireProviders } from '../test_utils';

     describe('feature', () => {
       beforeAll(() => {
         if (!requireProviders()) {
           return; // Will skip in Tier-0
         }
       });
       // ... tests
     });
     ```
   - **Mock the provider**: Replace real provider with mock for deterministic behavior

### Assertion count/value mismatch
**Error**: `expected X to be greater than or equal to Y` or similar assertion failures.

**Resolution**:
1. Understand what the test is checking
2. Determine if the expectation or implementation is wrong:
   - **Implementation wrong**: Fix the code to produce expected output
   - **Test expectation wrong**: Update the test to match correct behavior
3. Run the specific test to verify: `npm test -- --run path/to/test.ts`
4. Run full suite to check for regressions: `npm test -- --run`

### Mock not working
```typescript
// Use vi.mock at top of file
vi.mock('./dependency', () => ({
  default: vi.fn(),
  namedExport: vi.fn(),
}));

// Or use vi.spyOn for partial mocks
vi.spyOn(object, 'method').mockReturnValue(value);
```

### Snapshot mismatch
```bash
# If change is intentional, update snapshot
npm test -- --run --update
# If not, fix the code to match expected output
```

### Multiple test failures after a change
**Resolution**:
1. Run `git diff` to see what changed
2. Identify if one change broke multiple tests
3. Fix the root cause, not each symptom
4. Consider reverting if change was wrong

---

## Build Blockers

### Build fails with syntax error
**Resolution**: Fix the syntax error. Common issues:
- Missing comma/semicolon
- Unclosed bracket/brace
- Invalid JSX
- Template literal issues

### Build succeeds but runtime fails
**Resolution**:
1. Check if build output exists: `ls dist/`
2. Check for runtime-only imports that weren't bundled
3. Verify environment variables are set
4. Check for missing polyfills

### Circular import in build
**Resolution**: Same as TypeScript circular dependency above.

---

## Git Blockers

### Merge conflict
```bash
# View conflicts
git diff --name-only --diff-filter=U

# For each file, resolve conflicts manually:
# Keep the code that makes sense, remove conflict markers

# Then:
git add <resolved-files>
git commit -m "fix: resolve merge conflicts"
```

### Detached HEAD
```bash
git checkout main
# Or create a branch from current state
git checkout -b recovery-branch
```

### Uncommitted changes blocking operation
```bash
git stash
# Do operation
git stash pop
```

---

## Provider Blockers

### LLM provider unavailable
**Resolution**:
1. For Tier-0: This should never happen. Remove provider dependency.
2. For Tier-1: Skip gracefully with `unverified_by_trace(provider_unavailable)`
3. For Tier-2: Document in STATUS.md, move to next task

### Embedding provider unavailable
**Resolution**: Same as LLM provider. Never fake embeddings.

### Rate limited
```typescript
// Add exponential backoff
const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
await new Promise(r => setTimeout(r, delay));
// Retry
```

### Authentication failed
**Resolution**:
1. Check CLI auth: `claude auth status` or equivalent
2. Re-authenticate if needed
3. Document if auth is blocking and move to next task

---

## Spec System Blockers

### Spec file not found
**Resolution**:
1. Check `docs/LiBrainian/specs/` for similar files
2. If truly missing, the spec may be in a different location
3. Search: `find docs -name "*.md" | xargs grep "keyword"`

### Spec is ambiguous
**Resolution**:
1. Check `BEHAVIOR_INDEX.md` for the spec's entry
2. Check related specs for clarification
3. Make a reasonable decision, document it in STATUS.md
4. Add clarification to the spec for future reference

### Spec conflicts with implementation
**Resolution**:
1. Spec is authoritative for intended behavior
2. Fix implementation to match spec
3. If spec is clearly wrong, update spec AND implementation

### Missing test pattern in spec
**Resolution**:
1. Follow the naming convention: `src/__tests__/<feature>.test.ts`
2. Or `src/<module>/__tests__/<feature>.test.ts`
3. Add the test pattern to the spec for future reference

---

## Dependency Blockers

### Package version conflict
```bash
# Check what's conflicting
npm ls <package>

# Try to resolve
npm update <package>

# If still failing, check for peer dependency issues
npm install --legacy-peer-deps
```

### Missing peer dependency
```bash
npm install <peer-dependency>
```

### Deprecated package warning
**Resolution**: Ignore warnings unless they cause failures. Focus on errors.

---

## Architecture Blockers

### File in wrong location
**Resolution**: Move it to the right location per spec
```bash
mkdir -p <correct-directory>
mv <file> <correct-directory>/
# Update all imports
```

### Module boundary violation
**Resolution**:
1. Check `specs/INTEGRATION_CHANGE_LIST.md` for boundaries
2. Move code to correct module
3. Export through proper public API

### Circular architecture dependency
**Resolution**:
1. Identify the cycle
2. Extract shared code to a lower-level module
3. Use events/callbacks instead of direct imports

---

## Unknown Blockers

If you encounter a blocker not listed here:

1. **Analyze the error message** — What is it actually saying?
2. **Search the codebase** — Has this been solved before?
   ```bash
   grep -r "error message" .
   ```
3. **Check if it's environment-specific** — Does it fail only in CI, only locally?
4. **Try the obvious fix** — Most blockers have straightforward solutions
5. **Document the solution** — Add it to this file for future reference

### Adding New Resolutions

When you solve a new blocker, add it to this file:

```markdown
### [Error message or blocker type]
**Resolution**:
[Steps to resolve]
```

Then commit:
```bash
git add docs/LiBrainian/specs/BLOCKER_RESOLUTION.md
git commit -m "docs(specs): add resolution for [blocker type]"
```

---

## Evaluation Blockers

### "Need human annotation for ground truth"
**Resolution**: Use machine-verifiable ground truth instead:
1. AST parsing for structural facts (function definitions, imports, call graphs)
2. TypeScript compiler for type information
3. Test execution for behavioral verification
4. Consistency checking across query variants

See: `docs/LiBrainian/specs/track-eval-machine-verifiable.md`

### "All eval repos are synthetic / created by model"
**Resolution**: This is INVALID evaluation. Clone real external repos:
```bash
# Find recent, obscure TypeScript repos
gh search repos --language=typescript --created=">2024-06-01" --stars="10..100" --limit=20
```

**Requirements for valid eval repos:**
- NOT created by AI/model being evaluated
- Real open-source projects from GitHub
- Preferably recent (post-training cutoff) or obscure (low stars)
- Must have actual source code, not just scaffolding

### "Can't verify semantic claims automatically"
**Resolution**: Focus on verifiable claims:
- Existence claims → file/line existence check
- Structural claims → AST verification
- Behavioral claims → test execution
- Consistency → multi-query comparison

Leave subjective claims unverified but disclosed.

---

## Current Priority: WU-801-REAL (2026-01-26)

The `eval-corpus/repos/*` directories have no git remotes (not real cloned repos).

**Next work unit:** WU-801-REAL — Clone real external repos from GitHub.

See `/HARD_STOP.md` for the full work unit prompt.

---

## Meta-Rule

**If a blocker seems insurmountable:**

1. Is it actually blocking? Maybe you can work around it.
2. Is it in scope? Maybe it's a Tier-2 issue you can document and skip.
3. Is it a hard stop? Check the 5 hard stops in AGENTS.md:
   - Fake embeddings
   - API key auth
   - Silent degradation
   - Theater (fake tests)
   - Circular evaluation (model evaluating its own outputs) ← **CURRENTLY ACTIVE**
   - 3+ consecutive failures on same task

**Only these things should stop you. Everything else has a resolution.**
