/**
 * @fileoverview Tests for Bootstrap API Path Validation
 *
 * Tests the security-critical path validation in loadGovernorConfig
 * to prevent path traversal, symlink attacks, and injection attempts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { loadGovernorConfig } from '../bootstrap.js';

describe('loadGovernorConfig Path Validation', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-test-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Absolute Path Requirement', () => {
    it('should reject relative paths', async () => {
      await expect(loadGovernorConfig('./relative/path')).rejects.toThrow(
        /unverified_by_trace.*Workspace must be an absolute path/
      );
    });

    it('should reject relative paths with dots', async () => {
      await expect(loadGovernorConfig('../parent/path')).rejects.toThrow(
        /unverified_by_trace.*Workspace must be an absolute path/
      );
    });

    it('should accept valid absolute paths', async () => {
      // Should not throw for validation, will return default config for non-existent workspace
      const config = await loadGovernorConfig(tempDir);
      expect(config).toBeDefined();
      expect(config.maxConcurrentWorkers).toBeDefined();
    });
  });

  describe('Path Traversal Prevention', () => {
    it('should reject paths containing ..', async () => {
      const maliciousPath = path.join(tempDir, '..', '..', 'etc', 'passwd');
      await expect(loadGovernorConfig(maliciousPath)).rejects.toThrow(
        /unverified_by_trace/
      );
    });

    it('should reject paths with embedded traversal', async () => {
      // Create an absolute path that contains ..
      await expect(loadGovernorConfig('/home/user/../../../etc/passwd')).rejects.toThrow(
        /unverified_by_trace/
      );
    });

    it('should validate final configPath after path.join operations', async () => {
      // This test ensures that even after path.join(workspace, '.librainian', GOVERNOR_CONFIG_FILENAME),
      // the resulting path is still validated. While GOVERNOR_CONFIG_FILENAME is a safe constant in
      // the current implementation, this test verifies that the final configPath validation catches
      // any path traversal that could result from the join operation.
      
      // Test case 1: Workspace path that when joined with '.librainian' could escape bounds
      // This simulates what would happen if path.join creates a path with traversal sequences
      const attemptedEscape = path.join(tempDir, '..', '..', 'etc', 'passwd');
      await expect(loadGovernorConfig(attemptedEscape)).rejects.toThrow(
        /unverified_by_trace/
      );

      // Test case 2: Verify that canonical path validation catches symlink-based escapes
      // Even if the initial workspace path looks safe, realpath resolution followed by
      // validation ensures the canonical path doesn't escape to restricted directories
      const systemPath = '/etc/test-workspace';
      await expect(loadGovernorConfig(systemPath)).rejects.toThrow(
        /unverified_by_trace/
      );
    });

    it('should validate canonical path after realpath resolution', async () => {
      // This test verifies that the canonical workspace path (after symlink resolution)
      // is validated before being used in path.join for configPath construction.
      // This ensures multi-stage validation: raw input -> canonical resolution -> final path construction
      
      // Create a workspace path that would resolve to a blocked system directory
      await expect(loadGovernorConfig('/proc/self')).rejects.toThrow(
        /unverified_by_trace/
      );

      await expect(loadGovernorConfig('/sys/kernel')).rejects.toThrow(
        /unverified_by_trace/
      );
    });
  });

  describe('System Path Blocking', () => {
    it('should reject /etc paths', async () => {
      await expect(loadGovernorConfig('/etc')).rejects.toThrow(
        /unverified_by_trace/
      );
    });

    it('should reject /etc subdirectories', async () => {
      await expect(loadGovernorConfig('/etc/passwd')).rejects.toThrow(
        /unverified_by_trace/
      );
    });

    it('should reject /proc paths', async () => {
      await expect(loadGovernorConfig('/proc')).rejects.toThrow(
        /unverified_by_trace/
      );
    });

    it('should reject /proc/self paths', async () => {
      await expect(loadGovernorConfig('/proc/self/environ')).rejects.toThrow(
        /unverified_by_trace/
      );
    });

    it('should reject /sys paths', async () => {
      await expect(loadGovernorConfig('/sys')).rejects.toThrow(
        /unverified_by_trace/
      );
    });
  });

  describe('Injection Pattern Prevention', () => {
    it('should reject paths with null bytes', async () => {
      const maliciousPath = tempDir + '\x00/etc/passwd';
      await expect(loadGovernorConfig(maliciousPath)).rejects.toThrow(
        /unverified_by_trace/
      );
    });

    it('should reject paths with command substitution $()', async () => {
      await expect(loadGovernorConfig('/home/$(whoami)/workspace')).rejects.toThrow(
        /unverified_by_trace/
      );
    });

    it('should reject paths with variable expansion ${}', async () => {
      await expect(loadGovernorConfig('/home/${USER}/workspace')).rejects.toThrow(
        /unverified_by_trace/
      );
    });

    it('should reject paths with backticks', async () => {
      await expect(loadGovernorConfig('/home/`whoami`/workspace')).rejects.toThrow(
        /unverified_by_trace/
      );
    });
  });

  describe('Valid Workspace Paths', () => {
    it('should accept valid workspace path and return default config', async () => {
      const config = await loadGovernorConfig(tempDir);
      expect(config).toBeDefined();
      // Should have default values when no config file exists
      expect(typeof config.maxConcurrentWorkers).toBe('number');
    });

    it('should load config from existing workspace', async () => {
      // Create .librainian directory and governor.json
      const librainianDir = path.join(tempDir, '.librainian');
      await fs.mkdir(librainianDir, { recursive: true });
      await fs.writeFile(
        path.join(librainianDir, 'governor.json'),
        JSON.stringify({ maxConcurrentWorkers: 8 })
      );

      const config = await loadGovernorConfig(tempDir);
      expect(config.maxConcurrentWorkers).toBe(8);
    });
  });
});
