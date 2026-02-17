/**
 * @fileoverview Complete Domain Registry
 *
 * Comprehensive registry of ALL software development, engineering, design,
 * business, and operational specialties. Each domain includes world-class
 * inspirations, advanced techniques, sophisticated methods, and nuanced practices.
 *
 * Also includes META capabilities for librarian self-improvement and recursive enhancement.
 */

import type { DomainExpertise, DomainCategory } from './domain_expertise.js';
import { logInfo } from '../telemetry/logger.js';

// ---------------------------------------------------------------------------
// COMPLETE DOMAIN TAXONOMY
// ---------------------------------------------------------------------------

/**
 * Complete enumeration of ALL specialties in software/product development.
 * This is the authoritative list - no specialty should be missing.
 */
export const COMPLETE_DOMAIN_TAXONOMY = {
  // =========================================================================
  // ENGINEERING DISCIPLINES
  // =========================================================================
  engineering: {
    frontend: [
      'react-development',
      'vue-development',
      'angular-development',
      'svelte-development',
      'web-components',
      'vanilla-javascript',
      'typescript-engineering',
      'css-architecture',
      'state-management',
      'build-tooling',
      'browser-apis',
      'progressive-web-apps',
      'micro-frontends',
      'server-side-rendering',
      'static-site-generation',
      'jamstack',
      'web-performance',
      'web-accessibility',
      'internationalization',
    ],
    backend: [
      'nodejs-development',
      'python-backend',
      'go-development',
      'rust-development',
      'java-enterprise',
      'dotnet-development',
      'ruby-rails',
      'php-development',
      'elixir-phoenix',
      'scala-development',
      'kotlin-backend',
      'api-design',
      'graphql-engineering',
      'grpc-services',
      'message-queues',
      'event-sourcing',
      'cqrs-patterns',
      'microservices',
      'serverless',
      'edge-computing',
    ],
    mobile: [
      'ios-swift',
      'ios-objective-c',
      'android-kotlin',
      'android-java',
      'react-native',
      'flutter',
      'xamarin',
      'ionic',
      'pwa-mobile',
      'mobile-performance',
      'mobile-security',
      'app-store-optimization',
      'mobile-analytics',
      'push-notifications',
      'offline-first',
    ],
    systems: [
      'c-programming',
      'cpp-development',
      'rust-systems',
      'embedded-systems',
      'rtos-development',
      'firmware',
      'device-drivers',
      'kernel-development',
      'memory-management',
      'concurrency-parallelism',
      'low-latency-systems',
      'high-frequency-trading',
    ],
    data: [
      'data-engineering',
      'data-pipelines',
      'etl-elt',
      'data-warehousing',
      'data-lakes',
      'stream-processing',
      'batch-processing',
      'data-quality',
      'data-governance',
      'data-cataloging',
      'feature-engineering',
      'data-versioning',
    ],
    ml_ai: [
      'machine-learning-engineering',
      'deep-learning',
      'nlp-engineering',
      'computer-vision',
      'reinforcement-learning',
      'mlops',
      'model-serving',
      'model-monitoring',
      'feature-stores',
      'experiment-tracking',
      'llm-engineering',
      'prompt-engineering',
      'ai-safety',
      'responsible-ai',
      'edge-ml',
    ],
    infrastructure: [
      'devops',
      'site-reliability',
      'platform-engineering',
      'cloud-architecture',
      'kubernetes',
      'docker-containerization',
      'infrastructure-as-code',
      'terraform',
      'ansible-automation',
      'ci-cd-pipelines',
      'gitops',
      'observability',
      'logging',
      'metrics-monitoring',
      'distributed-tracing',
      'incident-management',
      'chaos-engineering',
      'capacity-planning',
      'cost-optimization',
    ],
    security: [
      'application-security',
      'security-engineering',
      'penetration-testing',
      'vulnerability-management',
      'security-architecture',
      'identity-access-management',
      'cryptography',
      'secure-coding',
      'threat-modeling',
      'security-operations',
      'incident-response',
      'compliance-engineering',
      'privacy-engineering',
      'zero-trust',
    ],
    database: [
      'postgresql',
      'mysql-mariadb',
      'sql-server',
      'oracle-database',
      'mongodb',
      'redis',
      'elasticsearch',
      'cassandra',
      'dynamodb',
      'neo4j-graph',
      'timescaledb',
      'clickhouse',
      'database-design',
      'query-optimization',
      'database-administration',
      'replication-sharding',
      'backup-recovery',
    ],
    architecture: [
      'software-architecture',
      'solution-architecture',
      'enterprise-architecture',
      'domain-driven-design',
      'event-driven-architecture',
      'hexagonal-architecture',
      'clean-architecture',
      'modular-monolith',
      'service-mesh',
      'api-gateway-patterns',
      'caching-strategies',
      'resilience-patterns',
      'scalability-patterns',
      'migration-strategies',
    ],
    specialized_tech: [
      'blockchain-development',
      'smart-contracts',
      'web3-development',
      'ar-vr-development',
      'game-development',
      'game-engine-development',
      'graphics-programming',
      'audio-engineering',
      'video-streaming',
      'real-time-collaboration',
      'iot-development',
      'robotics-software',
      'autonomous-systems',
      'simulation',
      'compiler-design',
      'language-design',
      'interpreter-development',
    ],
  },

  // =========================================================================
  // DESIGN DISCIPLINES
  // =========================================================================
  design: {
    product_design: [
      'ui-design',
      'ux-design',
      'ux-research',
      'service-design',
      'design-systems',
      'design-operations',
      'design-strategy',
      'interaction-design',
      'information-architecture',
      'navigation-design',
      'form-design',
      'dashboard-design',
      'data-visualization',
      'conversational-design',
      'voice-ui-design',
    ],
    visual_design: [
      'graphic-design',
      'brand-design',
      'identity-design',
      'typography',
      'color-theory',
      'illustration',
      'iconography',
      'photography-direction',
      'print-design',
      'packaging-design',
      'environmental-design',
    ],
    motion_3d: [
      'motion-design',
      'ui-animation',
      'micro-interactions',
      '3d-design',
      '3d-modeling',
      'rendering',
      'ar-vr-design',
      'game-design',
      'level-design',
      'character-design',
      'vfx',
    ],
    sound: [
      'sound-design',
      'ui-sounds',
      'music-composition',
      'audio-branding',
      'podcast-production',
      'voice-over-direction',
    ],
  },

  // =========================================================================
  // CONTENT & COMMUNICATION
  // =========================================================================
  content: {
    writing: [
      'technical-writing',
      'api-documentation',
      'user-documentation',
      'developer-guides',
      'tutorial-writing',
      'copywriting',
      'ux-writing',
      'microcopy',
      'content-strategy',
      'content-design',
      'blog-writing',
      'thought-leadership',
      'case-studies',
      'white-papers',
      'release-notes',
      'changelog-writing',
    ],
    localization: [
      'internationalization',
      'localization',
      'translation-management',
      'cultural-adaptation',
      'rtl-languages',
      'locale-testing',
    ],
    developer_relations: [
      'developer-advocacy',
      'developer-experience',
      'api-evangelism',
      'community-management',
      'conference-speaking',
      'workshop-facilitation',
      'open-source-management',
      'developer-education',
      'code-samples',
      'sdk-development',
    ],
  },

  // =========================================================================
  // PRODUCT & BUSINESS
  // =========================================================================
  product_business: {
    product: [
      'product-management',
      'product-strategy',
      'product-discovery',
      'product-analytics',
      'product-ops',
      'roadmapping',
      'prioritization-frameworks',
      'okrs-goal-setting',
      'user-research',
      'competitive-analysis',
      'market-research',
      'pricing-strategy',
      'monetization',
      'freemium-strategy',
      'product-led-growth',
    ],
    business: [
      'business-analysis',
      'requirements-engineering',
      'process-modeling',
      'workflow-automation',
      'digital-transformation',
      'change-management',
      'stakeholder-management',
      'vendor-management',
      'contract-negotiation',
      'budgeting-forecasting',
    ],
    marketing: [
      'product-marketing',
      'growth-engineering',
      'growth-hacking',
      'seo-engineering',
      'marketing-automation',
      'email-engineering',
      'analytics-implementation',
      'a-b-testing',
      'conversion-optimization',
      'attribution-modeling',
    ],
    sales: [
      'solutions-architecture',
      'sales-engineering',
      'technical-presales',
      'demo-engineering',
      'proof-of-concept',
      'customer-success-engineering',
      'implementation-services',
      'professional-services',
    ],
  },

  // =========================================================================
  // PROJECT & PROGRAM MANAGEMENT
  // =========================================================================
  management: {
    project: [
      'project-management',
      'agile-scrum',
      'kanban',
      'lean',
      'waterfall',
      'hybrid-methodologies',
      'estimation',
      'planning',
      'risk-management',
      'dependency-management',
      'resource-management',
      'timeline-management',
      'scope-management',
    ],
    program: [
      'program-management',
      'portfolio-management',
      'technical-program-management',
      'release-management',
      'launch-management',
      'cross-functional-coordination',
      'executive-reporting',
      'governance',
    ],
    engineering_management: [
      'engineering-management',
      'tech-lead',
      'staff-engineering',
      'principal-engineering',
      'architecture-leadership',
      'team-building',
      'hiring',
      'performance-management',
      'career-development',
      'mentoring',
      'technical-strategy',
    ],
  },

  // =========================================================================
  // QUALITY & TESTING
  // =========================================================================
  quality: {
    testing: [
      'manual-testing',
      'exploratory-testing',
      'test-automation',
      'unit-testing',
      'integration-testing',
      'e2e-testing',
      'api-testing',
      'contract-testing',
      'visual-testing',
      'snapshot-testing',
      'mutation-testing',
      'property-based-testing',
      'fuzz-testing',
      'load-testing',
      'performance-testing',
      'stress-testing',
      'soak-testing',
      'security-testing',
      'penetration-testing',
      'accessibility-testing',
      'usability-testing',
      'localization-testing',
      'compatibility-testing',
      'mobile-testing',
      'game-testing',
    ],
    quality_engineering: [
      'quality-engineering',
      'test-architecture',
      'test-infrastructure',
      'test-data-management',
      'test-environment-management',
      'defect-management',
      'quality-metrics',
      'test-reporting',
      'continuous-testing',
      'shift-left-testing',
      'testing-in-production',
    ],
  },

  // =========================================================================
  // INDUSTRY DOMAINS
  // =========================================================================
  industries: {
    finance: [
      'fintech',
      'banking-software',
      'trading-systems',
      'payment-processing',
      'blockchain-finance',
      'defi',
      'regtech',
      'insurtech',
      'wealth-management',
      'credit-scoring',
      'fraud-detection',
      'kyc-aml',
    ],
    healthcare: [
      'healthtech',
      'medical-devices',
      'ehr-systems',
      'telemedicine',
      'clinical-trials',
      'medical-imaging',
      'healthcare-analytics',
      'hipaa-compliance',
      'fda-validation',
      'biotech-software',
      'genomics',
      'drug-discovery',
    ],
    commerce: [
      'ecommerce',
      'marketplace',
      'inventory-management',
      'order-management',
      'fulfillment',
      'retail-tech',
      'pos-systems',
      'subscription-billing',
      'loyalty-programs',
    ],
    media: [
      'media-entertainment',
      'streaming-platforms',
      'content-management',
      'digital-publishing',
      'adtech',
      'social-media',
      'gaming-platforms',
      'sports-tech',
    ],
    enterprise: [
      'enterprise-software',
      'erp',
      'crm',
      'hrm',
      'scm',
      'business-intelligence',
      'enterprise-integration',
      'legacy-modernization',
      'saas-platforms',
    ],
    government: [
      'govtech',
      'civic-tech',
      'public-sector',
      'defense-contracting',
      'smart-cities',
      'voting-systems',
      'public-safety',
    ],
    other: [
      'edtech',
      'legaltech',
      'proptech',
      'traveltech',
      'agritech',
      'cleantech',
      'spacetech',
      'automotive-software',
      'aerospace-software',
      'manufacturing-software',
      'logistics-software',
      'construction-tech',
    ],
  },

  // =========================================================================
  // META / KNOWLEDGE ENGINEERING (for librarian self-improvement)
  // =========================================================================
  meta: {
    knowledge_engineering: [
      'knowledge-representation',
      'ontology-design',
      'taxonomy-development',
      'knowledge-graphs',
      'semantic-web',
      'linked-data',
      'rdf-owl',
      'knowledge-extraction',
      'entity-recognition',
      'relationship-extraction',
      'knowledge-validation',
      'knowledge-evolution',
    ],
    information_retrieval: [
      'search-engineering',
      'semantic-search',
      'vector-search',
      'embedding-models',
      'ranking-algorithms',
      'relevance-tuning',
      'query-understanding',
      'query-expansion',
      'faceted-search',
      'personalization',
      'recommendation-systems',
    ],
    self_improvement: [
      'meta-learning',
      'self-supervised-learning',
      'active-learning',
      'curriculum-learning',
      'continual-learning',
      'transfer-learning',
      'few-shot-learning',
      'zero-shot-learning',
      'feedback-loops',
      'self-critique',
      'confidence-calibration',
      'uncertainty-quantification',
    ],
    reasoning: [
      'logical-reasoning',
      'causal-reasoning',
      'analogical-reasoning',
      'abductive-reasoning',
      'counterfactual-reasoning',
      'chain-of-thought',
      'tree-of-thought',
      'graph-of-thought',
      'verification-reasoning',
      'planning-reasoning',
    ],
  },
} as const;

