/**
 * @fileoverview Input Sanitization and Validation
 *
 * Provides comprehensive input sanitization for the LiBrainian system:
 * - Path traversal prevention
 * - Injection protection (SQL, command, regex)
 * - Content sanitization
 * - Size limits enforcement
 *
 * @packageDocumentation
 */

import * as path from 'node:path';

// ============================================================================
// TYPES
// ============================================================================

/** Sanitization result */
export interface SanitizationResult<T> {
  /** Whether input is valid */
  valid: boolean;

  /** Sanitized value (if valid) */
  value?: T;

  /** Original value before sanitization */
  original: unknown;

  /** Errors encountered */
  errors: SanitizationError[];

  /** Warnings (non-blocking issues) */
  warnings: string[];
}

/** Sanitization error */
export interface SanitizationError {
  /** Error code */
  code: string;

  /** Human-readable message */
  message: string;

  /** Field that caused error */
  field?: string;

  /** Severity level */
  severity: 'error' | 'warning';
}

/** Path sanitization options */
export interface PathSanitizationOptions {
  /** Base directory for path resolution */
  baseDir?: string;

  /** Allow absolute paths */
  allowAbsolute?: boolean;

  /** Allow symlinks */
  allowSymlinks?: boolean;

  /** Maximum path length */
  maxLength?: number;

  /** Allowed extensions (if specified) */
  allowedExtensions?: string[];

  /** Blocked patterns */
  blockedPatterns?: RegExp[];
}

/** String sanitization options */
export interface StringSanitizationOptions {
  /** Maximum length */
  maxLength?: number;

  /** Minimum length */
  minLength?: number;

  /** Allowed characters regex */
  allowedChars?: RegExp;

  /** Strip HTML tags */
  stripHtml?: boolean;

  /** Normalize whitespace */
  normalizeWhitespace?: boolean;

  /** Trim leading/trailing whitespace */
  trim?: boolean;

  /** Convert to lowercase */
  lowercase?: boolean;
}

/** Query sanitization options */
export interface QuerySanitizationOptions {
  /** Maximum query length */
  maxQueryLength?: number;

  /** Maximum number of filters */
  maxFilters?: number;

  /** Allowed operators */
  allowedOperators?: string[];

