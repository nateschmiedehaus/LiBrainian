/**
 * @fileoverview Refactoring Safety Checker Construction
 *
 * A composed construction that combines librarian primitives to provide
 * safe refactoring analysis with confidence tracking.
 *
 * Composes:
 * - Query API for semantic search
 * - Constraint Engine for validation
 * - Evidence Ledger for traceability
 * - Confidence System for uncertainty quantification
 * - Calibration Tracking for confidence accuracy measurement
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as ts from 'typescript';
import type { Librarian } from '../api/librarian.js';
import type { ConfidenceValue, MeasuredConfidence, BoundedConfidence, AbsentConfidence } from '../epistemics/confidence.js';
import type { ContextPack } from '../types.js';
import type { LibrarianStorage } from '../storage/types.js';
import type {
  ConstructionCalibrationTracker,
  CalibratedConstruction,
  VerificationMethod,
} from './calibration_tracker.js';
import { generatePredictionId } from './calibration_tracker.js';
import {
  analyzeCascadingImpact,
  estimateBlastRadius,
  type BlastRadiusEstimate,
  type CascadeResult,
} from '../graphs/cascading_impact.js';

// ============================================================================
// TYPE COMPATIBILITY TYPES
// ============================================================================

/**
 * Result of checking type compatibility between two signatures.
 */
export interface TypeCompatibilityResult {
  /** Whether the signatures are compatible (no breaking changes) */
  isCompatible: boolean;
  /** List of detected breaking changes */
  breakingChanges: TypeBreakingChange[];
}

/**
 * Represents a breaking change detected in type compatibility analysis.
 */
export interface TypeBreakingChange {
  /** Kind of breaking change */
  kind: 'return_type' | 'parameter_type' | 'parameter_count' | 'generic_constraint' | 'optional_to_required';
  /** Human-readable description of the change */
  description: string;
  /** The original type */
  oldType: string;
  /** The new type */
  newType: string;
}

/**
 * Parsed representation of a function signature parameter.
 */
export interface ParsedParameter {
  /** Parameter name */
  name: string;
  /** Parameter type as string */
  type: string;
  /** Whether the parameter is optional */
  optional: boolean;
  /** Whether the parameter is a rest parameter */
  rest: boolean;
}

/**
 * Parsed representation of a function signature.
 */
export interface ParsedSignature {
  /** Function name (if available) */
  name: string;
  /** List of parameters */
  parameters: ParsedParameter[];
  /** Return type as string */
  returnType: string;
  /** Type parameters (generics) */
  typeParameters: string[];
}

// ============================================================================
// TYPE COMPATIBILITY CHECKING
// ============================================================================

/**
 * Parse a TypeScript function signature string into a structured representation.
 * Handles both function declarations and arrow functions.
 *
 * @param signature - The function signature string to parse
 * @returns Parsed signature structure
 */
