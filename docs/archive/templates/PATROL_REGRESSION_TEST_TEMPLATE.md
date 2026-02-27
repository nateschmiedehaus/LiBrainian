# Patrol Regression Test Template

Use this template for every patrol finding before closing the issue.

## Finding Metadata

- Issue: `#<number>`
- Finding ID: `<stable-id>`
- Symptom (single line): `<what failed>`
- Scope: `<files/components affected>`

## Reproduction (Pre-Fix)

- Command / construction invocation:
  - `<command>`
- Expected pre-fix result:
  - `FAIL` with `<specific signal>`

## Regression Test (Construction-Level)

- Construction under test:
  - `<construction factory or id>`
- Test file:
  - `src/constructions/processes/__tests__/<test-name>.test.ts`
- Assertion contract:
  - `<what must remain true after fix>`

## Post-Fix Verification

- Build:
  - `npm run build`
- Targeted regression test:
  - `npm test -- --run src/constructions/processes/__tests__/<test-name>.test.ts`
- Patrol qualification:
  - `npm run test:unit-patrol`

## Issue Close Evidence

Post this in the issue close comment:

- Commit hash
- What changed (1-2 sentences)
- Regression test file path(s)
- Verification commands and pass status
