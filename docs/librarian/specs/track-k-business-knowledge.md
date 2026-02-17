# Track K: Business Knowledge Domain

> **Source**: Novel specification extending LiBrainian beyond code knowledge
> **Purpose**: Enable agents to understand and operate the entire business, not just write code
> **Dependency**: Requires Track D (Quantification) for ConfidenceValue types, Track E (Domain) for primitive patterns
>
> **LiBrainian Story**: Code is only part of running a software business. An agent that can only code is like an employee who can only type - useful but incomplete. Track K gives LiBrainian the knowledge primitives to understand markets, products, customers, finances, teams, and operations.
>
> **Theory Reference**: All confidence values MUST use `ConfidenceValue` from Track D. See [GLOSSARY.md](./GLOSSARY.md).

---

## Executive Summary

Track K extends LiBrainian from a code knowledge system to a **business knowledge system**. Just as Track E defines primitives for understanding code domains (data lineage, state traces, timing bounds), Track K defines primitives for understanding business domains:

| Domain | Primitives | Purpose |
|--------|------------|---------|
| **Business Strategy** | 6 primitives | Market analysis, business models, competitive positioning |
| **Product Management** | 6 primitives | User research, roadmaps, metrics |
| **Go-to-Market** | 6 primitives | Marketing, sales, pricing |
| **Financial** | 6 primitives | Modeling, fundraising, operations |
| **Team & Organization** | 6 primitives | Hiring, org design, culture |
| **Legal & Compliance** | 6 primitives | Contracts, IP, regulations |
| **Operations** | 4 primitives | Processes, vendors, automation |

**Total: 40 business primitives + 12 cross-domain compositions**

---

## CRITICAL: Principled Confidence (No Arbitrary Values)

**All confidence values MUST use `ConfidenceValue` type - raw numbers are FORBIDDEN.**

```typescript
// FORBIDDEN - arbitrary number
confidence: 0.7

// CORRECT - honest about uncertainty
confidence: {
  type: 'absent',
  reason: 'insufficient_data' // no_market_data_yet
}

// CORRECT - measured from actual outcomes
confidence: {
  type: 'measured',
  value: 0.68,
  measurement: {
    datasetId: 'market_size_predictions_2025',
    sampleSize: 47,
    accuracy: 0.68,
    confidenceInterval: [0.54, 0.82],
    measuredAt: '2026-01-15'
  }
}
```

---

## Part 1: Business Strategy Domain

### Overview

Business strategy primitives analyze markets, competitors, and positioning to inform strategic decisions.

### Knowledge Sources

| Source Type | Examples | Refresh Frequency |
|-------------|----------|-------------------|
| **Market Data APIs** | Crunchbase, PitchBook, Statista, IBISWorld | Weekly |
| **Competitor Intelligence** | G2, Capterra, ProductHunt, App stores | Daily |
| **Industry Reports** | Gartner, Forrester, McKinsey, BCG | Quarterly |
| **News & Trends** | TechCrunch, HackerNews, Twitter/X, LinkedIn | Real-time |
| **Internal Documents** | Strategy docs, board decks, OKRs | On change |

### Primitives

```typescript
// ============================================================================
// PART 1: BUSINESS STRATEGY PRIMITIVES
// ============================================================================

/**
 * tp_market_size: Estimate total addressable market (TAM/SAM/SOM)
 *
 * Uses top-down (industry reports) and bottom-up (customer counts * ARPU)
 * methodologies to triangulate market size estimates.
 */
export const tp_market_size: TechniquePrimitive = {
  id: 'tp_market_size',
  name: 'Market Size Analysis',
  description: 'Estimate TAM, SAM, and SOM for a market segment',
  inputs: [
    { name: 'marketDefinition', type: 'string', description: 'Clear definition of the market' },
    { name: 'geography', type: 'string[]', description: 'Geographic scope' },
    { name: 'timeHorizon', type: 'number', description: 'Years to project' },
  ],
  outputs: [
    { name: 'tam', type: 'MonetaryEstimate', description: 'Total Addressable Market' },
    { name: 'sam', type: 'MonetaryEstimate', description: 'Serviceable Addressable Market' },
    { name: 'som', type: 'MonetaryEstimate', description: 'Serviceable Obtainable Market' },
    { name: 'growthRate', type: 'PercentageRange', description: 'CAGR estimate' },
    { name: 'methodology', type: 'string', description: 'How estimate was derived' },
    { name: 'sources', type: 'DataSource[]', description: 'Data sources used' },
  ],
  confidence: { type: 'absent', reason: 'requires_market_data_calibration' },
  tier: 3, // Requires LLM synthesis of multiple sources
  preconditions: ['market_definition_clear', 'data_sources_available'],
  postconditions: ['estimates_have_ranges', 'methodology_documented'],
};

/**
 * tp_competitor_analyze: Deep competitor analysis
 *
 * Analyzes competitor positioning, strengths, weaknesses, and strategy
 * from public and proprietary data sources.
 */
export const tp_competitor_analyze: TechniquePrimitive = {
  id: 'tp_competitor_analyze',
  name: 'Competitor Analysis',
  description: 'Analyze competitor positioning, products, and strategy',
  inputs: [
    { name: 'competitorName', type: 'string', description: 'Company to analyze' },
    { name: 'analysisDepth', type: 'string', description: 'surface | deep | exhaustive' },
    { name: 'focusAreas', type: 'string[]', description: 'product | pricing | marketing | team | funding' },
  ],
  outputs: [
    { name: 'profile', type: 'CompetitorProfile', description: 'Company overview' },
    { name: 'productAnalysis', type: 'ProductComparison[]', description: 'Product feature comparison' },
    { name: 'pricingIntel', type: 'PricingIntelligence', description: 'Pricing structure analysis' },
    { name: 'strengths', type: 'string[]', description: 'Identified strengths' },
    { name: 'weaknesses', type: 'string[]', description: 'Identified weaknesses' },
    { name: 'strategyInference', type: 'string', description: 'Inferred strategy' },
    { name: 'dataFreshness', type: 'Date', description: 'When data was last updated' },
  ],
  confidence: { type: 'absent', reason: 'depends_on_data_availability' },
  tier: 3,
  preconditions: ['competitor_exists', 'public_data_available'],
  postconditions: ['analysis_cites_sources', 'freshness_tracked'],
};

/**
 * tp_trend_identify: Identify and track market/technology trends
 *
 * Monitors signals across news, social, patents, and academic sources
 * to identify emerging trends and assess their trajectory.
 */
export const tp_trend_identify: TechniquePrimitive = {
  id: 'tp_trend_identify',
  name: 'Trend Identification',
  description: 'Identify and assess market and technology trends',
  inputs: [
    { name: 'domain', type: 'string', description: 'Domain to monitor' },
    { name: 'signalSources', type: 'string[]', description: 'Sources to monitor' },
    { name: 'timeWindow', type: 'string', description: 'Lookback period' },
  ],
  outputs: [
    { name: 'trends', type: 'Trend[]', description: 'Identified trends' },
    { name: 'signalStrength', type: 'number', description: 'Aggregate signal strength 0-1' },
    { name: 'trajectory', type: 'string', description: 'emerging | growing | peaking | declining' },
    { name: 'relevanceScore', type: 'number', description: 'Relevance to our business 0-1' },
    { name: 'actionability', type: 'string', description: 'Recommended response' },
  ],
  confidence: { type: 'absent', reason: 'trend_prediction_uncalibrated' },
  tier: 3,
  preconditions: ['signal_sources_configured'],
  postconditions: ['trends_have_evidence', 'trajectory_justified'],
};

/**
 * tp_revenue_model: Analyze and design revenue models
 */
export const tp_revenue_model: TechniquePrimitive = {
  id: 'tp_revenue_model',
  name: 'Revenue Model Analysis',
  description: 'Analyze revenue model structure and optimization opportunities',
  inputs: [
    { name: 'currentModel', type: 'RevenueModel', description: 'Current revenue model' },
    { name: 'benchmarks', type: 'string[]', description: 'Companies to benchmark against' },
  ],
  outputs: [
    { name: 'modelAnalysis', type: 'RevenueModelAnalysis', description: 'Current model assessment' },
    { name: 'optimizations', type: 'Optimization[]', description: 'Revenue optimization opportunities' },
    { name: 'alternativeModels', type: 'RevenueModel[]', description: 'Alternative models to consider' },
    { name: 'projections', type: 'RevenueProjection[]', description: 'Scenario projections' },
  ],
  confidence: { type: 'absent', reason: 'requires_financial_calibration' },
  tier: 3,
  preconditions: ['financial_data_available'],
  postconditions: ['projections_have_assumptions'],
};

/**
 * tp_cost_structure: Analyze cost structure and unit economics
 */
export const tp_cost_structure: TechniquePrimitive = {
  id: 'tp_cost_structure',
  name: 'Cost Structure Analysis',
  description: 'Analyze fixed/variable costs and identify optimization opportunities',
  inputs: [
    { name: 'costData', type: 'CostData', description: 'Historical cost data' },
    { name: 'categories', type: 'string[]', description: 'Cost categories to analyze' },
  ],
  outputs: [
    { name: 'fixedCosts', type: 'CostBreakdown', description: 'Fixed cost analysis' },
    { name: 'variableCosts', type: 'CostBreakdown', description: 'Variable cost analysis' },
    { name: 'unitEconomics', type: 'UnitEconomics', description: 'Per-unit cost analysis' },
    { name: 'optimizations', type: 'CostOptimization[]', description: 'Cost reduction opportunities' },
    { name: 'scalingBehavior', type: 'string', description: 'How costs scale with growth' },
  ],
  confidence: { type: 'absent', reason: 'requires_cost_data' },
  tier: 2,
  preconditions: ['cost_data_available'],
  postconditions: ['totals_reconcile'],
};

/**
 * tp_swot_analyze: SWOT analysis with evidence
 */
export const tp_swot_analyze: TechniquePrimitive = {
  id: 'tp_swot_analyze',
  name: 'SWOT Analysis',
  description: 'Perform evidence-based SWOT analysis',
  inputs: [
    { name: 'scope', type: 'string', description: 'company | product | initiative' },
    { name: 'dataSources', type: 'DataSource[]', description: 'Sources to incorporate' },
  ],
  outputs: [
    { name: 'strengths', type: 'SWOTItem[]', description: 'Internal strengths with evidence' },
    { name: 'weaknesses', type: 'SWOTItem[]', description: 'Internal weaknesses with evidence' },
    { name: 'opportunities', type: 'SWOTItem[]', description: 'External opportunities with evidence' },
    { name: 'threats', type: 'SWOTItem[]', description: 'External threats with evidence' },
    { name: 'strategicImplications', type: 'string[]', description: 'Key strategic takeaways' },
  ],
  confidence: { type: 'absent', reason: 'qualitative_assessment' },
  tier: 3,
  preconditions: ['sufficient_data_for_assessment'],
  postconditions: ['items_have_evidence'],
};
```

