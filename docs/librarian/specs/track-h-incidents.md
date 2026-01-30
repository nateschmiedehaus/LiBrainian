# Track H: Incident Investigation

> **Source**: Extracted from `docs/librarian/specs/use-case-targets.md` (UC16)
> **Guarantee**: Librarian will support unified incident intelligence - log correlation, timeline reconstruction, blast radius analysis, and runbook execution
>
> **Librarian Story**: Chapter 8 (The Responder) - When production burns, Librarian becomes the unified intelligence layer across chaos.
>
> **Theory Reference**: All confidence values MUST use `ConfidenceValue` from Track D. See [GLOSSARY.md](./GLOSSARY.md) and [CONFIDENCE_REDESIGN.md](./CONFIDENCE_REDESIGN.md).
>
> **Related Specifications**:
> - [track-c-causal-reasoning.md](./track-c-causal-reasoning.md) - Root cause analysis via causal models
> - [track-k-business-knowledge.md](./track-k-business-knowledge.md) - Business impact assessment
> - [track-g-debugging.md](./track-g-debugging.md) - Debugging primitives for investigation

---

## CRITICAL: Principled Confidence (No Arbitrary Values)

**All confidence values MUST use `ConfidenceValue` type - raw numbers are FORBIDDEN.**

```typescript
// FORBIDDEN - arbitrary number
confidence: 0.7

// CORRECT - honest about uncertainty
confidence: {
  type: 'absent',
  reason: 'uncalibrated'
}

// CORRECT - deterministic operation
confidence: {
  type: 'deterministic',
  value: 1.0,
  reason: 'log_entry_timestamp_from_source'
}

// CORRECT - after calibration with real incident outcomes
confidence: {
  type: 'measured',
  value: 0.76,
  measurement: {
    datasetId: 'librarian_v1_incident_calibration',
    sampleSize: 150,
    accuracy: 0.76,
    confidenceInterval: [0.68, 0.84],
    measuredAt: '2026-01-23'
  }
}
```

---

## 1. Problem Statement

### The Fragmented Incident Response Limitation

Current incident investigation is **fragmented across tools**:

```typescript
// Current approach: manual correlation across systems
// 1. Check PagerDuty/OpsGenie for alert details
// 2. SSH into servers, grep logs
// 3. Check Datadog/Grafana for metrics
// 4. Cross-reference with recent deployments
// 5. Manually correlate timestamps
// 6. Build timeline in Google Docs
// 7. Hope you didn't miss anything

// Problems:
// 1. No unified view across all systems
// 2. Manual timestamp correlation is error-prone
// 3. Blast radius estimation is guesswork
// 4. Root cause often found by luck, not method
// 5. Runbooks are outdated or missing
// 6. Postmortems lack systematic evidence collection
```

### What Fragmented Tools Cannot Provide

| Capability | Fragmented Tools | Unified Incident Intelligence |
|------------|------------------|------------------------------|
| View alerts from multiple sources | Manual switching | Unified stream |
| Correlate logs by trace ID | Manual grep | Automatic correlation |
| Build incident timeline | Manual construction | Automatic with causality |
| Estimate blast radius | Guesswork | Systematic analysis |
| Identify root cause | Trial and error | Causal reasoning |
| Execute runbook steps | Manual checklist | Automated execution |
| Generate postmortem | Manual writing | Evidence-based generation |

### The Unified Intelligence Paradigm

**Principle**: Incidents require rapid understanding across multiple systems. Each piece of information must be:
1. **Correlated by trace** (trace ID, request ID, session ID)
2. **Aligned by time** (normalized timestamps across systems)
3. **Connected causally** (what triggered what)
4. **Assessed for impact** (who and what is affected)
5. **Linked to runbooks** (what actions to take)

---

## 2. Incident Model

### Part 1: Core Incident Types

```typescript
/**
 * An incident represents a production issue requiring investigation.
 * Tracks the full lifecycle from detection through postmortem.
 */
interface Incident {
  /** Unique incident identifier (e.g., INC-2026-0123) */
  id: string;

  /** Human-readable title */
  title: string;

  /** Severity classification */
  severity: IncidentSeverity;

  /** Current status in lifecycle */
  status: IncidentStatus;

  /** When incident was first detected */
  detectedAt: Date;

  /** When incident was resolved (null if ongoing) */
  resolvedAt: Date | null;

  /** Duration in milliseconds (updated live if ongoing) */
  durationMs: number;

  /** Incident timeline with all events */
  timeline: IncidentTimeline;

  /** Systems affected by this incident */
  affectedSystems: AffectedSystem[];

  /** Blast radius analysis */
  blastRadius: BlastRadius;

  /** Root cause analysis (null if not yet determined) */
  rootCause: RootCause | null;

  /** Mitigations applied or suggested */
  mitigations: Mitigation[];

  /** Matched runbooks */
  runbooks: MatchedRunbook[];

  /** Confidence in current understanding */
  confidence: ConfidenceValue;

  /** Metadata */
  metadata: IncidentMetadata;
}

type IncidentSeverity = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';

type IncidentStatus =
  | 'detected'       // Alert fired, not yet acknowledged
  | 'acknowledged'   // Someone is looking at it
  | 'investigating'  // Active investigation
  | 'identified'     // Root cause identified
  | 'mitigating'     // Mitigation in progress
  | 'monitoring'     // Mitigation applied, monitoring for stability
  | 'resolved'       // Incident resolved
  | 'postmortem';    // In postmortem phase

interface IncidentMetadata {
  /** Source of initial detection */
  detectionSource: string;

  /** Team(s) involved */
  respondingTeams: string[];

  /** Incident commander (if assigned) */
  incidentCommander?: string;

  /** External ticket references */
  externalReferences: ExternalReference[];

  /** Tags for categorization */
  tags: string[];
}

interface ExternalReference {
  system: 'jira' | 'pagerduty' | 'opsgenie' | 'slack' | 'statuspage' | 'other';
  id: string;
  url: string;
}
```

### Part 2: Incident Events and Timeline

