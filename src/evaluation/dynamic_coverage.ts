/**
 * @fileoverview Dynamic Coverage Integration
 *
 * Integrates runtime coverage data from Istanbul/NYC/c8 to validate
 * dead code claims from static analysis:
 * - Loads and parses coverage data from JSON reports
 * - Cross-references static dead code analysis with runtime coverage
 * - Calculates confidence based on both static and dynamic evidence
 * - Handles partial coverage scenarios
 *
 * This is a Tier-1 feature (pure computation, no LLM).
 *
 * @packageDocumentation
 */

import * as fs from 'fs';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Parsed coverage data for a single file
 */
export interface CoverageData {
  /** Absolute path to the file */
  filePath: string;
  /** Line numbers that were executed during tests */
  coveredLines: number[];
  /** Line numbers that were never executed */
  uncoveredLines: number[];
  /** Function coverage data: function name -> coverage info */
  functions: Map<string, { covered: boolean; hitCount: number }>;
  /** Branch coverage data: branch id -> coverage info */
  branches: Map<string, { covered: boolean; hitCount: number }>;
}

/**
 * Evidence for a dead code claim combining static and dynamic analysis
 */
export interface DeadCodeEvidence {
  /** File path where the dead code was detected */
  filePath: string;
  /** Line number in the file */
  lineNumber: number;
  /** Optional symbol name (function, variable, etc.) */
  symbolName?: string;
  /** Whether static analysis detected this as dead code */
  staticAnalysis: boolean;
  /** Whether dynamic coverage confirms it was never executed */
  dynamicEvidence: boolean;
  /** Confidence score from 0.0 to 1.0 */
  confidence: number;
}

/**
 * Interface for the dynamic coverage integrator
 */
export interface DynamicCoverageIntegrator {
  /**
   * Load coverage data from a JSON file path
   * @param coveragePath Path to the coverage JSON file
   * @returns Parsed coverage data for all files
   */
  loadCoverageData(coveragePath: string): Promise<CoverageData[]>;

  /**
   * Parse coverage data from a JSON string
   * @param reportJson JSON string containing coverage report
   * @returns Parsed coverage data for all files
   */
  parseCoverageReport(reportJson: string): CoverageData[];

  /**
   * Cross-reference static dead code analysis with coverage data
   * @param staticDeadCode Array of dead code locations (file:line or file:line:symbol format)
   * @param coverage Coverage data to cross-reference against
   * @returns Evidence for each dead code claim
   */
  crossReferenceWithStatic(staticDeadCode: string[], coverage: CoverageData[]): DeadCodeEvidence[];

  /**
   * Get a summary report of dead code analysis
   * @returns Report with total, confirmed dead, and false positive counts
   */
  getDeadCodeReport(): { total: number; confirmedDead: number; falsePositives: number };
}

// ============================================================================
// ISTANBUL COVERAGE TYPES
// ============================================================================

interface IstanbulStatementMap {
  [key: string]: {
    start: { line: number; column?: number };
    end: { line: number; column?: number };
  };
}

interface IstanbulFunctionMap {
  [key: string]: {
    name: string;
    decl: { start: { line: number; column?: number }; end?: { line: number; column?: number } };
    loc?: { start: { line: number; column?: number }; end: { line: number; column?: number } };
  };
}

interface IstanbulBranchMap {
  [key: string]: {
    type: string;
    locations: Array<{ start: { line: number; column?: number }; end?: { line: number; column?: number } }>;
  };
}

interface IstanbulFileCoverage {
  path: string;
  statementMap: IstanbulStatementMap;
  fnMap: IstanbulFunctionMap;
  branchMap: IstanbulBranchMap;
  s: Record<string, number>; // statement hit counts
  f: Record<string, number>; // function hit counts
  b: Record<string, number[]>; // branch hit counts (array for each branch)
}

type IstanbulCoverageReport = Record<string, IstanbulFileCoverage>;

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Implementation of the DynamicCoverageIntegrator
 */
class DynamicCoverageIntegratorImpl implements DynamicCoverageIntegrator {
  private allEvidence: DeadCodeEvidence[] = [];

  /**
   * Load coverage data from a JSON file
   */
  async loadCoverageData(coveragePath: string): Promise<CoverageData[]> {
    try {
      if (!fs.existsSync(coveragePath)) {
        return [];
      }

      const content = fs.readFileSync(coveragePath, 'utf-8');
      return this.parseCoverageReport(content);
    } catch {
      return [];
    }
  }

  /**
   * Parse coverage report from JSON string
   */
  parseCoverageReport(reportJson: string): CoverageData[] {
    try {
      const report = JSON.parse(reportJson) as IstanbulCoverageReport;
      return this.parseIstanbulReport(report);
    } catch {
      return [];
    }
  }