### Supporting Types

```typescript
interface MonetaryEstimate {
  value: number;
  currency: string;
  lowEstimate: number;
  highEstimate: number;
  basis: string;
}

interface CompetitorProfile {
  name: string;
  founded: Date;
  headquarters: string;
  employeeCount: NumberRange;
  funding: FundingHistory;
  products: string[];
  targetMarket: string;
  estimatedRevenue: MonetaryEstimate;
}

interface Trend {
  name: string;
  description: string;
  signals: TrendSignal[];
  firstObserved: Date;
  momentum: number; // -1 to 1
}

interface TrendSignal {
  source: string;
  type: 'news' | 'social' | 'patent' | 'academic' | 'funding' | 'hiring';
  timestamp: Date;
  content: string;
  weight: number;
}

interface SWOTItem {
  statement: string;
  evidence: EvidenceEntry[];
  impact: 'low' | 'medium' | 'high';
  timeframe: 'immediate' | 'near-term' | 'long-term';
}
```

### Strategy Domain Composition

```typescript
/**
 * tc_strategic_assessment: Full strategic assessment workflow
 */
const tc_strategic_assessment: TechniqueComposition = {
  id: 'tc_strategic_assessment',
  name: 'Strategic Assessment',
  description: 'Comprehensive strategic analysis for planning',
  primitives: [
    'tp_market_size',
    'tp_competitor_analyze',
    'tp_trend_identify',
    'tp_swot_analyze',
    'tp_revenue_model',
    'tp_cost_structure',
  ],
  operators: [
    { type: 'parallel', inputs: ['tp_market_size', 'tp_competitor_analyze', 'tp_trend_identify'] },
    { type: 'sequence', inputs: ['parallel_results', 'tp_swot_analyze'] },
    { type: 'parallel', inputs: ['tp_revenue_model', 'tp_cost_structure'] },
  ],
  expectedConfidence: { type: 'absent', reason: 'composition_uncalibrated' },
};
```

---

## Part 2: Product Management Domain

### Overview

Product management primitives support user research, roadmap planning, and product metrics.

### Knowledge Sources

| Source Type | Examples | Refresh Frequency |
|-------------|----------|-------------------|
| **User Research** | Interview transcripts, surveys, usability tests | Per study |
| **Usage Analytics** | Mixpanel, Amplitude, Heap, PostHog | Real-time |
| **Feedback Systems** | Intercom, Zendesk, Canny, ProductBoard | Real-time |
| **Feature Requests** | GitHub issues, support tickets, sales notes | Real-time |
| **Market Signals** | App store reviews, G2 reviews, social mentions | Daily |

### Primitives

```typescript
// ============================================================================
// PART 2: PRODUCT MANAGEMENT PRIMITIVES
// ============================================================================

/**
 * tp_user_interview_analyze: Synthesize insights from user interviews
 */
export const tp_user_interview_analyze: TechniquePrimitive = {
  id: 'tp_user_interview_analyze',
  name: 'User Interview Analysis',
  description: 'Extract and synthesize insights from user interview transcripts',
  inputs: [
    { name: 'transcripts', type: 'Transcript[]', description: 'Interview transcripts' },
    { name: 'researchQuestions', type: 'string[]', description: 'Questions to answer' },
    { name: 'existingPersonas', type: 'Persona[]', description: 'Existing user personas' },
  ],
  outputs: [
    { name: 'themes', type: 'Theme[]', description: 'Identified themes with quotes' },
    { name: 'insights', type: 'Insight[]', description: 'Actionable insights' },
    { name: 'personaUpdates', type: 'PersonaUpdate[]', description: 'Suggested persona updates' },
    { name: 'opportunities', type: 'Opportunity[]', description: 'Product opportunities' },
    { name: 'quotes', type: 'Quote[]', description: 'Key quotes with context' },
  ],
  confidence: { type: 'absent', reason: 'qualitative_research' },
  tier: 3,
  preconditions: ['transcripts_available'],
  postconditions: ['insights_grounded_in_quotes'],
};

/**
 * tp_survey_synthesize: Analyze survey responses at scale
 */
export const tp_survey_synthesize: TechniquePrimitive = {
  id: 'tp_survey_synthesize',
  name: 'Survey Synthesis',
  description: 'Synthesize quantitative and qualitative survey data',
  inputs: [
    { name: 'responses', type: 'SurveyResponse[]', description: 'Survey responses' },
    { name: 'surveyDesign', type: 'SurveyDesign', description: 'Survey structure' },
    { name: 'segmentation', type: 'string[]', description: 'Dimensions to segment by' },
  ],
  outputs: [
    { name: 'quantitativeResults', type: 'QuantResult[]', description: 'Statistical analysis' },
    { name: 'qualitativeThemes', type: 'Theme[]', description: 'Open-response themes' },
    { name: 'segments', type: 'SegmentAnalysis[]', description: 'Segment-level insights' },
    { name: 'nps', type: 'NPSAnalysis', description: 'NPS score and drivers' },
    { name: 'recommendations', type: 'string[]', description: 'Action recommendations' },
  ],
  confidence: { type: 'absent', reason: 'requires_statistical_validation' },
  tier: 2, // Statistical analysis is deterministic; theme extraction is LLM
  preconditions: ['sufficient_sample_size'],
  postconditions: ['confidence_intervals_reported'],
};

/**
 * tp_feedback_cluster: Cluster and prioritize user feedback
 */
export const tp_feedback_cluster: TechniquePrimitive = {
  id: 'tp_feedback_cluster',
  name: 'Feedback Clustering',
  description: 'Cluster feedback into themes and prioritize by impact',
  inputs: [
    { name: 'feedback', type: 'Feedback[]', description: 'Raw feedback items' },
    { name: 'timeRange', type: 'DateRange', description: 'Time period to analyze' },
    { name: 'userSegments', type: 'string[]', description: 'User segments to consider' },
  ],
  outputs: [
    { name: 'clusters', type: 'FeedbackCluster[]', description: 'Themed clusters' },
    { name: 'trending', type: 'TrendingIssue[]', description: 'Issues gaining momentum' },
    { name: 'prioritized', type: 'PrioritizedItem[]', description: 'Impact-weighted priorities' },
    { name: 'sentiment', type: 'SentimentAnalysis', description: 'Overall sentiment trends' },
  ],
  confidence: { type: 'absent', reason: 'clustering_uncalibrated' },
  tier: 3,
  preconditions: ['feedback_data_available'],
  postconditions: ['clusters_have_examples'],
};

/**
 * tp_prioritize_features: Prioritize features using frameworks
 */
export const tp_prioritize_features: TechniquePrimitive = {
  id: 'tp_prioritize_features',
  name: 'Feature Prioritization',
  description: 'Prioritize features using RICE, ICE, or custom frameworks',
  inputs: [
    { name: 'features', type: 'Feature[]', description: 'Features to prioritize' },
    { name: 'framework', type: 'string', description: 'RICE | ICE | custom' },
    { name: 'weights', type: 'Record<string, number>', description: 'Custom weights' },
    { name: 'constraints', type: 'Constraint[]', description: 'Resource constraints' },
  ],
  outputs: [
    { name: 'prioritized', type: 'PrioritizedFeature[]', description: 'Ranked feature list' },
    { name: 'scores', type: 'FeatureScore[]', description: 'Score breakdown' },
    { name: 'rationale', type: 'string[]', description: 'Prioritization rationale' },
    { name: 'tradeoffs', type: 'Tradeoff[]', description: 'Key tradeoffs identified' },
  ],
  confidence: { type: 'absent', reason: 'estimation_based' },
  tier: 2,
  preconditions: ['feature_data_complete'],
  postconditions: ['scores_explained'],
};

/**
 * tp_kpi_define: Define and structure KPIs
 */
export const tp_kpi_define: TechniquePrimitive = {
  id: 'tp_kpi_define',
  name: 'KPI Definition',
  description: 'Define KPIs with clear ownership and targets',
  inputs: [
    { name: 'objective', type: 'string', description: 'Business objective' },
    { name: 'existingMetrics', type: 'Metric[]', description: 'Available metrics' },
    { name: 'benchmarks', type: 'Benchmark[]', description: 'Industry benchmarks' },
  ],
  outputs: [
    { name: 'kpis', type: 'KPI[]', description: 'Defined KPIs' },
    { name: 'measurementPlan', type: 'MeasurementPlan', description: 'How to measure' },
    { name: 'targets', type: 'Target[]', description: 'Targets with rationale' },
    { name: 'leadingIndicators', type: 'Metric[]', description: 'Leading indicators' },
  ],
  confidence: { type: 'absent', reason: 'target_setting_subjective' },
  tier: 3,
  preconditions: ['objective_clear'],
  postconditions: ['kpis_measurable'],
};

/**
 * tp_funnel_analyze: Analyze conversion funnels
 */
export const tp_funnel_analyze: TechniquePrimitive = {
  id: 'tp_funnel_analyze',
  name: 'Funnel Analysis',
  description: 'Analyze conversion funnels to identify drop-off points',
  inputs: [
    { name: 'funnelDefinition', type: 'FunnelDefinition', description: 'Funnel stages' },
    { name: 'eventData', type: 'EventData', description: 'User event data' },
    { name: 'segments', type: 'string[]', description: 'Segments to compare' },
  ],
  outputs: [
    { name: 'conversionRates', type: 'ConversionRate[]', description: 'Stage-by-stage conversion' },
    { name: 'dropOffPoints', type: 'DropOff[]', description: 'Major drop-off analysis' },
    { name: 'segmentComparison', type: 'SegmentComparison[]', description: 'Cross-segment analysis' },
    { name: 'opportunities', type: 'Opportunity[]', description: 'Improvement opportunities' },
    { name: 'projectedImpact', type: 'ImpactProjection[]', description: 'Impact of improvements' },
  ],
  confidence: { type: 'absent', reason: 'requires_analytics_data' },
  tier: 2,
  preconditions: ['event_data_available'],
  postconditions: ['rates_statistically_valid'],
};
```

