# WU-WORLD-004: Intelligent Auto-Configuration Implementation Plan

> **Status**: Design Complete - Ready for Implementation
> **Agent**: a9250b8

## Summary

Comprehensive auto-configuration system that enables LiBrainian to "just work" for any agent on any codebase without prior knowledge.

## Architecture

```
+------------------+     +----------------------+     +--------------------+
|  Project Scanner |---->| Configuration Engine |---->| Construction Selector|
+------------------+     +----------------------+     +--------------------+
        |                         |                            |
        v                         v                            v
+------------------+     +----------------------+     +--------------------+
| CodebaseProfiler |     | QualityTierResolver  |     | ConstructionRegistry|
+------------------+     +----------------------+     +--------------------+
                                  |
                                  v
                         +------------------+
                         | SelfHealingLoop  |
                         +------------------+
```

## Module Structure

```
src/autoconfig/
  index.ts                    # Main exports
  project_scanner.ts          # Detects project characteristics
  config_engine.ts            # Generates optimal config
  construction_selector.ts    # Selects appropriate constructions
  quality_tier_resolver.ts    # Maps project profile to quality tier
  self_healing.ts             # Detects and fixes suboptimal configs
  construction_registry.ts    # Registry of all available constructions
  types.ts                    # Shared types
```

## Key Components

### 1. Project Scanner
Detects: language, frameworks, testing setup, infrastructure, project type
Extends: `src/evaluation/codebase_profiler.ts`

### 2. Configuration Engine
Generates optimal `BootstrapConfig` based on project scan
Integrates with: `src/config/full_mode.ts`, `src/api/governors.ts`

### 3. Quality Tier Resolver
Maps project characteristics to 'mvp' | 'enhanced' | 'full'
Factors: test infra (25%), type safety (20%), CI/CD (15%), docs (15%), organization (15%), security (10%)

### 4. Construction Selector
Auto-enables constructions based on project type:
- web-frontend: FeatureLocation, CodeQuality
- web-backend: SecurityAudit, ArchitectureVerifier, TestingStrategy
- fullstack: All constructions
- library: QualityStandards, TestingStrategy, TechnicalDebt
- monorepo: Everything

### 5. Self-Healing Loop
Detects and auto-fixes:
- Performance issues (concurrency, batch sizes)
- Quality issues (tier mismatch, missing constructions)
- Coverage issues (excluded directories)
- Resource issues (rate limiting, memory)

## Zero-Knowledge Bootstrap Flow

```
Agent arrives → LiBrainian auto → Scan (5-15s) → Config (<1s) → Bootstrap (30s-5min) → Ready
```

## Success Metrics

| Metric | Target |
|--------|--------|
| Zero-config success rate | >95% |
| Detection accuracy | >90% |
| Optimal config rate | >85% |
| Self-healing effectiveness | >80% |

## Implementation Phases

1. Core Scanner (Week 1)
2. Config Engine (Week 2)
3. Construction Selection (Week 3)
4. Self-Healing (Week 4)
5. Integration (Week 5)

## Critical Files

- `src/evaluation/codebase_profiler.ts` - Extend for scanning
- `src/api/bootstrap.ts` - Integrate auto-config
- `src/constructions/index.ts` - Registry source
- `src/api/governors.ts` - Resource detection
- `src/knowledge/extractors/identity.ts` - Language/framework detection

*Full detailed plan in agent a9250b8 output*
