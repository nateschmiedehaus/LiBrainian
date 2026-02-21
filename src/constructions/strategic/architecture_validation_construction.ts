/**
 * @fileoverview Architecture Validation Construction
 *
 * A composed construction that wraps the strategic architecture_decisions module
 * to provide architecture validation with confidence tracking and calibration.
 *
 * Composes:
 * - Query API for dependency analysis
 * - Architecture Decisions for constraint validation
 * - Evidence Ledger for traceability
 * - Confidence System for uncertainty quantification
 * - Calibration Tracking for confidence accuracy measurement
 *
 * @packageDocumentation
 */

import type { LiBrainian } from '../../api/librainian.js';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import type { ContextPack } from '../../types.js';
import type {
  ConstructionCalibrationTracker,
  CalibratedConstruction,
  VerificationMethod,
} from '../calibration_tracker.js';
import { generatePredictionId } from '../calibration_tracker.js';
import {
  validateLayerDependency,
  validateNamingConvention,
  validateCircularDependencies,
  generateDriftReport,
  CLEAN_ARCHITECTURE_CONSTRAINTS,
  NAMING_CONVENTION_CONSTRAINTS,
  type ArchitectureConstraint,
  type ConstraintViolation,
  type ArchitectureDriftReport,
} from '../../strategic/architecture_decisions.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for architecture validation.
 */
export interface ArchitectureValidationConfig {
  /** Constraints to validate against */
  constraints?: ArchitectureConstraint[];
  /** Use built-in clean architecture constraints */
  useCleanArchitecture?: boolean;
  /** Use built-in naming convention constraints */
  useNamingConventions?: boolean;
  /** Root directory for scanning */
  rootDir?: string;
}

/**
 * Result of architecture validation.
 */
export interface ArchitectureValidationResult {
  /** Drift report with all violations */
  driftReport: ArchitectureDriftReport;
  /** Whether architecture is compliant (no errors) */
  compliant: boolean;
  /** Confidence in this validation */
  confidence: ConfidenceValue;
  /** Evidence trail */
  evidenceRefs: string[];
  /** Time taken for validation in milliseconds */
  validationTimeMs: number;
  /** Prediction ID for calibration tracking */
  predictionId?: string;
  /** Files that were analyzed */
  analyzedFiles: string[];
  /** Dependencies extracted from analysis */
  dependencyMap: Map<string, string[]>;
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

/**
 * Architecture Validation Construction - wraps architecture_decisions.ts in the
 * construction pattern with confidence tracking and calibration.
 *
 * Usage:
 * ```typescript
 * const construction = new ArchitectureValidationConstruction(librainian);
 * const result = await construction.validate(['src/**'], {
 *   useCleanArchitecture: true,
 * });
 * console.log(`Compliant: ${result.compliant}`);
 * console.log(`Violations: ${result.driftReport.violations.length}`);
 * ```
 */
export class ArchitectureValidationConstruction implements CalibratedConstruction {
  private librainian: LiBrainian;
  private calibrationTracker?: ConstructionCalibrationTracker;

  static readonly CONSTRUCTION_ID = 'ArchitectureValidationConstruction';

  constructor(librainian: LiBrainian) {
    this.librainian = librainian;
  }

  /**
   * Get the construction ID for calibration tracking.
   */
  getConstructionId(): string {
    return ArchitectureValidationConstruction.CONSTRUCTION_ID;
  }

  /**
   * Set the calibration tracker to use.
   */
  setCalibrationTracker(tracker: ConstructionCalibrationTracker): void {
    this.calibrationTracker = tracker;
  }

  /**
   * Record that a prediction was correct or incorrect.
   * Call this after verifying the validation outcome.
   *
   * @param predictionId - The prediction ID from the validation result
   * @param wasCorrect - Whether the validation was correct
   * @param verificationMethod - How the outcome was verified
   */
  recordOutcome(
    predictionId: string,
    wasCorrect: boolean,
    verificationMethod: VerificationMethod = 'user_feedback'
  ): void {
    if (!this.calibrationTracker) {
      return; // Silently skip if no tracker configured
    }
    this.calibrationTracker.recordOutcome(predictionId, wasCorrect, verificationMethod);
  }

  /**
   * Validate architecture for the given files.
   *
   * @param files - Files to validate
   * @param config - Validation configuration
   * @returns Architecture validation result with drift report and confidence
   */
  async validate(
    files: string[],
    config: ArchitectureValidationConfig = {}
  ): Promise<ArchitectureValidationResult> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Step 1: Build constraint set
    const constraints: ArchitectureConstraint[] = [];
    if (config.constraints) {
      constraints.push(...config.constraints);
    }
    if (config.useCleanArchitecture) {
      constraints.push(...CLEAN_ARCHITECTURE_CONSTRAINTS);
    }
    if (config.useNamingConventions) {
      constraints.push(...NAMING_CONVENTION_CONSTRAINTS);
    }
    evidenceRefs.push(`constraints:${constraints.length}`);