### Supporting Types

```typescript
interface Theme {
  name: string;
  description: string;
  prevalence: number; // 0-1, frequency in data
  quotes: Quote[];
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
}

interface Insight {
  statement: string;
  supportingEvidence: EvidenceEntry[];
  actionability: 'high' | 'medium' | 'low';
  confidence: ConfidenceValue;
}

interface KPI {
  name: string;
  definition: string;
  formula: string;
  owner: string;
  target: Target;
  measurementFrequency: string;
  dataSource: string;
}

interface FeedbackCluster {
  id: string;
  theme: string;
  itemCount: number;
  representativeExamples: Feedback[];
  sentiment: number; // -1 to 1
  urgency: 'critical' | 'high' | 'medium' | 'low';
  userSegments: string[];
}
```

### Product Management Composition

```typescript
/**
 * tc_product_discovery: User research to insights workflow
 */
const tc_product_discovery: TechniqueComposition = {
  id: 'tc_product_discovery',
  name: 'Product Discovery',
  description: 'Synthesize user research into actionable insights',
  primitives: [
    'tp_user_interview_analyze',
    'tp_survey_synthesize',
    'tp_feedback_cluster',
    'tp_prioritize_features',
  ],
  operators: [
    { type: 'parallel', inputs: ['tp_user_interview_analyze', 'tp_survey_synthesize', 'tp_feedback_cluster'] },
    { type: 'sequence', inputs: ['parallel_results', 'tp_prioritize_features'] },
  ],
  expectedConfidence: { type: 'absent', reason: 'qualitative_workflow' },
};
```

---

## Part 3: Go-to-Market Domain

### Overview

Go-to-market primitives support marketing, sales, and pricing decisions.

### Knowledge Sources

| Source Type | Examples | Refresh Frequency |
|-------------|----------|-------------------|
| **Marketing Analytics** | Google Analytics, HubSpot, Marketo | Real-time |
| **CRM Data** | Salesforce, HubSpot, Pipedrive | Real-time |
| **Ad Platforms** | Google Ads, Meta Ads, LinkedIn Ads | Real-time |
| **Competitive Pricing** | Price scraping, mystery shopping | Weekly |
| **Content Performance** | Blog analytics, social metrics | Daily |

### Primitives

```typescript
// ============================================================================
// PART 3: GO-TO-MARKET PRIMITIVES
// ============================================================================

/**
 * tp_channel_analyze: Analyze marketing channel performance
 */
export const tp_channel_analyze: TechniquePrimitive = {
  id: 'tp_channel_analyze',
  name: 'Channel Analysis',
  description: 'Analyze marketing channel performance and attribution',
  inputs: [
    { name: 'channelData', type: 'ChannelData[]', description: 'Performance data by channel' },
    { name: 'attributionModel', type: 'string', description: 'first-touch | last-touch | linear | data-driven' },
    { name: 'timeRange', type: 'DateRange', description: 'Analysis period' },
  ],
  outputs: [
    { name: 'channelPerformance', type: 'ChannelMetrics[]', description: 'Metrics by channel' },
    { name: 'attribution', type: 'Attribution[]', description: 'Conversion attribution' },
    { name: 'cac', type: 'CACAnalysis', description: 'Customer acquisition cost' },
    { name: 'recommendations', type: 'BudgetRecommendation[]', description: 'Budget allocation' },
    { name: 'synergies', type: 'ChannelSynergy[]', description: 'Cross-channel effects' },
  ],
  confidence: { type: 'absent', reason: 'attribution_model_dependent' },
  tier: 2,
  preconditions: ['channel_data_available'],
  postconditions: ['attribution_sums_to_100'],
};

/**
 * tp_messaging_test: Analyze messaging effectiveness
 */
export const tp_messaging_test: TechniquePrimitive = {
  id: 'tp_messaging_test',
  name: 'Messaging Test Analysis',
  description: 'Analyze A/B test results for messaging effectiveness',
  inputs: [
    { name: 'variants', type: 'MessageVariant[]', description: 'Message variants tested' },
    { name: 'results', type: 'TestResult[]', description: 'Test results' },
    { name: 'segments', type: 'string[]', description: 'Audience segments' },
  ],
  outputs: [
    { name: 'winner', type: 'MessageVariant', description: 'Winning variant' },
    { name: 'confidence', type: 'StatisticalConfidence', description: 'Statistical significance' },
    { name: 'segmentResults', type: 'SegmentResult[]', description: 'Results by segment' },
    { name: 'insights', type: 'string[]', description: 'Learnings from test' },
    { name: 'nextTests', type: 'TestSuggestion[]', description: 'Suggested follow-up tests' },
  ],
  confidence: { type: 'absent', reason: 'requires_statistical_analysis' },
  tier: 2,
  preconditions: ['test_data_complete'],
  postconditions: ['significance_calculated'],
};

/**
 * tp_content_plan: Generate content strategy and calendar
 */
export const tp_content_plan: TechniquePrimitive = {
  id: 'tp_content_plan',
  name: 'Content Planning',
  description: 'Generate content strategy aligned with business goals',
  inputs: [
    { name: 'goals', type: 'ContentGoal[]', description: 'Content goals' },
    { name: 'audience', type: 'Audience[]', description: 'Target audiences' },
    { name: 'existingContent', type: 'Content[]', description: 'Existing content inventory' },
    { name: 'competitorContent', type: 'Content[]', description: 'Competitor content' },
  ],
  outputs: [
    { name: 'strategy', type: 'ContentStrategy', description: 'Content strategy' },
    { name: 'calendar', type: 'ContentCalendar', description: '90-day calendar' },
    { name: 'gaps', type: 'ContentGap[]', description: 'Content gaps to fill' },
    { name: 'repurposing', type: 'RepurposingOpportunity[]', description: 'Repurposing opportunities' },
  ],
  confidence: { type: 'absent', reason: 'creative_planning' },
  tier: 3,
  preconditions: ['goals_defined'],
  postconditions: ['calendar_achievable'],
};

/**
 * tp_lead_qualify: Score and qualify leads
 */
export const tp_lead_qualify: TechniquePrimitive = {
  id: 'tp_lead_qualify',
  name: 'Lead Qualification',
  description: 'Score and qualify leads based on fit and intent signals',
  inputs: [
    { name: 'leads', type: 'Lead[]', description: 'Leads to qualify' },
    { name: 'scoringModel', type: 'ScoringModel', description: 'Lead scoring model' },
    { name: 'idealProfile', type: 'ICP', description: 'Ideal customer profile' },
  ],
  outputs: [
    { name: 'qualifiedLeads', type: 'QualifiedLead[]', description: 'Scored and qualified leads' },
    { name: 'scores', type: 'LeadScore[]', description: 'Score breakdown' },
    { name: 'prioritization', type: 'PrioritizedLead[]', description: 'Prioritized for outreach' },
    { name: 'disqualified', type: 'DisqualifiedLead[]', description: 'Disqualified with reasons' },
  ],
  confidence: { type: 'absent', reason: 'scoring_model_uncalibrated' },
  tier: 2,
  preconditions: ['lead_data_available'],
  postconditions: ['all_leads_scored'],
};

/**
 * tp_objection_handle: Analyze and respond to sales objections
 */
export const tp_objection_handle: TechniquePrimitive = {
  id: 'tp_objection_handle',
  name: 'Objection Handling',
  description: 'Analyze objection patterns and generate responses',
  inputs: [
    { name: 'objections', type: 'Objection[]', description: 'Recorded objections' },
    { name: 'outcomes', type: 'DealOutcome[]', description: 'Deal outcomes' },
    { name: 'productInfo', type: 'ProductInfo', description: 'Product information' },
  ],
  outputs: [
    { name: 'patterns', type: 'ObjectionPattern[]', description: 'Common objection patterns' },
    { name: 'responses', type: 'ObjectionResponse[]', description: 'Recommended responses' },
    { name: 'effectiveness', type: 'ResponseEffectiveness[]', description: 'Response success rates' },
    { name: 'productGaps', type: 'ProductGap[]', description: 'Product gaps causing objections' },
  ],
  confidence: { type: 'absent', reason: 'response_effectiveness_needs_tracking' },
  tier: 3,
  preconditions: ['objection_data_available'],
  postconditions: ['responses_reference_evidence'],
};

/**
 * tp_price_test: Analyze pricing experiments
 */
export const tp_price_test: TechniquePrimitive = {
  id: 'tp_price_test',
  name: 'Price Testing',
  description: 'Analyze pricing experiments and elasticity',
  inputs: [
    { name: 'pricePoints', type: 'PricePoint[]', description: 'Price points tested' },
    { name: 'conversionData', type: 'ConversionData[]', description: 'Conversion by price' },
    { name: 'segmentData', type: 'SegmentData[]', description: 'Segment-level data' },
  ],
  outputs: [
    { name: 'elasticity', type: 'PriceElasticity', description: 'Price elasticity estimate' },
    { name: 'optimalPrice', type: 'OptimalPrice', description: 'Revenue-optimal price' },
    { name: 'segmentPricing', type: 'SegmentPrice[]', description: 'Segment-specific pricing' },
    { name: 'willingnessToPay', type: 'WTPDistribution', description: 'WTP distribution' },
  ],
  confidence: { type: 'absent', reason: 'requires_sufficient_test_data' },
  tier: 2,
  preconditions: ['price_test_data_available'],
  postconditions: ['elasticity_confidence_reported'],
};
```