```typescript
/**
 * An event within an incident timeline.
 * Events are the atomic units of incident understanding.
 */
interface IncidentEvent {
  /** Unique event identifier */
  id: string;

  /** When this event occurred (normalized timestamp) */
  timestamp: Date;

  /** Raw timestamp from source (before normalization) */
  rawTimestamp: string;

  /** Event type categorization */
  type: IncidentEventType;

  /** Source system that reported this event */
  source: EventSource;

  /** Human-readable description */
  description: string;

  /** Severity of this specific event */
  eventSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info';

  /** Evidence supporting this event */
  evidence: Evidence[];

  /** Correlation identifiers */
  correlationIds: CorrelationIds;

  /** Causal links to other events */
  causalLinks: CausalLink[];

  /** Confidence in event data */
  confidence: ConfidenceValue;
}

type IncidentEventType =
  | 'alert'           // Alert from monitoring system
  | 'log'             // Log entry
  | 'metric'          // Metric threshold breach
  | 'deployment'      // Code or config deployment
  | 'config_change'   // Configuration change
  | 'action'          // Human or automated action
  | 'communication'   // Slack message, page, etc.
  | 'external'        // External dependency event
  | 'user_report';    // User-reported issue

interface EventSource {
  /** System name (e.g., 'datadog', 'aws-cloudwatch', 'application') */
  system: string;

  /** Specific component within system */
  component?: string;

  /** Host or service that generated the event */
  host?: string;

  /** Region or availability zone */
  region?: string;
}

interface CorrelationIds {
  /** Distributed trace ID */
  traceId?: string;

  /** Span ID within trace */
  spanId?: string;

  /** Request ID */
  requestId?: string;

  /** Session ID */
  sessionId?: string;

  /** User ID (anonymized) */
  userId?: string;

  /** Custom correlation keys */
  custom: Map<string, string>;
}

interface CausalLink {
  /** Target event ID */
  targetEventId: string;

  /** Type of causal relationship */
  relationship: 'triggers' | 'caused_by' | 'contributes_to' | 'follows';

  /** Confidence in this causal link */
  confidence: ConfidenceValue;

  /** Evidence for this link */
  evidence: string;
}

/**
 * Evidence supporting an event or conclusion.
 */
interface Evidence {
  /** Evidence type */
  type: EvidenceType;

  /** Human-readable description */
  description: string;

  /** Raw data or reference */
  data: unknown;

  /** When evidence was collected */
  collectedAt: Date;

  /** Source of evidence */
  source: string;

  /** Confidence in evidence accuracy */
  confidence: ConfidenceValue;
}

type EvidenceType =
  | 'log_entry'
  | 'metric_value'
  | 'alert_details'
  | 'trace_span'
  | 'screenshot'
  | 'config_snapshot'
  | 'code_diff'
  | 'user_report'
  | 'responder_observation';

/**
 * The complete incident timeline.
 */
interface IncidentTimeline {
  /** All events in chronological order */
  events: IncidentEvent[];

  /** Earliest event timestamp */
  startTime: Date;

  /** Latest event timestamp */
  endTime: Date;

  /** Key milestones in the incident */
  milestones: TimelineMilestone[];

  /** Causal chains identified in timeline */
  causalChains: CausalChain[];

  /** Gaps in timeline coverage */
  gaps: TimelineGap[];

  /** Confidence in timeline completeness */
  completenessConfidence: ConfidenceValue;
}

interface TimelineMilestone {
  /** Milestone type */
  type: 'first_alert' | 'impact_start' | 'root_cause_identified' | 'mitigation_started' | 'resolution' | 'custom';

  /** When milestone occurred */
  timestamp: Date;

  /** Associated event ID */
  eventId: string;

  /** Description */
  description: string;
}

interface CausalChain {
  /** Chain identifier */
  id: string;

  /** Events in causal order (cause first) */
  events: string[];

  /** Overall chain description */
  description: string;

  /** Confidence in chain accuracy */
  confidence: ConfidenceValue;
}

interface TimelineGap {
  /** Start of gap */
  from: Date;

  /** End of gap */
  to: Date;

  /** Expected events that are missing */
  expectedEvents: string[];

  /** Possible reasons for gap */
  possibleReasons: string[];
}
```

### Part 3: Affected Systems and Blast Radius

```typescript
/**
 * A system affected by the incident.
 */
interface AffectedSystem {
  /** System identifier */
  id: string;

  /** System name */
  name: string;

  /** Type of system */
  type: SystemType;

  /** How this system is affected */
  impactType: ImpactType;

  /** Severity of impact on this system */
  impactSeverity: 'complete_outage' | 'degraded' | 'intermittent' | 'minor';

  /** When impact started */
  impactStart: Date;

  /** When impact ended (null if ongoing) */
  impactEnd: Date | null;

  /** Dependencies that caused this system to be affected */
  upstreamCauses: string[];

  /** Downstream systems affected by this one */
  downstreamEffects: string[];
}

type SystemType =
  | 'service'
  | 'database'
  | 'cache'
  | 'queue'
  | 'cdn'
  | 'third_party'
  | 'infrastructure';

type ImpactType =
  | 'direct'      // System itself is failing
  | 'indirect'    // Affected by upstream failure
  | 'cascade'     // Part of failure cascade
  | 'collateral'; // Unintended side effect

/**
 * Blast radius analysis for an incident.
 * Quantifies the scope and impact of the incident.
 */
interface BlastRadius {
  /** Services directly or indirectly affected */
  affectedServices: AffectedService[];

  /** User impact assessment */
  userImpact: UserImpact;

  /** Features affected by the incident */
  affectedFeatures: AffectedFeature[];

  /** Regions/availability zones affected */
  affectedRegions: AffectedRegion[];

  /** Estimated financial impact */
  financialImpact: FinancialImpact;

  /** Risk of further cascade */
  cascadeRisk: CascadeRisk[];

  /** Confidence in blast radius assessment */
  confidence: ConfidenceValue;
}

interface AffectedService {
  /** Service identifier */
  serviceId: string;

  /** Service name */
  name: string;

  /** Impact level */
  impact: 'critical' | 'high' | 'medium' | 'low';

  /** How service is affected */
  impactDescription: string;

  /** Percentage of service capacity affected */
  capacityImpactPercent: number;

  /** Is this a customer-facing service? */
  customerFacing: boolean;
}

interface UserImpact {
  /** Estimated number of affected users */
  estimatedAffectedUsers: NumberRange;

  /** Percentage of total users affected */
  percentageAffected: NumberRange;

  /** User segments most affected */
  affectedSegments: UserSegment[];

  /** Impact on user experience */
  experienceImpact: 'complete_outage' | 'major_degradation' | 'minor_degradation' | 'cosmetic';

  /** Are users getting errors or just slow responses? */
  errorRate: NumberRange;

  /** Confidence in user impact estimate */
  confidence: ConfidenceValue;
}

interface UserSegment {
  name: string;
  estimatedSize: NumberRange;
  impactSeverity: 'critical' | 'high' | 'medium' | 'low';
}

interface NumberRange {
  low: number;
  high: number;
  best: number;
}

interface AffectedFeature {
  /** Feature identifier */
  featureId: string;

  /** Feature name */
  name: string;

  /** Is feature completely unavailable? */
  unavailable: boolean;

  /** Feature importance to business */
  businessImportance: 'critical' | 'high' | 'medium' | 'low';
}

interface AffectedRegion {
  /** Region identifier (e.g., 'us-east-1') */
  regionId: string;

  /** Region name */
  name: string;

  /** Impact in this region */
  impact: 'complete_outage' | 'degraded' | 'intermittent' | 'unaffected';

  /** Percentage of traffic from this region */
  trafficPercentage: number;
}

interface FinancialImpact {
  /** Estimated revenue loss */
  estimatedRevenueLoss: MonetaryRange | null;

  /** Estimated cost of incident response */
  responseCost: MonetaryRange | null;

  /** SLA credits that may be owed */
  potentialSLACredits: MonetaryRange | null;

  /** Basis for estimates */
  estimationBasis: string;

  /** Confidence in financial estimates */
  confidence: ConfidenceValue;
}

interface MonetaryRange {
  currency: string;
  low: number;
  high: number;
  best: number;
}

interface CascadeRisk {
  /** System at risk of cascade */
  systemId: string;

  /** Risk level */
  riskLevel: 'high' | 'medium' | 'low';

  /** What would trigger cascade */
  triggerCondition: string;

  /** Potential additional impact if cascade occurs */
  potentialImpact: string;

  /** Mitigation to prevent cascade */
  preventionMeasure: string;
}
```

### Part 4: Root Cause and Mitigations

```typescript
/**
 * Root cause analysis for an incident.
 * Integrates with Track C causal reasoning.
 */
interface RootCause {
  /** Root cause identifier */
  id: string;

  /** Human-readable summary */
  summary: string;

  /** Detailed description */
  description: string;

  /** Category of root cause */
  category: RootCauseCategory;

  /** The causal chain from root cause to symptoms */
  causalChain: CausalChain;

  /** Contributing factors (not the root cause, but made it worse) */
  contributingFactors: ContributingFactor[];

  /** Evidence supporting this root cause */
  evidence: Evidence[];

  /** Confidence in root cause identification */
  confidence: ConfidenceValue;

  /** Whether this was the root cause or a proximate cause */
  depth: 'root' | 'proximate' | 'contributing';
}

type RootCauseCategory =
  | 'code_defect'
  | 'configuration_error'
  | 'infrastructure_failure'
  | 'dependency_failure'
  | 'capacity_exhaustion'
  | 'security_incident'
  | 'human_error'
  | 'process_failure'
  | 'unknown';

interface ContributingFactor {
  /** Factor description */
  description: string;

  /** How it contributed */
  contribution: string;

  /** Could incident have been prevented without this factor? */
  preventability: 'would_prevent' | 'would_reduce_severity' | 'would_reduce_duration' | 'minimal';
}

/**
 * A mitigation action for an incident.
 */
interface Mitigation {
  /** Mitigation identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** Type of mitigation */
  type: MitigationType;

  /** Current status */
  status: MitigationStatus;

  /** Priority of this mitigation */
  priority: 'immediate' | 'high' | 'medium' | 'low';

  /** Who is responsible */
  assignee?: string;

  /** Expected impact of mitigation */
  expectedImpact: string;

  /** Actual impact observed (if applied) */
  actualImpact?: string;

  /** When mitigation was applied */
  appliedAt?: Date;

  /** Rollback plan if mitigation fails */
  rollbackPlan?: string;

  /** Confidence that mitigation will work */
  confidence: ConfidenceValue;
}

type MitigationType =
  | 'rollback'
  | 'feature_flag'
  | 'traffic_shift'
  | 'scale_up'
  | 'restart'
  | 'config_change'
  | 'hotfix'
  | 'circuit_breaker'
  | 'manual_intervention';

type MitigationStatus =
  | 'proposed'
  | 'approved'
  | 'in_progress'
  | 'applied'
  | 'monitoring'
  | 'verified'
  | 'failed'
  | 'rolled_back';
```

