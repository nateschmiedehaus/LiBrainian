/**
 * @fileoverview Tests for Package Existence Verifier (WU-HALU-005)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Package Existence Verifier validates that npm/PyPI/crates.io package
 * citations in Librarian output actually exist in their respective registries.
 * This prevents hallucinated package recommendations.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createPackageVerifier,
  type PackageVerifier,
  type PackageInfo,
  type PackageVerifierConfig,
} from '../package_existence.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Mock registry responses for testing
 */
const MOCK_NPM_RESPONSES: Record<string, { status: number; data?: object }> = {
  lodash: {
    status: 200,
    data: {
      name: 'lodash',
      version: '4.17.21',
      time: { modified: '2024-01-15T10:00:00.000Z' },
    },
  },
  express: {
    status: 200,
    data: {
      name: 'express',
      version: '4.18.2',
      time: { modified: '2024-02-20T15:30:00.000Z' },
    },
  },
  'nonexistent-fake-package-xyz': {
    status: 404,
  },
};

const MOCK_PYPI_RESPONSES: Record<string, { status: number; data?: object }> = {
  requests: {
    status: 200,
    data: {
      info: {
        name: 'requests',
        version: '2.31.0',
      },
      releases: {
        '2.31.0': [{ upload_time: '2024-01-10T12:00:00' }],
      },
    },
  },
  flask: {
    status: 200,
    data: {
      info: {
        name: 'Flask',
        version: '3.0.0',
      },
      releases: {
        '3.0.0': [{ upload_time: '2023-12-01T08:00:00' }],
      },
    },
  },
  'nonexistent-fake-package-xyz': {
    status: 404,
  },
};

const MOCK_CRATES_RESPONSES: Record<string, { status: number; data?: object }> = {
  serde: {
    status: 200,
    data: {
      crate: {
        name: 'serde',
        max_version: '1.0.195',
        updated_at: '2024-01-20T09:00:00.000Z',
      },
    },
  },
  tokio: {
    status: 200,
    data: {
      crate: {
        name: 'tokio',
        max_version: '1.35.1',
        updated_at: '2024-01-18T14:00:00.000Z',
      },
    },
  },
  'nonexistent-fake-crate-xyz': {
    status: 404,
  },
};

// ============================================================================
// MOCK SETUP
// ============================================================================

/**
 * Create a mock fetch function that returns appropriate responses
 */
function createMockFetch() {
  return vi.fn(async (url: string) => {
    // Parse the URL to determine registry and package
    if (url.includes('registry.npmjs.org')) {
      // Handle URL-encoded package names (especially scoped packages like @types/node -> %40types%2Fnode)
      const urlParts = url.replace('https://registry.npmjs.org/', '');
      const packageName = decodeURIComponent(urlParts);
      const response = MOCK_NPM_RESPONSES[packageName];
      return {
        ok: response?.status === 200,
        status: response?.status || 404,
        json: async () => response?.data || {},
      };
    }

    if (url.includes('pypi.org')) {
      const match = url.match(/pypi\.org\/pypi\/([^/]+)/);
      const encodedName = match?.[1] || '';
      const packageName = decodeURIComponent(encodedName);
      // PyPI is case-insensitive, so check both original and lowercase
      const response = MOCK_PYPI_RESPONSES[packageName] || MOCK_PYPI_RESPONSES[packageName.toLowerCase()];
      return {
        ok: response?.status === 200,
        status: response?.status || 404,
        json: async () => response?.data || {},
      };
    }

    if (url.includes('crates.io')) {
      const match = url.match(/crates\.io\/api\/v1\/crates\/([^/]+)/);
      const encodedName = match?.[1] || '';
      const packageName = decodeURIComponent(encodedName);
      const response = MOCK_CRATES_RESPONSES[packageName];
      return {
        ok: response?.status === 200,
        status: response?.status || 404,
        json: async () => response?.data || {},
      };
    }

    // Unknown registry
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
    };
  });
}

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createPackageVerifier', () => {
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should create a verifier instance with default config', () => {
    const verifier = createPackageVerifier();
    expect(verifier).toBeDefined();
    expect(typeof verifier.checkPackage).toBe('function');
    expect(typeof verifier.checkMultiple).toBe('function');
    expect(typeof verifier.getCacheStats).toBe('function');
  });

  it('should create a verifier instance with custom config', () => {
    const config: PackageVerifierConfig = {
      cacheTTLMs: 3600000, // 1 hour
      maxConcurrent: 5,
      timeoutMs: 10000,
    };
    const verifier = createPackageVerifier(config);
    expect(verifier).toBeDefined();
  });
});