  /** Block regex patterns in queries */
  blockRegexPatterns?: boolean;
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

export const DEFAULT_PATH_OPTIONS: PathSanitizationOptions = {
  allowAbsolute: false,
  allowSymlinks: false,
  maxLength: 4096,
  blockedPatterns: [
    /\.\./,                    // Directory traversal
    /^\/etc\//,                // System config
    /^\/proc\//,               // Process info
    /^\/sys\//,                // System info
    /^~\//,                    // Home directory expansion
    /\$\{/,                    // Variable expansion
    /\$\(/,                    // Command substitution
    /`/,                       // Backtick execution
    /\x00/,                    // Null byte injection
  ],
};

export const DEFAULT_STRING_OPTIONS: StringSanitizationOptions = {
  maxLength: 10000,
  minLength: 0,
  stripHtml: true,
  normalizeWhitespace: true,
  trim: true,
};

export const DEFAULT_QUERY_OPTIONS: QuerySanitizationOptions = {
  maxQueryLength: 5000,
  maxFilters: 20,
  allowedOperators: ['=', '!=', '<', '>', '<=', '>=', 'IN', 'NOT IN', 'LIKE', 'IS NULL', 'IS NOT NULL'],
  blockRegexPatterns: false,
};

// ============================================================================
// PATH SANITIZATION
// ============================================================================

/**
 * Sanitize a file path to prevent traversal attacks.
 */
export function sanitizePath(
  inputPath: unknown,
  options: PathSanitizationOptions = {}
): SanitizationResult<string> {
  const opts = { ...DEFAULT_PATH_OPTIONS, ...options };
  const errors: SanitizationError[] = [];
  const warnings: string[] = [];

  // Type check
  if (typeof inputPath !== 'string') {
    return {
      valid: false,
      original: inputPath,
      errors: [{
        code: 'INVALID_TYPE',
        message: 'Path must be a string',
        severity: 'error',
      }],
      warnings: [],
    };
  }

  let sanitized = inputPath;

  // Check length
  if (sanitized.length > opts.maxLength!) {
    errors.push({
      code: 'PATH_TOO_LONG',
      message: `Path exceeds maximum length of ${opts.maxLength} characters`,
      severity: 'error',
    });
    return { valid: false, original: inputPath, errors, warnings };
  }

  // Check for blocked patterns
  for (const pattern of opts.blockedPatterns || []) {
    if (pattern.test(sanitized)) {
      errors.push({
        code: 'BLOCKED_PATTERN',
        message: `Path contains blocked pattern: ${pattern.source}`,
        severity: 'error',
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, original: inputPath, errors, warnings };
  }

  // Normalize path
  sanitized = path.normalize(sanitized);

  // Check if absolute when not allowed
  if (!opts.allowAbsolute && path.isAbsolute(sanitized)) {
    errors.push({
      code: 'ABSOLUTE_PATH_NOT_ALLOWED',
      message: 'Absolute paths are not allowed',
      severity: 'error',
    });
    return { valid: false, original: inputPath, errors, warnings };
  }

  // Resolve against base directory if provided
  // Note: This uses path.resolve which does not follow symlinks.
  // For symlink resolution, callers should use fs.realpath on baseDir before passing.
  if (opts.baseDir) {
    const resolvedPath = path.resolve(opts.baseDir, sanitized);
    const normalizedBase = path.resolve(opts.baseDir);

    // Ensure resolved path is within base directory
    if (!resolvedPath.startsWith(normalizedBase + path.sep) && resolvedPath !== normalizedBase) {
      errors.push({
        code: 'PATH_TRAVERSAL',
        message: 'Path escapes base directory',
        severity: 'error',
      });
      return { valid: false, original: inputPath, errors, warnings };
    }

    sanitized = resolvedPath;
  }

  // Check allowed extensions
  if (opts.allowedExtensions && opts.allowedExtensions.length > 0) {
    const ext = path.extname(sanitized).toLowerCase();
    if (!opts.allowedExtensions.includes(ext)) {
      errors.push({
        code: 'INVALID_EXTENSION',
        message: `Extension ${ext} is not allowed`,
        severity: 'error',
      });
      return { valid: false, original: inputPath, errors, warnings };
    }
  }

  return {
    valid: true,
    value: sanitized,
    original: inputPath,
    errors,
    warnings,
  };
}

/**
 * Check if a path is safe (no traversal, within bounds).
 */
export function isPathSafe(inputPath: string, baseDir?: string): boolean {
  const result = sanitizePath(inputPath, { baseDir, allowAbsolute: !!baseDir });
  return result.valid;
}

// ============================================================================
// STRING SANITIZATION
// ============================================================================

/**
 * Sanitize a string input.
 */
export function sanitizeString(
  input: unknown,
  options: StringSanitizationOptions = {}
): SanitizationResult<string> {
  const opts = { ...DEFAULT_STRING_OPTIONS, ...options };
  const errors: SanitizationError[] = [];
  const warnings: string[] = [];

  // Type check
  if (typeof input !== 'string') {
    return {
      valid: false,
      original: input,
      errors: [{
        code: 'INVALID_TYPE',
        message: 'Input must be a string',
        severity: 'error',
      }],
      warnings: [],
    };
  }

  let sanitized = input;

  // Trim
  if (opts.trim) {
    sanitized = sanitized.trim();
  }

  // Check length
  if (opts.minLength !== undefined && sanitized.length < opts.minLength) {
    errors.push({
      code: 'TOO_SHORT',
      message: `String is shorter than minimum length of ${opts.minLength}`,
      severity: 'error',
    });
  }

  if (opts.maxLength !== undefined && sanitized.length > opts.maxLength) {
    warnings.push(`String truncated from ${sanitized.length} to ${opts.maxLength} characters`);
    sanitized = sanitized.substring(0, opts.maxLength);
  }

  // Strip HTML
  if (opts.stripHtml) {
    sanitized = sanitized.replace(/<[^>]*>/g, '');
  }

  // Normalize whitespace
  if (opts.normalizeWhitespace) {
    sanitized = sanitized.replace(/\s+/g, ' ');
  }

  // Lowercase
  if (opts.lowercase) {
    sanitized = sanitized.toLowerCase();
  }

  // Check allowed characters
  if (opts.allowedChars && !opts.allowedChars.test(sanitized)) {
    errors.push({
      code: 'INVALID_CHARACTERS',
      message: 'String contains invalid characters',
      severity: 'error',
    });
  }

  if (errors.length > 0) {
    return { valid: false, original: input, errors, warnings };
  }

  return {
    valid: true,
    value: sanitized,
    original: input,
    errors,
    warnings,
  };
}

/**
 * Escape special characters for safe inclusion in regex.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escape special characters for safe shell usage.
 */
export function escapeShell(input: string): string {
  return `'${input.replace(/'/g, "'\\''")}'`;
}

/**
 * Remove control characters from a string.
 */
export function removeControlChars(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\x00-\x1F\x7F]/g, '');
}