### Go-to-Market Composition

```typescript
/**
 * tc_gtm_optimization: Full go-to-market optimization workflow
 */
const tc_gtm_optimization: TechniqueComposition = {
  id: 'tc_gtm_optimization',
  name: 'GTM Optimization',
  description: 'Optimize go-to-market across channels, messaging, and pricing',
  primitives: [
    'tp_channel_analyze',
    'tp_messaging_test',
    'tp_lead_qualify',
    'tp_price_test',
  ],
  operators: [
    { type: 'parallel', inputs: ['tp_channel_analyze', 'tp_messaging_test'] },
    { type: 'sequence', inputs: ['tp_lead_qualify'] },
    { type: 'conditional', condition: 'price_test_running', then: 'tp_price_test' },
  ],
  expectedConfidence: { type: 'absent', reason: 'multi_factor_optimization' },
};
```

---

## Part 4: Financial Domain

### Overview

Financial primitives support modeling, fundraising, and operations finance.

### Knowledge Sources

| Source Type | Examples | Refresh Frequency |
|-------------|----------|-------------------|
| **Accounting Systems** | QuickBooks, Xero, NetSuite | Real-time |
| **Banking Data** | Bank feeds, Plaid integrations | Daily |
| **Investor Databases** | Crunchbase, PitchBook, AngelList | Weekly |
| **Benchmarks** | SaaS metrics benchmarks, industry reports | Quarterly |
| **Fundraising Docs** | Term sheets, cap tables, investor decks | On change |

### Primitives

```typescript
// ============================================================================
// PART 4: FINANCIAL PRIMITIVES
// ============================================================================

/**
 * tp_financial_model: Build and analyze financial models
 */
export const tp_financial_model: TechniquePrimitive = {
  id: 'tp_financial_model',
  name: 'Financial Modeling',
  description: 'Build and analyze financial projections',
  inputs: [
    { name: 'historicalData', type: 'FinancialData', description: 'Historical financials' },
    { name: 'assumptions', type: 'Assumption[]', description: 'Model assumptions' },
    { name: 'scenarios', type: 'string[]', description: 'base | optimistic | pessimistic' },
  ],
  outputs: [
    { name: 'projections', type: 'FinancialProjection[]', description: 'Multi-year projections' },
    { name: 'keyMetrics', type: 'FinancialMetric[]', description: 'Key financial metrics' },
    { name: 'sensitivityAnalysis', type: 'Sensitivity[]', description: 'Assumption sensitivity' },
    { name: 'breakeven', type: 'BreakevenAnalysis', description: 'Breakeven analysis' },
  ],
  confidence: { type: 'absent', reason: 'projections_assumption_dependent' },
  tier: 2,
  preconditions: ['historical_data_available'],
  postconditions: ['assumptions_documented'],
};

/**
 * tp_scenario_analyze: Compare financial scenarios
 */
export const tp_scenario_analyze: TechniquePrimitive = {
  id: 'tp_scenario_analyze',
  name: 'Scenario Analysis',
  description: 'Compare outcomes across different scenarios',
  inputs: [
    { name: 'baseModel', type: 'FinancialModel', description: 'Base financial model' },
    { name: 'scenarios', type: 'Scenario[]', description: 'Scenarios to analyze' },
    { name: 'metrics', type: 'string[]', description: 'Metrics to compare' },
  ],
  outputs: [
    { name: 'comparison', type: 'ScenarioComparison', description: 'Side-by-side comparison' },
    { name: 'riskAssessment', type: 'RiskAssessment', description: 'Risk of each scenario' },
    { name: 'recommendations', type: 'string[]', description: 'Strategic recommendations' },
    { name: 'triggers', type: 'ScenarioTrigger[]', description: 'What would trigger each scenario' },
  ],
  confidence: { type: 'absent', reason: 'scenario_probabilities_uncertain' },
  tier: 2,
  preconditions: ['model_valid'],
  postconditions: ['scenarios_internally_consistent'],
};

/**
 * tp_runway_calculate: Calculate and project runway
 */
export const tp_runway_calculate: TechniquePrimitive = {
  id: 'tp_runway_calculate',
  name: 'Runway Calculation',
  description: 'Calculate remaining runway and project cash position',
  inputs: [
    { name: 'cashPosition', type: 'number', description: 'Current cash balance' },
    { name: 'burnRate', type: 'BurnRateData', description: 'Historical burn rate' },
    { name: 'projections', type: 'CashProjection', description: 'Future cash flows' },
  ],
  outputs: [
    { name: 'runwayMonths', type: 'number', description: 'Months of runway' },
    { name: 'zeroDate', type: 'Date', description: 'Projected zero-cash date' },
    { name: 'burnTrend', type: 'Trend', description: 'Burn rate trend' },
    { name: 'scenarios', type: 'RunwayScenario[]', description: 'Runway under scenarios' },
    { name: 'recommendations', type: 'string[]', description: 'Cash management recommendations' },
  ],
  confidence: {
    type: 'derived',
    value: 0.9,
    formula: 'based on actual cash and historical burn',
    inputs: [
      { name: 'cash_accuracy', value: { type: 'deterministic', value: 1.0, reason: 'bank_balance' } },
      { name: 'burn_stability', value: { type: 'absent', reason: 'burn_variance_unknown' } },
    ],
  },
  tier: 1, // Mostly deterministic calculation
  preconditions: ['cash_data_current'],
  postconditions: ['runway_positive_or_warning'],
};

/**
 * tp_pitch_deck_analyze: Analyze pitch deck effectiveness
 */
export const tp_pitch_deck_analyze: TechniquePrimitive = {
  id: 'tp_pitch_deck_analyze',
  name: 'Pitch Deck Analysis',
  description: 'Analyze pitch deck for investor readiness',
  inputs: [
    { name: 'deck', type: 'PitchDeck', description: 'Pitch deck content' },
    { name: 'stage', type: 'string', description: 'pre-seed | seed | series-a | series-b+' },
    { name: 'benchmarks', type: 'DeckBenchmark[]', description: 'Successful deck benchmarks' },
  ],
  outputs: [
    { name: 'score', type: 'DeckScore', description: 'Overall deck score' },
    { name: 'sectionScores', type: 'SectionScore[]', description: 'Score by section' },
    { name: 'gaps', type: 'DeckGap[]', description: 'Missing or weak sections' },
    { name: 'suggestions', type: 'Suggestion[]', description: 'Improvement suggestions' },
    { name: 'redFlags', type: 'RedFlag[]', description: 'Investor red flags' },
  ],
  confidence: { type: 'absent', reason: 'deck_success_subjective' },
  tier: 3,
  preconditions: ['deck_content_available'],
  postconditions: ['suggestions_actionable'],
};

/**
 * tp_investor_match: Match with relevant investors
 */
export const tp_investor_match: TechniquePrimitive = {
  id: 'tp_investor_match',
  name: 'Investor Matching',
  description: 'Match company with relevant investors',
  inputs: [
    { name: 'companyProfile', type: 'CompanyProfile', description: 'Company details' },
    { name: 'fundingTarget', type: 'FundingTarget', description: 'Round details' },
    { name: 'investorDatabase', type: 'InvestorDatabase', description: 'Investor database' },
  ],
  outputs: [
    { name: 'matches', type: 'InvestorMatch[]', description: 'Ranked investor matches' },
    { name: 'warmPaths', type: 'WarmIntro[]', description: 'Warm introduction paths' },
    { name: 'fitScores', type: 'FitScore[]', description: 'Fit score breakdown' },
    { name: 'outreachStrategy', type: 'OutreachStrategy', description: 'Recommended approach' },
  ],
  confidence: { type: 'absent', reason: 'investor_preferences_opaque' },
  tier: 3,
  preconditions: ['investor_data_available'],
  postconditions: ['matches_have_rationale'],
};

/**
 * tp_term_sheet_analyze: Analyze term sheet terms
 */
export const tp_term_sheet_analyze: TechniquePrimitive = {
  id: 'tp_term_sheet_analyze',
  name: 'Term Sheet Analysis',
  description: 'Analyze term sheet for founder-friendliness',
  inputs: [
    { name: 'termSheet', type: 'TermSheet', description: 'Term sheet content' },
    { name: 'marketData', type: 'MarketTerms', description: 'Market term benchmarks' },
    { name: 'companyContext', type: 'CompanyContext', description: 'Company situation' },
  ],
  outputs: [
    { name: 'analysis', type: 'TermAnalysis[]', description: 'Term-by-term analysis' },
    { name: 'founderScore', type: 'number', description: 'Founder-friendliness 0-100' },
    { name: 'marketComparison', type: 'MarketComparison', description: 'Comparison to market' },
    { name: 'negotiationPoints', type: 'NegotiationPoint[]', description: 'Points to negotiate' },
    { name: 'redFlags', type: 'TermRedFlag[]', description: 'Concerning terms' },
  ],
  confidence: { type: 'absent', reason: 'term_fairness_context_dependent' },
  tier: 3,
  preconditions: ['term_sheet_available'],
  postconditions: ['all_terms_analyzed'],
};
```

