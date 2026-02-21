import type {
  AgentQuestion,
  AgentAction,
  AgentAnswer,
  ActionResult,
  ConstraintSuggestion,
  TddTestStyle,
} from './types.js';
import { RelevanceEngine } from './relevance_engine.js';
import { ConstraintEngine } from './constraint_engine.js';
import { MetaKnowledgeEngine } from './meta_engine.js';
import { TddEngine } from './tdd_engine.js';
import type { TestGenerationRequest, TddCycleState, TestPrioritizationRequest, TddAnswer } from './tdd_types.js';

const DEFAULT_CONTEXT_BUDGET = { maxFiles: 20, maxTokens: 40_000, maxDepth: 2 };

/** Convert TddAnswer to AgentAnswer by stripping TDD-specific followUp */
function toAgentAnswer(tddAnswer: TddAnswer): AgentAnswer {
  return {
    answer: tddAnswer.answer,
    confidence: tddAnswer.confidence,
    reasoning: tddAnswer.reasoning,
    caveats: tddAnswer.caveats,
    // TddQuestion followUp is not compatible with AgentQuestion - omit for now
  };
}

export interface LiBrainianAgent {
  ask(question: AgentQuestion): Promise<AgentAnswer>;
  trigger(action: AgentAction): Promise<ActionResult>;
}

export class LiBrainianAgentImpl implements LiBrainianAgent {
  constructor(
    private readonly relevance: RelevanceEngine,
    private readonly constraint: ConstraintEngine,
    private readonly meta: MetaKnowledgeEngine,
    private readonly tdd?: TddEngine,
  ) {}

  async ask(question: AgentQuestion): Promise<AgentAnswer> {
    switch (question.type) {
      case 'context': {
        const result = await this.relevance.query({
          intent: question.intent,
          hints: question.scope,
          budget: DEFAULT_CONTEXT_BUDGET,
          urgency: 'blocking',
        });
        const caveats = result.blindSpots.length > 0
          ? [`Blind spots detected: ${result.blindSpots.map((spot) => spot.area).join(', ')}`]
          : [];
        return {
          answer: result,
          confidence: result.confidence,
          reasoning: `Selected ${result.tiers.essential.length} essential and ${result.tiers.contextual.length} contextual items.`,
          caveats,
          followUp: result.blindSpots.map((spot) => ({
            type: 'context',
            intent: question.intent,
            scope: [spot.area],
          })),
        };
      }
      case 'patterns': {
        const patterns = await this.relevance.findPatterns(question.for);
        return {
          answer: patterns,
          confidence: patterns.length > 0 ? 0.7 : 0.3,
          reasoning: `Found ${patterns.length} recurring patterns for "${question.for}".`,
          caveats: patterns.length === 0 ? ['No recurring patterns detected yet.'] : [],
        };
      }
      case 'examples': {
        const examples = await this.relevance.findExamples(question.of);
        return {
          answer: examples,
          confidence: examples.length > 0 ? 0.75 : 0.35,
          reasoning: `Retrieved ${examples.length} examples for "${question.of}".`,
          caveats: examples.length === 0 ? ['No similar examples found.'] : [],
        };
      }
      case 'impact': {
        const blast = await this.relevance.getBlastRadius(question.of);
        return {
          answer: blast,
          confidence: blast.affectedFiles.length > 0 ? 0.7 : 0.4,
          reasoning: `Impact analysis found ${blast.affectedFiles.length} affected files.`,
          caveats: blast.affectedFiles.length === 0 ? ['No dependents detected; verify indexing coverage.'] : [],
        };
      }
      case 'allowed': {
        const validation = await this.constraint.previewChange(question.action);
        const blocking = validation.blocking;
        return {
          answer: validation,
          confidence: blocking ? 0.4 : 0.85,
          reasoning: blocking
            ? 'Change violates blocking constraints.'
            : 'Change passes constraint checks.',
          caveats: validation.warnings.length > 0 ? ['Warnings present; review before proceeding.'] : [],
        };
      }
      case 'confidence': {
        const report = await this.meta.getConfidence(question.in);
        return {
          answer: report,
          confidence: report.overall,
          reasoning: `Overall confidence ${(report.overall * 100).toFixed(0)}%.`,
          caveats: report.recommendations,
        };
      }
      case 'risks': {
        const risk = await this.meta.assessRisk(question.in);
        return {
          answer: risk,
          confidence: 1 - risk.score,
          reasoning: `Risk level ${risk.level} with score ${risk.score.toFixed(2)}.`,
          caveats: risk.mitigations,
        };
      }
      case 'experts': {
        const experts = await this.meta.getExperts(question.for);
        return {
          answer: experts,
          confidence: experts.length > 0 ? 0.7 : 0.3,
          reasoning: `Found ${experts.length} potential experts for this scope.`,
          caveats: experts.length === 0 ? ['No ownership data found.'] : [],
        };
      }
      case 'history': {
        const history = await this.meta.getPastFailures(question.similar_to);
        return {
          answer: history,
          confidence: history.failures.length > 0 ? 0.65 : 0.4,
          reasoning: history.summary,
          caveats: history.failures.length === 0 ? ['No recorded failures for similar intents.'] : [],
        };
      }
      case 'tests': {
        const tests = await this.relevance.getTestCoverage(question.for);
        return {
          answer: tests,
          confidence: tests.length > 0 ? 0.7 : 0.4,
          reasoning: `Resolved test mappings for ${tests.length} files.`,
          caveats: tests.some((mapping) => mapping.tests.length === 0)
            ? ['Some files have no mapped tests.']
            : [],
        };
      }
      case 'explain': {
        const explanation = await this.constraint.explainConstraint(question.constraint);
        return {
          answer: explanation,
          confidence: 0.8,
          reasoning: explanation.reason,
          caveats: [],
        };
      }
      // TDD-specific questions
      case 'discover_tests': {
        if (!this.tdd) return this.tddUnavailable();
        return toAgentAnswer(await this.tdd.ask({ type: 'discover_tests', scope: question.scope }));
      }
      case 'analyze_coverage': {
        if (!this.tdd) return this.tddUnavailable();
        return toAgentAnswer(await this.tdd.ask({ type: 'analyze_coverage', files: question.files }));
      }
      case 'generate_tests': {
        if (!this.tdd) return this.tddUnavailable();
        const style = question.style ?? {};
        const request: TestGenerationRequest = {
          target: { type: 'function', path: question.target },
          style: {
            framework: style.framework ?? 'vitest',
            pattern: style.pattern ?? 'arrange-act-assert',
            assertionStyle: 'expect',
            asyncStyle: style.asyncStyle ?? 'async-await',
          },
          coverage: {
            minimumLineCoverage: 80,
            minimumBranchCoverage: 70,
            edgeCases: true,
            errorPaths: true,
            boundaryConditions: true,
          },
        };
        return toAgentAnswer(await this.tdd.ask({ type: 'generate_tests', request }));
      }
      case 'find_test_patterns': {
        if (!this.tdd) return this.tddUnavailable();
        return toAgentAnswer(await this.tdd.ask({ type: 'find_patterns', in: question.in }));
      }
      case 'analyze_mocks': {
        if (!this.tdd) return this.tddUnavailable();
        return toAgentAnswer(await this.tdd.ask({ type: 'analyze_mocks', for: question.for }));
      }
      case 'suggest_properties': {
        if (!this.tdd) return this.tddUnavailable();
        return toAgentAnswer(await this.tdd.ask({ type: 'suggest_properties', for: question.for }));
      }
      case 'check_isolation': {
        if (!this.tdd) return this.tddUnavailable();
        return toAgentAnswer(await this.tdd.ask({ type: 'check_isolation', tests: question.tests }));
      }
      case 'prioritize_tests': {
        if (!this.tdd) return this.tddUnavailable();
        const request: TestPrioritizationRequest = {
          changedFiles: question.changedFiles,
          strategy: question.strategy ?? 'affected-first',
        };
        return toAgentAnswer(await this.tdd.ask({ type: 'prioritize_tests', request }));
      }
      case 'tdd_guidance': {
        if (!this.tdd) return this.tddUnavailable();
        const state: TddCycleState = {
          phase: question.phase,
          history: [],
        };
        return toAgentAnswer(await this.tdd.ask({ type: 'tdd_guidance', state }));
      }
      case 'analyze_mutations': {
        if (!this.tdd) return this.tddUnavailable();
        return toAgentAnswer(await this.tdd.ask({ type: 'analyze_mutations', file: question.file }));
      }
      case 'suggest_fixtures': {
        if (!this.tdd) return this.tddUnavailable();
        return toAgentAnswer(await this.tdd.ask({ type: 'suggest_fixtures', for: question.for }));
      }
      default: {
        const neverQuestion: never = question;
        throw new Error(`Unsupported agent question: ${JSON.stringify(neverQuestion)}`);
      }
    }
  }