// ---------------------------------------------------------------------------
// ADVANCED TECHNIQUES REGISTRY
// ---------------------------------------------------------------------------

/**
 * World-class, sophisticated, and nuanced techniques across domains.
 * These go far beyond common practices into expert-level methods.
 */
export interface AdvancedTechnique {
  id: string;
  name: string;
  domains: string[];  // Which domains this applies to
  sophisticationLevel: 'advanced' | 'expert' | 'cutting-edge' | 'research';
  origin: string;     // Where this technique came from
  description: string;
  prerequisites: string[];
  coreConcepts: string[];
  implementation: {
    steps: string[];
    pitfalls: string[];
    successIndicators: string[];
  };
  variations: { name: string; description: string }[];
  synergies: string[];  // Other techniques it combines well with
  references: { title: string; type: string; url?: string }[];
}

export const ADVANCED_TECHNIQUES_REGISTRY: AdvancedTechnique[] = [
  // =========================================================================
  // ARCHITECTURE & DESIGN PATTERNS
  // =========================================================================
  {
    id: 'strangler-fig-pattern',
    name: 'Strangler Fig Pattern',
    domains: ['software-architecture', 'legacy-modernization', 'microservices'],
    sophisticationLevel: 'advanced',
    origin: 'Martin Fowler, inspired by strangler figs in rainforests',
    description: 'Gradually replace legacy systems by incrementally building new functionality around them',
    prerequisites: ['Understanding of current system', 'API gateway or proxy capability', 'Feature flags'],
    coreConcepts: [
      'Incremental migration over big-bang rewrites',
      'Coexistence of old and new systems',
      'Traffic routing for gradual cutover',
      'Rollback capability at each step',
    ],
    implementation: {
      steps: [
        'Identify bounded contexts in legacy system',
        'Set up routing layer (API gateway, proxy)',
        'Build new implementation for one context',
        'Route traffic gradually (canary deployment)',
        'Monitor and validate parity',
        'Decommission legacy component',
        'Repeat for next context',
      ],
      pitfalls: [
        'Shared database coupling slows migration',
        'Incomplete feature parity causes user issues',
        'Performance overhead from routing layer',
        'Organizational resistance to long-running migration',
      ],
      successIndicators: [
        'Zero-downtime migrations',
        'Metrics parity between old and new',
        'Gradual reduction in legacy traffic',
        'Team confidence in rollback capability',
      ],
    },
    variations: [
      { name: 'Branch by Abstraction', description: 'Use abstraction layer instead of routing' },
      { name: 'Parallel Run', description: 'Run both systems simultaneously, compare outputs' },
    ],
    synergies: ['feature-flags', 'api-versioning', 'event-sourcing'],
    references: [
      { title: 'StranglerFigApplication', type: 'article', url: 'https://martinfowler.com/bliki/StranglerFigApplication.html' },
    ],
  },
  {
    id: 'event-sourcing',
    name: 'Event Sourcing',
    domains: ['software-architecture', 'data-engineering', 'domain-driven-design'],
    sophisticationLevel: 'expert',
    origin: 'Greg Young, Martin Fowler',
    description: 'Store state changes as immutable sequence of events, derive current state by replaying',
    prerequisites: ['Strong event modeling skills', 'Understanding of eventual consistency', 'Event store infrastructure'],
    coreConcepts: [
      'Events as source of truth',
      'Immutability of event log',
      'Projections for read models',
      'Temporal queries (time travel)',
      'Event schema evolution',
    ],
    implementation: {
      steps: [
        'Model domain events (past tense, business language)',
        'Implement event store (append-only)',
        'Build aggregates that emit events',
        'Create projections for read models',
        'Handle event versioning and upcasting',
        'Implement snapshotting for performance',
        'Build event-driven sagas for workflows',
      ],
      pitfalls: [
        'Event schema evolution complexity',
        'Eventually consistent reads confuse users',
        'Event store performance at scale',
        'Debugging distributed event flows',
        'Team unfamiliarity with paradigm',
      ],
      successIndicators: [
        'Complete audit trail',
        'Ability to replay and rebuild state',
        'Temporal queries work correctly',
        'New projections from existing events',
      ],
    },
    variations: [
      { name: 'CQRS', description: 'Separate command and query models' },
      { name: 'Event Collaboration', description: 'Services communicate only via events' },
    ],
    synergies: ['cqrs-patterns', 'domain-driven-design', 'distributed-tracing'],
    references: [
      { title: 'Event Sourcing', type: 'book', url: 'https://www.oreilly.com/library/view/building-event-driven/9781492057888/' },
    ],
  },
  {
    id: 'algebraic-effects',
    name: 'Algebraic Effects',
    domains: ['language-design', 'typescript-engineering', 'rust-development'],
    sophisticationLevel: 'cutting-edge',
    origin: 'Programming language theory (Plotkin, Pretnar)',
    description: 'Handle side effects as first-class values with structured effect handlers',
    prerequisites: ['Functional programming', 'Monad understanding', 'Type theory basics'],
    coreConcepts: [
      'Effects as capabilities, not actions',
      'Effect handlers as interpreters',
      'Resumable continuations',
      'Effect polymorphism',
      'Composable effect systems',
    ],
    implementation: {
      steps: [
        'Identify effects in your domain (IO, State, Error, Async)',
        'Define effect interfaces/traits',
        'Implement effect handlers',
        'Compose handlers for different contexts',
        'Use effect inference or explicit annotation',
      ],
      pitfalls: [
        'Limited language support (Koka, Eff, OCaml 5)',
        'Performance overhead in some implementations',
        'Learning curve for team',
        'Debugging effect stacks',
      ],
      successIndicators: [
        'Pure business logic',
        'Testable effectful code',
        'Composable effect handling',
        'Clear effect boundaries',
      ],
    },
    variations: [
      { name: 'Effect Systems (Scala ZIO)', description: 'Library-based effect tracking' },
      { name: 'Monad Transformers', description: 'Older approach with composition challenges' },
    ],
    synergies: ['functional-programming', 'type-driven-development', 'property-based-testing'],
    references: [
      { title: 'Algebraic Effects for the Rest of Us', type: 'article' },
    ],
  },

  // =========================================================================
  // TESTING & QUALITY
  // =========================================================================
  {
    id: 'metamorphic-testing',
    name: 'Metamorphic Testing',
    domains: ['ml-ai', 'testing', 'quality-engineering'],
    sophisticationLevel: 'expert',
    origin: 'Chen et al., academic research on oracle problem',
    description: 'Test systems without explicit expected outputs by verifying relationships between inputs/outputs',
    prerequisites: ['Understanding of system properties', 'Mathematical thinking', 'Domain knowledge'],
    coreConcepts: [
      'Metamorphic relations (MRs)',
      'Source and follow-up test cases',
      'Oracle problem circumvention',
      'Property-based thinking',
    ],
    implementation: {
      steps: [
        'Identify metamorphic relations in system',
        'Generate source test cases',
        'Apply transformations for follow-up cases',
        'Execute both and verify MR holds',
        'Iterate with diverse MRs',
      ],
      pitfalls: [
        'Identifying good MRs requires domain expertise',
        'Not all properties are metamorphic',
        'Violations may be hard to diagnose',
      ],
      successIndicators: [
        'Finding bugs in ML models',
        'Testing complex simulations',
        'Validating scientific software',
      ],
    },
    variations: [
      { name: 'MT for ML', description: 'Specialized for machine learning models' },
      { name: 'Compositional MT', description: 'Combine multiple metamorphic relations' },
    ],
    synergies: ['property-based-testing', 'fuzz-testing', 'ml-testing'],
    references: [
      { title: 'Metamorphic Testing: A New Approach', type: 'article' },
    ],
  },
  {
    id: 'chaos-engineering',
    name: 'Chaos Engineering',
    domains: ['site-reliability', 'distributed-systems', 'resilience-patterns'],
    sophisticationLevel: 'advanced',
    origin: 'Netflix (Chaos Monkey, 2011)',
    description: 'Intentionally inject failures to discover system weaknesses before they cause outages',
    prerequisites: ['Observability infrastructure', 'Incident response process', 'Blast radius controls'],
    coreConcepts: [
      'Steady state hypothesis',
      'Controlled experiments',
      'Blast radius minimization',
      'Automated rollback',
      'Game days',
    ],
    implementation: {
      steps: [
        'Define steady state metrics',
        'Form hypothesis about resilience',
        'Design smallest experiment to test',
        'Implement blast radius controls',
        'Run in production (start small)',
        'Analyze results, fix weaknesses',
        'Expand scope gradually',
      ],
      pitfalls: [
        'Running too large experiments too soon',
        'Insufficient observability',
        'No automated rollback',
        'Organizational fear of failure',
      ],
      successIndicators: [
        'Finding unknown failure modes',
        'Improved incident response',
        'Team confidence in system',
        'Reduced MTTR',
      ],
    },
    variations: [
      { name: 'Chaos Monkey', description: 'Random instance termination' },
      { name: 'Latency Injection', description: 'Add artificial delays' },
      { name: 'Chaos Kong', description: 'Region-level failures' },
    ],
    synergies: ['observability', 'incident-management', 'game-days'],
    references: [
      { title: 'Chaos Engineering', type: 'book', url: 'https://www.oreilly.com/library/view/chaos-engineering/9781492043850/' },
    ],
  },

  // =========================================================================
  // META / KNOWLEDGE ENGINEERING
  // =========================================================================
  {
    id: 'knowledge-distillation',
    name: 'Knowledge Distillation',
    domains: ['meta-learning', 'ml-engineering', 'self-improvement'],
    sophisticationLevel: 'expert',
    origin: 'Hinton et al., model compression research',
    description: 'Transfer knowledge from large model to smaller one, or from experience to rules',
    prerequisites: ['Understanding of source knowledge', 'Target representation format', 'Validation capability'],
    coreConcepts: [
      'Teacher-student paradigm',
      'Soft labels and dark knowledge',
      'Temperature scaling',
      'Intermediate representations',
      'Progressive distillation',
    ],
    implementation: {
      steps: [
        'Define knowledge to distill',
        'Choose distillation approach (soft labels, features, relations)',
        'Train student model on distilled knowledge',
        'Validate student performance',
        'Iterate on distillation strategy',
      ],
      pitfalls: [
        'Capacity gap between teacher and student',
        'Loss of nuanced knowledge',
        'Distribution mismatch',
      ],
      successIndicators: [
        'Student approaches teacher performance',
        'Faster inference with student',
        'Knowledge preserved in interpretable form',
      ],
    },
    variations: [
      { name: 'Self-distillation', description: 'Model distills its own knowledge' },
      { name: 'Cross-modal distillation', description: 'Transfer across modalities' },
    ],
    synergies: ['model-compression', 'transfer-learning', 'continual-learning'],
    references: [
      { title: 'Distilling the Knowledge in a Neural Network', type: 'article' },
    ],
  },
  {
    id: 'epistemic-humility-framework',
    name: 'Epistemic Humility Framework',
    domains: ['knowledge-engineering', 'self-improvement', 'reasoning'],
    sophisticationLevel: 'cutting-edge',
    origin: 'Philosophy of science, calibration research',
    description: 'Systematic tracking of confidence, uncertainty, and knowledge gaps',
    prerequisites: ['Understanding of probability', 'Calibration metrics', 'Feedback loops'],
    coreConcepts: [
      'Confidence calibration',
      'Uncertainty quantification',
      'Known unknowns vs unknown unknowns',
      'Provenance tracking',
      'Defeater detection',
    ],
    implementation: {
      steps: [
        'Attach confidence to all claims',
        'Track provenance of knowledge',
        'Identify potential defeaters',
        'Implement calibration feedback',
        'Surface uncertainties to users',
        'Trigger research when confidence low',
      ],
      pitfalls: [
        'Overconfidence in calibration',
        'Ignoring unknown unknowns',
        'Confidence inflation over time',
      ],
      successIndicators: [
        'Calibrated confidence scores',
        'Appropriate uncertainty surfacing',
        'Triggered research fills gaps',
      ],
    },
    variations: [
      { name: 'Bayesian approach', description: 'Update beliefs with evidence' },
      { name: 'Ensemble disagreement', description: 'Multiple models indicate uncertainty' },
    ],
    synergies: ['knowledge-graphs', 'self-critique', 'active-learning'],
    references: [
      { title: 'Calibration of Modern Neural Networks', type: 'article' },
    ],
  },
];

