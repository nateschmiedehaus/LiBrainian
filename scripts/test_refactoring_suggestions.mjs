#!/usr/bin/env node
/**
 * Test script for evaluating findRefactoringOpportunities
 *
 * This script runs the refactoring suggestions analysis on the librainian codebase
 * and reports the findings for evaluation.
 */

import {
  findRefactoringOpportunities,
  summarizeRefactoringSuggestions
} from '../dist/recommendations/refactoring_suggestions.js';
import path from 'path';
import { glob } from 'glob';

const WORKSPACE = process.cwd();

/**
 * Create a minimal mock storage that just provides the file list
 * by scanning the src directory. The findRefactoringOpportunities
 * function reads file contents from disk directly.
 */
async function createMockStorage() {
  // Scan for TypeScript files in src/
  const files = await glob('src/**/*.ts', {
    cwd: WORKSPACE,
    ignore: ['**/node_modules/**', '**/__tests__/**', '**/dist/**']
  });

  const fileList = files.map(f => ({
    path: path.join(WORKSPACE, f),
    relativePath: f,
  }));

  return {
    async getFiles() {
      return fileList;
    }
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('LIBRARIAN REFACTORING SUGGESTIONS TEST');
  console.log('='.repeat(80));
  console.log();
  console.log(`Workspace: ${WORKSPACE}`);
  console.log();

  // Create mock storage that scans src directory
  console.log('[INFO] Scanning source files...');
  const storage = await createMockStorage();
  const fileList = await storage.getFiles();
  console.log(`[OK] Found ${fileList.length} TypeScript files to analyze`);
  console.log();

  // Run refactoring analysis with different options
  console.log('-'.repeat(80));
  console.log('RUNNING REFACTORING ANALYSIS');
  console.log('-'.repeat(80));
  console.log();

  // First, analyze with default options (excludes low priority)
  console.log('Running analysis (default options, excluding low priority)...');
  const defaultSuggestions = await findRefactoringOpportunities(storage, undefined, {
    maxFiles: 100,
    longFunctionThreshold: 40,
    duplicateBlockSize: 5,
    includeLowPriority: false,
  });
  console.log(`Found ${defaultSuggestions.length} suggestions`);
  console.log();

  // Then analyze including low priority
  console.log('Running analysis (including low priority)...');
  const allSuggestions = await findRefactoringOpportunities(storage, undefined, {
    maxFiles: 100,
    longFunctionThreshold: 40,
    duplicateBlockSize: 5,
    includeLowPriority: true,
  });
  console.log(`Found ${allSuggestions.length} total suggestions`);
  console.log();

  // Summary
  const summary = summarizeRefactoringSuggestions(allSuggestions);

  console.log('-'.repeat(80));
  console.log('SUMMARY');
  console.log('-'.repeat(80));
  console.log();
  console.log('Total suggestions:', summary.total);
  console.log();
  console.log('By Type:');
  for (const [type, count] of Object.entries(summary.byType)) {
    if (count > 0) {
      console.log(`  ${type}: ${count}`);
    }
  }
  console.log();
  console.log('By Risk:');
  console.log(`  Low: ${summary.byRisk.low}`);
  console.log(`  Medium: ${summary.byRisk.medium}`);
  console.log(`  High: ${summary.byRisk.high}`);
  console.log();
  console.log('By Effort:');
  console.log(`  Trivial: ${summary.byEffort.trivial}`);
  console.log(`  Easy: ${summary.byEffort.easy}`);
  console.log(`  Moderate: ${summary.byEffort.moderate}`);
  console.log(`  Significant: ${summary.byEffort.significant}`);
  console.log();
  console.log(`Automatable: ${summary.automatableCount}`);
  console.log();

  // Top opportunities
  console.log('-'.repeat(80));
  console.log('TOP 5 OPPORTUNITIES');
  console.log('-'.repeat(80));
  console.log();
  for (const opp of summary.topOpportunities) {
    console.log(`  [${opp.type}] ${opp.file}`);
    console.log(`    ${opp.description}`);
    console.log();
  }

  // Detailed breakdown by type
  console.log('-'.repeat(80));
  console.log('DETAILED FINDINGS BY TYPE');
  console.log('-'.repeat(80));
  console.log();

  // Group suggestions by type
  const byType = new Map();
  for (const s of allSuggestions) {
    if (!byType.has(s.type)) {
      byType.set(s.type, []);
    }
    byType.get(s.type).push(s);
  }

  for (const [type, suggestions] of byType) {
    console.log(`\n## ${type.toUpperCase()} (${suggestions.length} found)`);
    console.log();

    // Show up to 5 examples per type
    const examples = suggestions.slice(0, 5);
    for (const s of examples) {
      console.log(`  File: ${s.target.file}`);
      console.log(`  Lines: ${s.target.startLine}-${s.target.endLine}`);
      console.log(`  Description: ${s.description}`);
      console.log(`  Risk: ${s.risk}, Effort: ${s.effort}`);
      if (s.target.code) {
        console.log(`  Code: ${s.target.code.slice(0, 60)}${s.target.code.length > 60 ? '...' : ''}`);
      }
      console.log();
    }

    if (suggestions.length > 5) {
      console.log(`  ... and ${suggestions.length - 5} more\n`);
    }
  }

  console.log('-'.repeat(80));
  console.log('ANALYSIS COMPLETE');
  console.log('-'.repeat(80));
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
