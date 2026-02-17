# Track E: Universal Domain Support (D1-D11)

> **Source**: Extracted from `docs/LiBrainian/THEORETICAL_CRITIQUE.md`
> **Guarantee**: LiBrainian will support ANY software domain through composable primitives based on fundamental computational aspects.
>
> **LiBrainian Story**: This is Chapter 6 - The Universality. It depends on Chapter 5 (Honesty/Quantification).
>
> **Theory Reference**: All confidence values MUST use `ConfidenceValue` from Track D. See [GLOSSARY.md](./GLOSSARY.md) and [CONFIDENCE_REDESIGN.md](./CONFIDENCE_REDESIGN.md).

---

## CRITICAL: Principled Confidence (No Arbitrary Values)

**All confidence values MUST use `ConfidenceValue` type - raw numbers and any “labeled guess” wrappers are FORBIDDEN.**

```typescript
// FORBIDDEN - arbitrary number
confidence: 0.7

// CORRECT - honest about uncertainty
confidence: {
  type: 'absent',
  reason: 'uncalibrated'
}

// CORRECT - syntactic operation with known confidence
confidence: {
  type: 'deterministic',
  value: 1.0,
  reason: 'ast_parse_success'
}

// CORRECT - after calibration with real data
confidence: {
  type: 'measured',
  value: 0.73,
  measurement: {
    datasetId: 'librarian_v1_domain_calibration',
    sampleSize: 500,
    accuracy: 0.73,
    confidenceInterval: [0.69, 0.77],
    measuredAt: '2026-01-22'
  }
}
```

**Why**: “labeled guess” confidence was documentation theater — a labeled guess is still a guess. The `ConfidenceValue` type forces either honest uncertainty (`absent`) or real provenance (`measured`, `derived`, `deterministic`, `bounded`).

---

## Overview

Track E ensures LiBrainian achieves **universal domain coverage** - the ability to analyze and understand ANY software domain, not just traditional development scenarios.

| Priority | Feature | Part Reference | LOC | Dependencies | Status |
|----------|---------|----------------|-----|--------------|--------|
| **D1** | 14 Core Domain Primitives | XIX | ~350 | Q1-Q4 | ⚠️ Spec only (uses wrong confidence type) |
| **D2** | 10 World-Class Compositions | XIX | ~500 | D1 | ⚠️ Spec only |
| **D3** | Security Audit Primitives | XIX | ~200 | D1 | ⚠️ Spec only |
| **D4** | Performance Investigation Primitives | XIX | ~200 | D1 | ⚠️ Spec only |
| **D5** | API Design Review Primitives | XIX | ~150 | D1 | ⚠️ Spec only |
| **D6** | Dependency Upgrade Primitives | XIX | ~150 | D1 | ⚠️ Spec only |
| **D7** | Documentation Generation Primitives | XIX | ~150 | D1 | ⚠️ Spec only |
| **D8** | Technical Debt Assessment Primitives | XIX | ~150 | D1 | ⚠️ Spec only |
| **D9** | Architecture Decision Primitives | XIX | ~150 | D1 | ⚠️ Spec only |
| **D10** | Legacy Code Analysis Primitives | XIX | ~150 | D1 | ⚠️ Spec only |
| **D11** | Compliance Checking Primitives | XIX | ~150 | D1 | ⚠️ Spec only |

**HONEST STATUS**: Prior "Implemented" labels were lies. The spec exists, but code uses raw `confidence: 0.7` values which violate the principled confidence system. Implementation requires migration to `ConfidenceValue` type.

**Total LOC for universal domain support: ~2,100**

---

## Theoretical Foundation: 9 Fundamental Computational Aspects

> **Turing**: "The question is not whether we can enumerate all domains, but whether our primitives cover all FUNDAMENTAL computational concerns."

Every software system, regardless of domain, must handle these 9 fundamental aspects:

```
+---------------------------------------------------------------------------+
|                    FUNDAMENTAL COMPUTATION ASPECTS                         |
|                                                                           |
|  Every software system, regardless of domain, must handle:                |
|                                                                           |
|  1. DATA      - Where does data come from, go to, transform?              |
|                 Primitives: tp_data_lineage, tp_artifact_trace            |
|                                                                           |
|  2. STATE     - What are the possible states and transitions?             |
|                 Primitives: tp_state_trace                                |
|                                                                           |
|  3. TIME      - What are timing constraints and sequences?                |
|                 Primitives: tp_timing_bound, tp_realtime_flow             |
|                                                                           |
|  4. SPACE     - Where does execution happen? What's the topology?         |
|                 Primitives: tp_platform_map, tp_distribution_map          |
|                                                                           |
|  5. LOGIC     - What rules/policies govern behavior?                      |
|                 Primitives: tp_policy_verify, tp_algorithm_trace          |
|                                                                           |
|  6. STRUCTURE - How are components organized and composed?                |
|                 Primitives: tp_component_graph, tp_scale_pattern          |
|                                                                           |
|  7. VALUE     - What metrics/outcomes matter?                             |
|                 Primitives: tp_metric_trace                               |
|                                                                           |
|  8. AGENCY    - What tools/agents act on the system?                      |
|                 Primitives: tp_tool_orchestration                         |
|                                                                           |
|  9. MEDIA     - What content/assets flow through?                         |
|                 Primitives: tp_media_pipeline                             |
|                                                                           |
+---------------------------------------------------------------------------+
```

---

## The Completeness Claim

**Claim**: The 14 primitives are **complete** for any conceivable software domain because they correspond to the fundamental aspects of computation and information.

**Proof sketch**:
1. Every domain D involves some combination of: data manipulation, state management, timing concerns, spatial distribution, business logic, structural organization, value measurement, external agency, and media handling.
2. Each of these concerns maps to one or more of the 9 fundamental aspects above.
3. Each fundamental aspect is covered by one or more primitives.
4. Therefore, any domain D can be analyzed by selecting the relevant primitives and composing them.

**Self-Critique (Pearl)**: "This is not a formal proof. How do we know we haven't missed a fundamental aspect?"

**Response (McCarthy)**: "We can't prove completeness formally, but we CAN test it empirically. For any new domain X that seems unsupported, we ask: which fundamental aspect is missing? If we find one, we add a primitive. If we don't, X is already supported."

**The Guarantee**: For any domain D:
1. If D can be fully supported by existing primitives, LiBrainian provides that support.
2. If D reveals a missing fundamental aspect, that aspect becomes a new primitive.
3. The protocol provides the construction method.
4. No domain is unsupportable - at worst, we learn what's missing.

---

## D1: 14 Domain Primitives

### The 7 Existing Primitives

These primitives were originally designed for traditional development:

1. **tp_artifact_trace** - Link non-code artifacts to code
2. **tp_data_lineage** - Track data transformations
3. **tp_policy_verify** - Verify code against policies/regulations
4. **tp_platform_map** - Map code to deployment targets
5. **tp_metric_trace** - Link code to business/user metrics
6. **tp_timing_bound** - Analyze timing/latency constraints
7. **tp_state_trace** - Trace state machine transitions

### The 7 New Domain Primitives (D1)

These primitives extend coverage to world-class application domains:

1. **tp_algorithm_trace** - Feed ranking, recommendations, search
2. **tp_component_graph** - UI composition, widget structure
3. **tp_scale_pattern** - Sharding, replication, HA patterns
4. **tp_realtime_flow** - Live updates, event streams
5. **tp_media_pipeline** - Transcoding, CDN, assets
6. **tp_tool_orchestration** - Tool coordination, MCP, LSP
7. **tp_distribution_map** - Edge, CDN, geographic distribution

### Primitive Definitions

```typescript
/**
 * Domain-bridging primitives for universal applicability.
 * Each primitive addresses a common underlying need across multiple domains.
 */

// tp_artifact_trace: Link non-code artifacts to code
// Supports: Design (tokens <-> components), Game (assets <-> shaders),
//           IoT (configs <-> firmware), Content (CMS <-> renderers)
export const tp_artifact_trace: TechniquePrimitive = {
  id: 'tp_artifact_trace',
  name: 'Artifact-Code Tracing',
  description: 'Trace relationships between non-code artifacts and code entities',
  inputs: [{ name: 'artifactPath', type: 'string' }, { name: 'artifactType', type: 'string' }],
  outputs: [{ name: 'linkedEntities', type: 'EntityId[]' }, { name: 'relationshipType', type: 'string' }],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Honest: no calibration data yet
  tier: 3,  // Requires semantic understanding
};

// tp_data_lineage: Track data transformations
// Supports: Data Pipeline (source -> warehouse), ML (training -> predictions),
//           CMS (content -> display), E-commerce (inventory -> checkout)
export const tp_data_lineage: TechniquePrimitive = {
  id: 'tp_data_lineage',
  name: 'Data Lineage Tracing',
  description: 'Track how data transforms as it flows through the system',
  inputs: [{ name: 'dataSource', type: 'string' }, { name: 'dataType', type: 'string' }],
  outputs: [{ name: 'transformations', type: 'Transform[]' }, { name: 'sinks', type: 'EntityId[]' }],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Honest: no calibration data yet
  tier: 3,
};

// tp_policy_verify: Verify code against policies/regulations
// Supports: Healthcare (HIPAA), Financial (SOX), Compliance (GDPR)
export const tp_policy_verify: TechniquePrimitive = {
  id: 'tp_policy_verify',
  name: 'Policy Verification',
  description: 'Verify code compliance with regulatory or policy requirements',
  inputs: [{ name: 'policyId', type: 'string' }, { name: 'scope', type: 'EntityId[]' }],
  outputs: [{ name: 'violations', type: 'Violation[]' }, { name: 'evidence', type: 'Evidence[]' }],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Honest: regulatory verification needs calibration
  tier: 3,
};

// tp_platform_map: Map code to deployment targets
// Supports: Mobile (iOS vs Android), Embedded (device classes), IoT (edge vs cloud)
export const tp_platform_map: TechniquePrimitive = {
  id: 'tp_platform_map',
  name: 'Platform Mapping',
  description: 'Map code paths to their deployment platforms and constraints',
  inputs: [{ name: 'entityId', type: 'EntityId' }],
  outputs: [{ name: 'platforms', type: 'Platform[]' }, { name: 'constraints', type: 'Constraint[]' }],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Honest: needs calibration from build config analysis
  tier: 2,
};

// tp_metric_trace: Link code to business/user metrics
// Supports: E-commerce (conversion), Social (engagement), Education (learning objectives)
export const tp_metric_trace: TechniquePrimitive = {
  id: 'tp_metric_trace',
  name: 'Metric Tracing',
  description: 'Trace code paths that affect specific business or user metrics',
  inputs: [{ name: 'metricName', type: 'string' }],
  outputs: [{ name: 'affectingEntities', type: 'EntityId[]' }, { name: 'impactEstimate', type: 'number' }],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Honest: metric attribution needs calibration
  tier: 3,
};

// tp_timing_bound: Analyze timing/latency constraints
// Supports: Real-time systems, Embedded, Game (frame budgets)
export const tp_timing_bound: TechniquePrimitive = {
  id: 'tp_timing_bound',
  name: 'Timing Bound Analysis',
  description: 'Analyze worst-case timing bounds for code paths',
  inputs: [{ name: 'entryPoint', type: 'EntityId' }, { name: 'budgetMs', type: 'number' }],
  outputs: [{ name: 'worstCaseMs', type: 'number' }, { name: 'bottlenecks', type: 'EntityId[]' }],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Honest: requires profiling data for calibration
  tier: 2,
};

// tp_state_trace: Trace state machine transitions
// Supports: Blockchain (state changes), Workflow (process flows), Customer Service (ticket flows)
export const tp_state_trace: TechniquePrimitive = {
  id: 'tp_state_trace',
  name: 'State Transition Tracing',
  description: 'Trace state machine transitions and their triggering code',
  inputs: [{ name: 'stateType', type: 'string' }],
  outputs: [{ name: 'states', type: 'State[]' }, { name: 'transitions', type: 'Transition[]' }],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Honest: no calibration data yet
  tier: 3,
};
```