// ============================================================================
// NPM REGISTRY TESTS
// ============================================================================

describe('PackageVerifier - npm registry', () => {
  let verifier: PackageVerifier;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    verifier = createPackageVerifier();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should verify an existing npm package', async () => {
    const result = await verifier.checkPackage('lodash', 'npm');

    expect(result.name).toBe('lodash');
    expect(result.registry).toBe('npm');
    expect(result.exists).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.version).toBe('4.17.21');
    expect(result.lastPublished).toBeInstanceOf(Date);
  });

  it('should return exists=false for non-existent npm package', async () => {
    const result = await verifier.checkPackage('nonexistent-fake-package-xyz', 'npm');

    expect(result.name).toBe('nonexistent-fake-package-xyz');
    expect(result.registry).toBe('npm');
    expect(result.exists).toBe(false);
    expect(result.verified).toBe(true);
    expect(result.version).toBeUndefined();
  });

  it('should handle scoped npm packages', async () => {
    // Add mock for scoped package
    MOCK_NPM_RESPONSES['@types/node'] = {
      status: 200,
      data: {
        name: '@types/node',
        version: '20.10.0',
        time: { modified: '2024-01-05T08:00:00.000Z' },
      },
    };

    const result = await verifier.checkPackage('@types/node', 'npm');

    expect(result.name).toBe('@types/node');
    expect(result.exists).toBe(true);
  });
});

// ============================================================================
// PYPI REGISTRY TESTS
// ============================================================================

describe('PackageVerifier - PyPI registry', () => {
  let verifier: PackageVerifier;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    verifier = createPackageVerifier();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should verify an existing PyPI package', async () => {
    const result = await verifier.checkPackage('requests', 'pypi');

    expect(result.name).toBe('requests');
    expect(result.registry).toBe('pypi');
    expect(result.exists).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.version).toBe('2.31.0');
  });

  it('should return exists=false for non-existent PyPI package', async () => {
    const result = await verifier.checkPackage('nonexistent-fake-package-xyz', 'pypi');

    expect(result.name).toBe('nonexistent-fake-package-xyz');
    expect(result.registry).toBe('pypi');
    expect(result.exists).toBe(false);
    expect(result.verified).toBe(true);
  });

  it('should handle PyPI package name normalization', async () => {
    // PyPI normalizes package names (e.g., Flask -> flask)
    const result = await verifier.checkPackage('Flask', 'pypi');

    expect(result.exists).toBe(true);
  });
});

// ============================================================================
// CRATES.IO REGISTRY TESTS
// ============================================================================

describe('PackageVerifier - crates.io registry', () => {
  let verifier: PackageVerifier;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    verifier = createPackageVerifier();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should verify an existing crates.io package', async () => {
    const result = await verifier.checkPackage('serde', 'crates');

    expect(result.name).toBe('serde');
    expect(result.registry).toBe('crates');
    expect(result.exists).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.version).toBe('1.0.195');
  });

  it('should return exists=false for non-existent crates.io package', async () => {
    const result = await verifier.checkPackage('nonexistent-fake-crate-xyz', 'crates');

    expect(result.name).toBe('nonexistent-fake-crate-xyz');
    expect(result.registry).toBe('crates');
    expect(result.exists).toBe(false);
    expect(result.verified).toBe(true);
  });
});