---

## 3. Log Correlation

### Part 5: Log Correlation Engine

```typescript
/**
 * Log correlation for incident investigation.
 * Correlates logs across multiple services using trace IDs,
 * timestamps, and pattern matching.
 */
interface LogCorrelationEngine {
  /**
   * Correlate logs from multiple sources for a time range.
   *
   * @param sources - Log sources to query
   * @param timeRange - Time range to search
   * @param correlationKeys - Keys to correlate on (trace_id, request_id, etc.)
   * @returns Correlated log entries
   */
  correlate(
    sources: LogSource[],
    timeRange: TimeRange,
    correlationKeys: CorrelationKey[]
  ): Promise<LogCorrelationResult>;

  /**
   * Trace a request flow across services.
   *
   * @param traceId - Distributed trace ID
   * @returns Complete request flow with all log entries
   */
  traceRequest(traceId: string): Promise<RequestTrace>;

  /**
   * Detect anomalies in log patterns.
   *
   * @param logs - Log entries to analyze
   * @param baselinePeriod - Period to use as baseline
   * @returns Detected anomalies
   */
  detectAnomalies(
    logs: LogEntry[],
    baselinePeriod: TimeRange
  ): Promise<LogAnomaly[]>;

  /**
   * Find patterns in log streams.
   *
   * @param logs - Log entries to analyze
   * @param patternTypes - Types of patterns to look for
   * @returns Detected patterns
   */
  findPatterns(
    logs: LogEntry[],
    patternTypes: PatternType[]
  ): Promise<LogPattern[]>;
}

interface LogSource {
  /** Source identifier */
  id: string;

  /** Source type */
  type: 'cloudwatch' | 'datadog' | 'splunk' | 'elasticsearch' | 'file' | 'stdout';

  /** Connection configuration */
  config: LogSourceConfig;

  /** Timestamp format */
  timestampFormat: string;

  /** Timezone */
  timezone: string;
}

interface LogSourceConfig {
  /** Endpoint URL */
  endpoint?: string;

  /** Credentials reference */
  credentialsRef?: string;

  /** Log group or index name */
  logGroup?: string;

  /** Query filter */
  filter?: string;
}

interface TimeRange {
  start: Date;
  end: Date;
}

type CorrelationKey = 'trace_id' | 'request_id' | 'session_id' | 'user_id' | 'custom';

interface LogCorrelationResult {
  /** Correlated log groups */
  groups: CorrelatedLogGroup[];

  /** Uncorrelated logs */
  uncorrelated: LogEntry[];

  /** Correlation statistics */
  stats: CorrelationStats;

  /** Confidence in correlation accuracy */
  confidence: ConfidenceValue;
}

interface CorrelatedLogGroup {
  /** Correlation key used */
  correlationKey: string;

  /** Correlation value */
  correlationValue: string;

  /** All log entries in this group */
  entries: LogEntry[];

  /** Services involved */
  services: string[];

  /** Time span of the group */
  timeSpan: TimeRange;
}

interface LogEntry {
  /** Unique entry identifier */
  id: string;

  /** Timestamp */
  timestamp: Date;

  /** Log level */
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

  /** Log message */
  message: string;

  /** Structured fields */
  fields: Map<string, unknown>;

  /** Source service */
  service: string;

  /** Host */
  host?: string;

  /** Extracted correlation IDs */
  correlationIds: CorrelationIds;
}

interface CorrelationStats {
  /** Total logs processed */
  totalLogs: number;

  /** Logs successfully correlated */
  correlatedLogs: number;

  /** Number of correlation groups */
  groupCount: number;

  /** Services represented */
  serviceCount: number;
}

interface RequestTrace {
  /** Trace ID */
  traceId: string;

  /** All spans in the trace */
  spans: TraceSpan[];

  /** Root span */
  rootSpan: TraceSpan;

  /** Services involved */
  services: string[];

  /** Total duration */
  duration: number;

  /** Was there an error in the trace? */
  hasError: boolean;

  /** Error details if applicable */
  error?: ErrorInfo;

  /** Associated log entries */
  logs: LogEntry[];
}

interface TraceSpan {
  /** Span ID */
  spanId: string;

  /** Parent span ID */
  parentSpanId?: string;

  /** Operation name */
  operationName: string;

  /** Service name */
  serviceName: string;

  /** Start time */
  startTime: Date;

  /** Duration in milliseconds */
  duration: number;

  /** Span status */
  status: 'ok' | 'error' | 'timeout';

  /** Tags */
  tags: Map<string, string>;

  /** Logs within this span */
  logs: SpanLog[];
}

interface SpanLog {
  timestamp: Date;
  fields: Map<string, unknown>;
}

interface ErrorInfo {
  type: string;
  message: string;
  stack?: string;
  spanId: string;
}

interface LogAnomaly {
  /** Anomaly type */
  type: AnomalyType;

  /** Description */
  description: string;

  /** Affected log entries */
  entries: LogEntry[];

  /** Time range of anomaly */
  timeRange: TimeRange;

  /** Severity */
  severity: 'critical' | 'high' | 'medium' | 'low';

  /** Deviation from baseline */
  deviation: number;

  /** Confidence in anomaly detection */
  confidence: ConfidenceValue;
}

type AnomalyType =
  | 'error_spike'
  | 'latency_spike'
  | 'volume_spike'
  | 'volume_drop'
  | 'new_error_type'
  | 'pattern_break';

type PatternType =
  | 'error_cascade'
  | 'retry_storm'
  | 'timeout_pattern'
  | 'connection_failure'
  | 'rate_limiting';

interface LogPattern {
  /** Pattern type */
  type: PatternType;

  /** Description */
  description: string;

  /** Log entries matching this pattern */
  matches: LogEntry[];

  /** Pattern frequency */
  frequency: number;

  /** First occurrence */
  firstSeen: Date;

  /** Last occurrence */
  lastSeen: Date;

  /** Confidence in pattern detection */
  confidence: ConfidenceValue;
}
```

---

## 4. Timeline Reconstruction

### Part 6: Timeline Builder