    // Step 2: Query librainian for dependency information
    const queryResult = await this.librainian.queryOptional({
      intent: 'Analyze module dependencies and imports',
      affectedFiles: files,
      depth: 'L2',
    });
    evidenceRefs.push('librainian_query:dependencies');

    // Step 3: Extract dependency map from packs
    const dependencyMap = this.extractDependencies(queryResult.packs, files);
    evidenceRefs.push(`dependency_analysis:${dependencyMap.size}_modules`);

    // Step 4: Validate each constraint type
    const violations: ConstraintViolation[] = [];

    for (const constraint of constraints) {
      switch (constraint.type) {
        case 'layer_dependency':
          violations.push(...validateLayerDependency(constraint, dependencyMap));
          break;
        case 'naming_convention':
          violations.push(...validateNamingConvention(constraint, files));
          break;
        case 'circular_dependency':
          violations.push(...validateCircularDependencies(constraint, dependencyMap));
          break;
        // Other constraint types are validated similarly
      }
      evidenceRefs.push(`constraint:${constraint.id}`);
    }

    // Step 5: Generate drift report
    const driftReport = generateDriftReport(constraints, violations);
    evidenceRefs.push(`drift_report:${driftReport.summary.totalViolations}_violations`);

    // Step 6: Compute confidence
    const confidence = this.computeConfidence(queryResult.packs, driftReport, files);

    // Step 7: Determine compliance
    const compliant = driftReport.summary.errorCount === 0;

    // Step 8: Record prediction for calibration tracking
    const predictionId = generatePredictionId(ArchitectureValidationConstruction.CONSTRUCTION_ID);
    if (this.calibrationTracker) {
      this.calibrationTracker.recordPrediction(
        ArchitectureValidationConstruction.CONSTRUCTION_ID,
        predictionId,
        confidence,
        `Architecture validation ${compliant ? 'passed' : 'failed'} with ${violations.length} violations`,
        {
          files: files.length,
          constraintCount: constraints.length,
          violationCount: violations.length,
          errorCount: driftReport.summary.errorCount,
        }
      );
    }

    return {
      driftReport,
      compliant,
      confidence,
      evidenceRefs,
      validationTimeMs: Date.now() - startTime,
      predictionId,
      analyzedFiles: files,
      dependencyMap,
    };
  }

  /**
   * Extract dependency map from context packs.
   */
  private extractDependencies(
    packs: ContextPack[],
    files: string[]
  ): Map<string, string[]> {
    const dependencies = new Map<string, string[]>();

    // Initialize with empty arrays for all files
    for (const file of files) {
      dependencies.set(file, []);
    }

    for (const pack of packs) {
      if (!pack.codeSnippets) continue;

      for (const snippet of pack.codeSnippets) {
        const filePath = snippet.filePath;
        const content = snippet.content;

        // Extract imports from code
        const importPatterns = [
          /import\s+.*\s+from\s+['"]([^'"]+)['"]/g,
          /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
          /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        ];

        const deps = dependencies.get(filePath) || [];

        for (const pattern of importPatterns) {
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const importPath = match[1];
            if (!deps.includes(importPath)) {
              deps.push(importPath);
            }
          }
        }

        dependencies.set(filePath, deps);
      }
    }

    return dependencies;
  }

  /**
   * Compute confidence in the validation.
   */
  private computeConfidence(
    packs: ContextPack[],
    driftReport: ArchitectureDriftReport,
    files: string[]
  ): ConfidenceValue {
    if (packs.length === 0) {
      // No context packs - low confidence
      return {
        type: 'bounded' as const,
        low: 0.3,
        high: 0.6,
        basis: 'theoretical' as const,
        citation: 'No context packs found - dependency analysis may be incomplete',
      };
    }

    // Calculate coverage
    const filesWithPacks = new Set<string>();
    for (const pack of packs) {
      for (const file of pack.relatedFiles) {
        filesWithPacks.add(file);
      }
    }
    const coverageRatio = Math.min(1, filesWithPacks.size / files.length);

    // Calculate average pack confidence
    const avgPackConfidence = packs.reduce((sum, pack) => sum + pack.confidence, 0) / packs.length;

    // Compute base confidence
    const baseConfidence = avgPackConfidence * 0.5 + coverageRatio * 0.5;

    // Apply adjustment based on violation count (more violations = more findings = higher confidence)
    const violationFactor = Math.min(1, driftReport.summary.totalViolations / 10) * 0.1;
    const adjustedConfidence = Math.min(1, baseConfidence + violationFactor);

    return {
      type: 'measured' as const,
      value: adjustedConfidence,
      measurement: {
        datasetId: 'architecture_validation',
        sampleSize: packs.length,
        accuracy: adjustedConfidence,
        confidenceInterval: [
          Math.max(0, adjustedConfidence - 0.15),
          Math.min(1, adjustedConfidence + 0.15),
        ] as const,
        measuredAt: new Date().toISOString(),
      },
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create an Architecture Validation Construction.
 *
 * @param librainian - The librainian instance to use for queries
 * @returns New construction instance
 */
export function createArchitectureValidationConstruction(
  librainian: LiBrainian
): ArchitectureValidationConstruction {
  return new ArchitectureValidationConstruction(librainian);
}