### Primitive-to-Aspect Mapping

| Underlying Need | Domains Requiring It | Primitive |
|-----------------|---------------------|-----------|
| **Artifact-code linking** | Design, Game, IoT, Content | `tp_artifact_trace` |
| **Data flow analysis** | Data Pipeline, ML, CMS, E-commerce, Dashboards | `tp_data_lineage` |
| **Compliance checking** | Healthcare, Financial, Compliance, Payments | `tp_policy_verify` |
| **Cross-platform tracing** | Mobile, Embedded, IoT, CDN | `tp_platform_map` |
| **Business metric mapping** | E-commerce, Social, Education, Landing Pages | `tp_metric_trace` |
| **Timing analysis** | Real-time, Embedded, Game, HA Systems | `tp_timing_bound` |
| **State machine analysis** | Blockchain, Workflow, Customer Service, Payments | `tp_state_trace` |
| **Algorithm tracing** | Social feeds, Recommendations, Search, Video | `tp_algorithm_trace` |
| **Component composition** | Landing Pages, Dashboards, UI Systems | `tp_component_graph` |
| **Scale pattern detection** | Industrial backends, HA, Microservices | `tp_scale_pattern` |
| **Real-time flow analysis** | Notifications, Dashboards, Social, Chat | `tp_realtime_flow` |
| **Media pipeline tracing** | Video, Social, Content, Gaming | `tp_media_pipeline` |
| **Tool orchestration** | Developer tools, Automation, CI/CD | `tp_tool_orchestration` |
| **Distribution analysis** | CDN, Edge, Sharding, Replication | `tp_distribution_map` |

**Self-Critique (Wirth)**: "14 primitives for 40 domains? Is this actually manageable?"

**Response (Thompson)**: "14 primitives that COMPOSE is far simpler than 40 domain modules. The math: 14 primitives can form C(14,3) = 364 unique 3-primitive combinations. That's more than enough for any domain."

---

## D2: 10 World-Class Compositions

> **Kay**: "The power is not in the primitives alone, but in how they compose."

### Composition Registry

| Composition | Primary Domains | Core Primitives | Patterns |
|-------------|-----------------|-----------------|----------|
| `tc_social_platform` | Instagram, Facebook, Reddit, Twitter | algorithm, policy, metric, realtime | feature, performance |
| `tc_video_platform` | YouTube, TikTok, Twitch | media, algorithm, distribution | performance, verification |
| `tc_industrial_backend` | Scale systems, HA, Microservices | scale, distribution, timing, state | performance, refactoring |
| `tc_developer_tool` | Claude Code, Codex, Copilot | tool_orchestration, data_lineage | feature, bug |
| `tc_dashboard` | B2B SaaS, Analytics, Admin panels | component, data_lineage, realtime | feature, verification |
| `tc_landing_page` | Marketing sites, Conversion pages | component, metric, artifact | performance, verification |
| `tc_payment_system` | Stripe, Payment processing | state, policy, data_lineage | verification, bug |
| `tc_e_commerce` | Shopify, Amazon-style | metric, state, data_lineage | feature, performance |
| `tc_search_system` | Algolia, Elasticsearch apps | algorithm, data_lineage, timing | performance, feature |
| `tc_notification` | Push, Email, In-app alerts | realtime, state, distribution | feature, bug |

### Composition Definitions

```typescript
// ============================================================================
// COMPOSITION: SOCIAL PLATFORM (Instagram/Facebook/Reddit)
// ============================================================================
const tc_social_platform: TechniqueComposition = {
  id: 'tc_social_platform',
  name: 'Social Platform Analysis',
  description: 'Understand and modify social platform codebases',
  primitives: [
    'tp_algorithm_trace',    // Feed ranking, content ordering
    'tp_policy_verify',      // Content moderation rules
    'tp_metric_trace',       // Engagement metrics
    'tp_realtime_flow',      // Live updates, notifications
    'tp_state_trace',        // User state, content lifecycle
    'tp_data_lineage',       // Data flow from creation to display
  ],
  operators: [
    { type: 'parallel', inputs: ['tp_algorithm_trace', 'tp_policy_verify'] },
    { type: 'sequence', inputs: ['tp_metric_trace', 'tp_realtime_flow'] },
  ],
  patterns: ['pattern_feature_construction', 'pattern_performance_investigation'],
};

// ============================================================================
// COMPOSITION: VIDEO PLATFORM (YouTube)
// ============================================================================
const tc_video_platform: TechniqueComposition = {
  id: 'tc_video_platform',
  name: 'Video Platform Analysis',
  description: 'Understand and modify video platform codebases',
  primitives: [
    'tp_media_pipeline',     // Transcoding, processing
    'tp_algorithm_trace',    // Recommendations, search
    'tp_distribution_map',   // CDN, edge caching
    'tp_metric_trace',       // Watch time, engagement
    'tp_data_lineage',       // Video metadata flow
    'tp_timing_bound',       // Latency requirements
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_media_pipeline', 'tp_distribution_map'] },
    { type: 'parallel', inputs: ['tp_algorithm_trace', 'tp_metric_trace'] },
  ],
  patterns: ['pattern_performance_investigation', 'pattern_change_verification'],
};

// ============================================================================
// COMPOSITION: INDUSTRIAL BACKEND (Scale Systems)
// ============================================================================
const tc_industrial_backend: TechniqueComposition = {
  id: 'tc_industrial_backend',
  name: 'Industrial Backend Analysis',
  description: 'Understand and modify high-scale backend systems',
  primitives: [
    'tp_scale_pattern',      // Sharding, replication, partitioning
    'tp_distribution_map',   // Service topology, data locality
    'tp_timing_bound',       // Latency SLAs, timeouts
    'tp_state_trace',        // Consistency, transactions
    'tp_realtime_flow',      // Event sourcing, CQRS
    'tp_data_lineage',       // Data flow through services
  ],
  operators: [
    { type: 'parallel', inputs: ['tp_scale_pattern', 'tp_distribution_map'] },
    { type: 'gate', inputs: ['tp_timing_bound', 'tp_state_trace'] },
  ],
  patterns: ['pattern_performance_investigation', 'pattern_refactoring'],
};

// ============================================================================
// COMPOSITION: DEVELOPER TOOL (Claude Code/Codex)
// ============================================================================
const tc_developer_tool: TechniqueComposition = {
  id: 'tc_developer_tool',
  name: 'Developer Tool Analysis',
  description: 'Understand and modify developer tools and AI coding assistants',
  primitives: [
    'tp_tool_orchestration', // Tool coordination, MCP, LSP
    'tp_data_lineage',       // Context assembly, prompt flow
    'tp_algorithm_trace',    // Ranking, selection algorithms
    'tp_state_trace',        // Conversation state, sessions
    'tp_timing_bound',       // Response latency
    'tp_component_graph',    // UI/CLI component structure
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_tool_orchestration', 'tp_data_lineage'] },
    { type: 'parallel', inputs: ['tp_algorithm_trace', 'tp_state_trace'] },
  ],
  patterns: ['pattern_feature_construction', 'pattern_bug_investigation'],
};

// ============================================================================
// COMPOSITION: DASHBOARD (B2B/B2C)
// ============================================================================
const tc_dashboard: TechniqueComposition = {
  id: 'tc_dashboard',
  name: 'Dashboard Analysis',
  description: 'Understand and modify dashboard applications',
  primitives: [
    'tp_component_graph',    // Widget composition
    'tp_data_lineage',       // Data sources -> widgets
    'tp_realtime_flow',      // Live updates
    'tp_policy_verify',      // Permission/visibility rules
    'tp_metric_trace',       // User interaction metrics
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_data_lineage', 'tp_component_graph'] },
    { type: 'parallel', inputs: ['tp_realtime_flow', 'tp_policy_verify'] },
  ],
  patterns: ['pattern_feature_construction', 'pattern_change_verification'],
};

// ============================================================================
// COMPOSITION: LANDING PAGE / MARKETING
// ============================================================================
const tc_landing_page: TechniqueComposition = {
  id: 'tc_landing_page',
  name: 'Landing Page Analysis',
  description: 'Understand and optimize marketing/landing pages',
  primitives: [
    'tp_component_graph',    // Page structure
    'tp_metric_trace',       // Conversion metrics, Core Web Vitals
    'tp_artifact_trace',     // Design assets -> components
    'tp_timing_bound',       // Load time budgets
    'tp_data_lineage',       // Analytics flow
  ],
  operators: [
    { type: 'parallel', inputs: ['tp_component_graph', 'tp_artifact_trace'] },
    { type: 'sequence', inputs: ['tp_metric_trace', 'tp_timing_bound'] },
  ],
  patterns: ['pattern_performance_investigation', 'pattern_change_verification'],
};

// ============================================================================
// COMPOSITION: PAYMENT/TRANSACTION SYSTEM
// ============================================================================
const tc_payment_system: TechniqueComposition = {
  id: 'tc_payment_system',
  name: 'Payment System Analysis',
  description: 'Understand and modify payment/transaction systems',
  primitives: [
    'tp_state_trace',        // Transaction states, idempotency
    'tp_policy_verify',      // PCI compliance, fraud rules
    'tp_data_lineage',       // Money flow, audit trail
    'tp_timing_bound',       // Timeout handling
    'tp_scale_pattern',      // High-availability patterns
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_state_trace', 'tp_policy_verify'] },
    { type: 'gate', inputs: ['tp_data_lineage'], parameters: { requiresAudit: true } },
  ],
  patterns: ['pattern_change_verification', 'pattern_bug_investigation'],
};
```

---

## D3: Security Audit Primitives

> **Domain**: Security analysis, vulnerability assessment, OWASP compliance, dependency auditing

Security audit primitives enable systematic identification of vulnerabilities, security misconfigurations, and compliance gaps across codebases.

### Primitive Definitions