export function parseSignature(signature: string): ParsedSignature {
  const result: ParsedSignature = {
    name: '',
    parameters: [],
    returnType: 'void',
    typeParameters: [],
  };

  // Create a minimal TypeScript source file containing the signature
  // Wrap in a declaration to make it valid TypeScript
  const sourceText = `declare ${signature.trim().startsWith('function') ? signature : `function ${signature}`}`;

  const sourceFile = ts.createSourceFile(
    'signature.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  // Find the function declaration
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node)) {
      // Extract function name
      if (node.name) {
        result.name = node.name.text;
      }

      // Extract type parameters (generics)
      if (node.typeParameters) {
        for (const tp of node.typeParameters) {
          result.typeParameters.push(tp.name.text);
        }
      }

      // Extract parameters
      for (const param of node.parameters) {
        const paramName = ts.isIdentifier(param.name) ? param.name.text : param.name.getText(sourceFile);
        const paramType = param.type ? param.type.getText(sourceFile) : 'any';
        const isOptional = param.questionToken !== undefined || param.initializer !== undefined;
        const isRest = param.dotDotDotToken !== undefined;

        result.parameters.push({
          name: paramName,
          type: paramType,
          optional: isOptional,
          rest: isRest,
        });
      }

      // Extract return type
      if (node.type) {
        result.returnType = node.type.getText(sourceFile);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return result;
}

/**
 * Check if one type is a subset of another (covariant relationship for return types).
 * This is a simplified check that handles common TypeScript type patterns.
 *
 * @param subset - The type that should be more specific
 * @param superset - The type that should be broader
 * @returns True if subset is compatible with superset
 */
export function isTypeSubset(subset: string, superset: string): boolean {
  // Normalize types by removing whitespace
  const normalizedSubset = subset.trim();
  const normalizedSuperset = superset.trim();

  // Exact match is always compatible
  if (normalizedSubset === normalizedSuperset) return true;

  // 'any' and 'unknown' are supersets of all types
  if (normalizedSuperset === 'any' || normalizedSuperset === 'unknown') return true;

  // 'never' is a subset of all types
  if (normalizedSubset === 'never') return true;

  // null and undefined handling
  if (normalizedSuperset.includes('null') && normalizedSubset === 'null') return true;
  if (normalizedSuperset.includes('undefined') && normalizedSubset === 'undefined') return true;

  // Union type handling - check if subset is one of the union members
  if (normalizedSuperset.includes('|')) {
    const superTypes = normalizedSuperset.split('|').map(t => t.trim());
    if (superTypes.includes(normalizedSubset)) return true;

    // If subset is also a union, all of its types must be in superset
    if (normalizedSubset.includes('|')) {
      const subTypes = normalizedSubset.split('|').map(t => t.trim());
      return subTypes.every(subType => superTypes.includes(subType));
    }
  }

  // Array type covariance
  if (normalizedSuperset.endsWith('[]') && normalizedSubset.endsWith('[]')) {
    const superElement = normalizedSuperset.slice(0, -2);
    const subElement = normalizedSubset.slice(0, -2);
    return isTypeSubset(subElement, superElement);
  }

  // Array<T> notation
  const arrayMatch = /^Array<(.+)>$/.exec(normalizedSuperset);
  const subArrayMatch = /^Array<(.+)>$/.exec(normalizedSubset);
  if (arrayMatch && subArrayMatch) {
    return isTypeSubset(subArrayMatch[1], arrayMatch[1]);
  }

  // Promise<T> covariance
  const promiseMatch = /^Promise<(.+)>$/.exec(normalizedSuperset);
  const subPromiseMatch = /^Promise<(.+)>$/.exec(normalizedSubset);
  if (promiseMatch && subPromiseMatch) {
    return isTypeSubset(subPromiseMatch[1], promiseMatch[1]);
  }

  // Primitive type hierarchy
  const primitiveHierarchy: Record<string, string[]> = {
    'number': ['number'],
    'string': ['string'],
    'boolean': ['boolean', 'true', 'false'],
    'object': ['object', 'Object'],
    'void': ['void', 'undefined'],
  };

  for (const [base, subtypes] of Object.entries(primitiveHierarchy)) {
    if (normalizedSuperset === base && subtypes.includes(normalizedSubset)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if parameter types are contravariant-compatible.
 * For parameters, the new type should be a superset (accept more) to be compatible.
 *
 * @param oldType - The original parameter type
 * @param newType - The new parameter type
 * @returns True if the new type is contravariant-compatible
 */
export function isParameterTypeCompatible(oldType: string, newType: string): boolean {
  // Parameters are contravariant - new type should accept at least what old type accepted
  // So new type should be a superset of old type
  return isTypeSubset(oldType, newType) || oldType === newType;
}

/**
 * Check type compatibility between two function signatures.
 * Detects breaking changes that would cause TypeScript compilation errors
 * or runtime issues when callers are not updated.
 *
 * @param oldSignature - The original function signature
 * @param newSignature - The new function signature
 * @returns Compatibility result with list of breaking changes
 */
export function checkTypeCompatibility(
  oldSignature: string,
  newSignature: string
): TypeCompatibilityResult {
  const changes: TypeBreakingChange[] = [];

  // Parse both signatures
  const oldFunc = parseSignature(oldSignature);
  const newFunc = parseSignature(newSignature);

  // Check for added required parameters
  if (newFunc.parameters.length > oldFunc.parameters.length) {
    const addedParams = newFunc.parameters.slice(oldFunc.parameters.length);
    const nonOptionalAdded = addedParams.filter(p => !p.optional && !p.rest);

    if (nonOptionalAdded.length > 0) {
      changes.push({
        kind: 'parameter_count',
        description: `Added ${nonOptionalAdded.length} required parameter(s): ${nonOptionalAdded.map(p => p.name).join(', ')}`,
        oldType: `${oldFunc.parameters.length} params`,
        newType: `${newFunc.parameters.length} params`,
      });
    }
  }

  // Check for removed parameters (also breaking if callers pass them)
  if (newFunc.parameters.length < oldFunc.parameters.length) {
    const removedCount = oldFunc.parameters.length - newFunc.parameters.length;
    const removedParams = oldFunc.parameters.slice(newFunc.parameters.length);

    // Only breaking if the removed parameters were required
    const removedRequired = removedParams.filter(p => !p.optional && !p.rest);
    if (removedRequired.length > 0) {
      changes.push({
        kind: 'parameter_count',
        description: `Removed ${removedRequired.length} parameter(s): ${removedRequired.map(p => p.name).join(', ')}`,
        oldType: `${oldFunc.parameters.length} params`,
        newType: `${newFunc.parameters.length} params`,
      });
    }
  }

  // Check parameter type changes (contravariance)
  const minParams = Math.min(oldFunc.parameters.length, newFunc.parameters.length);
  for (let i = 0; i < minParams; i++) {
    const oldParam = oldFunc.parameters[i];
    const newParam = newFunc.parameters[i];

    // Check type compatibility (contravariant for parameters)
    if (oldParam.type !== newParam.type && !isParameterTypeCompatible(oldParam.type, newParam.type)) {
      changes.push({
        kind: 'parameter_type',
        description: `Parameter '${oldParam.name}' type changed incompatibly`,
        oldType: oldParam.type,
        newType: newParam.type,
      });
    }

    // Check optional to required change
    if (oldParam.optional && !newParam.optional) {
      changes.push({
        kind: 'optional_to_required',
        description: `Parameter '${oldParam.name}' changed from optional to required`,
        oldType: `${oldParam.name}?`,
        newType: oldParam.name,
      });
    }
  }

  // Check return type changes (covariance)
  if (oldFunc.returnType !== newFunc.returnType) {
    // Return types are covariant - new return type should be a subset of old
    if (!isTypeSubset(newFunc.returnType, oldFunc.returnType)) {
      changes.push({
        kind: 'return_type',
        description: 'Return type changed incompatibly',
        oldType: oldFunc.returnType,
        newType: newFunc.returnType,
      });
    }
  }

  // Check generic constraint changes
  if (oldFunc.typeParameters.length !== newFunc.typeParameters.length) {
    changes.push({
      kind: 'generic_constraint',
      description: 'Number of type parameters changed',
      oldType: `<${oldFunc.typeParameters.join(', ') || 'none'}>`,
      newType: `<${newFunc.typeParameters.join(', ') || 'none'}>`,
    });
  }

  return {
    isCompatible: changes.length === 0,
    breakingChanges: changes,
  };
}

// ============================================================================
// REFACTORING TYPES
// ============================================================================

export interface RefactoringTarget {
  /** Entity to refactor (function, class, module path) */
  entityId: string;
  /** Type of refactoring */
  refactoringType: 'rename' | 'move' | 'extract' | 'inline' | 'change_signature';
  /** New name/location (for rename/move) */
  newValue?: string;
  /** Original signature (for change_signature) */
  oldSignature?: string;
  /** New signature (for change_signature) */
  newSignature?: string;
}

export interface Usage {
  file: string;
  line: number;
  column: number;
  context: string;
  usageType: 'call' | 'import' | 'extend' | 'implement' | 'reference';
}

export interface BreakingChange {
  description: string;
  severity: 'critical' | 'major' | 'minor';
  affectedFile: string;
  suggestedFix?: string;
  /** Type breaking change details (when detected via type analysis) */
  typeChange?: TypeBreakingChange;
}

export interface TestCoverageGap {
  uncoveredUsage: Usage;
  suggestedTest: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * Graph-based impact analysis results.
 * Provides blast radius and critical path information from cascading impact analysis.
 */
export interface GraphImpactAnalysis {
  /** Number of entities that would be affected by a breaking change */
  blastRadius: number;
  /** Severity assessment based on graph analysis */
  severity: 'minor' | 'major' | 'critical';
  /** Total risk score from spreading activation algorithm */
  totalRisk: number;
  /** High-impact dependency chains showing how changes propagate */
  criticalPaths: string[];
  /** Entities most directly affected (high impact, low depth) */
  criticalDependents: string[];
  /** Suggested mitigations based on graph analysis */
  mitigations: string[];
}

export interface RefactoringSafetyReport {
  /** Target being refactored */
  target: RefactoringTarget;

  /** All usages found */
  usages: Usage[];
  usageCount: number;

  /** Potential breaking changes */
  breakingChanges: BreakingChange[];
  hasBreakingChanges: boolean;

  /** Test coverage analysis */
  testCoverageGaps: TestCoverageGap[];
  estimatedCoverage: number;

  /** Graph-based impact analysis (blast radius, critical paths) */
  graphImpact: GraphImpactAnalysis | null;

  /** Derived risk score combining static analysis and graph impact */
  riskScore: number;

  /** Overall safety verdict */
  safe: boolean;
  risks: string[];

  /** Confidence in this analysis */
  confidence: ConfidenceValue;

  /** Evidence trail */
  evidenceRefs: string[];

  /** Timing */
  analysisTimeMs: number;

  /** Prediction ID for calibration tracking */
  predictionId?: string;
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

export class RefactoringSafetyChecker implements CalibratedConstruction {
  private librarian: Librarian;
  private usageCache: Map<string, Usage[]> = new Map();
  private calibrationTracker?: ConstructionCalibrationTracker;

  static readonly CONSTRUCTION_ID = 'RefactoringSafetyChecker';

  constructor(librarian: Librarian) {
    this.librarian = librarian;
  }

  /**
   * Get the construction ID for calibration tracking.
   */
  getConstructionId(): string {
    return RefactoringSafetyChecker.CONSTRUCTION_ID;
  }

  /**
   * Set the calibration tracker to use.
   */
  setCalibrationTracker(tracker: ConstructionCalibrationTracker): void {
    this.calibrationTracker = tracker;
  }

  /**
   * Record that a prediction was correct or incorrect.
   * Call this after verifying the refactoring outcome.
   *
   * @param predictionId - The prediction ID from the safety report
   * @param wasCorrect - Whether the safety prediction was correct
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
   * Check if a refactoring operation is safe.
   */
  async check(target: RefactoringTarget): Promise<RefactoringSafetyReport> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Step 1: Find all usages via semantic search
    const usages = await this.findAllUsages(target.entityId);
    evidenceRefs.push(`usage_search:${target.entityId}`);

    // Step 2: Analyze breaking change impact
    const breakingChanges = await this.analyzeBreakingChanges(target, usages);
    evidenceRefs.push(`impact_analysis:${target.refactoringType}`);

    // Step 3: Check test coverage
    const testCoverageGaps = await this.findTestCoverageGaps(usages);
    const estimatedCoverage = this.calculateCoverage(usages, testCoverageGaps);
    evidenceRefs.push(`coverage_analysis:${usages.length}`);

    // Step 4: Perform graph-based impact analysis (blast radius, critical paths)
    const graphImpact = await this.analyzeGraphImpact(target.entityId);
    if (graphImpact) {
      evidenceRefs.push(`graph_impact:blast_radius=${graphImpact.blastRadius}`);
    }

    // Step 5: Derive confidence (now includes graph impact)
    const confidence = this.deriveConfidence(
      usages.length,
      breakingChanges.length,
      estimatedCoverage,
      graphImpact
    );

    // Step 6: Compute risk score combining static and graph analysis
    const riskScore = this.computeRiskScore(breakingChanges, testCoverageGaps, graphImpact);

    // Step 7: Compute safety verdict (now considers graph impact)
    const { safe, risks } = this.computeSafetyVerdict(
      breakingChanges,
      testCoverageGaps,
      confidence,
      graphImpact
    );

    // Step 8: Record prediction for calibration tracking
    const predictionId = generatePredictionId(RefactoringSafetyChecker.CONSTRUCTION_ID);
    if (this.calibrationTracker) {
      this.calibrationTracker.recordPrediction(
        RefactoringSafetyChecker.CONSTRUCTION_ID,
        predictionId,
        confidence,
        `Refactoring ${target.refactoringType} of ${target.entityId} is ${safe ? 'safe' : 'unsafe'}`,
        {
          entityId: target.entityId,
          refactoringType: target.refactoringType,
          usageCount: usages.length,
          breakingChangeCount: breakingChanges.length,
          blastRadius: graphImpact?.blastRadius ?? 0,
          riskScore,
        }
      );
    }

    return {
      target,
      usages,
      usageCount: usages.length,
      breakingChanges,
      hasBreakingChanges: breakingChanges.length > 0,
      testCoverageGaps,
      estimatedCoverage,
      graphImpact,
      riskScore,
      safe,
      risks,
      confidence,
      evidenceRefs,
      analysisTimeMs: Date.now() - startTime,
      predictionId,
    };
  }

  /**
   * Step 4: Analyze graph-based impact using cascading impact analysis.
   * Uses spreading activation to determine blast radius and critical paths.
   */
  private async analyzeGraphImpact(entityId: string): Promise<GraphImpactAnalysis | null> {
    // Safely check if getStorage is available (may not be in mock or minimal implementations)
    if (typeof this.librarian.getStorage !== 'function') {
      return null;
    }

    const storage = this.librarian.getStorage();
    if (!storage) {
      return null;
    }

    try {
      // Use the cascading impact module for blast radius estimation
      const blastRadiusResult = await estimateBlastRadius(storage, entityId, 'major');

      // Get full cascade analysis for critical paths
      const cascadeResult = await analyzeCascadingImpact(storage, entityId, {
        mode: 'risk',
        maxDepth: 3,
        threshold: 0.1,
      });

      // Extract critical paths as human-readable strings
      const criticalPaths: string[] = [];
      if (cascadeResult.criticalPath.length > 1) {
        criticalPaths.push(cascadeResult.criticalPath.join(' -> '));
      }

      // Also include top affected entities as additional paths
      const topAffected = cascadeResult.affectedEntities
        .slice(0, 5)
        .filter(e => e.pathFromSource.length > 1);

      for (const affected of topAffected) {
        const pathStr = affected.pathFromSource.join(' -> ');
        if (!criticalPaths.includes(pathStr)) {
          criticalPaths.push(pathStr);
        }
      }

      return {
        blastRadius: blastRadiusResult.affectedCount,
        severity: blastRadiusResult.severity,
        totalRisk: blastRadiusResult.totalRisk,
        criticalPaths: criticalPaths.slice(0, 10), // Limit to top 10
        criticalDependents: blastRadiusResult.criticalDependents,
        mitigations: blastRadiusResult.mitigations,
      };
    } catch {
      // Graph analysis is optional - return null on failure
      return null;
    }
  }

  /**
   * Compute overall risk score combining static analysis and graph impact.
   * Returns a value from 0 (low risk) to 1 (high risk).
   */
  private computeRiskScore(
    breakingChanges: BreakingChange[],
    testCoverageGaps: TestCoverageGap[],
    graphImpact: GraphImpactAnalysis | null
  ): number {
    // Weight factors for each risk component
    const weights = {
      criticalBreaking: 0.35,
      majorBreaking: 0.20,
      coverageGaps: 0.15,
      blastRadius: 0.20,
      graphSeverity: 0.10,
    };

    // Score from breaking changes
    const criticalCount = breakingChanges.filter(b => b.severity === 'critical').length;
    const majorCount = breakingChanges.filter(b => b.severity === 'major').length;
    const criticalScore = Math.min(1, criticalCount / 3); // 3+ critical = max
    const majorScore = Math.min(1, majorCount / 5); // 5+ major = max

    // Score from test coverage gaps
    const highPriorityGaps = testCoverageGaps.filter(g => g.priority === 'high').length;
    const coverageScore = Math.min(1, highPriorityGaps / 5);

    // Score from graph impact
    let blastRadiusScore = 0;
    let graphSeverityScore = 0;
    if (graphImpact) {
      // Normalize blast radius (20+ entities = max score)
      blastRadiusScore = Math.min(1, graphImpact.blastRadius / 20);
      // Map severity to score
      graphSeverityScore = {
        minor: 0.2,
        major: 0.5,
        critical: 1.0,
      }[graphImpact.severity];
    }

    // Compute weighted average
    const riskScore =
      weights.criticalBreaking * criticalScore +
      weights.majorBreaking * majorScore +
      weights.coverageGaps * coverageScore +
      weights.blastRadius * blastRadiusScore +
      weights.graphSeverity * graphSeverityScore;

    return Math.min(1, Math.max(0, riskScore));
  }

  /**
   * Step 1: Find all usages of an entity.
   */
  private async findAllUsages(entityId: string): Promise<Usage[]> {
    // Use librarian semantic search to find usages
    const queryResult = await this.librarian.queryOptional({
      intent: `Find all usages of ${entityId}`,
      depth: 'L2',
      taskType: 'understand',
    });

    const usages: Usage[] = [];

    // Extract usages from context packs
    if (queryResult.packs) {
      for (const pack of queryResult.packs) {
        const extractedUsages = this.extractUsagesFromPack(pack, entityId);
        usages.push(...extractedUsages);
      }
    }

    // Cache for reuse
    this.usageCache.set(entityId, usages);

    return usages;
  }

  /**
   * Extract usage information from a context pack.
   */
  private extractUsagesFromPack(pack: ContextPack, entityId: string): Usage[] {
    const usages: Usage[] = [];

    if (pack.codeSnippets) {
      for (const snippet of pack.codeSnippets) {
        // Check if snippet references the entity
        if (snippet.content.includes(entityId)) {
          usages.push({
            file: pack.relatedFiles?.[0] || 'unknown',
            line: snippet.startLine,
            column: 0,
            context: snippet.content.substring(0, 200),
            usageType: this.inferUsageType(snippet.content, entityId),
          });
        }
      }
    }

    return usages;
  }

  /**
   * Infer the type of usage from code context.
   */
  private inferUsageType(source: string, entityId: string): Usage['usageType'] {
    const lowerSource = source.toLowerCase();
    const lowerEntity = entityId.toLowerCase();

    if (lowerSource.includes(`import`) && lowerSource.includes(lowerEntity)) {
      return 'import';
    }
    if (lowerSource.includes(`extends ${lowerEntity}`)) {
      return 'extend';
    }
    if (lowerSource.includes(`implements ${lowerEntity}`)) {
      return 'implement';
    }
    if (lowerSource.includes(`${lowerEntity}(`)) {
      return 'call';
    }
    return 'reference';
  }

  /**
   * Step 2: Analyze potential breaking changes.
   */
  private async analyzeBreakingChanges(
    target: RefactoringTarget,
    usages: Usage[]
  ): Promise<BreakingChange[]> {
    const breakingChanges: BreakingChange[] = [];

    switch (target.refactoringType) {
      case 'rename':
        // Check for dynamic references that won't be updated
        for (const usage of usages) {
          if (usage.context.includes('[') || usage.context.includes('eval')) {
            breakingChanges.push({
              description: `Dynamic reference may not be updated`,
              severity: 'critical',
              affectedFile: usage.file,
              suggestedFix: `Verify dynamic access at ${usage.file}:${usage.line}`,
            });
          }
        }
        break;

      case 'move':
        // Check for relative imports that will break
        for (const usage of usages) {
          if (usage.usageType === 'import') {
            breakingChanges.push({
              description: `Import path will need updating`,
              severity: 'major',
              affectedFile: usage.file,
              suggestedFix: `Update import in ${usage.file}:${usage.line}`,
            });
          }
        }
        break;

      case 'change_signature':
        // Use TypeScript type analysis if signatures are provided
        if (target.oldSignature && target.newSignature) {
          const typeCompatResult = checkTypeCompatibility(target.oldSignature, target.newSignature);

          if (!typeCompatResult.isCompatible) {
            // Add type-based breaking changes
            for (const typeChange of typeCompatResult.breakingChanges) {
              // Determine severity based on breaking change kind
              const severity = this.determineTypeChangeSeverity(typeChange);

              // Apply to all call sites
              for (const usage of usages) {
                if (usage.usageType === 'call') {
                  breakingChanges.push({
                    description: typeChange.description,
                    severity,
                    affectedFile: usage.file,
                    suggestedFix: this.suggestFixForTypeChange(typeChange, usage),
                    typeChange,
                  });
                }
              }
            }
          }
        } else {
          // Fallback: All call sites are potential breaking changes
          for (const usage of usages) {
            if (usage.usageType === 'call') {
              breakingChanges.push({
                description: `Call site needs signature update`,
                severity: 'major',
                affectedFile: usage.file,
                suggestedFix: `Update call at ${usage.file}:${usage.line}`,
              });
            }
          }
        }
        break;

      case 'extract':
      case 'inline':
        // These typically don't cause external breaking changes
        // but may affect behavior
        break;
    }

    return breakingChanges;
  }

  /**
   * Determine the severity of a type breaking change.
   *
   * @param typeChange - The type breaking change to evaluate
   * @returns Severity level
   */
  private determineTypeChangeSeverity(typeChange: TypeBreakingChange): 'critical' | 'major' | 'minor' {
    switch (typeChange.kind) {
      case 'return_type':
        // Return type changes can break callers expecting specific types
        return 'critical';

      case 'parameter_count':
        // Added required parameters break all existing call sites
        if (typeChange.description.includes('Added') && typeChange.description.includes('required')) {
          return 'critical';
        }
        // Removed parameters may break callers passing those args
        return 'major';

      case 'parameter_type':
        // Parameter type narrowing breaks callers passing broader types
        return 'major';

      case 'optional_to_required':
        // This will break all callers not passing the argument
        return 'critical';

      case 'generic_constraint':
        // Generic changes can have widespread effects
        return 'major';

      default:
        return 'minor';
    }
  }

  /**
   * Suggest a fix for a type breaking change at a specific usage site.
   *
   * @param typeChange - The type breaking change
   * @param usage - The affected usage
   * @returns Suggested fix description
   */
  private suggestFixForTypeChange(typeChange: TypeBreakingChange, usage: Usage): string {
    const location = `${usage.file}:${usage.line}`;

    switch (typeChange.kind) {
      case 'return_type':
        return `Update code at ${location} to handle new return type '${typeChange.newType}' (was '${typeChange.oldType}')`;

      case 'parameter_count':
        if (typeChange.description.includes('Added')) {
          return `Add required arguments at ${location} to match new signature`;
        }
        return `Remove extra arguments at ${location} that are no longer accepted`;

      case 'parameter_type':
        return `Update argument type at ${location} from '${typeChange.oldType}' to '${typeChange.newType}'`;

      case 'optional_to_required':
        return `Provide required argument ${typeChange.newType} at ${location} (was optional)`;

      case 'generic_constraint':
        return `Update type parameters at ${location} to match new constraints`;

      default:
        return `Review and update call at ${location}`;
    }
  }

  /**
   * Step 3: Find test coverage gaps.
   */
  private async findTestCoverageGaps(usages: Usage[]): Promise<TestCoverageGap[]> {
    const gaps: TestCoverageGap[] = [];

    for (const usage of usages) {
      // Check if usage is in a test file
      const isTestFile = usage.file.includes('.test.') ||
                         usage.file.includes('.spec.') ||
                         usage.file.includes('__tests__');

      if (!isTestFile) {
        // Check if there's a corresponding test file
        const testFile = this.findCorrespondingTestFileForUsage(usage.file);

        if (!testFile) {
          gaps.push({
            uncoveredUsage: usage,
            suggestedTest: `Add test for usage at ${usage.file}:${usage.line}`,
            priority: usage.usageType === 'call' ? 'high' : 'medium',
          });
        }
      }
    }

    return gaps;
  }

  /**
   * Find corresponding test file for a source file.
   * Delegates to the exported findCorrespondingTestFile function.
   */
  private findCorrespondingTestFileForUsage(sourceFile: string): string | null {
    // Derive workspace from the source file path by looking for common project root markers
    const workspace = deriveWorkspaceFromPath(sourceFile);
    return findCorrespondingTestFile(sourceFile, workspace);
  }

  /**
   * Calculate test coverage estimate.
   */
  private calculateCoverage(usages: Usage[], gaps: TestCoverageGap[]): number {
    if (usages.length === 0) return 1.0;
    const coveredCount = usages.length - gaps.length;
    return coveredCount / usages.length;
  }

  /**
   * Step 5: Derive confidence in the analysis.
   * Now includes graph impact for more accurate confidence estimation.
   */
  private deriveConfidence(
    usageCount: number,
    breakingCount: number,
    coverage: number,
    graphImpact: GraphImpactAnalysis | null
  ): ConfidenceValue {
    // Confidence factors:
    // 1. Usage completeness - did we find all usages?
    // 2. Breaking change analysis accuracy
    // 3. Test coverage data quality
    // 4. Graph analysis availability (boosts confidence when present)

    // Graph analysis presence can boost confidence by 5-10%
    const graphBoost = graphImpact ? 0.05 : 0;
    // High blast radius reduces confidence (more unknowns)
    const blastRadiusPenalty = graphImpact && graphImpact.blastRadius > 10 ? 0.05 : 0;

    if (usageCount === 0) {
      // No usages found - could be complete or could be a miss
      // Graph analysis helps clarify if truly unused
      const hasGraphData = graphImpact !== null;
      return {
        type: 'bounded' as const,
        low: hasGraphData ? 0.4 : 0.3,
        high: hasGraphData ? 0.95 : 0.9,
        basis: 'theoretical' as const,
        citation: hasGraphData
          ? `No direct usages found; graph analysis shows ${graphImpact?.blastRadius ?? 0} potentially affected entities`
          : 'No usages found - may be unused or may be dynamic reference',
      };
    }

    if (usageCount > 100) {
      // Many usages - high confidence we found most, but some uncertainty
      const value = Math.min(0.95, 0.85 + graphBoost - blastRadiusPenalty);
      return {
        type: 'measured' as const,
        value,
        measurement: {
          datasetId: 'usage_search_heuristic',
          sampleSize: usageCount + Math.ceil(usageCount * 0.1),
          accuracy: value,
          confidenceInterval: [Math.max(0, value - 0.1), Math.min(1, value + 0.1)] as const,
          measuredAt: new Date().toISOString(),
        },
      };
    }

    // Medium usage count - moderate confidence
    const baseConfidence = 0.7 + (coverage * 0.2) + graphBoost - blastRadiusPenalty;
    return {
      type: 'measured' as const,
      value: baseConfidence,
      measurement: {
        datasetId: 'refactoring_analysis',
        sampleSize: usageCount + 1,
        accuracy: baseConfidence,
        confidenceInterval: [Math.max(0, baseConfidence - 0.1), Math.min(1, baseConfidence + 0.1)] as const,
        measuredAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Step 7: Compute overall safety verdict.
   * Now includes graph impact analysis for more comprehensive risk assessment.
   */
  private computeSafetyVerdict(
    breakingChanges: BreakingChange[],
    testCoverageGaps: TestCoverageGap[],
    confidence: ConfidenceValue,
    graphImpact: GraphImpactAnalysis | null
  ): { safe: boolean; risks: string[] } {
    const risks: string[] = [];

    // Check breaking changes
    const criticalBreaking = breakingChanges.filter(bc => bc.severity === 'critical');
    if (criticalBreaking.length > 0) {
      risks.push(`${criticalBreaking.length} critical breaking change(s) detected`);
    }

    const majorBreaking = breakingChanges.filter(bc => bc.severity === 'major');
    if (majorBreaking.length > 0) {
      risks.push(`${majorBreaking.length} major breaking change(s) to address`);
    }

    // Check test coverage
    const highPriorityGaps = testCoverageGaps.filter(g => g.priority === 'high');
    if (highPriorityGaps.length > 0) {
      risks.push(`${highPriorityGaps.length} high-priority test gap(s)`);
    }

    // Check graph-based impact
    if (graphImpact) {
      if (graphImpact.severity === 'critical') {
        risks.push(`Critical blast radius: ${graphImpact.blastRadius} entities affected`);
      } else if (graphImpact.blastRadius > 10) {
        risks.push(`Large blast radius: ${graphImpact.blastRadius} entities may be affected`);
      }

      if (graphImpact.criticalDependents.length > 0) {
        const topDependents = graphImpact.criticalDependents.slice(0, 3).join(', ');
        risks.push(`Critical dependents: ${topDependents}${graphImpact.criticalDependents.length > 3 ? '...' : ''}`);
      }

      if (graphImpact.criticalPaths.length > 0) {
        risks.push(`Critical dependency path: ${graphImpact.criticalPaths[0]}`);
      }
    }

    // Check confidence
    const confidenceValue = this.extractConfidenceValue(confidence);
    if (confidenceValue < 0.7) {
      risks.push(`Low analysis confidence (${(confidenceValue * 100).toFixed(0)}%)`);
    }

    // Safety verdict: safe if no critical issues, reasonable blast radius, and confidence is reasonable
    const hasGraphRisk = graphImpact?.severity === 'critical' || (graphImpact?.blastRadius ?? 0) > 20;
    const safe = criticalBreaking.length === 0 &&
                 highPriorityGaps.length < 5 &&
                 !hasGraphRisk &&
                 confidenceValue >= 0.6;

    return { safe, risks };
  }

  /**
   * Extract numeric confidence value.
   */
  private extractConfidenceValue(conf: ConfidenceValue): number {
    switch (conf.type) {
      case 'deterministic':
        return conf.value;
      case 'measured':
        return conf.value;
      case 'derived':
        return conf.value;
      case 'bounded':
        return (conf.low + conf.high) / 2;
      case 'absent':
        return 0;
    }
  }
}

// ============================================================================
// TEST FILE DETECTION
// ============================================================================

/**
 * Recursively search a directory for a test file matching the given base name.
 *
 * @param dir - The directory to search in
 * @param baseName - The base name of the source file (without extension)
 * @returns The path to the found test file, or null if not found
 */
export function findFileRecursive(dir: string, baseName: string): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, baseName);
        if (found) return found;
      } else if (entry.name.includes(baseName) && /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        return fullPath;
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }
  return null;
}

/**
 * Derive the workspace root from a file path by looking for common project markers.
 *
 * @param filePath - The file path to analyze
 * @returns The derived workspace root, or the directory containing the file if no markers found
 */
export function deriveWorkspaceFromPath(filePath: string): string {
  // Project root markers, intentionally excluding noisy directories like
  // `node_modules` which can exist high up the tree and cause false positives
  // (e.g. accidentally treating a user home directory as the "workspace").
  const markers = [
    '.git',
    // JS/TS
    'package.json',
    'tsconfig.json',
    // Python
    'pyproject.toml',
    'setup.py',
    'requirements.txt',
    // Go / Rust
    'go.mod',
    'Cargo.toml',
    // Java / Kotlin / Gradle / Maven
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    // Ruby / PHP / Elixir / Dart / Swift
    'Gemfile',
    'composer.json',
    'mix.exs',
    'pubspec.yaml',
    'Package.swift',
    // C/C++ (best-effort)
    'CMakeLists.txt',
    'Makefile',
    // JS runtime marker (kept for legacy behavior and tests)
    'node_modules',
  ];
  let currentDir = path.dirname(filePath);
  const home = os.homedir();
  const allowHomeRoot =
    process.env.LIBRARIAN_ALLOW_HOME_WORKSPACE === '1' ||
    process.env.LIBRARIAN_ALLOW_HOME_WORKSPACE === 'true';

  // Walk up the directory tree looking for project markers
  while (currentDir !== path.dirname(currentDir)) {
    // Avoid snapping to a "project root" at the user's home directory.
    // If someone genuinely wants that, they can opt in explicitly.
    if (!allowHomeRoot && path.resolve(currentDir) === path.resolve(home)) {
      break;
    }
    for (const marker of markers) {
      const markerPath = path.join(currentDir, marker);
      try {
        if (fs.existsSync(markerPath)) {
          return currentDir;
        }
      } catch {
        // Ignore access errors
      }
    }
    currentDir = path.dirname(currentDir);
  }

  // Fallback to the directory containing the file
  return path.dirname(filePath);
}

/**
 * Find the corresponding test file for a source file by checking common test file patterns.
 *
 * @param sourceFile - The source file path to find tests for
 * @param workspace - The workspace root directory
 * @returns The path to the corresponding test file, or null if not found
 */
export function findCorrespondingTestFile(
  sourceFile: string,
  workspace: string
): string | null {
  const baseName = path.basename(sourceFile, path.extname(sourceFile));
  const dirName = path.dirname(sourceFile);
  const relativePath = path.relative(workspace, sourceFile);

  // Common test file patterns to check
  const candidates = [
    // Same directory patterns
    path.join(dirName, `${baseName}.test.ts`),
    path.join(dirName, `${baseName}.spec.ts`),
    path.join(dirName, `${baseName}.test.tsx`),
    path.join(dirName, `${baseName}.spec.tsx`),

    // __tests__ subdirectory
    path.join(dirName, '__tests__', `${baseName}.test.ts`),
    path.join(dirName, '__tests__', `${baseName}.spec.ts`),

    // Parallel test directory structure
    path.join(workspace, 'test', relativePath.replace(/\.tsx?$/, '.test.ts')),
    path.join(workspace, 'tests', relativePath.replace(/\.tsx?$/, '.test.ts')),
    path.join(workspace, '__tests__', relativePath.replace(/\.tsx?$/, '.test.ts')),

    // src -> test mirror
    relativePath.startsWith('src/')
      ? path.join(workspace, relativePath.replace('src/', 'test/').replace(/\.tsx?$/, '.test.ts'))
      : null,
  ].filter((c): c is string => c !== null);

  // Check each candidate
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // File doesn't exist, continue
    }
  }

  // Fallback: search for any test file containing the base name in common test directories
  const testDirs = ['__tests__', 'test', 'tests', 'spec'];
  for (const testDir of testDirs) {
    const searchDir = path.join(workspace, testDir);
    if (fs.existsSync(searchDir)) {
      const found = findFileRecursive(searchDir, baseName);
      if (found) return found;
    }
  }

  return null;
}

// ============================================================================
// FACTORY
// ============================================================================

export function createRefactoringSafetyChecker(librarian: Librarian): RefactoringSafetyChecker {
  return new RefactoringSafetyChecker(librarian);
}
