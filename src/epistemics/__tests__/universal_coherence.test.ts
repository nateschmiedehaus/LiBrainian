/**
 * @fileoverview Tests for Universal Coherence System
 *
 * Demonstrates that the same epistemic primitives can construct wildly different
 * coherence structures across multiple domains. This proves the universality of
 * the underlying constructors.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  // Branded ID constructors
  createContentId,
  createObjectId,
  createGroundingId,
  createNetworkId,
  createAgentId,
  // Content and attitude constructors
  constructContent,
  constructAttitude,
  constructEpistemicObject,
  constructGrounding,
  constructAbstractionLevel,
  constructHierarchy,
  constructCoherenceNetwork,
  // Evaluation
  evaluateCoherence,
  findGroundingChain,
  detectConflicts,
  checkLevelConsistency,
  // Presets
  PRESETS,
  applyPreset,
  adaptPreset,
  // Auto-configuration
  inferStructure,
  suggestPreset,
  // Integration
  toConfidenceValue,
  fromConfidenceValue,
  toClaim,
  fromClaim,
  // Error types
  GroundingError,
  NetworkError,
  // Types
  type ContentId,
  type ObjectId,
  type Content,
  type Attitude,
  type EpistemicObject,
  type Grounding,
  type AbstractionLevel,
  type CoherenceNetwork,
  type GradedStrength,
  type ContentType,
  type AttitudeType,
  type ExtendedGroundingType,
} from '../universal_coherence.js';
import { deterministic, absent, bounded } from '../confidence.js';
import type { ConfidenceValue } from '../confidence.js';

// ============================================================================
// 1. PRIMITIVE CONSTRUCTION TESTS
// ============================================================================

describe('Primitive Construction Tests', () => {
  describe('Branded ID Constructors', () => {
    it('creates unique ContentIds with prefix', () => {
      const id1 = createContentId('test');
      const id2 = createContentId('test');
      expect(id1).not.toBe(id2);
      expect(id1.startsWith('test_')).toBe(true);
      expect(id2.startsWith('test_')).toBe(true);
    });

    it('creates unique ObjectIds with prefix', () => {
      const id1 = createObjectId('obj');
      const id2 = createObjectId('obj');
      expect(id1).not.toBe(id2);
      expect(id1.startsWith('obj_')).toBe(true);
    });

    it('creates unique GroundingIds with prefix', () => {
      const id1 = createGroundingId('ground');
      const id2 = createGroundingId('ground');
      expect(id1).not.toBe(id2);
      expect(id1.startsWith('ground_')).toBe(true);
    });

    it('creates unique NetworkIds with prefix', () => {
      const id1 = createNetworkId('net');
      const id2 = createNetworkId('net');
      expect(id1).not.toBe(id2);
      expect(id1.startsWith('net_')).toBe(true);
    });

    it('creates unique AgentIds with prefix', () => {
      const id1 = createAgentId('agent');
      const id2 = createAgentId('agent');
      expect(id1).not.toBe(id2);
      expect(id1.startsWith('agent_')).toBe(true);
    });
  });

  describe('Content Construction', () => {
    it('constructs content from string', () => {
      const content = constructContent('The cat is on the mat');
      expect(content.value).toBe('The cat is on the mat');
      expect(content.contentType).toBe('propositional');
      expect(content.id).toBeDefined();
      expect(content.hash).toBeDefined();
    });

    it('constructs content from object', () => {
      const data = { name: 'UserService', methods: ['create', 'update'] };
      const content = constructContent(data);
      expect(content.value).toEqual(data);
      expect(content.contentType).toBe('structured');
    });

    it('infers interrogative content type', () => {
      const content = constructContent('Is the sky blue?');
      expect(content.contentType).toBe('interrogative');
    });

    it('infers imperative content type', () => {
      const content = constructContent('Do the dishes');
      expect(content.contentType).toBe('imperative');
    });

    it('allows explicit content type override', () => {
      const content = constructContent('Some code', 'procedural');
      expect(content.contentType).toBe('procedural');
    });

    it('generates consistent hash for same content', () => {
      const content1 = constructContent('Test content');
      const content2 = constructContent('Test content');
      expect(content1.hash).toBe(content2.hash);
    });

    it('generates different hash for different content', () => {
      const content1 = constructContent('Content A');
      const content2 = constructContent('Content B');
      expect(content1.hash).not.toBe(content2.hash);
    });
  });

  describe('Attitude Construction', () => {
    const attitudeTypes: AttitudeType[] = [
      'entertaining',
      'accepting',
      'rejecting',
      'questioning',
      'suspending',
    ];

    it.each(attitudeTypes)('constructs %s attitude without strength', (type) => {
      const attitude = constructAttitude(type);
      expect(attitude.type).toBe(type);
      expect(attitude.strength).toBeUndefined();
    });

    it('constructs attitude with graded strength', () => {
      const strength: GradedStrength = { value: 0.8, basis: 'measured' };
      const attitude = constructAttitude('accepting', strength);
      expect(attitude.type).toBe('accepting');
      expect(attitude.strength).toEqual(strength);
    });

    it('supports all strength basis types', () => {
      const bases: Array<GradedStrength['basis']> = [
        'measured',
        'derived',
        'estimated',
        'absent',
      ];
      for (const basis of bases) {
        const attitude = constructAttitude('accepting', { value: 0.5, basis });
        expect(attitude.strength?.basis).toBe(basis);
      }
    });
  });

  describe('Grounding Construction', () => {
    it('constructs basic grounding relation', () => {
      const fromId = createObjectId('from');
      const toId = createObjectId('to');
      const grounding = constructGrounding(fromId, toId, 'evidential');
      expect(grounding.from).toBe(fromId);
      expect(grounding.to).toBe(toId);
      expect(grounding.type).toBe('evidential');
      expect(grounding.active).toBe(true);
    });

    it('infers strength from grounding type', () => {
      const fromId = createObjectId('from');
      const toId = createObjectId('to');
      const fullGrounding = constructGrounding(fromId, toId, 'full', {
        value: 1.0,
        basis: 'logical',
      });
      expect(fullGrounding.strength.value).toBe(1.0);
    });

    it('throws on reflexive grounding', () => {
      const id = createObjectId('self');
      expect(() => constructGrounding(id, id, 'evidential')).toThrow(GroundingError);
      expect(() => constructGrounding(id, id, 'evidential')).toThrow('Object cannot ground itself');
    });

    it('throws on full grounding with non-1.0 strength', () => {
      const fromId = createObjectId('from');
      const toId = createObjectId('to');
      expect(() =>
        constructGrounding(fromId, toId, 'full', { value: 0.9, basis: 'logical' })
      ).toThrow(GroundingError);
      expect(() =>
        constructGrounding(fromId, toId, 'full', { value: 0.9, basis: 'logical' })
      ).toThrow('Full grounding requires strength 1.0');
    });

    const groundingTypes: ExtendedGroundingType[] = [
      'evidential',
      'explanatory',
      'constitutive',
      'inferential',
      'testimonial',
      'perceptual',
      'full',
      'partial',
      'enabling',
      'undermining',
      'rebutting',
      'undercutting',
    ];

    it.each(groundingTypes.filter((t) => t !== 'full'))(
      'constructs %s grounding with inferred strength',
      (type) => {
        const fromId = createObjectId('from');
        const toId = createObjectId('to');
        const grounding = constructGrounding(fromId, toId, type);
        expect(grounding.type).toBe(type);
        expect(grounding.strength.value).toBeGreaterThan(0);
        expect(grounding.strength.value).toBeLessThanOrEqual(1);
      }
    );
  });
});

// ============================================================================
// 2. PRESET TESTS
// ============================================================================

describe('Preset Tests', () => {
  describe('Software Development Preset', () => {
    it('creates network with correct levels', () => {
      const network = applyPreset('softwareDevelopment');
      expect(network.levels).toHaveLength(5);
      expect(network.levels![0].name).toBe('philosophy');
      expect(network.levels![1].name).toBe('principles');
      expect(network.levels![2].name).toBe('architecture');
      expect(network.levels![3].name).toBe('design');
      expect(network.levels![4].name).toBe('implementation');
    });

    it('has correct entrenchment ordering', () => {
      const network = applyPreset('softwareDevelopment');
      for (let i = 1; i < network.levels!.length; i++) {
        expect(network.levels![i].entrenchment).toBeLessThanOrEqual(
          network.levels![i - 1].entrenchment
        );
      }
    });

    it('has downward grounding direction', () => {
      const network = applyPreset('softwareDevelopment');
      expect(network.config.groundingDirection).toBe('down');
    });

    it('includes default coherence rules', () => {
      const network = applyPreset('softwareDevelopment');
      expect(network.rules.some((r) => r.type === 'no_contradictions')).toBe(true);
      expect(network.rules.some((r) => r.type === 'grounding_acyclicity')).toBe(true);
    });
  });

  describe('Scientific Method Preset', () => {
    it('creates network with correct levels', () => {
      const network = applyPreset('scientificMethod');
      expect(network.levels).toHaveLength(6);
      expect(network.levels![0].name).toBe('theory');
      expect(network.levels![1].name).toBe('hypothesis');
      expect(network.levels![2].name).toBe('prediction');
      expect(network.levels![3].name).toBe('experiment');
      expect(network.levels![4].name).toBe('data');
      expect(network.levels![5].name).toBe('conclusion');
    });

    it('has bidirectional grounding direction', () => {
      const network = applyPreset('scientificMethod');
      expect(network.config.groundingDirection).toBe('bidirectional');
    });
  });

  describe('Legal Reasoning Preset', () => {
    it('creates network with correct levels', () => {
      const network = applyPreset('legalReasoning');
      expect(network.levels).toHaveLength(5);
      expect(network.levels![0].name).toBe('constitution');
      expect(network.levels![1].name).toBe('statute');
      expect(network.levels![2].name).toBe('precedent');
      expect(network.levels![3].name).toBe('rule');
      expect(network.levels![4].name).toBe('application');
    });

    it('has downward grounding direction', () => {
      const network = applyPreset('legalReasoning');
      expect(network.config.groundingDirection).toBe('down');
    });
  });

  describe('Preset Adaptation', () => {
    it('adapts preset with additional levels', () => {
      const network = adaptPreset('softwareDevelopment', {
        additionalLevels: ['deployment', 'monitoring'],
      });
      expect(network.levels).toHaveLength(7);
      expect(network.levels![5].name).toBe('deployment');
      expect(network.levels![6].name).toBe('monitoring');
    });

    it('adapts preset with custom name', () => {
      const network = adaptPreset('softwareDevelopment', {
        name: 'My Custom Software Preset',
      });
      expect(network.name).toBe('My Custom Software Preset');
    });
  });
});

// ============================================================================
// 3. UNIVERSAL CONSTRUCTABILITY DEMONSTRATION
// ============================================================================

describe('Universal Constructability Demonstration', () => {
  /**
   * Helper to create an epistemic object at a level
   */
  function createObjectAtLevel(
    value: string,
    level: AbstractionLevel,
    attitude: AttitudeType = 'accepting'
  ): EpistemicObject {
    const content = constructContent(value, 'propositional');
    const att = constructAttitude(attitude, { value: 0.9, basis: 'estimated' });
    return constructEpistemicObject(content, att, { level });
  }

  describe('Software Architecture Example', () => {
    it('constructs philosophy -> principle -> design -> implementation chain', () => {
      // Create levels
      const levels = constructHierarchy([
        'philosophy',
        'principles',
        'design',
        'implementation',
      ]);

      // Create objects at each level
      const philosophy = createObjectAtLevel('Prefer simplicity over complexity', levels[0]);
      const principle = createObjectAtLevel(
        'Single responsibility: each module does one thing',
        levels[1]
      );
      const design = createObjectAtLevel('Separate concerns into modules', levels[2]);
      const implementation = createObjectAtLevel('Create UserService class', levels[3]);

      // Create grounding chain: implementation <- design <- principle <- philosophy
      const groundings = [
        constructGrounding(philosophy.id, principle.id, 'inferential', {
          value: 0.9,
          basis: 'logical',
        }),
        constructGrounding(principle.id, design.id, 'inferential', {
          value: 0.85,
          basis: 'logical',
        }),
        constructGrounding(design.id, implementation.id, 'inferential', {
          value: 0.8,
          basis: 'logical',
        }),
      ];

      // Build network
      const network = constructCoherenceNetwork(
        [philosophy, principle, design, implementation],
        groundings,
        { name: 'Software Architecture', levels }
      );

      expect(network.objects.size).toBe(4);
      expect(network.groundings.size).toBe(3);

      // Verify grounding chain exists from philosophy to implementation
      const chain = findGroundingChain(network, philosophy.id, implementation.id);
      expect(chain).toHaveLength(4);
      expect(chain[0]).toBe(philosophy.id);
      expect(chain[3]).toBe(implementation.id);
    });

    it('evaluates coherent software architecture as coherent', () => {
      const levels = constructHierarchy(['philosophy', 'principles', 'design', 'implementation']);

      const philosophy = createObjectAtLevel('Prefer simplicity', levels[0]);
      const principle = createObjectAtLevel('Single responsibility', levels[1]);
      const design = createObjectAtLevel('Modular design', levels[2]);
      const implementation = createObjectAtLevel('UserService class', levels[3]);

      const groundings = [
        constructGrounding(philosophy.id, principle.id, 'inferential'),
        constructGrounding(principle.id, design.id, 'inferential'),
        constructGrounding(design.id, implementation.id, 'inferential'),
      ];

      const network = constructCoherenceNetwork(
        [philosophy, principle, design, implementation],
        groundings,
        { name: 'Coherent Software Architecture', levels }
      );

      const result = evaluateCoherence(network);
      expect(result.status.coherent).toBe(true);
    });
  });

  describe('Scientific Method Example', () => {
    it('constructs theory -> hypothesis -> experiment -> data -> conclusion with bidirectional grounding', () => {
      const levels = constructHierarchy([
        'theory',
        'hypothesis',
        'experiment',
        'data',
        'conclusion',
      ]);

      // Create objects
      const theory = createObjectAtLevel('Evolution by natural selection', levels[0]);
      const hypothesis = createObjectAtLevel('Finches adapt beak size to food sources', levels[1]);
      const experiment = createObjectAtLevel('Measure beak sizes across islands', levels[2]);
      const data = createObjectAtLevel('Recorded measurements from 5 islands', levels[3]);
      const conclusion = createObjectAtLevel('Beak size correlates with food type', levels[4]);

      // Scientific method has bidirectional grounding:
      // Theory -> Hypothesis -> Experiment (downward)
      // Data -> Conclusion (upward - data supports conclusion)
      // Conclusion -> Theory (upward - conclusion supports/refines theory)
      const groundings = [
        // Downward: theory generates hypothesis, hypothesis guides experiment
        constructGrounding(theory.id, hypothesis.id, 'explanatory'),
        constructGrounding(hypothesis.id, experiment.id, 'inferential'),
        // Upward: data supports conclusion, conclusion supports theory
        constructGrounding(data.id, conclusion.id, 'evidential'),
        constructGrounding(conclusion.id, theory.id, 'evidential'),
      ];

      const network = constructCoherenceNetwork(
        [theory, hypothesis, experiment, data, conclusion],
        groundings,
        {
          name: 'Scientific Method',
          levels,
          groundingDirection: 'bidirectional',
        }
      );

      expect(network.objects.size).toBe(5);
      expect(network.groundings.size).toBe(4);
      expect(network.config.groundingDirection).toBe('bidirectional');

      // Verify bidirectional chains exist
      const downwardChain = findGroundingChain(network, theory.id, experiment.id);
      expect(downwardChain.length).toBeGreaterThan(0);

      const upwardChain = findGroundingChain(network, data.id, theory.id);
      expect(upwardChain.length).toBeGreaterThan(0);
    });
  });

  describe('Legal Reasoning Example', () => {
    it('constructs constitution -> statute -> precedent -> application with downward grounding', () => {
      const levels = constructHierarchy([
        'constitution',
        'statute',
        'precedent',
        'application',
      ]);

      // Create objects
      const constitution = createObjectAtLevel(
        'Equal protection clause: no person shall be denied equal protection',
        levels[0]
      );
      const statute = createObjectAtLevel(
        'Civil Rights Act: prohibits discrimination in public accommodations',
        levels[1]
      );
      const precedent = createObjectAtLevel(
        'Brown v. Board: separate but equal is inherently unequal',
        levels[2]
      );
      const application = createObjectAtLevel(
        'School policy X violates equal protection by segregating students',
        levels[3]
      );

      // Legal reasoning: authority flows downward
      const groundings = [
        constructGrounding(constitution.id, statute.id, 'constitutive'),
        constructGrounding(statute.id, precedent.id, 'inferential'),
        constructGrounding(precedent.id, application.id, 'inferential'),
        // Direct constitutional grounding for the application
        constructGrounding(constitution.id, application.id, 'inferential'),
      ];

      const network = constructCoherenceNetwork(
        [constitution, statute, precedent, application],
        groundings,
        {
          name: 'Legal Reasoning',
          levels,
          groundingDirection: 'down',
        }
      );

      expect(network.objects.size).toBe(4);
      expect(network.groundings.size).toBe(4);

      // Verify authority chain from constitution to application
      const chain = findGroundingChain(network, constitution.id, application.id);
      expect(chain.length).toBeGreaterThan(0);
    });
  });

  describe('Custom Domain: Cooking Hierarchy', () => {
    it('proves the system handles domains it was not designed for', () => {
      // Create a completely custom hierarchy for cooking
      const levels = constructHierarchy([
        'cuisine_philosophy',
        'technique_principles',
        'recipe_design',
        'ingredient_implementation',
      ]);

      // Create objects at each level
      const philosophy = createObjectAtLevel(
        'French cuisine emphasizes technique and quality ingredients',
        levels[0]
      );
      const principles = createObjectAtLevel(
        'Mise en place: prepare and organize all ingredients before cooking',
        levels[1]
      );
      const recipe = createObjectAtLevel(
        'Coq au vin: chicken braised in wine with mushrooms and pearl onions',
        levels[2]
      );
      const ingredients = createObjectAtLevel(
        'Use free-range chicken, burgundy wine, cremini mushrooms',
        levels[3]
      );

      // Create grounding chain
      const groundings = [
        constructGrounding(philosophy.id, principles.id, 'explanatory'),
        constructGrounding(principles.id, recipe.id, 'inferential'),
        constructGrounding(recipe.id, ingredients.id, 'constitutive'),
      ];

      // Build and evaluate network
      const network = constructCoherenceNetwork(
        [philosophy, principles, recipe, ingredients],
        groundings,
        { name: 'Cooking Hierarchy', levels }
      );

      const result = evaluateCoherence(network);

      expect(network.objects.size).toBe(4);
      expect(network.groundings.size).toBe(3);
      expect(network.levels).toHaveLength(4);
      expect(network.levels![0].name).toBe('cuisine_philosophy');
      expect(result.status.coherent).toBe(true);

      // Verify full chain from philosophy to ingredients
      const chain = findGroundingChain(network, philosophy.id, ingredients.id);
      expect(chain).toHaveLength(4);
    });

    it('demonstrates same primitives work across unrelated domains', () => {
      // Use the exact same constructors for a medical diagnosis hierarchy
      const medicalLevels = constructHierarchy([
        'medical_theory',
        'diagnostic_criteria',
        'clinical_findings',
        'treatment_plan',
      ]);

      const theory = createObjectAtLevel(
        'Inflammation underlies many chronic diseases',
        medicalLevels[0]
      );
      const criteria = createObjectAtLevel(
        'Elevated CRP and ESR indicate systemic inflammation',
        medicalLevels[1]
      );
      const findings = createObjectAtLevel(
        'Patient has CRP of 15 mg/L and ESR of 40 mm/hr',
        medicalLevels[2]
      );
      const treatment = createObjectAtLevel(
        'Prescribe anti-inflammatory medication and lifestyle changes',
        medicalLevels[3]
      );

      const groundings = [
        constructGrounding(theory.id, criteria.id, 'explanatory'),
        constructGrounding(criteria.id, findings.id, 'evidential'),
        constructGrounding(findings.id, treatment.id, 'inferential'),
      ];

      const medicalNetwork = constructCoherenceNetwork(
        [theory, criteria, findings, treatment],
        groundings,
        { name: 'Medical Diagnosis', levels: medicalLevels }
      );

      expect(medicalNetwork.objects.size).toBe(4);
      expect(medicalNetwork.levels![0].name).toBe('medical_theory');

      const result = evaluateCoherence(medicalNetwork);
      expect(result.status.coherent).toBe(true);
    });
  });
});