```typescript
// ============================================================================
// D3: SECURITY AUDIT PRIMITIVES
// ============================================================================

/**
 * tp_security_scan: Comprehensive security scanning
 * Supports: Static analysis, code pattern detection, secret scanning
 */
export const tp_security_scan: TechniquePrimitive = {
  id: 'tp_security_scan',
  name: 'Security Scan',
  description: 'Perform comprehensive security analysis identifying vulnerabilities, secrets, and misconfigurations',
  inputs: [
    { name: 'scope', type: 'EntityId[]', description: 'Files/modules to scan' },
    { name: 'rulesets', type: 'string[]', description: 'Security rulesets to apply (e.g., OWASP, CWE)' },
    { name: 'severityThreshold', type: 'string', description: 'Minimum severity: critical|high|medium|low' },
  ],
  outputs: [
    { name: 'findings', type: 'SecurityFinding[]', description: 'Identified vulnerabilities' },
    { name: 'secretsDetected', type: 'SecretFinding[]', description: 'Potential secrets/credentials found' },
    { name: 'riskScore', type: 'number', description: 'Aggregate risk score 0-100' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Requires calibration against CVE databases
  tier: 2,  // Static analysis is largely deterministic
};

/**
 * tp_vulnerability_check: Known vulnerability detection
 * Supports: CVE matching, vulnerability databases, exploit detection
 */
export const tp_vulnerability_check: TechniquePrimitive = {
  id: 'tp_vulnerability_check',
  name: 'Vulnerability Check',
  description: 'Check code patterns against known vulnerability databases (CVE, NVD)',
  inputs: [
    { name: 'entityId', type: 'EntityId', description: 'Code entity to check' },
    { name: 'databases', type: 'string[]', description: 'Vulnerability databases to query' },
  ],
  outputs: [
    { name: 'matchedCVEs', type: 'CVEMatch[]', description: 'Matched CVE entries' },
    { name: 'exploitability', type: 'ExploitabilityScore', description: 'CVSS exploitability metrics' },
    { name: 'remediationSuggestions', type: 'Remediation[]', description: 'Suggested fixes' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // CVE matching accuracy needs measurement
  tier: 2,
};

/**
 * tp_owasp_check: OWASP Top 10 compliance verification
 * Supports: Web application security, API security, mobile security
 */
export const tp_owasp_check: TechniquePrimitive = {
  id: 'tp_owasp_check',
  name: 'OWASP Compliance Check',
  description: 'Verify code against OWASP Top 10 categories and security best practices',
  inputs: [
    { name: 'scope', type: 'EntityId[]', description: 'Code scope to analyze' },
    { name: 'owaspVersion', type: 'string', description: 'OWASP version (e.g., 2021, 2023)' },
    { name: 'applicationContext', type: 'ApplicationContext', description: 'Web, API, Mobile, etc.' },
  ],
  outputs: [
    { name: 'categoryResults', type: 'OWASPCategoryResult[]', description: 'Results per OWASP category' },
    { name: 'overallCompliance', type: 'ComplianceLevel', description: 'Overall compliance status' },
    { name: 'prioritizedFindings', type: 'PrioritizedFinding[]', description: 'Findings ordered by risk' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // OWASP interpretation requires calibration
  tier: 3,  // Requires semantic understanding of code intent
};

/**
 * tp_dependency_audit: Dependency security analysis
 * Supports: Supply chain security, transitive dependency analysis, license compliance
 */
export const tp_dependency_audit: TechniquePrimitive = {
  id: 'tp_dependency_audit',
  name: 'Dependency Audit',
  description: 'Audit dependencies for known vulnerabilities, outdated versions, and license issues',
  inputs: [
    { name: 'manifestPath', type: 'string', description: 'Path to dependency manifest (package.json, pom.xml, etc.)' },
    { name: 'includeTransitive', type: 'boolean', description: 'Include transitive dependencies' },
    { name: 'licenseAllowlist', type: 'string[]', description: 'Allowed licenses (e.g., MIT, Apache-2.0)' },
  ],
  outputs: [
    { name: 'vulnerableDeps', type: 'VulnerableDependency[]', description: 'Dependencies with known vulnerabilities' },
    { name: 'outdatedDeps', type: 'OutdatedDependency[]', description: 'Dependencies with available updates' },
    { name: 'licenseViolations', type: 'LicenseViolation[]', description: 'Dependencies violating license policy' },
    { name: 'supplyChainRisk', type: 'SupplyChainRiskScore', description: 'Overall supply chain risk assessment' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Depends on vulnerability database freshness
  tier: 2,
};
```

### Security Scanner Integration

```typescript
/**
 * Integration points for external security scanners
 */
interface SecurityScannerIntegration {
  /** Static Application Security Testing (SAST) */
  sast: {
    tools: ['semgrep', 'codeql', 'snyk-code', 'sonarqube'];
    outputFormat: 'SARIF' | 'JSON';
    rulesetPath?: string;
  };

  /** Software Composition Analysis (SCA) */
  sca: {
    tools: ['snyk', 'npm-audit', 'dependabot', 'trivy'];
    vulnDatabases: ['nvd', 'github-advisory', 'osv'];
  };

  /** Secret Detection */
  secretDetection: {
    tools: ['gitleaks', 'trufflehog', 'detect-secrets'];
    customPatterns?: RegExp[];
  };

  /** Container Security */
  containerSecurity: {
    tools: ['trivy', 'grype', 'snyk-container'];
    baseImagePolicy: 'approved-list' | 'scan-all';
  };
}
```

---

## D4: Performance Investigation Primitives

> **Domain**: Performance profiling, bottleneck detection, memory analysis, latency tracing

Performance investigation primitives enable systematic identification of performance issues, resource bottlenecks, and optimization opportunities.

### Primitive Definitions

```typescript
// ============================================================================
// D4: PERFORMANCE INVESTIGATION PRIMITIVES
// ============================================================================

/**
 * tp_profile_analysis: Performance profile interpretation
 * Supports: CPU profiling, flame graphs, call tree analysis
 */
export const tp_profile_analysis: TechniquePrimitive = {
  id: 'tp_profile_analysis',
  name: 'Profile Analysis',
  description: 'Analyze performance profiles to identify hot paths and optimization opportunities',
  inputs: [
    { name: 'profileData', type: 'ProfileData', description: 'CPU/memory profile data' },
    { name: 'profileType', type: 'string', description: 'cpu|memory|allocation|io' },
    { name: 'thresholdMs', type: 'number', description: 'Minimum duration to flag' },
  ],
  outputs: [
    { name: 'hotPaths', type: 'HotPath[]', description: 'Most expensive code paths' },
    { name: 'flameGraph', type: 'FlameGraphData', description: 'Flame graph visualization data' },
    { name: 'optimizationSuggestions', type: 'Optimization[]', description: 'Suggested optimizations' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Profile interpretation accuracy needs calibration
  tier: 2,  // Profile data is deterministic; interpretation may need LLM
};

/**
 * tp_bottleneck_detect: Bottleneck identification
 * Supports: I/O bottlenecks, CPU contention, lock contention, queue saturation
 */
export const tp_bottleneck_detect: TechniquePrimitive = {
  id: 'tp_bottleneck_detect',
  name: 'Bottleneck Detection',
  description: 'Identify performance bottlenecks across system resources',
  inputs: [
    { name: 'traceData', type: 'TraceData', description: 'Distributed trace or profiler data' },
    { name: 'resourceTypes', type: 'string[]', description: 'Resources to analyze: cpu|memory|io|network|lock' },
    { name: 'timeWindow', type: 'TimeRange', description: 'Time window for analysis' },
  ],
  outputs: [
    { name: 'bottlenecks', type: 'Bottleneck[]', description: 'Identified bottlenecks with severity' },
    { name: 'resourceUtilization', type: 'ResourceUtilization', description: 'Resource usage breakdown' },
    { name: 'contentionPoints', type: 'ContentionPoint[]', description: 'Lock/resource contention' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Bottleneck classification needs calibration
  tier: 2,
};

/**
 * tp_memory_analysis: Memory usage and leak detection
 * Supports: Heap analysis, leak detection, allocation tracking, GC analysis
 */
export const tp_memory_analysis: TechniquePrimitive = {
  id: 'tp_memory_analysis',
  name: 'Memory Analysis',
  description: 'Analyze memory usage patterns, detect leaks, and identify optimization opportunities',
  inputs: [
    { name: 'heapSnapshot', type: 'HeapSnapshot', description: 'Heap dump or snapshot data' },
    { name: 'allocationTrace', type: 'AllocationTrace', description: 'Allocation tracking data' },
    { name: 'gcLogs', type: 'GCLogData', description: 'Garbage collection logs' },
  ],
  outputs: [
    { name: 'leakCandidates', type: 'LeakCandidate[]', description: 'Potential memory leaks' },
    { name: 'retainedSizeAnalysis', type: 'RetainedSizeTree', description: 'Object retention tree' },
    { name: 'allocationHotspots', type: 'AllocationHotspot[]', description: 'High allocation rate locations' },
    { name: 'gcPressure', type: 'GCPressureAnalysis', description: 'GC frequency and pause analysis' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Leak detection accuracy needs measurement
  tier: 2,
};

/**
 * tp_latency_trace: End-to-end latency tracing
 * Supports: Distributed tracing, request flow analysis, SLA verification
 */
export const tp_latency_trace: TechniquePrimitive = {
  id: 'tp_latency_trace',
  name: 'Latency Tracing',
  description: 'Trace request latency through system components to identify slow paths',
  inputs: [
    { name: 'traceId', type: 'string', description: 'Distributed trace ID' },
    { name: 'spans', type: 'Span[]', description: 'Trace spans from observability system' },
    { name: 'slaTargets', type: 'SLATarget[]', description: 'Latency SLA thresholds' },
  ],
  outputs: [
    { name: 'criticalPath', type: 'CriticalPath', description: 'Longest latency path through system' },
    { name: 'spanBreakdown', type: 'SpanBreakdown[]', description: 'Latency contribution per service/component' },
    { name: 'slaViolations', type: 'SLAViolation[]', description: 'SLA threshold violations' },
    { name: 'latencyPercentiles', type: 'LatencyPercentiles', description: 'p50, p90, p99 latency distribution' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Trace accuracy depends on instrumentation quality
  tier: 2,
};
```

---

## D5: API Design Review Primitives

> **Domain**: API consistency, REST conventions, schema validation, backward compatibility

API design review primitives enable systematic analysis of API design quality, consistency, and standards compliance.

### Primitive Definitions

```typescript
// ============================================================================
// D5: API DESIGN REVIEW PRIMITIVES
// ============================================================================

/**
 * tp_api_consistency_check: API consistency analysis
 * Supports: Naming conventions, parameter patterns, response structures
 */
export const tp_api_consistency_check: TechniquePrimitive = {
  id: 'tp_api_consistency_check',
  name: 'API Consistency Check',
  description: 'Analyze API endpoints for consistency in naming, parameters, and response structures',
  inputs: [
    { name: 'apiSpec', type: 'OpenAPISpec | GraphQLSchema', description: 'API specification' },
    { name: 'styleGuide', type: 'APIStyleGuide', description: 'API style guide rules' },
    { name: 'existingAPIs', type: 'APIEndpoint[]', description: 'Existing API endpoints for comparison' },
  ],
  outputs: [
    { name: 'inconsistencies', type: 'Inconsistency[]', description: 'Detected inconsistencies' },
    { name: 'namingViolations', type: 'NamingViolation[]', description: 'Naming convention violations' },
    { name: 'consistencyScore', type: 'number', description: 'Overall consistency score 0-100' },
    { name: 'suggestions', type: 'ConsistencySuggestion[]', description: 'Improvement suggestions' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Style guide interpretation needs calibration
  tier: 2,
};

/**
 * tp_rest_convention_check: REST best practices verification
 * Supports: HTTP methods, status codes, resource modeling, HATEOAS
 */
export const tp_rest_convention_check: TechniquePrimitive = {
  id: 'tp_rest_convention_check',
  name: 'REST Convention Check',
  description: 'Verify API endpoints follow REST best practices and conventions',
  inputs: [
    { name: 'apiSpec', type: 'OpenAPISpec', description: 'OpenAPI specification' },
    { name: 'strictness', type: 'string', description: 'lenient|standard|strict' },
    { name: 'enableHATEOAS', type: 'boolean', description: 'Check for HATEOAS compliance' },
  ],
  outputs: [
    { name: 'methodViolations', type: 'MethodViolation[]', description: 'HTTP method misuse' },
    { name: 'statusCodeIssues', type: 'StatusCodeIssue[]', description: 'Inappropriate status codes' },
    { name: 'resourceModelingIssues', type: 'ResourceIssue[]', description: 'Resource design problems' },
    { name: 'restMaturityLevel', type: 'number', description: 'Richardson Maturity Model level 0-3' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // REST interpretation can be subjective
  tier: 2,
};

/**
 * tp_schema_validation: API schema validation
 * Supports: JSON Schema, OpenAPI, GraphQL schema validation
 */
export const tp_schema_validation: TechniquePrimitive = {
  id: 'tp_schema_validation',
  name: 'Schema Validation',
  description: 'Validate API schemas for correctness, completeness, and best practices',
  inputs: [
    { name: 'schema', type: 'JSONSchema | OpenAPISpec | GraphQLSchema', description: 'Schema to validate' },
    { name: 'schemaVersion', type: 'string', description: 'Schema specification version' },
    { name: 'customRules', type: 'SchemaRule[]', description: 'Custom validation rules' },
  ],
  outputs: [
    { name: 'syntaxErrors', type: 'SyntaxError[]', description: 'Schema syntax issues' },
    { name: 'semanticIssues', type: 'SemanticIssue[]', description: 'Semantic problems' },
    { name: 'typeCompleteness', type: 'TypeCoverage', description: 'Type definition completeness' },
    { name: 'backwardCompatibility', type: 'CompatibilityReport', description: 'Breaking change detection' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Schema validation is largely deterministic
  tier: 1,  // Schema validation is deterministic
};
```