```typescript
/**
 * Timeline reconstruction for incident investigation.
 * Builds a coherent timeline from disparate events across systems.
 */
interface TimelineBuilder {
  /**
   * Build incident timeline from multiple event sources.
   *
   * @param sources - Event sources to include
   * @param timeRange - Time range to cover
   * @returns Constructed timeline
   */
  buildTimeline(
    sources: EventSource[],
    timeRange: TimeRange
  ): Promise<IncidentTimeline>;

  /**
   * Infer causality between events.
   *
   * @param events - Events to analyze
   * @returns Events with causal links
   */
  inferCausality(
    events: IncidentEvent[]
  ): Promise<IncidentEvent[]>;

  /**
   * Identify the triggering event (first cause in the chain).
   *
   * @param timeline - Incident timeline
   * @returns Triggering event with confidence
   */
  identifyTrigger(
    timeline: IncidentTimeline
  ): Promise<TriggerIdentification>;

  /**
   * Align timestamps across systems with different clocks.
   *
   * @param events - Events with potentially misaligned timestamps
   * @returns Events with aligned timestamps
   */
  alignTimestamps(
    events: IncidentEvent[]
  ): Promise<TimestampAlignmentResult>;
}

interface TriggerIdentification {
  /** The triggering event */
  event: IncidentEvent;

  /** Alternative candidates */
  alternatives: IncidentEvent[];

  /** Confidence in identification */
  confidence: ConfidenceValue;

  /** Reasoning for selection */
  reasoning: string;
}

interface TimestampAlignmentResult {
  /** Events with aligned timestamps */
  alignedEvents: IncidentEvent[];

  /** Clock skew detected between systems */
  clockSkews: ClockSkew[];

  /** Events that could not be aligned */
  unalignedEvents: IncidentEvent[];

  /** Confidence in alignment */
  confidence: ConfidenceValue;
}

interface ClockSkew {
  /** Source system */
  sourceSystem: string;

  /** Reference system */
  referenceSystem: string;

  /** Estimated skew in milliseconds */
  skewMs: number;

  /** How skew was determined */
  method: 'ntp_comparison' | 'event_correlation' | 'manual_override';
}

/**
 * Causality inference for timeline events.
 * Uses temporal ordering and domain knowledge to infer causal relationships.
 */
interface CausalityInferrer {
  /**
   * Infer causal relationships between events.
   *
   * @param events - Events to analyze
   * @param domainKnowledge - Domain-specific causal knowledge
   * @returns Inferred causal links
   */
  inferCausalLinks(
    events: IncidentEvent[],
    domainKnowledge: DomainCausalKnowledge
  ): Promise<InferredCausalLinks>;
}

interface DomainCausalKnowledge {
  /** Known service dependencies */
  serviceDependencies: ServiceDependency[];

  /** Known failure modes */
  failureModes: FailureMode[];

  /** Historical incident patterns */
  historicalPatterns: HistoricalPattern[];
}

interface ServiceDependency {
  upstream: string;
  downstream: string;
  type: 'sync' | 'async' | 'data';
  failureImpact: 'blocking' | 'degraded' | 'none';
}

interface FailureMode {
  name: string;
  symptoms: string[];
  typicalCauses: string[];
  typicalPropagation: string[];
}

interface HistoricalPattern {
  patternId: string;
  description: string;
  eventSequence: string[];
  frequency: number;
}

interface InferredCausalLinks {
  /** Inferred links */
  links: CausalLink[];

  /** Causal chains discovered */
  chains: CausalChain[];

  /** Confidence in inference */
  confidence: ConfidenceValue;
}
```

---

## 5. Blast Radius Analysis

### Part 7: Blast Radius Analyzer

```typescript
/**
 * Blast radius analysis for incidents.
 * Calculates the scope and impact of an incident across systems and users.
 */
interface BlastRadiusAnalyzer {
  /**
   * Calculate blast radius for an incident.
   *
   * @param incident - Incident to analyze
   * @param topology - System topology
   * @returns Blast radius analysis
   */
  analyze(
    incident: Incident,
    topology: SystemTopology
  ): Promise<BlastRadius>;

  /**
   * Traverse service dependencies to find affected services.
   *
   * @param sourceService - Initially affected service
   * @param topology - System topology
   * @returns Affected services with impact assessment
   */
  traverseDependencies(
    sourceService: string,
    topology: SystemTopology
  ): Promise<AffectedService[]>;

  /**
   * Estimate user impact based on affected services.
   *
   * @param affectedServices - Services that are impacted
   * @param userMetrics - User traffic and segment data
   * @returns User impact estimate
   */
  estimateUserImpact(
    affectedServices: AffectedService[],
    userMetrics: UserMetrics
  ): Promise<UserImpact>;

  /**
   * Assess cascade risk from current state.
   *
   * @param currentState - Current incident state
   * @param topology - System topology
   * @returns Cascade risk assessment
   */
  assessCascadeRisk(
    currentState: BlastRadius,
    topology: SystemTopology
  ): Promise<CascadeRisk[]>;
}

interface SystemTopology {
  /** All services in the system */
  services: ServiceDefinition[];

  /** Dependencies between services */
  dependencies: ServiceDependency[];

  /** Infrastructure components */
  infrastructure: InfrastructureComponent[];

  /** External dependencies */
  externalDependencies: ExternalDependency[];
}

interface ServiceDefinition {
  id: string;
  name: string;
  type: 'api' | 'worker' | 'database' | 'cache' | 'queue' | 'frontend';
  criticality: 'critical' | 'high' | 'medium' | 'low';
  healthEndpoint?: string;
  metrics?: ServiceMetrics;
}

interface ServiceMetrics {
  requestsPerSecond: number;
  errorRate: number;
  latencyP50: number;
  latencyP99: number;
}

interface InfrastructureComponent {
  id: string;
  type: 'load_balancer' | 'database_cluster' | 'cache_cluster' | 'kubernetes' | 'network';
  affectedServices: string[];
}

interface ExternalDependency {
  id: string;
  name: string;
  type: 'api' | 'database' | 'payment' | 'email' | 'other';
  statusPageUrl?: string;
  dependentServices: string[];
}

interface UserMetrics {
  /** Total active users in time period */
  totalActiveUsers: number;

  /** Users by segment */
  segments: UserSegmentMetrics[];

  /** Users by region */
  regionDistribution: RegionMetrics[];

  /** Traffic by feature */
  featureUsage: FeatureMetrics[];
}

interface UserSegmentMetrics {
  segment: string;
  userCount: number;
  revenuePercentage: number;
}

interface RegionMetrics {
  region: string;
  userCount: number;
  trafficPercentage: number;
}

interface FeatureMetrics {
  feature: string;
  usagePercentage: number;
  dependentServices: string[];
}
```

---

## 6. Runbook Integration

### Part 8: Runbook Management