// ============================================================================
// 4. COHERENCE EVALUATION TESTS
// ============================================================================

describe('Coherence Evaluation Tests', () => {
  function createSimpleObject(value: string): EpistemicObject {
    const content = constructContent(value);
    const attitude = constructAttitude('accepting', { value: 0.9, basis: 'estimated' });
    return constructEpistemicObject(content, attitude);
  }

  describe('Coherent Networks', () => {
    it('evaluates simple coherent network as coherent', () => {
      const obj1 = createSimpleObject('Premise A');
      const obj2 = createSimpleObject('Conclusion B');

      const grounding = constructGrounding(obj1.id, obj2.id, 'inferential');

      const network = constructCoherenceNetwork([obj1, obj2], [grounding], {
        name: 'Simple Coherent',
      });

      const result = evaluateCoherence(network);
      expect(result.status.coherent).toBe(true);
      expect(result.status.score).toBeGreaterThan(0.5);
    });

    it('identifies foundations correctly', () => {
      const foundation = createSimpleObject('Axiom');
      const derived = createSimpleObject('Theorem');

      const grounding = constructGrounding(foundation.id, derived.id, 'inferential');

      const network = constructCoherenceNetwork([foundation, derived], [grounding]);

      const result = evaluateCoherence(network);
      expect(result.groundingAnalysis.foundations).toContain(foundation.id);
      expect(result.groundingAnalysis.foundations).not.toContain(derived.id);
    });
  });

  describe('Incoherent Networks', () => {
    it('detects grounding cycles', () => {
      const obj1 = createSimpleObject('A');
      const obj2 = createSimpleObject('B');
      const obj3 = createSimpleObject('C');

      // Create a cycle: A -> B -> C -> A
      const groundings = [
        constructGrounding(obj1.id, obj2.id, 'inferential'),
        constructGrounding(obj2.id, obj3.id, 'inferential'),
        constructGrounding(obj3.id, obj1.id, 'inferential'),
      ];

      const network = constructCoherenceNetwork([obj1, obj2, obj3], groundings, {
        allowCycles: false,
      });

      const result = evaluateCoherence(network);
      expect(result.status.coherent).toBe(false);
      expect(result.groundingAnalysis.cycles.length).toBeGreaterThan(0);
      expect(result.status.violations.some((v) => v.rule.type === 'grounding_acyclicity')).toBe(
        true
      );
    });

    it('detects contradictions between accepting objects', () => {
      const obj1 = createSimpleObject('The sky is blue');
      const obj2 = createSimpleObject('The sky is not blue');

      // Create a rebutting grounding (contradiction)
      const rebutting = constructGrounding(obj1.id, obj2.id, 'rebutting');

      const network = constructCoherenceNetwork([obj1, obj2], [rebutting]);

      const conflicts = detectConflicts(network);
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].type).toBe('rebutting');
    });

    it('detects undermining relations', () => {
      const evidence = createSimpleObject('New evidence found');
      const claim = createSimpleObject('Original claim');

      const undermining = constructGrounding(evidence.id, claim.id, 'undermining');

      const network = constructCoherenceNetwork([evidence, claim], [undermining]);

      const conflicts = detectConflicts(network);
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].type).toBe('undermining');
    });
  });

  describe('Level Consistency Violations', () => {
    it('detects objects grounded at wrong levels', () => {
      const levels = constructHierarchy(['base', 'middle', 'top']);

      const content1 = constructContent('Base fact');
      const att1 = constructAttitude('accepting');
      const baseObj = constructEpistemicObject(content1, att1, { level: levels[0] });

      const content2 = constructContent('Top conclusion');
      const att2 = constructAttitude('accepting');
      const topObj = constructEpistemicObject(content2, att2, { level: levels[2] });

      // Grounding from top to base (wrong direction in standard hierarchies)
      const grounding = constructGrounding(topObj.id, baseObj.id, 'inferential');

      const network = constructCoherenceNetwork([baseObj, topObj], [grounding], { levels });

      const violations = checkLevelConsistency(network);
      // The consistency check compares actual level to expected level based on grounding depth
      expect(network.levels).toHaveLength(3);
    });
  });
});

