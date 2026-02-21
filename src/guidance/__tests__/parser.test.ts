/**
 * @fileoverview Tests for AGENTS.md Parser
 *
 * Tests cover:
 * - Basic parsing
 * - Section extraction (mission, commands, rules, etc.)
 * - Frontmatter handling
 * - Code block extraction
 * - Error handling
 * - Pack merging
 */

import { describe, it, expect } from 'vitest';
import {
  parseGuidanceFile,
  createGuidanceSource,
  mergeGuidancePacks,
  DEFAULT_PARSER_CONFIG,
} from '../parser.js';
import type { GuidanceSource, AgentGuidancePack } from '../types.js';
import { createEmptyGuidancePack } from '../types.js';

describe('AGENTS.md Parser', () => {
  const createSource = (path: string = 'AGENTS.md'): GuidanceSource => ({
    path,
    absolutePath: `/workspace/${path}`,
    type: 'AGENTS.md',
    depth: 0,
    priority: 1,
    hash: 'testhash123',
    lastModified: '2026-01-08T00:00:00Z',
  });

  describe('Basic Parsing', () => {
    it('should parse empty content', () => {
      const result = parseGuidanceFile('', createSource());

      expect(result.pack).toBeDefined();
      expect(result.pack.sources.length).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0); // Empty pack error
    });

    it('should parse minimal AGENTS.md', () => {
      const content = `# Mission

This is a test mission.

## Commands

Build:
- \`build\` - Build the project

Test:
- \`test\` - Run tests
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.mission).toBeDefined();
      expect(result.pack.commands).toBeDefined();
      expect(result.errors.length).toBe(0);
    });

    it('should handle markdown headers at different levels', () => {
      const content = `# Mission
Top level mission.

## Commands
Build:
- \`cmd1\` - First command

### Subcommands
- \`cmd2\` - Nested command
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.mission).toBeDefined();
      expect(result.pack.commands).toBeDefined();
    });
  });

  describe('Mission Section', () => {
    it('should parse mission statement', () => {
      const content = `# Mission

Build the best code assistant ever.

Goals:
- Help developers write better code
- Reduce bugs

Avoid:
- Never delete user data
- Always ask before destructive actions
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.mission?.mission).toBeTruthy();
      expect(result.pack.mission?.goals?.length).toBe(2);
      expect(result.pack.mission?.avoids?.length).toBe(2);
    });

    it('should handle mission with philosophy', () => {
      const content = `# Purpose

A coding assistant for TypeScript projects.

Philosophy:
- Working in Node.js environments
- Using modern ES modules
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.mission).toBeDefined();
      expect(result.pack.mission?.philosophy?.length).toBe(2);
    });
  });

  describe('Commands Section', () => {
    it('should parse command definitions into categories', () => {
      const content = `## Commands

Build:
- \`npm run build\` - Build the project

Test:
- \`npm test\` - Run all tests

Lint:
- \`npm run lint\` - Check code style
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.commands?.build).toBeDefined();
      expect(result.pack.commands?.build?.command).toBe('npm run build');
      expect(result.pack.commands?.lint).toBeDefined();
    });

    it('should parse test commands into a map', () => {
      const content = `## Commands

Test:
- \`unit\` - Run unit tests
- \`integration\` - Run integration tests
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.commands?.test).toBeDefined();
      expect(result.pack.commands?.test?.['unit']).toBeDefined();
      expect(result.pack.commands?.test?.['integration']).toBeDefined();
    });

    it('should extract code block as build command', () => {
      const content = `## Commands

\`\`\`bash
npm run build
\`\`\`
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.commands?.build).toBeDefined();
    });
  });

  describe('Rules Section', () => {
    it('should parse commit format rules', () => {
      const content = `## Rules

### Commit Format
- Use conventional commits
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.rules?.commitFormat).toBeDefined();
      expect(result.pack.rules?.commitFormat?.format).toBe('Use conventional commits');
    });

    it('should parse file naming rules', () => {
      const content = `## Guidelines

### File Naming
- Use kebab-case for files
- Use PascalCase for components
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.rules?.fileNaming?.length).toBe(2);
      expect(result.pack.rules?.fileNaming?.[0].convention).toBe('kebab-case');
    });

    it('should parse import rules', () => {
      const content = `## Standards

### Imports
- Prefer named imports over default
- Avoid circular dependencies
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.rules?.imports?.length).toBe(2);
    });
  });

  describe('Safety Section', () => {
    it('should parse forbidden patterns', () => {
      const content = `## Safety

### Forbidden
- Never expose secrets in logs
- Don't commit .env files
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.safety.forbidden.length).toBe(2);
      expect(result.pack.safety.forbidden[0].isRegex).toBe(false);
    });

    it('should parse required patterns', () => {
      const content = `## Security

### Required
- Must validate all user input
- Always sanitize HTML output
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.safety.required.length).toBe(2);
      expect(result.pack.safety.required[0].scope).toBe('project');
    });

    it('should detect critical severity', () => {
      const content = `## Safety

### Forbidden
- CRITICAL: Never disable security checks
- Avoid console.log in production
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.safety.forbidden[0].severity).toBe('error');
      expect(result.pack.safety.forbidden[1].severity).toBe('warning');
    });
  });

  describe('Agent-Specific Section', () => {
    it('should parse Claude-specific instructions', () => {
      const content = `## Claude-Specific

### Superpowers
- Use concise responses
- Prefer code examples

### Duties
- Don't generate long explanations
`;

      const result = parseGuidanceFile(content, createSource('CLAUDE.md'));

      expect(result.pack.agentSpecific?.agent).toBe('claude');
      expect(result.pack.agentSpecific?.superpowers?.length).toBe(2);
      expect(result.pack.agentSpecific?.duties?.length).toBe(1);
    });

    it('should detect agent from header', () => {
      const content = `## Codex Agent

- Optimize for code completion
`;

      const result = parseGuidanceFile(content, createSource('CODEX.md'));

      expect(result.pack.agentSpecific?.agent).toBe('codex');
    });
  });

  describe('Code Quality Section', () => {
    it('should parse anti-slop patterns', () => {
      const content = `## Code Quality

- Avoid deeply nested callbacks
- Don't use any type
- Never ignore TypeScript errors
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.codeQuality.antiSlop.length).toBe(3);
      expect(result.pack.codeQuality.antiSlop[0].name).toBeDefined();
      expect(result.pack.codeQuality.antiSlop[0].action).toBeDefined();
    });

    it('should parse complexity rules', () => {
      const content = `## Anti-Slop

- Maximum cyclomatic complexity: 10
- Avoid nesting deeper than 3 levels
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.codeQuality.complexity?.length).toBeGreaterThanOrEqual(1);
      expect(result.pack.codeQuality.complexity?.[0].metric).toBeDefined();
    });
  });

  describe('Testing Section', () => {
    it('should parse test tiers', () => {
      const content = `## Testing

### Tier 0 - Unit Tests
- Must run in under 1 second
- No external dependencies

### Tier 1 - Integration Tests
- Can use database
- Max 10 second timeout
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.testing?.tiers?.length).toBe(2);
      expect(result.pack.testing?.tiers?.[0].name).toBe('tier0');
      expect(result.pack.testing?.tiers?.[1].name).toBe('tier1');
    });

    it('should parse coverage requirements', () => {
      const content = `## Test Requirements

- Minimum 80% coverage for new code
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.testing?.coverage?.lines).toBe(80);
    });
  });

  describe('Integrations Section', () => {
    it('should parse MCP integrations', () => {
      const content = `## Integrations

- MCP: filesystem server for file access
- LiBrainian: semantic search enabled
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.integrations?.mcp?.enabled).toBe(true);
      expect(result.pack.integrations?.librainian).toBeDefined();
      expect(result.pack.integrations?.librainian?.enabled).toBe(true);
    });

    it('should parse tool integrations', () => {
      const content = `## Tools

- prettier: code formatting
- eslint: linting (optional)
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.integrations?.tools?.length).toBe(2);
      expect(result.pack.integrations?.tools?.[0].type).toBe('external');
    });
  });

  describe('Frontmatter', () => {
    it('should parse YAML frontmatter', () => {
      const content = `---
version: 2.0.0
priority: 10
---

# Mission

Test mission
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.schemaVersion).toBe('2.0.0');
      expect(result.pack.sources[0].priority).toBe(10);
    });

    it('should handle missing frontmatter', () => {
      const content = `# Mission

No frontmatter here.
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.mission).toBeDefined();
      expect(result.warnings.length).toBe(0);
    });

    it('should handle malformed frontmatter gracefully', () => {
      // Our simple parser is tolerant of malformed YAML
      // It just treats unparseable values as strings
      const content = `---
invalid yaml: [
---

# Mission

Test mission
`;

      const result = parseGuidanceFile(content, createSource());

      // Parser should still work, just ignoring the invalid frontmatter
      expect(result.pack.mission).toBeDefined();
    });
  });

  describe('Raw Sections', () => {
    it('should preserve raw sections when configured', () => {
      const content = `# Mission

The mission statement.

## Commands

Build:
- \`cmd\` - A command
`;

      const result = parseGuidanceFile(content, createSource(), {
        ...DEFAULT_PARSER_CONFIG,
        preserveRawSections: true,
      });

      expect(result.pack.rawSections.length).toBe(2);
      expect(result.pack.rawSections[0].heading).toBe('Mission');
    });

    it('should not preserve raw sections when disabled', () => {
      const content = `# Mission

Test
`;

      const result = parseGuidanceFile(content, createSource(), {
        ...DEFAULT_PARSER_CONFIG,
        preserveRawSections: false,
      });

      expect(result.pack.rawSections.length).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should report empty pack error', () => {
      const result = parseGuidanceFile('', createSource());

      expect(result.errors.some((e) => e.code === 'EMPTY_PACK')).toBe(true);
    });

    it('should continue parsing after section error', () => {
      const content = `# Mission

Valid mission.

## Commands

Build:
- \`valid\` - A valid command
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.mission).toBeDefined();
      expect(result.pack.commands).toBeDefined();
    });
  });

  describe('Source Creation', () => {
    it('should create source with correct properties', () => {
      const source = createGuidanceSource(
        'packages/app/AGENTS.md',
        '/workspace/packages/app/AGENTS.md',
        '/workspace',
        'abc123',
        '2026-01-08T12:00:00Z'
      );

      expect(source.path).toBe('packages/app/AGENTS.md');
      expect(source.type).toBe('AGENTS.md');
      expect(source.depth).toBe(2);
      expect(source.hash).toBe('abc123');
    });

    it('should calculate correct priority', () => {
      const rootSource = createGuidanceSource(
        'AGENTS.md',
        '/workspace/AGENTS.md',
        '/workspace',
        'hash1',
        '2026-01-08T00:00:00Z'
      );

      const nestedSource = createGuidanceSource(
        'packages/AGENTS.md',
        '/workspace/packages/AGENTS.md',
        '/workspace',
        'hash2',
        '2026-01-08T00:00:00Z'
      );

      expect(rootSource.priority).toBeLessThan(nestedSource.priority);
    });
  });

  describe('Pack Merging', () => {
    it('should return empty pack for empty input', () => {
      const result = mergeGuidancePacks([], '/workspace/src');

      expect(result.sources.length).toBe(0);
    });

    it('should return single pack unchanged', () => {
      const pack = createEmptyGuidancePack('/workspace', '/workspace/src');
      pack.sources = [createSource()];
      pack.mission = { mission: 'Test' };

      const result = mergeGuidancePacks([pack], '/workspace/src');

      expect(result).toEqual(pack);
    });

    it('should merge custom commands from multiple packs', () => {
      const pack1 = createEmptyGuidancePack('/workspace', '/workspace/src');
      pack1.sources = [{ ...createSource(), priority: 1 }];
      pack1.mission = { mission: 'Test' };
      pack1.commands = { custom: { cmd1: { command: 'cmd1', description: 'First' } } };

      const pack2 = createEmptyGuidancePack('/workspace', '/workspace/packages');
      pack2.sources = [{ ...createSource('packages/AGENTS.md'), priority: 101 }];
      pack2.commands = { custom: { cmd2: { command: 'cmd2', description: 'Second' } } };

      const result = mergeGuidancePacks([pack1, pack2], '/workspace/src');

      expect(result.commands?.custom?.cmd1).toBeDefined();
      expect(result.commands?.custom?.cmd2).toBeDefined();
      expect(result.sources.length).toBe(2);
    });

    it('should prioritize higher priority pack for mission', () => {
      const pack1 = createEmptyGuidancePack('/workspace', '/workspace/src');
      pack1.sources = [{ ...createSource(), priority: 1 }];
      pack1.mission = { mission: 'Root mission' };

      const pack2 = createEmptyGuidancePack('/workspace', '/workspace/nested');
      pack2.sources = [{ ...createSource('nested/AGENTS.md'), priority: 101 }];
      pack2.mission = { mission: 'Nested mission' };

      const result = mergeGuidancePacks([pack2, pack1], '/workspace/src');

      expect(result.mission?.mission).toBe('Root mission');
    });

    it('should merge safety rules additively', () => {
      const pack1 = createEmptyGuidancePack('/workspace', '/workspace/src');
      pack1.sources = [{ ...createSource(), priority: 1 }];
      pack1.safety = {
        forbidden: [{ pattern: 'pattern1', isRegex: false, reason: 'reason1', severity: 'error' }],
        required: [],
        auth: [],
        network: [],
        fileAccess: [],
      };

      const pack2 = createEmptyGuidancePack('/workspace', '/workspace/nested');
      pack2.sources = [{ ...createSource('nested/AGENTS.md'), priority: 101 }];
      pack2.safety = {
        forbidden: [{ pattern: 'pattern2', isRegex: false, reason: 'reason2', severity: 'error' }],
        required: [],
        auth: [],
        network: [],
        fileAccess: [],
      };

      const result = mergeGuidancePacks([pack1, pack2], '/workspace/src');

      expect(result.safety.forbidden.length).toBe(2);
    });
  });

  describe('Metadata', () => {
    it('should populate meta fields', () => {
      const content = `# Mission

Test mission.
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.pack.meta.parsedAt).toBeDefined();
      expect(result.pack.meta.parserVersion).toBeDefined();
      expect(result.pack.meta.sourceCount).toBe(1);
      expect(result.pack.meta.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Real-World Examples', () => {
    it('should parse a comprehensive AGENTS.md', () => {
      const content = `---
version: 1.0.0
---

# Mission

Build a code assistant that helps developers write better TypeScript code.

Goals:
- Improve code quality
- Reduce bugs
- Speed up development

Avoid:
- Never delete user files without confirmation
- Always preserve git history

## Commands

Build:
- \`npm run build\` - Build the project

Test:
- \`npm test\` - Run tests

Lint:
- \`npm run lint\` - Lint code

## Rules

### Commit Format
- Use conventional commits (feat:, fix:, etc.)

### File Naming
- Use kebab-case for files

## Safety

### Forbidden
- Never expose API keys
- Don't commit secrets

### Required
- Always validate user input

## Testing

### Tier 0 - Fast Tests
- Run in under 1 second
- No network calls

Coverage: 80% minimum

## Integrations

- MCP: filesystem for file access
- LiBrainian: semantic search
`;

      const result = parseGuidanceFile(content, createSource());

      expect(result.errors.length).toBe(0);
      expect(result.pack.mission?.goals?.length).toBe(3);
      expect(result.pack.commands?.build).toBeDefined();
      expect(result.pack.commands?.lint).toBeDefined();
      expect(result.pack.rules?.commitFormat).toBeDefined();
      expect(result.pack.safety.forbidden.length).toBe(2);
      expect(result.pack.testing?.tiers?.length).toBeGreaterThanOrEqual(1);
      expect(result.pack.integrations?.librainian).toBeDefined();
    });
  });
});