```typescript
/**
 * Runbook management for incident response.
 * Matches incidents to runbooks and supports automated execution.
 */
interface RunbookManager {
  /**
   * Match an incident to relevant runbooks.
   *
   * @param incident - Incident to match
   * @param runbooks - Available runbooks
   * @returns Matched runbooks with relevance scores
   */
  matchRunbooks(
    incident: Incident,
    runbooks: Runbook[]
  ): Promise<MatchedRunbook[]>;

  /**
   * Execute a runbook step.
   *
   * @param runbook - Runbook being executed
   * @param stepId - Step to execute
   * @param context - Execution context
   * @returns Execution result
   */
  executeStep(
    runbook: Runbook,
    stepId: string,
    context: ExecutionContext
  ): Promise<StepExecutionResult>;

  /**
   * Validate runbook prerequisites.
   *
   * @param runbook - Runbook to validate
   * @param context - Current context
   * @returns Validation result
   */
  validatePrerequisites(
    runbook: Runbook,
    context: ExecutionContext
  ): Promise<PrerequisiteValidation>;
}

/**
 * A runbook defines steps to respond to a specific type of incident.
 */
interface Runbook {
  /** Runbook identifier */
  id: string;

  /** Human-readable title */
  title: string;

  /** Description */
  description: string;

  /** Version */
  version: string;

  /** When this runbook applies */
  applicability: RunbookApplicability;

  /** Prerequisites that must be true before execution */
  prerequisites: Prerequisite[];

  /** Steps to execute */
  steps: RunbookStep[];

  /** Rollback procedure if runbook fails */
  rollback: RollbackProcedure;

  /** Expected outcome */
  expectedOutcome: string;

  /** Estimated time to complete */
  estimatedDuration: number;

  /** Tags for categorization */
  tags: string[];

  /** Last updated */
  lastUpdated: Date;

  /** Author */
  author: string;
}

interface RunbookApplicability {
  /** Incident types this applies to */
  incidentTypes: string[];

  /** Services this applies to */
  services: string[];

  /** Symptom patterns that trigger this runbook */
  symptomPatterns: string[];

  /** Conditions that must be true */
  conditions: string[];
}

interface Prerequisite {
  /** Prerequisite description */
  description: string;

  /** How to verify */
  verification: string;

  /** Is this automatable? */
  automatable: boolean;

  /** Verification command (if automatable) */
  verificationCommand?: string;
}

interface RunbookStep {
  /** Step identifier */
  id: string;

  /** Step order */
  order: number;

  /** Step description */
  description: string;

  /** Detailed instructions */
  instructions: string;

  /** Is this step automatable? */
  automatable: boolean;

  /** Automation command/script */
  automationScript?: string;

  /** Expected outcome */
  expectedOutcome: string;

  /** How to verify step completed successfully */
  verification: string;

  /** What to do if step fails */
  onFailure: FailureAction;

  /** Estimated time for this step */
  estimatedDuration: number;

  /** Risk level of this step */
  risk: 'none' | 'low' | 'medium' | 'high';
}

type FailureAction =
  | { type: 'continue' }
  | { type: 'abort' }
  | { type: 'rollback' }
  | { type: 'escalate'; to: string }
  | { type: 'retry'; maxAttempts: number; delayMs: number };

interface RollbackProcedure {
  /** When to trigger rollback */
  triggers: string[];

  /** Rollback steps */
  steps: RunbookStep[];

  /** Notification on rollback */
  notifications: string[];
}

interface MatchedRunbook {
  /** The runbook */
  runbook: Runbook;

  /** Relevance score (0-1) */
  relevanceScore: number;

  /** Why this runbook matched */
  matchReasons: string[];

  /** Confidence in match */
  confidence: ConfidenceValue;

  /** Prerequisites status */
  prerequisiteStatus: PrerequisiteValidation;
}

interface PrerequisiteValidation {
  /** Are all prerequisites met? */
  allMet: boolean;

  /** Status of each prerequisite */
  prerequisites: PrerequisiteStatus[];
}

interface PrerequisiteStatus {
  /** Prerequisite */
  prerequisite: Prerequisite;

  /** Is it met? */
  met: boolean;

  /** How it was verified */
  verification: string;
}

interface ExecutionContext {
  /** Current incident */
  incident: Incident;

  /** Current user */
  user: string;

  /** Environment variables */
  environment: Map<string, string>;

  /** Available tools */
  tools: string[];

  /** Execution mode */
  mode: 'dry_run' | 'interactive' | 'automated';
}

interface StepExecutionResult {
  /** Step that was executed */
  stepId: string;

  /** Outcome */
  outcome: 'success' | 'failure' | 'skipped' | 'timeout';

  /** Output from execution */
  output: string;

  /** Duration in milliseconds */
  durationMs: number;

  /** Any errors encountered */
  errors: string[];

  /** Evidence collected */
  evidence: Evidence[];
}
```

---

## 7. Incident Primitives

### Part 9: Primitive Definitions