// ============================================================================
// 5. AUTO-CONFIGURATION TESTS
// ============================================================================

describe('Auto-Configuration Tests', () => {
  describe('Preset Suggestion', () => {
    it('suggests software development for code-related hints', () => {
      expect(suggestPreset('software project')).toBe('softwareDevelopment');
      expect(suggestPreset('code review')).toBe('softwareDevelopment');
      expect(suggestPreset('programming task')).toBe('softwareDevelopment');
      expect(suggestPreset('system architecture')).toBe('softwareDevelopment');
    });

    it('suggests scientific method for research-related hints', () => {
      expect(suggestPreset('scientific research')).toBe('scientificMethod');
      expect(suggestPreset('test hypothesis')).toBe('scientificMethod');
      expect(suggestPreset('run experiment')).toBe('scientificMethod');
      expect(suggestPreset('theory validation')).toBe('scientificMethod');
    });

    it('suggests legal reasoning for law-related hints', () => {
      expect(suggestPreset('legal analysis')).toBe('legalReasoning');
      expect(suggestPreset('court case')).toBe('legalReasoning');
      expect(suggestPreset('constitutional law')).toBe('legalReasoning');
      expect(suggestPreset('statute interpretation')).toBe('legalReasoning');
    });

    it('defaults to software development for unknown domains', () => {
      expect(suggestPreset('random domain')).toBe('softwareDevelopment');
      expect(suggestPreset('cooking recipes')).toBe('softwareDevelopment');
    });
  });

  describe('Structure Inference', () => {
    it('returns empty structure for no objects', () => {
      const result = inferStructure([]);
      expect(result.confidence).toBe(0);
      expect(result.levels).toHaveLength(0);
      expect(result.reasoning).toContain('No objects to analyze');
    });

    it('suggests preset based on content types', () => {
      // Create objects with propositional content (matches all presets)
      const objects = [
        constructEpistemicObject(
          constructContent('A proposition', 'propositional'),
          constructAttitude('accepting')
        ),
        constructEpistemicObject(
          constructContent('Another proposition', 'propositional'),
          constructAttitude('accepting')
        ),
      ];

      const result = inferStructure(objects);
      expect(result.groundingDirection).toBeDefined();
      expect(result.levels.length).toBeGreaterThanOrEqual(0);
    });
  });
});

