/**
 * @fileoverview Persona-Based Knowledge Projections
 *
 * Different stakeholders need different views of the same knowledge.
 * This module projects UniversalKnowledge into persona-specific views
 * that highlight what matters to each role.
 *
 * Personas:
 * - Programmer: How do I use/modify this?
 * - Engineer: Is this reliable/performant?
 * - Manager: What's the risk/effort/ownership?
 * - Designer: What's the architecture/patterns?
 * - QA: Is this testable/tested?
 * - Security: Is this safe?
 * - Scientist: What's the algorithm/complexity?
 * - Product: What features does this enable?
 */

import type { UniversalKnowledge, EntityQuality, EntitySecurity } from '../knowledge/universal_types.js';

// ============================================================================
// TYPES
// ============================================================================

export type Persona =
  | 'programmer'     // How do I use/modify this?
  | 'engineer'       // Is this reliable/performant?
  | 'manager'        // What's the risk/effort/ownership?
  | 'designer'       // What's the architecture/patterns?
  | 'qa'             // Is this testable/tested?
  | 'security'       // Is this safe?
  | 'scientist'      // What's the algorithm/complexity?
  | 'product';       // What features does this enable?

export interface PersonaView {
  persona: Persona;
  summary: string;           // One-paragraph summary tailored to persona
  keyMetrics: KeyMetric[];   // What this persona cares about
  alerts: Alert[];           // What this persona should know NOW
  actions: Action[];         // What this persona might want to do
  drilldown: string[];       // How to get more detail
  health: HealthIndicator;   // Quick health assessment
}

export interface KeyMetric {
  name: string;
  value: string | number;
  trend?: 'up' | 'down' | 'stable';
  status?: 'good' | 'warning' | 'critical';
}

export interface Alert {
  level: 'info' | 'warning' | 'error';
  message: string;
  action?: string;
}

export interface Action {
  label: string;
  query: string;        // Query to execute for this action
  description?: string;
}

export interface HealthIndicator {
  score: number;        // 0-100
  status: 'green' | 'yellow' | 'red';
  summary: string;
}

export interface GlanceCard {
  title: string;
  subtitle: string;
  healthIndicator: 'green' | 'yellow' | 'red';
  quickStats: Array<{ label: string; value: string | number }>;
  oneLiner: string;     // The most important thing to know
  expandTo: string;     // Query for more detail
}

// ============================================================================
// MAIN PROJECTION FUNCTION
// ============================================================================

/**
 * Project UniversalKnowledge for a specific persona.
 */
export function projectForPersona(
  knowledge: UniversalKnowledge,
  persona: Persona
): PersonaView {
  switch (persona) {
    case 'programmer':
      return projectProgrammerView(knowledge);
    case 'engineer':
      return projectEngineerView(knowledge);
    case 'manager':
      return projectManagerView(knowledge);
    case 'designer':
      return projectDesignerView(knowledge);
    case 'qa':
      return projectQAView(knowledge);
    case 'security':
      return projectSecurityView(knowledge);
    case 'scientist':
      return projectScientistView(knowledge);
    case 'product':
      return projectProductView(knowledge);
    default:
      return projectProgrammerView(knowledge); // Default
  }
}

// ============================================================================
// PERSONA-SPECIFIC PROJECTIONS
// ============================================================================

function projectProgrammerView(k: UniversalKnowledge): PersonaView {
  const health = calculateHealth(k);
  const cognitiveComplexity = k.quality?.complexity?.cognitive ?? 0;
  const coverage = getCoveragePercent(k);
  const gotchas = k.ownership?.knowledge?.gotchas ?? [];

  return {
    persona: 'programmer',
    summary: generateProgrammerSummary(k),
    keyMetrics: [
      { name: 'Complexity', value: cognitiveComplexity, status: cognitiveComplexity > 15 ? 'warning' : 'good' },
      { name: 'Coverage', value: `${coverage}%`, status: coverage < 50 ? 'warning' : 'good' },
      { name: 'Gotchas', value: gotchas.length, status: gotchas.length > 3 ? 'warning' : 'good' },
      { name: 'Lines', value: k.quality?.complexity?.lines ?? 0 },
    ],
    alerts: gotchas.map(g => ({
      level: 'warning' as const,
      message: g.description,
      action: g.prevention,
    })),
    actions: [
      { label: 'See Usage Examples', query: `examples:${k.id}` },
      { label: 'Find Similar Code', query: `similar:${k.id}` },
      { label: 'View Tests', query: `tests:${k.id}` },
      { label: 'Show Dependencies', query: `deps:${k.id}` },
    ],
    drilldown: ['semantics.mechanism', 'contract', 'testing', 'ownership.knowledge'],
    health,
  };
}