// ---------------------------------------------------------------------------
// WORLD-CLASS INSPIRATIONS BY DOMAIN
// ---------------------------------------------------------------------------

export const WORLD_CLASS_INSPIRATIONS: Record<string, {
  companies: { name: string; known_for: string; lessons: string[] }[];
  individuals: { name: string; known_for: string; lessons: string[] }[];
  projects: { name: string; known_for: string; lessons: string[] }[];
}> = {
  'software-architecture': {
    companies: [
      { name: 'Netflix', known_for: 'Microservices at scale', lessons: ['Chaos engineering', 'API gateway patterns', 'Observability'] },
      { name: 'Spotify', known_for: 'Squad model and platform engineering', lessons: ['Team autonomy', 'Internal platforms', 'Backstage'] },
      { name: 'Amazon', known_for: 'Service-oriented architecture', lessons: ['Two-pizza teams', 'API mandates', 'Operational excellence'] },
    ],
    individuals: [
      { name: 'Martin Fowler', known_for: 'Refactoring, patterns', lessons: ['Evolutionary design', 'Continuous integration'] },
      { name: 'Sam Newman', known_for: 'Building Microservices', lessons: ['Service boundaries', 'Data ownership'] },
      { name: 'Gregor Hohpe', known_for: 'Enterprise Integration Patterns', lessons: ['Message patterns', 'Cloud strategy'] },
    ],
    projects: [
      { name: 'Kubernetes', known_for: 'Container orchestration', lessons: ['Declarative configuration', 'Reconciliation loops', 'Extensibility'] },
    ],
  },
  'frontend-development': {
    companies: [
      { name: 'Vercel', known_for: 'Next.js, developer experience', lessons: ['Framework-driven', 'Edge computing', 'Zero config'] },
      { name: 'Shopify', known_for: 'React ecosystem, performance', lessons: ['Hydration strategies', 'Component systems'] },
      { name: 'Airbnb', known_for: 'Design systems, testing', lessons: ['Enzyme', 'Component standardization'] },
    ],
    individuals: [
      { name: 'Dan Abramov', known_for: 'Redux, React core', lessons: ['State management', 'Mental models'] },
      { name: 'Kent C. Dodds', known_for: 'Testing, education', lessons: ['Testing trophy', 'Learn in public'] },
      { name: 'Ryan Carniato', known_for: 'SolidJS, reactivity', lessons: ['Fine-grained reactivity', 'Compilation'] },
    ],
    projects: [
      { name: 'React', known_for: 'Component model', lessons: ['Virtual DOM', 'Hooks', 'Server components'] },
    ],
  },
  'ml-engineering': {
    companies: [
      { name: 'Google DeepMind', known_for: 'AlphaGo, Gemini', lessons: ['Reinforcement learning', 'Multimodal models'] },
      { name: 'OpenAI', known_for: 'GPT series, scaling', lessons: ['Scaling laws', 'RLHF', 'Safety'] },
      { name: 'Anthropic', known_for: 'Claude, constitutional AI', lessons: ['AI safety', 'Interpretability'] },
    ],
    individuals: [
      { name: 'Andrej Karpathy', known_for: 'Tesla Autopilot, education', lessons: ['Neural network intuition', 'End-to-end learning'] },
      { name: 'François Chollet', known_for: 'Keras, On Intelligence', lessons: ['Abstraction in ML', 'ARC benchmark'] },
      { name: 'Jeremy Howard', known_for: 'fast.ai', lessons: ['Practical deep learning', 'Transfer learning'] },
    ],
    projects: [
      { name: 'PyTorch', known_for: 'Dynamic graphs, research', lessons: ['Eager execution', 'Research-first'] },
      { name: 'Hugging Face', known_for: 'Transformers, model hub', lessons: ['Open models', 'Community'] },
    ],
  },
  'ux-design': {
    companies: [
      { name: 'Apple', known_for: 'Human interface guidelines', lessons: ['Consistency', 'Delight in details'] },
      { name: 'Linear', known_for: 'Speed and polish', lessons: ['Keyboard-first', 'Animations with purpose'] },
      { name: 'Notion', known_for: 'Flexible workspace', lessons: ['Blocks paradigm', 'Progressive complexity'] },
    ],
    individuals: [
      { name: 'Don Norman', known_for: 'Design of Everyday Things', lessons: ['Affordances', 'Mappings'] },
      { name: 'Jared Spool', known_for: 'UX research', lessons: ['Exposure hours', 'Design literacy'] },
      { name: 'Julie Zhuo', known_for: 'Making of a Manager', lessons: ['Design leadership', 'Feedback'] },
    ],
    projects: [
      { name: 'Material Design', known_for: 'Design system', lessons: ['Motion principles', 'Elevation'] },
    ],
  },
  'technical-writing': {
    companies: [
      { name: 'Stripe', known_for: 'API documentation', lessons: ['Code examples first', 'Interactive docs'] },
      { name: 'Twilio', known_for: 'Developer guides', lessons: ['Quickstarts', 'Building blocks'] },
      { name: 'DigitalOcean', known_for: 'Tutorials', lessons: ['Community contributions', 'SEO'] },
    ],
    individuals: [
      { name: 'Tom Johnson', known_for: 'I\'d Rather Be Writing', lessons: ['API doc best practices'] },
      { name: 'Sarah Drasner', known_for: 'Technical communication', lessons: ['Visual explanations'] },
    ],
    projects: [
      { name: 'MDN Web Docs', known_for: 'Web reference', lessons: ['Completeness', 'Community'] },
    ],
  },
};