// ============================================================================
// QUERY SANITIZATION
// ============================================================================

/**
 * Sanitize a query intent.
 */
export function sanitizeQuery(
  query: unknown,
  options: QuerySanitizationOptions = {}
): SanitizationResult<string> {
  const opts = { ...DEFAULT_QUERY_OPTIONS, ...options };
  const errors: SanitizationError[] = [];
  const warnings: string[] = [];

  // Type check
  if (typeof query !== 'string') {
    return {
      valid: false,
      original: query,
      errors: [{
        code: 'INVALID_TYPE',
        message: 'Query must be a string',
        severity: 'error',
      }],
      warnings: [],
    };
  }

  let sanitized = query.trim();

  // Check length
  if (sanitized.length > opts.maxQueryLength!) {
    warnings.push(`Query truncated from ${sanitized.length} to ${opts.maxQueryLength} characters`);
    sanitized = sanitized.substring(0, opts.maxQueryLength!);
  }

  // Block potentially dangerous regex patterns
  if (opts.blockRegexPatterns) {
    const dangerousPatterns = [
      /\(\?.*\)/,              // Regex groups with modifiers
      /\[\^.*\]/,              // Negated character classes
      /\*{2,}/,                // Multiple wildcards
      /\{[0-9]+,?\}/,          // Quantifiers
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(sanitized)) {
        errors.push({
          code: 'DANGEROUS_PATTERN',
          message: 'Query contains potentially dangerous regex pattern',
          severity: 'error',
        });
        break;
      }
    }
  }

  // Remove null bytes
  sanitized = sanitized.replace(/\x00/g, '');

  // Normalize whitespace
  sanitized = sanitized.replace(/\s+/g, ' ');

  if (errors.length > 0) {
    return { valid: false, original: query, errors, warnings };
  }

  return {
    valid: true,
    value: sanitized,
    original: query,
    errors,
    warnings,
  };
}

// ============================================================================
// OBJECT SANITIZATION
// ============================================================================

/**
 * Recursively sanitize an object.
 */
export function sanitizeObject<T extends Record<string, unknown>>(
  obj: unknown,
  schema: ObjectSchema
): SanitizationResult<T> {
  const errors: SanitizationError[] = [];
  const warnings: string[] = [];

  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return {
      valid: false,
      original: obj,
      errors: [{
        code: 'INVALID_TYPE',
        message: 'Input must be an object',
        severity: 'error',
      }],
      warnings: [],
    };
  }

  const result: Record<string, unknown> = {};
  const input = obj as Record<string, unknown>;

  // Check required fields
  for (const field of schema.required || []) {
    if (!(field in input) || input[field] === undefined) {
      errors.push({
        code: 'MISSING_REQUIRED_FIELD',
        message: `Required field '${field}' is missing`,
        field,
        severity: 'error',
      });
    }
  }

  // Process fields
  for (const [key, fieldSchema] of Object.entries(schema.properties || {})) {
    if (key in input) {
      const fieldResult = sanitizeField(input[key], fieldSchema, key);
      if (fieldResult.valid) {
        result[key] = fieldResult.value;
      } else {
        errors.push(...fieldResult.errors);
      }
      warnings.push(...fieldResult.warnings);
    } else if (fieldSchema.default !== undefined) {
      result[key] = fieldSchema.default;
    }
  }

  // Check for disallowed extra fields
  if (!schema.additionalProperties) {
    for (const key of Object.keys(input)) {
      if (!(key in (schema.properties || {}))) {
        warnings.push(`Unknown field '${key}' will be ignored`);
      }
    }
  } else {
    // Include additional properties
    for (const key of Object.keys(input)) {
      if (!(key in (schema.properties || {}))) {
        result[key] = input[key];
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, original: obj, errors, warnings };
  }

  return {
    valid: true,
    value: result as T,
    original: obj,
    errors,
    warnings,
  };
}