function projectEngineerView(k: UniversalKnowledge): PersonaView {
  const health = calculateHealth(k);
  const maintainability = k.quality?.maintainability?.index ?? 50;
  const technicalDebt = k.quality?.maintainability?.technicalDebt?.minutes ?? 0;
  const churn = k.quality?.churn?.changeFrequency ?? 0;

  const alerts: Alert[] = [];

  if (technicalDebt > 60) {
    alerts.push({
      level: 'warning',
      message: `Technical debt: ${technicalDebt} minutes estimated remediation`,
      action: 'Consider refactoring',
    });
  }

  if (churn > 10) {
    alerts.push({
      level: 'info',
      message: `High churn: ${churn} changes/month - may indicate instability`,
    });
  }

  return {
    persona: 'engineer',
    summary: generateEngineerSummary(k),
    keyMetrics: [
      { name: 'Maintainability', value: maintainability, status: maintainability < 50 ? 'warning' : 'good' },
      { name: 'Tech Debt', value: `${technicalDebt}min`, status: technicalDebt > 60 ? 'warning' : 'good' },
      { name: 'Churn', value: `${churn}/mo`, status: churn > 10 ? 'warning' : 'good' },
      { name: 'Coupling', value: k.relationships?.coupling?.efferent ?? 0 },
    ],
    alerts,
    actions: [
      { label: 'View Hotspots', query: `hotspots:${k.id}` },
      { label: 'Show Coupling', query: `coupling:${k.id}` },
      { label: 'Refactoring Suggestions', query: `refactor:${k.id}` },
    ],
    drilldown: ['quality.complexity', 'quality.maintainability', 'relationships.coupling'],
    health,
  };
}

function projectManagerView(k: UniversalKnowledge): PersonaView {
  const health = calculateHealth(k);
  const technicalDebt = k.quality?.maintainability?.technicalDebt?.minutes ?? 0;
  const riskScoreValue = k.security?.riskScore?.overall;
  const riskScore = riskScoreValue ?? 0;
  const riskScoreLabel = riskScoreValue == null ? 'not analyzed' : `${riskScore}/10`;
  const owner = k.ownership?.owner?.primary?.name ?? 'Unknown';
  const churn = k.quality?.churn?.changeFrequency ?? 0;

  const alerts: Alert[] = [];

  if (riskScore > 7) {
    alerts.push({
      level: 'error',
      message: `High security risk: ${riskScore}/10`,
      action: 'Schedule security review',
    });
  }

  if (technicalDebt > 120) {
    alerts.push({
      level: 'warning',
      message: `Significant technical debt: ${Math.round(technicalDebt / 60)}h estimated`,
    });
  }

  return {
    persona: 'manager',
    summary: generateManagerSummary(k),
    keyMetrics: [
      { name: 'Tech Debt', value: `${Math.round(technicalDebt / 60)}h`, status: technicalDebt > 120 ? 'warning' : 'good' },
      { name: 'Risk Score', value: riskScoreLabel, status: riskScoreValue == null ? 'warning' : riskScore > 5 ? 'warning' : 'good' },
      { name: 'Churn', value: `${churn}/mo`, status: churn > 10 ? 'warning' : 'good' },
      { name: 'Owner', value: owner },
    ],
    alerts,
    actions: [
      { label: 'View Ownership', query: `ownership:${k.id}` },
      { label: 'Estimate Refactor', query: `estimate:${k.id}` },
      { label: 'Show Dependencies', query: `blast:${k.id}` },
      { label: 'Risk Assessment', query: `risk:${k.id}` },
    ],
    drilldown: ['ownership', 'quality.maintainability', 'rationale.risks', 'security.riskScore'],
    health,
  };
}

