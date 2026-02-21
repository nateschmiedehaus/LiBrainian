/**
 * @fileoverview Librarian Views Delegate
 *
 * Handles persona-specific views, visualization, and recommendations.
 * Extracted from librarian.ts per MF4 (Hard File Limits: 300 lines).
 *
 * ARCHITECTURAL NOTE (Control Theory Model):
 * The Librarian class is the perception layer. This delegate handles
 * the output formatting and projections for different stakeholders.
 */

import type { LibrarianStorage, UniversalKnowledgeQueryOptions, UniversalKnowledgeRecord } from '../storage/types.js';
import type { UniversalKnowledge } from '../knowledge/universal_types.js';
import { projectForPersona, generateGlanceCard, type PersonaView, type GlanceCard } from '../views/persona_views.js';
import { generateMermaidDiagram, type DiagramRequest, type DiagramResult } from '../visualization/mermaid_generator.js';
import * as asciiDiagrams from '../visualization/ascii_diagrams.js';
import type { ASCIIResult } from '../visualization/ascii_diagrams.js';
import { checkDefeaters, type ActivationSummary } from '../knowledge/defeater_activation.js';
import { generateRefactoringRecommendations, type RefactoringRecommendation } from '../recommendations/refactoring_advisor.js';
import { analyzeArchitecture } from '../recommendations/architecture_advisor.js';
import * as path from 'path';

export type { DiagramRequest, DiagramResult } from '../visualization/mermaid_generator.js';
export type { ASCIIResult } from '../visualization/ascii_diagrams.js';

export type PersonaType = 'programmer' | 'engineer' | 'manager' | 'designer' | 'qa' | 'security' | 'scientist' | 'product';

export interface LibrarianViewsConfig {
  storage: LibrarianStorage;
  workspaceRoot: string;
}

/**
 * Delegate for Librarian view operations.
 * Handles persona projections, visualization, and recommendations.
 */
export class LibrarianViewsDelegate {
  private readonly storage: LibrarianStorage;
  private readonly workspaceRoot: string;

  constructor(config: LibrarianViewsConfig) {
    this.storage = config.storage;
    this.workspaceRoot = config.workspaceRoot;
  }

  /**
   * Get a persona-specific view of an entity's knowledge.
   */
  async getPersonaView(entityId: string, persona: PersonaType): Promise<PersonaView | null> {
    const record = await this.storage.getUniversalKnowledge(entityId);
    if (!record) return null;

    const knowledge = this.parseKnowledgeRecord(record);
    if (!knowledge) return null;

    return projectForPersona(knowledge, persona);
  }

  /**
   * Get a quick glance card for an entity.
   */
  async getGlanceCard(entityId: string): Promise<GlanceCard | null> {
    const record = await this.storage.getUniversalKnowledge(entityId);
    if (!record) return null;

    const knowledge = this.parseKnowledgeRecord(record);
    if (!knowledge) return null;

    return generateGlanceCard(knowledge);
  }

  /**
   * Generate a Mermaid diagram for visualization.
   */
  async visualize(request: DiagramRequest): Promise<DiagramResult> {
    const query = await this.resolveVisualizationQuery(request.scope, request.focus);
    const records = await this.storage.queryUniversalKnowledge(query);
    const knowledge = records
      .map(r => this.parseKnowledgeRecord(r))
      .filter((k): k is UniversalKnowledge => k !== null);

    return generateMermaidDiagram(knowledge, request);
  }

  /**
   * Generate ASCII visualization for terminals without Mermaid support.
   */
  async visualizeASCII(type: 'tree' | 'health_summary', focusPath?: string): Promise<ASCIIResult> {
    const query = type === 'tree' && focusPath
      ? await this.resolveVisualizationQuery('directory', focusPath)
      : {};
    const records = await this.storage.queryUniversalKnowledge(query);
    const knowledge = records
      .map(r => this.parseKnowledgeRecord(r))
      .filter((k): k is UniversalKnowledge => k !== null);

    if (type === 'tree') {
      return asciiDiagrams.generateASCIITree(knowledge, focusPath);
    } else {
      return asciiDiagrams.generateHealthSummary(knowledge);
    }
  }

  /**
   * Check if knowledge for an entity has any active defeaters.
   */
  async validateKnowledge(entityId: string): Promise<ActivationSummary | null> {
    const record = await this.storage.getUniversalKnowledge(entityId);
    if (!record) return null;

    const knowledge = this.parseKnowledgeRecord(record);
    if (!knowledge?.meta) return null;

    return checkDefeaters(knowledge.meta, {
      entityId,
      filePath: knowledge.location.file,
      storage: this.storage,
      workspaceRoot: this.workspaceRoot,
    });
  }

  /**
   * Get refactoring recommendations for a file or directory.
   */
  async getRecommendations(
    scope: string | string[],
    type: 'refactoring' | 'architecture' | 'all' = 'all'
  ): Promise<RefactoringRecommendation[]> {
    const records = await this.storage.queryUniversalKnowledge({});
    const allKnowledge = records
      .map(r => this.parseKnowledgeRecord(r))
      .filter((k): k is UniversalKnowledge => k !== null);

    const scopes = Array.isArray(scope) ? scope : [scope];
    const filtered = allKnowledge.filter(k => scopes.some(s => k.location.file.includes(s)));
    const scopeLabel = scopes[0] ?? '';

    const recommendations: RefactoringRecommendation[] = [];

    if (type === 'refactoring' || type === 'all') {
      recommendations.push(...generateRefactoringRecommendations(filtered));
    }

    if (type === 'architecture' || type === 'all') {
      const archRecs = analyzeArchitecture(filtered);
      for (const arch of archRecs) {
        recommendations.push({
          id: `arch-${arch.type}-${Date.now()}`,
          target: arch.affected[0] ?? { id: '', name: scopeLabel, file: scopeLabel },
          type: arch.type === 'circular_dependency' ? 'reduce_coupling' : 'improve_cohesion',
          title: arch.title,
          description: arch.description,
          rationale: arch.suggestion,
          effort: { estimate: 'medium', hours: 4, confidence: 0.6 },
          impact: { maintainability: 15, testability: 10, readability: 10 },
          risk: { level: arch.severity === 'error' ? 'high' : 'medium', factors: [], mitigations: [] },
          steps: [],
          blocking: [],
          blockedBy: [],
          automatable: false,
          priority: 0,
          roi: 0,
        });
      }
    }

    return recommendations;
  }

  /**
   * Parse a storage record into a full UniversalKnowledge object.
   */
  parseKnowledgeRecord(record: UniversalKnowledgeRecord): UniversalKnowledge | null {
    try {
      if (!record.knowledge) return null;
      return JSON.parse(record.knowledge) as UniversalKnowledge;
    } catch {
      return null;
    }
  }

  private async resolveVisualizationQuery(
    scope: 'file' | 'module' | 'directory' | 'full',
    focus?: string
  ): Promise<UniversalKnowledgeQueryOptions> {
    if (!focus || scope === 'full') return {};

    const record = await this.storage.getUniversalKnowledge(focus);
    const focusPath = record?.file ?? this.resolveWorkspacePath(focus);

    if (scope === 'file') {
      return { file: focusPath };
    }

    const prefix = record ? path.dirname(focusPath) : focusPath;
    return { filePrefix: prefix };
  }

  private resolveWorkspacePath(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.resolve(this.workspaceRoot, filePath);
  }
}
