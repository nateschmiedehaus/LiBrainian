/**
 * @fileoverview Package Existence Verifier (WU-HALU-005)
 *
 * Verifies that npm/PyPI/crates.io package citations in Librarian output
 * actually exist in their respective registries. This prevents hallucinated
 * package recommendations.
 *
 * Supported registries:
 * - npm (registry.npmjs.org)
 * - PyPI (pypi.org)
 * - crates.io (crates.io)
 *
 * Features:
 * - 24-hour cache TTL to reduce API calls
 * - Concurrent request limiting
 * - Graceful error handling
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Supported package registries
 */
export type RegistryType = 'npm' | 'pypi' | 'crates' | 'maven' | 'nuget';

/**
 * Information about a verified package
 */
export interface PackageInfo {
  /** Package name as queried */
  name: string;
  /** Registry where the package was looked up */
  registry: RegistryType;
  /** Whether the package exists in the registry */
  exists: boolean;
  /** Latest version if package exists */
  version?: string;
  /** When the package was last published/updated */
  lastPublished?: Date;
  /** Whether the verification was successfully completed (false if network error, etc.) */
  verified: boolean;
}

/**
 * Configuration for the package verifier
 */
export interface PackageVerifierConfig {
  /** Cache TTL in milliseconds (default: 24 hours) */
  cacheTTLMs?: number;
  /** Maximum concurrent requests (default: 10) */
  maxConcurrent?: number;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
}

/**
 * Interface for the package verifier
 */
export interface PackageVerifier {
  /**
   * Check if a single package exists in a registry
   * @param name Package name
   * @param registry Registry to check
   * @returns Package information
   */
  checkPackage(name: string, registry: string): Promise<PackageInfo>;

  /**
   * Check multiple packages at once
   * @param packages Array of package name/registry pairs
   * @returns Array of package information in same order as input
   */
  checkMultiple(packages: Array<{ name: string; registry: string }>): Promise<PackageInfo[]>;

  /**
   * Get cache statistics
   * @returns Cache hit/miss stats
   */
  getCacheStats(): CacheStats;
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface CacheEntry {
  info: PackageInfo;
  timestamp: number;
}

/** npm registry API response structure */
interface NpmApiResponse {
  name?: string;
  version?: string;
  'dist-tags'?: {
    latest?: string;
  };
  time?: {
    modified?: string;
  };
}

/** PyPI registry API response structure */
interface PyPIApiResponse {
  info?: {
    name?: string;
    version?: string;
  };
  releases?: Record<string, Array<{ upload_time?: string }>>;
}

/** crates.io registry API response structure */
interface CratesApiResponse {
  crate?: {
    name?: string;
    max_version?: string;
    newest_version?: string;
    updated_at?: string;
  };
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: Required<PackageVerifierConfig> = {
  cacheTTLMs: 24 * 60 * 60 * 1000, // 24 hours
  maxConcurrent: 10,
  timeoutMs: 30000, // 30 seconds
};

// ============================================================================
// REGISTRY API URLS
// ============================================================================

const REGISTRY_URLS: Record<string, (name: string) => string> = {
  npm: (name: string) => `https://registry.npmjs.org/${encodeURIComponent(name)}`,
  pypi: (name: string) => `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
  crates: (name: string) => `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
};

// ============================================================================
// PACKAGE VERIFIER IMPLEMENTATION
// ============================================================================

/**
 * Implementation of the package verifier
 */
class PackageVerifierImpl implements PackageVerifier {
  private config: Required<PackageVerifierConfig>;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheStats: CacheStats = { hits: 0, misses: 0 };
  private pendingRequests: Map<string, Promise<PackageInfo>> = new Map();

  constructor(config?: PackageVerifierConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate a cache key for a package lookup
   */
  private getCacheKey(name: string, registry: string): string {
    return `${registry}:${name}`;
  }

  /**
   * Check if a cache entry is still valid
   */
  private isCacheValid(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp < this.config.cacheTTLMs;
  }

  /**
   * Get cached result if available and valid
   */
  private getFromCache(name: string, registry: string): PackageInfo | undefined {
    const key = this.getCacheKey(name, registry);
    const entry = this.cache.get(key);

    if (entry && this.isCacheValid(entry)) {
      this.cacheStats.hits++;
      return entry.info;
    }

    return undefined;
  }

  /**
   * Store a result in cache
   */
  private setInCache(name: string, registry: string, info: PackageInfo): void {
    const key = this.getCacheKey(name, registry);
    this.cache.set(key, {
      info,
      timestamp: Date.now(),
    });
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'librarian-package-verifier/1.0',
        },
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check npm registry for a package
   */
  private async checkNpm(name: string): Promise<PackageInfo> {
    const url = REGISTRY_URLS.npm(name);

    try {
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        return {
          name,
          registry: 'npm',
          exists: false,
          verified: true,
        };
      }

      const data = await response.json() as NpmApiResponse;

      return {
        name,
        registry: 'npm',
        exists: true,
        version: data.version || data['dist-tags']?.latest,
        lastPublished: data.time?.modified ? new Date(data.time.modified) : undefined,
        verified: true,
      };
    } catch {
      return {
        name,
        registry: 'npm',
        exists: false,
        verified: false,
      };
    }
  }

