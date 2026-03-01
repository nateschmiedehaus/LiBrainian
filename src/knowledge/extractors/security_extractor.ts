/**
 * @fileoverview Security Extractor
 *
 * Extracts security-related knowledge (questions 101-115):
 * - Vulnerabilities: CVE patterns, injection risks
 * - CWE: Common Weakness Enumeration categories
 * - OWASP: Top 10 risk identification
 * - Threat Model: attack surface, threat vectors
 * - Controls: input validation, auth, crypto
 * - Compliance: GDPR, HIPAA, SOC2 indicators
 * - Risk Score: CIA triad assessment
 *
 * Uses pattern matching for static analysis with configurable sensitivity.
 * Designed to integrate with existing ingest/security_indexer.ts data.
 */

import type {
  EntitySecurity,
  Vulnerability,
  CWEReference,
  OWASPReference,
  ThreatModel,
  SecurityControls,
  ComplianceRequirement,
  RiskScore,
  ThreatVector,
  RiskLevel,
  VulnerabilitySeverity,
  SensitiveDataType,
  ValidationControl,
  EncodingControl,
  AuthRequirement,
  AuthzRequirement,
  CryptoUsage,
} from '../universal_types.js';
import { resolveLlmServiceAdapter } from '../../adapters/llm_service.js';
import { resolveLibrarianModelId } from '../../api/llm_env.js';
import { buildLlmEvidence, type LlmEvidence } from './llm_evidence.js';

export interface SecurityExtraction {
  security: EntitySecurity;
  confidence: number;
  llmEvidence?: LlmEvidence;
}

export interface SecurityInput {
  name: string;
  content?: string;
  signature?: string;
  filePath: string;
  imports?: string[];
  docstring?: string;
}

// ============================================================================
// CWE PATTERNS - Common Weakness Enumeration
// Reference: https://cwe.mitre.org/
// ============================================================================

interface CWEPattern {
  id: string;
  name: string;
  pattern: RegExp;
  severity: VulnerabilitySeverity;
  owaspId?: string;
  remediation: string;
}