function projectDesignerView(k: UniversalKnowledge): PersonaView {
  const health = calculateHealth(k);
  const patterns = k.semantics?.mechanism?.patterns ?? [];
  const layer = k.relationships?.layer ?? 'unknown';
  const cohesion = k.relationships?.cohesion?.score ?? 0;

  return {
    persona: 'designer',
    summary: generateDesignerSummary(k),
    keyMetrics: [
      { name: 'Patterns', value: patterns.length },
      { name: 'Layer', value: layer },
      { name: 'Cohesion', value: `${Math.round(cohesion * 100)}%`, status: cohesion < 0.5 ? 'warning' : 'good' },
      { name: 'Coupling', value: k.relationships?.coupling?.instability?.toFixed(2) ?? 'N/A' },
    ],
    alerts: [],
    actions: [
      { label: 'Show Architecture', query: `architecture:${k.id}` },
      { label: 'View Patterns', query: `patterns:${k.id}` },
      { label: 'Component Diagram', query: `diagram:${k.id}` },
      { label: 'Dependency Graph', query: `graph:${k.id}` },
    ],
    drilldown: ['relationships', 'semantics.mechanism.patterns', 'rationale.decisions'],
    health,
  };
}

function projectQAView(k: UniversalKnowledge): PersonaView {
  const health = calculateHealth(k);
  const coverage = getCoveragePercent(k);
  const testCount = k.testing?.tests?.length ?? 0;
  const flakyScore = k.testing?.history?.flakyScore ?? 0;
  const assertions = k.testing?.assertions?.length ?? 0;

  const alerts: Alert[] = [];

  if (coverage < 50) {
    alerts.push({
      level: 'warning',
      message: `Low test coverage: ${coverage}%`,
      action: 'Add tests',
    });
  }

  if (flakyScore > 0.1) {
    alerts.push({
      level: 'warning',
      message: `Flaky tests detected: ${Math.round(flakyScore * 100)}% flakiness`,
    });
  }

  return {
    persona: 'qa',
    summary: generateQASummary(k),
    keyMetrics: [
      { name: 'Coverage', value: `${coverage}%`, status: coverage < 50 ? 'warning' : 'good' },
      { name: 'Tests', value: testCount },
      { name: 'Assertions', value: assertions },
      { name: 'Flakiness', value: `${Math.round(flakyScore * 100)}%`, status: flakyScore > 0.1 ? 'warning' : 'good' },
    ],
    alerts,
    actions: [
      { label: 'View Tests', query: `tests:${k.id}` },
      { label: 'Coverage Details', query: `coverage:${k.id}` },
      { label: 'Edge Cases', query: `edges:${k.id}` },
      { label: 'Flaky Tests', query: `flaky:${k.id}` },
    ],
    drilldown: ['testing', 'contract.behavior', 'quality.coverage'],
    health,
  };
}

function projectSecurityView(k: UniversalKnowledge): PersonaView {
  const health = calculateSecurityHealth(k);
  const riskScoreValue = k.security?.riskScore?.overall;
  const riskScore = riskScoreValue ?? 0;
  const riskScoreLabel = riskScoreValue == null ? 'not analyzed' : `${riskScore}/10`;
  const vulnerabilities = k.security?.vulnerabilities?.length ?? 0;
  const cweCount = k.security?.cwe?.length ?? 0;

  const alerts: Alert[] = [];

  if (vulnerabilities > 0) {
    alerts.push({
      level: 'error',
      message: `${vulnerabilities} potential vulnerabilities detected`,
      action: 'Review and remediate',
    });
  }

  if (riskScore > 7) {
    alerts.push({
      level: 'error',
      message: `High risk score: ${riskScore}/10`,
    });
  }

  return {
    persona: 'security',
    summary: generateSecuritySummary(k),
    keyMetrics: [
      { name: 'Risk Score', value: riskScoreLabel, status: riskScoreValue == null ? 'warning' : riskScore > 5 ? 'warning' : 'good' },
      { name: 'Vulnerabilities', value: vulnerabilities, status: vulnerabilities > 0 ? 'critical' : 'good' },
      { name: 'CWE Matches', value: cweCount },
      { name: 'Confidentiality', value: k.security?.riskScore?.confidentiality ?? 'N/A' },
    ],
    alerts,
    actions: [
      { label: 'Vulnerability Details', query: `vulns:${k.id}` },
      { label: 'Attack Surface', query: `attack:${k.id}` },
      { label: 'Security Controls', query: `controls:${k.id}` },
      { label: 'Compliance Check', query: `compliance:${k.id}` },
    ],
    drilldown: ['security', 'contract.behavior.sideEffects', 'relationships.dependents'],
    health,
  };
}