  /**
   * Cross-reference static dead code with coverage data
   */
  crossReferenceWithStatic(staticDeadCode: string[], coverage: CoverageData[]): DeadCodeEvidence[] {
    const evidence: DeadCodeEvidence[] = [];
    const seen = new Set<string>();

    // Build coverage lookup by file path
    const coverageByFile = new Map<string, CoverageData>();
    for (const cov of coverage) {
      coverageByFile.set(cov.filePath, cov);
      // Also index by basename for relative path matching
      const basename = cov.filePath.split(/[/\\]/).slice(-2).join('/');
      if (!coverageByFile.has(basename)) {
        coverageByFile.set(basename, cov);
      }
    }

    for (const deadCodeRef of staticDeadCode) {
      const parsed = this.parseDeadCodeReference(deadCodeRef);
      if (!parsed) continue;

      const { filePath, lineNumber, symbolName } = parsed;

      // Deduplicate
      const key = `${filePath}:${lineNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Find coverage for this file
      const fileCoverage = this.findCoverageForFile(filePath, coverageByFile);

      const evidenceItem = this.createEvidence(
        filePath,
        lineNumber,
        symbolName,
        fileCoverage,
        coverage.length > 0
      );

      evidence.push(evidenceItem);
    }

    // Store for report
    this.allEvidence.push(...evidence);

    return evidence;
  }

  /**
   * Get summary report of dead code analysis
   */
  getDeadCodeReport(): { total: number; confirmedDead: number; falsePositives: number } {
    const total = this.allEvidence.length;
    const confirmedDead = this.allEvidence.filter(
      (e) => e.staticAnalysis && e.dynamicEvidence
    ).length;
    const falsePositives = this.allEvidence.filter(
      (e) => e.staticAnalysis && !e.dynamicEvidence && e.confidence < 0.5
    ).length;

    return { total, confirmedDead, falsePositives };
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Parse Istanbul/NYC/c8 coverage report
   */
  private parseIstanbulReport(report: IstanbulCoverageReport): CoverageData[] {
    const result: CoverageData[] = [];

    for (const [filePath, fileCoverage] of Object.entries(report)) {
      if (!fileCoverage || typeof fileCoverage !== 'object') continue;
      if (!fileCoverage.statementMap || !fileCoverage.s) continue;

      const coveredLines: number[] = [];
      const uncoveredLines: number[] = [];
      const functions = new Map<string, { covered: boolean; hitCount: number }>();
      const branches = new Map<string, { covered: boolean; hitCount: number }>();

      // Process statements
      for (const [stmtId, location] of Object.entries(fileCoverage.statementMap)) {
        const hitCount = fileCoverage.s[stmtId] ?? 0;
        const line = location.start.line;

        if (hitCount > 0) {
          if (!coveredLines.includes(line)) {
            coveredLines.push(line);
          }
        } else {
          if (!uncoveredLines.includes(line) && !coveredLines.includes(line)) {
            uncoveredLines.push(line);
          }
        }
      }

      // Process functions
      if (fileCoverage.fnMap && fileCoverage.f) {
        for (const [fnId, fnInfo] of Object.entries(fileCoverage.fnMap)) {
          const hitCount = fileCoverage.f[fnId] ?? 0;
          functions.set(fnInfo.name, {
            covered: hitCount > 0,
            hitCount,
          });
        }
      }

      // Process branches
      if (fileCoverage.branchMap && fileCoverage.b) {
        for (const [branchId, branchInfo] of Object.entries(fileCoverage.branchMap)) {
          const hits = fileCoverage.b[branchId] ?? [];
          const totalHits = hits.reduce((sum, h) => sum + h, 0);
          branches.set(branchId, {
            covered: totalHits > 0,
            hitCount: totalHits,
          });
        }
      }

      result.push({
        filePath: fileCoverage.path || filePath,
        coveredLines: coveredLines.sort((a, b) => a - b),
        uncoveredLines: uncoveredLines.sort((a, b) => a - b),
        functions,
        branches,
      });
    }

    return result;
  }

  /**
   * Parse a dead code reference string (file:line or file:line:symbol)
   */
  private parseDeadCodeReference(
    ref: string
  ): { filePath: string; lineNumber: number; symbolName?: string } | null {
    // Handle Windows paths (C:\path\file.ts:10)
    const windowsMatch = ref.match(/^([A-Za-z]:\\[^:]+):(\d+)(?::(.+))?$/);
    if (windowsMatch) {
      return {
        filePath: windowsMatch[1],
        lineNumber: parseInt(windowsMatch[2], 10),
        symbolName: windowsMatch[3],
      };
    }

    // Handle Unix paths (/path/file.ts:10 or relative/path.ts:10)
    const unixMatch = ref.match(/^(.+):(\d+)(?::(.+))?$/);
    if (unixMatch) {
      return {
        filePath: unixMatch[1],
        lineNumber: parseInt(unixMatch[2], 10),
        symbolName: unixMatch[3],
      };
    }

    return null;
  }

  /**
   * Find coverage data for a file, handling path variations
   */
  private findCoverageForFile(
    filePath: string,
    coverageByFile: Map<string, CoverageData>
  ): CoverageData | undefined {
    // Try exact match first
    if (coverageByFile.has(filePath)) {
      return coverageByFile.get(filePath);
    }

    // Try matching by file name (for relative paths)
    const fileName = filePath.split(/[/\\]/).pop();
    const entries = Array.from(coverageByFile.entries());
    for (const [path, cov] of entries) {
      if (path.endsWith(filePath) || path.split(/[/\\]/).pop() === fileName) {
        return cov;
      }
    }

    // Try matching last two path segments
    const lastTwoSegments = filePath.split(/[/\\]/).slice(-2).join('/');
    if (coverageByFile.has(lastTwoSegments)) {
      return coverageByFile.get(lastTwoSegments);
    }

    return undefined;
  }

  /**
   * Create evidence for a dead code claim
   */
  private createEvidence(
    filePath: string,
    lineNumber: number,
    symbolName: string | undefined,
    fileCoverage: CoverageData | undefined,
    hasCoverageData: boolean
  ): DeadCodeEvidence {
    let dynamicEvidence = false;
    let confidence = 0.5; // Default moderate confidence for static-only

    if (fileCoverage) {
      // Check if line is uncovered
      const isUncovered = fileCoverage.uncoveredLines.includes(lineNumber);
      const isCovered = fileCoverage.coveredLines.includes(lineNumber);

      // Check symbol coverage if available
      let symbolUncovered = false;
      if (symbolName && fileCoverage.functions.has(symbolName)) {
        const funcInfo = fileCoverage.functions.get(symbolName)!;
        symbolUncovered = !funcInfo.covered;
      }

      if (isCovered) {
        // Static analysis says dead, but coverage shows it's executed
        // This is likely a false positive
        dynamicEvidence = false;
        confidence = 0.2; // Low confidence - likely wrong
      } else if (isUncovered || symbolUncovered) {
        // Both static and dynamic agree - high confidence
        dynamicEvidence = true;
        confidence = this.calculateConfidence(fileCoverage, true);
      } else {
        // Line not in either list - might be outside statement boundaries
        // Moderate confidence based on symbol if available
        if (symbolName && fileCoverage.functions.has(symbolName)) {
          const funcInfo = fileCoverage.functions.get(symbolName)!;
          dynamicEvidence = !funcInfo.covered;
          confidence = dynamicEvidence ? 0.85 : 0.3;
        } else {
          dynamicEvidence = false;
          confidence = 0.5;
        }
      }
    } else if (!hasCoverageData) {
      // No coverage data at all - we can only rely on static analysis
      dynamicEvidence = false;
      confidence = 0.6; // Moderate confidence for static-only
    } else {
      // Coverage data exists but not for this file
      // Could be a file that's not covered by tests
      dynamicEvidence = false;
      confidence = 0.5;
    }

    return {
      filePath,
      lineNumber,
      symbolName,
      staticAnalysis: true,
      dynamicEvidence,
      confidence,
    };
  }

  /**
   * Calculate confidence based on overall file coverage quality
   */
  private calculateConfidence(fileCoverage: CoverageData, confirmedUncovered: boolean): number {
    if (!confirmedUncovered) {
      return 0.3;
    }

    const totalLines = fileCoverage.coveredLines.length + fileCoverage.uncoveredLines.length;
    if (totalLines === 0) {
      return 0.5;
    }

    const coverageRatio = fileCoverage.coveredLines.length / totalLines;

    // If coverage is very low, we have less confidence because
    // the line might just be untested, not actually dead
    if (coverageRatio < 0.1) {
      return 0.6; // Low overall coverage - moderate confidence
    } else if (coverageRatio < 0.3) {
      return 0.75; // Fair coverage
    } else if (coverageRatio < 0.6) {
      return 0.85; // Good coverage
    } else {
      return 0.95; // High coverage - very confident
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new DynamicCoverageIntegrator instance
 */
export function createDynamicCoverageIntegrator(): DynamicCoverageIntegrator {
  return new DynamicCoverageIntegratorImpl();
}