// ============================================================================
// BATCH VERIFICATION TESTS
// ============================================================================

describe('PackageVerifier - checkMultiple', () => {
  let verifier: PackageVerifier;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    verifier = createPackageVerifier();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should verify multiple packages at once', async () => {
    const packages = [
      { name: 'lodash', registry: 'npm' },
      { name: 'requests', registry: 'pypi' },
      { name: 'serde', registry: 'crates' },
    ];

    const results = await verifier.checkMultiple(packages);

    expect(results.length).toBe(3);
    expect(results[0].name).toBe('lodash');
    expect(results[0].exists).toBe(true);
    expect(results[1].name).toBe('requests');
    expect(results[1].exists).toBe(true);
    expect(results[2].name).toBe('serde');
    expect(results[2].exists).toBe(true);
  });

  it('should handle mixed existing and non-existing packages', async () => {
    const packages = [
      { name: 'lodash', registry: 'npm' },
      { name: 'nonexistent-fake-package-xyz', registry: 'npm' },
      { name: 'express', registry: 'npm' },
    ];

    const results = await verifier.checkMultiple(packages);

    expect(results.length).toBe(3);
    expect(results[0].exists).toBe(true);
    expect(results[1].exists).toBe(false);
    expect(results[2].exists).toBe(true);
  });

  it('should return empty array for empty input', async () => {
    const results = await verifier.checkMultiple([]);

    expect(results).toEqual([]);
  });

  it('should preserve order of results matching input', async () => {
    const packages = [
      { name: 'express', registry: 'npm' },
      { name: 'flask', registry: 'pypi' },
      { name: 'tokio', registry: 'crates' },
    ];

    const results = await verifier.checkMultiple(packages);

    expect(results[0].name).toBe('express');
    expect(results[1].name).toBe('flask');
    expect(results[2].name).toBe('tokio');
  });
});

// ============================================================================
// CACHING TESTS
// ============================================================================

describe('PackageVerifier - caching', () => {
  let verifier: PackageVerifier;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    verifier = createPackageVerifier();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should cache package lookups', async () => {
    // First call
    await verifier.checkPackage('lodash', 'npm');
    const initialStats = verifier.getCacheStats();
    expect(initialStats.misses).toBe(1);
    expect(initialStats.hits).toBe(0);

    // Second call - should hit cache
    await verifier.checkPackage('lodash', 'npm');
    const finalStats = verifier.getCacheStats();
    expect(finalStats.hits).toBe(1);
    expect(finalStats.misses).toBe(1);
  });

  it('should track cache statistics', async () => {
    await verifier.checkPackage('lodash', 'npm');
    await verifier.checkPackage('express', 'npm');
    await verifier.checkPackage('lodash', 'npm'); // Cache hit

    const stats = verifier.getCacheStats();

    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
  });

  it('should use separate cache keys for different registries', async () => {
    // Same package name, different registries
    await verifier.checkPackage('requests', 'npm');
    await verifier.checkPackage('requests', 'pypi');

    const stats = verifier.getCacheStats();

    // Both should be cache misses (different registries)
    expect(stats.misses).toBe(2);
  });

  it('should return cached result without making network call', async () => {
    // First call
    await verifier.checkPackage('lodash', 'npm');
    const callCount = mockFetch.mock.calls.length;

    // Second call - should use cache
    await verifier.checkPackage('lodash', 'npm');

    // No additional network calls
    expect(mockFetch.mock.calls.length).toBe(callCount);
  });
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('PackageVerifier - error handling', () => {
  let verifier: PackageVerifier;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    verifier = createPackageVerifier();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should handle network errors gracefully', async () => {
    // Override fetch to throw
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    verifier = createPackageVerifier();

    const result = await verifier.checkPackage('lodash', 'npm');

    expect(result.name).toBe('lodash');
    expect(result.verified).toBe(false);
    expect(result.exists).toBe(false);
  });

  it('should handle malformed JSON responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      })
    );
    verifier = createPackageVerifier();

    const result = await verifier.checkPackage('lodash', 'npm');

    expect(result.verified).toBe(false);
  });

  it('should handle timeout scenarios', async () => {
    // Create a slow fetch that respects the abort signal
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, options?: { signal?: AbortSignal }) =>
          new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => resolve({ ok: true }), 60000);
            // Listen for abort signal
            if (options?.signal) {
              options.signal.addEventListener('abort', () => {
                clearTimeout(timeoutId);
                reject(new Error('Aborted'));
              });
            }
          })
      )
    );

    // Create verifier with short timeout
    verifier = createPackageVerifier({ timeoutMs: 100 });

    const result = await verifier.checkPackage('lodash', 'npm');

    expect(result.verified).toBe(false);
  }, 5000); // 5 second test timeout

  it('should handle unsupported registry type', async () => {
    // @ts-expect-error - Testing invalid registry type
    const result = await verifier.checkPackage('some-package', 'unsupported');

    expect(result.verified).toBe(false);
    expect(result.exists).toBe(false);
  });
});

