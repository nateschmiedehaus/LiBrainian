/**
 * @fileoverview Test workspace utilities
 *
 * Centralized helpers for creating and cleaning up temporary test workspaces.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Create a temporary workspace directory for testing.
 * @param prefix - Prefix for the temp directory name (default: 'librainian-test-')
 * @returns Path to the created workspace
 */
export async function createTempWorkspace(prefix = 'librainian-test-'): Promise<string> {
  const tmpDir = os.tmpdir();
  const workspace = await fs.mkdtemp(path.join(tmpDir, prefix));
  return workspace;
}

/**
 * Clean up a workspace directory, ignoring errors.
 * @param workspacePath - Path to the workspace to clean up
 */
export async function cleanupWorkspace(workspacePath: string): Promise<void> {
  try {
    await fs.rm(workspacePath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors - the OS will eventually clean up temp dirs
  }
}

/**
 * Create a file within a workspace.
 * Creates parent directories as needed.
 * @param workspace - Root workspace path
 * @param relativePath - Relative path within workspace
 * @param content - File content
 * @returns Absolute path to the created file
 */
export async function createTestFile(
  workspace: string,
  relativePath: string,
  content: string
): Promise<string> {
  const fullPath = path.join(workspace, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  return fullPath;
}

/**
 * Create a workspace with initial files.
 * @param files - Map of relative paths to content
 * @param prefix - Prefix for the temp directory name
 * @returns Path to the created workspace
 */
export async function createWorkspaceWithFiles(
  files: Record<string, string>,
  prefix = 'librainian-test-'
): Promise<string> {
  const workspace = await createTempWorkspace(prefix);
  for (const [relativePath, content] of Object.entries(files)) {
    await createTestFile(workspace, relativePath, content);
  }
  return workspace;
}
