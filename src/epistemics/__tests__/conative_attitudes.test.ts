/**
 * @fileoverview Tests for Conative Attitudes Module
 *
 * Comprehensive tests covering:
 * - Intention construction and validation
 * - Preference ordering and transitivity
 * - Goal-means-end reasoning
 * - Integration with existing epistemic attitudes
 * - BDI agent state management
 * - Practical reasoning
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Types
  type ConativeAttitudeType,
  type ExtendedAttitudeType,
  type ConativeAttitude,
  type PreferenceOrdering,
  type Intention,
  type IntentionStatus,
  type Preference,
  type Goal,
  type GoalStatus,
  type Desire,
  type BDIAgentState,
  type MeansEndRelation,
  type PracticalReasoningResult,

  // Type guards
  isConativeAttitudeType,
  isExtendedAttitudeType,
  isConativeAttitude,
  isIntention,
  isPreference,
  isGoal,
  isDesire,
  isBDIAgentState,

  // Validators
  validateCommitmentStrength,
  validateDesireIntensity,

  // Conative attitude construction
  constructConativeAttitude,

  // Intention functions
  createIntention,
  addMeansToIntention,
  addConditionToIntention,
  updateIntentionStatus,
  areConditionsSatisfied,

  // Preference functions
  createPreference,
  isPreferred,
  getMostPreferred,
  getLeastPreferred,
  checkTransitivity,
  validatePreferenceConsistency,

  // Goal functions
  createGoal,
  addCriterionToGoal,
  addSubgoal,
  updateGoalStatus,
  isGoalAchieved,
  computeGoalProgress,

  // Desire functions
  createDesire,
  createHope,
  createFear,

  // BDI functions
  createBDIAgentState,
  addBelief,
  addDesireToAgent,
  addIntentionToAgent,
  addGoalToAgent,
  addPreferenceToAgent,

  // Practical reasoning
  evaluatePracticalCoherence,
  isIntentionAchievable,
  deriveIntentionFromGoal,

  // Integration
  intentionToEpistemicObject,
  goalToEpistemicObject,
  preferenceToEpistemicObject,

  // Schema
  CONATIVE_ATTITUDES_SCHEMA_VERSION,
} from '../conative_attitudes.js';

import {
  constructContent,
  constructAttitude,
  constructEpistemicObject,
  constructCoherenceNetwork,
  createObjectId,
  type Content,
  type EpistemicObject,
} from '../universal_coherence.js';

// ============================================================================
// 1. CONATIVE ATTITUDE TYPE TESTS
// ============================================================================

describe('Conative Attitude Types', () => {
  describe('Type Guards', () => {
    it('isConativeAttitudeType correctly identifies conative types', () => {
      expect(isConativeAttitudeType('intending')).toBe(true);
      expect(isConativeAttitudeType('preferring')).toBe(true);
      expect(isConativeAttitudeType('desiring')).toBe(true);
      expect(isConativeAttitudeType('hoping')).toBe(true);
      expect(isConativeAttitudeType('fearing')).toBe(true);
    });

    it('isConativeAttitudeType rejects epistemic types', () => {
      expect(isConativeAttitudeType('accepting')).toBe(false);
      expect(isConativeAttitudeType('rejecting')).toBe(false);
      expect(isConativeAttitudeType('entertaining')).toBe(false);
      expect(isConativeAttitudeType('questioning')).toBe(false);
      expect(isConativeAttitudeType('suspending')).toBe(false);
    });

    it('isExtendedAttitudeType accepts both epistemic and conative types', () => {
      // Epistemic types
      expect(isExtendedAttitudeType('accepting')).toBe(true);
      expect(isExtendedAttitudeType('rejecting')).toBe(true);
      expect(isExtendedAttitudeType('entertaining')).toBe(true);
      expect(isExtendedAttitudeType('questioning')).toBe(true);
      expect(isExtendedAttitudeType('suspending')).toBe(true);

      // Conative types
      expect(isExtendedAttitudeType('intending')).toBe(true);
      expect(isExtendedAttitudeType('preferring')).toBe(true);
      expect(isExtendedAttitudeType('desiring')).toBe(true);
      expect(isExtendedAttitudeType('hoping')).toBe(true);
      expect(isExtendedAttitudeType('fearing')).toBe(true);
    });

    it('isExtendedAttitudeType rejects invalid types', () => {
      expect(isExtendedAttitudeType('invalid')).toBe(false);
      expect(isExtendedAttitudeType('')).toBe(false);
      expect(isExtendedAttitudeType('ACCEPTING')).toBe(false);
    });
  });

  describe('Validation Functions', () => {
    it('validateCommitmentStrength accepts valid values', () => {
      expect(validateCommitmentStrength(0)).toBe(true);
      expect(validateCommitmentStrength(0.5)).toBe(true);
      expect(validateCommitmentStrength(1)).toBe(true);
      expect(validateCommitmentStrength(0.001)).toBe(true);
      expect(validateCommitmentStrength(0.999)).toBe(true);
    });

    it('validateCommitmentStrength rejects invalid values', () => {
      expect(validateCommitmentStrength(-0.1)).toBe(false);
      expect(validateCommitmentStrength(1.1)).toBe(false);
      expect(validateCommitmentStrength(NaN)).toBe(false);
      expect(validateCommitmentStrength(Infinity)).toBe(false);
    });

    it('validateDesireIntensity accepts valid values', () => {
      expect(validateDesireIntensity(0)).toBe(true);
      expect(validateDesireIntensity(0.5)).toBe(true);
      expect(validateDesireIntensity(1)).toBe(true);
    });

    it('validateDesireIntensity rejects invalid values', () => {
      expect(validateDesireIntensity(-0.1)).toBe(false);
      expect(validateDesireIntensity(1.1)).toBe(false);
      expect(validateDesireIntensity(NaN)).toBe(false);
    });
  });
});

// ============================================================================
// 2. CONATIVE ATTITUDE CONSTRUCTION TESTS
// ============================================================================

describe('Conative Attitude Construction', () => {
  describe('constructConativeAttitude', () => {
    it('constructs intending attitude with default commitment', () => {
      const attitude = constructConativeAttitude('intending');
      expect(attitude.type).toBe('intending');
      expect(attitude.commitmentStrength).toBe(0.8);
      expect(attitude.valence).toBe('positive');
    });

    it('constructs intending attitude with custom commitment', () => {
      const attitude = constructConativeAttitude('intending', {
        commitmentStrength: 0.95,
      });
      expect(attitude.commitmentStrength).toBe(0.95);
    });

    it('constructs preferring attitude with default values', () => {
      const attitude = constructConativeAttitude('preferring');
      expect(attitude.type).toBe('preferring');
      expect(attitude.commitmentStrength).toBe(0.5);
      expect(attitude.valence).toBe('neutral');
    });

    it('constructs desiring attitude with desire intensity', () => {
      const attitude = constructConativeAttitude('desiring', {
        desireIntensity: 0.8,
      });
      expect(attitude.type).toBe('desiring');
      expect(attitude.desireIntensity).toBe(0.8);
      expect(attitude.valence).toBe('positive');
    });

    it('constructs hoping attitude with positive valence', () => {
      const attitude = constructConativeAttitude('hoping');
      expect(attitude.type).toBe('hoping');
      expect(attitude.valence).toBe('positive');
      expect(attitude.commitmentStrength).toBe(0.2);
    });

    it('constructs fearing attitude with negative valence', () => {
      const attitude = constructConativeAttitude('fearing');
      expect(attitude.type).toBe('fearing');
      expect(attitude.valence).toBe('negative');
      expect(attitude.commitmentStrength).toBe(0.2);
    });

    it('throws on invalid commitment strength', () => {
      expect(() => constructConativeAttitude('intending', {
        commitmentStrength: 1.5,
      })).toThrow('Invalid commitmentStrength');
    });

    it('throws on invalid desire intensity', () => {
      expect(() => constructConativeAttitude('desiring', {
        desireIntensity: -0.5,
      })).toThrow('Invalid desireIntensity');
    });

    it('includes preference ordering when provided', () => {
      const attitude = constructConativeAttitude('preferring', {
        preferenceOrdering: ['option_a', 'option_b', 'option_c'],
      });
      expect(attitude.preferenceOrdering).toEqual(['option_a', 'option_b', 'option_c']);
    });

    it('includes graded strength when provided', () => {
      const attitude = constructConativeAttitude('intending', {
        strength: { value: 0.9, basis: 'measured' },
      });
      expect(attitude.strength).toEqual({ value: 0.9, basis: 'measured' });
    });
  });

  describe('isConativeAttitude type guard', () => {
    it('validates correct conative attitudes', () => {
      const attitude = constructConativeAttitude('intending');
      expect(isConativeAttitude(attitude)).toBe(true);
    });

    it('rejects non-objects', () => {
      expect(isConativeAttitude(null)).toBe(false);
      expect(isConativeAttitude(undefined)).toBe(false);
      expect(isConativeAttitude('intending')).toBe(false);
    });

    it('rejects objects without required properties', () => {
      expect(isConativeAttitude({ type: 'intending' })).toBe(false);
      expect(isConativeAttitude({ commitmentStrength: 0.5 })).toBe(false);
    });
  });
});

// ============================================================================
// 3. INTENTION TESTS
// ============================================================================

describe('Intention Construction and Validation', () => {
  describe('createIntention', () => {
    it('creates intention with string goal', () => {
      const intention = createIntention('Complete the project');
      expect(intention.goal.value).toBe('Complete the project');
      expect(intention.attitude.type).toBe('intending');
      expect(intention.status).toBe('pending');
      expect(intention.id).toMatch(/^intention_/);
    });

    it('creates intention with Content goal', () => {
      const goalContent = constructContent('Launch the product', 'imperative');
      const intention = createIntention(goalContent);
      expect(intention.goal).toBe(goalContent);
    });

    it('creates intention with custom options', () => {
      const intention = createIntention('Refactor code', {
        id: 'custom_intention_id',
        commitmentStrength: 0.95,
        conditions: ['Code review approved', 'Tests passing'],
        deadline: '2026-03-01',
        priority: 1,
      });
      expect(intention.id).toBe('custom_intention_id');
      expect(intention.attitude.commitmentStrength).toBe(0.95);
      expect(intention.conditions).toEqual(['Code review approved', 'Tests passing']);
      expect(intention.deadline).toBe('2026-03-01');
      expect(intention.priority).toBe(1);
    });

    it('creates intention with initial status', () => {
      const intention = createIntention('Active task', {
        status: 'active',
      });
      expect(intention.status).toBe('active');
    });

    it('includes createdAt timestamp', () => {
      const before = new Date().toISOString();
      const intention = createIntention('Test');
      const after = new Date().toISOString();
      expect(intention.createdAt >= before).toBe(true);
      expect(intention.createdAt <= after).toBe(true);
    });
  });

  describe('Intention Manipulation', () => {
    let intention: Intention;

    beforeEach(() => {
      intention = createIntention('Build feature X', {
        conditions: ['Requirements gathered'],
      });
    });

    it('addMeansToIntention adds means-end relation', () => {
      const meansId = createObjectId('means');
      const updated = addMeansToIntention(
        intention,
        meansId,
        'Writing tests enables feature development',
        'contributing'
      );
      expect(updated.meansEnd).toHaveLength(1);
      expect(updated.meansEnd[0].contribution).toBe('Writing tests enables feature development');
      expect(updated.meansEnd[0].necessity).toBe('contributing');
    });

    it('addConditionToIntention adds condition', () => {
      const updated = addConditionToIntention(intention, 'API available');
      expect(updated.conditions).toContain('API available');
      expect(updated.conditions).toContain('Requirements gathered');
    });

    it('updateIntentionStatus changes status', () => {
      const statuses: IntentionStatus[] = ['pending', 'active', 'suspended', 'achieved', 'abandoned', 'superseded'];
      for (const status of statuses) {
        const updated = updateIntentionStatus(intention, status);
        expect(updated.status).toBe(status);
      }
    });

    it('areConditionsSatisfied checks all conditions', () => {
      const multiCondition = createIntention('Complex task', {
        conditions: ['Condition A', 'Condition B', 'Condition C'],
      });

      // All satisfied
      expect(areConditionsSatisfied(multiCondition, new Set(['Condition A', 'Condition B', 'Condition C']))).toBe(true);

      // Missing one
      expect(areConditionsSatisfied(multiCondition, new Set(['Condition A', 'Condition B']))).toBe(false);

      // Extra conditions don't matter
      expect(areConditionsSatisfied(multiCondition, new Set(['Condition A', 'Condition B', 'Condition C', 'Extra']))).toBe(true);

      // Empty conditions always satisfied
      const noConditions = createIntention('Simple task', { conditions: [] });
      expect(areConditionsSatisfied(noConditions, new Set())).toBe(true);
    });
  });

  describe('isIntention type guard', () => {
    it('validates correct intentions', () => {
      const intention = createIntention('Test intention');
      expect(isIntention(intention)).toBe(true);
    });

    it('rejects invalid objects', () => {
      expect(isIntention(null)).toBe(false);
      expect(isIntention({})).toBe(false);
      expect(isIntention({ id: 'test', goal: {} })).toBe(false);
    });
  });
});

// ============================================================================
// 4. PREFERENCE TESTS
// ============================================================================

describe('Preference Ordering and Transitivity', () => {
  describe('createPreference', () => {
    it('creates preference with string alternatives', () => {
      const preference = createPreference(['Option A', 'Option B', 'Option C']);
      expect(preference.alternatives).toHaveLength(3);
      expect(preference.alternatives[0].value).toBe('Option A');
      expect(preference.ordering).toBe('strict');
      expect(preference.transitivity).toBe(true);
    });

    it('creates preference with Content alternatives', () => {
      const optionA = constructContent('First choice', 'propositional');
      const optionB = constructContent('Second choice', 'propositional');
      const preference = createPreference([optionA, optionB]);
      expect(preference.alternatives[0]).toBe(optionA);
      expect(preference.alternatives[1]).toBe(optionB);
    });

    it('creates preference with custom ordering', () => {
      const preference = createPreference(['A', 'B'], {
        ordering: 'weak',
      });
      expect(preference.ordering).toBe('weak');
    });

    it('creates preference without transitivity', () => {
      const preference = createPreference(['A', 'B', 'C'], {
        transitivity: false,
      });
      expect(preference.transitivity).toBe(false);
    });

    it('creates preference with dimension', () => {
      const preference = createPreference(['TypeScript', 'JavaScript'], {
        dimension: 'type_safety',
      });
      expect(preference.dimension).toBe('type_safety');
    });
  });

  describe('Preference Comparison', () => {
    let strictPreference: Preference;
    let weakPreference: Preference;
    let indifferencePreference: Preference;

    beforeEach(() => {
      strictPreference = createPreference(['A', 'B', 'C'], { ordering: 'strict' });
      weakPreference = createPreference(['A', 'B', 'C'], { ordering: 'weak' });
      indifferencePreference = createPreference(['A', 'B', 'C'], { ordering: 'indifference' });
    });

    it('isPreferred works with strict ordering', () => {
      // Use content IDs for comparison
      const aId = strictPreference.alternatives[0].id;
      const bId = strictPreference.alternatives[1].id;
      const cId = strictPreference.alternatives[2].id;

      expect(isPreferred(strictPreference, aId, bId)).toBe(true);
      expect(isPreferred(strictPreference, aId, cId)).toBe(true);
      expect(isPreferred(strictPreference, bId, cId)).toBe(true);
      expect(isPreferred(strictPreference, bId, aId)).toBe(false);
      expect(isPreferred(strictPreference, cId, aId)).toBe(false);
    });

    it('isPreferred works with weak ordering', () => {
      const aId = weakPreference.alternatives[0].id;
      const bId = weakPreference.alternatives[1].id;

      expect(isPreferred(weakPreference, aId, bId)).toBe(true);
      expect(isPreferred(weakPreference, aId, aId)).toBe(true); // Weak allows equal
    });

    it('isPreferred with indifference returns true for all comparisons', () => {
      const aId = indifferencePreference.alternatives[0].id;
      const bId = indifferencePreference.alternatives[1].id;

      expect(isPreferred(indifferencePreference, aId, bId)).toBe(true);
      expect(isPreferred(indifferencePreference, bId, aId)).toBe(true);
    });

    it('isPreferred returns false for unknown alternatives', () => {
      expect(isPreferred(strictPreference, 'unknown_id', strictPreference.alternatives[0].id)).toBe(false);
    });

    it('getMostPreferred returns first alternative', () => {
      const most = getMostPreferred(strictPreference);
      expect(most).toBe(strictPreference.alternatives[0]);
    });

    it('getLeastPreferred returns last alternative', () => {
      const least = getLeastPreferred(strictPreference);
      expect(least).toBe(strictPreference.alternatives[2]);
    });

    it('getMostPreferred returns undefined for empty preference', () => {
      const emptyPreference = createPreference([]);
      expect(getMostPreferred(emptyPreference)).toBeUndefined();
    });
  });

  describe('Transitivity and Consistency', () => {
    it('checkTransitivity returns true for transitive preferences', () => {
      const preference = createPreference(['A', 'B', 'C'], { transitivity: true });
      expect(checkTransitivity(preference)).toBe(true);
    });

    it('checkTransitivity returns true for non-transitive preferences (no check needed)', () => {
      const preference = createPreference(['A', 'B', 'C'], { transitivity: false });
      expect(checkTransitivity(preference)).toBe(true);
    });

    it('checkTransitivity returns true for indifference ordering', () => {
      const preference = createPreference(['A', 'B', 'C'], { ordering: 'indifference' });
      expect(checkTransitivity(preference)).toBe(true);
    });

    it('validatePreferenceConsistency detects duplicate alternatives', () => {
      const contentA = constructContent('A', 'propositional');
      // Manually create a preference with duplicate alternatives
      const preference: Preference = {
        id: 'test_pref',
        alternatives: [contentA, contentA], // Duplicate
        ordering: 'strict',
        transitivity: true,
        attitude: constructConativeAttitude('preferring'),
        createdAt: new Date().toISOString(),
      };

      const inconsistencies = validatePreferenceConsistency(preference);
      expect(inconsistencies).toContain('Preference contains duplicate alternatives');
    });

    it('validatePreferenceConsistency returns empty array for consistent preferences', () => {
      const preference = createPreference(['A', 'B', 'C']);
      const inconsistencies = validatePreferenceConsistency(preference);
      expect(inconsistencies).toHaveLength(0);
    });
  });

  describe('isPreference type guard', () => {
    it('validates correct preferences', () => {
      const preference = createPreference(['A', 'B']);
      expect(isPreference(preference)).toBe(true);
    });

    it('rejects invalid objects', () => {
      expect(isPreference(null)).toBe(false);
      expect(isPreference({ alternatives: [] })).toBe(false);
    });
  });
});

// ============================================================================
// 5. GOAL TESTS
// ============================================================================

describe('Goal-Means-End Reasoning', () => {
  describe('createGoal', () => {
    it('creates goal with string desired state', () => {
      const goal = createGoal('Achieve profitability');
      expect(goal.desiredState.value).toBe('Achieve profitability');
      expect(goal.status).toBe('active');
      expect(goal.priority).toBe(0);
      expect(goal.id).toMatch(/^goal_/);
    });

    it('creates goal with Content desired state', () => {
      const state = constructContent('System handles 10k RPS', 'propositional');
      const goal = createGoal(state);
      expect(goal.desiredState).toBe(state);
    });

    it('creates goal with achievement criteria', () => {
      const goal = createGoal('Launch product', {
        achievementCriteria: ['Tests passing', 'Docs complete', 'Stakeholder approval'],
      });
      expect(goal.achievementCriteria).toHaveLength(3);
    });

    it('creates goal with priority', () => {
      const goal = createGoal('High priority task', { priority: 1 });
      expect(goal.priority).toBe(1);
    });

    it('creates goal with desiring attitude by default', () => {
      const goal = createGoal('Desired outcome');
      expect(goal.attitude.type).toBe('desiring');
    });

    it('creates goal with hoping attitude when specified', () => {
      const goal = createGoal('Hoped outcome', { attitudeType: 'hoping' });
      expect(goal.attitude.type).toBe('hoping');
    });

    it('creates goal with subgoals', () => {
      const goal = createGoal('Parent goal', {
        subgoalIds: ['subgoal_1', 'subgoal_2'],
      });
      expect(goal.subgoalIds).toEqual(['subgoal_1', 'subgoal_2']);
    });

    it('creates goal with parent goal reference', () => {
      const goal = createGoal('Subgoal', {
        parentGoalId: 'parent_goal_123',
      });
      expect(goal.parentGoalId).toBe('parent_goal_123');
    });
  });

  describe('Goal Manipulation', () => {
    let goal: Goal;

    beforeEach(() => {
      goal = createGoal('Complete milestone', {
        achievementCriteria: ['Task 1 done'],
      });
    });

    it('addCriterionToGoal adds criterion', () => {
      const updated = addCriterionToGoal(goal, 'Task 2 done');
      expect(updated.achievementCriteria).toContain('Task 1 done');
      expect(updated.achievementCriteria).toContain('Task 2 done');
    });

    it('addSubgoal adds subgoal reference', () => {
      const updated = addSubgoal(goal, 'subgoal_new');
      expect(updated.subgoalIds).toContain('subgoal_new');
    });

    it('updateGoalStatus changes status', () => {
      const statuses: GoalStatus[] = ['active', 'achieved', 'failed', 'suspended', 'abandoned'];
      for (const status of statuses) {
        const updated = updateGoalStatus(goal, status);
        expect(updated.status).toBe(status);
      }
    });
  });

  describe('Goal Achievement', () => {
    it('isGoalAchieved returns true when all criteria satisfied', () => {
      const goal = createGoal('Test goal', {
        achievementCriteria: ['A', 'B', 'C'],
      });
      expect(isGoalAchieved(goal, new Set(['A', 'B', 'C']))).toBe(true);
    });

    it('isGoalAchieved returns false when criteria missing', () => {
      const goal = createGoal('Test goal', {
        achievementCriteria: ['A', 'B', 'C'],
      });
      expect(isGoalAchieved(goal, new Set(['A', 'B']))).toBe(false);
    });

    it('isGoalAchieved returns false for empty criteria', () => {
      const goal = createGoal('Test goal', { achievementCriteria: [] });
      expect(isGoalAchieved(goal, new Set(['anything']))).toBe(false);
    });

    it('computeGoalProgress returns correct percentage', () => {
      const goal = createGoal('Test goal', {
        achievementCriteria: ['A', 'B', 'C', 'D'],
      });

      expect(computeGoalProgress(goal, new Set([]))).toBe(0);
      expect(computeGoalProgress(goal, new Set(['A']))).toBe(0.25);
      expect(computeGoalProgress(goal, new Set(['A', 'B']))).toBe(0.5);
      expect(computeGoalProgress(goal, new Set(['A', 'B', 'C']))).toBe(0.75);
      expect(computeGoalProgress(goal, new Set(['A', 'B', 'C', 'D']))).toBe(1);
    });

    it('computeGoalProgress returns 0 for empty criteria', () => {
      const goal = createGoal('Test goal', { achievementCriteria: [] });
      expect(computeGoalProgress(goal, new Set(['anything']))).toBe(0);
    });
  });

  describe('isGoal type guard', () => {
    it('validates correct goals', () => {
      const goal = createGoal('Test goal');
      expect(isGoal(goal)).toBe(true);
    });

    it('rejects invalid objects', () => {
      expect(isGoal(null)).toBe(false);
      expect(isGoal({ desiredState: {} })).toBe(false);
    });
  });
});

// ============================================================================
// 6. DESIRE TESTS
// ============================================================================

describe('Desire, Hope, and Fear', () => {
  describe('createDesire', () => {
    it('creates desire with positive valence', () => {
      const desire = createDesire('Get promoted');
      expect(desire.content.value).toBe('Get promoted');
      expect(desire.attitude.type).toBe('desiring');
      expect(desire.valence).toBe('positive');
      expect(desire.id).toMatch(/^desire_/);
    });

    it('creates desire with custom intensity', () => {
      const desire = createDesire('Strong desire', {
        desireIntensity: 0.9,
      });
      expect(desire.attitude.desireIntensity).toBe(0.9);
    });
  });

  describe('createHope', () => {
    it('creates hope with positive valence', () => {
      const hope = createHope('Win the lottery');
      expect(hope.content.value).toBe('Win the lottery');
      expect(hope.attitude.type).toBe('hoping');
      expect(hope.valence).toBe('positive');
      expect(hope.id).toMatch(/^hope_/);
    });

    it('creates hope with lower commitment than intention', () => {
      const hope = createHope('Best case scenario');
      expect(hope.attitude.commitmentStrength).toBe(0.2);
    });
  });

  describe('createFear', () => {
    it('creates fear with negative valence', () => {
      const fear = createFear('Project fails');
      expect(fear.content.value).toBe('Project fails');
      expect(fear.attitude.type).toBe('fearing');
      expect(fear.valence).toBe('negative');
      expect(fear.id).toMatch(/^fear_/);
    });

    it('creates fear with custom intensity', () => {
      const fear = createFear('Major concern', {
        desireIntensity: 0.95,
      });
      expect(fear.attitude.desireIntensity).toBe(0.95);
    });
  });

  describe('isDesire type guard', () => {
    it('validates desires', () => {
      expect(isDesire(createDesire('Test'))).toBe(true);
    });

    it('validates hopes', () => {
      expect(isDesire(createHope('Test'))).toBe(true);
    });

    it('validates fears', () => {
      expect(isDesire(createFear('Test'))).toBe(true);
    });

    it('rejects invalid objects', () => {
      expect(isDesire(null)).toBe(false);
      expect(isDesire({})).toBe(false);
    });
  });
});

// ============================================================================
// 7. BDI AGENT STATE TESTS
// ============================================================================

describe('BDI Agent State Management', () => {
  describe('createBDIAgentState', () => {
    it('creates empty agent state', () => {
      const state = createBDIAgentState('agent_001', 'Test Agent');
      expect(state.agentId).toBe('agent_001');
      expect(state.agentName).toBe('Test Agent');
      expect(state.beliefs.objects.size).toBe(0);
      expect(state.desires).toHaveLength(0);
      expect(state.intentions).toHaveLength(0);
      expect(state.goals).toHaveLength(0);
      expect(state.preferences).toHaveLength(0);
    });

    it('creates agent state with initial beliefs', () => {
      const belief = constructEpistemicObject(
        constructContent('The sky is blue'),
        constructAttitude('accepting')
      );
      const state = createBDIAgentState('agent_001', 'Test Agent', {
        initialBeliefs: [belief],
      });
      expect(state.beliefs.objects.size).toBe(1);
    });

    it('creates agent state with initial desires', () => {
      const desire = createDesire('Be happy');
      const state = createBDIAgentState('agent_001', 'Test Agent', {
        initialDesires: [desire],
      });
      expect(state.desires).toHaveLength(1);
    });

    it('creates agent state with initial intentions', () => {
      const intention = createIntention('Complete task');
      const state = createBDIAgentState('agent_001', 'Test Agent', {
        initialIntentions: [intention],
      });
      expect(state.intentions).toHaveLength(1);
    });

    it('creates agent state with initial goals', () => {
      const goal = createGoal('Achieve success');
      const state = createBDIAgentState('agent_001', 'Test Agent', {
        initialGoals: [goal],
      });
      expect(state.goals).toHaveLength(1);
    });

    it('creates agent state with initial preferences', () => {
      const preference = createPreference(['A', 'B']);
      const state = createBDIAgentState('agent_001', 'Test Agent', {
        initialPreferences: [preference],
      });
      expect(state.preferences).toHaveLength(1);
    });
  });

  describe('Agent State Manipulation', () => {
    let state: BDIAgentState;

    beforeEach(() => {
      state = createBDIAgentState('agent_001', 'Test Agent');
    });

    it('addBelief adds belief to agent', () => {
      const belief = constructEpistemicObject(
        constructContent('New belief'),
        constructAttitude('accepting')
      );
      const updated = addBelief(state, belief);
      expect(updated.beliefs.objects.size).toBe(1);
    });

    it('addDesireToAgent adds desire to agent', () => {
      const desire = createDesire('New desire');
      const updated = addDesireToAgent(state, desire);
      expect(updated.desires).toHaveLength(1);
    });

    it('addIntentionToAgent adds intention to agent', () => {
      const intention = createIntention('New intention');
      const updated = addIntentionToAgent(state, intention);
      expect(updated.intentions).toHaveLength(1);
    });

    it('addGoalToAgent adds goal to agent', () => {
      const goal = createGoal('New goal');
      const updated = addGoalToAgent(state, goal);
      expect(updated.goals).toHaveLength(1);
    });

    it('addPreferenceToAgent adds preference to agent', () => {
      const preference = createPreference(['X', 'Y']);
      const updated = addPreferenceToAgent(state, preference);
      expect(updated.preferences).toHaveLength(1);
    });
  });

  describe('isBDIAgentState type guard', () => {
    it('validates correct agent state', () => {
      const state = createBDIAgentState('agent_001', 'Test Agent');
      expect(isBDIAgentState(state)).toBe(true);
    });

    it('rejects invalid objects', () => {
      expect(isBDIAgentState(null)).toBe(false);
      expect(isBDIAgentState({})).toBe(false);
      expect(isBDIAgentState({ agentId: 'test' })).toBe(false);
    });
  });
});

// ============================================================================
// 8. PRACTICAL REASONING TESTS
// ============================================================================

describe('Practical Reasoning', () => {
  describe('evaluatePracticalCoherence', () => {
    it('returns coherent for empty intentions', () => {
      const state = createBDIAgentState('agent_001', 'Test Agent');
      const result = evaluatePracticalCoherence(state);
      expect(result.coherent).toBe(true);
      expect(result.recommendedIntention).toBeNull();
      expect(result.reasoning).toContain('No intentions to evaluate');
    });

    it('returns coherent for no active intentions', () => {
      const intention = createIntention('Task', { status: 'achieved' });
      const state = createBDIAgentState('agent_001', 'Test Agent', {
        initialIntentions: [intention],
      });
      const result = evaluatePracticalCoherence(state);
      expect(result.coherent).toBe(true);
      expect(result.recommendedIntention).toBeNull();
    });

    it('recommends highest priority intention', () => {
      const lowPriority = createIntention('Low priority', {
        status: 'active',
        priority: 10,
      });
      const highPriority = createIntention('High priority', {
        status: 'active',
        priority: 1,
      });
      const state = createBDIAgentState('agent_001', 'Test Agent', {
        initialIntentions: [lowPriority, highPriority],
      });
      const result = evaluatePracticalCoherence(state);
      expect(result.recommendedIntention?.id).toBe(highPriority.id);
    });

    it('uses commitment strength as tiebreaker', () => {
      const lowCommitment = createIntention('Low commitment', {
        status: 'active',
        priority: 1,
        commitmentStrength: 0.5,
      });
      const highCommitment = createIntention('High commitment', {
        status: 'active',
        priority: 1,
        commitmentStrength: 0.9,
      });
      const state = createBDIAgentState('agent_001', 'Test Agent', {
        initialIntentions: [lowCommitment, highCommitment],
      });
      const result = evaluatePracticalCoherence(state);
      expect(result.recommendedIntention?.id).toBe(highCommitment.id);
    });

    it('considers pending intentions as active', () => {
      const pendingIntention = createIntention('Pending task', {
        status: 'pending',
      });
      const state = createBDIAgentState('agent_001', 'Test Agent', {
        initialIntentions: [pendingIntention],
      });
      const result = evaluatePracticalCoherence(state);
      expect(result.recommendedIntention?.id).toBe(pendingIntention.id);
    });
  });

  describe('isIntentionAchievable', () => {
    it('returns achievable for intention with no conditions', () => {
      const intention = createIntention('Simple task', { conditions: [] });
      const beliefs = constructCoherenceNetwork([], [], { validate: false });
      const result = isIntentionAchievable(intention, beliefs);
      expect(result.achievable).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it('returns not achievable for unmet conditions', () => {
      const intention = createIntention('Complex task', {
        conditions: ['Required condition'],
      });
      const beliefs = constructCoherenceNetwork([], [], { validate: false });
      const result = isIntentionAchievable(intention, beliefs);
      expect(result.achievable).toBe(false);
      expect(result.reasons).toContain('Condition not believed: Required condition');
    });

    it('returns achievable when conditions are believed', () => {
      const intention = createIntention('Conditional task', {
        conditions: ['Condition met'],
      });
      const belief = constructEpistemicObject(
        constructContent('Condition met'),
        constructAttitude('accepting')
      );
      const beliefs = constructCoherenceNetwork([belief], [], { validate: false });
      const result = isIntentionAchievable(intention, beliefs);
      expect(result.achievable).toBe(true);
    });
  });

  describe('deriveIntentionFromGoal', () => {
    it('derives intention with goal content', () => {
      const goal = createGoal('Achieve target', {
        achievementCriteria: ['Criterion A', 'Criterion B'],
        priority: 2,
      });
      const intention = deriveIntentionFromGoal(goal);
      expect(intention.goal.value).toEqual(goal.desiredState.value);
      expect(intention.conditions).toEqual(['Criterion A', 'Criterion B']);
      expect(intention.priority).toBe(2);
    });

    it('uses specified commitment strength', () => {
      const goal = createGoal('Target');
      const intention = deriveIntentionFromGoal(goal, 0.95);
      expect(intention.attitude.commitmentStrength).toBe(0.95);
    });

    it('uses default commitment strength', () => {
      const goal = createGoal('Target');
      const intention = deriveIntentionFromGoal(goal);
      expect(intention.attitude.commitmentStrength).toBe(0.8);
    });
  });
});

// ============================================================================
// 9. INTEGRATION WITH EPISTEMIC OBJECTS TESTS
// ============================================================================

describe('Integration with Existing Attitudes', () => {
  describe('intentionToEpistemicObject', () => {
    it('converts intention to epistemic object', () => {
      const intention = createIntention('Complete project', {
        conditions: ['Budget approved'],
        deadline: '2026-06-01',
      });
      const obj = intentionToEpistemicObject(intention);
      expect(obj.content.contentType).toBe('structured');
      expect(obj.attitude.type).toBe('accepting');
      expect((obj.content.value as Record<string, unknown>).type).toBe('intention');
    });

    it('preserves intention status in object status', () => {
      const achievedIntention = createIntention('Done', { status: 'achieved' });
      const achievedObj = intentionToEpistemicObject(achievedIntention);
      expect(achievedObj.metadata.status).toBe('active');

      const abandonedIntention = createIntention('Cancelled', { status: 'abandoned' });
      const abandonedObj = intentionToEpistemicObject(abandonedIntention);
      expect(abandonedObj.metadata.status).toBe('retracted');
    });
  });

  describe('goalToEpistemicObject', () => {
    it('converts goal to epistemic object', () => {
      const goal = createGoal('Reach milestone', {
        achievementCriteria: ['Step 1', 'Step 2'],
        priority: 1,
      });
      const obj = goalToEpistemicObject(goal);
      expect(obj.content.contentType).toBe('structured');
      expect(obj.attitude.type).toBe('accepting');
      expect((obj.content.value as Record<string, unknown>).type).toBe('goal');
    });

    it('preserves goal status in object status', () => {
      const achievedGoal = createGoal('Done', { status: 'achieved' });
      const achievedObj = goalToEpistemicObject(achievedGoal);
      expect(achievedObj.metadata.status).toBe('active');

      const failedGoal = createGoal('Failed', { status: 'failed' });
      const failedObj = goalToEpistemicObject(failedGoal);
      expect(failedObj.metadata.status).toBe('defeated');
    });
  });

  describe('preferenceToEpistemicObject', () => {
    it('converts preference to epistemic object', () => {
      const preference = createPreference(['A', 'B', 'C'], {
        dimension: 'utility',
      });
      const obj = preferenceToEpistemicObject(preference);
      expect(obj.content.contentType).toBe('structured');
      expect(obj.attitude.type).toBe('accepting');
      expect((obj.content.value as Record<string, unknown>).type).toBe('preference');
      expect((obj.content.value as Record<string, unknown>).dimension).toBe('utility');
    });
  });

  describe('End-to-end integration', () => {
    it('builds coherent network with conative and epistemic objects', () => {
      // Create epistemic beliefs
      const belief = constructEpistemicObject(
        constructContent('TypeScript improves code quality'),
        constructAttitude('accepting', { value: 0.9, basis: 'measured' })
      );

      // Create conative attitudes
      const goal = createGoal('Improve code quality');
      const preference = createPreference(['TypeScript', 'JavaScript'], {
        dimension: 'type_safety',
      });
      const intention = createIntention('Migrate to TypeScript', {
        conditions: ['Team trained'],
        commitmentStrength: 0.85,
      });

      // Convert to epistemic objects
      const goalObj = goalToEpistemicObject(goal);
      const prefObj = preferenceToEpistemicObject(preference);
      const intentionObj = intentionToEpistemicObject(intention);

      // Build network
      const network = constructCoherenceNetwork(
        [belief, goalObj, prefObj, intentionObj],
        [],
        { name: 'Mixed Epistemic-Conative Network', validate: false }
      );

      expect(network.objects.size).toBe(4);
    });
  });
});

// ============================================================================
// 10. SCHEMA VERSION TEST
// ============================================================================

describe('Schema Version', () => {
  it('has defined schema version', () => {
    expect(CONATIVE_ATTITUDES_SCHEMA_VERSION).toBe('1.0.0');
  });
});