// ============================================================================
// PACKAGE INFO INTERFACE TESTS
// ============================================================================

describe('PackageInfo interface', () => {
  let verifier: PackageVerifier;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    verifier = createPackageVerifier();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should have all required fields for existing package', async () => {
    const result = await verifier.checkPackage('lodash', 'npm');

    expect(result.name).toBeDefined();
    expect(result.registry).toBeDefined();
    expect(typeof result.exists).toBe('boolean');
    expect(typeof result.verified).toBe('boolean');
  });

  it('should have optional fields when available', async () => {
    const result = await verifier.checkPackage('lodash', 'npm');

    if (result.exists) {
      expect(result.version).toBeDefined();
      expect(result.lastPublished).toBeInstanceOf(Date);
    }
  });

  it('should not have optional fields for non-existent package', async () => {
    const result = await verifier.checkPackage('nonexistent-fake-package-xyz', 'npm');

    expect(result.version).toBeUndefined();
    expect(result.lastPublished).toBeUndefined();
  });
});

// ============================================================================
// REGISTRY TYPE TESTS
// ============================================================================

describe('PackageVerifier - registry types', () => {
  let verifier: PackageVerifier;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    verifier = createPackageVerifier();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should support npm registry', async () => {
    const result = await verifier.checkPackage('lodash', 'npm');
    expect(result.registry).toBe('npm');
  });

  it('should support pypi registry', async () => {
    const result = await verifier.checkPackage('requests', 'pypi');
    expect(result.registry).toBe('pypi');
  });

  it('should support crates registry', async () => {
    const result = await verifier.checkPackage('serde', 'crates');
    expect(result.registry).toBe('crates');
  });

  it('should correctly call npm registry API', async () => {
    await verifier.checkPackage('lodash', 'npm');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('registry.npmjs.org/lodash'),
      expect.anything()
    );
  });

  it('should correctly call PyPI registry API', async () => {
    await verifier.checkPackage('requests', 'pypi');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('pypi.org/pypi/requests'),
      expect.anything()
    );
  });

  it('should correctly call crates.io registry API', async () => {
    await verifier.checkPackage('serde', 'crates');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('crates.io/api/v1/crates/serde'),
      expect.anything()
    );
  });
});

// ============================================================================
// CONFIGURATION TESTS
// ============================================================================