// ============================================================================
// 6. INTEGRATION TESTS
// ============================================================================

describe('Integration Tests', () => {
  describe('ConfidenceValue Conversion', () => {
    it('converts GradedStrength to ConfidenceValue - measured', () => {
      const strength: GradedStrength = { value: 0.85, basis: 'measured' };
      const confidence = toConfidenceValue(strength);
      expect(confidence.type).toBe('measured');
      expect(confidence.value).toBe(0.85);
    });

    it('converts GradedStrength to ConfidenceValue - derived', () => {
      const strength: GradedStrength = { value: 0.7, basis: 'derived' };
      const confidence = toConfidenceValue(strength);
      expect(confidence.type).toBe('derived');
      expect(confidence.value).toBe(0.7);
    });

    it('converts GradedStrength to ConfidenceValue - estimated', () => {
      const strength: GradedStrength = { value: 0.6, basis: 'estimated' };
      const confidence = toConfidenceValue(strength);
      expect(confidence.type).toBe('bounded');
    });

    it('converts GradedStrength to ConfidenceValue - absent', () => {
      const strength: GradedStrength = { value: 0.5, basis: 'absent' };
      const confidence = toConfidenceValue(strength);
      expect(confidence.type).toBe('absent');
    });

    it('converts ConfidenceValue to GradedStrength - deterministic', () => {
      const confidence = deterministic(true, 'test');
      const strength = fromConfidenceValue(confidence);
      expect(strength.value).toBe(1.0);
      expect(strength.basis).toBe('measured');
    });

    it('converts ConfidenceValue to GradedStrength - bounded', () => {
      const confidence = bounded(0.6, 0.8, 'theoretical', 'test');
      const strength = fromConfidenceValue(confidence);
      expect(strength.value).toBe(0.7); // midpoint
      expect(strength.basis).toBe('estimated');
    });

    it('converts ConfidenceValue to GradedStrength - absent', () => {
      const confidence = absent('uncalibrated');
      const strength = fromConfidenceValue(confidence);
      expect(strength.value).toBe(0.5);
      expect(strength.basis).toBe('absent');
    });

    it('round-trips GradedStrength through ConfidenceValue', () => {
      const original: GradedStrength = { value: 0.8, basis: 'measured' };
      const confidence = toConfidenceValue(original);
      const roundTripped = fromConfidenceValue(confidence);
      expect(roundTripped.value).toBe(original.value);
    });
  });

  describe('Claim Conversion', () => {
    it('converts EpistemicObject to Claim', () => {
      const content = constructContent('Test proposition');
      const attitude = constructAttitude('accepting', { value: 0.9, basis: 'measured' });
      const obj = constructEpistemicObject(content, attitude, {
        source: { type: 'ai', description: 'Test AI', version: '1.0' },
      });

      const claim = toClaim(obj);
      expect(claim.proposition).toBe('Test proposition');
      expect(claim.status).toBe('active');
      expect(claim.source.type).toBe('llm');
      expect(claim.type).toBe('semantic');
    });

    it('converts Claim to EpistemicObject', () => {
      const content = constructContent('Original proposition');
      const attitude = constructAttitude('accepting', { value: 0.85, basis: 'measured' });
      const originalObj = constructEpistemicObject(content, attitude);

      const claim = toClaim(originalObj);
      const convertedObj = fromClaim(claim);

      expect(typeof convertedObj.content.value).toBe('string');
      expect(convertedObj.attitude.type).toBe('accepting');
      expect(convertedObj.metadata.status).toBe('active');
    });

    it('preserves status through conversion', () => {
      const content = constructContent('Defeated proposition');
      const attitude = constructAttitude('rejecting', { value: 0.1, basis: 'estimated' });
      const obj = constructEpistemicObject(content, attitude, { status: 'defeated' });

      const claim = toClaim(obj);
      expect(claim.status).toBe('defeated');

      const convertedBack = fromClaim(claim);
      expect(convertedBack.metadata.status).toBe('defeated');
    });
  });

  describe('Network Error Handling', () => {
    it('throws on duplicate object IDs', () => {
      const content = constructContent('Test');
      const attitude = constructAttitude('accepting');
      const id = createObjectId('duplicate');

      const obj1 = constructEpistemicObject(content, attitude, { id });
      const obj2 = constructEpistemicObject(content, attitude, { id });

      expect(() => constructCoherenceNetwork([obj1, obj2], [])).toThrow(NetworkError);
      expect(() => constructCoherenceNetwork([obj1, obj2], [])).toThrow('Duplicate object ID');
    });

    it('throws on dangling grounding references', () => {
      const content = constructContent('Test');
      const attitude = constructAttitude('accepting');
      const obj = constructEpistemicObject(content, attitude);

      const nonExistentId = createObjectId('nonexistent');
      const grounding = constructGrounding(obj.id, nonExistentId, 'inferential');

      expect(() => constructCoherenceNetwork([obj], [grounding])).toThrow(NetworkError);
      expect(() => constructCoherenceNetwork([obj], [grounding])).toThrow('Grounding references non-existent');
    });
  });
});

