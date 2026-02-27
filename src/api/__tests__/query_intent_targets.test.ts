import { describe, expect, it } from 'vitest';
import {
  extractBugContext,
  extractCodeReviewFilePath,
  extractFeatureTarget,
  extractReferencedFilePath,
  extractRefactoringTarget,
  extractSecurityCheckTypes,
  extractWhyQueryTopics,
} from '../query_intent_targets.js';

describe('query intent target extractors', () => {
  it('extracts refactoring targets', () => {
    expect(extractRefactoringTarget('what would break if I changed SqliteLibrarianStorage')).toBe('SqliteLibrarianStorage');
    expect(extractRefactoringTarget('can I safely rename createLibrarian')).toBe('createLibrarian');
    expect(extractRefactoringTarget('general architecture question')).toBeUndefined();
  });

  it('extracts bug context', () => {
    expect(extractBugContext('debug the error in src/api/query.ts')).toBe('src/api/query.ts');
    expect(extractBugContext('investigate null pointer exception in bootstrap')).toBe('null pointer');
    expect(extractBugContext('all green')).toBeUndefined();
  });

  it('extracts security check types and defaults', () => {
    expect(extractSecurityCheckTypes('audit for sql injection and auth bypass')).toEqual(['injection', 'auth']);
    expect(extractSecurityCheckTypes('run a security audit')).toEqual(['injection', 'auth', 'crypto', 'exposure']);
  });

  it('extracts feature targets', () => {
    expect(extractFeatureTarget('where is authentication implemented')).toBe('authentication');
    expect(extractFeatureTarget('find the login feature')).toBe('login');
    expect(extractFeatureTarget('show me architecture overview')).toBeUndefined();
  });

  it('extracts code review file paths', () => {
    expect(extractCodeReviewFilePath('review file src/api/query.ts')).toBe('src/api/query.ts');
    expect(extractCodeReviewFilePath('please check "src/storage/types.ts"')).toBe('src/storage/types.ts');
    expect(extractCodeReviewFilePath('review this change')).toBeUndefined();
  });

  it('extracts file-path mentions from generic intents', () => {
    expect(extractReferencedFilePath('What does reccmp/compare/core.py do?')).toBe('reccmp/compare/core.py');
    expect(extractReferencedFilePath('inspect `src/api/query.ts` and summarize')).toBe('src/api/query.ts');
    expect(extractReferencedFilePath('why use sqlite')).toBeUndefined();
  });

  it('extracts why-query topics and comparison targets', () => {
    expect(extractWhyQueryTopics('why use embeddings instead of keywords')).toEqual({
      topic: 'embeddings',
      comparisonTopic: 'keywords',
    });
    expect(extractWhyQueryTopics('what is the rationale for caching')).toEqual({
      topic: 'caching',
      comparisonTopic: undefined,
    });
    expect(extractWhyQueryTopics('why is the system this way')).toEqual({
      topic: undefined,
      comparisonTopic: undefined,
    });
  });
});
