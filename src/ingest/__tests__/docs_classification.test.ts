import { describe, it, expect } from 'vitest';
import { classifyDocument, detectHowToContent, generateDocEmbeddingInput, type DocHeading } from '../docs_indexer.js';

describe('classifyDocument', () => {
  describe('agent documentation detection', () => {
    it('classifies AGENTS.md as high-relevance agent doc', () => {
      const result = classifyDocument('AGENTS.md');
      expect(result.isMetaDoc).toBe(true);
      expect(result.relevanceBoost).toBe(1.0);
      expect(result.audience).toBe('agent');
    });

    it('classifies docs/AGENTS.md as high-relevance agent doc', () => {
      const result = classifyDocument('docs/AGENTS.md');
      expect(result.isMetaDoc).toBe(true);
      expect(result.relevanceBoost).toBe(1.0);
      expect(result.audience).toBe('agent');
    });

    it('classifies CLAUDE.md as agent doc', () => {
      const result = classifyDocument('CLAUDE.md');
      expect(result.isMetaDoc).toBe(true);
      expect(result.relevanceBoost).toBe(1.0);
      expect(result.audience).toBe('agent');
    });

    it('classifies CODEX.md as agent doc', () => {
      const result = classifyDocument('CODEX.md');
      expect(result.isMetaDoc).toBe(true);
      expect(result.relevanceBoost).toBe(1.0);
      expect(result.audience).toBe('agent');
    });

    it('classifies docs/archive/AGENT_INTEGRATION.md as agent doc', () => {
      const result = classifyDocument('docs/archive/AGENT_INTEGRATION.md');
      expect(result.isMetaDoc).toBe(true);
      expect(result.relevanceBoost).toBe(1.0);
      expect(result.audience).toBe('agent');
    });
  });

  describe('README detection', () => {
    it('classifies README.md as general doc with high relevance', () => {
      const result = classifyDocument('README.md');
      expect(result.isMetaDoc).toBe(true);
      expect(result.relevanceBoost).toBe(0.8);
      expect(result.audience).toBe('general');
    });

    it('classifies nested README.md with good relevance', () => {
      const result = classifyDocument('src/api/README.md');
      expect(result.relevanceBoost).toBeGreaterThanOrEqual(0.7);
      // README matches general pattern first
    });
  });

  describe('regular docs', () => {
    it('classifies non-pattern matching docs with default relevance', () => {
      const result = classifyDocument('docs/guide/setup.md');
      expect(result.relevanceBoost).toBeGreaterThanOrEqual(0.3);
      // Only librarian/** docs have the 0.5 boost, other docs get default
    });

    it('classifies random markdown with low relevance', () => {
      const result = classifyDocument('notes/random.md');
      expect(result.isMetaDoc).toBe(false);
      expect(result.relevanceBoost).toBe(0.3);
      expect(result.audience).toBe('general');
    });
  });
});

describe('detectHowToContent', () => {
  const makeHeadings = (texts: string[]): DocHeading[] =>
    texts.map((text, i) => ({ level: i === 0 ? 1 : 2, text, line: i + 1 }));

  it('detects "How to use" in headings', () => {
    const headings = makeHeadings(['How to Use Librarian']);
    expect(detectHowToContent('', headings)).toBe(true);
  });

  it('detects "Getting Started" in content', () => {
    expect(detectHowToContent('Getting started with the API', [])).toBe(true);
  });

  it('detects "best practice" in content', () => {
    expect(detectHowToContent('best practices for error handling', [])).toBe(true);
  });

  it('detects "workflow" in headings', () => {
    const headings = makeHeadings(['Development Workflow']);
    expect(detectHowToContent('', headings)).toBe(true);
  });

  it('returns false for code documentation', () => {
    expect(detectHowToContent('This function calculates the hash', [])).toBe(false);
  });
});

describe('generateDocEmbeddingInput', () => {
  it('prepends agent tag for agent audience', () => {
    const input = generateDocEmbeddingInput({
      title: 'Agent Instructions',
      summary: 'How to use the system',
      purpose: 'Instructions for AI agents',
      headings: ['Setup', 'Usage'],
      audience: 'agent',
      relativePath: 'AGENTS.md',
    });

    expect(input).toContain('[AGENT DOCUMENTATION]');
    expect(input).toContain('Agent Instructions');
    expect(input).toContain('Instructions for AI agents');
    expect(input).toContain('AGENTS.md');
  });

  it('does not prepend agent tag for developer audience', () => {
    const input = generateDocEmbeddingInput({
      title: 'API Reference',
      summary: 'API documentation',
      purpose: 'Reference for developers',
      headings: ['Methods', 'Types'],
      audience: 'developer',
      relativePath: 'docs/api.md',
    });

    expect(input).not.toContain('[AGENT DOCUMENTATION]');
    expect(input).toContain('API Reference');
  });

  it('includes topics from headings', () => {
    const input = generateDocEmbeddingInput({
      title: 'Guide',
      summary: 'A comprehensive guide',
      purpose: 'Help users',
      headings: ['Installation', 'Configuration', 'Usage'],
      audience: 'general',
      relativePath: 'guide.md',
    });

    expect(input).toContain('Topics: Installation, Configuration, Usage');
  });
});