### Financial Composition

```typescript
/**
 * tc_fundraising_prep: Fundraising preparation workflow
 */
const tc_fundraising_prep: TechniqueComposition = {
  id: 'tc_fundraising_prep',
  name: 'Fundraising Preparation',
  description: 'Prepare for fundraising round',
  primitives: [
    'tp_financial_model',
    'tp_runway_calculate',
    'tp_pitch_deck_analyze',
    'tp_investor_match',
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_financial_model', 'tp_runway_calculate'] },
    { type: 'parallel', inputs: ['tp_pitch_deck_analyze', 'tp_investor_match'] },
  ],
  expectedConfidence: { type: 'absent', reason: 'fundraising_outcome_uncertain' },
};
```

---

## Part 5: Team & Organization Domain

### Overview

Team primitives support hiring, organization design, and culture development.

### Knowledge Sources

| Source Type | Examples | Refresh Frequency |
|-------------|----------|-------------------|
| **HRIS Systems** | Rippling, Gusto, BambooHR | Real-time |
| **ATS Systems** | Greenhouse, Lever, Ashby | Real-time |
| **Performance Data** | Lattice, 15Five, Culture Amp | Quarterly |
| **Compensation Data** | Pave, Radford, Glassdoor | Monthly |
| **Org Charts** | Internal documentation | On change |

### Primitives

```typescript
// ============================================================================
// PART 5: TEAM & ORGANIZATION PRIMITIVES
// ============================================================================

/**
 * tp_job_spec_generate: Generate job specifications
 */
export const tp_job_spec_generate: TechniquePrimitive = {
  id: 'tp_job_spec_generate',
  name: 'Job Spec Generation',
  description: 'Generate job specifications from role requirements',
  inputs: [
    { name: 'roleRequirements', type: 'RoleRequirements', description: 'What the role needs to do' },
    { name: 'teamContext', type: 'TeamContext', description: 'Existing team composition' },
    { name: 'companyValues', type: 'string[]', description: 'Company values to reflect' },
    { name: 'benchmarks', type: 'JobBenchmark[]', description: 'Similar role benchmarks' },
  ],
  outputs: [
    { name: 'jobSpec', type: 'JobSpec', description: 'Complete job specification' },
    { name: 'compensationRange', type: 'CompensationRange', description: 'Market-informed range' },
    { name: 'interviewPlan', type: 'InterviewPlan', description: 'Suggested interview process' },
    { name: 'scoringRubric', type: 'ScoringRubric', description: 'Candidate evaluation rubric' },
  ],
  confidence: { type: 'absent', reason: 'role_fit_contextual' },
  tier: 3,
  preconditions: ['requirements_defined'],
  postconditions: ['spec_complete'],
};

/**
 * tp_candidate_evaluate: Evaluate candidates against criteria
 */
export const tp_candidate_evaluate: TechniquePrimitive = {
  id: 'tp_candidate_evaluate',
  name: 'Candidate Evaluation',
  description: 'Evaluate candidates against job requirements',
  inputs: [
    { name: 'candidateData', type: 'CandidateData', description: 'Candidate information' },
    { name: 'jobSpec', type: 'JobSpec', description: 'Job specification' },
    { name: 'scoringRubric', type: 'ScoringRubric', description: 'Evaluation rubric' },
    { name: 'interviewFeedback', type: 'InterviewFeedback[]', description: 'Interview notes' },
  ],
  outputs: [
    { name: 'overallScore', type: 'number', description: 'Overall fit score 0-100' },
    { name: 'dimensionScores', type: 'DimensionScore[]', description: 'Score by dimension' },
    { name: 'strengths', type: 'string[]', description: 'Key strengths' },
    { name: 'concerns', type: 'string[]', description: 'Areas of concern' },
    { name: 'recommendation', type: 'HiringRecommendation', description: 'Hire/pass recommendation' },
  ],
  confidence: { type: 'absent', reason: 'hiring_prediction_uncertain' },
  tier: 3,
  preconditions: ['candidate_data_available'],
  postconditions: ['recommendation_justified'],
};

/**
 * tp_org_design: Design organizational structure
 */
export const tp_org_design: TechniquePrimitive = {
  id: 'tp_org_design',
  name: 'Org Design',
  description: 'Design or restructure organizational structure',
  inputs: [
    { name: 'currentOrg', type: 'OrgStructure', description: 'Current org structure' },
    { name: 'strategicGoals', type: 'Goal[]', description: 'Strategic goals' },
    { name: 'constraints', type: 'Constraint[]', description: 'Headcount, budget constraints' },
    { name: 'growthPlan', type: 'GrowthPlan', description: 'Hiring plan' },
  ],
  outputs: [
    { name: 'proposedOrg', type: 'OrgStructure', description: 'Proposed structure' },
    { name: 'transitions', type: 'OrgTransition[]', description: 'Transition steps' },
    { name: 'risks', type: 'OrgRisk[]', description: 'Risks of restructure' },
    { name: 'rationale', type: 'string', description: 'Design rationale' },
  ],
  confidence: { type: 'absent', reason: 'org_effectiveness_hard_to_measure' },
  tier: 3,
  preconditions: ['current_org_documented'],
  postconditions: ['transitions_feasible'],
};

/**
 * tp_role_define: Define roles and responsibilities
 */
export const tp_role_define: TechniquePrimitive = {
  id: 'tp_role_define',
  name: 'Role Definition',
  description: 'Define clear roles, responsibilities, and accountabilities',
  inputs: [
    { name: 'roleTitle', type: 'string', description: 'Role title' },
    { name: 'teamContext', type: 'TeamContext', description: 'Team this role belongs to' },
    { name: 'existingRoles', type: 'Role[]', description: 'Other roles in team' },
  ],
  outputs: [
    { name: 'role', type: 'RoleDefinition', description: 'Complete role definition' },
    { name: 'raci', type: 'RACIMatrix', description: 'RACI for key activities' },
    { name: 'overlaps', type: 'RoleOverlap[]', description: 'Overlaps with other roles' },
    { name: 'gaps', type: 'ResponsibilityGap[]', description: 'Uncovered responsibilities' },
  ],
  confidence: { type: 'absent', reason: 'role_clarity_subjective' },
  tier: 3,
  preconditions: ['team_context_available'],
  postconditions: ['no_critical_gaps'],
};

/**
 * tp_values_articulate: Articulate and refine company values
 */
export const tp_values_articulate: TechniquePrimitive = {
  id: 'tp_values_articulate',
  name: 'Values Articulation',
  description: 'Articulate company values from observed behaviors',
  inputs: [
    { name: 'behaviorExamples', type: 'BehaviorExample[]', description: 'Observed behaviors' },
    { name: 'existingValues', type: 'string[]', description: 'Current stated values' },
    { name: 'employeeFeedback', type: 'Feedback[]', description: 'Employee input' },
  ],
  outputs: [
    { name: 'values', type: 'Value[]', description: 'Articulated values' },
    { name: 'behaviors', type: 'ValueBehavior[]', description: 'Behaviors that exemplify values' },
    { name: 'gaps', type: 'ValueGap[]', description: 'Stated vs lived gaps' },
    { name: 'recommendations', type: 'string[]', description: 'Recommendations for alignment' },
  ],
  confidence: { type: 'absent', reason: 'values_qualitative' },
  tier: 3,
  preconditions: ['behavior_examples_available'],
  postconditions: ['values_grounded_in_evidence'],
};

/**
 * tp_engagement_analyze: Analyze employee engagement
 */
export const tp_engagement_analyze: TechniquePrimitive = {
  id: 'tp_engagement_analyze',
  name: 'Engagement Analysis',
  description: 'Analyze employee engagement and satisfaction',
  inputs: [
    { name: 'surveyData', type: 'EngagementSurvey', description: 'Engagement survey results' },
    { name: 'benchmarks', type: 'EngagementBenchmark[]', description: 'Industry benchmarks' },
    { name: 'historicalData', type: 'EngagementSurvey[]', description: 'Previous surveys' },
  ],
  outputs: [
    { name: 'overallScore', type: 'EngagementScore', description: 'eNPS and overall score' },
    { name: 'dimensionScores', type: 'DimensionScore[]', description: 'Score by dimension' },
    { name: 'trends', type: 'EngagementTrend[]', description: 'Trends over time' },
    { name: 'drivers', type: 'EngagementDriver[]', description: 'Key engagement drivers' },
    { name: 'actionItems', type: 'ActionItem[]', description: 'Recommended actions' },
  ],
  confidence: { type: 'absent', reason: 'engagement_surveys_imperfect' },
  tier: 2,
  preconditions: ['survey_data_available'],
  postconditions: ['trends_significant'],
};
```

