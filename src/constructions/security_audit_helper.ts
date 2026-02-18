/**
 * @fileoverview Security Audit Helper Construction
 *
 * A composed construction that performs security analysis by combining:
 * - Security indexer for vulnerability detection
 * - Pattern matching for known vulnerability patterns
 * - Hypothesis generator for potential attack vectors
 * - Dependency vulnerability scanning via npm audit
 *
 * Composes:
 * - Query API for code analysis
 * - Security Indexer for vulnerability detection
 * - Pattern Catalog for security anti-patterns
 * - Confidence System for uncertainty quantification
 * - NPM Audit for CVE database checks
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import type { Librarian } from '../api/librarian.js';
import type { ConfidenceValue, MeasuredConfidence, BoundedConfidence, AbsentConfidence } from '../epistemics/confidence.js';
import type { ContextPack } from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

export type SecurityCheckType =
  | 'injection'
  | 'auth'
  | 'crypto'
  | 'exposure'
  | 'ssrf'
  | 'logging'
  | 'headers'
  | 'components';

export interface AuditScope {
  /** Files to audit */
  files: string[];
  /** Types of security checks to perform */
  checkTypes: SecurityCheckType[];
  /** Workspace path for dependency vulnerability scanning (optional) */
  workspace?: string;
}

export interface SecurityFinding {
  /** Type of security issue */
  type: SecurityCheckType;
  /** Severity level */
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  /** File where issue is found */
  file: string;
  /** Line number if applicable */
  line?: number;
  /** CWE identifier if applicable */
  cweId?: string;
  /** Title of the finding */
  title: string;
  /** Detailed description */
  description: string;
  /** Code snippet showing the issue */
  codeSnippet?: string;
  /** Remediation guidance */
  remediation: string;
  /** Confidence in this finding */
  confidence: number;
}

export interface SeverityBreakdown {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface VulnerabilityFinding {
  /** Package name */
  package: string;
  /** Current version in use */
  currentVersion: string;
  /** Versions below this are vulnerable */
  vulnerableBelow: string;
  /** CVE identifier */
  cve: string;
  /** Severity level */
  severity: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Dependency vulnerability information from npm audit or fallback detection.
 */
export interface DependencyVulnerability {
  /** Package name */
  package: string;
  /** Severity level */
  severity: 'critical' | 'high' | 'moderate' | 'low';
  /** Title or name of the vulnerability */
  title: string;
  /** URL to vulnerability details (e.g., NVD) */
  url?: string;
  /** Whether a fix is available */
  fixAvailable: boolean;
  /** Vulnerable version range */
  range: string;
  /** Chain of dependencies that led to this vulnerability */
  via: string[];
}

/**
 * Result of dependency vulnerability scan.
 */
export interface DependencyScanResult {
  /** List of vulnerabilities found */
  vulnerabilities: DependencyVulnerability[];
  /** Whether npm audit was used (vs fallback) */
  source: 'npm_audit' | 'known_vulnerabilities';
  /** Scan duration in milliseconds */
  scanTimeMs: number;
  /** Total number of packages scanned */
  packagesScanned: number;
}

export interface SecurityReport {
  /** Original scope */
  scope: AuditScope;

  /** Security findings */
  findings: SecurityFinding[];

  /** Dependency vulnerabilities (if workspace was scanned) */
  dependencyVulnerabilities?: DependencyVulnerability[];

  /** Severity breakdown */
  severity: SeverityBreakdown;

  /** Files audited */
  filesAudited: number;

  /** Overall risk score (0-100, higher is worse) */
  riskScore: number;

  /** Confidence in the audit results */
  confidence: ConfidenceValue;

  /** Evidence trail */
  evidenceRefs: string[];