---

## D6: Dependency Upgrade Primitives

> **Domain**: Dependency management, breaking change detection, migration planning

Dependency upgrade primitives enable safe and systematic upgrade of dependencies while detecting breaking changes and suggesting migration paths.

### Primitive Definitions

```typescript
// ============================================================================
// D6: DEPENDENCY UPGRADE PRIMITIVES
// ============================================================================

/**
 * tp_breaking_change_detect: Breaking change detection
 * Supports: Semantic versioning analysis, API diff, deprecation tracking
 */
export const tp_breaking_change_detect: TechniquePrimitive = {
  id: 'tp_breaking_change_detect',
  name: 'Breaking Change Detection',
  description: 'Detect breaking changes between dependency versions',
  inputs: [
    { name: 'packageName', type: 'string', description: 'Package to analyze' },
    { name: 'currentVersion', type: 'string', description: 'Current version' },
    { name: 'targetVersion', type: 'string', description: 'Target upgrade version' },
    { name: 'usagePatterns', type: 'UsagePattern[]', description: 'How the package is used in codebase' },
  ],
  outputs: [
    { name: 'breakingChanges', type: 'BreakingChange[]', description: 'Detected breaking changes' },
    { name: 'deprecations', type: 'Deprecation[]', description: 'Deprecated APIs being used' },
    { name: 'affectedCode', type: 'AffectedLocation[]', description: 'Code locations requiring changes' },
    { name: 'riskLevel', type: 'RiskLevel', description: 'Overall upgrade risk assessment' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Breaking change detection needs real-world calibration
  tier: 2,
};

/**
 * tp_migration_path_suggest: Migration path recommendation
 * Supports: Incremental upgrades, migration scripts, codemods
 */
export const tp_migration_path_suggest: TechniquePrimitive = {
  id: 'tp_migration_path_suggest',
  name: 'Migration Path Suggestion',
  description: 'Suggest optimal migration paths for dependency upgrades',
  inputs: [
    { name: 'currentState', type: 'DependencyGraph', description: 'Current dependency state' },
    { name: 'targetState', type: 'DependencyGraph', description: 'Desired dependency state' },
    { name: 'constraints', type: 'MigrationConstraint[]', description: 'Migration constraints (time, risk)' },
  ],
  outputs: [
    { name: 'migrationSteps', type: 'MigrationStep[]', description: 'Ordered migration steps' },
    { name: 'intermediateVersions', type: 'VersionPath[]', description: 'Suggested intermediate versions' },
    { name: 'codemods', type: 'Codemod[]', description: 'Available automated transformations' },
    { name: 'estimatedEffort', type: 'EffortEstimate', description: 'Estimated migration effort' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Migration path quality needs empirical validation
  tier: 3,  // Requires semantic understanding of upgrade impact
};

/**
 * tp_compatibility_check: Compatibility verification
 * Supports: Peer dependency validation, engine compatibility, platform support
 */
export const tp_compatibility_check: TechniquePrimitive = {
  id: 'tp_compatibility_check',
  name: 'Compatibility Check',
  description: 'Verify dependency compatibility with runtime environment and peer dependencies',
  inputs: [
    { name: 'dependencyGraph', type: 'DependencyGraph', description: 'Full dependency graph' },
    { name: 'runtimeEnvironment', type: 'RuntimeEnv', description: 'Node version, browser targets, etc.' },
    { name: 'platforms', type: 'Platform[]', description: 'Target platforms' },
  ],
  outputs: [
    { name: 'peerConflicts', type: 'PeerConflict[]', description: 'Peer dependency conflicts' },
    { name: 'engineMismatches', type: 'EngineMismatch[]', description: 'Node/runtime version issues' },
    { name: 'platformIssues', type: 'PlatformIssue[]', description: 'Platform-specific problems' },
    { name: 'resolutionSuggestions', type: 'Resolution[]', description: 'Suggested resolutions' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Compatibility checking is largely deterministic
  tier: 1,
};
```

---

## D7: Documentation Generation Primitives

> **Domain**: Auto-documentation, example generation, API documentation

Documentation generation primitives enable automated creation of high-quality documentation from code analysis.

### Primitive Definitions

```typescript
// ============================================================================
// D7: DOCUMENTATION GENERATION PRIMITIVES
// ============================================================================

/**
 * tp_doc_structure_infer: Documentation structure inference
 * Supports: Module organization, API grouping, navigation structure
 */
export const tp_doc_structure_infer: TechniquePrimitive = {
  id: 'tp_doc_structure_infer',
  name: 'Documentation Structure Inference',
  description: 'Infer optimal documentation structure from codebase organization',
  inputs: [
    { name: 'codebaseGraph', type: 'CodebaseGraph', description: 'Module/component graph' },
    { name: 'existingDocs', type: 'ExistingDocs', description: 'Current documentation' },
    { name: 'docStyle', type: 'DocStyle', description: 'tutorial|reference|guide|api' },
  ],
  outputs: [
    { name: 'suggestedStructure', type: 'DocStructure', description: 'Recommended doc structure' },
    { name: 'sectionMapping', type: 'SectionMapping[]', description: 'Code to doc section mapping' },
    { name: 'navigationTree', type: 'NavTree', description: 'Navigation hierarchy' },
    { name: 'gaps', type: 'DocGap[]', description: 'Undocumented areas' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Structure inference requires semantic understanding
  tier: 3,
};

/**
 * tp_example_generate: Code example generation
 * Supports: Usage examples, integration examples, test-derived examples
 */
export const tp_example_generate: TechniquePrimitive = {
  id: 'tp_example_generate',
  name: 'Example Generation',
  description: 'Generate code examples demonstrating API usage patterns',
  inputs: [
    { name: 'apiEntity', type: 'EntityId', description: 'API to generate examples for' },
    { name: 'existingTests', type: 'TestCase[]', description: 'Existing tests as example source' },
    { name: 'usagePatterns', type: 'UsagePattern[]', description: 'Real-world usage patterns' },
    { name: 'complexity', type: 'string', description: 'minimal|standard|comprehensive' },
  ],
  outputs: [
    { name: 'examples', type: 'CodeExample[]', description: 'Generated examples' },
    { name: 'annotations', type: 'ExampleAnnotation[]', description: 'Explanatory annotations' },
    { name: 'prerequisites', type: 'Prerequisite[]', description: 'Required setup/imports' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Example quality requires human evaluation
  tier: 3,
};

/**
 * tp_api_doc_generate: API documentation generation
 * Supports: JSDoc, TypeDoc, OpenAPI generation, markdown docs
 */
export const tp_api_doc_generate: TechniquePrimitive = {
  id: 'tp_api_doc_generate',
  name: 'API Documentation Generation',
  description: 'Generate comprehensive API documentation from code analysis',
  inputs: [
    { name: 'entities', type: 'EntityId[]', description: 'Entities to document' },
    { name: 'format', type: 'string', description: 'jsdoc|typedoc|openapi|markdown' },
    { name: 'includeExamples', type: 'boolean', description: 'Include usage examples' },
    { name: 'includeInternals', type: 'boolean', description: 'Document internal APIs' },
  ],
  outputs: [
    { name: 'documentation', type: 'GeneratedDoc[]', description: 'Generated documentation' },
    { name: 'typeDefinitions', type: 'TypeDoc[]', description: 'Type documentation' },
    { name: 'changelog', type: 'ChangelogEntry[]', description: 'API change history' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Doc generation quality needs calibration
  tier: 3,
};
```

---

## D8: Technical Debt Assessment Primitives

> **Domain**: Technical debt identification, prioritization, impact analysis

Technical debt assessment primitives enable systematic identification and prioritization of technical debt across codebases.

### Primitive Definitions

```typescript
// ============================================================================
// D8: TECHNICAL DEBT ASSESSMENT PRIMITIVES
// ============================================================================

/**
 * tp_debt_identify: Technical debt identification
 * Supports: Code smells, architectural issues, outdated patterns
 */
export const tp_debt_identify: TechniquePrimitive = {
  id: 'tp_debt_identify',
  name: 'Technical Debt Identification',
  description: 'Identify technical debt indicators across the codebase',
  inputs: [
    { name: 'scope', type: 'EntityId[]', description: 'Code scope to analyze' },
    { name: 'debtCategories', type: 'DebtCategory[]', description: 'code|architecture|test|documentation' },
    { name: 'thresholds', type: 'DebtThresholds', description: 'Thresholds for flagging debt' },
  ],
  outputs: [
    { name: 'debtItems', type: 'DebtItem[]', description: 'Identified debt items' },
    { name: 'codeSmells', type: 'CodeSmell[]', description: 'Code smell instances' },
    { name: 'complexityHotspots', type: 'ComplexityHotspot[]', description: 'High complexity areas' },
    { name: 'duplication', type: 'DuplicationReport', description: 'Code duplication analysis' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Debt identification can be subjective
  tier: 2,
};

/**
 * tp_debt_prioritize: Technical debt prioritization
 * Supports: Business impact, fix cost, risk assessment
 */
export const tp_debt_prioritize: TechniquePrimitive = {
  id: 'tp_debt_prioritize',
  name: 'Technical Debt Prioritization',
  description: 'Prioritize technical debt items based on impact and effort',
  inputs: [
    { name: 'debtItems', type: 'DebtItem[]', description: 'Identified debt items' },
    { name: 'businessContext', type: 'BusinessContext', description: 'Business priorities and constraints' },
    { name: 'changeFrequency', type: 'ChangeFrequency[]', description: 'How often affected code changes' },
  ],
  outputs: [
    { name: 'prioritizedDebt', type: 'PrioritizedDebtItem[]', description: 'Debt items with priority scores' },
    { name: 'quickWins', type: 'DebtItem[]', description: 'High-impact, low-effort items' },
    { name: 'strategicDebt', type: 'DebtItem[]', description: 'Items to address with major work' },
    { name: 'acceptableDebt', type: 'DebtItem[]', description: 'Low-priority items to monitor' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Prioritization requires business context calibration
  tier: 3,
};

/**
 * tp_debt_impact_analyze: Technical debt impact analysis
 * Supports: Velocity impact, bug correlation, onboarding friction
 */
export const tp_debt_impact_analyze: TechniquePrimitive = {
  id: 'tp_debt_impact_analyze',
  name: 'Technical Debt Impact Analysis',
  description: 'Analyze the impact of technical debt on development velocity and quality',
  inputs: [
    { name: 'debtItem', type: 'DebtItem', description: 'Debt item to analyze' },
    { name: 'commitHistory', type: 'CommitHistory', description: 'Git history for velocity analysis' },
    { name: 'bugReports', type: 'BugReport[]', description: 'Bug reports for correlation' },
  ],
  outputs: [
    { name: 'velocityImpact', type: 'VelocityImpact', description: 'Estimated velocity drag' },
    { name: 'bugCorrelation', type: 'BugCorrelation', description: 'Correlation with bug frequency' },
    { name: 'changeRisk', type: 'ChangeRisk', description: 'Risk when modifying affected code' },
    { name: 'interestRate', type: 'number', description: 'Estimated debt interest (cost increase over time)' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Impact analysis requires historical calibration
  tier: 3,
};
```

---

