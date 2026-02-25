/**
 * @fileoverview Shared constructable and detection types
 *
 * Centralizes constructable identifiers and project detection enums
 * so registries and selectors stay consistent.
 */

/**
 * Supported project types.
 */
export type ProjectType =
  | 'web-app'
  | 'api-server'
  | 'cli-tool'
  | 'library'
  | 'monorepo'
  | 'microservices'
  | 'full-stack'
  | 'mobile-app'
  | 'desktop-app'
  | 'data-pipeline'
  | 'ml-project'
  | 'infrastructure'
  | 'unknown';

/**
 * Supported programming languages.
 */
export type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'csharp'
  | 'ruby'
  | 'php'
  | 'swift'
  | 'kotlin'
  | 'scala'
  | 'elixir'
  | 'cpp'
  | 'c';

/**
 * Framework categories.
 */
export type FrameworkCategory =
  | 'frontend'
  | 'backend'
  | 'testing'
  | 'build'
  | 'orm'
  | 'state-management'
  | 'styling'
  | 'api'
  | 'mobile'
  | 'desktop';

/**
 * Supported frameworks.
 */
export type Framework =
  // Frontend
  | 'react'
  | 'vue'
  | 'angular'
  | 'svelte'
  | 'solid'
  | 'next'
  | 'nuxt'
  | 'remix'
  | 'gatsby'
  | 'astro'
  // Backend - Node
  | 'express'
  | 'fastify'
  | 'nestjs'
  | 'koa'
  | 'hapi'
  // Backend - Python
  | 'django'
  | 'flask'
  | 'fastapi'
  | 'starlette'
  // Backend - Other
  | 'rails'
  | 'spring'
  | 'actix'
  | 'gin'
  | 'echo'
  | 'phoenix'
  // Testing
  | 'jest'
  | 'vitest'
  | 'mocha'
  | 'pytest'
  | 'cypress'
  | 'playwright'
  | 'testing-library'
  // State Management
  | 'redux'
  | 'zustand'
  | 'mobx'
  | 'pinia'
  | 'recoil'
  // ORM
  | 'prisma'
  | 'typeorm'
  | 'sequelize'
  | 'drizzle'
  | 'sqlalchemy'
  | 'diesel'
  // Mobile
  | 'react-native'
  | 'flutter'
  | 'ionic'
  | 'expo'
  // Desktop
  | 'electron'
  | 'tauri';

/**
 * Project patterns.
 */
export type ProjectPattern =
  | 'monorepo-turborepo'
  | 'monorepo-nx'
  | 'monorepo-lerna'
  | 'monorepo-pnpm'
  | 'microservices'
  | 'serverless'
  | 'containerized'
  | 'ci-cd-github-actions'
  | 'ci-cd-gitlab'
  | 'ci-cd-circleci'
  | 'infrastructure-as-code'
  | 'feature-flags'
  | 'event-driven'
  | 'graphql-api'
  | 'rest-api'
  | 'grpc-api';

/**
 * Available constructable identifiers.
 */
export type ConstructableId =
  // Core Constructions
  | 'refactoring-safety-checker'
  | 'bug-investigation-assistant'
  | 'feature-location-advisor'
  | 'code-quality-reporter'
  | 'architecture-verifier'
  | 'security-audit-helper'
  | 'skill-audit-construction'
  | 'comprehensive-quality-construction'
  | 'preflight-checker'
  // Strategic Constructions
  | 'quality-standards'
  | 'work-presets'
  | 'architecture-decisions'
  | 'testing-strategy'
  | 'operational-excellence'
  | 'developer-experience'
  | 'technical-debt'
  | 'knowledge-management'
  // Language-specific
  | 'typescript-patterns'
  | 'python-patterns'
  | 'rust-patterns'
  | 'go-patterns'
  // Framework-specific
  | 'react-components'
  | 'vue-components'
  | 'angular-modules'
  | 'express-routes'
  | 'django-views'
  | 'fastapi-endpoints'
  // Testing-specific
  | 'jest-testing'
  | 'vitest-testing'
  | 'pytest-testing'
  | 'cypress-e2e'
  | 'playwright-e2e'
  // Meta/Quality
  | 'patrol-dogfood'
  | 'patrol-process'
  // Process presets
  | 'code-review-pipeline'
  | 'migration-assistant'
  | 'documentation-generator'
  | 'regression-detector'
  | 'onboarding-assistant'
  | 'release-qualification'
  | 'dependency-auditor';

/**
 * Query classification flags that map to constructables.
 */
export type ConstructableClassificationFlag =
  | 'isRefactoringSafetyQuery'
  | 'isBugInvestigationQuery'
  | 'isSecurityAuditQuery'
  | 'isArchitectureVerificationQuery'
  | 'isCodeQualityQuery'
  | 'isFeatureLocationQuery';

/**
 * Availability state for a constructable.
 */
export type ConstructableAvailability = 'ready' | 'experimental' | 'stub';