---

## Part 6: Legal & Compliance Domain

### Overview

Legal primitives support contract analysis, IP management, and regulatory compliance.

### Knowledge Sources

| Source Type | Examples | Refresh Frequency |
|-------------|----------|-------------------|
| **Contract Repository** | Ironclad, DocuSign, internal storage | On change |
| **Legal Databases** | Westlaw, LexisNexis | Weekly |
| **Patent Databases** | USPTO, Google Patents, Espacenet | Weekly |
| **Regulatory Updates** | Federal Register, state regulators | Daily |
| **Compliance Frameworks** | SOC 2, GDPR, HIPAA docs | On change |

### Primitives

```typescript
// ============================================================================
// PART 6: LEGAL & COMPLIANCE PRIMITIVES
// ============================================================================

/**
 * tp_contract_analyze: Analyze contract terms and risks
 */
export const tp_contract_analyze: TechniquePrimitive = {
  id: 'tp_contract_analyze',
  name: 'Contract Analysis',
  description: 'Analyze contract for key terms and risks',
  inputs: [
    { name: 'contract', type: 'ContractDocument', description: 'Contract text' },
    { name: 'contractType', type: 'string', description: 'Type of contract' },
    { name: 'playbook', type: 'ContractPlaybook', description: 'Standard positions' },
  ],
  outputs: [
    { name: 'keyTerms', type: 'KeyTerm[]', description: 'Identified key terms' },
    { name: 'risks', type: 'ContractRisk[]', description: 'Risk assessment' },
    { name: 'deviations', type: 'PlaybookDeviation[]', description: 'Deviations from playbook' },
    { name: 'redlines', type: 'Redline[]', description: 'Suggested redlines' },
    { name: 'summary', type: 'ContractSummary', description: 'Plain-language summary' },
  ],
  confidence: { type: 'absent', reason: 'legal_interpretation_requires_counsel' },
  tier: 3,
  preconditions: ['contract_text_available'],
  postconditions: ['not_legal_advice_disclaimer'],
};

/**
 * tp_terms_compare: Compare terms across contracts
 */
export const tp_terms_compare: TechniquePrimitive = {
  id: 'tp_terms_compare',
  name: 'Terms Comparison',
  description: 'Compare terms across multiple contracts or versions',
  inputs: [
    { name: 'contracts', type: 'ContractDocument[]', description: 'Contracts to compare' },
    { name: 'termTypes', type: 'string[]', description: 'Term types to focus on' },
  ],
  outputs: [
    { name: 'comparison', type: 'TermComparison[]', description: 'Term-by-term comparison' },
    { name: 'bestTerms', type: 'BestTerm[]', description: 'Best terms in corpus' },
    { name: 'worstTerms', type: 'WorstTerm[]', description: 'Worst terms in corpus' },
    { name: 'standardization', type: 'StandardizationOpportunity[]', description: 'Standardization opportunities' },
  ],
  confidence: { type: 'absent', reason: 'term_quality_contextual' },
  tier: 3,
  preconditions: ['contracts_available'],
  postconditions: ['comparison_complete'],
};

/**
 * tp_risk_identify: Identify legal and contractual risks
 */
export const tp_risk_identify: TechniquePrimitive = {
  id: 'tp_risk_identify',
  name: 'Risk Identification',
  description: 'Identify legal, contractual, and compliance risks',
  inputs: [
    { name: 'scope', type: 'RiskScope', description: 'Area to assess' },
    { name: 'context', type: 'BusinessContext', description: 'Business context' },
    { name: 'regulations', type: 'Regulation[]', description: 'Applicable regulations' },
  ],
  outputs: [
    { name: 'risks', type: 'LegalRisk[]', description: 'Identified risks' },
    { name: 'severity', type: 'RiskSeverity[]', description: 'Severity assessment' },
    { name: 'mitigations', type: 'Mitigation[]', description: 'Mitigation strategies' },
    { name: 'recommendations', type: 'string[]', description: 'Recommended actions' },
  ],
  confidence: { type: 'absent', reason: 'risk_assessment_requires_expertise' },
  tier: 3,
  preconditions: ['scope_defined'],
  postconditions: ['risks_prioritized'],
};

/**
 * tp_patent_search: Search and analyze patents
 */
export const tp_patent_search: TechniquePrimitive = {
  id: 'tp_patent_search',
  name: 'Patent Search',
  description: 'Search and analyze relevant patents',
  inputs: [
    { name: 'invention', type: 'InventionDescription', description: 'Invention to search for' },
    { name: 'searchType', type: 'string', description: 'freedom-to-operate | prior-art | landscape' },
    { name: 'jurisdictions', type: 'string[]', description: 'Patent jurisdictions' },
  ],
  outputs: [
    { name: 'patents', type: 'PatentResult[]', description: 'Relevant patents' },
    { name: 'analysis', type: 'PatentAnalysis[]', description: 'Patent analysis' },
    { name: 'risks', type: 'PatentRisk[]', description: 'Infringement risks' },
    { name: 'whitespace', type: 'Whitespace[]', description: 'Unpatented areas' },
  ],
  confidence: { type: 'absent', reason: 'patent_search_requires_expertise' },
  tier: 3,
  preconditions: ['invention_described'],
  postconditions: ['search_documented'],
};

/**
 * tp_regulation_check: Check regulatory compliance
 */
export const tp_regulation_check: TechniquePrimitive = {
  id: 'tp_regulation_check',
  name: 'Regulation Check',
  description: 'Check compliance with applicable regulations',
  inputs: [
    { name: 'activity', type: 'BusinessActivity', description: 'Activity to check' },
    { name: 'jurisdictions', type: 'string[]', description: 'Jurisdictions' },
    { name: 'regulations', type: 'Regulation[]', description: 'Regulations to check' },
  ],
  outputs: [
    { name: 'requirements', type: 'Requirement[]', description: 'Applicable requirements' },
    { name: 'complianceStatus', type: 'ComplianceStatus[]', description: 'Current compliance' },
    { name: 'gaps', type: 'ComplianceGap[]', description: 'Compliance gaps' },
    { name: 'remediation', type: 'Remediation[]', description: 'Remediation steps' },
  ],
  confidence: { type: 'absent', reason: 'regulation_interpretation_complex' },
  tier: 3,
  preconditions: ['regulations_identified'],
  postconditions: ['gaps_actionable'],
};

/**
 * tp_audit_prepare: Prepare for compliance audits
 */
export const tp_audit_prepare: TechniquePrimitive = {
  id: 'tp_audit_prepare',
  name: 'Audit Preparation',
  description: 'Prepare documentation and evidence for audits',
  inputs: [
    { name: 'auditType', type: 'string', description: 'Type of audit (SOC2, ISO, etc.)' },
    { name: 'scope', type: 'AuditScope', description: 'Audit scope' },
    { name: 'currentDocumentation', type: 'Documentation[]', description: 'Existing documentation' },
  ],
  outputs: [
    { name: 'checklist', type: 'AuditChecklist', description: 'Audit checklist' },
    { name: 'gaps', type: 'DocumentationGap[]', description: 'Documentation gaps' },
    { name: 'evidenceMap', type: 'EvidenceMap', description: 'Evidence for each control' },
    { name: 'readinessScore', type: 'number', description: 'Audit readiness 0-100' },
    { name: 'remediation', type: 'RemediationPlan', description: 'Gap remediation plan' },
  ],
  confidence: { type: 'absent', reason: 'audit_outcome_uncertain' },
  tier: 3,
  preconditions: ['audit_type_known'],
  postconditions: ['checklist_complete'],
};
```