  /**
   * Check PyPI registry for a package
   */
  private async checkPypi(name: string): Promise<PackageInfo> {
    const url = REGISTRY_URLS.pypi(name);

    try {
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        return {
          name,
          registry: 'pypi',
          exists: false,
          verified: true,
        };
      }

      const data = await response.json() as PyPIApiResponse;

      // Get the last published date from the latest release
      let lastPublished: Date | undefined;
      const latestVersion = data.info?.version;
      if (latestVersion && data.releases?.[latestVersion]?.[0]?.upload_time) {
        lastPublished = new Date(data.releases[latestVersion][0].upload_time);
      }

      return {
        name,
        registry: 'pypi',
        exists: true,
        version: data.info?.version,
        lastPublished,
        verified: true,
      };
    } catch {
      return {
        name,
        registry: 'pypi',
        exists: false,
        verified: false,
      };
    }
  }

  /**
   * Check crates.io registry for a package
   */
  private async checkCrates(name: string): Promise<PackageInfo> {
    const url = REGISTRY_URLS.crates(name);

    try {
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        return {
          name,
          registry: 'crates',
          exists: false,
          verified: true,
        };
      }

      const data = await response.json() as CratesApiResponse;

      return {
        name,
        registry: 'crates',
        exists: true,
        version: data.crate?.max_version || data.crate?.newest_version,
        lastPublished: data.crate?.updated_at ? new Date(data.crate.updated_at) : undefined,
        verified: true,
      };
    } catch {
      return {
        name,
        registry: 'crates',
        exists: false,
        verified: false,
      };
    }
  }

  /**
   * Check a package in the specified registry
   */
  async checkPackage(name: string, registry: string): Promise<PackageInfo> {
    // Validate input
    if (!name || name.trim() === '') {
      return {
        name: name || '',
        registry: registry as RegistryType,
        exists: false,
        verified: false,
      };
    }

    // Normalize registry name
    const normalizedRegistry = registry.toLowerCase();

    // Check cache first
    const cached = this.getFromCache(name, normalizedRegistry);
    if (cached) {
      return cached;
    }

    // Check for pending request (deduplication)
    const cacheKey = this.getCacheKey(name, normalizedRegistry);
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      return pending;
    }

    // Create the lookup promise
    let lookupPromise: Promise<PackageInfo>;

    switch (normalizedRegistry) {
      case 'npm':
        lookupPromise = this.checkNpm(name);
        break;
      case 'pypi':
        lookupPromise = this.checkPypi(name);
        break;
      case 'crates':
        lookupPromise = this.checkCrates(name);
        break;
      default:
        // Unsupported registry
        return {
          name,
          registry: normalizedRegistry as RegistryType,
          exists: false,
          verified: false,
        };
    }

    // Track pending request
    this.pendingRequests.set(cacheKey, lookupPromise);
    this.cacheStats.misses++;

    try {
      const result = await lookupPromise;

      // Cache the result
      this.setInCache(name, normalizedRegistry, result);

      return result;
    } finally {
      // Clear pending request
      this.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * Check multiple packages with concurrency limiting
   */
  async checkMultiple(packages: Array<{ name: string; registry: string }>): Promise<PackageInfo[]> {
    if (packages.length === 0) {
      return [];
    }

    // Process in batches to respect maxConcurrent
    const results: PackageInfo[] = [];
    const batchSize = this.config.maxConcurrent;

    for (let i = 0; i < packages.length; i += batchSize) {
      const batch = packages.slice(i, i + batchSize);
      const batchPromises = batch.map((pkg) => this.checkPackage(pkg.name, pkg.registry));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return { ...this.cacheStats };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new PackageVerifier instance
 *
 * @param config Optional configuration
 * @returns PackageVerifier instance
 *
 * @example
 * ```typescript
 * const verifier = createPackageVerifier();
 *
 * // Check a single package
 * const result = await verifier.checkPackage('lodash', 'npm');
 * console.log(result.exists); // true
 *
 * // Check multiple packages
 * const results = await verifier.checkMultiple([
 *   { name: 'lodash', registry: 'npm' },
 *   { name: 'requests', registry: 'pypi' },
 * ]);
 * ```
 */
export function createPackageVerifier(config?: PackageVerifierConfig): PackageVerifier {
  return new PackageVerifierImpl(config);
}