  private tddUnavailable(): AgentAnswer {
    return {
      answer: null,
      confidence: 0,
      reasoning: 'TDD engine not initialized',
      caveats: ['Initialize librainian with TDD support to use TDD features'],
    };
  }

  async trigger(action: AgentAction): Promise<ActionResult> {
    switch (action.type) {
      case 'reindex': {
        const job = await this.meta.requestReindex(action.scope);
        return { ok: true, message: 'Reindex requested', data: job };
      }
      case 'suggest_constraint': {
        const suggestion: ConstraintSuggestion = {
          rule: action.rule,
          evidence: action.evidence,
          confidence: action.confidence,
        };
        this.constraint.suggestConstraint(suggestion);
        return { ok: true, message: 'Constraint suggestion recorded' };
      }
      case 'report_confusion': {
        const taskId = `confusion:${Date.now()}`;
        this.relevance.learnNegative(taskId, [action.area]);
        this.meta.markStale([action.area]);
        return { ok: true, message: 'Confusion recorded and marked for review' };
      }
      case 'request_exception': {
        const result = await this.constraint.requestException(action.violation, action.reason);
        return { ok: result.granted, message: result.reason, data: { expiresAt: result.expiresAt } };
      }
      // TDD-specific actions
      case 'run_tests': {
        if (!this.tdd) return { ok: false, message: 'TDD engine not initialized' };
        return this.tdd.trigger({ type: 'run_tests', scope: action.scope, options: action.options });
      }
      case 'record_test_outcome': {
        if (!this.tdd) return { ok: false, message: 'TDD engine not initialized' };
        return this.tdd.trigger({
          type: 'record_test_outcome',
          test: action.test,
          outcome: { passed: action.passed, duration: action.duration },
        });
      }
      case 'update_test_mapping': {
        if (!this.tdd) return { ok: false, message: 'TDD engine not initialized' };
        return this.tdd.trigger({ type: 'update_test_mapping', source: action.source, tests: action.tests });
      }
      case 'mark_flaky': {
        if (!this.tdd) return { ok: false, message: 'TDD engine not initialized' };
        return this.tdd.trigger({ type: 'mark_flaky', test: action.test, evidence: action.evidence });
      }
      default: {
        const neverAction: never = action;
        throw new Error(`Unsupported agent action: ${JSON.stringify(neverAction)}`);
      }
    }
  }
}