const CWE_PATTERNS: CWEPattern[] = [
  // Injection (CWE-89, CWE-78, CWE-94)
  {
    id: 'CWE-89',
    name: 'SQL Injection',
    pattern: /(?:execute|query|raw)\s*\(\s*[`'"].*\$\{|\.query\s*\([^)]*\+[^)]*\)|SELECT\s+.*\s+FROM\s+.*\s*\+|['"]SELECT\s+\*|db\.query\s*\(/i,
    severity: 'critical',
    owaspId: 'A03:2021',
    remediation: 'Use parameterized queries or prepared statements',
  },
  {
    id: 'CWE-78',
    name: 'OS Command Injection',
    pattern: /(?:exec|spawn|execSync|spawnSync)\s*\([^)]*\$\{|child_process.*\+/i,
    severity: 'critical',
    owaspId: 'A03:2021',
    remediation: 'Validate and sanitize all user input before shell execution',
  },
  {
    id: 'CWE-94',
    name: 'Code Injection',
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(|\bsetTimeout\s*\(\s*[^,]+[+]/i,
    severity: 'critical',
    owaspId: 'A03:2021',
    remediation: 'Never execute dynamic code from user input',
  },

  // XSS (CWE-79)
  {
    id: 'CWE-79',
    name: 'Cross-Site Scripting (XSS)',
    pattern: /innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(/i,
    severity: 'high',
    owaspId: 'A03:2021',
    remediation: 'Use textContent or proper HTML escaping, use CSP headers',
  },

  // Path Traversal (CWE-22)
  {
    id: 'CWE-22',
    name: 'Path Traversal',
    pattern: /path\.join\s*\([^)]*(?:req\.|input\.|params\.|query\.)|readFile[^(]*\([^)]*\+/i,
    severity: 'high',
    owaspId: 'A01:2021',
    remediation: 'Validate and sanitize file paths, use path.resolve with whitelist',
  },

  // Sensitive Data Exposure (CWE-200, CWE-312)
  {
    id: 'CWE-200',
    name: 'Exposure of Sensitive Information',
    pattern: /console\.log\s*\([^)]*(?:password|secret|token|api[_-]?key|credential)/i,
    severity: 'medium',
    owaspId: 'A02:2021',
    remediation: 'Never log sensitive data, use structured logging with redaction',
  },
  {
    id: 'CWE-312',
    name: 'Cleartext Storage of Sensitive Information',
    pattern: /localStorage\.setItem\s*\([^)]*(?:password|token|secret)|sessionStorage.*(?:password|token)/i,
    severity: 'high',
    owaspId: 'A02:2021',
    remediation: 'Use secure storage mechanisms with encryption',
  },

  // Hardcoded Credentials (CWE-798)
  {
    id: 'CWE-798',
    name: 'Hardcoded Credentials',
    pattern: /(?:password|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]{8,}['"]|Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/i,
    severity: 'critical',
    owaspId: 'A07:2021',
    remediation: 'Use environment variables or secure secret management',
  },

  // Insecure Randomness (CWE-330)
  {
    id: 'CWE-330',
    name: 'Insufficient Random Values',
    pattern: /Math\.random\s*\(\s*\)|Math\.floor\s*\(\s*Math\.random/i,
    severity: 'medium',
    owaspId: 'A02:2021',
    remediation: 'Use crypto.randomBytes or crypto.getRandomValues for security',
  },

  // Missing Authentication (CWE-306)
  {
    id: 'CWE-306',
    name: 'Missing Authentication for Critical Function',
    pattern: /app\.(post|put|delete|patch)\s*\([^)]+,\s*(?:async\s*)?\([^)]*\)\s*=>/i,
    severity: 'high',
    owaspId: 'A01:2021',
    remediation: 'Add authentication middleware to sensitive endpoints',
  },

  // Broken Access Control (CWE-862)
  {
    id: 'CWE-862',
    name: 'Missing Authorization',
    pattern: /req\.user\.id\s*(?:!==|!=|===|==)\s*(?:params|body|query)\./i,
    severity: 'high',
    owaspId: 'A01:2021',
    remediation: 'Implement proper authorization checks before resource access',
  },

  // SSRF (CWE-918)
  {
    id: 'CWE-918',
    name: 'Server-Side Request Forgery',
    pattern: /(?:fetch|axios|request|http\.get)\s*\(\s*(?:req\.|input\.|params\.|query\.|url|externalUrl)/i,
    severity: 'high',
    owaspId: 'A10:2021',
    remediation: 'Validate and whitelist URLs, block internal network access',
  },

  // Prototype Pollution (CWE-1321)
  {
    id: 'CWE-1321',
    name: 'Prototype Pollution',
    pattern: /Object\.assign\s*\(\s*\{\s*\}\s*,\s*(?:req\.|input\.)|(?:__proto__|constructor\.prototype)/i,
    severity: 'high',
    owaspId: 'A08:2021',
    remediation: 'Use Object.create(null) or validate object keys',
  },

  // Insecure Deserialization (CWE-502)
  {
    id: 'CWE-502',
    name: 'Deserialization of Untrusted Data',
    pattern: /JSON\.parse\s*\(\s*(?:req\.|input\.)|deserialize\s*\([^)]*user/i,
    severity: 'high',
    owaspId: 'A08:2021',
    remediation: 'Validate and sanitize input before deserialization',
  },

  // Weak Cryptography (CWE-327, CWE-328)
  {
    id: 'CWE-327',
    name: 'Weak Cryptographic Algorithm',
    pattern: /createHash\s*\(\s*['"](?:md5|sha1)['"]|DES|RC4|Blowfish/i,
    severity: 'medium',
    owaspId: 'A02:2021',
    remediation: 'Use SHA-256 or stronger, use AES-256 for encryption',
  },

  // Open Redirect (CWE-601)
  {
    id: 'CWE-601',
    name: 'Open Redirect',
    pattern: /res\.redirect\s*\(\s*(?:req\.|input\.|params\.|query\.)/i,
    severity: 'medium',
    owaspId: 'A01:2021',
    remediation: 'Validate redirect URLs against a whitelist',
  },

  // Regular Expression DoS (CWE-1333)
  {
    id: 'CWE-1333',
    name: 'Inefficient Regular Expression',
    pattern: /new\s+RegExp\s*\([^)]*\+|RegExp\s*\(\s*(?:req\.|input\.)/i,
    severity: 'medium',
    owaspId: 'A06:2021',
    remediation: 'Use static regexes or validate patterns for catastrophic backtracking',
  },

  // ============================================================================
  // T-27: ENHANCED SECURITY PATTERNS FOR HARD SCENARIOS
  // Additional OWASP Top 10 and taint tracking patterns
  // ============================================================================

  // XML External Entity (XXE) - CWE-611
  {
    id: 'CWE-611',
    name: 'XML External Entity (XXE)',
    pattern: /(?:parseString|parse|DOMParser|xml2js|xmldom).*(?:req\.|input\.|body\.)|XMLHttpRequest\s*\(/i,
    severity: 'high',
    owaspId: 'A03:2021',
    remediation: 'Disable external entity processing in XML parser configuration',
  },

  // LDAP Injection - CWE-90
  {
    id: 'CWE-90',
    name: 'LDAP Injection',
    pattern: /ldap(?:search|modify|add|bind|compare).*\$\{|\.filter\s*=.*\+/i,
    severity: 'critical',
    owaspId: 'A03:2021',
    remediation: 'Use parameterized LDAP queries and escape special characters',
  },

  // XPath Injection - CWE-643
  {
    id: 'CWE-643',
    name: 'XPath Injection',
    pattern: /xpath\.(?:select|evaluate).*\$\{|document\.evaluate.*\+/i,
    severity: 'high',
    owaspId: 'A03:2021',
    remediation: 'Use parameterized XPath queries',
  },

  // NoSQL Injection - CWE-943
  {
    id: 'CWE-943',
    name: 'NoSQL Injection',
    pattern: /\$(?:where|gt|gte|lt|lte|ne|in|nin|or|and|not|nor|regex).*req\.|find\s*\(\s*\{[^}]*\$|aggregate\s*\(\s*\[[^\]]*req\./i,
    severity: 'critical',
    owaspId: 'A03:2021',
    remediation: 'Use MongoDB sanitization libraries and avoid $where operator',
  },

  // Template Injection (SSTI) - CWE-1336
  {
    id: 'CWE-1336',
    name: 'Server-Side Template Injection',
    pattern: /render\s*\([^)]*\$\{|compile\s*\(\s*(?:req\.|input\.|body\.)|\.render\s*\(\s*(?:req\.|input\.)/i,
    severity: 'critical',
    owaspId: 'A03:2021',
    remediation: 'Never render user input as template code; use sandboxed templates',
  },

  // JWT Vulnerabilities - CWE-347
  {
    id: 'CWE-347',
    name: 'Improper Verification of Cryptographic Signature',
    pattern: /jwt\.(?:decode|verify)\s*\([^)]*\{\s*algorithms\s*:\s*\[.*none|algorithm.*=.*['"]none['"]/i,
    severity: 'critical',
    owaspId: 'A02:2021',
    remediation: 'Never allow "none" algorithm; always specify allowed algorithms explicitly',
  },

  // Insufficient Entropy - CWE-331
  {
    id: 'CWE-331',
    name: 'Insufficient Entropy',
    pattern: /Date\.now\s*\(\s*\)|new\s+Date\s*\(\s*\)\.getTime|process\.pid|Math\.random\s*\(\s*\).*(?:id|token|key|secret|session)/i,
    severity: 'high',
    owaspId: 'A02:2021',
    remediation: 'Use crypto.randomBytes() or uuid v4 for generating tokens',
  },

  // Race Condition (TOCTOU) - CWE-367
  {
    id: 'CWE-367',
    name: 'Time-of-check Time-of-use Race Condition',
    pattern: /(?:exists|access|stat)Sync?\s*\([^)]+\)[^}]*(?:read|write|unlink|mkdir)Sync?\s*\(/i,
    severity: 'medium',
    owaspId: 'A04:2021',
    remediation: 'Use atomic file operations or proper locking mechanisms',
  },

  // Information Exposure in Error Messages - CWE-209
  {
    id: 'CWE-209',
    name: 'Information Exposure Through Error Message',
    pattern: /res\.(?:send|json)\s*\(\s*(?:err|error)(?:\.message|\.stack)?|catch\s*\([^)]+\)\s*\{[^}]*res\.(?:send|json)\s*\([^)]*(?:err|error)/i,
    severity: 'medium',
    owaspId: 'A09:2021',
    remediation: 'Return generic error messages to clients; log detailed errors server-side',
  },

  // Mass Assignment - CWE-915
  {
    id: 'CWE-915',
    name: 'Improperly Controlled Modification of Object Attributes',
    pattern: /Object\.assign\s*\([^,]+,\s*req\.body|spread\s*\(\s*req\.body|\.\.\.\s*req\.body|\.update\s*\(\s*req\.body/i,
    severity: 'high',
    owaspId: 'A08:2021',
    remediation: 'Whitelist allowed properties instead of spreading entire request body',
  },

  // Unvalidated Redirect Target - CWE-601 (enhanced)
  {
    id: 'CWE-601-E',
    name: 'Host Header Injection',
    pattern: /req\.(?:headers\.host|get\s*\(\s*['"]host['"]\s*\)).*(?:redirect|url|href|location)/i,
    severity: 'high',
    owaspId: 'A01:2021',
    remediation: 'Never use host header for redirects; use a whitelist of allowed hosts',
  },

  // Clickjacking - CWE-1021
  {
    id: 'CWE-1021',
    name: 'Missing X-Frame-Options',
    pattern: /app\.(?:use|set)\s*\([^)]*(?!helmet|frameguard|x-frame)/i,
    severity: 'low',
    owaspId: 'A05:2021',
    remediation: 'Use helmet middleware or set X-Frame-Options header',
  },

  // Sensitive Cookie Without Secure Flag - CWE-614
  {
    id: 'CWE-614',
    name: 'Cookie Without Secure Flag',
    pattern: /cookie\s*\([^)]*(?:session|auth|token)[^)]*(?!secure\s*:\s*true)/i,
    severity: 'medium',
    owaspId: 'A02:2021',
    remediation: 'Set secure: true for sensitive cookies',
  },

  // Missing CSRF Protection - CWE-352
  {
    id: 'CWE-352',
    name: 'Cross-Site Request Forgery (CSRF)',
    pattern: /app\.(?:post|put|delete|patch)\s*\([^)]+(?!csrf|csurf|_csrf)/i,
    severity: 'medium',
    owaspId: 'A01:2021',
    remediation: 'Implement CSRF tokens using csurf middleware',
  },

  // Sensitive Data in URL - CWE-598
  {
    id: 'CWE-598',
    name: 'Sensitive Data in GET Parameters',
    pattern: /(?:password|token|secret|api[_-]?key|credential).*req\.(?:query|params)|\.get\s*\([^)]*:(?:password|token|secret)/i,
    severity: 'medium',
    owaspId: 'A02:2021',
    remediation: 'Use POST body or headers for sensitive data, not URL parameters',
  },

  // Insufficient Session Expiration - CWE-613
  {
    id: 'CWE-613',
    name: 'Insufficient Session Expiration',
    pattern: /(?:maxAge|expires)\s*:\s*(?:Infinity|\d{8,}|null|undefined)|session.*(?!maxAge|expires)/i,
    severity: 'medium',
    owaspId: 'A07:2021',
    remediation: 'Set reasonable session timeouts and implement idle timeout',
  },

  // HTTP Security Headers Missing - CWE-693
  {
    id: 'CWE-693',
    name: 'Missing Security Headers',
    pattern: /app\.(?:use|listen)\s*\([^)]*(?!helmet|cors\s*\(\s*\{)/i,
    severity: 'low',
    owaspId: 'A05:2021',
    remediation: 'Use helmet middleware to set security headers',
  },
];

// ============================================================================
// OWASP TOP 10 (2021)
// Reference: https://owasp.org/Top10/
// ============================================================================

interface OWASPCategory {
  id: string;
  name: string;
  indicators: RegExp[];
  description: string;
}

const OWASP_CATEGORIES: OWASPCategory[] = [
  {
    id: 'A01:2021',
    name: 'Broken Access Control',
    indicators: [
      /\.isAdmin|\.role\s*===|checkPermission|authorize|rbac/i,
      /bypass|escalat|privilege/i,
    ],
    description: 'Improper enforcement of access controls',
  },
  {
    id: 'A02:2021',
    name: 'Cryptographic Failures',
    indicators: [
      /crypto|encrypt|decrypt|hash|bcrypt|scrypt|argon|pbkdf/i,
      /ssl|tls|certificate|https/i,
    ],
    description: 'Failures related to cryptography or lack thereof',
  },
  {
    id: 'A03:2021',
    name: 'Injection',
    indicators: [
      /sql|query|execute|command|shell|eval/i,
      /sanitize|escape|parameterized/i,
    ],
    description: 'User-supplied data is not validated, filtered, or sanitized',
  },
  {
    id: 'A04:2021',
    name: 'Insecure Design',
    indicators: [
      /threat[_-]?model|security[_-]?review|abuse[_-]?case/i,
      /security[_-]?requirement/i,
    ],
    description: 'Missing or ineffective control design',
  },
  {
    id: 'A05:2021',
    name: 'Security Misconfiguration',
    indicators: [
      /cors|helmet|csp|hsts|x-frame|x-content/i,
      /config|setting|option/i,
    ],
    description: 'Missing appropriate security hardening',
  },
  {
    id: 'A06:2021',
    name: 'Vulnerable and Outdated Components',
    indicators: [
      /require\s*\(|import\s+.*from/i,
      /dependency|package|version/i,
    ],
    description: 'Using components with known vulnerabilities',
  },
  {
    id: 'A07:2021',
    name: 'Identification and Authentication Failures',
    indicators: [
      /login|logout|session|jwt|oauth|passport|auth/i,
      /password|credential|token/i,
    ],
    description: 'Incorrect user identity or session management',
  },
  {
    id: 'A08:2021',
    name: 'Software and Data Integrity Failures',
    indicators: [
      /deserialize|serialize|pickle|marshal|json\.parse/i,
      /integrity|checksum|signature/i,
    ],
    description: 'Code and infrastructure that does not protect against integrity violations',
  },
  {
    id: 'A09:2021',
    name: 'Security Logging and Monitoring Failures',
    indicators: [
      /log|audit|monitor|alert|trace|metric/i,
      /security[_-]?event|intrusion/i,
    ],
    description: 'Insufficient logging, detection, monitoring, and response',
  },
  {
    id: 'A10:2021',
    name: 'Server-Side Request Forgery',
    indicators: [
      /fetch|axios|request|http\.get|http\.post|url/i,
      /external|remote|webhook/i,
    ],
    description: 'Fetching remote resources without validating user-supplied URLs',
  },
];

// ============================================================================
// SENSITIVE DATA PATTERNS
// ============================================================================

interface SensitivePattern {
  type: SensitiveDataType;
  pattern: RegExp;
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  { type: 'pii', pattern: /(?:email|phone|address|name|ssn|social[_-]?security)/i },
  { type: 'phi', pattern: /(?:diagnosis|patient|health|medical|prescription)/i },
  { type: 'financial', pattern: /(?:credit[_-]?card|bank|account[_-]?number|routing)/i },
  { type: 'credentials', pattern: /(?:password|passwd|secret|private[_-]?key)/i },
  { type: 'api_keys', pattern: /(?:api[_-]?key|api[_-]?secret|access[_-]?key)/i },
  { type: 'tokens', pattern: /(?:auth[_-]?token|bearer|jwt|session[_-]?id|refresh[_-]?token)/i },
  { type: 'secrets', pattern: /(?:secret|private|confidential|internal[_-]?only)/i },
];

// ============================================================================
// MAIN EXTRACTOR
// ============================================================================

/**
 * Extract security-related knowledge from a code entity.
 */
export function extractSecurity(input: SecurityInput): SecurityExtraction {
  const content = input.content || '';
  const allText = `${input.name} ${content} ${input.signature || ''} ${input.docstring || ''}`;

  // Detect vulnerabilities using CWE patterns
  const vulnerabilities = detectVulnerabilities(content, input.filePath);

  // Map CWE patterns found
  const cwe = extractCWEReferences(vulnerabilities);

  // Identify OWASP categories relevant to this code
  const owasp = extractOWASPReferences(allText);

  // Build threat model
  const threatModel = buildThreatModel(input, allText);

  // Extract security controls
  const controls = extractSecurityControls(content, allText);

  // Check compliance indicators
  const compliance = extractComplianceRequirements(allText, input.filePath);

  // Calculate risk score
  const riskScore = calculateRiskScore(vulnerabilities, threatModel, controls);

  // Confidence based on what we found
  const hasContent = !!input.content;
  const hasFindings = vulnerabilities.length > 0 || cwe.length > 0;
  const hasControls = Object.values(controls).some(arr => arr.length > 0);
  const confidence = 0.3 + (hasContent ? 0.3 : 0) + (hasFindings ? 0.2 : 0) + (hasControls ? 0.2 : 0);

  return {
    security: {
      vulnerabilities,
      cwe,
      owasp,
      threatModel,
      controls,
      compliance,
      riskScore,
    },
    confidence,
  };
}

function detectVulnerabilities(content: string, filePath: string): Vulnerability[] {
  const vulnerabilities: Vulnerability[] = [];
  const seen = new Set<string>();

  // Standard CWE pattern detection
  for (const pattern of CWE_PATTERNS) {
    if (pattern.pattern.test(content)) {
      // Avoid duplicates
      if (seen.has(pattern.id)) continue;
      seen.add(pattern.id);

      vulnerabilities.push({
        id: pattern.id,
        severity: pattern.severity,
        description: pattern.name,
        remediation: pattern.remediation,
        cwe: pattern.id,
      });
    }
  }

  // T-27: Enhanced taint tracking for injection vulnerabilities
  const taintedFlows = detectTaintedFlows(content);
  for (const flow of taintedFlows) {
    const flowId = `TAINT-${flow.sink}`;
    if (!seen.has(flowId)) {
      seen.add(flowId);
      vulnerabilities.push({
        id: flowId,
        severity: flow.severity,
        description: `Tainted data flow: ${flow.source} -> ${flow.sink}`,
        remediation: flow.remediation,
        cwe: flow.cwe,
      });
    }
  }

  return vulnerabilities;
}

// ============================================================================
// T-27: TAINT TRACKING FOR INJECTION DETECTION
// Tracks data flow from tainted sources to sensitive sinks
// ============================================================================

interface TaintedFlow {
  source: string;
  sink: string;
  severity: VulnerabilitySeverity;
  cwe: string;
  remediation: string;
}

interface TaintSource {
  name: string;
  pattern: RegExp;
  description: string;
}

interface TaintSink {
  name: string;
  pattern: RegExp;
  severity: VulnerabilitySeverity;
  cwe: string;
  remediation: string;
}

const TAINT_SOURCES: TaintSource[] = [
  { name: 'req.body', pattern: /req\.body(?:\.\w+|\[['"][^'"]+['"]\])?/g, description: 'HTTP request body' },
  { name: 'req.query', pattern: /req\.query(?:\.\w+|\[['"][^'"]+['"]\])?/g, description: 'HTTP query parameters' },
  { name: 'req.params', pattern: /req\.params(?:\.\w+|\[['"][^'"]+['"]\])?/g, description: 'HTTP route parameters' },
  { name: 'req.headers', pattern: /req\.headers(?:\.\w+|\[['"][^'"]+['"]\])?/g, description: 'HTTP headers' },
  { name: 'req.cookies', pattern: /req\.cookies(?:\.\w+|\[['"][^'"]+['"]\])?/g, description: 'HTTP cookies' },
  { name: 'process.env', pattern: /process\.env(?:\.\w+|\[['"][^'"]+['"]\])?/g, description: 'Environment variables' },
  { name: 'user input', pattern: /(?:userInput|input|data|payload|userData|formData)(?:\.\w+|\[['"][^'"]+['"]\])?/g, description: 'User-controlled input' },
  { name: 'file content', pattern: /readFile(?:Sync)?\s*\([^)]+\)|fs\.read/g, description: 'File content' },
  { name: 'external API', pattern: /(?:fetch|axios|request|http\.get)\s*\([^)]+\)\.then|await\s+(?:fetch|axios)/g, description: 'External API response' },
];

const TAINT_SINKS: TaintSink[] = [
  {
    name: 'SQL query',
    pattern: /(?:query|execute|raw)\s*\(\s*[`'"]/,
    severity: 'critical',
    cwe: 'CWE-89',
    remediation: 'Use parameterized queries or ORM methods',
  },
  {
    name: 'shell command',
    pattern: /(?:exec|spawn|execSync|spawnSync)\s*\(/,
    severity: 'critical',
    cwe: 'CWE-78',
    remediation: 'Use allowlists and avoid shell interpretation',
  },
  {
    name: 'eval',
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    severity: 'critical',
    cwe: 'CWE-94',
    remediation: 'Never execute dynamic code from user input',
  },
  {
    name: 'HTML output',
    pattern: /innerHTML\s*=|\.html\s*\(|res\.send\s*\(/,
    severity: 'high',
    cwe: 'CWE-79',
    remediation: 'Use proper HTML encoding or templating with auto-escaping',
  },
  {
    name: 'file path',
    pattern: /(?:readFile|writeFile|createReadStream|createWriteStream|unlink|rmdir)\s*\(/,
    severity: 'high',
    cwe: 'CWE-22',
    remediation: 'Validate and sanitize file paths against directory traversal',
  },
  {
    name: 'redirect',
    pattern: /res\.redirect\s*\(|location\s*=|window\.location/,
    severity: 'medium',
    cwe: 'CWE-601',
    remediation: 'Validate redirect URLs against allowlist',
  },
  {
    name: 'LDAP query',
    pattern: /ldap(?:search|modify|bind)\s*\(/i,
    severity: 'critical',
    cwe: 'CWE-90',
    remediation: 'Escape LDAP special characters',
  },
  {
    name: 'XML parse',
    pattern: /(?:parseString|DOMParser|xml2js\.parse)/,
    severity: 'high',
    cwe: 'CWE-611',
    remediation: 'Disable external entity processing in XML parser',
  },
  {
    name: 'MongoDB query',
    pattern: /\.find\s*\(|\.findOne\s*\(|\.aggregate\s*\(/,
    severity: 'high',
    cwe: 'CWE-943',
    remediation: 'Sanitize MongoDB query operators',
  },
  {
    name: 'template render',
    pattern: /\.render\s*\(|\.compile\s*\(|ejs\.render|pug\.render|handlebars\.compile/,
    severity: 'critical',
    cwe: 'CWE-1336',
    remediation: 'Never pass user input as template string',
  },
  {
    name: 'header set',
    pattern: /res\.(?:set|header|setHeader)\s*\(/,
    severity: 'medium',
    cwe: 'CWE-113',
    remediation: 'Validate and encode header values',
  },
  {
    name: 'regex compile',
    pattern: /new\s+RegExp\s*\(/,
    severity: 'medium',
    cwe: 'CWE-1333',
    remediation: 'Validate regex patterns for ReDoS',
  },
];

function detectTaintedFlows(content: string): TaintedFlow[] {
  const flows: TaintedFlow[] = [];
  const lines = content.split('\n');

  // Build a map of tainted variables by tracking assignments
  const taintedVars = new Set<string>();

  // First pass: identify tainted sources and variables that receive tainted data
  for (const source of TAINT_SOURCES) {
    const matches = content.matchAll(source.pattern);
    for (const match of matches) {
      // Find the variable being assigned
      const lineIdx = content.substring(0, match.index).split('\n').length - 1;
      const line = lines[lineIdx] || '';

      // Check for assignment patterns: const x = req.body, let y = req.query, etc.
      const assignmentMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=|(\w+)\s*=/);
      if (assignmentMatch) {
        const varName = assignmentMatch[1] || assignmentMatch[2];
        if (varName) {
          taintedVars.add(varName);
        }
      }
    }
  }

  // Second pass: check if tainted variables reach sinks
  for (const sink of TAINT_SINKS) {
    const sinkMatches = content.matchAll(new RegExp(sink.pattern.source, 'g'));
    for (const sinkMatch of sinkMatches) {
      // Get the context around the sink (line containing it)
      const lineIdx = content.substring(0, sinkMatch.index).split('\n').length - 1;
      const line = lines[lineIdx] || '';

      // Check if any tainted source is directly used at this sink
      for (const source of TAINT_SOURCES) {
        if (source.pattern.test(line)) {
          flows.push({
            source: source.description,
            sink: sink.name,
            severity: sink.severity,
            cwe: sink.cwe,
            remediation: sink.remediation,
          });
          break;
        }
      }

      // Check if any tainted variable is used at this sink
      for (const taintedVar of taintedVars) {
        const varPattern = new RegExp(`\\b${taintedVar}\\b`);
        if (varPattern.test(line)) {
          flows.push({
            source: `tainted variable: ${taintedVar}`,
            sink: sink.name,
            severity: sink.severity,
            cwe: sink.cwe,
            remediation: sink.remediation,
          });
          break;
        }
      }
    }
  }

  // Deduplicate flows
  const uniqueFlows = new Map<string, TaintedFlow>();
  for (const flow of flows) {
    const key = `${flow.source}:${flow.sink}`;
    if (!uniqueFlows.has(key)) {
      uniqueFlows.set(key, flow);
    }
  }

  return Array.from(uniqueFlows.values());
}

function extractCWEReferences(vulnerabilities: Vulnerability[]): CWEReference[] {
  const cweRefs: CWEReference[] = [];
  const seen = new Set<string>();

  for (const vuln of vulnerabilities) {
    if (vuln.cwe && !seen.has(vuln.cwe)) {
      seen.add(vuln.cwe);
      const pattern = CWE_PATTERNS.find(p => p.id === vuln.cwe);
      cweRefs.push({
        id: vuln.cwe,
        name: pattern?.name || vuln.description,
        applicability: `Detected potential ${pattern?.name || vuln.cwe} vulnerability`,
      });
    }
  }

  return cweRefs;
}

function extractOWASPReferences(text: string): OWASPReference[] {
  const owaspRefs: OWASPReference[] = [];

  for (const category of OWASP_CATEGORIES) {
    const matches = category.indicators.filter(ind => ind.test(text));
    if (matches.length > 0) {
      owaspRefs.push({
        id: category.id,
        name: category.name,
        relevance: `Code contains ${matches.length} indicator(s) for ${category.name}`,
      });
    }
  }

  // Limit to most relevant
  return owaspRefs.slice(0, 5);
}

function buildThreatModel(input: SecurityInput, text: string): ThreatModel {
  const attackSurface = identifyAttackSurface(input, text);
  const threatVectors = identifyThreatVectors(text);
  const dataClassification = classifyData(text, input.filePath);
  const sensitiveData = identifySensitiveData(text);

  return {
    attackSurface,
    threatVectors,
    dataClassification,
    sensitiveData,
  };
}

function identifyAttackSurface(input: SecurityInput, text: string): string[] {
  const surface: string[] = [];

  // Check for common attack surfaces
  if (/req\.|request\.|params\.|query\.|body\./i.test(text)) {
    surface.push('HTTP Request Handler');
  }
  if (/websocket|socket\.io|ws\./i.test(text)) {
    surface.push('WebSocket Connection');
  }
  if (/stdin|readline|prompt/i.test(text)) {
    surface.push('CLI Input');
  }
  if (/file|fs\.|readFile|writeFile/i.test(text)) {
    surface.push('File System Access');
  }
  if (/database|sql|mongo|redis|postgres/i.test(text)) {
    surface.push('Database Access');
  }
  if (/fetch|axios|http\.|https\.|request/i.test(text)) {
    surface.push('External HTTP Calls');
  }
  if (/process\.env|config|setting/i.test(text)) {
    surface.push('Configuration');
  }
  if (/upload|multipart|formdata/i.test(text)) {
    surface.push('File Upload');
  }

  return surface;
}

function identifyThreatVectors(text: string): ThreatVector[] {
  const vectors: ThreatVector[] = [];

  // Check for common threat vectors
  if (/user|input|param|query/i.test(text)) {
    vectors.push({
      name: 'User Input',
      description: 'Malicious data from user-controlled sources',
      likelihood: /sanitize|validate|escape/i.test(text) ? 'low' : 'high',
      impact: 'high',
      mitigation: 'Input validation and sanitization',
    });
  }

  if (/auth|login|session/i.test(text)) {
    vectors.push({
      name: 'Authentication Bypass',
      description: 'Circumventing authentication mechanisms',
      likelihood: /jwt|oauth|mfa/i.test(text) ? 'low' : 'medium',
      impact: 'high',
      mitigation: 'Strong authentication with MFA',
    });
  }

  if (/admin|privilege|role/i.test(text)) {
    vectors.push({
      name: 'Privilege Escalation',
      description: 'Gaining unauthorized elevated access',
      likelihood: /rbac|checkPermission|authorize/i.test(text) ? 'low' : 'medium',
      impact: 'high',
      mitigation: 'Role-based access control',
    });
  }

  if (/external|remote|fetch|axios/i.test(text)) {
    vectors.push({
      name: 'External Service Compromise',
      description: 'Attacks via compromised external services',
      likelihood: 'medium',
      impact: 'medium',
      mitigation: 'Validate and sanitize external data',
    });
  }

  return vectors.slice(0, 5);
}

function classifyData(text: string, filePath: string): ThreatModel['dataClassification'] {
  // Check for indicators of data sensitivity
  if (/(?:password|secret|private|credential|pii|phi)/i.test(text)) {
    return 'confidential';
  }
  if (/(?:api|internal|admin|config)/i.test(filePath)) {
    return 'internal';
  }
  if (/(?:public|api\/public|static)/i.test(filePath)) {
    return 'public';
  }
  return 'internal';
}

function identifySensitiveData(text: string): SensitiveDataType[] {
  const found: SensitiveDataType[] = [];

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.pattern.test(text) && !found.includes(pattern.type)) {
      found.push(pattern.type);
    }
  }

  return found;
}

function extractSecurityControls(content: string, text: string): SecurityControls {
  const inputValidation = extractInputValidation(content);
  const outputEncoding = extractOutputEncoding(content);
  const authentication = extractAuthentication(text);
  const authorization = extractAuthorization(text);
  const cryptography = extractCryptography(content);

  return {
    inputValidation,
    outputEncoding,
    authentication,
    authorization,
    cryptography,
  };
}

function extractInputValidation(content: string): ValidationControl[] {
  const controls: ValidationControl[] = [];

  // Check for validation patterns
  if (/zod|yup|joi|validator|ajv/i.test(content)) {
    controls.push({
      input: 'Request data',
      validation: 'Schema validation library',
      sanitization: 'Type coercion and constraints',
    });
  }

  if (/sanitize|escape|htmlencode/i.test(content)) {
    controls.push({
      input: 'User input',
      validation: 'Sanitization function',
      sanitization: 'HTML/SQL escaping',
    });
  }

  if (/typeof|instanceof|isArray|isString/i.test(content)) {
    controls.push({
      input: 'Parameters',
      validation: 'Type checking',
    });
  }

  if (/regex|match|test\s*\(/i.test(content)) {
    controls.push({
      input: 'String input',
      validation: 'Regular expression',
    });
  }

  return controls;
}

function extractOutputEncoding(content: string): EncodingControl[] {
  const controls: EncodingControl[] = [];

  if (/encodeURIComponent|encodeURI/i.test(content)) {
    controls.push({
      output: 'URLs',
      encoding: 'URL encoding',
      context: 'URL parameters',
    });
  }

  if (/htmlEncode|escapeHtml|&lt;|&gt;/i.test(content)) {
    controls.push({
      output: 'HTML content',
      encoding: 'HTML entity encoding',
      context: 'DOM rendering',
    });
  }

  if (/JSON\.stringify/i.test(content)) {
    controls.push({
      output: 'Data structures',
      encoding: 'JSON serialization',
      context: 'API responses',
    });
  }

  return controls;
}

function extractAuthentication(text: string): AuthRequirement[] {
  const reqs: AuthRequirement[] = [];

  if (/jwt|jsonwebtoken/i.test(text)) {
    reqs.push({
      type: 'JWT',
      level: 'Token-based',
      mechanism: 'JSON Web Token verification',
    });
  }

  if (/oauth|passport/i.test(text)) {
    reqs.push({
      type: 'OAuth',
      level: 'Delegated',
      mechanism: 'OAuth 2.0 flow',
    });
  }

  if (/session|cookie/i.test(text)) {
    reqs.push({
      type: 'Session',
      level: 'Stateful',
      mechanism: 'Server-side session management',
    });
  }

  if (/basic[_-]?auth|authorization:\s*basic/i.test(text)) {
    reqs.push({
      type: 'Basic',
      level: 'HTTP Basic',
      mechanism: 'Username/password in header',
    });
  }

  if (/api[_-]?key/i.test(text)) {
    reqs.push({
      type: 'API Key',
      level: 'Key-based',
      mechanism: 'API key validation',
    });
  }

  return reqs;
}

function extractAuthorization(text: string): AuthzRequirement[] {
  const reqs: AuthzRequirement[] = [];

  if (/isAdmin|admin[_-]?role|role\s*===?\s*['"]admin/i.test(text)) {
    reqs.push({
      resource: 'Admin functions',
      permission: 'admin',
      roles: ['admin'],
    });
  }

  if (/owner|author|creator/i.test(text)) {
    reqs.push({
      resource: 'User resources',
      permission: 'owner',
      roles: ['owner', 'admin'],
    });
  }

  if (/permission|can|allow/i.test(text)) {
    reqs.push({
      resource: 'Protected resource',
      permission: 'specific',
      roles: ['authorized'],
    });
  }

  return reqs;
}

function extractCryptography(content: string): CryptoUsage[] {
  const usage: CryptoUsage[] = [];

  if (/createHash|hash\(/i.test(content)) {
    const algo = content.match(/createHash\s*\(\s*['"](\w+)['"]/)?.[1] || 'unknown';
    usage.push({
      purpose: 'Hashing',
      algorithm: algo.toUpperCase(),
      keyManagement: 'N/A for hashing',
    });
  }

  if (/createCipheriv|encrypt/i.test(content)) {
    usage.push({
      purpose: 'Encryption',
      algorithm: 'AES (presumed)',
      keyManagement: 'Check key derivation',
    });
  }

  if (/bcrypt|scrypt|argon|pbkdf/i.test(content)) {
    usage.push({
      purpose: 'Password hashing',
      algorithm: 'Adaptive hashing',
      keyManagement: 'Salt-based',
    });
  }

  if (/sign|verify|rsa|ecdsa/i.test(content)) {
    usage.push({
      purpose: 'Digital signatures',
      algorithm: 'Asymmetric',
      keyManagement: 'Public/private key pair',
    });
  }

  return usage;
}

function extractComplianceRequirements(text: string, filePath: string): ComplianceRequirement[] {
  const reqs: ComplianceRequirement[] = [];

  // GDPR indicators
  if (/gdpr|personal[_-]?data|consent|right[_-]?to[_-]?delete|data[_-]?subject/i.test(text)) {
    reqs.push({
      standard: 'GDPR',
      requirement: 'Personal data handling',
      status: 'not_applicable', // Would need deeper analysis
    });
  }

  // HIPAA indicators
  if (/hipaa|phi|protected[_-]?health|medical[_-]?record/i.test(text)) {
    reqs.push({
      standard: 'HIPAA',
      requirement: 'Protected health information',
      status: 'not_applicable',
    });
  }

  // PCI-DSS indicators
  if (/pci|credit[_-]?card|payment|cardholder/i.test(text)) {
    reqs.push({
      standard: 'PCI-DSS',
      requirement: 'Payment card data protection',
      status: 'not_applicable',
    });
  }

  // SOC 2 indicators
  if (/soc[_-]?2|audit[_-]?log|access[_-]?control|availability/i.test(text)) {
    reqs.push({
      standard: 'SOC 2',
      requirement: 'Trust service criteria',
      status: 'not_applicable',
    });
  }

  return reqs;
}

function calculateRiskScore(
  vulnerabilities: Vulnerability[],
  threatModel: ThreatModel,
  controls: SecurityControls
): RiskScore {
  // Calculate base risk from vulnerabilities
  let vulnScore = 0;
  for (const vuln of vulnerabilities) {
    switch (vuln.severity) {
      case 'critical': vulnScore += 3; break;
      case 'high': vulnScore += 2; break;
      case 'medium': vulnScore += 1; break;
      case 'low': vulnScore += 0.5; break;
    }
  }

  // Factor in threat model
  const threatScore = threatModel.threatVectors.reduce((acc, v) => {
    const likelihood = v.likelihood === 'high' ? 3 : v.likelihood === 'medium' ? 2 : 1;
    const impact = v.impact === 'high' ? 3 : v.impact === 'medium' ? 2 : 1;
    return acc + (likelihood * impact) / 3;
  }, 0);

  // Factor in controls as mitigation
  const controlCount =
    controls.inputValidation.length +
    controls.outputEncoding.length +
    controls.authentication.length +
    controls.authorization.length +
    controls.cryptography.length;

  // Non-zero baseline so "analyzed, no attack surface" is distinguishable from null/unanalyzed.
  if (vulnerabilities.length === 0 && threatModel.threatVectors.length === 0 && controlCount === 0) {
    return {
      overall: 0.1,
      confidentiality: 0.1,
      integrity: 0.1,
      availability: 0.1,
    };
  }

  const mitigationFactor = Math.max(0.5, 1 - (controlCount * 0.1));

  // Calculate CIA impact based on sensitive data
  const hasSensitive = threatModel.sensitiveData.length > 0;
  const isConfidential = threatModel.dataClassification === 'confidential';

  // Overall risk on 0-10 scale
  const rawRisk = (vulnScore + threatScore) * mitigationFactor;
  const overall = Math.min(10, Math.round(rawRisk * 10) / 10);

  // CIA breakdown
  const confidentiality = hasSensitive || isConfidential
    ? Math.min(10, overall * 1.2)
    : overall * 0.8;
  const integrity = vulnerabilities.some(v => v.cwe === 'CWE-89' || v.cwe === 'CWE-94')
    ? Math.min(10, overall * 1.3)
    : overall;
  const availability = threatModel.attackSurface.includes('Database Access')
    ? Math.min(10, overall * 1.1)
    : overall * 0.9;

  return {
    overall,
    confidentiality: Math.round(confidentiality * 10) / 10,
    integrity: Math.round(integrity * 10) / 10,
    availability: Math.round(availability * 10) / 10,
  };
}

/**
 * Extract security with LLM enhancement (optional).
 * Uses LLM to provide deeper security analysis when available.
 */
export async function extractSecurityWithLLM(
  input: SecurityInput,
  config: { llmProvider: 'claude' | 'codex'; llmModelId?: string; governor?: import('../../api/governor_context.js').GovernorContext }
): Promise<SecurityExtraction> {
  // First get static analysis results
  const staticResult = extractSecurity(input);

  try {
    const llmService = resolveLlmServiceAdapter();

    const prompt = buildSecurityPrompt(input, staticResult);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: SECURITY_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];

    const modelId = config.llmModelId
      || resolveLibrarianModelId(config.llmProvider)
      || 'claude-haiku-4-5-20241022';
    const llmEvidence = await buildLlmEvidence({
      provider: config.llmProvider,
      modelId,
      messages,
    });

    const response = await llmService.chat({
      provider: config.llmProvider,
      modelId,
      messages,
      maxTokens: 1000,
      governorContext: config.governor,
    });

    // Parse LLM response and merge with static results
    const enhanced = parseSecurityResponse(response.content, staticResult);
    return { ...enhanced, llmEvidence };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const prefix = message.includes('unverified_by_trace')
      ? message
      : `unverified_by_trace(security_extraction_failed): ${message}`;
    throw new Error(prefix);
  }
}

const SECURITY_SYSTEM_PROMPT = `You are a security analyst. Analyze code for security issues.
Return JSON with:
{
  "additionalVulnerabilities": [{"id": "CWE-XXX", "description": "..."}],
  "threatInsights": ["..."],
  "recommendations": ["..."]
}
Be specific about risks and mitigations.`;

function buildSecurityPrompt(input: SecurityInput, staticResult: SecurityExtraction): string {
  const riskText = staticResult.security.riskScore
    ? `${staticResult.security.riskScore.overall}/10`
    : 'not analyzed';
  return `Analyze this code for security issues:

File: ${input.filePath}
Function: ${input.name}

Code:
\`\`\`
${(input.content || '').slice(0, 2000)}
\`\`\`

Static analysis found:
- Vulnerabilities: ${staticResult.security.vulnerabilities.map(v => v.id).join(', ') || 'none'}
- Attack surface: ${staticResult.security.threatModel.attackSurface.join(', ') || 'none'}
- Risk score: ${riskText}

Identify any additional security concerns I may have missed.`;
}

function parseSecurityResponse(
  response: string,
  staticResult: SecurityExtraction
): SecurityExtraction {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(
      'security_extractor: llm response contained no JSON, returning static security analysis result',
    );
    return staticResult;
  }

  let parsed: { additionalVulnerabilities?: Array<{ id?: string; description?: string }>; threatInsights?: string[]; recommendations?: string[] };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (parseError) {
    console.warn(
      `security_extractor: failed to parse llm JSON (${parseError instanceof Error ? parseError.message : String(parseError)}), returning static security analysis result`,
    );
    return staticResult;
  }

  // Merge additional vulnerabilities
  const additionalVulns = (parsed.additionalVulnerabilities || []).map((v) => ({
    id: v.id || 'LLM-DETECTED',
    severity: 'medium' as VulnerabilitySeverity,
    description: v.description || 'LLM-detected issue',
  }));

  return {
    security: {
      ...staticResult.security,
      vulnerabilities: [...staticResult.security.vulnerabilities, ...additionalVulns],
    },
    confidence: staticResult.confidence + 0.1,
  };
}