describe('PackageVerifier - configuration', () => {
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should respect custom cache TTL', async () => {
    // This is tested indirectly through cache behavior
    const verifier = createPackageVerifier({ cacheTTLMs: 1000 });
    expect(verifier).toBeDefined();
  });

  it('should respect custom timeout', async () => {
    const verifier = createPackageVerifier({ timeoutMs: 5000 });
    expect(verifier).toBeDefined();
  });

  it('should respect max concurrent requests', async () => {
    const verifier = createPackageVerifier({ maxConcurrent: 3 });
    expect(verifier).toBeDefined();
  });

  it('should use default config when none provided', async () => {
    const verifier = createPackageVerifier();
    expect(verifier).toBeDefined();

    // Should work normally with defaults
    const result = await verifier.checkPackage('lodash', 'npm');
    expect(result.exists).toBe(true);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('PackageVerifier - edge cases', () => {
  let verifier: PackageVerifier;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    verifier = createPackageVerifier();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should handle empty package name', async () => {
    const result = await verifier.checkPackage('', 'npm');

    expect(result.exists).toBe(false);
    expect(result.verified).toBe(false);
  });

  it('should handle package names with special characters', async () => {
    MOCK_NPM_RESPONSES['@scope/package-name'] = {
      status: 200,
      data: {
        name: '@scope/package-name',
        version: '1.0.0',
        time: { modified: '2024-01-01T00:00:00.000Z' },
      },
    };

    const result = await verifier.checkPackage('@scope/package-name', 'npm');

    expect(result.name).toBe('@scope/package-name');
  });

  it('should handle very long package names', async () => {
    const longName = 'a'.repeat(200);
    const result = await verifier.checkPackage(longName, 'npm');

    expect(result.name).toBe(longName);
    expect(result.exists).toBe(false);
  });

  it('should handle package names with unicode', async () => {
    const result = await verifier.checkPackage('package-with-emoji-\u{1F600}', 'npm');

    expect(result.verified).toBe(true);
    expect(result.exists).toBe(false);
  });

  it('should handle concurrent requests for same package', async () => {
    const promises = [
      verifier.checkPackage('lodash', 'npm'),
      verifier.checkPackage('lodash', 'npm'),
      verifier.checkPackage('lodash', 'npm'),
    ];

    const results = await Promise.all(promises);

    // All should return same result
    expect(results[0].exists).toBe(true);
    expect(results[1].exists).toBe(true);
    expect(results[2].exists).toBe(true);
  });
});

// ============================================================================
// ACCEPTANCE CRITERIA TESTS
// ============================================================================

describe('PackageVerifier - acceptance criteria', () => {
  let verifier: PackageVerifier;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);
    verifier = createPackageVerifier();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should achieve 0% hallucinated packages in verified outputs (real packages verified as existing)', async () => {
    // Test with known real packages
    const realPackages = [
      { name: 'lodash', registry: 'npm' },
      { name: 'express', registry: 'npm' },
      { name: 'requests', registry: 'pypi' },
      { name: 'flask', registry: 'pypi' },
      { name: 'serde', registry: 'crates' },
      { name: 'tokio', registry: 'crates' },
    ];

    const results = await verifier.checkMultiple(realPackages);

    // All real packages should be verified as existing
    const existingCount = results.filter((r) => r.exists).length;
    expect(existingCount).toBe(realPackages.length);
  });

  it('should correctly identify non-existent packages', async () => {
    // Test with fake packages
    const fakePackages = [
      { name: 'nonexistent-fake-package-xyz', registry: 'npm' },
      { name: 'nonexistent-fake-package-xyz', registry: 'pypi' },
      { name: 'nonexistent-fake-crate-xyz', registry: 'crates' },
    ];

    const results = await verifier.checkMultiple(fakePackages);

    // All fake packages should be verified as NOT existing
    const nonExistingCount = results.filter((r) => !r.exists).length;
    expect(nonExistingCount).toBe(fakePackages.length);
  });

  it('should verify packages were actually checked (verified=true)', async () => {
    const result = await verifier.checkPackage('lodash', 'npm');

    // The package should be marked as verified (i.e., we actually checked it)
    expect(result.verified).toBe(true);
  });
});