```typescript
/**
 * Incident investigation technique primitives.
 * Each primitive has typed inputs, outputs, and confidence semantics.
 */

/**
 * tp_log_correlate - Correlate logs across services
 *
 * Uses trace IDs, timestamps, and pattern matching to correlate
 * logs from multiple services during an incident.
 */
export const tp_log_correlate: TechniquePrimitive = {
  id: 'tp_log_correlate',
  name: 'Log Correlation',
  description: 'Correlate logs across services using trace IDs and timestamps',
  inputs: [
    { name: 'sources', type: 'LogSource[]', description: 'Log sources to query' },
    { name: 'timeRange', type: 'TimeRange', description: 'Time range to search' },
    { name: 'correlationKeys', type: 'CorrelationKey[]', description: 'Keys to correlate on' },
  ],
  outputs: [
    { name: 'correlatedGroups', type: 'CorrelatedLogGroup[]', description: 'Correlated log groups' },
    { name: 'uncorrelated', type: 'LogEntry[]', description: 'Uncorrelated entries' },
    { name: 'stats', type: 'CorrelationStats', description: 'Correlation statistics' },
  ],
  confidence: {
    type: 'absent',
    reason: 'uncalibrated', // depends_on_log_quality_and_trace_propagation
  },
  tier: 2,  // Deterministic correlation, may need LLM for pattern matching
  preconditions: ['log_sources_accessible', 'time_range_valid'],
  postconditions: ['groups_have_correlation_keys'],
};

/**
 * tp_timeline_build - Build incident timeline
 *
 * Constructs a coherent timeline from disparate events across systems,
 * with timestamp alignment and causality inference.
 */
export const tp_timeline_build: TechniquePrimitive = {
  id: 'tp_timeline_build',
  name: 'Timeline Construction',
  description: 'Build incident timeline with event ordering and causality',
  inputs: [
    { name: 'events', type: 'IncidentEvent[]', description: 'Events to include' },
    { name: 'domainKnowledge', type: 'DomainCausalKnowledge', description: 'Domain knowledge for causality' },
  ],
  outputs: [
    { name: 'timeline', type: 'IncidentTimeline', description: 'Constructed timeline' },
    { name: 'causalChains', type: 'CausalChain[]', description: 'Identified causal chains' },
    { name: 'triggerEvent', type: 'IncidentEvent', description: 'Triggering event' },
  ],
  confidence: {
    type: 'absent',
    reason: 'uncalibrated', // causality_inference_uncalibrated
  },
  tier: 3,  // Requires LLM for causality inference
  preconditions: ['events_have_timestamps'],
  postconditions: ['timeline_ordered', 'trigger_identified'],
};

/**
 * tp_blast_radius - Calculate blast radius
 *
 * Calculates the scope of impact by traversing service dependencies
 * and estimating user impact.
 */
export const tp_blast_radius: TechniquePrimitive = {
  id: 'tp_blast_radius',
  name: 'Blast Radius Analysis',
  description: 'Calculate incident blast radius across services and users',
  inputs: [
    { name: 'affectedService', type: 'string', description: 'Initially affected service' },
    { name: 'topology', type: 'SystemTopology', description: 'System topology' },
    { name: 'userMetrics', type: 'UserMetrics', description: 'User traffic data' },
  ],
  outputs: [
    { name: 'blastRadius', type: 'BlastRadius', description: 'Complete blast radius analysis' },
    { name: 'cascadeRisks', type: 'CascadeRisk[]', description: 'Cascade risk assessment' },
  ],
  confidence: {
    type: 'absent',
    reason: 'uncalibrated', // depends_on_topology_accuracy
  },
  tier: 2,  // Mostly graph traversal, LLM for impact estimation
  preconditions: ['topology_available'],
  postconditions: ['all_dependencies_traversed'],
};

/**
 * tp_runbook_match - Match incident to runbook
 *
 * Finds the most relevant runbook for an incident based on
 * symptoms, affected services, and historical patterns.
 */
export const tp_runbook_match: TechniquePrimitive = {
  id: 'tp_runbook_match',
  name: 'Runbook Matching',
  description: 'Match incident to relevant runbooks',
  inputs: [
    { name: 'incident', type: 'Incident', description: 'Incident to match' },
    { name: 'runbooks', type: 'Runbook[]', description: 'Available runbooks' },
  ],
  outputs: [
    { name: 'matches', type: 'MatchedRunbook[]', description: 'Matched runbooks with scores' },
    { name: 'bestMatch', type: 'MatchedRunbook', description: 'Best matching runbook' },
  ],
  confidence: {
    type: 'absent',
    reason: 'uncalibrated', // match_quality_depends_on_runbook_coverage
  },
  tier: 3,  // Requires LLM for semantic matching
  preconditions: ['runbooks_available'],
  postconditions: ['matches_ranked'],
};

/**
 * tp_runbook_execute - Execute runbook steps
 *
 * Executes runbook steps with verification and rollback support.
 */
export const tp_runbook_execute: TechniquePrimitive = {
  id: 'tp_runbook_execute',
  name: 'Runbook Execution',
  description: 'Execute runbook steps with verification',
  inputs: [
    { name: 'runbook', type: 'Runbook', description: 'Runbook to execute' },
    { name: 'context', type: 'ExecutionContext', description: 'Execution context' },
    { name: 'mode', type: 'string', description: 'dry_run | interactive | automated' },
  ],
  outputs: [
    { name: 'results', type: 'StepExecutionResult[]', description: 'Results for each step' },
    { name: 'overallSuccess', type: 'boolean', description: 'Whether runbook succeeded' },
    { name: 'evidence', type: 'Evidence[]', description: 'Evidence collected' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'execution_outcome_is_deterministic'
  },
  tier: 1,  // Execution is deterministic
  preconditions: ['prerequisites_met', 'context_valid'],
  postconditions: ['steps_verified'],
};

/**
 * tp_incident_detect - Detect incident from signals
 *
 * Analyzes alerts, metrics, and logs to detect an incident
 * and classify its initial severity.
 */
export const tp_incident_detect: TechniquePrimitive = {
  id: 'tp_incident_detect',
  name: 'Incident Detection',
  description: 'Detect incident from monitoring signals',
  inputs: [
    { name: 'alerts', type: 'Alert[]', description: 'Active alerts' },
    { name: 'metrics', type: 'MetricData[]', description: 'Current metrics' },
    { name: 'recentLogs', type: 'LogEntry[]', description: 'Recent log entries' },
  ],
  outputs: [
    { name: 'incident', type: 'Incident', description: 'Detected incident' },
    { name: 'initialSeverity', type: 'IncidentSeverity', description: 'Initial severity' },
    { name: 'symptoms', type: 'string[]', description: 'Observed symptoms' },
  ],
  confidence: {
    type: 'absent',
    reason: 'uncalibrated', // detection_accuracy_uncalibrated
  },
  tier: 3,  // Requires LLM for signal interpretation
  preconditions: ['monitoring_accessible'],
  postconditions: ['incident_created'],
};

/**
 * tp_incident_triage - Triage and classify incident
 *
 * Performs initial triage to determine severity, affected systems,
 * and initial response actions.
 */
export const tp_incident_triage: TechniquePrimitive = {
  id: 'tp_incident_triage',
  name: 'Incident Triage',
  description: 'Triage incident for severity and initial response',
  inputs: [
    { name: 'incident', type: 'Incident', description: 'Incident to triage' },
    { name: 'context', type: 'TriageContext', description: 'Additional context' },
  ],
  outputs: [
    { name: 'severity', type: 'IncidentSeverity', description: 'Assessed severity' },
    { name: 'affectedSystems', type: 'AffectedSystem[]', description: 'Affected systems' },
    { name: 'immediateActions', type: 'Mitigation[]', description: 'Immediate actions' },
    { name: 'escalations', type: 'string[]', description: 'Teams to escalate to' },
  ],
  confidence: {
    type: 'absent',
    reason: 'uncalibrated', // triage_judgment_uncalibrated
  },
  tier: 3,  // Requires LLM for judgment
  preconditions: ['incident_exists'],
  postconditions: ['severity_assigned'],
};

/**
 * tp_incident_mitigate - Suggest mitigations
 *
 * Suggests mitigation actions based on incident type,
 * affected systems, and historical patterns.
 */
export const tp_incident_mitigate: TechniquePrimitive = {
  id: 'tp_incident_mitigate',
  name: 'Mitigation Suggestion',
  description: 'Suggest mitigation actions for incident',
  inputs: [
    { name: 'incident', type: 'Incident', description: 'Current incident' },
    { name: 'rootCause', type: 'RootCause', description: 'Root cause (if known)' },
    { name: 'constraints', type: 'Constraint[]', description: 'Operational constraints' },
  ],
  outputs: [
    { name: 'mitigations', type: 'Mitigation[]', description: 'Suggested mitigations' },
    { name: 'recommended', type: 'Mitigation', description: 'Recommended mitigation' },
    { name: 'tradeoffs', type: 'string[]', description: 'Tradeoffs to consider' },
  ],
  confidence: {
    type: 'absent',
    reason: 'uncalibrated', // mitigation_effectiveness_uncertain
  },
  tier: 3,  // Requires LLM for reasoning
  preconditions: ['incident_triaged'],
  postconditions: ['mitigations_feasible'],
};

/**
 * tp_postmortem_generate - Generate postmortem document
 *
 * Generates a structured postmortem document from incident data,
 * timeline, and resolution actions.
 */
export const tp_postmortem_generate: TechniquePrimitive = {
  id: 'tp_postmortem_generate',
  name: 'Postmortem Generation',
  description: 'Generate postmortem document from incident data',
  inputs: [
    { name: 'incident', type: 'Incident', description: 'Resolved incident' },
    { name: 'timeline', type: 'IncidentTimeline', description: 'Incident timeline' },
    { name: 'rootCause', type: 'RootCause', description: 'Root cause analysis' },
    { name: 'mitigations', type: 'Mitigation[]', description: 'Applied mitigations' },
  ],
  outputs: [
    { name: 'postmortem', type: 'PostmortemDocument', description: 'Generated postmortem' },
    { name: 'actionItems', type: 'ActionItem[]', description: 'Follow-up action items' },
  ],
  confidence: {
    type: 'deterministic',
    value: 1.0,
    reason: 'document_generation_is_deterministic'
  },
  tier: 3,  // Requires LLM for narrative generation
  preconditions: ['incident_resolved'],
  postconditions: ['postmortem_complete'],
};
```

---

## 8. Incident Compositions

### Part 10: Composition Definitions

```typescript
/**
 * Incident investigation compositions combining multiple primitives.
 */

/**
 * tc_incident_response - Full incident response workflow
 *
 * Complete incident response from detection through resolution,
 * including triage, investigation, mitigation, and documentation.
 */
const tc_incident_response: TechniqueComposition = {
  id: 'tc_incident_response',
  name: 'Full Incident Response',
  description: 'Complete incident response workflow',
  primitives: [
    'tp_incident_detect',     // Detect and create incident
    'tp_incident_triage',     // Triage for severity
    'tp_log_correlate',       // Correlate logs
    'tp_timeline_build',      // Build timeline
    'tp_blast_radius',        // Assess impact
    'tp_runbook_match',       // Find runbooks
    'tp_runbook_execute',     // Execute runbook
    'tp_incident_mitigate',   // Apply mitigations
    'tp_postmortem_generate', // Generate postmortem
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_incident_detect', 'tp_incident_triage'] },
    { type: 'parallel', inputs: ['tp_log_correlate', 'tp_blast_radius'] },
    { type: 'sequence', inputs: ['tp_timeline_build'] },
    { type: 'conditional', inputs: ['tp_runbook_execute'], condition: 'runbook_matched' },
    { type: 'sequence', inputs: ['tp_incident_mitigate', 'tp_postmortem_generate'] },
  ],
  patterns: ['pattern_incident_response'],
};

/**
 * tc_rapid_triage - Fast initial triage
 *
 * Quick triage workflow for initial incident assessment
 * when time is critical.
 */
const tc_rapid_triage: TechniqueComposition = {
  id: 'tc_rapid_triage',
  name: 'Rapid Triage',
  description: 'Fast initial triage for incident assessment',
  primitives: [
    'tp_incident_detect',
    'tp_incident_triage',
    'tp_blast_radius',
    'tp_runbook_match',
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_incident_detect', 'tp_incident_triage'] },
    { type: 'parallel', inputs: ['tp_blast_radius', 'tp_runbook_match'] },
  ],
  patterns: ['pattern_incident_response'],
};

/**
 * tc_deep_investigation - Deep investigation workflow
 *
 * Thorough investigation for complex incidents that require
 * detailed log correlation and causal analysis.
 */
const tc_deep_investigation: TechniqueComposition = {
  id: 'tc_deep_investigation',
  name: 'Deep Investigation',
  description: 'Thorough investigation for complex incidents',
  primitives: [
    'tp_log_correlate',
    'tp_timeline_build',
    'tp_root_cause_find',    // From track-c
    'tp_counterfactual_query', // From track-c
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_log_correlate', 'tp_timeline_build'] },
    { type: 'sequence', inputs: ['tp_root_cause_find'] },
    { type: 'optional', inputs: ['tp_counterfactual_query'] },
  ],
  patterns: ['pattern_incident_response', 'pattern_causal_analysis'],
};

/**
 * tc_postmortem - Postmortem creation workflow
 *
 * Generates a comprehensive postmortem with timeline,
 * root cause analysis, and action items.
 */
const tc_postmortem: TechniqueComposition = {
  id: 'tc_postmortem',
  name: 'Postmortem Creation',
  description: 'Generate comprehensive postmortem document',
  primitives: [
    'tp_timeline_build',
    'tp_root_cause_find',    // From track-c
    'tp_blast_radius',
    'tp_postmortem_generate',
  ],
  operators: [
    { type: 'parallel', inputs: ['tp_timeline_build', 'tp_root_cause_find', 'tp_blast_radius'] },
    { type: 'sequence', inputs: ['tp_postmortem_generate'] },
  ],
  patterns: ['pattern_incident_response'],
};

/**
 * tc_runbook_execution - Guided runbook execution
 *
 * Interactive runbook execution with step verification
 * and automatic rollback on failure.
 */
const tc_runbook_execution: TechniqueComposition = {
  id: 'tc_runbook_execution',
  name: 'Guided Runbook Execution',
  description: 'Execute runbook with verification and rollback',
  primitives: [
    'tp_runbook_match',
    'tp_runbook_execute',
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_runbook_match', 'tp_runbook_execute'] },
    { type: 'on_failure', inputs: ['rollback_procedure'] },
  ],
  patterns: ['pattern_incident_response'],
};
```

