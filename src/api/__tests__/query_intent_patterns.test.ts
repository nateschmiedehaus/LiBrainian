import { describe, expect, it } from 'vitest';
import {
  CODE_QUERY_PATTERNS,
  DEFINITION_QUERY_PATTERNS,
  ENTRY_POINT_QUERY_PATTERNS,
  META_QUERY_PATTERNS,
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

  it('matches canonical why-query intents', () => {
    expect(hasMatch(WHY_QUERY_PATTERNS, 'why use sqlite')).toBe(true);
    expect(hasMatch(WHY_QUERY_PATTERNS, 'rationale for caching')).toBe(true);
  });
});