---

## Part 7: Operations Domain

### Overview

Operations primitives support process improvement, vendor management, and automation.

### Knowledge Sources

| Source Type | Examples | Refresh Frequency |
|-------------|----------|-------------------|
| **Process Documentation** | Notion, Confluence, internal wikis | On change |
| **Workflow Systems** | Zapier, n8n, custom automation | Real-time |
| **Vendor Contracts** | Contract repository | On change |
| **Operational Metrics** | Internal dashboards | Real-time |

### Primitives

```typescript
// ============================================================================
// PART 7: OPERATIONS PRIMITIVES
// ============================================================================

/**
 * tp_workflow_map: Map and analyze workflows
 */
export const tp_workflow_map: TechniquePrimitive = {
  id: 'tp_workflow_map',
  name: 'Workflow Mapping',
  description: 'Map and analyze business workflows',
  inputs: [
    { name: 'workflowName', type: 'string', description: 'Workflow to map' },
    { name: 'interviews', type: 'WorkflowInterview[]', description: 'Stakeholder inputs' },
    { name: 'existingDocs', type: 'Document[]', description: 'Existing documentation' },
  ],
  outputs: [
    { name: 'workflow', type: 'WorkflowDefinition', description: 'Mapped workflow' },
    { name: 'steps', type: 'WorkflowStep[]', description: 'Workflow steps' },
    { name: 'owners', type: 'StepOwnership[]', description: 'Step ownership' },
    { name: 'metrics', type: 'WorkflowMetric[]', description: 'Current performance metrics' },
    { name: 'diagram', type: 'WorkflowDiagram', description: 'Visual diagram' },
  ],
  confidence: { type: 'absent', reason: 'workflow_complexity_varies' },
  tier: 3,
  preconditions: ['workflow_exists'],
  postconditions: ['workflow_complete'],
};

/**
 * tp_bottleneck_identify: Identify operational bottlenecks
 */
export const tp_bottleneck_identify: TechniquePrimitive = {
  id: 'tp_bottleneck_identify',
  name: 'Bottleneck Identification',
  description: 'Identify bottlenecks in workflows and processes',
  inputs: [
    { name: 'workflow', type: 'WorkflowDefinition', description: 'Workflow to analyze' },
    { name: 'performanceData', type: 'PerformanceData', description: 'Historical performance' },
    { name: 'constraints', type: 'ResourceConstraint[]', description: 'Resource constraints' },
  ],
  outputs: [
    { name: 'bottlenecks', type: 'Bottleneck[]', description: 'Identified bottlenecks' },
    { name: 'rootCauses', type: 'RootCause[]', description: 'Root cause analysis' },
    { name: 'impact', type: 'BottleneckImpact[]', description: 'Business impact' },
    { name: 'solutions', type: 'Solution[]', description: 'Proposed solutions' },
  ],
  confidence: { type: 'absent', reason: 'bottleneck_measurement_needed' },
  tier: 2,
  preconditions: ['performance_data_available'],
  postconditions: ['bottlenecks_quantified'],
};

/**
 * tp_automation_plan: Plan workflow automation
 */
export const tp_automation_plan: TechniquePrimitive = {
  id: 'tp_automation_plan',
  name: 'Automation Planning',
  description: 'Plan automation opportunities in workflows',
  inputs: [
    { name: 'workflow', type: 'WorkflowDefinition', description: 'Workflow to automate' },
    { name: 'currentTools', type: 'Tool[]', description: 'Available tools' },
    { name: 'budget', type: 'Budget', description: 'Automation budget' },
  ],
  outputs: [
    { name: 'opportunities', type: 'AutomationOpportunity[]', description: 'Automation opportunities' },
    { name: 'roi', type: 'ROIAnalysis[]', description: 'ROI for each opportunity' },
    { name: 'implementationPlan', type: 'ImplementationPlan', description: 'Implementation roadmap' },
    { name: 'risks', type: 'AutomationRisk[]', description: 'Automation risks' },
  ],
  confidence: { type: 'absent', reason: 'automation_roi_estimated' },
  tier: 3,
  preconditions: ['workflow_mapped'],
  postconditions: ['roi_calculated'],
};

/**
 * tp_vendor_evaluate: Evaluate vendors
 */
export const tp_vendor_evaluate: TechniquePrimitive = {
  id: 'tp_vendor_evaluate',
  name: 'Vendor Evaluation',
  description: 'Evaluate and compare vendors',
  inputs: [
    { name: 'requirements', type: 'VendorRequirement[]', description: 'Requirements' },
    { name: 'vendors', type: 'Vendor[]', description: 'Vendors to evaluate' },
    { name: 'weights', type: 'CriteriaWeight[]', description: 'Evaluation criteria weights' },
  ],
  outputs: [
    { name: 'scores', type: 'VendorScore[]', description: 'Vendor scores' },
    { name: 'comparison', type: 'VendorComparison', description: 'Side-by-side comparison' },
    { name: 'recommendation', type: 'VendorRecommendation', description: 'Recommended vendor' },
    { name: 'negotiationPoints', type: 'NegotiationPoint[]', description: 'Points to negotiate' },
  ],
  confidence: { type: 'absent', reason: 'vendor_performance_uncertain' },
  tier: 3,
  preconditions: ['requirements_defined'],
  postconditions: ['scores_explained'],
};
```

---

## Part 8: Integration with Code Knowledge

### The Business-Code Traceability Chain

The key innovation of Track K is connecting business knowledge to code knowledge:

```
Business Goal
     │
     ▼
Product Feature ◄──── tp_metric_trace
     │
     ▼
Technical Task ◄──── track-e primitives (tp_data_lineage, tp_state_trace, etc.)
     │
     ▼
Code Change ◄──── Track B (Bootstrap), Track C (Hierarchical)
     │
     ▼
Metrics Impact ◄──── tp_funnel_analyze, tp_kpi_define
     │
     ▼
Business Outcome ◄──── tp_revenue_model, tp_cost_structure
```

### Cross-Domain Primitives