---

## 9. Integration Points

### Integration with Track C (Causal Reasoning)

```typescript
/**
 * Integration with track-c-causal-reasoning.md for root cause analysis.
 *
 * Incident investigation benefits from causal reasoning by:
 * 1. Using causal models to trace from symptoms to root cause
 * 2. Counterfactual analysis ("would the incident have happened if X?")
 * 3. Understanding cascade effects through causal chains
 */
interface CausalIncidentIntegration {
  /**
   * Find root cause using causal reasoning.
   *
   * @param incident - Incident with timeline
   * @param causalModel - Causal model of system
   * @returns Root cause analysis
   */
  findRootCause(
    incident: Incident,
    causalModel: CausalModel
  ): Promise<RootCause>;

  /**
   * Analyze counterfactual: "Would incident have occurred if X?"
   *
   * @param incident - Actual incident
   * @param intervention - Hypothetical intervention
   * @returns Counterfactual analysis
   */
  counterfactualAnalysis(
    incident: Incident,
    intervention: Intervention
  ): Promise<CounterfactualResult>;

  /**
   * Trace causal chain from trigger to symptoms.
   *
   * @param trigger - Triggering event
   * @param symptoms - Observed symptoms
   * @param model - Causal model
   * @returns Causal chain
   */
  traceCausalChain(
    trigger: IncidentEvent,
    symptoms: IncidentEvent[],
    model: CausalModel
  ): Promise<CausalChain>;
}
```

### Integration with Track K (Business Knowledge)

```typescript
/**
 * Integration with track-k-business-knowledge.md for business impact.
 *
 * Incident investigation uses business knowledge for:
 * 1. Estimating revenue impact of incidents
 * 2. Understanding user segment impact
 * 3. SLA implications
 */
interface BusinessIncidentIntegration {
  /**
   * Estimate financial impact of incident.
   *
   * @param incident - Incident to assess
   * @param businessData - Business metrics and data
   * @returns Financial impact estimate
   */
  estimateFinancialImpact(
    incident: Incident,
    businessData: BusinessData
  ): Promise<FinancialImpact>;

  /**
   * Assess SLA implications.
   *
   * @param incident - Incident
   * @param slaDefinitions - SLA definitions
   * @returns SLA impact assessment
   */
  assessSLAImpact(
    incident: Incident,
    slaDefinitions: SLADefinition[]
  ): Promise<SLAImpact>;

  /**
   * Prioritize affected user segments.
   *
   * @param blastRadius - Blast radius analysis
   * @param segmentData - User segment business data
   * @returns Prioritized segments
   */
  prioritizeSegments(
    blastRadius: BlastRadius,
    segmentData: SegmentBusinessData
  ): Promise<PrioritizedSegment[]>;
}

interface SLADefinition {
  slaId: string;
  metric: string;
  threshold: number;
  penaltyPerViolation: number;
  measurementWindow: 'monthly' | 'quarterly' | 'yearly';
}

interface SLAImpact {
  violatedSLAs: string[];
  atRiskSLAs: string[];
  estimatedPenalties: MonetaryRange;
  mitigatingActions: string[];
}

interface SegmentBusinessData {
  segment: string;
  revenueContribution: number;
  strategicImportance: 'critical' | 'high' | 'medium' | 'low';
  churnRisk: number;
}

interface PrioritizedSegment {
  segment: string;
  priority: number;
  reasoning: string;
}
```

### Integration with Evidence Ledger

```typescript
/**
 * Integration with Librarian's evidence ledger.
 *
 * All incident evidence is recorded for:
 * 1. Postmortem generation
 * 2. Pattern learning across incidents
 * 3. Audit trail
 */
interface EvidenceLedgerIntegration {
  /**
   * Record incident to evidence ledger.
   *
   * @param incident - Incident to record
   * @returns Evidence entry
   */
  recordIncident(incident: Incident): Promise<EvidenceEntry>;

  /**
   * Query similar past incidents.
   *
   * @param symptoms - Current symptoms
   * @param affectedSystems - Affected systems
   * @returns Similar incidents
   */
  querySimilarIncidents(
    symptoms: string[],
    affectedSystems: string[]
  ): Promise<Incident[]>;

  /**
   * Learn patterns from incident history.
   *
   * @param incidents - Historical incidents
   * @returns Learned patterns
   */
  learnPatterns(
    incidents: Incident[]
  ): Promise<IncidentPattern[]>;
}

interface IncidentPattern {
  patternId: string;
  description: string;
  symptoms: string[];
  typicalRootCauses: string[];
  effectiveMitigations: string[];
  frequency: number;
  confidence: ConfidenceValue;
}
```

---

## 10. Postmortem Generation

### Part 11: Postmortem Document Structure

```typescript
/**
 * Postmortem document generated from incident data.
 */
interface PostmortemDocument {
  /** Postmortem identifier */
  id: string;

  /** Incident reference */
  incidentId: string;

  /** Title */
  title: string;

  /** Executive summary */
  summary: string;

  /** Incident timeline */
  timeline: TimelineSection;

  /** Impact assessment */
  impact: ImpactSection;

  /** Root cause analysis */
  rootCause: RootCauseSection;

  /** Resolution details */
  resolution: ResolutionSection;

  /** Lessons learned */
  lessons: LessonSection[];

  /** Action items */
  actionItems: ActionItem[];

  /** Appendices */
  appendices: Appendix[];

  /** Metadata */
  metadata: PostmortemMetadata;
}

interface TimelineSection {
  narrative: string;
  keyEvents: TimelineEvent[];
  milestones: TimelineMilestone[];
}

interface TimelineEvent {
  timestamp: Date;
  description: string;
  actor?: string;
  evidence?: string;
}

interface ImpactSection {
  summary: string;
  userImpact: UserImpact;
  systemImpact: AffectedSystem[];
  financialImpact?: FinancialImpact;
  durationMinutes: number;
}

interface RootCauseSection {
  summary: string;
  technicalDetails: string;
  contributingFactors: ContributingFactor[];
  fiveWhys: string[];
}

interface ResolutionSection {
  summary: string;
  mitigationsApplied: Mitigation[];
  timeToMitigate: number;
  timeToResolve: number;
  verificationSteps: string[];
}

interface LessonSection {
  category: 'what_went_well' | 'what_went_wrong' | 'where_we_got_lucky';
  items: string[];
}

interface ActionItem {
  id: string;
  description: string;
  type: 'prevent' | 'detect' | 'mitigate' | 'process';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  owner: string;
  dueDate: Date;
  status: 'open' | 'in_progress' | 'done';
  jiraLink?: string;
}

interface Appendix {
  title: string;
  content: string;
  type: 'log_excerpts' | 'metrics' | 'diagrams' | 'other';
}

interface PostmortemMetadata {
  authors: string[];
  reviewers: string[];
  createdAt: Date;
  publishedAt?: Date;
  status: 'draft' | 'in_review' | 'published';
  confidentiality: 'public' | 'internal' | 'restricted';
}
```