function projectScientistView(k: UniversalKnowledge): PersonaView {
  const health = calculateHealth(k);
  const timeComplexity = k.semantics?.complexity?.time ?? 'Unknown';
  const spaceComplexity = k.semantics?.complexity?.space ?? 'Unknown';
  const algorithm = k.semantics?.mechanism?.algorithm ?? 'Not specified';
  const cognitiveComplexity = k.semantics?.complexity?.cognitive ?? 'Unknown';

  return {
    persona: 'scientist',
    summary: generateScientistSummary(k),
    keyMetrics: [
      { name: 'Time', value: timeComplexity },
      { name: 'Space', value: spaceComplexity },
      { name: 'Algorithm', value: algorithm },
      { name: 'Cognitive', value: cognitiveComplexity },
    ],
    alerts: [],
    actions: [
      { label: 'Algorithm Details', query: `algorithm:${k.id}` },
      { label: 'Complexity Analysis', query: `complexity:${k.id}` },
      { label: 'Data Structures', query: `structures:${k.id}` },
      { label: 'Proofs/Invariants', query: `proofs:${k.id}` },
    ],
    drilldown: ['semantics.mechanism', 'semantics.complexity', 'contract.behavior.invariants'],
    health,
  };
}

function projectProductView(k: UniversalKnowledge): PersonaView {
  const health = calculateHealth(k);
  const purpose = k.semantics?.purpose?.summary ?? 'No summary';
  const businessContext = k.semantics?.purpose?.businessContext ?? 'Unknown';

  return {
    persona: 'product',
    summary: purpose,
    keyMetrics: [
      { name: 'Business Context', value: businessContext },
      { name: 'Primary Use Case', value: k.semantics?.intent?.primaryUseCase ?? 'Unknown' },
      { name: 'Kind', value: k.kind },
      { name: 'Module', value: k.module },
    ],
    alerts: [],
    actions: [
      { label: 'Feature Mapping', query: `features:${k.id}` },
      { label: 'User Stories', query: `stories:${k.id}` },
      { label: 'Usage Analytics', query: `usage:${k.id}` },
    ],
    drilldown: ['semantics.purpose', 'semantics.intent', 'traceability.userStories'],
    health,
  };
}

// ============================================================================
// SUMMARY GENERATORS
// ============================================================================

function generateProgrammerSummary(k: UniversalKnowledge): string {
  const name = k.name;
  const kind = k.kind;
  const purpose = k.semantics?.purpose?.summary ?? 'No description available';
  const complexity = k.quality?.complexity?.cognitive ?? 'unknown';

  return `${kind} "${name}": ${purpose} Cognitive complexity: ${complexity}.`;
}

function generateEngineerSummary(k: UniversalKnowledge): string {
  const name = k.name;
  const maintainability = k.quality?.maintainability?.rating ?? 'N/A';
  const debt = k.quality?.maintainability?.technicalDebt?.minutes ?? 0;
  const churn = k.quality?.churn?.changeFrequency ?? 0;

  return `${name} has maintainability rating ${maintainability}, ${debt} min tech debt, ${churn} changes/month.`;
}

function generateManagerSummary(k: UniversalKnowledge): string {
  const name = k.name;
  const owner = k.ownership?.owner?.primary?.name ?? 'Unassigned';
  const risk = k.security?.riskScore?.overall;
  const riskText = risk == null ? 'not analyzed' : `${risk}/10`;
  const debt = Math.round((k.quality?.maintainability?.technicalDebt?.minutes ?? 0) / 60);

  return `${name} owned by ${owner}. Risk: ${riskText}. Estimated debt: ${debt}h.`;
}

function generateDesignerSummary(k: UniversalKnowledge): string {
  const name = k.name;
  const patterns = k.semantics?.mechanism?.patterns ?? [];
  const layer = k.relationships?.layer ?? 'unknown';

  return `${name} in ${layer} layer. Patterns: ${patterns.join(', ') || 'none detected'}.`;
}

function generateQASummary(k: UniversalKnowledge): string {
  const name = k.name;
  const coverage = getCoveragePercent(k);
  const testCount = k.testing?.tests?.length ?? 0;

  return `${name}: ${coverage}% coverage, ${testCount} linked tests.`;
}

function generateSecuritySummary(k: UniversalKnowledge): string {
  const name = k.name;
  const risk = k.security?.riskScore?.overall;
  const riskText = risk == null ? 'not analyzed' : `${risk}/10`;
  const vulns = k.security?.vulnerabilities?.length ?? 0;

  return `${name}: Risk ${riskText}, ${vulns} potential vulnerabilities.`;
}

function generateScientistSummary(k: UniversalKnowledge): string {
  const name = k.name;
  const time = k.semantics?.complexity?.time ?? 'unknown';
  const space = k.semantics?.complexity?.space ?? 'unknown';
  const algo = k.semantics?.mechanism?.algorithm ?? 'not specified';

  return `${name}: ${algo}. Time: ${time}, Space: ${space}.`;
}