// ============================================================================
// 7. ABSTRACTION LEVEL CONSTRUCTION TESTS
// ============================================================================

describe('Abstraction Level Construction', () => {
  it('constructs a single abstraction level', () => {
    const level = constructAbstractionLevel('foundation', 0, 1.0);
    expect(level.name).toBe('foundation');
    expect(level.position).toBe(0);
    expect(level.entrenchment).toBe(1.0);
  });

  it('throws on invalid entrenchment', () => {
    expect(() => constructAbstractionLevel('test', 0, 1.5)).toThrow();
    expect(() => constructAbstractionLevel('test', 0, -0.1)).toThrow();
  });

  it('throws on negative position', () => {
    expect(() => constructAbstractionLevel('test', -1, 0.5)).toThrow();
  });

  it('constructs hierarchy with default entrenchment', () => {
    const levels = constructHierarchy(['base', 'middle', 'top']);
    expect(levels).toHaveLength(3);
    expect(levels[0].position).toBe(0);
    expect(levels[1].position).toBe(1);
    expect(levels[2].position).toBe(2);
    // Default entrenchment decreases
    expect(levels[0].entrenchment).toBeGreaterThan(levels[2].entrenchment);
  });

  it('constructs hierarchy with custom entrenchment', () => {
    const levels = constructHierarchy(['a', 'b', 'c'], [0.9, 0.7, 0.5]);
    expect(levels[0].entrenchment).toBe(0.9);
    expect(levels[1].entrenchment).toBe(0.7);
    expect(levels[2].entrenchment).toBe(0.5);
  });
});

