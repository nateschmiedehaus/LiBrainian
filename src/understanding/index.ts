/**
 * @fileoverview LiBrainian Understanding Module
 *
 * PHILOSOPHICAL ALIGNMENT (UNDERSTANDING_LAYER.md):
 * The understanding layer represents deep semantic knowledge about code -
 * not just what the code is, but what it means, why it exists, and how
 * it relates to the broader system.
 *
 * This module provides:
 * - Knowledge Aggregation: Parent-child knowledge rollup with confidence propagation
 * - Defeater Inheritance: Severity-based propagation of knowledge defeaters
 * - Aggregation Caching: TTL-based caching for aggregated knowledge
 */

// Knowledge Aggregation (UNDERSTANDING_LAYER.md §Knowledge Aggregation Rules)
export {
  aggregateKnowledge,
  propagateConfidence,
  calculateHierarchicalConfidence,
  propagateDefeaters,
  shouldAggregate,
  getCachedAggregation,
  cacheAggregation,
  invalidateAggregationCache,
  clearAggregationCache,
  aggregateRisk,
  aggregateQuality,
  aggregateCoverage,
  aggregateOwnership,
  aggregateConfidence,
  aggregateEntity,
  aggregateContextPacks,
  DEFAULT_AGGREGATION_CONFIGS,
} from './knowledge_aggregation.js';
export type {
  AggregationFunction,
  AggregationDomain,
  AggregationConfig,
  AggregatedKnowledge,
  EntityForAggregation,
  AggregatedDefeater,
  AggregationTrigger,
  AggregationEvent,
  AggregationCacheEntry,
  EntityAggregationResult,
} from './knowledge_aggregation.js';
