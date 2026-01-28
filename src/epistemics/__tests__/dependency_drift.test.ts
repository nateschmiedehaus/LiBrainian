/**
 * @fileoverview Tests for Dependency Drift Detection (WU-THIMPL-106)
 *
 * Tests cover:
 * - Detection of breaking API changes
 * - Detection of deprecated dependencies
 * - Detection of major version changes
 * - Detection of minor/patch version changes
 * - Creation of defeaters from detection results
 */

import { describe, it, expect } from 'vitest';
import {
  detectDependencyDrift,
  createDependencyDriftDefeater,
  type DependencyInfo,
} from '../defeaters.js';
import { createClaim, createClaimId } from '../types.js';
import { deterministic } from '../confidence.js';

describe('Dependency Drift Detection (WU-THIMPL-106)', () => {
  const createTestClaim = (id: string) =>
    createClaim({
      id,
      proposition: 'Test claim about dependencies',
      type: 'semantic',
      subject: {
        type: 'module',
        id: 'test-module',
        name: 'TestModule',
      },
      source: {
        type: 'static_analysis',
        id: 'dep-analyzer',
      },
      confidence: deterministic(true, 'test'),
    });

  describe('detectDependencyDrift', () => {
    it('should detect breaking API changes', () => {
      const claim = createTestClaim('dep-claim');
      const deps: DependencyInfo[] = [
        {
          name: 'react',
          version: '18.0.0',
          hasBreakingChanges: true,
          breakingChanges: ['useEffect cleanup timing changed', 'Strict mode double-render'],
        },
      ];

      const result = detectDependencyDrift(claim, deps);

      expect(result.driftDetected).toBe(true);
      expect(result.severity).toBe('full');
      expect(result.driftedDeps).toHaveLength(1);
      expect(result.driftedDeps[0].reason).toContain('Breaking API changes');
      expect(result.confidenceReduction).toBeGreaterThan(0.4);
    });

    it('should detect deprecated dependencies', () => {
      const claim = createTestClaim('dep-claim');
      const deps: DependencyInfo[] = [
        {
          name: 'moment',
          version: '2.29.4',
          deprecated: true,
          deprecationMessage: 'Use date-fns or luxon instead',
        },
      ];

      const result = detectDependencyDrift(claim, deps);

      expect(result.driftDetected).toBe(true);
      expect(result.severity).toBe('partial');
      // The reason includes the deprecation message from the dependency info
      expect(result.driftedDeps[0].reason).toContain('date-fns');
    });

    it('should detect major version changes', () => {
      const claim = createTestClaim('dep-claim');
      const deps: DependencyInfo[] = [
        {
          name: 'typescript',
          version: '5.0.0',
          claimTimeVersion: '4.9.5',
        },
      ];

      const result = detectDependencyDrift(claim, deps);

      expect(result.driftDetected).toBe(true);
      expect(result.severity).toBe('partial');
      expect(result.driftedDeps[0].reason).toContain('Major version change');
      expect(result.driftedDeps[0].reason).toContain('4.9.5 -> 5.0.0');
    });

    it('should detect minor/patch version changes with lower severity', () => {
      const claim = createTestClaim('dep-claim');
      const deps: DependencyInfo[] = [
        {
          name: 'lodash',
          version: '4.17.21',
          claimTimeVersion: '4.17.20',
        },
      ];

      const result = detectDependencyDrift(claim, deps);

      expect(result.driftDetected).toBe(true);
      expect(result.severity).toBe('warning');
      expect(result.driftedDeps[0].reason).toContain('Version change');
    });

    it('should not detect drift when versions match', () => {
      const claim = createTestClaim('dep-claim');
      const deps: DependencyInfo[] = [
        {
          name: 'express',
          version: '4.18.2',
          claimTimeVersion: '4.18.2',
        },
      ];

      const result = detectDependencyDrift(claim, deps);

      expect(result.driftDetected).toBe(false);
      expect(result.driftedDeps).toHaveLength(0);
    });

    it('should not detect drift when no claim time version', () => {
      const claim = createTestClaim('dep-claim');
      const deps: DependencyInfo[] = [
        {
          name: 'express',
          version: '4.18.2',
          // No claimTimeVersion - we don't know what it was
        },
      ];

      const result = detectDependencyDrift(claim, deps);

      expect(result.driftDetected).toBe(false);
    });

    it('should handle multiple drifted dependencies', () => {
      const claim = createTestClaim('dep-claim');
      const deps: DependencyInfo[] = [
        {
          name: 'react',
          version: '18.0.0',
          claimTimeVersion: '17.0.2',
        },
        {
          name: 'moment',
          version: '2.29.4',
          deprecated: true,
        },
        {
          name: 'lodash',
          version: '4.17.21',
          claimTimeVersion: '4.17.20',
        },
      ];

      const result = detectDependencyDrift(claim, deps);

      expect(result.driftDetected).toBe(true);
      expect(result.driftedDeps).toHaveLength(3);
      // Should use worst severity
      expect(result.severity).toBe('partial');
    });

    it('should cap confidence reduction at 1.0', () => {
      const claim = createTestClaim('dep-claim');
      const deps: DependencyInfo[] = Array.from({ length: 10 }, (_, i) => ({
        name: `dep-${i}`,
        version: '2.0.0',
        claimTimeVersion: '1.0.0',
      }));

      const result = detectDependencyDrift(claim, deps);

      expect(result.confidenceReduction).toBeLessThanOrEqual(1.0);
    });

    it('should handle version prefixes (^, ~, v)', () => {
      const claim = createTestClaim('dep-claim');
      const deps: DependencyInfo[] = [
        {
          name: 'package-a',
          version: '^2.0.0',
          claimTimeVersion: '^1.0.0',
        },
        {
          name: 'package-b',
          version: 'v2.0.0',
          claimTimeVersion: 'v1.0.0',
        },
      ];

      const result = detectDependencyDrift(claim, deps);

      expect(result.driftDetected).toBe(true);
      expect(result.driftedDeps).toHaveLength(2);
    });

    it('should truncate long breaking changes list', () => {
      const claim = createTestClaim('dep-claim');
      const deps: DependencyInfo[] = [
        {
          name: 'big-breaking',
          version: '2.0.0',
          hasBreakingChanges: true,
          breakingChanges: ['change1', 'change2', 'change3', 'change4', 'change5'],
        },
      ];

      const result = detectDependencyDrift(claim, deps);

      expect(result.driftedDeps[0].reason).toContain('...');
    });
  });

  describe('createDependencyDriftDefeater', () => {
    it('should create defeater for detected drift', () => {
      const result = {
        driftDetected: true,
        driftedDeps: [
          { name: 'react', reason: 'Major version change: 17.0.2 -> 18.0.0', severity: 'partial' as const },
        ],
        severity: 'partial' as const,
        confidenceReduction: 0.25,
      };

      const defeater = createDependencyDriftDefeater(result, createClaimId('claim-1'));

      expect(defeater).not.toBeNull();
      expect(defeater!.type).toBe('dependency_drift');
      expect(defeater!.severity).toBe('partial');
      expect(defeater!.affectedClaimIds).toContain('claim-1');
      expect(defeater!.description).toContain('react');
    });

    it('should not create defeater when no drift', () => {
      const result = {
        driftDetected: false,
        driftedDeps: [],
        severity: 'informational' as const,
        confidenceReduction: 0,
      };

      const defeater = createDependencyDriftDefeater(result, createClaimId('claim-1'));

      expect(defeater).toBeNull();
    });

    it('should include all drifted deps in description', () => {
      const result = {
        driftDetected: true,
        driftedDeps: [
          { name: 'react', reason: 'Major version change', severity: 'partial' as const },
          { name: 'moment', reason: 'Deprecated', severity: 'partial' as const },
        ],
        severity: 'partial' as const,
        confidenceReduction: 0.5,
      };

      const defeater = createDependencyDriftDefeater(result, createClaimId('claim-1'));

      expect(defeater!.description).toContain('react');
      expect(defeater!.description).toContain('moment');
    });

    it('should mark full severity as not auto-resolvable', () => {
      const result = {
        driftDetected: true,
        driftedDeps: [
          { name: 'breaking-dep', reason: 'Breaking changes', severity: 'full' as const },
        ],
        severity: 'full' as const,
        confidenceReduction: 0.5,
      };

      const defeater = createDependencyDriftDefeater(result, createClaimId('claim-1'));

      expect(defeater!.autoResolvable).toBe(false);
    });

    it('should store drift details in evidence', () => {
      const result = {
        driftDetected: true,
        driftedDeps: [
          { name: 'react', reason: 'Version change', severity: 'warning' as const },
        ],
        severity: 'warning' as const,
        confidenceReduction: 0.1,
      };

      const defeater = createDependencyDriftDefeater(result, createClaimId('claim-1'));

      expect(defeater!.evidence).toBeDefined();
      const evidence = JSON.parse(defeater!.evidence!);
      expect(evidence.driftedDeps).toHaveLength(1);
    });
  });
});