// ---------------------------------------------------------------------------
// DOMAIN EXPERTISE LOOKUP
// ---------------------------------------------------------------------------

export function getDomainExpertise(domainId: string): DomainExpertise | null {
  // This would look up from a comprehensive database
  // For now, returns null for unimplemented domains
  return null;
}

export function getDomainAdvancedTechniques(domainId: string): AdvancedTechnique[] {
  return ADVANCED_TECHNIQUES_REGISTRY.filter(t => t.domains.includes(domainId));
}

export function getInspirationsForDomain(domainId: string): typeof WORLD_CLASS_INSPIRATIONS[string] | null {
  return WORLD_CLASS_INSPIRATIONS[domainId] ?? null;
}

export function getAllDomains(): string[] {
  const domains: string[] = [];
  for (const category of Object.values(COMPLETE_DOMAIN_TAXONOMY)) {
    for (const subcategory of Object.values(category)) {
      domains.push(...subcategory);
    }
  }
  return domains;
}

export function getDomainsByCategory(category: string): string[] {
  const cat = COMPLETE_DOMAIN_TAXONOMY[category as keyof typeof COMPLETE_DOMAIN_TAXONOMY];
  if (!cat) return [];
  const domains: string[] = [];
  for (const subcategory of Object.values(cat)) {
    domains.push(...subcategory);
  }
  return domains;
}