## D9: Architecture Decision Primitives

> **Domain**: Architecture tradeoff analysis, ADR generation, architecture validation

Architecture decision primitives enable systematic analysis of architectural choices and their implications.

### Primitive Definitions

```typescript
// ============================================================================
// D9: ARCHITECTURE DECISION PRIMITIVES
// ============================================================================

/**
 * tp_tradeoff_analyze: Architecture tradeoff analysis
 * Supports: Quality attribute tradeoffs, pattern comparison, scalability analysis
 */
export const tp_tradeoff_analyze: TechniquePrimitive = {
  id: 'tp_tradeoff_analyze',
  name: 'Architecture Tradeoff Analysis',
  description: 'Analyze tradeoffs between architectural choices and quality attributes',
  inputs: [
    { name: 'options', type: 'ArchitectureOption[]', description: 'Architecture options to compare' },
    { name: 'qualityAttributes', type: 'QualityAttribute[]', description: 'Attributes to evaluate: performance|scalability|maintainability|security' },
    { name: 'constraints', type: 'Constraint[]', description: 'System constraints' },
  ],
  outputs: [
    { name: 'tradeoffMatrix', type: 'TradeoffMatrix', description: 'Options vs attributes matrix' },
    { name: 'sensitivityAnalysis', type: 'SensitivityAnalysis', description: 'Sensitivity to parameter changes' },
    { name: 'recommendation', type: 'ArchitectureRecommendation', description: 'Recommended option with rationale' },
    { name: 'risks', type: 'ArchitectureRisk[]', description: 'Risks for each option' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Tradeoff analysis is inherently subjective
  tier: 3,
};

/**
 * tp_adr_generate: Architecture Decision Record generation
 * Supports: ADR templates, decision documentation, context capture
 */
export const tp_adr_generate: TechniquePrimitive = {
  id: 'tp_adr_generate',
  name: 'ADR Generation',
  description: 'Generate Architecture Decision Records from analysis context',
  inputs: [
    { name: 'decision', type: 'ArchitectureDecision', description: 'Decision being documented' },
    { name: 'context', type: 'DecisionContext', description: 'Problem context and constraints' },
    { name: 'alternatives', type: 'Alternative[]', description: 'Considered alternatives' },
    { name: 'template', type: 'ADRTemplate', description: 'ADR template to use' },
  ],
  outputs: [
    { name: 'adr', type: 'ADRDocument', description: 'Generated ADR document' },
    { name: 'linkedADRs', type: 'ADRLink[]', description: 'Related ADRs' },
    { name: 'consequences', type: 'Consequence[]', description: 'Documented consequences' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // ADR quality requires human review
  tier: 3,
};

/**
 * tp_architecture_validate: Architecture validation against principles
 * Supports: Architectural fitness functions, constraint checking, drift detection
 */
export const tp_architecture_validate: TechniquePrimitive = {
  id: 'tp_architecture_validate',
  name: 'Architecture Validation',
  description: 'Validate current architecture against defined principles and constraints',
  inputs: [
    { name: 'currentArchitecture', type: 'ArchitectureModel', description: 'Current system architecture' },
    { name: 'principles', type: 'ArchitecturePrinciple[]', description: 'Architecture principles to validate' },
    { name: 'fitnessFunctions', type: 'FitnessFunction[]', description: 'Fitness functions to evaluate' },
  ],
  outputs: [
    { name: 'violations', type: 'PrincipleViolation[]', description: 'Principle violations' },
    { name: 'fitnessScores', type: 'FitnessScore[]', description: 'Fitness function results' },
    { name: 'driftReport', type: 'DriftReport', description: 'Architecture drift from intended design' },
    { name: 'remediations', type: 'Remediation[]', description: 'Suggested fixes' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Validation rules need calibration
  tier: 2,
};
```

---

## D10: Legacy Code Analysis Primitives

> **Domain**: Legacy code understanding, safe modification zones, modernization planning

Legacy code analysis primitives enable systematic analysis of legacy systems for understanding, safe modification, and modernization.

### Primitive Definitions

```typescript
// ============================================================================
// D10: LEGACY CODE ANALYSIS PRIMITIVES
// ============================================================================

/**
 * tp_legacy_archaeology: Code archaeology for legacy systems
 * Supports: History reconstruction, author tracking, evolution understanding
 */
export const tp_legacy_archaeology: TechniquePrimitive = {
  id: 'tp_legacy_archaeology',
  name: 'Legacy Code Archaeology',
  description: 'Reconstruct the history and evolution of legacy code to understand intent',
  inputs: [
    { name: 'entityId', type: 'EntityId', description: 'Legacy code entity to analyze' },
    { name: 'gitHistory', type: 'GitHistory', description: 'Git commit history' },
    { name: 'depth', type: 'number', description: 'How far back to analyze' },
  ],
  outputs: [
    { name: 'evolutionTimeline', type: 'EvolutionTimeline', description: 'Code evolution over time' },
    { name: 'keyAuthors', type: 'Author[]', description: 'Primary contributors' },
    { name: 'majorChanges', type: 'MajorChange[]', description: 'Significant modifications' },
    { name: 'inferredIntent', type: 'InferredIntent', description: 'Reconstructed original intent' },
    { name: 'undocumentedBehavior', type: 'UndocumentedBehavior[]', description: 'Implicit behaviors' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Intent inference requires calibration
  tier: 3,
};

/**
 * tp_safe_zone_identify: Safe modification zone identification
 * Supports: Testable regions, isolated components, low-risk changes
 */
export const tp_safe_zone_identify: TechniquePrimitive = {
  id: 'tp_safe_zone_identify',
  name: 'Safe Zone Identification',
  description: 'Identify areas of legacy code that can be safely modified',
  inputs: [
    { name: 'codebaseGraph', type: 'CodebaseGraph', description: 'Code dependency graph' },
    { name: 'testCoverage', type: 'TestCoverage', description: 'Test coverage data' },
    { name: 'changeHistory', type: 'ChangeHistory', description: 'Recent change patterns' },
  ],
  outputs: [
    { name: 'safeZones', type: 'SafeZone[]', description: 'Areas safe to modify' },
    { name: 'dangerZones', type: 'DangerZone[]', description: 'High-risk modification areas' },
    { name: 'isolationBoundaries', type: 'IsolationBoundary[]', description: 'Natural isolation points' },
    { name: 'testingGaps', type: 'TestingGap[]', description: 'Areas needing test coverage first' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Safe zone classification needs empirical validation
  tier: 2,
};

/**
 * tp_modernization_plan: Legacy modernization planning
 * Supports: Strangler fig pattern, incremental rewrites, technology migration
 */
export const tp_modernization_plan: TechniquePrimitive = {
  id: 'tp_modernization_plan',
  name: 'Modernization Planning',
  description: 'Generate a plan for modernizing legacy systems incrementally',
  inputs: [
    { name: 'legacySystem', type: 'SystemModel', description: 'Current legacy system model' },
    { name: 'targetState', type: 'TargetArchitecture', description: 'Desired modern architecture' },
    { name: 'constraints', type: 'ModernizationConstraint[]', description: 'Budget, time, risk constraints' },
    { name: 'strategy', type: 'string', description: 'strangler|bigbang|incremental' },
  ],
  outputs: [
    { name: 'modernizationPhases', type: 'ModernizationPhase[]', description: 'Phased modernization plan' },
    { name: 'migrationOrder', type: 'ComponentOrder[]', description: 'Order to migrate components' },
    { name: 'riskMitigation', type: 'RiskMitigation[]', description: 'Risk mitigation strategies' },
    { name: 'rollbackPlan', type: 'RollbackPlan', description: 'Rollback strategy for each phase' },
    { name: 'effortEstimate', type: 'EffortEstimate', description: 'Estimated effort per phase' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Modernization planning is highly context-dependent
  tier: 3,
};
```

---

## D11: Compliance Checking Primitives

> **Domain**: Regulatory compliance, audit evidence, compliance reporting

Compliance checking primitives enable systematic verification of regulatory and policy compliance with audit-ready evidence.

### Primitive Definitions

```typescript
// ============================================================================
// D11: COMPLIANCE CHECKING PRIMITIVES
// ============================================================================

/**
 * tp_compliance_scan: Regulatory compliance scanning
 * Supports: GDPR, HIPAA, SOC2, PCI-DSS compliance checks
 */
export const tp_compliance_scan: TechniquePrimitive = {
  id: 'tp_compliance_scan',
  name: 'Compliance Scan',
  description: 'Scan codebase for regulatory compliance requirements',
  inputs: [
    { name: 'scope', type: 'EntityId[]', description: 'Code scope to scan' },
    { name: 'frameworks', type: 'ComplianceFramework[]', description: 'Compliance frameworks: GDPR|HIPAA|SOC2|PCI-DSS|CCPA' },
    { name: 'dataClassification', type: 'DataClassification', description: 'Data sensitivity classification' },
  ],
  outputs: [
    { name: 'complianceStatus', type: 'ComplianceStatus[]', description: 'Status per framework' },
    { name: 'violations', type: 'ComplianceViolation[]', description: 'Detected violations' },
    { name: 'dataFlowRisks', type: 'DataFlowRisk[]', description: 'Sensitive data flow issues' },
    { name: 'requiredControls', type: 'RequiredControl[]', description: 'Missing required controls' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Compliance interpretation needs legal review calibration
  tier: 3,  // Regulatory interpretation requires semantic understanding
};

/**
 * tp_evidence_collect: Audit evidence collection
 * Supports: Access logs, change tracking, data handling evidence
 */
export const tp_evidence_collect: TechniquePrimitive = {
  id: 'tp_evidence_collect',
  name: 'Evidence Collection',
  description: 'Collect and organize evidence for compliance audits',
  inputs: [
    { name: 'auditScope', type: 'AuditScope', description: 'Scope of audit' },
    { name: 'evidenceTypes', type: 'EvidenceType[]', description: 'Types of evidence needed' },
    { name: 'timeRange', type: 'TimeRange', description: 'Time period for evidence' },
    { name: 'controls', type: 'Control[]', description: 'Controls to evidence' },
  ],
  outputs: [
    { name: 'evidence', type: 'AuditEvidence[]', description: 'Collected evidence items' },
    { name: 'evidenceChain', type: 'EvidenceChain', description: 'Chain of custody' },
    { name: 'gaps', type: 'EvidenceGap[]', description: 'Missing evidence' },
    { name: 'attestations', type: 'Attestation[]', description: 'Required attestations' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Evidence completeness needs audit validation
  tier: 2,
};

/**
 * tp_audit_report_generate: Compliance audit report generation
 * Supports: SOC2 reports, GDPR assessments, security audit reports
 */
export const tp_audit_report_generate: TechniquePrimitive = {
  id: 'tp_audit_report_generate',
  name: 'Audit Report Generation',
  description: 'Generate compliance audit reports from collected evidence',
  inputs: [
    { name: 'evidence', type: 'AuditEvidence[]', description: 'Collected evidence' },
    { name: 'reportType', type: 'string', description: 'SOC2|GDPR|HIPAA|PCI|internal' },
    { name: 'period', type: 'AuditPeriod', description: 'Audit period' },
    { name: 'scope', type: 'AuditScope', description: 'Audit scope definition' },
  ],
  outputs: [
    { name: 'report', type: 'AuditReport', description: 'Generated audit report' },
    { name: 'findings', type: 'AuditFinding[]', description: 'Audit findings' },
    { name: 'recommendations', type: 'Recommendation[]', description: 'Remediation recommendations' },
    { name: 'certificationStatus', type: 'CertificationStatus', description: 'Certification eligibility' },
  ],
  confidence: { type: 'absent', reason: 'uncalibrated' },  // Report quality requires auditor review
  tier: 3,
};
```

---

## Domain-Contextualized Quality Metrics

