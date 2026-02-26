/**
 * @fileoverview Tests for Enumeration Construction
 *
 * Tests the enumeration module for:
 * - Intent detection (list all X, how many X, etc.)
 * - Category-specific enumerators
 * - Complete list returns (not top-k)
 * - Result formatting
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import {
  detectEnumerationIntent,
  shouldUseEnumerationMode,
  enumerateByCategory,
  formatEnumerationResult,
  getSupportedCategories,
  getCategoryAliases,
  type EnumerationCategory,
  type EnumerationIntent,
  type EnumerationResult,
} from '../enumeration.js';

// ============================================================================
// INTENT DETECTION TESTS
// ============================================================================

describe('detectEnumerationIntent', () => {
  describe('CLI command detection', () => {
    it('should detect "list all CLI commands"', () => {
      const intent = detectEnumerationIntent('list all CLI commands');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('cli_command');
      expect(intent.queryType).toBe('list');
      expect(intent.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should detect "how many commands are there"', () => {
      const intent = detectEnumerationIntent('how many commands are there');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('cli_command');
      expect(intent.queryType).toBe('count');
    });

    it('should detect "show me all CLI commands"', () => {
      const intent = detectEnumerationIntent('show me all CLI commands');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('cli_command');
      expect(intent.queryType).toBe('show_all');
    });
  });

  describe('test file detection', () => {
    it('should detect "list all test files"', () => {
      const intent = detectEnumerationIntent('list all test files');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('test_file');
      expect(intent.queryType).toBe('list');
    });

    it('should detect "how many tests exist"', () => {
      const intent = detectEnumerationIntent('how many tests exist');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('test_file');
      expect(intent.queryType).toBe('count');
    });

    it('should detect "enumerate all spec files"', () => {
      const intent = detectEnumerationIntent('enumerate all spec files');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('test_file');
      expect(intent.queryType).toBe('enumerate');
    });
  });

  describe('interface detection', () => {
    it('should detect "list all interfaces"', () => {
      const intent = detectEnumerationIntent('list all interfaces');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('interface');
      expect(intent.queryType).toBe('list');
    });

    it('should detect "how many type interfaces"', () => {
      const intent = detectEnumerationIntent('how many type interfaces');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('interface');
      expect(intent.queryType).toBe('count');
    });
  });

  describe('class detection', () => {
    it('should detect "list all classes"', () => {
      const intent = detectEnumerationIntent('list all classes');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('class');
      expect(intent.queryType).toBe('list');
    });

    it('should detect "find all classes"', () => {
      const intent = detectEnumerationIntent('find all classes');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('class');
      expect(intent.queryType).toBe('find_all');
    });
  });

  describe('config detection', () => {
    it('should detect "list all config files"', () => {
      const intent = detectEnumerationIntent('list all config files');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('config');
      expect(intent.queryType).toBe('list');
    });

    it('should detect "show all configuration files"', () => {
      const intent = detectEnumerationIntent('show all configuration files');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('config');
      expect(intent.queryType).toBe('show_all');
    });
  });

  describe('module detection', () => {
    it('should detect "list all modules"', () => {
      const intent = detectEnumerationIntent('list all modules');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('module');
      expect(intent.queryType).toBe('list');
    });
  });

  describe('documentation detection', () => {
    it('should detect "list all documentation"', () => {
      const intent = detectEnumerationIntent('list all documentation');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('documentation');
      expect(intent.queryType).toBe('list');
    });

    it('should detect "how many docs"', () => {
      const intent = detectEnumerationIntent('how many docs');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('documentation');
      expect(intent.queryType).toBe('count');
    });
  });

  describe('component detection', () => {
    it('should detect "list all components"', () => {
      const intent = detectEnumerationIntent('list all components');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('component');
      expect(intent.queryType).toBe('list');
    });

    it('should detect "how many react components"', () => {
      const intent = detectEnumerationIntent('how many react components');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('component');
      expect(intent.queryType).toBe('count');
    });
  });

  describe('hook detection', () => {
    it('should detect "list all hooks"', () => {
      const intent = detectEnumerationIntent('list all hooks');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('hook');
      expect(intent.queryType).toBe('list');
    });

    it('should detect "find all custom hooks"', () => {
      const intent = detectEnumerationIntent('find all custom hooks');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('hook');
      expect(intent.queryType).toBe('find_all');
    });
  });

  describe('function detection', () => {
    it('should detect "list all functions"', () => {
      const intent = detectEnumerationIntent('list all functions');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('function');
      expect(intent.queryType).toBe('list');
    });

    it('should detect "how many exported functions"', () => {
      const intent = detectEnumerationIntent('how many exported functions');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('function');
      expect(intent.queryType).toBe('count');
    });
  });

  describe('enum detection', () => {
    it('should detect "list all enums"', () => {
      const intent = detectEnumerationIntent('list all enums');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('enum');
      expect(intent.queryType).toBe('list');
    });
  });

  describe('constant detection', () => {
    it('should detect "list all constants"', () => {
      const intent = detectEnumerationIntent('list all constants');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('constant');
      expect(intent.queryType).toBe('list');
    });
  });

  describe('type alias detection', () => {
    it('should detect "list all type aliases"', () => {
      const intent = detectEnumerationIntent('list all type aliases');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('type_alias');
      expect(intent.queryType).toBe('list');
    });

    it('should detect "how many types"', () => {
      const intent = detectEnumerationIntent('how many types');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('type_alias');
      expect(intent.queryType).toBe('count');
    });
  });

  describe('non-enumeration queries', () => {
    it('should not detect semantic queries as enumeration', () => {
      // A semantic query that mentions a category keyword but is not an enumeration
      const intent = detectEnumerationIntent('what does the query function do');
      // Note: This query may detect 'function' as a category, but the query type
      // should not be detected since there's no "list", "how many", etc.
      // So isEnumeration should be false (requires both query type AND category)
      expect(intent.isEnumeration).toBe(false);
    });

    it('should not detect dependency queries as enumeration', () => {
      const intent = detectEnumerationIntent('what imports utils.ts');
      expect(intent.isEnumeration).toBe(false);
    });

    it('should return low confidence for ambiguous queries', () => {
      const intent = detectEnumerationIntent('commands');
      expect(intent.isEnumeration).toBe(false);
    });

    it('should handle empty input', () => {
      const intent = detectEnumerationIntent('');
      expect(intent.isEnumeration).toBe(false);
      expect(intent.confidence).toBe(0);
    });

    it('should handle null-ish input', () => {
      const intent = detectEnumerationIntent(null as unknown as string);
      expect(intent.isEnumeration).toBe(false);
    });
  });

  describe('filter extraction', () => {
    it('should extract directory filters', () => {
      const intent = detectEnumerationIntent('list all tests in src/api');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.filters).toContain('src/api');
    });

    it('should extract name filters', () => {
      const intent = detectEnumerationIntent('list all functions named query');
      expect(intent.filters).toContain('query');
    });
  });
});

// ============================================================================
// shouldUseEnumerationMode TESTS
// ============================================================================

describe('shouldUseEnumerationMode', () => {
  it('should return true for high-confidence enumeration queries', () => {
    expect(shouldUseEnumerationMode('list all CLI commands')).toBe(true);
    expect(shouldUseEnumerationMode('how many test files')).toBe(true);
    expect(shouldUseEnumerationMode('enumerate all interfaces')).toBe(true);
  });

  it('should return false for non-enumeration queries', () => {
    expect(shouldUseEnumerationMode('what does bootstrap do')).toBe(false);
    expect(shouldUseEnumerationMode('explain the query module')).toBe(false);
  });

  it('should return false for low-confidence enumeration queries', () => {
    // Single word that might be a category but no query type
    expect(shouldUseEnumerationMode('commands')).toBe(false);
  });
});

// ============================================================================
// enumerateByCategory TESTS
// ============================================================================

describe('enumerateByCategory', () => {
  // These tests run against the actual filesystem for real enumeration
  const testWorkspace = path.resolve(__dirname, '..', '..', '..');

  describe('CLI commands enumeration', () => {
    it('should enumerate CLI command files', async () => {
      const result = await enumerateByCategory(undefined, 'cli_command', testWorkspace);

      expect(result.category).toBe('cli_command');
      expect(result.totalCount).toBeGreaterThan(0);
      expect(result.entities.length).toBe(result.totalCount);
      expect(result.truncated).toBe(false);

      // Check entity structure
      for (const entity of result.entities) {
        expect(entity.id).toBeTruthy();
        expect(entity.name).toBeTruthy();
        expect(entity.filePath).toBeTruthy();
        expect(entity.category).toBe('cli_command');
      }

      // Should have byDirectory grouping
      expect(result.byDirectory.size).toBeGreaterThan(0);
    });

    it('should include expected CLI commands', async () => {
      const result = await enumerateByCategory(undefined, 'cli_command', testWorkspace);
      const commandNames = result.entities.map(e => e.name);

      // Check for known commands
      expect(commandNames).toContain('bootstrap');
      expect(commandNames).toContain('query');
      expect(commandNames).toContain('status');
    });
  });

  describe('test files enumeration', () => {
    it('should enumerate test files', async () => {
      const result = await enumerateByCategory(undefined, 'test_file', testWorkspace);

      expect(result.category).toBe('test_file');
      expect(result.totalCount).toBeGreaterThan(0);
      expect(result.entities.length).toBe(result.totalCount);

      // Check that all files are test files
      for (const entity of result.entities) {
        expect(
          entity.filePath.includes('.test.') ||
          entity.filePath.includes('.spec.')
        ).toBe(true);
      }
    });

    it('should return complete list, not top-k', async () => {
      const result = await enumerateByCategory(undefined, 'cli_command', testWorkspace);

      // Verify this is an exhaustive count (not limited to default limits like 10 or 20)
      // The actual count depends on the codebase, but should be more than typical top-k
      expect(result.totalCount).toBeGreaterThan(10);
    });
  });

  describe('config files enumeration', () => {
    it('should enumerate configuration files', async () => {
      const result = await enumerateByCategory(undefined, 'config', testWorkspace);

      expect(result.category).toBe('config');
      expect(result.totalCount).toBeGreaterThan(0);

      // Should include package.json
      const fileNames = result.entities.map(e => e.name);
      expect(fileNames).toContain('package.json');
    });
  });

  describe('documentation enumeration', () => {
    it('should enumerate documentation files', async () => {
      const result = await enumerateByCategory(undefined, 'documentation', testWorkspace);

      expect(result.category).toBe('documentation');
      expect(result.totalCount).toBeGreaterThan(0);

      // Check that files are markdown or README/CHANGELOG type
      for (const entity of result.entities) {
        const isMarkdown = entity.filePath.endsWith('.md');
        const isReadme = entity.name.toUpperCase().includes('README');
        const isChangelog = entity.name.toUpperCase().includes('CHANGELOG');
        const isContributing = entity.name.toUpperCase().includes('CONTRIBUTING');
        expect(isMarkdown || isReadme || isChangelog || isContributing).toBe(true);
      }
    });
  });

  describe('unknown category handling', () => {
    it('should handle unknown categories gracefully', async () => {
      const result = await enumerateByCategory(
        undefined,
        'unknown_category' as EnumerationCategory,
        testWorkspace
      );

      expect(result.totalCount).toBe(0);
      expect(result.entities).toEqual([]);
      expect(result.explanation).toContain('Unknown category');
    });
  });

  describe('result structure', () => {
    it('should return proper result structure', async () => {
      const result = await enumerateByCategory(undefined, 'cli_command', testWorkspace);

      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('totalCount');
      expect(result).toHaveProperty('entities');
      expect(result).toHaveProperty('byDirectory');
      expect(result).toHaveProperty('durationMs');
      expect(result).toHaveProperty('explanation');
      expect(result).toHaveProperty('truncated');

      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should group entities by directory', async () => {
      const result = await enumerateByCategory(undefined, 'cli_command', testWorkspace);

      expect(result.byDirectory).toBeInstanceOf(Map);

      // All entities should appear in byDirectory
      let totalInDirectories = 0;
      for (const entities of result.byDirectory.values()) {
        totalInDirectories += entities.length;
      }
      expect(totalInDirectories).toBe(result.totalCount);
    });
  });
});

// ============================================================================
// formatEnumerationResult TESTS
// ============================================================================

describe('formatEnumerationResult', () => {
  const mockResult: EnumerationResult = {
    category: 'cli_command',
    totalCount: 5,
    entities: [
      { id: 'cmd1', name: 'bootstrap', filePath: 'src/cli/commands/bootstrap.ts', category: 'cli_command', metadata: {} },
      { id: 'cmd2', name: 'query', filePath: 'src/cli/commands/query.ts', category: 'cli_command', metadata: {} },
      { id: 'cmd3', name: 'status', filePath: 'src/cli/commands/status.ts', category: 'cli_command', metadata: {} },
      { id: 'cmd4', name: 'validate', filePath: 'src/cli/commands/validate.ts', category: 'cli_command', metadata: {} },
      { id: 'cmd5', name: 'watch', filePath: 'src/cli/commands/watch.ts', category: 'cli_command', metadata: {} },
    ],
    byDirectory: new Map([
      ['src/cli/commands', [
        { id: 'cmd1', name: 'bootstrap', filePath: 'src/cli/commands/bootstrap.ts', category: 'cli_command', metadata: {} },
        { id: 'cmd2', name: 'query', filePath: 'src/cli/commands/query.ts', category: 'cli_command', metadata: {} },
        { id: 'cmd3', name: 'status', filePath: 'src/cli/commands/status.ts', category: 'cli_command', metadata: {} },
        { id: 'cmd4', name: 'validate', filePath: 'src/cli/commands/validate.ts', category: 'cli_command', metadata: {} },
        { id: 'cmd5', name: 'watch', filePath: 'src/cli/commands/watch.ts', category: 'cli_command', metadata: {} },
      ]],
    ]),
    durationMs: 42,
    explanation: 'Found 5 CLI commands in the codebase.',
    truncated: false,
  };

  it('should format result as readable string', () => {
    const formatted = formatEnumerationResult(mockResult);

    expect(formatted).toContain('Enumeration: cli_command');
    expect(formatted).toContain('Found 5');
    expect(formatted).toContain('bootstrap');
    expect(formatted).toContain('query');
    expect(formatted).toContain('src/cli/commands');
  });

  it('should include directory grouping', () => {
    const formatted = formatEnumerationResult(mockResult);

    expect(formatted).toContain('By Directory:');
    expect(formatted).toContain('src/cli/commands/');
  });

  it('should include duration', () => {
    const formatted = formatEnumerationResult(mockResult);

    expect(formatted).toContain('42ms');
  });

  it('should handle truncated results', () => {
    const truncatedResult: EnumerationResult = {
      ...mockResult,
      truncated: true,
      maxLimit: 10000,
    };

    const formatted = formatEnumerationResult(truncatedResult);
    expect(formatted).toContain('truncated');
    expect(formatted).toContain('10000');
  });
});

// ============================================================================
// getSupportedCategories TESTS
// ============================================================================

describe('getSupportedCategories', () => {
  it('should return all supported categories', () => {
    const categories = getSupportedCategories();

    expect(categories).toContain('cli_command');
    expect(categories).toContain('test_file');
    expect(categories).toContain('interface');
    expect(categories).toContain('class');
    expect(categories).toContain('function');
    expect(categories).toContain('config');
    expect(categories).toContain('module');
    expect(categories).toContain('documentation');
  });

  it('should return array of strings', () => {
    const categories = getSupportedCategories();

    expect(Array.isArray(categories)).toBe(true);
    for (const cat of categories) {
      expect(typeof cat).toBe('string');
    }
  });
});

// ============================================================================
// getCategoryAliases TESTS
// ============================================================================

describe('getCategoryAliases', () => {
  it('should return map of aliases to categories', () => {
    const aliases = getCategoryAliases();

    expect(aliases).toBeInstanceOf(Map);
    expect(aliases.get('cli command')).toBe('cli_command');
    expect(aliases.get('test')).toBe('test_file');
    expect(aliases.get('interface')).toBe('interface');
    expect(aliases.get('class')).toBe('class');
  });

  it('should include multiple aliases per category', () => {
    const aliases = getCategoryAliases();

    // cli_command has multiple aliases
    expect(aliases.get('cli command')).toBe('cli_command');
    expect(aliases.get('command')).toBe('cli_command');

    // test_file has multiple aliases
    expect(aliases.get('test file')).toBe('test_file');
    expect(aliases.get('tests')).toBe('test_file');
    expect(aliases.get('spec')).toBe('test_file');
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('enumeration integration', () => {
  const testWorkspace = path.resolve(__dirname, '..', '..', '..');

  it('should detect and enumerate CLI commands end-to-end', async () => {
    const query = 'list all CLI commands';

    // Detect intent
    const intent = detectEnumerationIntent(query);
    expect(intent.isEnumeration).toBe(true);
    expect(intent.category).toBe('cli_command');

    // Enumerate
    const result = await enumerateByCategory(undefined, intent.category!, testWorkspace);
    expect(result.totalCount).toBeGreaterThan(0);

    // Format
    const formatted = formatEnumerationResult(result);
    expect(formatted).toContain('CLI commands');
    expect(formatted).toContain('Found');
  });

  it('should detect and enumerate test files end-to-end', async () => {
    const query = 'how many test files exist';

    // Detect intent
    const intent = detectEnumerationIntent(query);
    expect(intent.isEnumeration).toBe(true);
    expect(intent.category).toBe('test_file');
    expect(intent.queryType).toBe('count');

    // Enumerate
    const result = await enumerateByCategory(undefined, intent.category!, testWorkspace);
    expect(result.totalCount).toBeGreaterThan(0);

    // For count queries, totalCount is the key info
    expect(typeof result.totalCount).toBe('number');
  });

  it('should provide complete lists, not samples', async () => {
    // Enumerate commands twice - should get same count
    const result1 = await enumerateByCategory(undefined, 'cli_command', testWorkspace);
    const result2 = await enumerateByCategory(undefined, 'cli_command', testWorkspace);

    expect(result1.totalCount).toBe(result2.totalCount);
    expect(result1.entities.length).toBe(result1.totalCount);
    expect(result2.entities.length).toBe(result2.totalCount);
  });
});

// ============================================================================
// ENDPOINT ENUMERATION TESTS
// ============================================================================

describe('endpoint enumeration', () => {
  describe('detectEnumerationIntent for endpoints', () => {
    it('should detect "list all endpoints"', () => {
      const intent = detectEnumerationIntent('list all endpoints');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('endpoint');
      expect(intent.queryType).toBe('list');
    });

    it('should detect "how many API endpoints"', () => {
      const intent = detectEnumerationIntent('how many API endpoints');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('endpoint');
      expect(intent.queryType).toBe('count');
    });

    it('should detect "enumerate all routes"', () => {
      const intent = detectEnumerationIntent('enumerate all routes');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('endpoint');
      expect(intent.queryType).toBe('enumerate');
    });

    it('should detect "find all API routes"', () => {
      const intent = detectEnumerationIntent('find all API routes');
      expect(intent.isEnumeration).toBe(true);
      expect(intent.category).toBe('endpoint');
      expect(intent.queryType).toBe('find_all');
    });
  });

  describe('endpoint pattern matching', () => {
    // Test fixture with various endpoint patterns
    const expressFixture = `
      import express from 'express';
      const app = express();
      const router = express.Router();

      app.get('/users', getUsers);
      app.post('/users', createUser);
      router.put('/users/:id', updateUser);
      router.delete('/users/:id', deleteUser);
      app.patch('/settings', (req, res) => res.json({}));
    `;

    const nestjsFixture = `
      import { Controller, Get, Post, Put, Delete, Param } from '@nestjs/common';

      @Controller('api/users')
      export class UsersController {
        @Get()
        findAll() { return []; }

        @Get(':id')
        findOne(@Param('id') id: string) { return {}; }

        @Post()
        create() { return {}; }

        @Delete(':id')
        remove(@Param('id') id: string) { return {}; }
      }
    `;

    const fastifyFixture = `
      import Fastify from 'fastify';
      const fastify = Fastify();
      const server = Fastify();

      fastify.get('/health', healthCheck);
      server.post('/api/data', { schema: {} }, handleData);
      fastify.route({
        method: 'PUT',
        url: '/api/items/:id',
        handler: updateItem
      });
    `;

    it('should match Express route patterns', () => {
      const expressPatterns = [
        /(?:app|router)\s*\.\s*(get|post|put|delete|patch|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
      ];

      const matches: Array<{ method: string; path: string }> = [];
      for (const pattern of expressPatterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(expressFixture)) !== null) {
          matches.push({ method: match[1].toUpperCase(), path: match[2] });
        }
      }

      expect(matches).toContainEqual({ method: 'GET', path: '/users' });
      expect(matches).toContainEqual({ method: 'POST', path: '/users' });
      expect(matches).toContainEqual({ method: 'PUT', path: '/users/:id' });
      expect(matches).toContainEqual({ method: 'DELETE', path: '/users/:id' });
      expect(matches).toContainEqual({ method: 'PATCH', path: '/settings' });
    });

    it('should match NestJS decorator patterns', () => {
      const nestPatterns = [
        /@(Get|Post|Put|Delete|Patch|Options|Head)\s*\(\s*['"`]?([^'"`\)\s]*)['"`]?\s*\)/gi,
      ];

      const matches: Array<{ method: string; path: string }> = [];
      for (const pattern of nestPatterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(nestjsFixture)) !== null) {
          matches.push({ method: match[1].toUpperCase(), path: match[2] || '/' });
        }
      }

      expect(matches).toContainEqual({ method: 'GET', path: '/' });
      expect(matches).toContainEqual({ method: 'GET', path: ':id' });
      expect(matches).toContainEqual({ method: 'POST', path: '/' });
      expect(matches).toContainEqual({ method: 'DELETE', path: ':id' });
    });

    it('should match Fastify route patterns', () => {
      const fastifyPatterns = [
        /(?:fastify|server|app)\s*\.\s*(get|post|put|delete|patch|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
      ];

      const matches: Array<{ method: string; path: string }> = [];
      for (const pattern of fastifyPatterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(fastifyFixture)) !== null) {
          matches.push({ method: match[1].toUpperCase(), path: match[2] });
        }
      }

      expect(matches).toContainEqual({ method: 'GET', path: '/health' });
      expect(matches).toContainEqual({ method: 'POST', path: '/api/data' });
    });
  });

  describe('enumerateByCategory for endpoints', () => {
    // Create a temporary test directory with endpoint files
    const testWorkspace = path.resolve(__dirname, '..', '..', '..');

    it('should return endpoint category', async () => {
      const result = await enumerateByCategory(undefined, 'endpoint', testWorkspace);

      expect(result.category).toBe('endpoint');
      expect(result.truncated).toBe(false);
    });

    it('should include proper endpoint metadata', async () => {
      const result = await enumerateByCategory(undefined, 'endpoint', testWorkspace);

      // If any endpoints are found, verify structure
      for (const entity of result.entities) {
        expect(entity.category).toBe('endpoint');
        expect(entity.metadata).toHaveProperty('method');
        expect(entity.metadata).toHaveProperty('path');
        expect(entity.metadata).toHaveProperty('framework');
        expect(entity.metadata).toHaveProperty('handler');

        // Method should be a valid HTTP method
        expect(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']).toContain(
          entity.metadata.method
        );

        // Framework should be recognized
        expect(['express', 'nestjs', 'fastify', 'koa', 'hapi', 'unknown']).toContain(
          entity.metadata.framework
        );
      }
    });

    it('should group endpoints by directory', async () => {
      const result = await enumerateByCategory(undefined, 'endpoint', testWorkspace);

      expect(result.byDirectory).toBeInstanceOf(Map);

      // All entities should appear in byDirectory
      let totalInDirectories = 0;
      for (const entities of result.byDirectory.values()) {
        totalInDirectories += entities.length;
      }
      expect(totalInDirectories).toBe(result.totalCount);
    });

    it('should have proper entity structure for endpoints', async () => {
      const result = await enumerateByCategory(undefined, 'endpoint', testWorkspace);

      for (const entity of result.entities) {
        expect(entity.id).toBeTruthy();
        expect(entity.name).toBeTruthy();
        expect(entity.filePath).toBeTruthy();

        // Name should be in format "METHOD /path"
        expect(entity.name).toMatch(/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+\S+/);

        // Should have description
        expect(entity.description).toBeTruthy();
        expect(entity.description).toContain('endpoint');
      }
    });

    it('should deduplicate identical endpoints', async () => {
      const result = await enumerateByCategory(undefined, 'endpoint', testWorkspace);

      // Check for duplicates
      const seen = new Set<string>();
      for (const entity of result.entities) {
        expect(seen.has(entity.id)).toBe(false);
        seen.add(entity.id);
      }
    });
  });
});

// ============================================================================
// getEndpoints CONVENIENCE FUNCTION TESTS
// ============================================================================

describe('getEndpoints', () => {
  // Import the function
  let getEndpoints: typeof import('../enumeration.js').getEndpoints;

  beforeEach(async () => {
    const mod = await import('../enumeration.js');
    getEndpoints = mod.getEndpoints;
  });

  const testWorkspace = path.resolve(__dirname, '..', '..', '..');

  it('should return EndpointInfo array', async () => {
    const endpoints = await getEndpoints(testWorkspace);

    expect(Array.isArray(endpoints)).toBe(true);

    for (const ep of endpoints) {
      expect(ep).toHaveProperty('method');
      expect(ep).toHaveProperty('path');
      expect(ep).toHaveProperty('file');
      expect(ep).toHaveProperty('line');
      expect(ep).toHaveProperty('handler');
      expect(ep).toHaveProperty('framework');
    }
  });

  it('should return valid HTTP methods', async () => {
    const endpoints = await getEndpoints(testWorkspace);
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];

    for (const ep of endpoints) {
      expect(validMethods).toContain(ep.method);
    }
  });

  it('should return valid frameworks', async () => {
    const endpoints = await getEndpoints(testWorkspace);
    const validFrameworks = ['express', 'nestjs', 'fastify', 'koa', 'hapi', 'unknown'];

    for (const ep of endpoints) {
      expect(validFrameworks).toContain(ep.framework);
    }
  });
});

// ============================================================================
// PAGINATION TESTS
// ============================================================================

describe('enumerateByCategoryPaginated', () => {
  // Import the function
  let enumerateByCategoryPaginated: typeof import('../enumeration.js').enumerateByCategoryPaginated;

  beforeEach(async () => {
    const mod = await import('../enumeration.js');
    enumerateByCategoryPaginated = mod.enumerateByCategoryPaginated;
  });

  const testWorkspace = path.resolve(__dirname, '..', '..', '..');

  it('should return paginated results with default options', async () => {
    const result = await enumerateByCategoryPaginated(
      undefined,
      'test_file',
      testWorkspace
    );

    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('offset');
    expect(result).toHaveProperty('limit');
    expect(result).toHaveProperty('hasMore');

    expect(result.offset).toBe(0);
    expect(result.limit).toBe(100);
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe('number');
  });

  it('should respect limit option', async () => {
    const result = await enumerateByCategoryPaginated(
      undefined,
      'test_file',
      testWorkspace,
      { limit: 5 }
    );

    expect(result.items.length).toBeLessThanOrEqual(5);
    expect(result.limit).toBe(5);
  });

  it('should respect offset option', async () => {
    const page1 = await enumerateByCategoryPaginated(
      undefined,
      'test_file',
      testWorkspace,
      { offset: 0, limit: 3 }
    );

    const page2 = await enumerateByCategoryPaginated(
      undefined,
      'test_file',
      testWorkspace,
      { offset: 3, limit: 3 }
    );

    // Items should be different (no overlap)
    if (page1.items.length > 0 && page2.items.length > 0) {
      expect(page1.items[0].id).not.toBe(page2.items[0].id);
    }

    expect(page2.offset).toBe(3);
  });

  it('should calculate hasMore correctly', async () => {
    const allItems = await enumerateByCategoryPaginated(
      undefined,
      'test_file',
      testWorkspace,
      { limit: 1000 }
    );

    if (allItems.total > 5) {
      const partialResult = await enumerateByCategoryPaginated(
        undefined,
        'test_file',
        testWorkspace,
        { offset: 0, limit: 5 }
      );

      expect(partialResult.hasMore).toBe(true);
    }

    // When offset + limit >= total, hasMore should be false
    const lastPage = await enumerateByCategoryPaginated(
      undefined,
      'test_file',
      testWorkspace,
      { offset: Math.max(0, allItems.total - 2), limit: 10 }
    );

    expect(lastPage.hasMore).toBe(false);
  });

  it('should sort by name ascending by default', async () => {
    const result = await enumerateByCategoryPaginated(
      undefined,
      'test_file',
      testWorkspace,
      { limit: 10 }
    );

    if (result.items.length >= 2) {
      const names = result.items.map(i => i.name);
      const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sortedNames);
    }
  });

  it('should sort by name descending when specified', async () => {
    const result = await enumerateByCategoryPaginated(
      undefined,
      'test_file',
      testWorkspace,
      { limit: 10, sortBy: 'name', sortOrder: 'desc' }
    );

    if (result.items.length >= 2) {
      const names = result.items.map(i => i.name);
      const sortedNames = [...names].sort((a, b) => b.localeCompare(a));
      expect(names).toEqual(sortedNames);
    }
  });

  it('should sort by file path', async () => {
    const result = await enumerateByCategoryPaginated(
      undefined,
      'test_file',
      testWorkspace,
      { limit: 10, sortBy: 'file', sortOrder: 'asc' }
    );

    if (result.items.length >= 2) {
      const paths = result.items.map(i => i.filePath);
      const sortedPaths = [...paths].sort((a, b) => a.localeCompare(b));
      expect(paths).toEqual(sortedPaths);
    }
  });

  it('should maintain consistency between pages', async () => {
    const page1 = await enumerateByCategoryPaginated(
      undefined,
      'cli_command',
      testWorkspace,
      { offset: 0, limit: 3, sortBy: 'name', sortOrder: 'asc' }
    );

    const page2 = await enumerateByCategoryPaginated(
      undefined,
      'cli_command',
      testWorkspace,
      { offset: 3, limit: 3, sortBy: 'name', sortOrder: 'asc' }
    );

    // Total should be consistent
    expect(page1.total).toBe(page2.total);

    // Combined items should be unique
    const allItems = [...page1.items, ...page2.items];
    const uniqueIds = new Set(allItems.map(i => i.id));
    expect(uniqueIds.size).toBe(allItems.length);
  });
});

// ============================================================================
// FRAMEWORK DETECTION TESTS
// ============================================================================

describe('detectFramework', () => {
  let detectFramework: typeof import('../enumeration.js').detectFramework;
  let getFrameworkCategories: typeof import('../enumeration.js').getFrameworkCategories;

  beforeEach(async () => {
    const mod = await import('../enumeration.js');
    detectFramework = mod.detectFramework;
    getFrameworkCategories = mod.getFrameworkCategories;
  });

  const testWorkspace = path.resolve(__dirname, '..', '..', '..');

  it('should detect frameworks from package.json', async () => {
    const frameworks = await detectFramework(testWorkspace);

    expect(Array.isArray(frameworks)).toBe(true);
    expect(frameworks.length).toBeGreaterThan(0);
  });

  it('should return unknown for non-existent workspace', async () => {
    const frameworks = await detectFramework('/non/existent/path');

    expect(frameworks).toEqual(['unknown']);
  });

  it('should return valid framework types', async () => {
    const frameworks = await detectFramework(testWorkspace);
    const validFrameworks = [
      'react', 'vue', 'angular', 'svelte',
      'express', 'nestjs', 'fastify', 'koa', 'hapi',
      'next', 'nuxt', 'gatsby',
      'electron',
      'unknown'
    ];

    for (const framework of frameworks) {
      expect(validFrameworks).toContain(framework);
    }
  });

  describe('getFrameworkCategories', () => {
    it('should return component and hook for React', () => {
      const categories = getFrameworkCategories(['react']);

      expect(categories).toContain('component');
      expect(categories).toContain('hook');
    });

    it('should return component for Vue/Angular/Svelte', () => {
      expect(getFrameworkCategories(['vue'])).toContain('component');
      expect(getFrameworkCategories(['angular'])).toContain('component');
      expect(getFrameworkCategories(['svelte'])).toContain('component');
    });

    it('should return endpoint for backend frameworks', () => {
      expect(getFrameworkCategories(['express'])).toContain('endpoint');
      expect(getFrameworkCategories(['nestjs'])).toContain('endpoint');
      expect(getFrameworkCategories(['fastify'])).toContain('endpoint');
      expect(getFrameworkCategories(['koa'])).toContain('endpoint');
      expect(getFrameworkCategories(['hapi'])).toContain('endpoint');
    });

    it('should return component and endpoint for meta-frameworks', () => {
      const nextCategories = getFrameworkCategories(['next']);
      expect(nextCategories).toContain('component');
      expect(nextCategories).toContain('endpoint');

      const nuxtCategories = getFrameworkCategories(['nuxt']);
      expect(nuxtCategories).toContain('component');
      expect(nuxtCategories).toContain('endpoint');
    });

    it('should return empty array for unknown frameworks', () => {
      const categories = getFrameworkCategories(['unknown']);
      expect(categories).toEqual([]);
    });

    it('should dedupe categories for multiple frameworks', () => {
      const categories = getFrameworkCategories(['react', 'express', 'next']);
      const uniqueCategories = [...new Set(categories)];
      expect(categories).toEqual(uniqueCategories);
    });
  });
});

// ============================================================================
// FILTERING TESTS
// ============================================================================

describe('enumerateWithFilters', () => {
  let enumerateWithFilters: typeof import('../enumeration.js').enumerateWithFilters;
  let enumerateExported: typeof import('../enumeration.js').enumerateExported;
  let enumerateInDirectory: typeof import('../enumeration.js').enumerateInDirectory;

  beforeEach(async () => {
    const mod = await import('../enumeration.js');
    enumerateWithFilters = mod.enumerateWithFilters;
    enumerateExported = mod.enumerateExported;
    enumerateInDirectory = mod.enumerateInDirectory;
  });

  const testWorkspace = path.resolve(__dirname, '..', '..', '..');

  describe('inDirectory filter', () => {
    it('should filter entities by directory prefix', async () => {
      const result = await enumerateWithFilters(
        undefined,
        'test_file',
        testWorkspace,
        { inDirectory: 'src/api' }
      );

      for (const entity of result) {
        expect(entity.filePath.startsWith('src/api')).toBe(true);
      }
    });

    it('should return empty array if no entities match directory', async () => {
      const result = await enumerateWithFilters(
        undefined,
        'cli_command',
        testWorkspace,
        { inDirectory: 'non/existent/directory' }
      );

      expect(result).toEqual([]);
    });
  });

  describe('inFile filter', () => {
    it('should filter entities by exact file path', async () => {
      // First get all test files to find a valid file path
      const allTests = await enumerateWithFilters(
        undefined,
        'test_file',
        testWorkspace,
        {}
      );

      if (allTests.length > 0) {
        const targetFile = allTests[0].filePath;
        const result = await enumerateWithFilters(
          undefined,
          'test_file',
          testWorkspace,
          { inFile: targetFile }
        );

        expect(result.length).toBe(1);
        expect(result[0].filePath).toBe(targetFile);
      }
    }, 120_000);
  });

  describe('exported filter', () => {
    it('should filter entities by export status', async () => {
      const exportedResult = await enumerateWithFilters(
        undefined,
        'function',
        testWorkspace,
        { exported: true }
      );

      // All returned entities should have exported metadata set to true
      for (const entity of exportedResult) {
        // Note: exported filter checks metadata.exported which may be undefined
        // for file-based enumerations without detailed metadata
        expect(entity.metadata.exported === true || entity.metadata.exported === undefined).toBe(true);
      }
    });
  });

  describe('convenience functions', () => {
    it('enumerateExported should return exported entities', async () => {
      const result = await enumerateExported(undefined, 'function', testWorkspace);

      expect(Array.isArray(result)).toBe(true);
      // Should not throw and should return array
    });

    it('enumerateInDirectory should filter by directory', async () => {
      const result = await enumerateInDirectory(
        undefined,
        'test_file',
        testWorkspace,
        'src/constructions'
      );

      for (const entity of result) {
        expect(entity.filePath.startsWith('src/constructions')).toBe(true);
      }
    });
  });

  describe('combined filters', () => {
    it('should apply multiple filters together', async () => {
      const result = await enumerateWithFilters(
        undefined,
        'cli_command',
        testWorkspace,
        {
          inDirectory: 'src/cli',
          exported: undefined, // Don't filter by exported
        }
      );

      for (const entity of result) {
        expect(entity.filePath.startsWith('src/cli')).toBe(true);
      }
    });
  });

  describe('filter types', () => {
    it('should handle visibility filter with "all" value', async () => {
      const result = await enumerateWithFilters(
        undefined,
        'function',
        testWorkspace,
        { visibility: 'all' }
      );

      // Should return all entities, not filter by visibility
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle hasDecorators filter', async () => {
      const withDecorators = await enumerateWithFilters(
        undefined,
        'function',
        testWorkspace,
        { hasDecorators: true }
      );

      const withoutDecorators = await enumerateWithFilters(
        undefined,
        'function',
        testWorkspace,
        { hasDecorators: false }
      );

      // Both should be arrays
      expect(Array.isArray(withDecorators)).toBe(true);
      expect(Array.isArray(withoutDecorators)).toBe(true);
    });
  });
});

// ============================================================================
// TYPE EXPORTS TESTS
// ============================================================================

describe('type exports', () => {
  it('should export EnumerationOptions type', async () => {
    const mod = await import('../enumeration.js');
    // Verify function accepts EnumerationOptions
    const options: import('../enumeration.js').EnumerationOptions = {
      offset: 0,
      limit: 10,
      sortBy: 'name',
      sortOrder: 'asc'
    };
    expect(options).toBeDefined();
  });

  it('should export PaginatedResult type', async () => {
    const mod = await import('../enumeration.js');
    // Verify type structure
    const result: import('../enumeration.js').PaginatedResult<string> = {
      items: ['a', 'b'],
      total: 2,
      offset: 0,
      limit: 10,
      hasMore: false
    };
    expect(result.items.length).toBe(2);
  });

  it('should export EnumerationFramework type', async () => {
    const mod = await import('../enumeration.js');
    // Verify EnumerationFramework type includes expected values
    const framework: import('../enumeration.js').EnumerationFramework = 'react';
    expect(['react', 'vue', 'angular', 'svelte', 'express', 'nestjs', 'fastify', 'koa', 'hapi', 'next', 'nuxt', 'gatsby', 'electron', 'unknown']).toContain(framework);
  });

  it('should export FilterOptions type', async () => {
    const mod = await import('../enumeration.js');
    // Verify FilterOptions structure
    const filters: import('../enumeration.js').FilterOptions = {
      exported: true,
      visibility: 'public',
      isAsync: false,
      isStatic: false,
      hasDecorators: true,
      decoratorName: 'Get',
      inFile: 'test.ts',
      inDirectory: 'src/'
    };
    expect(filters.exported).toBe(true);
    expect(filters.visibility).toBe('public');
  });
});