---

## 11. Implementation Roadmap

### Phase 1: Core Types (~250 LOC)

```typescript
// Files to create:
// - src/librarian/api/incidents/types.ts

// Deliverables:
// - Incident, IncidentEvent, IncidentTimeline types
// - BlastRadius, UserImpact, FinancialImpact types
// - RootCause, Mitigation types
// - Runbook, RunbookStep types
```

**Estimated effort**: 1.5 days

### Phase 2: Log Correlation (~300 LOC)

```typescript
// Files to create:
// - src/librarian/api/incidents/log-correlation.ts

// Deliverables:
// - LogCorrelationEngine implementation
// - Trace ID correlation
// - Timestamp alignment
// - Anomaly detection
```

**Estimated effort**: 2.5 days

### Phase 3: Timeline Construction (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/incidents/timeline.ts

// Deliverables:
// - TimelineBuilder implementation
// - Causality inference
// - Trigger identification
// - Gap detection
```

**Estimated effort**: 2 days

### Phase 4: Blast Radius Analysis (~250 LOC)

```typescript
// Files to create:
// - src/librarian/api/incidents/blast-radius.ts

// Deliverables:
// - BlastRadiusAnalyzer implementation
// - Dependency traversal
// - User impact estimation
// - Cascade risk assessment
```

**Estimated effort**: 2 days

### Phase 5: Runbook Management (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/incidents/runbook.ts

// Deliverables:
// - RunbookManager implementation
// - Runbook matching
// - Step execution
// - Rollback support
```

**Estimated effort**: 1.5 days

### Phase 6: Primitives and Compositions (~200 LOC)

```typescript
// Files to create:
// - src/librarian/api/incidents/primitives.ts
// - src/librarian/api/incidents/compositions.ts

// Deliverables:
// - 8 incident primitives registered
// - 5 incident compositions registered
// - Integration with technique catalog
```

**Estimated effort**: 1.5 days

### Phase 7: Postmortem Generation (~150 LOC)

```typescript
// Files to create:
// - src/librarian/api/incidents/postmortem.ts

// Deliverables:
// - Postmortem document generation
// - Action item extraction
// - Template support
```

**Estimated effort**: 1 day

### Phase 8: Integration (~150 LOC)

```typescript
// Files to create:
// - src/librarian/api/incidents/integration.ts

// Deliverables:
// - Track C integration (causal root cause)
// - Track K integration (business impact)
// - Evidence ledger integration
```

**Estimated effort**: 1 day

### Phase 9: Tests (~300 LOC)

```typescript
// Files to create:
// - src/librarian/api/incidents/__tests__/log-correlation.test.ts
// - src/librarian/api/incidents/__tests__/timeline.test.ts
// - src/librarian/api/incidents/__tests__/blast-radius.test.ts
// - src/librarian/api/incidents/__tests__/runbook.test.ts

// Deliverables:
// - Unit tests for all modules
// - Integration tests with mock incidents
// - Example incident scenarios
```

**Estimated effort**: 2 days

### Total Estimate

| Phase | LOC | Days |
|-------|-----|------|
| Core Types | 250 | 1.5 |
| Log Correlation | 300 | 2.5 |
| Timeline Construction | 200 | 2 |
| Blast Radius | 250 | 2 |
| Runbook Management | 200 | 1.5 |
| Primitives/Compositions | 200 | 1.5 |
| Postmortem Generation | 150 | 1 |
| Integration | 150 | 1 |
| Tests | 300 | 2 |
| **Total** | **~2,000** | **~15** |

---

## 12. Acceptance Criteria

### Core Functionality

- [ ] Incident tracks full lifecycle from detection through postmortem
- [ ] IncidentEvent supports all event types with evidence
- [ ] IncidentTimeline has causal chains and gap detection
- [ ] All confidence values use ConfidenceValue type (no raw numbers)

### Log Correlation

- [ ] `tp_log_correlate` correlates by trace ID, request ID, timestamp
- [ ] Timestamp alignment handles clock skew
- [ ] Anomaly detection identifies error spikes and pattern breaks
- [ ] Pattern detection finds retry storms, cascades

### Timeline Construction

- [ ] `tp_timeline_build` produces ordered, causal timeline
- [ ] Trigger event identified with confidence
- [ ] Causal chains traced from trigger to symptoms
- [ ] Gaps in timeline detected and flagged

### Blast Radius

- [ ] `tp_blast_radius` traverses service dependencies
- [ ] User impact estimated with confidence intervals
- [ ] Financial impact estimated when data available
- [ ] Cascade risks identified with prevention measures

### Runbook Integration

- [ ] `tp_runbook_match` finds relevant runbooks
- [ ] `tp_runbook_execute` executes steps with verification
- [ ] Rollback triggered on failure
- [ ] Evidence collected from execution

### Compositions

- [ ] `tc_incident_response` orchestrates full workflow
- [ ] `tc_rapid_triage` provides fast initial assessment
- [ ] `tc_deep_investigation` supports complex incidents
- [ ] `tc_postmortem` generates comprehensive document

### Integration

- [ ] Track C integration provides causal root cause analysis
- [ ] Track K integration provides business impact assessment
- [ ] Evidence ledger records incident data
- [ ] Pattern learning improves future responses

---

## 13. Evidence Commands

```bash
# Run incident tests
cd packages/librarian && npx vitest run src/api/incidents/__tests__/

# Verify exports
node -e "import('librarian').then(m => console.log(Object.keys(m).filter(k => k.includes('Incident'))))"

# Correlate logs for time range (when implemented)
cd packages/librarian && npx tsx src/cli/index.ts incidents correlate-logs --from "2026-01-23T10:00:00Z" --to "2026-01-23T11:00:00Z"

# Build incident timeline
cd packages/librarian && npx tsx src/cli/index.ts incidents timeline --incident INC-2026-0123

# Calculate blast radius
cd packages/librarian && npx tsx src/cli/index.ts incidents blast-radius --service api-gateway

# Match runbooks
cd packages/librarian && npx tsx src/cli/index.ts incidents match-runbook --incident INC-2026-0123

# Generate postmortem
cd packages/librarian && npx tsx src/cli/index.ts incidents postmortem --incident INC-2026-0123

# Check implementation status
ls -la packages/librarian/src/api/incidents/
```

---

## 14. References

- Beyer, B., Jones, C., Petoff, J., & Murphy, N. R. (2016). *Site Reliability Engineering*. O'Reilly Media.
- Kim, G., Humble, J., Debois, P., & Willis, J. (2016). *The DevOps Handbook*. IT Revolution Press.
- Nygard, M. (2018). *Release It! Design and Deploy Production-Ready Software*. Pragmatic Bookshelf.
- Allspaw, J. (2012). Blameless PostMortems and a Just Culture. *Etsy Engineering Blog*.
- Google SRE. (2024). Postmortem Culture: Learning from Failure.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification addressing UC16 from use-case-targets.md |