> **Principle**: Quality metrics must be interpreted within domain context. A 10ms latency is excellent for batch processing but unacceptable for real-time gaming.

### DomainContext Interface

```typescript
/**
 * DomainContext provides domain-specific interpretation of quality metrics.
 * This enables LiBrainian to make domain-aware judgments about code quality.
 */
interface DomainContext {
  /** Unique identifier for the domain context */
  id: string;

  /** Human-readable domain name */
  name: string;

  /** Code type classification */
  codeType: CodeType;

  /** Domain-specific norms and thresholds */
  domainNorms: DomainNorms;

  /** Empirical distributions from real-world data */
  empiricalDistributions: EmpiricalDistributions;

  /** Quality metric interpreters */
  metricInterpreters: MetricInterpreterMap;
}

/**
 * Code type classification affects how quality metrics are interpreted
 */
type CodeType =
  | 'library'           // Reusable library code - high stability, docs matter
  | 'application'       // End-user application - UX metrics matter
  | 'infrastructure'    // Infra/DevOps - reliability, automation matter
  | 'data_pipeline'     // Data processing - throughput, correctness matter
  | 'real_time'         // Real-time systems - latency, determinism matter
  | 'embedded'          // Embedded systems - resource constraints matter
  | 'ml_training'       // ML training - reproducibility, experiment tracking matter
  | 'ml_inference'      // ML inference - latency, throughput matter
  | 'financial'         // Financial systems - audit, precision matter
  | 'healthcare'        // Healthcare - compliance, privacy matter
  | 'security_critical' // Security-critical - formal verification, pen testing matter
  | 'prototype'         // Prototype/experimental - velocity over polish
  | 'legacy';           // Legacy maintenance - safe changes, understanding matter

/**
 * Domain-specific norms define acceptable ranges for metrics
 */
interface DomainNorms {
  /** Performance thresholds */
  performance: {
    acceptableLatencyP50Ms: number;
    acceptableLatencyP99Ms: number;
    minThroughput?: number;
    maxMemoryMB?: number;
    maxCPUPercent?: number;
  };

  /** Code quality thresholds */
  quality: {
    minTestCoverage: number;          // 0-100
    maxCyclomaticComplexity: number;
    maxFunctionLengthLines: number;
    maxFileLengthLines: number;
    maxDuplicationPercent: number;
  };

  /** Security requirements */
  security: {
    requiresSecurityReview: boolean;
    maxCriticalVulnerabilities: number;
    maxHighVulnerabilities: number;
    requiredComplianceFrameworks: string[];
  };

  /** Documentation requirements */
  documentation: {
    requiresPublicAPIDoc: boolean;
    requiresArchitectureDoc: boolean;
    requiresChangeLog: boolean;
    minDocCoveragePercent: number;
  };

  /** Reliability requirements */
  reliability: {
    targetAvailability: number;       // e.g., 0.999
    maxAcceptableDowntimeMinutes: number;
    requiresDisasterRecovery: boolean;
  };
}

/**
 * Empirical distributions from observed data enable calibrated confidence
 */
interface EmpiricalDistributions {
  /** Distribution source metadata */
  source: {
    datasetId: string;
    sampleSize: number;
    collectionPeriod: { start: string; end: string };
    representativeness: string;  // Description of what this data represents
  };

  /** Performance metric distributions */
  latencyDistribution: {
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
    mean: number;
    stdDev: number;
  };

  /** Code quality distributions */
  complexityDistribution: {
    median: number;
    mean: number;
    stdDev: number;
    percentiles: Record<number, number>;  // e.g., { 25: 5, 50: 8, 75: 15, 90: 25 }
  };

  /** Test coverage distributions */
  coverageDistribution: {
    median: number;
    mean: number;
    stdDev: number;
    byCodeType: Record<CodeType, { median: number; mean: number }>;
  };

  /** Bug rate distributions */
  defectDensity: {
    median: number;        // defects per KLOC
    mean: number;
    stdDev: number;
    byComplexity: Record<'low' | 'medium' | 'high', number>;
  };
}

/**
 * Metric interpreters convert raw measurements to domain-meaningful assessments
 */
type MetricInterpreterMap = {
  [metricName: string]: MetricInterpreter;
};

interface MetricInterpreter {
  /** Convert raw value to quality assessment */
  interpret(value: number): QualityAssessment;

  /** Compare to domain norm */
  compareToNorm(value: number): NormComparison;

  /** Compare to empirical distribution */
  compareToDistribution(value: number): DistributionPosition;
}

interface QualityAssessment {
  rating: 'excellent' | 'good' | 'acceptable' | 'needs_improvement' | 'critical';
  explanation: string;
  confidence: ConfidenceValue;  // Uses principled confidence
}

interface NormComparison {
  withinNorm: boolean;
  deviation: number;           // How far from norm (positive = better, negative = worse)
  percentageOfThreshold: number;
}

interface DistributionPosition {
  percentile: number;          // Where this value falls in the distribution
  zScore: number;              // Standard deviations from mean
  interpretation: string;      // Human-readable interpretation
}
```

### Pre-defined Domain Contexts

```typescript
// ============================================================================
// PRE-DEFINED DOMAIN CONTEXTS
// ============================================================================

/**
 * Real-time gaming domain context
 */
export const DOMAIN_CONTEXT_REALTIME_GAMING: DomainContext = {
  id: 'realtime_gaming',
  name: 'Real-Time Gaming',
  codeType: 'real_time',
  domainNorms: {
    performance: {
      acceptableLatencyP50Ms: 8,       // Target 60fps = 16.67ms budget
      acceptableLatencyP99Ms: 16,      // Must never miss frame
      maxMemoryMB: 2048,               // Typical game memory budget
      maxCPUPercent: 80,               // Leave headroom for OS
    },
    quality: {
      minTestCoverage: 60,             // Games often have lower coverage
      maxCyclomaticComplexity: 20,     // Game logic can be complex
      maxFunctionLengthLines: 100,
      maxFileLengthLines: 1000,
      maxDuplicationPercent: 15,
    },
    security: {
      requiresSecurityReview: true,    // Anti-cheat concerns
      maxCriticalVulnerabilities: 0,
      maxHighVulnerabilities: 2,
      requiredComplianceFrameworks: [],
    },
    documentation: {
      requiresPublicAPIDoc: false,
      requiresArchitectureDoc: true,
      requiresChangeLog: true,
      minDocCoveragePercent: 30,
    },
    reliability: {
      targetAvailability: 0.99,
      maxAcceptableDowntimeMinutes: 60,
      requiresDisasterRecovery: false,
    },
  },
  empiricalDistributions: {
    source: {
      datasetId: 'gaming_industry_benchmarks_2024',
      sampleSize: 0,                   // Placeholder - needs real data
      collectionPeriod: { start: '', end: '' },
      representativeness: 'uncalibrated',
    },
    latencyDistribution: { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, mean: 0, stdDev: 0 },
    complexityDistribution: { median: 0, mean: 0, stdDev: 0, percentiles: {} },
    coverageDistribution: { median: 0, mean: 0, stdDev: 0, byCodeType: {} as any },
    defectDensity: { median: 0, mean: 0, stdDev: 0, byComplexity: { low: 0, medium: 0, high: 0 } },
  },
  metricInterpreters: {},  // Requires implementation
};

/**
 * Financial services domain context
 */
export const DOMAIN_CONTEXT_FINANCIAL: DomainContext = {
  id: 'financial_services',
  name: 'Financial Services',
  codeType: 'financial',
  domainNorms: {
    performance: {
      acceptableLatencyP50Ms: 100,
      acceptableLatencyP99Ms: 500,
      maxMemoryMB: 8192,
      maxCPUPercent: 70,
    },
    quality: {
      minTestCoverage: 90,             // High coverage required
      maxCyclomaticComplexity: 10,     // Keep logic simple and auditable
      maxFunctionLengthLines: 50,
      maxFileLengthLines: 500,
      maxDuplicationPercent: 5,
    },
    security: {
      requiresSecurityReview: true,
      maxCriticalVulnerabilities: 0,
      maxHighVulnerabilities: 0,
      requiredComplianceFrameworks: ['SOC2', 'PCI-DSS'],
    },
    documentation: {
      requiresPublicAPIDoc: true,
      requiresArchitectureDoc: true,
      requiresChangeLog: true,
      minDocCoveragePercent: 80,
    },
    reliability: {
      targetAvailability: 0.9999,
      maxAcceptableDowntimeMinutes: 5,
      requiresDisasterRecovery: true,
    },
  },
  empiricalDistributions: {
    source: {
      datasetId: 'financial_industry_benchmarks_2024',
      sampleSize: 0,
      collectionPeriod: { start: '', end: '' },
      representativeness: 'uncalibrated',
    },
    latencyDistribution: { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, mean: 0, stdDev: 0 },
    complexityDistribution: { median: 0, mean: 0, stdDev: 0, percentiles: {} },
    coverageDistribution: { median: 0, mean: 0, stdDev: 0, byCodeType: {} as any },
    defectDensity: { median: 0, mean: 0, stdDev: 0, byComplexity: { low: 0, medium: 0, high: 0 } },
  },
  metricInterpreters: {},
};

/**
 * Healthcare/HIPAA domain context
 */
export const DOMAIN_CONTEXT_HEALTHCARE: DomainContext = {
  id: 'healthcare',
  name: 'Healthcare / HIPAA',
  codeType: 'healthcare',
  domainNorms: {
    performance: {
      acceptableLatencyP50Ms: 200,
      acceptableLatencyP99Ms: 1000,
      maxMemoryMB: 4096,
      maxCPUPercent: 60,
    },
    quality: {
      minTestCoverage: 85,
      maxCyclomaticComplexity: 10,
      maxFunctionLengthLines: 50,
      maxFileLengthLines: 500,
      maxDuplicationPercent: 5,
    },
    security: {
      requiresSecurityReview: true,
      maxCriticalVulnerabilities: 0,
      maxHighVulnerabilities: 0,
      requiredComplianceFrameworks: ['HIPAA', 'HITECH'],
    },
    documentation: {
      requiresPublicAPIDoc: true,
      requiresArchitectureDoc: true,
      requiresChangeLog: true,
      minDocCoveragePercent: 90,
    },
    reliability: {
      targetAvailability: 0.9999,
      maxAcceptableDowntimeMinutes: 5,
      requiresDisasterRecovery: true,
    },
  },
  empiricalDistributions: {
    source: {
      datasetId: 'healthcare_industry_benchmarks_2024',
      sampleSize: 0,
      collectionPeriod: { start: '', end: '' },
      representativeness: 'uncalibrated',
    },
    latencyDistribution: { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, mean: 0, stdDev: 0 },
    complexityDistribution: { median: 0, mean: 0, stdDev: 0, percentiles: {} },
    coverageDistribution: { median: 0, mean: 0, stdDev: 0, byCodeType: {} as any },
    defectDensity: { median: 0, mean: 0, stdDev: 0, byComplexity: { low: 0, medium: 0, high: 0 } },
  },
  metricInterpreters: {},
};

/**
 * Prototype/MVP domain context - velocity over polish
 */
export const DOMAIN_CONTEXT_PROTOTYPE: DomainContext = {
  id: 'prototype',
  name: 'Prototype / MVP',
  codeType: 'prototype',
  domainNorms: {
    performance: {
      acceptableLatencyP50Ms: 1000,    // Users tolerate slowness in prototypes
      acceptableLatencyP99Ms: 5000,
      maxMemoryMB: 8192,
      maxCPUPercent: 100,
    },
    quality: {
      minTestCoverage: 20,             // Minimal tests for core paths
      maxCyclomaticComplexity: 30,     // Speed over elegance
      maxFunctionLengthLines: 200,
      maxFileLengthLines: 2000,
      maxDuplicationPercent: 30,       // Copy-paste is acceptable
    },
    security: {
      requiresSecurityReview: false,
      maxCriticalVulnerabilities: 5,   // Fix before production
      maxHighVulnerabilities: 20,
      requiredComplianceFrameworks: [],
    },
    documentation: {
      requiresPublicAPIDoc: false,
      requiresArchitectureDoc: false,
      requiresChangeLog: false,
      minDocCoveragePercent: 0,
    },
    reliability: {
      targetAvailability: 0.9,
      maxAcceptableDowntimeMinutes: 1440,  // Day of downtime acceptable
      requiresDisasterRecovery: false,
    },
  },
  empiricalDistributions: {
    source: {
      datasetId: 'startup_prototype_benchmarks',
      sampleSize: 0,
      collectionPeriod: { start: '', end: '' },
      representativeness: 'uncalibrated',
    },
    latencyDistribution: { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, mean: 0, stdDev: 0 },
    complexityDistribution: { median: 0, mean: 0, stdDev: 0, percentiles: {} },
    coverageDistribution: { median: 0, mean: 0, stdDev: 0, byCodeType: {} as any },
    defectDensity: { median: 0, mean: 0, stdDev: 0, byComplexity: { low: 0, medium: 0, high: 0 } },
  },
  metricInterpreters: {},
};
```