// ============================================================================
// HELPERS
// ============================================================================

function calculateHealth(k: UniversalKnowledge): HealthIndicator {
  const factors: number[] = [];

  // Coverage
  const coverage = getCoveragePercent(k);
  factors.push(coverage);

  // Maintainability
  const maintainability = k.quality?.maintainability?.index ?? 50;
  factors.push(maintainability);

  // Inverse risk (100 - risk*10)
  const risk = k.security?.riskScore?.overall ?? 0;
  factors.push(100 - risk * 10);

  // Inverse complexity (normalized)
  const complexity = k.quality?.complexity?.cognitive ?? 5;
  factors.push(Math.max(0, 100 - complexity * 5));

  const score = factors.length > 0
    ? Math.round(factors.reduce((a, b) => a + b, 0) / factors.length)
    : 50;

  return {
    score,
    status: score > 70 ? 'green' : score > 40 ? 'yellow' : 'red',
    summary: score > 70 ? 'Good health' : score > 40 ? 'Needs attention' : 'Critical issues',
  };
}

function calculateSecurityHealth(k: UniversalKnowledge): HealthIndicator {
  const risk = k.security?.riskScore?.overall ?? 0;
  const vulns = k.security?.vulnerabilities?.length ?? 0;

  const score = Math.max(0, 100 - risk * 10 - vulns * 15);

  return {
    score,
    status: score > 70 ? 'green' : score > 40 ? 'yellow' : 'red',
    summary: score > 70 ? 'Low risk' : score > 40 ? 'Moderate risk' : 'High risk',
  };
}

function getCoveragePercent(k: UniversalKnowledge): number {
  const coverage = k.quality?.coverage;
  if (!coverage) return 0;

  // Average of available coverage metrics
  const values: number[] = [];
  if (typeof coverage.line === 'number') values.push(coverage.line);
  if (typeof coverage.branch === 'number') values.push(coverage.branch);
  if (typeof coverage.function === 'number') values.push(coverage.function);

  if (values.length === 0) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100);
}

// ============================================================================
// GLANCE CARD GENERATOR
// ============================================================================

/**
 * Generate an at-a-glance card for quick understanding.
 */
export function generateGlanceCard(knowledge: UniversalKnowledge): GlanceCard {
  const health = calculateHealth(knowledge);
  const coverage = getCoveragePercent(knowledge);

  return {
    title: knowledge.name,
    subtitle: `${knowledge.kind} in ${knowledge.module}`,
    healthIndicator: health.status,
    quickStats: [
      { label: 'Lines', value: knowledge.quality?.complexity?.lines ?? 0 },
      { label: 'Coverage', value: `${coverage}%` },
      { label: 'Complexity', value: knowledge.quality?.complexity?.cognitive ?? 'N/A' },
      { label: 'Age', value: formatAge(knowledge.quality?.churn?.lastChanged) },
    ],
    oneLiner: knowledge.semantics?.purpose?.summary ?? 'No description available',
    expandTo: `/knowledge/${knowledge.id}`,
  };
}

function formatAge(lastChanged?: string): string {
  if (!lastChanged) return 'Unknown';

  const now = new Date();
  const changed = new Date(lastChanged);
  const diffDays = Math.floor((now.getTime() - changed.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 1) return 'Today';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

// ============================================================================
// EXPORTS
// ============================================================================

export const ALL_PERSONAS: Persona[] = [
  'programmer',
  'engineer',
  'manager',
  'designer',
  'qa',
  'security',
  'scientist',
  'product',
];

/**
 * Get a quick persona-specific summary string.
 */
export function getPersonaSummary(
  knowledge: UniversalKnowledge,
  persona: Persona
): string {
  switch (persona) {
    case 'programmer':
      return generateProgrammerSummary(knowledge);
    case 'engineer':
      return generateEngineerSummary(knowledge);
    case 'manager':
      return generateManagerSummary(knowledge);
    case 'designer':
      return generateDesignerSummary(knowledge);
    case 'qa':
      return generateQASummary(knowledge);
    case 'security':
      return generateSecuritySummary(knowledge);
    case 'scientist':
      return generateScientistSummary(knowledge);
    case 'product':
      return knowledge.semantics?.purpose?.summary ?? 'No summary available';
    default:
      return generateProgrammerSummary(knowledge);
  }
}