/** Object schema definition */
export interface ObjectSchema {
  properties?: Record<string, FieldSchema>;
  required?: string[];
  additionalProperties?: boolean;
}

/** Field schema definition */
export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: RegExp;
  enum?: unknown[];
  items?: FieldSchema;
  default?: unknown;
}

function sanitizeField(
  value: unknown,
  schema: FieldSchema,
  fieldName: string
): SanitizationResult<unknown> {
  const errors: SanitizationError[] = [];
  const warnings: string[] = [];

  // Type validation
  const actualType = Array.isArray(value) ? 'array' : typeof value;
  if (actualType !== schema.type) {
    return {
      valid: false,
      original: value,
      errors: [{
        code: 'TYPE_MISMATCH',
        message: `Field '${fieldName}' expected ${schema.type} but got ${actualType}`,
        field: fieldName,
        severity: 'error',
      }],
      warnings: [],
    };
  }

  let sanitized = value;

  // String validation
  if (schema.type === 'string' && typeof value === 'string') {
    const strResult = sanitizeString(value, {
      maxLength: schema.maxLength,
      minLength: schema.minLength,
    });
    if (!strResult.valid) {
      return { ...strResult, original: value };
    }
    sanitized = strResult.value;
  }

  // Number validation
  if (schema.type === 'number' && typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({
        code: 'BELOW_MINIMUM',
        message: `Field '${fieldName}' is below minimum value of ${schema.minimum}`,
        field: fieldName,
        severity: 'error',
      });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({
        code: 'ABOVE_MAXIMUM',
        message: `Field '${fieldName}' exceeds maximum value of ${schema.maximum}`,
        field: fieldName,
        severity: 'error',
      });
    }
  }

  // Enum validation
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({
      code: 'INVALID_ENUM',
      message: `Field '${fieldName}' must be one of: ${schema.enum.join(', ')}`,
      field: fieldName,
      severity: 'error',
    });
  }

  // Pattern validation
  if (schema.pattern && typeof value === 'string' && !schema.pattern.test(value)) {
    errors.push({
      code: 'PATTERN_MISMATCH',
      message: `Field '${fieldName}' does not match required pattern`,
      field: fieldName,
      severity: 'error',
    });
  }

  // Array validation
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    const sanitizedArray: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const itemResult = sanitizeField(value[i], schema.items, `${fieldName}[${i}]`);
      if (itemResult.valid) {
        sanitizedArray.push(itemResult.value);
      } else {
        errors.push(...itemResult.errors);
      }
      warnings.push(...itemResult.warnings);
    }
    sanitized = sanitizedArray;
  }

  if (errors.length > 0) {
    return { valid: false, original: value, errors, warnings };
  }

  return {
    valid: true,
    value: sanitized,
    original: value,
    errors,
    warnings,
  };
}

// ============================================================================
// CONTENT SIZE LIMITS
// ============================================================================

/** Content size limits */
export interface SizeLimits {
  /** Maximum file size in bytes */
  maxFileSize: number;

  /** Maximum total request size in bytes */
  maxRequestSize: number;

  /** Maximum number of files per request */
  maxFilesPerRequest: number;

  /** Maximum query result count */
  maxResultCount: number;

  /** Maximum pack content size */
  maxPackContentSize: number;
}

export const DEFAULT_SIZE_LIMITS: SizeLimits = {
  maxFileSize: 10 * 1024 * 1024,        // 10 MB
  maxRequestSize: 50 * 1024 * 1024,     // 50 MB
  maxFilesPerRequest: 1000,
  maxResultCount: 100,
  maxPackContentSize: 1 * 1024 * 1024,  // 1 MB
};

/**
 * Check if content is within size limits.
 */
export function checkSizeLimit(
  size: number,
  limit: number,
  label: string
): SanitizationResult<number> {
  if (size <= limit) {
    return {
      valid: true,
      value: size,
      original: size,
      errors: [],
      warnings: [],
    };
  }

  return {
    valid: false,
    original: size,
    errors: [{
      code: 'SIZE_LIMIT_EXCEEDED',
      message: `${label} size ${size} exceeds limit of ${limit} bytes`,
      severity: 'error',
    }],
    warnings: [],
  };
}