### Quality Metric Interpretation Example

```typescript
/**
 * Example: Interpreting test coverage based on domain context
 */
function interpretTestCoverage(
  coverage: number,
  context: DomainContext
): QualityAssessment {
  const norm = context.domainNorms.quality.minTestCoverage;

  if (coverage >= norm * 1.2) {
    return {
      rating: 'excellent',
      explanation: `Coverage ${coverage}% exceeds ${context.name} norm of ${norm}% by 20%+`,
      confidence: { type: 'absent', reason: 'uncalibrated' },  // Honest: no calibration data
    };
  }

  if (coverage >= norm) {
    return {
      rating: 'good',
      explanation: `Coverage ${coverage}% meets ${context.name} norm of ${norm}%`,
      confidence: { type: 'absent', reason: 'uncalibrated' },
    };
  }

  if (coverage >= norm * 0.8) {
    return {
      rating: 'acceptable',
      explanation: `Coverage ${coverage}% is within 20% of ${context.name} norm of ${norm}%`,
      confidence: { type: 'absent', reason: 'uncalibrated' },
    };
  }

  if (coverage >= norm * 0.5) {
    return {
      rating: 'needs_improvement',
      explanation: `Coverage ${coverage}% is significantly below ${context.name} norm of ${norm}%`,
      confidence: { type: 'absent', reason: 'uncalibrated' },
    };
  }

  return {
    rating: 'critical',
    explanation: `Coverage ${coverage}% is critically low for ${context.name} (norm: ${norm}%)`,
    confidence: { type: 'absent', reason: 'uncalibrated' },
  };
}
```

---

## Domain Construction Protocol (Infrastructure)

> **For ANY domain not explicitly listed, use this protocol:**

```typescript
/**
 * Domain Construction Protocol
 *
 * Given a new domain D, construct its LiBrainian support:
 */

function constructDomainSupport(domain: DomainDescription): TechniqueComposition {
  // Step 1: Decompose domain into fundamental aspects
  const aspects = decomposeToAspects(domain);
  // Example: "Quantum Computing IDE" ->
  //   { data: true, state: true, time: true, logic: true, structure: true, agency: true }

  // Step 2: Map aspects to primitives
  const primitives = aspects.flatMap(aspect => ASPECT_TO_PRIMITIVES[aspect]);
  // Example: ['tp_data_lineage', 'tp_state_trace', 'tp_timing_bound',
  //           'tp_algorithm_trace', 'tp_component_graph', 'tp_tool_orchestration']

  // Step 3: Identify domain-specific patterns
  const patterns = selectPatterns(domain, primitives);
  // Example: ['pattern_bug_investigation', 'pattern_performance_investigation']

  // Step 4: Compose with appropriate operators
  const operators = inferOperators(domain, primitives);
  // Example: parallel for independent analyses, sequence for dependent ones

  // Step 5: Generate composition
  return {
    id: `tc_${domain.id}`,
    name: `${domain.name} Analysis`,
    description: `Understand and modify ${domain.name} codebases`,
    primitives,
    operators,
    patterns,
  };
}

// Aspect -> Primitive mapping (the core of universal support)
const ASPECT_TO_PRIMITIVES: Record<FundamentalAspect, string[]> = {
  data:      ['tp_data_lineage', 'tp_artifact_trace'],
  state:     ['tp_state_trace'],
  time:      ['tp_timing_bound', 'tp_realtime_flow'],
  space:     ['tp_platform_map', 'tp_distribution_map'],
  logic:     ['tp_policy_verify', 'tp_algorithm_trace'],
  structure: ['tp_component_graph', 'tp_scale_pattern'],
  value:     ['tp_metric_trace'],
  agency:    ['tp_tool_orchestration'],
  media:     ['tp_media_pipeline'],
};

type FundamentalAspect =
  | 'data'
  | 'state'
  | 'time'
  | 'space'
  | 'logic'
  | 'structure'
  | 'value'
  | 'agency'
  | 'media';
```

### Example Domain Constructions

| Hypothetical Domain | Decomposition | Primitive Selection |
|---------------------|---------------|---------------------|
| **Quantum Computing IDE** | data, state, time, logic, agency | data_lineage, state_trace, timing_bound, algorithm_trace, tool_orchestration |
| **Brain-Computer Interface** | data, time, space, media, value | data_lineage, timing_bound, platform_map, media_pipeline, metric_trace |
| **Autonomous Vehicle Fleet** | state, time, space, logic, value | state_trace, realtime_flow, distribution_map, policy_verify, metric_trace |
| **Gene Editing Platform** | data, state, logic, value | data_lineage, state_trace, policy_verify, metric_trace |
| **Climate Simulation** | data, time, space, structure | data_lineage, timing_bound, distribution_map, scale_pattern |
| **Digital Twin System** | data, state, time, space, structure | data_lineage, state_trace, realtime_flow, platform_map, component_graph |
| **Metaverse Platform** | state, space, media, structure, value | state_trace, distribution_map, media_pipeline, component_graph, metric_trace |
| **Cryptocurrency Exchange** | state, time, logic, value | state_trace, timing_bound, policy_verify, metric_trace |
| **AI Training Pipeline** | data, time, logic, value | data_lineage, timing_bound, algorithm_trace, metric_trace |
| **Space Mission Control** | state, time, space, logic, agency | state_trace, realtime_flow, distribution_map, policy_verify, tool_orchestration |

---

## Aspect Decomposer (LLM Infrastructure)

The Aspect Decomposer is an LLM-assisted component that automatically decomposes any domain description into its fundamental aspects.

### Specification

```typescript
/**
 * LLM-assisted aspect identification for domain construction.
 *
 * Given a domain description in natural language, identifies which
 * of the 9 fundamental computational aspects are relevant.
 */

interface AspectDecomposer {
  /**
   * Decompose a domain into fundamental aspects.
   *
   * @param domain - Description of the domain (natural language)
   * @returns Set of relevant fundamental aspects
   */
  decomposeToAspects(domain: DomainDescription): Promise<FundamentalAspect[]>;

  /**
   * Explain why each aspect is relevant to the domain.
   *
   * @param domain - Description of the domain
   * @param aspects - Identified aspects
   * @returns Explanation for each aspect
   */
  explainAspects(
    domain: DomainDescription,
    aspects: FundamentalAspect[]
  ): Promise<Map<FundamentalAspect, string>>;

  /**
   * Suggest additional aspects that might be relevant but weren't
   * immediately obvious from the domain description.
   */
  suggestAdditionalAspects(
    domain: DomainDescription,
    currentAspects: FundamentalAspect[]
  ): Promise<FundamentalAspect[]>;
}

interface DomainDescription {
  name: string;
  description: string;
  exampleUseCases: string[];
  constraints?: string[];
  relatedDomains?: string[];
}
```

### LLM Prompt Template

```
Given a software domain, identify which of the 9 fundamental computational aspects are relevant.

FUNDAMENTAL ASPECTS:
1. DATA - Data flows, transformations, lineage
2. STATE - State machines, transitions, lifecycle
3. TIME - Timing constraints, real-time requirements, sequences
4. SPACE - Deployment topology, distribution, platforms
5. LOGIC - Business rules, policies, algorithms
6. STRUCTURE - Component organization, composition
7. VALUE - Business metrics, outcomes, KPIs
8. AGENCY - External tools, agents, automation
9. MEDIA - Content, assets, media processing

DOMAIN: {domain.name}
DESCRIPTION: {domain.description}
USE CASES: {domain.exampleUseCases.join(', ')}

For each relevant aspect, explain why it matters for this domain.
Return ONLY the aspects that are genuinely important, not all 9.
```

---

## Architecture: Universal Domain Support

```
+-----------------------------------------------------------------------------+
|                    LiBrainian UNIVERSAL DOMAIN ARCHITECTURE                   |
|                                                                             |
|  +---------------------------------------------------------------------+    |
|  | LAYER 1: FUNDAMENTAL PRIMITIVES (14 domain-agnostic)                |    |
|  |                                                                     |    |
|  | +------------+ +------------+ +------------+ +------------+        |    |
|  | | tp_data_   | | tp_state_  | | tp_timing_ | | tp_platform|        |    |
|  | | lineage    | | trace      | | bound      | | _map       |        |    |
|  | +------------+ +------------+ +------------+ +------------+        |    |
|  | +------------+ +------------+ +------------+ +------------+        |    |
|  | | tp_policy_ | | tp_algorithm| | tp_component| | tp_scale_  |        |    |
|  | | verify     | | _trace     | | _graph     | | pattern    |        |    |
|  | +------------+ +------------+ +------------+ +------------+        |    |
|  | +------------+ +------------+ +------------+ +------------+        |    |
|  | | tp_metric_ | | tp_tool_   | | tp_media_  | | tp_realtime|        |    |
|  | | trace      | | orchestrate| | pipeline   | | _flow      |        |    |
|  | +------------+ +------------+ +------------+ +------------+        |    |
|  |                 +------------+ +------------+                       |    |
|  |                 | tp_artifact| | tp_distrib |                       |    |
|  |                 | _trace     | | _map       |                       |    |
|  |                 +------------+ +------------+                       |    |
|  +---------------------------------------------------------------------+    |
|                                    |                                        |
|                                    v                                        |
|  +---------------------------------------------------------------------+    |
|  | LAYER 2: COMPOSITION OPERATORS (6 types)                            |    |
|  |                                                                     |    |
|  |  sequence  |  parallel  |  conditional  |  loop  |  gate  | quorum  |    |
|  |     -->    |    ===     |     <>--      |   R    |   |-   |   (+)   |    |
|  |                                                                     |    |
|  |  Rules: Closure (A o B -> C), Associativity, Identity              |    |
|  +---------------------------------------------------------------------+    |
|                                    |                                        |
|                                    v                                        |
|  +---------------------------------------------------------------------+    |
|  | LAYER 3: COMPOSITIONS (Built from primitives + operators)           |    |
|  |                                                                     |    |
|  |  tc_social_platform    tc_video_platform    tc_industrial_backend   |    |
|  |  tc_developer_tool     tc_dashboard         tc_landing_page         |    |
|  |  tc_payment_system     tc_e_commerce        tc_search_system        |    |
|  |  tc_notification       tc_[user_defined]    tc_[auto_generated]     |    |
|  |                                                                     |    |
|  |  + Domain Construction Protocol for ANY new domain                  |    |
|  +---------------------------------------------------------------------+    |
|                                    |                                        |
|                                    v                                        |
|  +---------------------------------------------------------------------+    |
|  | LAYER 4: PATTERNS (Reusable composition templates)                  |    |
|  |                                                                     |    |
|  |  pattern_bug_investigation      pattern_performance_investigation   |    |
|  |  pattern_change_verification    pattern_release_verification        |    |
|  |  pattern_feature_construction   pattern_refactoring                 |    |
|  |  pattern_multi_agent_task       pattern_self_improvement            |    |
|  |                                                                     |    |
|  |  Patterns select and configure compositions for common tasks        |    |
|  +---------------------------------------------------------------------+    |
|                                    |                                        |
|                                    v                                        |
|  +---------------------------------------------------------------------+    |
|  | LAYER 5: LCL (LiBrainian Configuration Language)                     |    |
|  |                                                                     |    |
|  |  lcl.compose('my_domain')                                           |    |
|  |     .use('tc_social_platform')                                      |    |
|  |     .override({ primitives: ['tp_realtime_flow', 'tp_metric_trace']}) |    |
|  |     .when('domain.hasPayments').add('tc_payment_system')            |    |
|  |     .build()                                                        |    |
|  |                                                                     |    |
|  |  Declarative composition of any domain from existing structures     |    |
|  +---------------------------------------------------------------------+    |
|                                                                             |
+-----------------------------------------------------------------------------+
```

