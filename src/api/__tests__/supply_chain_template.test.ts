/**
 * @fileoverview Tests for T7 SupplyChain Template
 *
 * WU-TMPL-007: T7 SupplyChain Template
 *
 * Tests cover:
 * - Package.json parsing
 * - Lock file parsing (package-lock.json, yarn.lock, pnpm-lock.yaml)
 * - SBOM generation in CycloneDX format
 * - Vulnerability detection and assessment
 * - Outdated dependency detection
 * - License analysis
 * - Risk assessment
 * - Auto-detection of package managers
 * - Error handling
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import {
  type SupplyChainInput,
  type SupplyChainOutput,
  type Dependency,
  type Vulnerability,
  type OutdatedInfo,
  parsePackageJson,
  parsePackageLock,
  parseYarnLock,
  parsePnpmLock,
  detectPackageManager,
  analyzeDependencies,
  generateSBOM,
  checkVulnerabilities,
  checkOutdated,
  computeSupplyChainRisk,
  createSupplyChainTemplate,
  type SupplyChainTemplate,
} from '../supply_chain_template.js';

// Mock fs for file reading
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

// Mock child_process for npm audit
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>;

describe('T7 SupplyChain Template', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // PACKAGE.JSON PARSING TESTS
  // ============================================================================

  describe('parsePackageJson', () => {
    it('parses a simple package.json with dependencies', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          lodash: '^4.17.21',
          express: '~4.18.0',
        },
        devDependencies: {
          typescript: '^5.0.0',
        },
      };

      mockReadFileSync.mockReturnValue(JSON.stringify(packageJson));

      const result = parsePackageJson('/test/repo/package.json');

      expect(result.name).toBe('test-project');
      expect(result.version).toBe('1.0.0');
      expect(result.dependencies).toHaveLength(2);
      expect(result.devDependencies).toHaveLength(1);
    });

    it('handles package.json without dependencies', () => {
      const packageJson = {
        name: 'minimal-project',
        version: '0.0.1',
      };

      mockReadFileSync.mockReturnValue(JSON.stringify(packageJson));

      const result = parsePackageJson('/test/repo/package.json');

      expect(result.dependencies).toHaveLength(0);
      expect(result.devDependencies).toHaveLength(0);
    });

    it('throws on invalid JSON', () => {
      mockReadFileSync.mockReturnValue('{ invalid json }');

      expect(() => parsePackageJson('/test/repo/package.json')).toThrow();
    });

    it('includes license information from dependencies', () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        license: 'MIT',
        dependencies: {
          lodash: '^4.17.21',
        },
      };

      mockReadFileSync.mockReturnValue(JSON.stringify(packageJson));

      const result = parsePackageJson('/test/repo/package.json');

      expect(result.license).toBe('MIT');
    });
  });

  // ============================================================================
  // LOCK FILE PARSING TESTS
  // ============================================================================

  describe('parsePackageLock', () => {
    it('parses package-lock.json v3 format', () => {
      const lockFile = {
        lockfileVersion: 3,
        packages: {
          '': {
            name: 'test-project',
            version: '1.0.0',
            dependencies: {
              lodash: '^4.17.21',
            },
          },
          'node_modules/lodash': {
            version: '4.17.21',
            resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
            integrity: 'sha512-...',
          },
        },
      };

      mockReadFileSync.mockReturnValue(JSON.stringify(lockFile));

      const result = parsePackageLock('/test/repo/package-lock.json');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('lodash');
      expect(result[0].version).toBe('4.17.21');
    });

    it('handles transitive dependencies', () => {
      const lockFile = {
        lockfileVersion: 3,
        packages: {
          '': { name: 'test', dependencies: { express: '^4.18.0' } },
          'node_modules/express': { version: '4.18.2' },
          'node_modules/express/node_modules/body-parser': { version: '1.20.1' },
        },
      };

      mockReadFileSync.mockReturnValue(JSON.stringify(lockFile));

      const result = parsePackageLock('/test/repo/package-lock.json');

      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('parseYarnLock', () => {
    it('parses yarn.lock format', () => {
      const yarnLock = `# yarn lockfile v1

lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
  integrity sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==
`;

      mockReadFileSync.mockReturnValue(yarnLock);

      const result = parseYarnLock('/test/repo/yarn.lock');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('lodash');
      expect(result[0].version).toBe('4.17.21');
    });
  });

  describe('parsePnpmLock', () => {
    it('parses pnpm-lock.yaml format', () => {
      const pnpmLock = `lockfileVersion: 5.4

packages:

  /lodash/4.17.21:
    resolution: {integrity: sha512-...}
    dev: false
`;

      mockReadFileSync.mockReturnValue(pnpmLock);

      const result = parsePnpmLock('/test/repo/pnpm-lock.yaml');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('lodash');
      expect(result[0].version).toBe('4.17.21');
    });
  });

  // ============================================================================
  // PACKAGE MANAGER DETECTION
  // ============================================================================

  describe('detectPackageManager', () => {
    it('detects npm from package-lock.json', () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path.includes('package-lock.json');
      });

      const result = detectPackageManager('/test/repo');

      expect(result).toBe('npm');
    });

    it('detects yarn from yarn.lock', () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path.includes('yarn.lock');
      });

      const result = detectPackageManager('/test/repo');

      expect(result).toBe('yarn');
    });

    it('detects pnpm from pnpm-lock.yaml', () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path.includes('pnpm-lock.yaml');
      });

      const result = detectPackageManager('/test/repo');

      expect(result).toBe('pnpm');
    });

    it('returns npm as default when no lock file found', () => {
      mockExistsSync.mockReturnValue(false);

      const result = detectPackageManager('/test/repo');

      expect(result).toBe('npm');
    });
  });

  // ============================================================================
  // SBOM GENERATION
  // ============================================================================

  describe('generateSBOM', () => {
    it('generates CycloneDX format SBOM', () => {
      const dependencies: Dependency[] = [
        {
          name: 'lodash',
          version: '4.17.21',
          license: 'MIT',
          isDevDependency: false,
          isDirect: true,
          vulnerabilities: [],
        },
      ];

      const sbom = generateSBOM(dependencies, 'CycloneDX');

      expect(sbom.format).toBe('CycloneDX');
      expect(sbom.version).toBeDefined();
      expect(sbom.dependencies).toHaveLength(1);
    });

    it('includes vulnerability data in SBOM components', () => {
      const dependencies: Dependency[] = [
        {
          name: 'vulnerable-pkg',
          version: '1.0.0',
          license: 'MIT',
          isDevDependency: false,
          isDirect: true,
          vulnerabilities: [
            {
              severity: 'high',
              title: 'RCE vulnerability',
              cve: 'CVE-2023-1234',
            },
          ],
        },
      ];

      const sbom = generateSBOM(dependencies, 'CycloneDX');

      expect(sbom.dependencies[0].vulnerabilities).toHaveLength(1);
      expect(sbom.dependencies[0].vulnerabilities[0].severity).toBe('high');
    });
  });

  // ============================================================================
  // VULNERABILITY CHECKING
  // ============================================================================

  describe('checkVulnerabilities', () => {
    it('parses npm audit output', () => {
      const auditOutput = {
        vulnerabilities: {
          lodash: {
            name: 'lodash',
            severity: 'high',
            via: [
              {
                title: 'Prototype Pollution',
                cve: 'CVE-2021-23337',
                range: '<4.17.21',
              },
            ],
            fixAvailable: {
              name: 'lodash',
              version: '4.17.21',
            },
          },
        },
      };

      mockExecSync.mockReturnValue(Buffer.from(JSON.stringify(auditOutput)));

      const result = checkVulnerabilities('/test/repo', 'npm');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('lodash');
      expect(result[0].severity).toBe('high');
    });

    it('handles no vulnerabilities gracefully', () => {
      mockExecSync.mockReturnValue(Buffer.from(JSON.stringify({ vulnerabilities: {} })));

      const result = checkVulnerabilities('/test/repo', 'npm');

      expect(result).toHaveLength(0);
    });

    it('handles audit command failure gracefully', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('npm audit failed');
      });

      const result = checkVulnerabilities('/test/repo', 'npm');

      expect(result).toHaveLength(0);
    });
  });

  // ============================================================================
  // OUTDATED CHECKING
  // ============================================================================

  describe('checkOutdated', () => {
    it('detects outdated packages', () => {
      const outdatedOutput = {
        lodash: {
          current: '4.17.20',
          wanted: '4.17.21',
          latest: '4.17.21',
          location: 'node_modules/lodash',
        },
      };

      mockExecSync.mockReturnValue(Buffer.from(JSON.stringify(outdatedOutput)));

      const result = checkOutdated('/test/repo', 'npm');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('lodash');
      expect(result[0].currentVersion).toBe('4.17.20');
      expect(result[0].latestVersion).toBe('4.17.21');
      expect(result[0].isOutdated).toBe(true);
    });

    it('handles no outdated packages', () => {
      mockExecSync.mockReturnValue(Buffer.from('{}'));

      const result = checkOutdated('/test/repo', 'npm');

      expect(result).toHaveLength(0);
    });
  });

  // ============================================================================
  // RISK ASSESSMENT
  // ============================================================================

  describe('computeSupplyChainRisk', () => {
    it('returns low risk for clean dependencies', () => {
      const dependencies: Dependency[] = [
        {
          name: 'lodash',
          version: '4.17.21',
          license: 'MIT',
          isDevDependency: false,
          isDirect: true,
          vulnerabilities: [],
        },
      ];

      const risk = computeSupplyChainRisk(dependencies);

      expect(risk).toBe('low');
    });

    it('returns critical risk for critical vulnerabilities', () => {
      const dependencies: Dependency[] = [
        {
          name: 'vulnerable-pkg',
          version: '1.0.0',
          license: 'MIT',
          isDevDependency: false,
          isDirect: true,
          vulnerabilities: [
            {
              severity: 'critical',
              title: 'Critical RCE',
            },
          ],
        },
      ];

      const risk = computeSupplyChainRisk(dependencies);

      expect(risk).toBe('critical');
    });

    it('returns high risk for multiple high severity vulnerabilities', () => {
      const dependencies: Dependency[] = [
        {
          name: 'pkg-a',
          version: '1.0.0',
          license: 'MIT',
          isDevDependency: false,
          isDirect: true,
          vulnerabilities: [{ severity: 'high', title: 'Vuln A' }],
        },
        {
          name: 'pkg-b',
          version: '1.0.0',
          license: 'MIT',
          isDevDependency: false,
          isDirect: true,
          vulnerabilities: [{ severity: 'high', title: 'Vuln B' }],
        },
      ];

      const risk = computeSupplyChainRisk(dependencies);

      expect(['high', 'critical']).toContain(risk);
    });

    it('considers license risk', () => {
      const dependencies: Dependency[] = [
        {
          name: 'gpl-pkg',
          version: '1.0.0',
          license: 'GPL-3.0',
          isDevDependency: false,
          isDirect: true,
          vulnerabilities: [],
        },
      ];

      const risk = computeSupplyChainRisk(dependencies);

      // GPL license in non-dev dependency should raise risk level
      expect(['medium', 'high']).toContain(risk);
    });
  });

  // ============================================================================
  // DEPENDENCY ANALYSIS
  // ============================================================================

  describe('analyzeDependencies', () => {
    it('enriches dependencies with vulnerability info', () => {
      const baseDeps: Dependency[] = [
        {
          name: 'lodash',
          version: '4.17.20',
          license: 'MIT',
          isDevDependency: false,
          isDirect: true,
          vulnerabilities: [],
        },
      ];

      const vulns: Array<{ name: string; severity: string; title: string }> = [
        { name: 'lodash', severity: 'high', title: 'Prototype Pollution' },
      ];

      const result = analyzeDependencies(baseDeps, vulns, []);

      expect(result[0].vulnerabilities).toHaveLength(1);
    });

    it('enriches dependencies with outdated info', () => {
      const baseDeps: Dependency[] = [
        {
          name: 'lodash',
          version: '4.17.20',
          license: 'MIT',
          isDevDependency: false,
          isDirect: true,
          vulnerabilities: [],
        },
      ];

      const outdated = [
        {
          name: 'lodash',
          currentVersion: '4.17.20',
          latestVersion: '4.17.21',
          wantedVersion: '4.17.21',
          isOutdated: true,
        },
      ];

      const result = analyzeDependencies(baseDeps, [], outdated);

      expect(result[0].outdatedInfo).toBeDefined();
      expect(result[0].outdatedInfo?.isOutdated).toBe(true);
    });
  });

  // ============================================================================
  // TEMPLATE INTEGRATION
  // ============================================================================

  describe('createSupplyChainTemplate', () => {
    it('creates a template with correct T7 identifier', () => {
      const template = createSupplyChainTemplate();

      expect(template.id).toBe('T7');
      expect(template.name).toBe('SupplyChain');
    });

    it('declares correct required maps', () => {
      const template = createSupplyChainTemplate();

      expect(template.requiredMaps).toContain('DepMap');
      expect(template.requiredMaps).toContain('SupplyChainMap');
      expect(template.requiredMaps).toContain('LicenseMap');
    });

    it('declares correct supported UCs', () => {
      const template = createSupplyChainTemplate();

      expect(template.supportedUcs).toContain('UC-101');
      expect(template.supportedUcs).toContain('UC-102');
      expect(template.supportedUcs).toContain('UC-103');
    });
  });

  describe('SupplyChainTemplate execute', () => {
    beforeEach(() => {
      // Setup default mocks for a successful execution
      mockExistsSync.mockImplementation((path: string) => {
        return path.includes('package.json') || path.includes('package-lock.json');
      });

      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        license: 'MIT',
        dependencies: { lodash: '^4.17.21' },
      };

      const lockFile = {
        lockfileVersion: 3,
        packages: {
          '': { name: 'test', dependencies: { lodash: '^4.17.21' } },
          'node_modules/lodash': {
            version: '4.17.21',
            license: 'MIT',
          },
        },
      };

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('package.json')) {
          return JSON.stringify(packageJson);
        }
        if (path.includes('package-lock.json')) {
          return JSON.stringify(lockFile);
        }
        throw new Error('File not found');
      });

      mockExecSync.mockReturnValue(Buffer.from(JSON.stringify({ vulnerabilities: {} })));
    });

    it('produces SupplyChainOutput with required fields', async () => {
      const template = createSupplyChainTemplate();
      const result = await template.execute({
        intent: 'Analyze supply chain',
        workspace: '/test/repo',
        depth: 'medium',
      });

      expect(result.success).toBe(true);
      expect(result.packs.length).toBeGreaterThan(0);
    });

    it('includes confidence value in output', async () => {
      const template = createSupplyChainTemplate();
      const result = await template.execute({
        intent: 'Analyze dependencies',
        workspace: '/test/repo',
      });

      expect(result.packs[0].confidence).toBeGreaterThan(0);
    });

    it('emits evidence for template selection', async () => {
      const template = createSupplyChainTemplate();
      const result = await template.execute({
        intent: 'SBOM generation',
        workspace: '/test/repo',
      });

      expect(result.evidence).toBeDefined();
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].templateId).toBe('T7');
    });

    it('includes disclosures for limitations', async () => {
      const template = createSupplyChainTemplate();
      const result = await template.execute({
        intent: 'Check vulnerabilities',
        workspace: '/test/repo',
      });

      expect(result.disclosures).toBeDefined();
    });

    it('generates summary with correct counts', async () => {
      const template = createSupplyChainTemplate();
      const result = await template.execute({
        intent: 'Dependency summary',
        workspace: '/test/repo',
      });

      const pack = result.packs[0];
      expect(pack.keyFacts).toBeDefined();
      expect(pack.keyFacts.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // LICENSE ANALYSIS
  // ============================================================================

  describe('license analysis', () => {
    it('categorizes licenses by type', async () => {
      mockExistsSync.mockReturnValue(true);

      const packageJson = {
        name: 'test',
        version: '1.0.0',
        dependencies: {
          'pkg-mit': '^1.0.0',
          'pkg-apache': '^1.0.0',
          'pkg-gpl': '^1.0.0',
        },
      };

      const lockFile = {
        lockfileVersion: 3,
        packages: {
          '': { name: 'test' },
          'node_modules/pkg-mit': { version: '1.0.0', license: 'MIT' },
          'node_modules/pkg-apache': { version: '1.0.0', license: 'Apache-2.0' },
          'node_modules/pkg-gpl': { version: '1.0.0', license: 'GPL-3.0' },
        },
      };

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('package.json')) return JSON.stringify(packageJson);
        if (path.includes('package-lock.json')) return JSON.stringify(lockFile);
        throw new Error('Not found');
      });

      mockExecSync.mockReturnValue(Buffer.from('{}'));

      const template = createSupplyChainTemplate();
      const result = await template.execute({
        intent: 'License audit',
        workspace: '/test/repo',
      });

      expect(result.success).toBe(true);
      // Check that license types are tracked
      const pack = result.packs[0];
      expect(pack.keyFacts.some((f) => f.includes('license'))).toBe(true);
    });
  });

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('error handling', () => {
    it('handles missing package.json gracefully', async () => {
      mockExistsSync.mockReturnValue(false);

      const template = createSupplyChainTemplate();
      const result = await template.execute({
        intent: 'Analyze',
        workspace: '/empty/repo',
      });

      expect(result.success).toBe(false);
      expect(result.disclosures.some((d) => d.includes('no_package_json'))).toBe(true);
    });

    it('handles invalid package.json gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => '{ invalid }');

      const template = createSupplyChainTemplate();
      const result = await template.execute({
        intent: 'Analyze',
        workspace: '/bad/repo',
      });

      expect(result.success).toBe(false);
    });
  });

  // ============================================================================
  // RECOMMENDATIONS
  // ============================================================================

  describe('recommendations generation', () => {
    it('recommends updating vulnerable packages', async () => {
      mockExistsSync.mockReturnValue(true);

      const packageJson = {
        name: 'test',
        version: '1.0.0',
        dependencies: { 'vulnerable-pkg': '^1.0.0' },
      };

      const lockFile = {
        lockfileVersion: 3,
        packages: {
          '': { name: 'test' },
          'node_modules/vulnerable-pkg': { version: '1.0.0' },
        },
      };

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('package.json')) return JSON.stringify(packageJson);
        if (path.includes('package-lock.json')) return JSON.stringify(lockFile);
        throw new Error('Not found');
      });

      const auditOutput = {
        vulnerabilities: {
          'vulnerable-pkg': {
            name: 'vulnerable-pkg',
            severity: 'high',
            via: [{ title: 'RCE', cve: 'CVE-2023-0001' }],
            fixAvailable: { name: 'vulnerable-pkg', version: '2.0.0' },
          },
        },
      };

      mockExecSync.mockReturnValue(Buffer.from(JSON.stringify(auditOutput)));

      const template = createSupplyChainTemplate();
      const result = await template.execute({
        intent: 'Security audit',
        workspace: '/test/repo',
      });

      expect(result.packs[0].keyFacts.some((f) => f.toLowerCase().includes('vulnerab'))).toBe(true);
    });
  });

  // ============================================================================
  // OUTPUT STRUCTURE
  // ============================================================================

  describe('SupplyChainOutput structure', () => {
    it('includes all required fields in pack', async () => {
      mockExistsSync.mockReturnValue(true);

      const packageJson = {
        name: 'test',
        version: '1.0.0',
        dependencies: { lodash: '^4.17.21' },
      };

      const lockFile = {
        lockfileVersion: 3,
        packages: {
          '': { name: 'test' },
          'node_modules/lodash': { version: '4.17.21', license: 'MIT' },
        },
      };

      mockReadFileSync.mockImplementation((path: string) => {
        if (path.includes('package.json')) return JSON.stringify(packageJson);
        if (path.includes('package-lock.json')) return JSON.stringify(lockFile);
        throw new Error('Not found');
      });

      mockExecSync.mockReturnValue(Buffer.from('{}'));

      const template = createSupplyChainTemplate();
      const result = await template.execute({
        intent: 'Full analysis',
        workspace: '/test/repo',
      });

      const pack = result.packs[0];
      expect(pack.packId).toBeDefined();
      expect(pack.packType).toBeDefined();
      expect(pack.summary).toBeDefined();
      expect(pack.keyFacts).toBeDefined();
      expect(pack.confidence).toBeDefined();
    });
  });
});
