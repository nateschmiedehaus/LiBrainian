import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURE_VERIFICATION_PATTERNS,
  BUG_INVESTIGATION_PATTERNS,
  CODE_QUALITY_PATTERNS,
  CODE_QUERY_PATTERNS,
  CODE_REVIEW_QUERY_PATTERNS,
  DEFINITION_QUERY_PATTERNS,
  ENTRY_POINT_NAME_PATTERNS,
  ENTRY_POINT_PATH_PATTERNS,
  ENTRY_POINT_QUERY_PATTERNS,
  FEATURE_LOCATION_PATTERNS,
  META_QUERY_PATTERNS,
  REFACTORING_OPPORTUNITIES_PATTERNS,
  REFACTORING_SAFETY_PATTERNS,
  SECURITY_AUDIT_PATTERNS,
  WHY_QUERY_PATTERNS,
} from '../query_intent_patterns.js';

function hasMatch(patterns: RegExp[], intent: string): boolean {
  return patterns.some(pattern => pattern.test(intent));
}

describe('query_intent_patterns', () => {
  it('matches canonical meta-query intents', () => {
    expect(hasMatch(META_QUERY_PATTERNS, 'How should an agent use Librarian?')).toBe(true);
    expect(hasMatch(META_QUERY_PATTERNS, 'getting started guide')).toBe(true);
  });

  it('matches canonical code-query intents', () => {
    expect(hasMatch(CODE_QUERY_PATTERNS, 'where is queryLibrarian defined')).toBe(true);
    expect(hasMatch(CODE_QUERY_PATTERNS, 'find bug in authentication module')).toBe(true);
  });

  it('matches canonical definition-query intents', () => {
    expect(hasMatch(DEFINITION_QUERY_PATTERNS, 'What is the storage interface?')).toBe(true);
    expect(hasMatch(DEFINITION_QUERY_PATTERNS, 'QueryOptions type definition')).toBe(true);
  });

  it('matches canonical entry-point intents', () => {
    expect(hasMatch(ENTRY_POINT_QUERY_PATTERNS, 'where to start')).toBe(true);
    expect(hasMatch(ENTRY_POINT_QUERY_PATTERNS, 'main entry point')).toBe(true);
  });

  it('does not over-match architecture overview intents as entry-point intents', () => {
    expect(hasMatch(ENTRY_POINT_QUERY_PATTERNS, 'what are the main modules')).toBe(false);
    expect(hasMatch(ENTRY_POINT_QUERY_PATTERNS, 'architecture overview')).toBe(false);
  });

  it('matches canonical why-query intents', () => {
    expect(hasMatch(WHY_QUERY_PATTERNS, 'why use sqlite')).toBe(true);
    expect(hasMatch(WHY_QUERY_PATTERNS, 'rationale for caching')).toBe(true);
  });

  it('matches canonical refactoring-safety intents', () => {
    expect(hasMatch(REFACTORING_SAFETY_PATTERNS, 'what would break if I changed queryLibrarian')).toBe(true);
    expect(hasMatch(REFACTORING_SAFETY_PATTERNS, 'can I safely rename createLibrarian')).toBe(true);
  });

  it('matches canonical bug/security/architecture intents', () => {
    expect(hasMatch(BUG_INVESTIGATION_PATTERNS, 'debug this bug')).toBe(true);
    expect(hasMatch(SECURITY_AUDIT_PATTERNS, 'check for SQL injection')).toBe(true);
    expect(hasMatch(ARCHITECTURE_VERIFICATION_PATTERNS, 'verify architecture boundaries')).toBe(true);
  });

  it('matches canonical quality/review/location/refactor-opportunity intents', () => {
    expect(hasMatch(CODE_QUALITY_PATTERNS, 'code quality report')).toBe(true);
    expect(hasMatch(CODE_REVIEW_QUERY_PATTERNS, 'review this file before merge')).toBe(true);
    expect(hasMatch(FEATURE_LOCATION_PATTERNS, 'where is authentication implemented')).toBe(true);
    expect(hasMatch(REFACTORING_OPPORTUNITIES_PATTERNS, 'what should I refactor')).toBe(true);
  });

  it('matches canonical entry-point name and path signals', () => {
    expect(hasMatch(ENTRY_POINT_NAME_PATTERNS, 'createLibrarian')).toBe(true);
    expect(hasMatch(ENTRY_POINT_PATH_PATTERNS, '/workspace/src/index.ts')).toBe(true);
  });
});
