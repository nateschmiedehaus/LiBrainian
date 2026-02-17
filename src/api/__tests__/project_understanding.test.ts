import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import {
  isProjectUnderstandingQuery,
  PROJECT_UNDERSTANDING_PATTERNS,
  extractProjectSummary,
} from '../project_understanding.js';

describe('isProjectUnderstandingQuery', () => {
  describe('matches project-level queries', () => {
    const projectQueries = [
      'what does this codebase do',
      'what is this project',
      'what does it do',
      'what is this for',
      'purpose of this codebase',
      'describe this project',
      'explain this codebase',
      'project overview',
      'codebase summary',
      'high-level overview',
      'architecture overview',
      'main features',
      'what can this do',
      'tell me about this project',
      'project structure',
      'how is this project organized',
    ];

    for (const query of projectQueries) {
      it(`matches "${query}"`, () => {
        expect(isProjectUnderstandingQuery(query)).toBe(true);
      });
    }
  });

  describe('does not match specific code queries', () => {
    const codeQueries = [
      'find the login function',
      'where is authentication implemented',
      'show me the database connection code',
      'fix the error in login',
      'how to add a new route',
      'refactor the user service',
    ];

    for (const query of codeQueries) {
      it(`does not match "${query}"`, () => {
        expect(isProjectUnderstandingQuery(query)).toBe(false);
      });
    }
  });
});

describe('PROJECT_UNDERSTANDING_PATTERNS', () => {
  it('has patterns for common project queries', () => {
    expect(PROJECT_UNDERSTANDING_PATTERNS.length).toBeGreaterThan(10);
  });

  it('patterns match "what does this codebase do"', () => {
    const matches = PROJECT_UNDERSTANDING_PATTERNS.filter(p =>
      p.test('what does this codebase do')
    );
    expect(matches.length).toBeGreaterThan(0);
  });

  it('patterns match "what is this project for"', () => {
    const matches = PROJECT_UNDERSTANDING_PATTERNS.filter(p =>
      p.test('what is this project for')
    );
    expect(matches.length).toBeGreaterThan(0);
  });
});

describe('extractProjectSummary', () => {
  // Use the actual librarian project as test workspace
  const workspaceRoot = path.resolve(process.cwd());

  it('extracts name from package.json', async () => {
    const summary = await extractProjectSummary(workspaceRoot);
    expect(summary.name).toBe('librainian');
  });

  it('extracts description from package.json', async () => {
    const summary = await extractProjectSummary(workspaceRoot);
    expect(summary.description).toBeTruthy();
    expect(summary.description.toLowerCase()).toContain('knowledge');
  });

  it('identifies entry points', async () => {
    const summary = await extractProjectSummary(workspaceRoot);
    expect(summary.entryPoints.length).toBeGreaterThan(0);
  });

  it('identifies tech stack', async () => {
    const summary = await extractProjectSummary(workspaceRoot);
    expect(summary.techStack).toContain('TypeScript');
  });

  it('includes source files in sources', async () => {
    const summary = await extractProjectSummary(workspaceRoot);
    expect(summary.sources).toContain('package.json');
  });

  it('has reasonable confidence', async () => {
    const summary = await extractProjectSummary(workspaceRoot);
    expect(summary.confidence).toBeGreaterThan(0.5);
  });
});