```typescript
// ============================================================================
// CROSS-DOMAIN INTEGRATION PRIMITIVES
// ============================================================================

/**
 * tp_goal_feature_trace: Trace business goals to features
 */
export const tp_goal_feature_trace: TechniquePrimitive = {
  id: 'tp_goal_feature_trace',
  name: 'Goal-Feature Tracing',
  description: 'Trace business goals to implementing features',
  inputs: [
    { name: 'goal', type: 'BusinessGoal', description: 'Business goal' },
    { name: 'featureRegistry', type: 'FeatureRegistry', description: 'All features' },
  ],
  outputs: [
    { name: 'features', type: 'LinkedFeature[]', description: 'Features supporting goal' },
    { name: 'coverage', type: 'number', description: 'Goal coverage 0-1' },
    { name: 'gaps', type: 'GoalGap[]', description: 'Unsupported aspects' },
  ],
  confidence: { type: 'absent', reason: 'goal_feature_mapping_subjective' },
  tier: 3,
  preconditions: ['goal_defined', 'features_exist'],
  postconditions: ['linkages_explained'],
};

/**
 * tp_feature_code_trace: Trace features to code
 */
export const tp_feature_code_trace: TechniquePrimitive = {
  id: 'tp_feature_code_trace',
  name: 'Feature-Code Tracing',
  description: 'Trace features to implementing code',
  inputs: [
    { name: 'feature', type: 'Feature', description: 'Feature to trace' },
    { name: 'codebaseIndex', type: 'CodebaseIndex', description: 'Indexed codebase' },
  ],
  outputs: [
    { name: 'entities', type: 'CodeEntity[]', description: 'Implementing code entities' },
    { name: 'entryPoints', type: 'EntryPoint[]', description: 'Feature entry points' },
    { name: 'dependencies', type: 'Dependency[]', description: 'Code dependencies' },
    { name: 'testCoverage', type: 'TestCoverage', description: 'Test coverage' },
  ],
  confidence: { type: 'absent', reason: 'feature_code_mapping_heuristic' },
  tier: 3,
  preconditions: ['codebase_indexed'],
  postconditions: ['entities_verified'],
};

/**
 * tp_code_metric_trace: Trace code changes to metrics
 */
export const tp_code_metric_trace: TechniquePrimitive = {
  id: 'tp_code_metric_trace',
  name: 'Code-Metric Tracing',
  description: 'Trace code changes to business metrics impact',
  inputs: [
    { name: 'codeChange', type: 'CodeChange', description: 'Code change' },
    { name: 'metricDefinitions', type: 'MetricDefinition[]', description: 'Tracked metrics' },
    { name: 'historicalData', type: 'MetricHistory', description: 'Historical metric data' },
  ],
  outputs: [
    { name: 'impactedMetrics', type: 'ImpactedMetric[]', description: 'Potentially impacted metrics' },
    { name: 'impactEstimate', type: 'ImpactEstimate[]', description: 'Estimated impact' },
    { name: 'confidence', type: 'ConfidenceValue', description: 'Confidence in estimate' },
    { name: 'monitoringPlan', type: 'MonitoringPlan', description: 'What to monitor' },
  ],
  confidence: { type: 'absent', reason: 'metric_attribution_uncertain' },
  tier: 3,
  preconditions: ['metrics_defined'],
  postconditions: ['impact_estimated'],
};

/**
 * tp_tech_cost_analyze: Analyze technical decisions' business costs
 */
export const tp_tech_cost_analyze: TechniquePrimitive = {
  id: 'tp_tech_cost_analyze',
  name: 'Technical Cost Analysis',
  description: 'Analyze business cost implications of technical decisions',
  inputs: [
    { name: 'technicalDecision', type: 'TechnicalDecision', description: 'Decision to analyze' },
    { name: 'costData', type: 'CostData', description: 'Cost baseline' },
    { name: 'alternatives', type: 'Alternative[]', description: 'Alternative approaches' },
  ],
  outputs: [
    { name: 'costImpact', type: 'CostImpact', description: 'Cost impact analysis' },
    { name: 'tco', type: 'TCOAnalysis', description: 'Total cost of ownership' },
    { name: 'comparison', type: 'AlternativeComparison', description: 'Comparison to alternatives' },
    { name: 'recommendation', type: 'CostRecommendation', description: 'Cost-optimized recommendation' },
  ],
  confidence: { type: 'absent', reason: 'cost_projection_uncertain' },
  tier: 3,
  preconditions: ['decision_defined'],
  postconditions: ['costs_quantified'],
};
```

### Master Business Intelligence Composition

```typescript
/**
 * tc_business_intelligence: Full business intelligence workflow
 *
 * This composition connects all business domains with code knowledge
 * to provide a complete picture of business operations.
 */
const tc_business_intelligence: TechniqueComposition = {
  id: 'tc_business_intelligence',
  name: 'Business Intelligence',
  description: 'Complete business intelligence across all domains',
  primitives: [
    // Strategy
    'tp_market_size',
    'tp_competitor_analyze',
    'tp_swot_analyze',
    // Product
    'tp_feedback_cluster',
    'tp_prioritize_features',
    'tp_funnel_analyze',
    // GTM
    'tp_channel_analyze',
    'tp_price_test',
    // Finance
    'tp_financial_model',
    'tp_runway_calculate',
    // Integration
    'tp_goal_feature_trace',
    'tp_code_metric_trace',
    'tp_tech_cost_analyze',
  ],
  operators: [
    { type: 'parallel', inputs: ['tp_market_size', 'tp_competitor_analyze'] },
    { type: 'sequence', inputs: ['parallel_strategy', 'tp_swot_analyze'] },
    { type: 'parallel', inputs: ['tp_feedback_cluster', 'tp_channel_analyze'] },
    { type: 'sequence', inputs: ['tp_prioritize_features', 'tp_goal_feature_trace'] },
    { type: 'sequence', inputs: ['tp_goal_feature_trace', 'tp_code_metric_trace'] },
    { type: 'parallel', inputs: ['tp_financial_model', 'tp_tech_cost_analyze'] },
  ],
  expectedConfidence: { type: 'absent', reason: 'cross_domain_composition' },
};
```

---

## Integration with Existing LiBrainian Features

### Knowledge Store Integration

Business knowledge integrates with the existing knowledge store:

```typescript
interface BusinessKnowledgeEntry {
  /** Knowledge type */
  domain: 'strategy' | 'product' | 'gtm' | 'finance' | 'team' | 'legal' | 'operations';

  /** Primitive that produced this knowledge */
  sourceId: string;

  /** The knowledge claim */
  claim: Claim;

  /** Linked code entities (for traceability) */
  linkedEntities?: EntityId[];

  /** Linked business entities */
  linkedBusinessEntities?: BusinessEntityId[];

  /** Confidence in this knowledge */
  confidence: ConfidenceValue;

  /** When this knowledge expires */
  expiresAt?: Date;
}
```

### Query Integration

Business queries integrate with the RelevanceEngine:

```typescript
interface BusinessQuery {
  /** Query text */
  query: string;

  /** Business domains to search */
  domains: BusinessDomain[];

  /** Include code knowledge? */
  includeCode: boolean;

  /** Time range for data */
  timeRange?: DateRange;

  /** Confidence threshold */
  minConfidence?: number;
}

interface BusinessQueryResult {
  /** Business knowledge results */
  businessKnowledge: BusinessKnowledgeEntry[];

  /** Related code knowledge */
  codeKnowledge?: KnowledgeResult;

  /** Cross-domain links */
  traceabilityLinks: TraceabilityLink[];

  /** Query confidence */
  confidence: ConfidenceValue;
}
```

---

## Implementation Roadmap

### Phase 1: Core Primitives (K1-K4)

| Priority | Domain | Primitives | LOC | Dependencies |
|----------|--------|------------|-----|--------------|
| **K1** | Strategy | 6 primitives | ~400 | Track D (ConfidenceValue) |
| **K2** | Product | 6 primitives | ~400 | K1, external APIs |
| **K3** | GTM | 6 primitives | ~400 | K1, K2 |
| **K4** | Finance | 6 primitives | ~400 | K1 |

### Phase 2: Organization & Compliance (K5-K6)

| Priority | Domain | Primitives | LOC | Dependencies |
|----------|--------|------------|-----|--------------|
| **K5** | Team | 6 primitives | ~350 | K1 |
| **K6** | Legal | 6 primitives | ~350 | K1 |

### Phase 3: Operations & Integration (K7-K8)

| Priority | Domain | Primitives | LOC | Dependencies |
|----------|--------|------------|-----|--------------|
| **K7** | Operations | 4 primitives | ~300 | K1-K6 |
| **K8** | Integration | 4 cross-domain | ~300 | K1-K7, Track E |

### Total Estimated LOC: ~2,900

---

## Acceptance Criteria

### Per Primitive
- [ ] Input/output types fully specified
- [ ] Confidence uses `ConfidenceValue` (no raw numbers)
- [ ] Knowledge sources documented
- [ ] Integration points with code knowledge defined
- [ ] Preconditions and postconditions specified

### Per Domain
- [ ] All primitives specified
- [ ] At least one composition defined
- [ ] Knowledge sources enumerated
- [ ] Refresh frequencies documented

### Cross-Domain
- [ ] Business-to-code traceability chain complete
- [ ] Integration with existing Track E primitives
- [ ] Master composition defined
- [ ] Query integration specified

---

## The 25 Greats' Verdict

**Drucker**: "What gets measured gets managed. These primitives bring measurement to the soft side of business."

**Porter**: "Competitive advantage comes from doing things differently. Business primitives give agents the knowledge to identify and exploit strategic differences."

**Christensen**: "Disruptive innovation starts with understanding non-consumption. User research primitives enable systematic discovery."

**Kahneman**: "Fast and slow thinking apply to business decisions too. The confidence system forces explicit acknowledgment of uncertainty."

**Ries**: "Build-Measure-Learn requires measurement. These primitives close the loop from code to business outcomes."

---

## Summary

Track K extends LiBrainian from code knowledge to business knowledge:

1. **40 business primitives** across 7 domains (strategy, product, GTM, finance, team, legal, operations)
2. **4 cross-domain primitives** for business-code traceability
3. **12 domain compositions** for common workflows
4. **Full integration** with existing LiBrainian features (knowledge store, queries, confidence)

**The key insight**: An agent that only understands code is like an employee who can only type. Track K gives agents the knowledge to understand the entire business context - why code exists, what metrics it affects, how it relates to customers, and what business outcomes it enables.

With Track K, LiBrainian becomes not just a coding assistant, but a business intelligence system that happens to understand code deeply.