// ---------------------------------------------------------------------------
// META: LIBRARIAN SELF-IMPROVEMENT CAPABILITIES
// ---------------------------------------------------------------------------

/**
 * Meta-capabilities for the librarian to improve itself.
 * These are recursive techniques the librarian can use on its own knowledge.
 */
export const LIBRARIAN_META_CAPABILITIES = {
  /**
   * Knowledge quality assessment - evaluate librarian's own knowledge
   */
  selfAssessment: {
    coverage: {
      description: 'Identify gaps in domain coverage',
      method: 'Compare indexed knowledge against domain taxonomy',
      metrics: ['domains_covered', 'depth_per_domain', 'recency'],
    },
    accuracy: {
      description: 'Validate correctness of stored knowledge',
      method: 'Cross-reference with authoritative sources',
      metrics: ['validation_rate', 'contradiction_count', 'staleness'],
    },
    usefulness: {
      description: 'Track which knowledge is actually used',
      method: 'Monitor query patterns and feedback',
      metrics: ['access_frequency', 'success_rate', 'user_satisfaction'],
    },
  },

  /**
   * Knowledge acquisition - learn new information
   */
  acquisition: {
    activeResearch: {
      description: 'Proactively research gaps',
      triggers: ['low_confidence_queries', 'new_domain_detected', 'stale_knowledge'],
      sources: ['documentation', 'research_papers', 'expert_content'],
    },
    feedbackLearning: {
      description: 'Learn from user corrections and feedback',
      signals: ['explicit_feedback', 'query_refinement', 'success_failure'],
    },
    patternDiscovery: {
      description: 'Discover patterns from usage',
      methods: ['frequent_query_patterns', 'successful_context_combinations'],
    },
  },

  /**
   * Knowledge organization - improve structure
   */
  organization: {
    taxonomyEvolution: {
      description: 'Evolve domain taxonomy based on usage',
      methods: ['cluster_analysis', 'hierarchy_refinement', 'new_category_detection'],
    },
    relationshipDiscovery: {
      description: 'Find connections between knowledge items',
      methods: ['co-occurrence', 'semantic_similarity', 'causal_inference'],
    },
    deduplication: {
      description: 'Merge redundant knowledge',
      methods: ['semantic_matching', 'source_consolidation'],
    },
  },

  /**
   * Performance optimization - improve retrieval
   */
  optimization: {
    embeddingRefinement: {
      description: 'Improve embedding quality for better retrieval',
      methods: ['contrastive_learning', 'hard_negative_mining', 'domain_adaptation'],
    },
    rankingImprovement: {
      description: 'Better ranking of search results',
      methods: ['learning_to_rank', 'user_behavior_signals', 'relevance_feedback'],
    },
    cacheStrategy: {
      description: 'Optimize what to keep readily available',
      methods: ['access_pattern_analysis', 'predictive_caching'],
    },
  },

  /**
   * Recursive enhancement - use librarian to improve librarian
   */
  recursiveEnhancement: {
    selfDocumentation: {
      description: 'Librarian documents its own capabilities',
      output: 'Auto-generated capability documentation',
    },
    selfTesting: {
      description: 'Generate tests for librarian functionality',
      output: 'Automated test suite for knowledge quality',
    },
    selfOptimization: {
      description: 'Use librarian queries to optimize librarian',
      examples: [
        'Query: "How can knowledge retrieval be improved?" -> Apply to self',
        'Query: "What are best practices for knowledge graphs?" -> Apply to self',
      ],
    },
  },
};

// Count total domains
const totalDomains = getAllDomains().length;
if (process.env.LIBRARIAN_VERBOSE === '1' || process.env.LIBRARIAN_VERBOSE === 'true') {
  logInfo(`Domain Registry: ${totalDomains} specialized domains defined`);
}