---

## Integration with Existing LiBrainian Structures

| LiBrainian Structure | File | Role in Universal Support |
|---------------------|------|--------------------------|
| **TechniquePrimitive** | `technique_library.ts` | Defines the 14 fundamental primitives |
| **TechniqueComposition** | `technique_compositions.ts` | Pre-built domain compositions |
| **TechniqueOperator** | `operator_registry.ts` | 6 composition operators |
| **CompositionPattern** | `pattern_catalog.ts` | Reusable composition templates |
| **CompositionBuilder** | `technique_composition_builder.ts` | Fluent API for building compositions |
| **LCLExpression** | `lcl.ts` | Declarative configuration |
| **DomainConstructor** | `domain_constructor.ts` | Auto-generates compositions |

### Pattern Integration

| Pattern | + Domain Primitive | = New Capability |
|---------|-------------------|------------------|
| `pattern_bug_investigation` | `tp_state_trace` | Debug state machine bugs |
| `pattern_performance_investigation` | `tp_timing_bound` | Analyze real-time systems |
| `pattern_change_verification` | `tp_policy_verify` | Compliance-aware reviews |
| `pattern_feature_construction` | `tp_artifact_trace` | Design-to-code traceability |

---

## Acceptance Criteria

### D1: 14 Core Domain Primitives

- [ ] All 14 core primitives defined in `technique_library.ts`
- [ ] Each primitive has:
  - Unique ID following `tp_` prefix convention
  - Clear name and description
  - Typed inputs and outputs
  - Confidence value using `ConfidenceValue` type (not raw numbers)
  - Tier assignment (1, 2, or 3)
- [ ] Primitives registered in `DEFAULT_TECHNIQUE_PRIMITIVES`
- [ ] Unit tests for each primitive definition

### D2: 10 World-Class Compositions

- [ ] All 10 compositions defined in `technique_compositions.ts`
- [ ] Each composition has:
  - Unique ID following `tc_` prefix convention
  - List of required primitives
  - Operator definitions with correct inputs
  - Associated patterns
- [ ] Compositions are valid (pass composition validator)
- [ ] Integration tests demonstrating each composition

### D3: Security Audit Primitives

- [ ] `tp_security_scan` primitive implemented
- [ ] `tp_vulnerability_check` primitive implemented
- [ ] `tp_owasp_check` primitive implemented
- [ ] `tp_dependency_audit` primitive implemented
- [ ] Integration with at least one external scanner (semgrep, snyk, or trivy)
- [ ] All confidence values use `ConfidenceValue` type with `absent/uncalibrated`

### D4: Performance Investigation Primitives

- [ ] `tp_profile_analysis` primitive implemented
- [ ] `tp_bottleneck_detect` primitive implemented
- [ ] `tp_memory_analysis` primitive implemented
- [ ] `tp_latency_trace` primitive implemented
- [ ] Integration with profiling/tracing data formats
- [ ] All confidence values use `ConfidenceValue` type with `absent/uncalibrated`

### D5: API Design Review Primitives

- [ ] `tp_api_consistency_check` primitive implemented
- [ ] `tp_rest_convention_check` primitive implemented
- [ ] `tp_schema_validation` primitive implemented
- [ ] OpenAPI/GraphQL schema parsing support
- [ ] All confidence values use `ConfidenceValue` type with `absent/uncalibrated`

### D6: Dependency Upgrade Primitives

- [ ] `tp_breaking_change_detect` primitive implemented
- [ ] `tp_migration_path_suggest` primitive implemented
- [ ] `tp_compatibility_check` primitive implemented
- [ ] Integration with package manager metadata (npm, pypi, maven)
- [ ] All confidence values use `ConfidenceValue` type with `absent/uncalibrated`

### D7: Documentation Generation Primitives

- [ ] `tp_doc_structure_infer` primitive implemented
- [ ] `tp_example_generate` primitive implemented
- [ ] `tp_api_doc_generate` primitive implemented
- [ ] Support for JSDoc, TypeDoc, and Markdown output formats
- [ ] All confidence values use `ConfidenceValue` type with `absent/uncalibrated`

### D8: Technical Debt Assessment Primitives

- [ ] `tp_debt_identify` primitive implemented
- [ ] `tp_debt_prioritize` primitive implemented
- [ ] `tp_debt_impact_analyze` primitive implemented
- [ ] Integration with code complexity metrics
- [ ] All confidence values use `ConfidenceValue` type with `absent/uncalibrated`

### D9: Architecture Decision Primitives

- [ ] `tp_tradeoff_analyze` primitive implemented
- [ ] `tp_adr_generate` primitive implemented
- [ ] `tp_architecture_validate` primitive implemented
- [ ] ADR template support
- [ ] All confidence values use `ConfidenceValue` type with `absent/uncalibrated`

### D10: Legacy Code Analysis Primitives

- [ ] `tp_legacy_archaeology` primitive implemented
- [ ] `tp_safe_zone_identify` primitive implemented
- [ ] `tp_modernization_plan` primitive implemented
- [ ] Git history integration for archaeology
- [ ] All confidence values use `ConfidenceValue` type with `absent/uncalibrated`

### D11: Compliance Checking Primitives

- [ ] `tp_compliance_scan` primitive implemented
- [ ] `tp_evidence_collect` primitive implemented
- [ ] `tp_audit_report_generate` primitive implemented
- [ ] Support for GDPR, HIPAA, SOC2, PCI-DSS frameworks
- [ ] All confidence values use `ConfidenceValue` type with `absent/uncalibrated`

### Domain-Contextualized Quality Metrics

- [ ] `DomainContext` interface implemented
- [ ] `CodeType` enum with all 13 types
- [ ] `DomainNorms` interface with performance, quality, security, documentation, reliability thresholds
- [ ] `EmpiricalDistributions` interface with distribution tracking
- [ ] At least 4 pre-defined domain contexts (gaming, financial, healthcare, prototype)
- [ ] Quality metric interpretation functions

### Infrastructure: Domain Construction Protocol

- [ ] `constructDomainSupport()` function implemented
- [ ] `ASPECT_TO_PRIMITIVES` mapping complete (including new D3-D11 primitives)
- [ ] `selectPatterns()` helper implemented
- [ ] `inferOperators()` helper implemented
- [ ] Protocol generates valid compositions for all hypothetical domains

### Infrastructure: Aspect Decomposer (LLM)

- [ ] `AspectDecomposer` interface implemented
- [ ] LLM prompt template defined
- [ ] `decomposeToAspects()` returns valid aspects
- [ ] `explainAspects()` provides meaningful explanations
- [ ] Tests with diverse domain descriptions

### Infrastructure: Composition Validator

- [ ] `validateComposition()` function implemented
- [ ] Checks:
  - All referenced primitives exist
  - Operator inputs are valid primitive IDs
  - No circular dependencies
  - Patterns are compatible with primitives
- [ ] Clear error messages for validation failures

### Infrastructure: Universal Domain Tests

- [ ] Test suite for each of the 10 hypothetical domains
- [ ] Tests verify:
  - Domain construction protocol produces valid composition
  - Composition can be executed
  - Expected primitives are selected
- [ ] Edge cases: empty domain, conflicting aspects

---

## Evidence Commands

```bash
# Verify D1 core primitive definitions
rg "tp_algorithm_trace|tp_component_graph|tp_scale_pattern|tp_realtime_flow|tp_media_pipeline|tp_tool_orchestration|tp_distribution_map" packages/LiBrainian/src

# Verify D2 composition definitions
rg "tc_social_platform|tc_video_platform|tc_industrial_backend|tc_developer_tool|tc_dashboard|tc_landing_page|tc_payment_system|tc_e_commerce|tc_search_system|tc_notification" packages/LiBrainian/src

# Verify D3 security audit primitives
rg "tp_security_scan|tp_vulnerability_check|tp_owasp_check|tp_dependency_audit" packages/LiBrainian/src

# Verify D4 performance investigation primitives
rg "tp_profile_analysis|tp_bottleneck_detect|tp_memory_analysis|tp_latency_trace" packages/LiBrainian/src

# Verify D5 API design review primitives
rg "tp_api_consistency_check|tp_rest_convention_check|tp_schema_validation" packages/LiBrainian/src

# Verify D6 dependency upgrade primitives
rg "tp_breaking_change_detect|tp_migration_path_suggest|tp_compatibility_check" packages/LiBrainian/src

# Verify D7 documentation generation primitives
rg "tp_doc_structure_infer|tp_example_generate|tp_api_doc_generate" packages/LiBrainian/src

# Verify D8 technical debt assessment primitives
rg "tp_debt_identify|tp_debt_prioritize|tp_debt_impact_analyze" packages/LiBrainian/src

# Verify D9 architecture decision primitives
rg "tp_tradeoff_analyze|tp_adr_generate|tp_architecture_validate" packages/LiBrainian/src

# Verify D10 legacy code analysis primitives
rg "tp_legacy_archaeology|tp_safe_zone_identify|tp_modernization_plan" packages/LiBrainian/src

# Verify D11 compliance checking primitives
rg "tp_compliance_scan|tp_evidence_collect|tp_audit_report_generate" packages/LiBrainian/src

# Verify DomainContext and quality metrics
rg "DomainContext|DomainNorms|EmpiricalDistributions|CodeType" packages/LiBrainian/src

# Run domain tests
npm run test -- --grep "universal domain"

# Verify aspect mapping completeness
rg "ASPECT_TO_PRIMITIVES" packages/LiBrainian/src
```

---

## Key Insights from the 25 Greats

**Dijkstra**: "We cannot enumerate all possible domains, but we can identify all fundamental computational concerns. The 9 aspects above are grounded in computation theory, not domain enumeration."

**Kay**: "The test of a truly object-oriented system is whether new kinds of objects can be added without changing the system. The test of truly universal primitives is whether new domains can be supported without adding primitives."

**Armstrong**: "Let the domain fail gracefully. If someone tries to use LiBrainian for a domain and finds it inadequate, the failure should clearly indicate which fundamental aspect is missing - then we can add a primitive."

**Naur**: "Don't build 40 domain-specific modules. Build primitives that COMPOSE into domain support."

**Thompson**: "The test is composability. Can a user combine these for domain #25 without our help? With 7 composable primitives: yes. With 24 domain modules: no. Composability scales; enumeration doesn't."

---

## References

- Part XIX: Modular Configuration Language (lines 18438+)
- Use Case Coverage Analysis (lines 18523+)
- Domain-bridging primitives (lines 16260+)
- Universal Domain Support overview (lines 615-644)