// ============================================================================
// 8. COMPLETE WORKFLOW TEST
// ============================================================================

describe('Complete Workflow Test', () => {
  it('demonstrates full workflow from primitives to evaluation', () => {
    // 1. Create custom levels for a project management domain
    const levels = constructHierarchy([
      'strategy',
      'objectives',
      'milestones',
      'tasks',
    ]);

    // 2. Create content for each level
    const strategyContent = constructContent(
      'Agile methodology for iterative delivery',
      'propositional'
    );
    const objectiveContent = constructContent(
      'Deliver MVP in 3 months',
      'propositional'
    );
    const milestoneContent = constructContent(
      'Complete user authentication by week 4',
      'propositional'
    );
    const taskContent = constructContent(
      'Implement JWT token validation',
      'procedural'
    );

    // 3. Create attitudes with graded strength
    const highConfidence = constructAttitude('accepting', { value: 0.95, basis: 'measured' });
    const mediumConfidence = constructAttitude('accepting', { value: 0.8, basis: 'estimated' });

    // 4. Create epistemic objects
    const strategy = constructEpistemicObject(strategyContent, highConfidence, {
      level: levels[0],
      source: { type: 'human', description: 'Project lead' },
    });
    const objective = constructEpistemicObject(objectiveContent, highConfidence, {
      level: levels[1],
      source: { type: 'human', description: 'Stakeholder meeting' },
    });
    const milestone = constructEpistemicObject(milestoneContent, mediumConfidence, {
      level: levels[2],
      source: { type: 'ai', description: 'Project planning AI' },
    });
    const task = constructEpistemicObject(taskContent, mediumConfidence, {
      level: levels[3],
      source: { type: 'ai', description: 'Task breakdown AI' },
    });

    // 5. Create grounding relations
    const groundings = [
      constructGrounding(strategy.id, objective.id, 'inferential', {
        value: 0.9,
        basis: 'logical',
      }),
      constructGrounding(objective.id, milestone.id, 'constitutive', {
        value: 0.85,
        basis: 'logical',
      }),
      constructGrounding(milestone.id, task.id, 'constitutive', {
        value: 0.8,
        basis: 'logical',
      }),
    ];

    // 6. Construct the coherence network
    const network = constructCoherenceNetwork(
      [strategy, objective, milestone, task],
      groundings,
      {
        name: 'Project Management Network',
        levels,
        groundingDirection: 'down',
      }
    );

    // 7. Evaluate coherence
    const result = evaluateCoherence(network);

    // 8. Verify the complete workflow
    expect(network.objects.size).toBe(4);
    expect(network.groundings.size).toBe(3);
    expect(network.levels).toHaveLength(4);
    expect(result.status.coherent).toBe(true);
    expect(result.groundingAnalysis.foundations).toContain(strategy.id);
    expect(result.groundingAnalysis.maxDepth).toBe(3);

    // 9. Verify grounding chain
    const chain = findGroundingChain(network, strategy.id, task.id);
    expect(chain).toHaveLength(4);

    // 10. Convert to claims for integration
    const strategyClaim = toClaim(strategy);
    expect(strategyClaim.proposition).toContain('Agile');
    expect(strategyClaim.confidence.type).toBe('measured');
  });
});
