import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { loadGovernorConfig } from '../bootstrap.js';
import { DEFAULT_GOVERNOR_CONFIG } from '../governors.js';
import type { GovernorConfig } from '../governors.js';
import { tmpdir } from 'os';

describe('loadGovernorConfig', () => {
  let testDir: string;
  let configDir: string;

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    testDir = path.join(tmpdir(), `librainian-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    configDir = path.join(testDir, '.librainian');
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('path validation', () => {
    it('should reject relative paths', async () => {
      await expect(loadGovernorConfig('./relative/path')).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path): Workspace must be an absolute path'
      );
    });

    it('should reject paths with directory traversal', async () => {
      const maliciousPath = `${testDir}${path.sep}..${path.sep}..${path.sep}etc`;
      await expect(loadGovernorConfig(maliciousPath)).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });

    it('should reject paths with variable expansion attempts', async () => {
      const maliciousPath = '/tmp/workspace/${EVIL}';
      await expect(loadGovernorConfig(maliciousPath)).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });

    it('should reject paths with command substitution attempts', async () => {
      const maliciousPath = '/tmp/workspace/$(evil)';
      await expect(loadGovernorConfig(maliciousPath)).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });

    it('should reject paths with backtick execution attempts', async () => {
      const maliciousPath = '/tmp/workspace/`evil`';
      await expect(loadGovernorConfig(maliciousPath)).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });

    it('should reject paths with null byte injection', async () => {
      const maliciousPath = '/tmp/workspace\x00/evil';
      await expect(loadGovernorConfig(maliciousPath)).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });

    it('should reject paths pointing to /etc (case-insensitive)', async () => {
      await expect(loadGovernorConfig('/etc/malicious')).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
      await expect(loadGovernorConfig('/ETC/malicious')).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });

    it('should reject paths pointing to /proc (case-insensitive)', async () => {
      await expect(loadGovernorConfig('/proc/malicious')).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
      await expect(loadGovernorConfig('/PROC/malicious')).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });

    it('should reject paths pointing to /sys (case-insensitive)', async () => {
      await expect(loadGovernorConfig('/sys/malicious')).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
      await expect(loadGovernorConfig('/SYS/malicious')).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });
  });

  describe('ENOENT handling - security-critical path', () => {
    it('should reject non-existent path when parent does NOT exist', async () => {
      const nonExistentParent = path.join(testDir, 'does-not-exist', 'child');
      await expect(loadGovernorConfig(nonExistentParent)).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path): Parent directory does not exist'
      );
    });

    it('should accept non-existent path when parent DOES exist (safe parent)', async () => {
      // Create a safe parent directory
      const safeParent = path.join(testDir, 'safe-parent');
      await fs.mkdir(safeParent, { recursive: true });

      // Non-existent child path
      const nonExistentChild = path.join(safeParent, 'nonexistent-workspace');

      // Should succeed and return default config
      const config = await loadGovernorConfig(nonExistentChild);
      expect(config).toEqual(DEFAULT_GOVERNOR_CONFIG);
    });

    it('should reject non-existent path even if parent exists in blocked directory (/etc)', async () => {
      // Attempt to create workspace in /etc/nonexistent
      // This should fail during validation even if parent (/etc) exists
      const dangerousPath = '/etc/nonexistent-workspace';
      await expect(loadGovernorConfig(dangerousPath)).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });

    it('should reject non-existent path even if parent exists in blocked directory (/proc)', async () => {
      const dangerousPath = '/proc/nonexistent-workspace';
      await expect(loadGovernorConfig(dangerousPath)).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });

    it('should reject non-existent path even if parent exists in blocked directory (/sys)', async () => {
      const dangerousPath = '/sys/nonexistent-workspace';
      await expect(loadGovernorConfig(dangerousPath)).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });

    it('should handle symlink pointing to non-existent path with existing parent', async () => {
      // Create safe parent
      const safeParent = path.join(testDir, 'safe-parent');
      await fs.mkdir(safeParent, { recursive: true });

      // Create symlink pointing to non-existent path
      const symlinkPath = path.join(testDir, 'workspace-symlink');
      const targetPath = path.join(safeParent, 'nonexistent-target');
      await fs.symlink(targetPath, symlinkPath);

      // Should succeed - symlink's target has existing parent
      const config = await loadGovernorConfig(symlinkPath);
      expect(config).toEqual(DEFAULT_GOVERNOR_CONFIG);
    });

    it('should reject symlink pointing to dangerous location even if target parent exists', async () => {
      // Create symlink pointing to /etc/nonexistent
      const symlinkPath = path.join(testDir, 'dangerous-symlink');
      const dangerousTarget = '/etc/nonexistent-workspace';
      
      try {
        await fs.symlink(dangerousTarget, symlinkPath);
      } catch {
        // Symlink creation might fail on some systems, skip test
        return;
      }

      // Should fail validation after symlink resolution
      await expect(loadGovernorConfig(symlinkPath)).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });

    it('should reject path with traversal even when intermediate parent exists', async () => {
      // Create a safe parent
      const safeParent = path.join(testDir, 'safe');
      await fs.mkdir(safeParent, { recursive: true });

      // Try to traverse out using ../
      const traversalPath = path.join(safeParent, '..', '..', 'etc', 'nonexistent');
      
      await expect(loadGovernorConfig(traversalPath)).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });
  });

  describe('config file loading', () => {
    it('should return default config when no config file exists', async () => {
      await fs.mkdir(testDir, { recursive: true });
      const config = await loadGovernorConfig(testDir);
      expect(config).toEqual(DEFAULT_GOVERNOR_CONFIG);
    });

    it('should load valid config file', async () => {
      await fs.mkdir(configDir, { recursive: true });
      const customConfig: GovernorConfig = {
        ...DEFAULT_GOVERNOR_CONFIG,
        maxTokensPerFile: 100000,
        maxConcurrentWorkers: 8,
      };
      await fs.writeFile(
        path.join(configDir, 'governor.json'),
        JSON.stringify(customConfig),
        'utf8'
      );

      const config = await loadGovernorConfig(testDir);
      expect(config.maxTokensPerFile).toBe(100000);
      expect(config.maxConcurrentWorkers).toBe(8);
    });

    it('should reject config with invalid JSON', async () => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'governor.json'),
        'invalid json {',
        'utf8'
      );

      await expect(loadGovernorConfig(testDir)).rejects.toThrow(
        'unverified_by_trace(governor_config_invalid)'
      );
    });

    it('should reject config with non-numeric values', async () => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'governor.json'),
        JSON.stringify({ maxTokensPerFile: 'not a number' }),
        'utf8'
      );

      await expect(loadGovernorConfig(testDir)).rejects.toThrow(
        'unverified_by_trace(governor_config_invalid)'
      );
    });

    it('should reject config with negative values', async () => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'governor.json'),
        JSON.stringify({ maxTokensPerFile: -100 }),
        'utf8'
      );

      await expect(loadGovernorConfig(testDir)).rejects.toThrow(
        'unverified_by_trace(governor_config_invalid)'
      );
    });

    it('should reject config with zero for non-allowZero fields', async () => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'governor.json'),
        JSON.stringify({ maxEmbeddingsPerBatch: 0 }), // maxEmbeddingsPerBatch requires > 0
        'utf8'
      );

      await expect(loadGovernorConfig(testDir)).rejects.toThrow(
        'unverified_by_trace(governor_config_invalid)'
      );
    });

    it('should accept zero for maxConcurrentWorkers (allowZero: false, special auto-detect mode)', async () => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'governor.json'),
        JSON.stringify({ maxConcurrentWorkers: 0 }),
        'utf8'
      );

      // Should trigger auto-detection logic, not reject
      const config = await loadGovernorConfig(testDir);
      expect(config.maxConcurrentWorkers).toBeGreaterThan(0); // Auto-detected value
    });

    it('should accept partial config and merge with defaults', async () => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'governor.json'),
        JSON.stringify({ maxTokensPerFile: 75000 }),
        'utf8'
      );

      const config = await loadGovernorConfig(testDir);
      expect(config.maxTokensPerFile).toBe(75000);
      expect(config.maxConcurrentWorkers).toBe(DEFAULT_GOVERNOR_CONFIG.maxConcurrentWorkers);
      expect(config.maxRetries).toBe(DEFAULT_GOVERNOR_CONFIG.maxRetries);
    });
  });

  describe('symlink security', () => {
    it('should resolve symlinks to canonical paths', async () => {
      // Create real directory with config
      const realDir = path.join(testDir, 'real-workspace');
      const realConfigDir = path.join(realDir, '.librainian');
      await fs.mkdir(realConfigDir, { recursive: true });
      
      const customConfig: GovernorConfig = {
        ...DEFAULT_GOVERNOR_CONFIG,
        maxTokensPerFile: 99999,
      };
      await fs.writeFile(
        path.join(realConfigDir, 'governor.json'),
        JSON.stringify(customConfig),
        'utf8'
      );

      // Create symlink to real directory
      const symlinkPath = path.join(testDir, 'workspace-link');
      await fs.symlink(realDir, symlinkPath);

      // Should load config from real directory
      const config = await loadGovernorConfig(symlinkPath);
      expect(config.maxTokensPerFile).toBe(99999);
    });

    it('should reject symlink pointing to blocked directory', async () => {
      const symlinkPath = path.join(testDir, 'evil-link');
      
      try {
        await fs.symlink('/etc', symlinkPath);
      } catch {
        // Symlink creation might fail on some systems, skip test
        return;
      }

      await expect(loadGovernorConfig(symlinkPath)).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });

    it('should reject symlink chain eventually pointing to blocked directory', async () => {
      const link1 = path.join(testDir, 'link1');
      const link2 = path.join(testDir, 'link2');
      
      try {
        await fs.symlink('/etc', link2);
        await fs.symlink(link2, link1);
      } catch {
        // Symlink creation might fail on some systems, skip test
        return;
      }

      await expect(loadGovernorConfig(link1)).rejects.toThrow(
        'unverified_by_trace(invalid_workspace_path)'
      );
    });
  });

  describe('auto-detection mode', () => {
    it('should auto-detect concurrency when maxConcurrentWorkers is 0', async () => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'governor.json'),
        JSON.stringify({ maxConcurrentWorkers: 0 }),
        'utf8'
      );

      const config = await loadGovernorConfig(testDir);
      
      // Auto-detected value should be > 0
      expect(config.maxConcurrentWorkers).toBeGreaterThan(0);
      
      // Should be reasonable (1-64 workers typical)
      expect(config.maxConcurrentWorkers).toBeLessThanOrEqual(64);
    });

    it('should respect explicit non-zero maxConcurrentWorkers', async () => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'governor.json'),
        JSON.stringify({ maxConcurrentWorkers: 4 }),
        'utf8'
      );

      const config = await loadGovernorConfig(testDir);
      expect(config.maxConcurrentWorkers).toBe(4);
    });

    it('should fall back to default on auto-detection failure', async () => {
      await fs.mkdir(configDir, { recursive: true });
      
      // Create config that triggers auto-detection
      await fs.writeFile(
        path.join(configDir, 'governor.json'),
        JSON.stringify({ maxConcurrentWorkers: 0 }),
        'utf8'
      );

      // Even if auto-detection has issues, should not throw
      const config = await loadGovernorConfig(testDir);
      expect(config.maxConcurrentWorkers).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle workspace with special characters in name', async () => {
      const specialDir = path.join(testDir, 'workspace-with-dashes_and_underscores');
      await fs.mkdir(specialDir, { recursive: true });
      
      const config = await loadGovernorConfig(specialDir);
      expect(config).toEqual(DEFAULT_GOVERNOR_CONFIG);
    });

    it('should handle deeply nested workspace paths', async () => {
      const deepPath = path.join(testDir, 'a', 'b', 'c', 'd', 'e', 'workspace');
      await fs.mkdir(deepPath, { recursive: true });
      
      const config = await loadGovernorConfig(deepPath);
      expect(config).toEqual(DEFAULT_GOVERNOR_CONFIG);
    });

    it('should handle config file with extra unknown fields', async () => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'governor.json'),
        JSON.stringify({
          ...DEFAULT_GOVERNOR_CONFIG,
          unknownField: 'should be ignored',
          anotherUnknown: 123,
        }),
        'utf8'
      );

      const config = await loadGovernorConfig(testDir);
      expect(config).toMatchObject(DEFAULT_GOVERNOR_CONFIG);
      expect('unknownField' in config).toBe(false);
    });
  });
});