  /** Audit timing */
  auditTimeMs: number;
}

// ============================================================================
// SECURITY PATTERNS
// ============================================================================

const INJECTION_PATTERNS = [
  { pattern: /eval\s*\(/, title: 'Eval Usage', cwe: 'CWE-95' },
  { pattern: /new\s+Function\s*\(/, title: 'Dynamic Function Creation', cwe: 'CWE-95' },
  { pattern: /innerHTML\s*=/, title: 'InnerHTML Assignment', cwe: 'CWE-79' },
  { pattern: /document\.write\s*\(/, title: 'Document.write Usage', cwe: 'CWE-79' },
  { pattern: /\$\{.*\}.*sql|SQL.*\$\{/, title: 'SQL Injection Risk', cwe: 'CWE-89' },
  { pattern: /exec\s*\(|spawn\s*\(|execSync\s*\(/, title: 'Command Execution', cwe: 'CWE-78' },
  { pattern: /\.query\s*\(\s*['"`].*\+/, title: 'String Concatenation in Query', cwe: 'CWE-89' },
];

const AUTH_PATTERNS = [
  { pattern: /password\s*===?\s*['"]/, title: 'Hardcoded Password Comparison', cwe: 'CWE-798' },
  { pattern: /jwt\.verify\s*\([^,]+,\s*['"]/, title: 'Hardcoded JWT Secret', cwe: 'CWE-798' },
  { pattern: /isAdmin\s*=\s*true/, title: 'Hardcoded Admin Flag', cwe: 'CWE-284' },
  { pattern: /skip.*auth|bypass.*auth/i, title: 'Auth Bypass Indicator', cwe: 'CWE-287' },
  { pattern: /req\.user\s*=/, title: 'Direct User Assignment', cwe: 'CWE-287' },
];

const CRYPTO_PATTERNS = [
  { pattern: /md5|sha1(?![\d])/i, title: 'Weak Hash Algorithm', cwe: 'CWE-328' },
  { pattern: /createCipher\s*\(/, title: 'Deprecated Cipher API', cwe: 'CWE-327' },
  { pattern: /Math\.random\s*\(/, title: 'Math.random for Security', cwe: 'CWE-330' },
  { pattern: /DES|3DES|RC4/i, title: 'Weak Encryption Algorithm', cwe: 'CWE-327' },
  { pattern: /key\s*[:=]\s*['"][^'"]{1,16}['"]/, title: 'Short Encryption Key', cwe: 'CWE-326' },
];

const EXPOSURE_PATTERNS = [
  { pattern: /console\.(log|info|debug).*password/i, title: 'Password in Logs', cwe: 'CWE-532' },
  { pattern: /console\.(log|info|debug).*token/i, title: 'Token in Logs', cwe: 'CWE-532' },
  { pattern: /console\.(log|info|debug).*secret/i, title: 'Secret in Logs', cwe: 'CWE-532' },
  { pattern: /api[_-]?key\s*[:=]\s*['"]/, title: 'Hardcoded API Key', cwe: 'CWE-798' },
  { pattern: /private[_-]?key\s*[:=]\s*['"]/, title: 'Hardcoded Private Key', cwe: 'CWE-798' },
  { pattern: /\.env['"]|process\.env/, title: 'Environment Variable Usage', cwe: 'info' },
  { pattern: /cors.*origin.*\*/, title: 'Permissive CORS', cwe: 'CWE-942' },
];

// A02 - Cryptographic Failures (Extended)
const WEAK_CRYPTO_PATTERNS = [
  { pattern: /crypto\.createCipher\s*\(/, title: 'Deprecated Cipher API', cwe: 'CWE-327', owasp: 'A02' },
  { pattern: /MD5|SHA1(?![\w])/i, title: 'Weak Hash Algorithm', cwe: 'CWE-328', owasp: 'A02' },
  { pattern: /DES|RC4|Blowfish/i, title: 'Weak Encryption Algorithm', cwe: 'CWE-327', owasp: 'A02' },
  { pattern: /randomBytes\s*\(\s*[0-8]\s*\)/, title: 'Insufficient Random Bytes', cwe: 'CWE-330', owasp: 'A02' },
  { pattern: /Math\.random\s*\(\)/, title: 'Non-Cryptographic Random', cwe: 'CWE-330', owasp: 'A02' },
  { pattern: /\.createHash\s*\(\s*['"]md5['"]/, title: 'MD5 Hash Usage', cwe: 'CWE-328', owasp: 'A02' },
  { pattern: /\.createHash\s*\(\s*['"]sha1['"]/, title: 'SHA1 Hash Usage', cwe: 'CWE-328', owasp: 'A02' },
  { pattern: /Buffer\.from\s*\([^,]+,\s*['"]base64['"]\).*key/i, title: 'Base64 Encoded Key', cwe: 'CWE-321', owasp: 'A02' },
  { pattern: /['"]aes-128-ecb['"]|['"]aes-192-ecb['"]|['"]aes-256-ecb['"]/i, title: 'ECB Mode Encryption', cwe: 'CWE-327', owasp: 'A02' },
  { pattern: /pbkdf2.*iterations\s*[:=]\s*\d{1,3}[^\d]/i, title: 'Low PBKDF2 Iterations', cwe: 'CWE-916', owasp: 'A02' },
];

// A06 - Vulnerable and Outdated Components
const VULNERABLE_COMPONENT_PATTERNS = [
  { pattern: /"lodash":\s*"[0-3]\./, title: 'Vulnerable Lodash Version', cwe: 'CWE-1395', owasp: 'A06' },
  { pattern: /"axios":\s*"0\.[0-9]\./, title: 'Vulnerable Axios Version', cwe: 'CWE-1395', owasp: 'A06' },
  { pattern: /"express":\s*"[0-3]\./, title: 'Vulnerable Express Version', cwe: 'CWE-1395', owasp: 'A06' },
  { pattern: /"minimist":\s*"[0-1]\.[0-1]\./, title: 'Vulnerable Minimist Version', cwe: 'CWE-1395', owasp: 'A06' },
  { pattern: /"node-fetch":\s*"[0-1]\.|"node-fetch":\s*"2\.[0-5]\./, title: 'Vulnerable Node-Fetch Version', cwe: 'CWE-1395', owasp: 'A06' },
  { pattern: /"jquery":\s*"[0-2]\.|"jquery":\s*"3\.[0-4]\./, title: 'Vulnerable jQuery Version', cwe: 'CWE-1395', owasp: 'A06' },
  { pattern: /"moment":\s*"[0-1]\.|"moment":\s*"2\.[0-9]\./i, title: 'Outdated Moment.js', cwe: 'CWE-1395', owasp: 'A06' },
  { pattern: /require\s*\(\s*['"][^'"]+['"]\s*\)\s*\(/, title: 'Dynamic Require Execution', cwe: 'CWE-829', owasp: 'A06' },
];

// A09 - Security Logging and Monitoring Failures
const LOGGING_PATTERNS = [
  { pattern: /catch\s*\([^)]*\)\s*\{\s*\}/, title: 'Empty Catch Block', cwe: 'CWE-390', owasp: 'A09' },
  { pattern: /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/, title: 'Empty Promise Catch', cwe: 'CWE-390', owasp: 'A09' },
  { pattern: /catch\s*\([^)]*\)\s*\{\s*\/\//, title: 'Commented-Out Error Handling', cwe: 'CWE-390', owasp: 'A09' },
  { pattern: /catch\s*\([^)]*\)\s*\{\s*return\s*;?\s*\}/, title: 'Silent Error Suppression', cwe: 'CWE-390', owasp: 'A09' },
  { pattern: /\.catch\s*\(\s*_\s*=>\s*\{\s*\}/, title: 'Ignored Promise Error', cwe: 'CWE-390', owasp: 'A09' },
  { pattern: /on\s*\(\s*['"]error['"]\s*,\s*\(\s*\)\s*=>\s*\{\s*\}/, title: 'Empty Error Event Handler', cwe: 'CWE-390', owasp: 'A09' },
  { pattern: /process\.on\s*\(\s*['"]uncaughtException['"][\s\S]*?process\.exit\s*\(\s*0\s*\)/, title: 'Silent Uncaught Exception', cwe: 'CWE-390', owasp: 'A09' },
];

// A10 - Server-Side Request Forgery (SSRF)
const SSRF_PATTERNS = [
  { pattern: /fetch\s*\(\s*(?!['"`])/, title: 'Dynamic Fetch URL', cwe: 'CWE-918', owasp: 'A10' },
  { pattern: /axios\.(get|post|put|delete|patch|request)\s*\(\s*(?!['"`])/, title: 'Dynamic Axios URL', cwe: 'CWE-918', owasp: 'A10' },
  { pattern: /http\.request\s*\(\s*\{[^}]*url\s*:/, title: 'Dynamic HTTP Request', cwe: 'CWE-918', owasp: 'A10' },
  { pattern: /https?\.request\s*\(\s*(?!['"`])/, title: 'Dynamic HTTPS Request', cwe: 'CWE-918', owasp: 'A10' },
  { pattern: /request\s*\(\s*(?!['"`])(?!\{)/, title: 'Dynamic Request Library URL', cwe: 'CWE-918', owasp: 'A10' },
  { pattern: /new\s+URL\s*\(\s*(?!['"`])/, title: 'Dynamic URL Construction', cwe: 'CWE-918', owasp: 'A10' },
  { pattern: /got\s*\(\s*(?!['"`])/, title: 'Dynamic Got URL', cwe: 'CWE-918', owasp: 'A10' },
  { pattern: /superagent\.(get|post|put|delete)\s*\(\s*(?!['"`])/, title: 'Dynamic Superagent URL', cwe: 'CWE-918', owasp: 'A10' },
  { pattern: /url\.resolve\s*\([^,]+,\s*req\.|url\.resolve\s*\([^,]+,\s*params\./, title: 'URL Resolution with User Input', cwe: 'CWE-918', owasp: 'A10' },
];

// A05 - Security Misconfiguration (Missing Headers)
const MISSING_HEADERS_PATTERNS = [
  { pattern: /app\.use\s*\(\s*cors\s*\(\s*\)\s*\)/, title: 'Default CORS Configuration', cwe: 'CWE-942', owasp: 'A05' },
  { pattern: /res\.setHeader\s*\(\s*['"]Access-Control-Allow-Origin['"]\s*,\s*['"]\*['"]/, title: 'Wildcard CORS Origin', cwe: 'CWE-942', owasp: 'A05' },
  { pattern: /app\.disable\s*\(\s*['"]x-powered-by['"]/, title: 'X-Powered-By Disabled (Good)', cwe: 'info', owasp: 'A05' },
  { pattern: /cookie\s*:\s*\{[^}]*secure\s*:\s*false/, title: 'Insecure Cookie', cwe: 'CWE-614', owasp: 'A05' },
  { pattern: /cookie\s*:\s*\{[^}]*httpOnly\s*:\s*false/, title: 'Non-HttpOnly Cookie', cwe: 'CWE-1004', owasp: 'A05' },
  { pattern: /cookie\s*:\s*\{[^}]*sameSite\s*:\s*['"]none['"]/i, title: 'SameSite None Cookie', cwe: 'CWE-1275', owasp: 'A05' },
  { pattern: /\.listen\s*\(\s*\d+\s*\)(?![^;]*https)/, title: 'HTTP Without HTTPS', cwe: 'CWE-319', owasp: 'A05' },
];

// Known vulnerable package versions for dependency checking (fallback when npm audit unavailable)
const KNOWN_VULNERABILITIES: Record<string, { below: string; severity: 'critical' | 'high' | 'moderate' | 'low'; cve: string; title: string }[]> = {
  'lodash': [
    { below: '4.17.21', severity: 'high', cve: 'CVE-2021-23337', title: 'Command Injection' },
  ],
  'axios': [
    { below: '0.21.1', severity: 'high', cve: 'CVE-2020-28168', title: 'SSRF' },
    { below: '1.6.0', severity: 'moderate', cve: 'CVE-2023-45857', title: 'CSRF' },
  ],
  'express': [
    { below: '4.17.3', severity: 'moderate', cve: 'CVE-2022-24999', title: 'Open Redirect' },
  ],
  'minimist': [
    { below: '1.2.6', severity: 'critical', cve: 'CVE-2021-44906', title: 'Prototype Pollution' },
  ],
  'node-fetch': [
    { below: '2.6.7', severity: 'high', cve: 'CVE-2022-0235', title: 'Information Disclosure' },
  ],
  'got': [
    { below: '11.8.5', severity: 'moderate', cve: 'CVE-2022-33987', title: 'SSRF' },
  ],
  'jsonwebtoken': [
    { below: '9.0.0', severity: 'high', cve: 'CVE-2022-23529', title: 'Improper Verification' },
  ],
  'moment': [
    { below: '2.29.4', severity: 'high', cve: 'CVE-2022-31129', title: 'ReDoS' },
  ],
  'underscore': [
    { below: '1.13.6', severity: 'high', cve: 'CVE-2021-23358', title: 'Arbitrary Code Execution' },
  ],
  'qs': [
    { below: '6.10.3', severity: 'high', cve: 'CVE-2022-24999', title: 'Prototype Pollution' },
  ],
  'glob-parent': [
    { below: '5.1.2', severity: 'high', cve: 'CVE-2020-28469', title: 'ReDoS' },
  ],
  'json-schema': [
    { below: '0.4.0', severity: 'critical', cve: 'CVE-2021-3918', title: 'Prototype Pollution' },
  ],
  'tar': [
    { below: '6.1.11', severity: 'high', cve: 'CVE-2021-37713', title: 'Arbitrary File Write' },
  ],
  'path-parse': [
    { below: '1.0.7', severity: 'moderate', cve: 'CVE-2021-23343', title: 'ReDoS' },
  ],
  'ansi-regex': [
    { below: '5.0.1', severity: 'high', cve: 'CVE-2021-3807', title: 'ReDoS' },
  ],
  'nth-check': [
    { below: '2.0.1', severity: 'high', cve: 'CVE-2021-3803', title: 'ReDoS' },
  ],
  'semver': [
    { below: '7.5.2', severity: 'moderate', cve: 'CVE-2022-25883', title: 'ReDoS' },
  ],
  'tough-cookie': [
    { below: '4.1.3', severity: 'moderate', cve: 'CVE-2023-26136', title: 'Prototype Pollution' },
  ],
  'word-wrap': [
    { below: '1.2.4', severity: 'moderate', cve: 'CVE-2023-26115', title: 'ReDoS' },
  ],
  'xml2js': [
    { below: '0.5.0', severity: 'moderate', cve: 'CVE-2023-0842', title: 'Prototype Pollution' },
  ],
  'jquery': [
    { below: '3.5.0', severity: 'moderate', cve: 'CVE-2020-11023', title: 'XSS' },
  ],
};

// Legacy format for backward compatibility
const KNOWN_VULNERABLE_PACKAGES: Record<string, { below: string; cve: string; severity: 'critical' | 'high' | 'medium' | 'low' }> = {
  'lodash': { below: '4.17.21', cve: 'CVE-2021-23337', severity: 'high' },
  'axios': { below: '0.21.1', cve: 'CVE-2020-28168', severity: 'medium' },
  'express': { below: '4.17.3', cve: 'CVE-2022-24999', severity: 'high' },
  'minimist': { below: '1.2.6', cve: 'CVE-2021-44906', severity: 'critical' },
  'node-fetch': { below: '2.6.7', cve: 'CVE-2022-0235', severity: 'high' },
  'jquery': { below: '3.5.0', cve: 'CVE-2020-11023', severity: 'medium' },
  'underscore': { below: '1.13.6', cve: 'CVE-2021-23358', severity: 'high' },
  'moment': { below: '2.29.4', cve: 'CVE-2022-31129', severity: 'high' },
  'qs': { below: '6.10.3', cve: 'CVE-2022-24999', severity: 'high' },
  'glob-parent': { below: '5.1.2', cve: 'CVE-2020-28469', severity: 'high' },
  'json-schema': { below: '0.4.0', cve: 'CVE-2021-3918', severity: 'critical' },
  'tar': { below: '6.1.11', cve: 'CVE-2021-37713', severity: 'high' },
  'path-parse': { below: '1.0.7', cve: 'CVE-2021-23343', severity: 'medium' },
  'ansi-regex': { below: '5.0.1', cve: 'CVE-2021-3807', severity: 'high' },
  'nth-check': { below: '2.0.1', cve: 'CVE-2021-3803', severity: 'high' },
};

// ============================================================================
// TAINT ANALYSIS
// ============================================================================

export interface TaintSource {
  name: string;
  patterns: RegExp[];
  type: 'request' | 'env' | 'file' | 'database';
}

export interface TaintSink {
  name: string;
  patterns: RegExp[];
  vulnerability: string;
}

export const TAINT_SOURCES: TaintSource[] = [
  {
    name: 'request_params',
    patterns: [
      // Dot notation: req.params.id, req.query.name, etc.
      /req\.(params|query|body|headers)(\.\w+|\[['"`]\w+['"`]\])/gi,
      // Bracket notation: req.params['id']
      /request\.(params|query|body|headers)(\.\w+|\[['"`]\w+['"`]\])?/gi,
      // Koa context: ctx.params, ctx.query, etc.
      /ctx\.(params|query|request\.body)(\.\w+|\[['"`]\w+['"`]\])?/gi,
    ],
    type: 'request',
  },
  {
    name: 'user_input',
    patterns: [
      // DOM element access
      /document\.getElementById\s*\([^)]+\)/gi,
      /document\.querySelector\s*\([^)]+\)/gi,
      // Event target value
      /event\.target\.value/gi,
      // FormData
      /new\s+FormData/gi,
    ],
    type: 'request',
  },
  {
    name: 'environment',
    patterns: [
      // process.env.VAR_NAME or process.env['VAR_NAME']
      /process\.env(\.\w+|\[['"`]\w+['"`]\])/gi,
    ],
    type: 'env',
  },
];

export const TAINT_SINKS: TaintSink[] = [
  {
    name: 'sql_query',
    patterns: [
      /\.query\s*\(\s*[`'"]/gi,
      /\.execute\s*\(\s*[`'"]/gi,
      /\.raw\s*\(\s*[`'"]/gi,
    ],
    vulnerability: 'SQL Injection',
  },
  {
    name: 'command_execution',
    patterns: [
      /exec\s*\(/gi,
      /execSync\s*\(/gi,
      /spawn\s*\(/gi,
      /child_process/gi,
    ],
    vulnerability: 'Command Injection',
  },
  {
    name: 'file_access',
    patterns: [
      /readFile(Sync)?\s*\(/gi,
      /writeFile(Sync)?\s*\(/gi,
      /fs\.(read|write|access|stat)/gi,
    ],
    vulnerability: 'Path Traversal',
  },
  {
    name: 'eval',
    patterns: [
      /eval\s*\(/gi,
      /Function\s*\(/gi,
      /new\s+Function/gi,
    ],
    vulnerability: 'Code Injection',
  },
  {
    name: 'html_output',
    patterns: [
      /innerHTML\s*=/gi,
      /outerHTML\s*=/gi,
      /document\.write/gi,
      /\.html\s*\(/gi,
    ],
    vulnerability: 'XSS',
  },
];

export interface TaintFlow {
  source: string;
  sink: string;
  vulnerability: string;
  file: string;
  line: number;
  confidence: 'high' | 'medium' | 'low';
  codeSnippet: string;
}

/**
 * Analyze code for taint flow from sources to sinks.
 *
 * This performs a basic intra-procedural taint analysis:
 * 1. First pass: identify variables assigned from taint sources
 * 2. Second pass: detect when tainted variables or direct sources reach sinks
 *
 * @param code - The source code to analyze
 * @param filePath - Path to the file being analyzed
 * @returns Array of detected taint flows
 */
export function analyzeTaintFlow(code: string, filePath: string): TaintFlow[] {
  const flows: TaintFlow[] = [];
  const lines = code.split('\n');

  // Track tainted variables
  const taintedVars = new Map<string, { source: string; line: number }>();

  // First pass: identify tainted variables
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const source of TAINT_SOURCES) {
      for (const pattern of source.patterns) {
        // Reset regex lastIndex for global patterns
        pattern.lastIndex = 0;
        if (pattern.test(line)) {
          // Extract variable being assigned
          const assignMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=|(\w+)\s*=/);
          if (assignMatch) {
            const varName = assignMatch[1] || assignMatch[2];
            taintedVars.set(varName, { source: source.name, line: i + 1 });
          }
        }
      }
    }
  }

  // Second pass: find tainted data reaching sinks
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const sink of TAINT_SINKS) {
      for (const pattern of sink.patterns) {
        // Reset regex lastIndex for global patterns
        pattern.lastIndex = 0;
        if (pattern.test(line)) {
          // Check if any tainted variable is used in this line
          for (const [varName, taintInfo] of taintedVars) {
            // Use word boundary to avoid partial matches
            const varRegex = new RegExp(`\\b${varName}\\b`);
            if (varRegex.test(line)) {
              flows.push({
                source: taintInfo.source,
                sink: sink.name,
                vulnerability: sink.vulnerability,
                file: filePath,
                line: i + 1,
                confidence: 'medium',
                codeSnippet: line.trim(),
              });
            }
          }

          // Direct source in sink (high confidence)
          for (const source of TAINT_SOURCES) {
            for (const srcPattern of source.patterns) {
              // Reset regex lastIndex for global patterns
              srcPattern.lastIndex = 0;
              if (srcPattern.test(line)) {
                flows.push({
                  source: source.name,
                  sink: sink.name,
                  vulnerability: sink.vulnerability,
                  file: filePath,
                  line: i + 1,
                  confidence: 'high',
                  codeSnippet: line.trim(),
                });
              }
            }
          }
        }
      }
    }
  }

  return flows;
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

export class SecurityAuditHelper {
  private librarian: Librarian;

  constructor(librarian: Librarian) {
    this.librarian = librarian;
  }

  /**
   * Perform a security audit.
   */
  async audit(scope: AuditScope): Promise<SecurityReport> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];
    const findings: SecurityFinding[] = [];
    let dependencyVulnerabilities: DependencyVulnerability[] | undefined;

    // Run each check type
    for (const checkType of scope.checkTypes) {
      const checkFindings = await this.runSecurityCheck(checkType, scope.files);
      findings.push(...checkFindings);
      evidenceRefs.push(`${checkType}_check:${checkFindings.length}_findings`);
    }

    // Run dependency vulnerability scan if workspace is provided
    if (scope.workspace) {
      const depScan = await scanDependencyVulnerabilities(scope.workspace);
      dependencyVulnerabilities = depScan.vulnerabilities;

      // Convert to findings and add to the list
      const depFindings = dependencyVulnerabilitiesToFindings(
        depScan.vulnerabilities,
        scope.workspace
      );
      findings.push(...depFindings);

      evidenceRefs.push(`dependency_scan:${depScan.source}:${depScan.vulnerabilities.length}_vulns`);
      evidenceRefs.push(`packages_scanned:${depScan.packagesScanned}`);
    }

    // Deduplicate findings
    const deduplicatedFindings = this.deduplicateFindings(findings);

    // Compute severity breakdown
    const severity = this.computeSeverityBreakdown(deduplicatedFindings);
    evidenceRefs.push(`severity:${severity.critical}C/${severity.high}H/${severity.medium}M`);

    // Compute risk score
    const riskScore = this.computeRiskScore(severity, scope.files.length);

    // Compute confidence
    const confidence = this.computeConfidence(deduplicatedFindings, scope);

    return {
      scope,
      findings: deduplicatedFindings,
      dependencyVulnerabilities,
      severity,
      filesAudited: scope.files.length,
      riskScore,
      confidence,
      evidenceRefs,
      auditTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Run a specific security check.
   */
  private async runSecurityCheck(
    checkType: SecurityCheckType,
    files: string[]
  ): Promise<SecurityFinding[]> {
    const patterns = this.getPatternsForCheck(checkType);
    const findings: SecurityFinding[] = [];

    // Query librarian for relevant code
    const queryResult = await this.librarian.queryOptional({
      intent: this.getCheckIntent(checkType),
      affectedFiles: files,
      depth: 'L2',
      taskType: 'security_audit',
      perspective: 'security',
    });

    if (queryResult.packs) {
      for (const pack of queryResult.packs) {
        if (pack.codeSnippets) {
          for (const snippet of pack.codeSnippets) {
            const snippetFindings = this.analyzeSnippet(
              snippet.content,
              snippet.filePath || pack.relatedFiles?.[0] || 'unknown',
              snippet.startLine,
              checkType,
              patterns
            );
            findings.push(...snippetFindings);
          }
        }
      }
    }

    // Also run pattern-based detection on file queries
    for (const file of files) {
      const fileResult = await this.librarian.queryOptional({
        intent: `Get security-relevant code from ${file}`,
        affectedFiles: [file],
        depth: 'L1',
        taskType: 'security_audit',
        perspective: 'security',
      });

      if (fileResult.packs) {
        for (const pack of fileResult.packs) {
          if (pack.codeSnippets) {
            for (const snippet of pack.codeSnippets) {
              const snippetFindings = this.analyzeSnippet(
                snippet.content,
                file,
                snippet.startLine,
                checkType,
                patterns
              );
              findings.push(...snippetFindings);
            }
          }
        }
      }
    }

    return findings;
  }

  /**
   * Get patterns for a check type.
   */
  private getPatternsForCheck(checkType: SecurityCheckType): Array<{
    pattern: RegExp;
    title: string;
    cwe: string;
    owasp?: string;
  }> {
    switch (checkType) {
      case 'injection':
        return INJECTION_PATTERNS;
      case 'auth':
        return AUTH_PATTERNS;
      case 'crypto':
        return [...CRYPTO_PATTERNS, ...WEAK_CRYPTO_PATTERNS];
      case 'exposure':
        return EXPOSURE_PATTERNS;
      case 'ssrf':
        return SSRF_PATTERNS;
      case 'logging':
        return LOGGING_PATTERNS;
      case 'headers':
        return MISSING_HEADERS_PATTERNS;
      case 'components':
        return VULNERABLE_COMPONENT_PATTERNS;
      default:
        return [];
    }
  }

  /**
   * Get query intent for a check type.
   */
  private getCheckIntent(checkType: SecurityCheckType): string {
    switch (checkType) {
      case 'injection':
        return 'Find code that handles user input, executes dynamic code, or builds SQL queries';
      case 'auth':
        return 'Find authentication and authorization code, session handling, and access control';
      case 'crypto':
        return 'Find cryptographic operations, hashing, encryption, and random number generation';
      case 'exposure':
        return 'Find logging, error handling, API keys, secrets, and sensitive data handling';
      case 'ssrf':
        return 'Find HTTP requests, fetch calls, axios usage, and URL construction from variables';
      case 'logging':
        return 'Find error handling, catch blocks, promise catch handlers, and exception handling';
      case 'headers':
        return 'Find HTTP server configuration, CORS setup, cookie settings, and security headers';
      case 'components':
        return 'Find package.json dependencies, require statements, and import declarations';
      default:
        return 'Find security-relevant code';
    }
  }

  /**
   * Analyze a code snippet for security issues.
   */
  private analyzeSnippet(
    code: string,
    file: string,
    startLine: number,
    checkType: SecurityCheckType,
    patterns: Array<{ pattern: RegExp; title: string; cwe: string }>
  ): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { pattern, title, cwe } of patterns) {
      const match = pattern.exec(code);
      if (match) {
        // Calculate line number within snippet
        const beforeMatch = code.substring(0, match.index);
        const lineOffset = (beforeMatch.match(/\n/g) || []).length;

        findings.push({
          type: checkType,
          severity: this.determineSeverity(cwe, title),
          file,
          line: startLine + lineOffset,
          cweId: cwe !== 'info' ? cwe : undefined,
          title,
          description: this.getDescriptionForPattern(title, checkType),
          codeSnippet: this.extractRelevantCode(code, match.index, 100),
          remediation: this.getRemediationForPattern(title, checkType),
          confidence: this.getPatternConfidence(checkType, title),
        });
      }
    }

    return findings;
  }

  /**
   * Determine severity based on CWE and title.
   */
  private determineSeverity(cwe: string, title: string): SecurityFinding['severity'] {
    // Critical: RCE, SQL injection, auth bypass, SSRF
    if (['CWE-78', 'CWE-89', 'CWE-287', 'CWE-918'].includes(cwe)) {
      return 'critical';
    }

    // High: XSS, hardcoded secrets, weak crypto, vulnerable components
    if (['CWE-79', 'CWE-798', 'CWE-327', 'CWE-328', 'CWE-1395', 'CWE-829', 'CWE-916', 'CWE-321'].includes(cwe)) {
      return 'high';
    }

    // Medium: Weak random, short keys, cookie issues, missing logging
    if (['CWE-330', 'CWE-326', 'CWE-284', 'CWE-614', 'CWE-1004', 'CWE-1275', 'CWE-319', 'CWE-390'].includes(cwe)) {
      return 'medium';
    }

    // Low: Info disclosure, CORS
    if (['CWE-532', 'CWE-942'].includes(cwe)) {
      return 'low';
    }

    // Info: awareness items
    if (cwe === 'info' || title.includes('Usage') || title.includes('(Good)')) {
      return 'info';
    }

    return 'medium';
  }

  /**
   * Get description for a pattern.
   */
  private getDescriptionForPattern(title: string, checkType: SecurityCheckType): string {
    const descriptions: Record<string, string> = {
      // Injection
      'Eval Usage': 'The eval() function can execute arbitrary code, making it a prime target for code injection attacks.',
      'Dynamic Function Creation': 'Creating functions dynamically from strings can lead to code injection vulnerabilities.',
      'InnerHTML Assignment': 'Direct innerHTML assignment can lead to Cross-Site Scripting (XSS) vulnerabilities.',
      'SQL Injection Risk': 'String interpolation in SQL queries can lead to SQL injection attacks.',
      'Command Execution': 'Shell command execution with user input can lead to Remote Code Execution (RCE).',
      // Auth
      'Hardcoded Password Comparison': 'Hardcoded password comparisons expose credentials in source code.',
      'Hardcoded JWT Secret': 'Hardcoded JWT secrets compromise token security and should be externalized.',
      // Crypto (A02)
      'Weak Hash Algorithm': 'MD5 and SHA1 are cryptographically broken and should not be used for security.',
      'Math.random for Security': 'Math.random() is not cryptographically secure; use crypto.randomBytes() instead.',
      'Non-Cryptographic Random': 'Math.random() is predictable and should not be used for security-sensitive operations.',
      'Deprecated Cipher API': 'crypto.createCipher() is deprecated due to weak key derivation; use createCipheriv() instead.',
      'Weak Encryption Algorithm': 'DES, RC4, and Blowfish are considered weak; use AES-256-GCM instead.',
      'Insufficient Random Bytes': 'Using fewer than 16 random bytes may not provide adequate security.',
      'MD5 Hash Usage': 'MD5 is cryptographically broken and vulnerable to collision attacks.',
      'SHA1 Hash Usage': 'SHA1 is deprecated for security use; collision attacks are practical.',
      'Base64 Encoded Key': 'Base64-encoded keys in source code are easily reversible; use secure key management.',
      'ECB Mode Encryption': 'ECB mode does not provide semantic security; patterns in plaintext are visible in ciphertext.',
      'Low PBKDF2 Iterations': 'PBKDF2 should use at least 100,000 iterations for password hashing.',
      // Exposure
      'Password in Logs': 'Logging passwords exposes sensitive credentials in log files.',
      'Hardcoded API Key': 'Hardcoded API keys should be stored in environment variables or secret managers.',
      'Permissive CORS': 'Allowing all origins (*) in CORS can expose APIs to cross-origin attacks.',
      // SSRF (A10)
      'Dynamic Fetch URL': 'Constructing fetch URLs from variables can allow attackers to access internal services.',
      'Dynamic Axios URL': 'Constructing Axios URLs from variables can allow Server-Side Request Forgery attacks.',
      'Dynamic HTTP Request': 'HTTP requests with dynamic URLs can be exploited for SSRF attacks.',
      'Dynamic HTTPS Request': 'HTTPS requests with dynamic URLs can be exploited for SSRF attacks.',
      'Dynamic Request Library URL': 'Request library calls with dynamic URLs are vulnerable to SSRF.',
      'Dynamic URL Construction': 'Creating URL objects from variables can lead to SSRF vulnerabilities.',
      'Dynamic Got URL': 'Got library calls with dynamic URLs can be exploited for SSRF.',
      'Dynamic Superagent URL': 'Superagent requests with dynamic URLs are vulnerable to SSRF.',
      'URL Resolution with User Input': 'Resolving URLs with user-controlled input enables SSRF attacks.',
      // Logging (A09)
      'Empty Catch Block': 'Empty catch blocks silently swallow errors, hiding potential security issues.',
      'Empty Promise Catch': 'Empty promise catch handlers suppress error information critical for debugging.',
      'Commented-Out Error Handling': 'Commented error handling suggests incomplete implementation.',
      'Silent Error Suppression': 'Returning silently on errors hides potential security-relevant failures.',
      'Ignored Promise Error': 'Ignoring promise errors prevents detection of security failures.',
      'Empty Error Event Handler': 'Empty error handlers prevent proper error logging and monitoring.',
      'Silent Uncaught Exception': 'Exiting with code 0 on uncaught exceptions hides critical failures.',
      // Headers (A05)
      'Default CORS Configuration': 'Default CORS may be overly permissive; configure allowed origins explicitly.',
      'Wildcard CORS Origin': 'Allowing all origins exposes the API to cross-origin attacks.',
      'X-Powered-By Disabled (Good)': 'Disabling X-Powered-By header is a good security practice.',
      'Insecure Cookie': 'Cookies without Secure flag can be transmitted over unencrypted connections.',
      'Non-HttpOnly Cookie': 'Cookies without HttpOnly flag are accessible to JavaScript (XSS risk).',
      'SameSite None Cookie': 'SameSite=None cookies can be sent in cross-site requests (CSRF risk).',
      'HTTP Without HTTPS': 'Running HTTP without HTTPS exposes data to interception.',
      // Components (A06)
      'Vulnerable Lodash Version': 'Older Lodash versions have known prototype pollution vulnerabilities.',
      'Vulnerable Axios Version': 'Older Axios versions have known SSRF and other vulnerabilities.',
      'Vulnerable Express Version': 'Older Express versions have known security vulnerabilities.',
      'Vulnerable Minimist Version': 'Older Minimist versions have prototype pollution vulnerabilities.',
      'Vulnerable Node-Fetch Version': 'Older node-fetch versions have known vulnerabilities.',
      'Vulnerable jQuery Version': 'Older jQuery versions have XSS and other vulnerabilities.',
      'Outdated Moment.js': 'Moment.js is in maintenance mode; consider alternatives like date-fns or Luxon.',
      'Dynamic Require Execution': 'Dynamic require with immediate execution can introduce untrusted code.',
    };

    return descriptions[title] || `Potential ${checkType} security issue detected: ${title}`;
  }

  /**
   * Get remediation guidance for a pattern.
   */
  private getRemediationForPattern(title: string, checkType: SecurityCheckType): string {
    const remediations: Record<string, string> = {
      // Injection
      'Eval Usage': 'Avoid eval() entirely. Use JSON.parse() for JSON data or proper parsers for other formats.',
      'Dynamic Function Creation': 'Use explicit function definitions or well-tested parsing libraries.',
      'InnerHTML Assignment': 'Use textContent for text, or sanitize HTML with a library like DOMPurify.',
      'SQL Injection Risk': 'Use parameterized queries or an ORM with proper escaping.',
      'Command Execution': 'Avoid shell commands with user input. If necessary, use allowlists and strict validation.',
      // Auth
      'Hardcoded Password Comparison': 'Store passwords hashed with bcrypt/argon2 and use secure comparison.',
      'Hardcoded JWT Secret': 'Move JWT secret to environment variable or secret manager.',
      // Crypto (A02)
      'Weak Hash Algorithm': 'Use SHA-256 or SHA-3 for integrity, bcrypt/argon2 for passwords.',
      'Math.random for Security': 'Use crypto.randomBytes() or crypto.randomUUID() for security-sensitive randomness.',
      'Non-Cryptographic Random': 'Use crypto.randomBytes() for tokens, crypto.randomUUID() for IDs.',
      'Deprecated Cipher API': 'Use crypto.createCipheriv() with a secure IV generation.',
      'Weak Encryption Algorithm': 'Use AES-256-GCM for symmetric encryption.',
      'Insufficient Random Bytes': 'Use at least 16 bytes (128 bits) for tokens and keys.',
      'MD5 Hash Usage': 'Replace MD5 with SHA-256 for integrity checks or bcrypt for passwords.',
      'SHA1 Hash Usage': 'Replace SHA1 with SHA-256 or SHA-3.',
      'Base64 Encoded Key': 'Use environment variables or a secret manager for encryption keys.',
      'ECB Mode Encryption': 'Use GCM or CBC mode with proper IV handling.',
      'Low PBKDF2 Iterations': 'Use at least 100,000 iterations for PBKDF2, or switch to Argon2.',
      // Exposure
      'Password in Logs': 'Never log sensitive data. Use structured logging with field filtering.',
      'Hardcoded API Key': 'Use environment variables: process.env.API_KEY or a secret manager.',
      'Permissive CORS': 'Specify allowed origins explicitly. Use a CORS library with proper configuration.',
      // SSRF (A10)
      'Dynamic Fetch URL': 'Validate and sanitize URLs against an allowlist of permitted hosts.',
      'Dynamic Axios URL': 'Use URL allowlists and reject private/internal IP ranges.',
      'Dynamic HTTP Request': 'Validate target URLs, block internal IPs (127.0.0.1, 10.x, 172.16.x, 192.168.x).',
      'Dynamic HTTPS Request': 'Implement URL validation with domain allowlists.',
      'Dynamic Request Library URL': 'Validate URLs and use an allowlist of permitted external hosts.',
      'Dynamic URL Construction': 'Validate URL components before construction; use URL parsing libraries.',
      'Dynamic Got URL': 'Use got\'s built-in timeout and retry limits; validate URLs against allowlist.',
      'Dynamic Superagent URL': 'Implement strict URL validation before making requests.',
      'URL Resolution with User Input': 'Never use user input directly in URL resolution; validate against allowlist.',
      // Logging (A09)
      'Empty Catch Block': 'Log errors with appropriate context: catch(e) { logger.error("Context:", e); }',
      'Empty Promise Catch': 'Add error logging: .catch(err => logger.error("Failed:", err))',
      'Commented-Out Error Handling': 'Implement proper error handling and logging.',
      'Silent Error Suppression': 'Log errors before returning; consider re-throwing critical errors.',
      'Ignored Promise Error': 'Log the error: .catch(err => logger.error(err))',
      'Empty Error Event Handler': 'Implement error logging in event handlers.',
      'Silent Uncaught Exception': 'Log the error and exit with non-zero code: process.exit(1)',
      // Headers (A05)
      'Default CORS Configuration': 'Configure CORS with specific origins: cors({ origin: ["https://trusted.com"] })',
      'Wildcard CORS Origin': 'Specify allowed origins explicitly instead of "*".',
      'X-Powered-By Disabled (Good)': 'This is a good practice; no action needed.',
      'Insecure Cookie': 'Set secure: true on cookies when using HTTPS.',
      'Non-HttpOnly Cookie': 'Set httpOnly: true to prevent XSS access to cookies.',
      'SameSite None Cookie': 'Use SameSite=Strict or SameSite=Lax unless cross-site is required.',
      'HTTP Without HTTPS': 'Use HTTPS in production; redirect HTTP to HTTPS.',
      // Components (A06)
      'Vulnerable Lodash Version': 'Update lodash to version 4.17.21 or later.',
      'Vulnerable Axios Version': 'Update axios to version 0.21.1 or later.',
      'Vulnerable Express Version': 'Update express to version 4.17.3 or later.',
      'Vulnerable Minimist Version': 'Update minimist to version 1.2.6 or later.',
      'Vulnerable Node-Fetch Version': 'Update node-fetch to version 2.6.7 or 3.x.',
      'Vulnerable jQuery Version': 'Update jQuery to version 3.5.0 or later.',
      'Outdated Moment.js': 'Consider migrating to date-fns, Luxon, or Day.js.',
      'Dynamic Require Execution': 'Avoid dynamic requires; use explicit imports with static analysis.',
    };

    return remediations[title] || `Review and fix the ${checkType} issue. Consult OWASP guidelines for best practices.`;
  }

  /**
   * Get confidence for a pattern match.
   */
  private getPatternConfidence(checkType: SecurityCheckType, title: string): number {
    // Very high confidence patterns (clear security issues)
    if ([
      'Eval Usage',
      'SQL Injection Risk',
      'Hardcoded Password Comparison',
      'Deprecated Cipher API',
      'ECB Mode Encryption',
      'Empty Catch Block',
      'Vulnerable Lodash Version',
      'Vulnerable Axios Version',
    ].includes(title)) {
      return 0.9;
    }

    // High confidence (likely issues)
    if ([
      'InnerHTML Assignment',
      'Weak Hash Algorithm',
      'Command Execution',
      'MD5 Hash Usage',
      'SHA1 Hash Usage',
      'Non-Cryptographic Random',
      'Weak Encryption Algorithm',
      'Insecure Cookie',
      'Non-HttpOnly Cookie',
      'Empty Promise Catch',
    ].includes(title)) {
      return 0.8;
    }

    // Medium confidence (context-dependent)
    if ([
      'Dynamic Fetch URL',
      'Dynamic Axios URL',
      'Dynamic URL Construction',
      'Silent Error Suppression',
      'Ignored Promise Error',
      'Low PBKDF2 Iterations',
    ].includes(title)) {
      return 0.7;
    }

    // Lower confidence (depends heavily on context)
    if ([
      'Environment Variable Usage',
      'Permissive CORS',
      'Default CORS Configuration',
      'X-Powered-By Disabled (Good)',
      'HTTP Without HTTPS',
      'Outdated Moment.js',
    ].includes(title)) {
      return 0.6;
    }

    // Default confidence by check type
    switch (checkType) {
      case 'injection':
        return 0.85;
      case 'ssrf':
        return 0.75;
      case 'crypto':
        return 0.8;
      case 'logging':
        return 0.7;
      case 'headers':
        return 0.65;
      case 'components':
        return 0.8;
      default:
        return 0.7;
    }
  }

  /**
   * Extract relevant code around a match.
   */
  private extractRelevantCode(code: string, matchIndex: number, contextSize: number): string {
    const start = Math.max(0, matchIndex - contextSize);
    const end = Math.min(code.length, matchIndex + contextSize);
    let snippet = code.substring(start, end);

    if (start > 0) snippet = '...' + snippet;
    if (end < code.length) snippet = snippet + '...';

    return snippet;
  }

  /**
   * Deduplicate findings.
   */
  private deduplicateFindings(findings: SecurityFinding[]): SecurityFinding[] {
    const seen = new Map<string, SecurityFinding>();

    for (const finding of findings) {
      const key = `${finding.file}:${finding.line}:${finding.title}`;
      const existing = seen.get(key);

      if (!existing || finding.confidence > existing.confidence) {
        seen.set(key, finding);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Compute severity breakdown.
   */
  private computeSeverityBreakdown(findings: SecurityFinding[]): SeverityBreakdown {
    return {
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length,
      info: findings.filter(f => f.severity === 'info').length,
    };
  }

  /**
   * Compute overall risk score.
   */
  private computeRiskScore(severity: SeverityBreakdown, fileCount: number): number {
    // Weighted severity scoring
    const severityWeight = {
      critical: 25,
      high: 10,
      medium: 4,
      low: 1,
      info: 0,
    };

    const totalPoints =
      severity.critical * severityWeight.critical +
      severity.high * severityWeight.high +
      severity.medium * severityWeight.medium +
      severity.low * severityWeight.low;

    // Normalize by file count (more files = lower impact per finding)
    const normalizedScore = totalPoints / Math.max(1, fileCount);

    // Scale to 0-100
    return Math.min(100, Math.round(normalizedScore * 10));
  }

  /**
   * Compute confidence in the audit results.
   */
  private computeConfidence(findings: SecurityFinding[], scope: AuditScope): ConfidenceValue {
    if (scope.files.length === 0) {
      return {
        type: 'absent' as const,
        reason: 'insufficient_data' as const,
      };
    }

    if (findings.length === 0) {
      // No findings could mean clean code or missed vulnerabilities
      return {
        type: 'bounded' as const,
        low: 0.4,
        high: 0.8,
        basis: 'theoretical' as const,
        citation: 'No findings detected; code may be secure or audit may have missed vulnerabilities',
      };
    }

    // Average confidence of findings
    const avgFindingConfidence = findings.reduce((sum, f) => sum + f.confidence, 0) / findings.length;

    // More check types = more comprehensive = higher confidence
    const coverageBonus = Math.min(0.1, scope.checkTypes.length * 0.025);

    const confidenceValue = Math.min(0.9, avgFindingConfidence + coverageBonus);

    return {
      type: 'measured' as const,
      value: confidenceValue,
      measurement: {
        datasetId: 'security_audit',
        sampleSize: scope.files.length,
        accuracy: avgFindingConfidence,
        confidenceInterval: [
          Math.max(0, confidenceValue - 0.15),
          Math.min(1, confidenceValue + 0.1),
        ] as const,
        measuredAt: new Date().toISOString(),
      },
    };
  }
}

// ============================================================================
// VERSION COMPARISON UTILITIES
// ============================================================================

/**
 * Parse a semver version string into components.
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  // Remove common prefixes like ^, ~, >=, etc.
  const cleaned = version.replace(/^[^0-9]*/, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Check if version A is below version B.
 */
function isVersionBelow(versionA: string, versionB: string): boolean {
  const a = parseVersion(versionA);
  const b = parseVersion(versionB);

  if (!a || !b) return false;

  if (a.major !== b.major) return a.major < b.major;
  if (a.minor !== b.minor) return a.minor < b.minor;
  return a.patch < b.patch;
}

// ============================================================================
// DEPENDENCY VULNERABILITY CHECKER
// ============================================================================

/**
 * Check package.json for vulnerable dependency versions.
 *
 * This function analyzes package.json dependencies against a database of
 * known vulnerable package versions. For production use, consider integrating
 * with npm audit or similar tools for comprehensive vulnerability scanning.
 *
 * @param packageJsonPath - Path to the package.json file
 * @returns Array of vulnerability findings
 */
export async function checkVulnerableDependencies(
  packageJsonPath: string
): Promise<VulnerabilityFinding[]> {
  const findings: VulnerabilityFinding[] = [];

  try {
    const content = await fs.promises.readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const [dep, version] of Object.entries(allDeps)) {
      const known = KNOWN_VULNERABLE_PACKAGES[dep];
      if (known && isVersionBelow(version as string, known.below)) {
        findings.push({
          package: dep,
          currentVersion: version as string,
          vulnerableBelow: known.below,
          cve: known.cve,
          severity: known.severity,
        });
      }
    }
  } catch {
    // File not found or parse error - return empty findings
  }

  return findings;
}

/**
 * Convert vulnerability findings to security findings.
 */
export function vulnerabilityToSecurityFindings(
  vulnerabilities: VulnerabilityFinding[],
  file: string
): SecurityFinding[] {
  return vulnerabilities.map((vuln) => ({
    type: 'components' as SecurityCheckType,
    severity: vuln.severity,
    file,
    title: `Vulnerable ${vuln.package} (${vuln.cve})`,
    description: `Package ${vuln.package}@${vuln.currentVersion} has known vulnerabilities. Versions below ${vuln.vulnerableBelow} are affected.`,
    cweId: 'CWE-1395',
    remediation: `Update ${vuln.package} to version ${vuln.vulnerableBelow} or later. Run: npm update ${vuln.package}`,
    confidence: 0.95,
  }));
}

// ============================================================================
// OWASP TOP 10 COVERAGE SUMMARY
// ============================================================================

/**
 * OWASP Top 10 2021 coverage in this security audit helper:
 *
 * A01 - Broken Access Control: AUTH_PATTERNS (auth bypass, direct user assignment)
 * A02 - Cryptographic Failures: CRYPTO_PATTERNS + WEAK_CRYPTO_PATTERNS
 * A03 - Injection: INJECTION_PATTERNS (SQL, command, XSS)
 * A04 - Insecure Design: Partially covered through pattern detection
 * A05 - Security Misconfiguration: MISSING_HEADERS_PATTERNS (CORS, cookies, headers)
 * A06 - Vulnerable Components: VULNERABLE_COMPONENT_PATTERNS + checkVulnerableDependencies
 * A07 - Auth Failures: AUTH_PATTERNS (hardcoded credentials, JWT secrets)
 * A08 - Software Integrity: Partially covered (dynamic require execution)
 * A09 - Security Logging Failures: LOGGING_PATTERNS (empty catch, silent errors)
 * A10 - SSRF: SSRF_PATTERNS (dynamic URLs, fetch, axios)
 */

// ============================================================================
// DEPENDENCY VULNERABILITY SCANNING
// ============================================================================

/**
 * Simple semver comparison to check if installed version is vulnerable.
 * Strips ^ ~ >= < prefixes and compares major.minor.patch.
 */
function isVersionVulnerable(installed: string, belowVersion: string): boolean {
  // Strip ^ ~ >= < prefixes and extract version numbers
  const clean = (v: string): number[] => {
    const match = v.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return [0, 0, 0];
    return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
  };

  const inst = clean(installed);
  const below = clean(belowVersion);

  for (let i = 0; i < 3; i++) {
    if ((inst[i] || 0) < (below[i] || 0)) return true;
    if ((inst[i] || 0) > (below[i] || 0)) return false;
  }
  return false;
}

/**
 * Fallback: Check against known vulnerable versions when npm audit is unavailable.
 */
async function checkKnownVulnerabilities(workspace: string): Promise<{
  vulnerabilities: DependencyVulnerability[];
  packagesScanned: number;
}> {
  const vulnerabilities: DependencyVulnerability[] = [];
  let packagesScanned = 0;

  try {
    const pkgPath = `${workspace}/package.json`;
    const content = await fs.promises.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    packagesScanned = Object.keys(allDeps).length;

    for (const [depName, version] of Object.entries(allDeps)) {
      const knownVulns = KNOWN_VULNERABILITIES[depName];
      if (knownVulns) {
        for (const vuln of knownVulns) {
          if (isVersionVulnerable(version as string, vuln.below)) {
            vulnerabilities.push({
              package: depName,
              severity: vuln.severity,
              title: `${vuln.cve}: ${vuln.title}`,
              url: `https://nvd.nist.gov/vuln/detail/${vuln.cve}`,
              fixAvailable: true,
              range: `<${vuln.below}`,
              via: [vuln.cve],
            });
          }
        }
      }
    }
  } catch {
    // Package.json not found or invalid
  }

  return { vulnerabilities, packagesScanned };
}

/**
 * Scan workspace dependencies for known vulnerabilities.
 * Tries npm audit first, falls back to known vulnerability database.
 */
export async function scanDependencyVulnerabilities(
  workspace: string
): Promise<DependencyScanResult> {
  const startTime = Date.now();
  const vulnerabilities: DependencyVulnerability[] = [];
  let source: 'npm_audit' | 'known_vulnerabilities' = 'npm_audit';
  let packagesScanned = 0;

  try {
    // Try npm audit --json
    const output = execSync('npm audit --json 2>/dev/null', {
      cwd: workspace,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const audit = JSON.parse(output);

    if (audit.vulnerabilities) {
      for (const [pkgName, vuln] of Object.entries(audit.vulnerabilities)) {
        const v = vuln as {
          severity?: string;
          name?: string;
          url?: string;
          fixAvailable?: boolean | { name: string; version: string };
          range?: string;
          via?: Array<string | { name?: string; title?: string; url?: string }>;
        };
        vulnerabilities.push({
          package: pkgName,
          severity: (v.severity as DependencyVulnerability['severity']) || 'moderate',
          title: v.name || pkgName,
          url: v.url,
          fixAvailable: !!v.fixAvailable,
          range: v.range || '*',
          via: Array.isArray(v.via)
            ? v.via.map((x) => (typeof x === 'string' ? x : x.name || 'unknown'))
            : [],
        });
      }
    }

    // Count packages from metadata
    if (audit.metadata?.dependencies) {
      packagesScanned = Object.values(audit.metadata.dependencies).reduce(
        (sum: number, count) => sum + (typeof count === 'number' ? count : 0),
        0
      );
    }
  } catch {
    // npm audit may fail if no package-lock.json exists
    // Fall back to manual known vulnerability check
    source = 'known_vulnerabilities';
    const known = await checkKnownVulnerabilities(workspace);
    vulnerabilities.push(...known.vulnerabilities);
    packagesScanned = known.packagesScanned;
  }

  return {
    vulnerabilities,
    source,
    scanTimeMs: Date.now() - startTime,
    packagesScanned,
  };
}

/**
 * Convert dependency vulnerabilities to security findings.
 */
function dependencyVulnerabilitiesToFindings(
  vulnerabilities: DependencyVulnerability[],
  workspace: string
): SecurityFinding[] {
  return vulnerabilities.map((vuln) => {
    // Map npm audit severity to our severity
    const severityMap: Record<DependencyVulnerability['severity'], SecurityFinding['severity']> = {
      critical: 'critical',
      high: 'high',
      moderate: 'medium',
      low: 'low',
    };

    return {
      type: 'components' as SecurityCheckType,
      severity: severityMap[vuln.severity],
      file: `${workspace}/package.json`,
      title: `Vulnerable dependency: ${vuln.package}`,
      description: `${vuln.title}. Vulnerable versions: ${vuln.range}. ${vuln.fixAvailable ? 'A fix is available.' : 'No fix available yet.'}`,
      cweId: 'CWE-1395',
      remediation: vuln.fixAvailable
        ? `Run 'npm audit fix' or update ${vuln.package} to a patched version.`
        : `Monitor for updates to ${vuln.package}. Consider using an alternative package.`,
      confidence: 0.95, // High confidence for npm audit results
      codeSnippet: vuln.via.length > 0 ? `Dependency chain: ${vuln.via.join(' -> ')}` : undefined,
    };
  });
}

// ============================================================================
// FACTORY
// ============================================================================

export function createSecurityAuditHelper(librarian: Librarian): SecurityAuditHelper {
  return new SecurityAuditHelper(librarian);
}
