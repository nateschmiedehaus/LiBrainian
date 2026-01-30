/**
 * @fileoverview Inference Auditing System for Detecting Bad Agentic Logic
 *
 * Implements detection mechanisms for common logical fallacies and inference errors
 * that can occur in agentic reasoning. Based on the adversarial synthesis specification
 * for handling bad agents and inputs.
 *
 * Key capabilities:
 * - Detect logical fallacies (affirming consequent, hasty generalization, etc.)
 * - Audit inference chains for validity
 * - Check for circular reasoning and overgeneralization
 * - Provide actionable suggestions for fixing detected issues
 *
 * References:
 * - 05-bad-agents.md - Adversarial handling specification
 * - Pollock's defeater calculus for reasoning about inference validity
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import type { ContentType, Content, ObjectId } from './universal_coherence.js';
import { constructContent, createObjectId } from './universal_coherence.js';

// ============================================================================
// INFERENCE FALLACY ENUMERATION
// ============================================================================

/**
 * Common logical fallacies that can occur in agentic reasoning.
 * Each fallacy represents a specific pattern of invalid inference.
 */
export enum InferenceFallacy {
  /**
   * Affirming the consequent: "If P then Q, Q, therefore P"
   * Invalid because Q could have other causes besides P.
   */
  AFFIRMING_CONSEQUENT = 'affirming_consequent',

  /**
   * Denying the antecedent: "If P then Q, not P, therefore not Q"
   * Invalid because Q could be true for reasons other than P.
   */
  DENYING_ANTECEDENT = 'denying_antecedent',

  /**
   * Hasty generalization: "Few cases, therefore all cases"
   * Invalid due to insufficient sample size or biased sampling.
   */
  HASTY_GENERALIZATION = 'hasty_generalization',

  /**
   * False cause (post hoc): "A before B, therefore A caused B"
   * Invalid because temporal precedence doesn't imply causation.
   */
  FALSE_CAUSE = 'false_cause',

  /**
   * Circular reasoning (begging the question): "P because P"
   * Invalid because the conclusion is assumed in the premises.
   */
  CIRCULAR_REASONING = 'circular_reasoning',

  /**
   * Appeal to authority: "X said it, therefore true"
   * Invalid when the authority is not relevant or reliable.
   */
  APPEAL_TO_AUTHORITY = 'appeal_to_authority',

  /**
   * False dichotomy: "Only A or B, ignoring C"
   * Invalid because other alternatives may exist.
   */
  FALSE_DICHOTOMY = 'false_dichotomy',

  /**
   * Slippery slope: "A leads to Z without justification"
   * Invalid when the chain of consequences is not established.
   */
  SLIPPERY_SLOPE = 'slippery_slope',

  /**
   * Straw man: "Attacking misrepresentation"
   * Invalid because the actual argument is not addressed.
   */
  STRAW_MAN = 'straw_man',

  /**
   * Ad hominem: "Attacking source not argument"
   * Invalid because the source's character doesn't affect argument validity.
   */
  AD_HOMINEM = 'ad_hominem',
}

/**
 * Human-readable descriptions for each fallacy type.
 */
export const FALLACY_DESCRIPTIONS: Record<InferenceFallacy, string> = {
  [InferenceFallacy.AFFIRMING_CONSEQUENT]: 'If P then Q, Q, therefore P',
  [InferenceFallacy.DENYING_ANTECEDENT]: 'If P then Q, not P, therefore not Q',
  [InferenceFallacy.HASTY_GENERALIZATION]: 'Few cases, therefore all cases',
  [InferenceFallacy.FALSE_CAUSE]: 'A before B, therefore A caused B',
  [InferenceFallacy.CIRCULAR_REASONING]: 'P because P',
  [InferenceFallacy.APPEAL_TO_AUTHORITY]: 'X said it, therefore true',
  [InferenceFallacy.FALSE_DICHOTOMY]: 'Only A or B, ignoring C',
  [InferenceFallacy.SLIPPERY_SLOPE]: 'A leads to Z without justification',
  [InferenceFallacy.STRAW_MAN]: 'Attacking misrepresentation',
  [InferenceFallacy.AD_HOMINEM]: 'Attacking source not argument',
};

// ============================================================================
// INFERENCE STEP INTERFACE
// ============================================================================

/**
 * Valid inference rules that can be applied.
 */
export type InferenceRule =
  | 'modus_ponens' // If P then Q, P, therefore Q
  | 'modus_tollens' // If P then Q, not Q, therefore not P
  | 'hypothetical_syllogism' // If P then Q, if Q then R, therefore if P then R
  | 'disjunctive_syllogism' // P or Q, not P, therefore Q
  | 'induction' // Specific cases to general conclusion
  | 'abduction' // Best explanation inference
  | 'analogy' // Similar cases, similar conclusions
  | 'causal' // Cause-effect inference
  | 'statistical' // Statistical inference
  | 'deduction' // General to specific
  | 'unknown'; // Rule not specified

/**
 * Represents a single step in an inference chain.
 */
export interface InferenceStep {
  /** Unique identifier for this inference step */
  readonly id: string;

  /** The premises (supporting content) for this inference */
  readonly premises: Content[];

  /** The conclusion drawn from the premises */
  readonly conclusion: Content;

  /** The inference rule applied */
  readonly rule: InferenceRule;

  /** Confidence in this inference (0-1) */
  readonly confidence: number;

  /** Optional metadata about the inference */
  readonly metadata?: {
    /** Source of the inference (e.g., agent ID) */
    readonly source?: string;
    /** Timestamp of the inference */
    readonly timestamp?: string;
    /** Additional context */
    readonly context?: Record<string, unknown>;
  };
}

/**
 * Factory function to create an inference step.
 */
export function createInferenceStep(
  premises: Content[],
  conclusion: Content,
  rule: InferenceRule,
  confidence: number,
  metadata?: InferenceStep['metadata']
): InferenceStep {
  return {
    id: `inference_${randomUUID()}`,
    premises,
    conclusion,
    rule,
    confidence: Math.max(0, Math.min(1, confidence)),
    metadata,
  };
}

// ============================================================================
// INFERENCE AUDIT REPORT INTERFACE
// ============================================================================

/**
 * Severity levels for audit findings.
 */
export type AuditSeverity = 'critical' | 'major' | 'minor' | 'info';

/**
 * Report generated from auditing an inference step.
 */
export interface InferenceAuditReport {
  /** The inference that was audited */
  readonly inference: InferenceStep;

  /** Whether the inference is valid */
  readonly isValid: boolean;

  /** Fallacies detected in the inference */
  readonly fallaciesDetected: InferenceFallacy[];

  /** Specific weaknesses in the inference */
  readonly weaknesses: string[];

  /** Suggestions for improving the inference */
  readonly suggestions: string[];

  /** Overall severity of the issues found */
  readonly severity: AuditSeverity;

  /** Timestamp of the audit */
  readonly auditedAt: string;

  /** Confidence score for the audit findings (0-1) */
  readonly auditConfidence: number;
}

// ============================================================================
// DETECTION FUNCTIONS
// ============================================================================

/**
 * Pattern markers for detecting specific fallacy types.
 */
interface FallacyPattern {
  /** Keywords that suggest this fallacy */
  keywords: string[];
  /** Structural patterns to check */
  structuralCheck: (premises: Content[], conclusion: Content) => boolean;
}

const FALLACY_PATTERNS: Record<InferenceFallacy, FallacyPattern> = {
  [InferenceFallacy.AFFIRMING_CONSEQUENT]: {
    keywords: ['if', 'then', 'because', 'since', 'therefore'],
    structuralCheck: (premises, conclusion) => {
      // Check if premises contain conditional and conclusion matches consequent
      const premiseTexts = premises.map((p) => String(p.value).toLowerCase());
      const conclusionText = String(conclusion.value).toLowerCase();

      // Look for pattern: "if X then Y" in premises, and X is concluded when Y is given
      const hasConditional = premiseTexts.some(
        (p) => p.includes('if ') && p.includes(' then ')
      );
      if (!hasConditional) return false;

      // Check if conclusion is the antecedent being affirmed from consequent
      const conditionalPremise = premiseTexts.find(
        (p) => p.includes('if ') && p.includes(' then ')
      );
      if (!conditionalPremise) return false;

      const thenIndex = conditionalPremise.indexOf(' then ');
      const consequent = conditionalPremise.slice(thenIndex + 6).trim();
      const antecedent = conditionalPremise
        .slice(conditionalPremise.indexOf('if ') + 3, thenIndex)
        .trim();

      // If conclusion matches antecedent and a premise confirms consequent
      const conclusionMatchesAntecedent = conclusionText.includes(
        antecedent.slice(0, Math.min(10, antecedent.length))
      );
      const premiseConfirmsConsequent = premiseTexts.some(
        (p) =>
          !p.includes('if ') &&
          p.includes(consequent.slice(0, Math.min(10, consequent.length)))
      );

      return conclusionMatchesAntecedent && premiseConfirmsConsequent;
    },
  },

  [InferenceFallacy.DENYING_ANTECEDENT]: {
    keywords: ['if', 'not', 'then', 'therefore', 'since'],
    structuralCheck: (premises, conclusion) => {
      const premiseTexts = premises.map((p) => String(p.value).toLowerCase());
      const conclusionText = String(conclusion.value).toLowerCase();

      // Find the conditional premise
      const conditionalPremise = premiseTexts.find(
        (p) => p.includes('if ') && p.includes(' then ')
      );
      if (!conditionalPremise) return false;

      // Extract antecedent and consequent from "if A then B"
      const thenIndex = conditionalPremise.indexOf(' then ');
      const antecedent = conditionalPremise
        .slice(conditionalPremise.indexOf('if ') + 3, thenIndex)
        .trim();
      const consequent = conditionalPremise.slice(thenIndex + 6).trim();

      // Check for denying antecedent pattern:
      // - Premise denies the antecedent (not A)
      // - Conclusion denies the consequent (not B)
      // This is only a fallacy if the negation pattern matches antecedent denial

      // Check if another premise negates the antecedent
      const negatesAntecedent = premiseTexts.some(
        (p) =>
          !p.includes('if ') &&
          (p.includes('not ' + antecedent.slice(0, 8)) ||
           p.includes("n't " + antecedent.slice(0, 8)) ||
           p.includes(antecedent.slice(0, 8) + ' is not'))
      );

      // Check if conclusion negates the consequent (which would make it modus tollens, NOT denying antecedent)
      const conclusionNegatesConsequent =
        conclusionText.includes('not ' + consequent.slice(0, 8)) ||
        conclusionText.includes(consequent.slice(0, 8) + ' not') ||
        conclusionText.includes('no ' + consequent.slice(0, 8));

      // Check if a premise negates the consequent (this would be modus tollens setup)
      // Need to handle various negation patterns like "X is not Y", "not X", "X not"
      const consequentWords = consequent.split(/\s+/).filter(w => w.length > 2);
      const premiseNegatesConsequent = premiseTexts.some(
        (p) =>
          !p.includes('if ') &&
          p.includes('not') &&
          consequentWords.some(word => p.includes(word))
      );

      // Denying antecedent: premise denies antecedent, conclusion denies consequent
      // But NOT when premise also denies consequent (that's modus tollens)
      return negatesAntecedent && conclusionNegatesConsequent && !premiseNegatesConsequent;
    },
  },

  [InferenceFallacy.HASTY_GENERALIZATION]: {
    keywords: ['all', 'every', 'always', 'never', 'none', 'generally', 'usually'],
    structuralCheck: (premises, conclusion) => {
      const conclusionText = String(conclusion.value).toLowerCase();

      // Check if conclusion makes universal claim
      const universalQuantifiers = ['all ', 'every ', 'always', 'never', 'none ', 'no one'];
      const hasUniversalClaim = universalQuantifiers.some((q) => conclusionText.includes(q));

      // Check if premises are limited/specific
      const premiseCount = premises.length;
      const premiseTexts = premises.map((p) => String(p.value).toLowerCase());
      const areSpecificPremises = premiseTexts.some(
        (p) =>
          p.includes('example') ||
          p.includes('instance') ||
          p.includes('case') ||
          p.includes('observation') ||
          /\d+/.test(p) // Contains numbers suggesting specific cases
      );

      return hasUniversalClaim && (premiseCount < 3 || areSpecificPremises);
    },
  },

  [InferenceFallacy.FALSE_CAUSE]: {
    keywords: [
      'because',
      'caused',
      'led to',
      'resulted',
      'after',
      'before',
      'following',
      'due to',
    ],
    structuralCheck: (premises, conclusion) => {
      const premiseTexts = premises.map((p) => String(p.value).toLowerCase());
      const conclusionText = String(conclusion.value).toLowerCase();

      // Check for temporal language without causal mechanism
      const temporalWords = ['after', 'before', 'following', 'prior to', 'then'];
      const causalWords = ['caused', 'because', 'led to', 'resulted in', 'due to'];

      const hasTemporalPremise = premiseTexts.some((p) =>
        temporalWords.some((w) => p.includes(w))
      );
      const hasCausalConclusion = causalWords.some((w) => conclusionText.includes(w));

      // False cause if temporal premise leads to causal conclusion without mechanism
      const hasMechanismExplained = premiseTexts.some(
        (p) =>
          p.includes('mechanism') ||
          p.includes('how') ||
          p.includes('process') ||
          p.includes('through')
      );

      return hasTemporalPremise && hasCausalConclusion && !hasMechanismExplained;
    },
  },

  [InferenceFallacy.CIRCULAR_REASONING]: {
    keywords: ['because', 'since', 'therefore', 'thus'],
    structuralCheck: (premises, conclusion) => {
      const conclusionText = String(conclusion.value).toLowerCase().trim();
      const premiseTexts = premises.map((p) => String(p.value).toLowerCase().trim());

      // Check for exact or near-exact match
      const exactMatch = premiseTexts.some((p) => p === conclusionText);
      if (exactMatch) return true;

      // Check for high semantic similarity
      const highSimilarity = premiseTexts.some((p) => contentSimilarity(p, conclusionText) > 0.75);
      if (highSimilarity) return true;

      // Check for substring containment with substantial overlap
      const substringMatch = premiseTexts.some((p) => {
        const shorter = p.length < conclusionText.length ? p : conclusionText;
        const longer = p.length >= conclusionText.length ? p : conclusionText;
        // If shorter is substantial part of longer (at least 60% overlap)
        return shorter.length > 8 && longer.includes(shorter);
      });

      return substringMatch;
    },
  },

  [InferenceFallacy.APPEAL_TO_AUTHORITY]: {
    keywords: ['expert', 'said', 'according to', 'authority', 'famous', 'well-known'],
    structuralCheck: (premises, conclusion) => {
      const premiseTexts = premises.map((p) => String(p.value).toLowerCase());

      // Check for authority citation without substantive reasoning
      const authorityPatterns = [
        'said',
        'says',
        'according to',
        'claims',
        'stated',
        'expert',
        'authority',
        'famous',
        'renowned',
        'well-known',
      ];

      const citesAuthority = premiseTexts.some((p) =>
        authorityPatterns.some((pattern) => p.includes(pattern))
      );

      // Check if there's substantive evidence beyond authority
      const hasSubstantiveEvidence = premiseTexts.some(
        (p) =>
          p.includes('evidence') ||
          p.includes('study') ||
          p.includes('data') ||
          p.includes('experiment') ||
          p.includes('proof')
      );

      return citesAuthority && !hasSubstantiveEvidence;
    },
  },

  [InferenceFallacy.FALSE_DICHOTOMY]: {
    keywords: ['either', 'or', 'only', 'must', 'choice', 'option'],
    structuralCheck: (premises, conclusion) => {
      const premiseTexts = premises.map((p) => {
        const val = p.value;
        return typeof val === 'string' ? val.toLowerCase() : String(val).toLowerCase();
      });
      const conclusionVal = conclusion.value;
      const conclusionText = typeof conclusionVal === 'string' ? conclusionVal.toLowerCase() : String(conclusionVal).toLowerCase();

      // Check for binary framing - "either X or Y" pattern
      const eitherOrPattern = premiseTexts.some((p) =>
        (p.includes('either ') && p.includes(' or ')) ||
        (p.includes('only ') && p.includes(' or ')) ||
        p.includes('only two') ||
        p.includes('two options') ||
        p.includes('two choices')
      );

      // Check for forced choice language in premises
      const forcedChoicePattern = premiseTexts.some((p) =>
        p.includes('must ') ||
        p.includes('have to ') ||
        p.includes('no other')
      );

      // Check if conclusion picks one option
      const conclusionPicks =
        conclusionText.includes('must ') ||
        conclusionText.includes('must support') ||
        conclusionText.includes('therefore') ||
        conclusionText.includes('so ') ||
        conclusionText.includes('support') ||
        conclusionText.includes('against') ||
        conclusionText.includes('you ');

      return (eitherOrPattern || forcedChoicePattern) && conclusionPicks;
    },
  },

  [InferenceFallacy.SLIPPERY_SLOPE]: {
    keywords: ['will lead to', 'eventually', 'inevitably', 'next', 'soon'],
    structuralCheck: (premises, conclusion) => {
      const premiseTexts = premises.map((p) => String(p.value).toLowerCase());
      const conclusionText = String(conclusion.value).toLowerCase();

      // Check for chain of consequences
      const chainPatterns = [
        'will lead to',
        'leads to',
        'then',
        'next',
        'eventually',
        'inevitably',
        'soon',
      ];

      const hasPremiseChain = premiseTexts.some((p) =>
        chainPatterns.some((pattern) => p.includes(pattern))
      );

      const hasExtremeConclusion =
        conclusionText.includes('disaster') ||
        conclusionText.includes('catastroph') ||
        conclusionText.includes('destroy') ||
        conclusionText.includes('ruin') ||
        conclusionText.includes('end of') ||
        conclusionText.includes('worst');

      // Check for missing justification
      const hasJustification = premiseTexts.some(
        (p) =>
          p.includes('because') ||
          p.includes('evidence') ||
          p.includes('shows') ||
          p.includes('demonstrates')
      );

      return hasPremiseChain && hasExtremeConclusion && !hasJustification;
    },
  },

  [InferenceFallacy.STRAW_MAN]: {
    keywords: ['they say', 'claim', 'argument', 'position', 'believes'],
    structuralCheck: (premises, conclusion) => {
      const premiseTexts = premises.map((p) => String(p.value).toLowerCase());

      // Check for representation of opponent's view
      const representationPatterns = [
        'they say',
        'they claim',
        'they believe',
        'their argument',
        'their position',
        'opponents say',
      ];

      const hasRepresentation = premiseTexts.some((p) =>
        representationPatterns.some((pattern) => p.includes(pattern))
      );

      // Check for attack language
      const attackPatterns = [
        'wrong',
        'false',
        'absurd',
        'ridiculous',
        'clearly',
        'obviously',
        'stupid',
      ];

      const hasAttack = premiseTexts.some((p) =>
        attackPatterns.some((pattern) => p.includes(pattern))
      );

      return hasRepresentation && hasAttack;
    },
  },

  [InferenceFallacy.AD_HOMINEM]: {
    keywords: [
      'person',
      'character',
      'motivation',
      'bias',
      'corrupt',
      'liar',
      'cannot be trusted',
    ],
    structuralCheck: (premises, conclusion) => {
      const premiseTexts = premises.map((p) => String(p.value).toLowerCase());

      // Check for personal attacks
      const personalAttackPatterns = [
        'liar',
        'corrupt',
        'biased',
        'cannot be trusted',
        'hypocrite',
        'stupid',
        'ignorant',
        'fool',
        'idiot',
        'motivation',
        'self-interest',
        'character',
      ];

      const hasPersonalAttack = premiseTexts.some((p) =>
        personalAttackPatterns.some((pattern) => p.includes(pattern))
      );

      // Check if attack is used as evidence against argument
      const usedAsEvidence = premiseTexts.some(
        (p) =>
          p.includes('therefore') || p.includes('so') || p.includes('which means')
      );

      return hasPersonalAttack && usedAsEvidence;
    },
  },
};

/**
 * Compute a simple similarity score between two strings.
 */
function contentSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const aWordsAll = a.split(/\s+/);
  const bWordsAll = b.split(/\s+/);
  const aSet = new Set(aWordsAll);
  const bSet = new Set(bWordsAll);

  // Standard Jaccard similarity using all unique words
  const intersectionSize = [...aSet].filter(w => bSet.has(w)).length;
  const unionSize = new Set([...aSet, ...bSet]).size;

  if (unionSize === 0) return 0;

  const jaccardSimilarity = intersectionSize / unionSize;

  // For circular reasoning detection, also check if one is substantially contained in the other
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  if (longer.includes(shorter) && shorter.length > 15) {
    return Math.max(jaccardSimilarity, 0.9);
  }

  // For longer strings with many shared words, boost similarity
  // This helps catch paraphrased circular reasoning
  if (aWordsAll.length >= 5 && bWordsAll.length >= 5 && jaccardSimilarity > 0.6) {
    return Math.min(jaccardSimilarity * 1.2, 1.0);
  }

  return jaccardSimilarity;
}

/**
 * Check for circularity in premises and conclusion.
 *
 * @param premises - The premises of the inference
 * @param conclusion - The conclusion of the inference
 * @returns true if circular reasoning is detected
 */
export function checkCircularity(premises: Content[], conclusion: Content): boolean {
  if (premises.length === 0) return false;

  const conclusionText = String(conclusion.value).toLowerCase().trim();
  const premiseTexts = premises.map((p) => String(p.value).toLowerCase().trim());

  // Direct circularity: conclusion appears in premises
  for (const premiseText of premiseTexts) {
    if (premiseText === conclusionText) {
      return true;
    }

    // High similarity check
    if (contentSimilarity(premiseText, conclusionText) > 0.85) {
      return true;
    }

    // Substring containment for substantial strings
    if (
      premiseText.length > 15 &&
      conclusionText.length > 15 &&
      (premiseText.includes(conclusionText) || conclusionText.includes(premiseText))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check for overgeneralization in inference.
 *
 * @param premises - The premises of the inference
 * @param conclusion - The conclusion of the inference
 * @returns true if overgeneralization is detected
 */
export function checkOvergeneralization(premises: Content[], conclusion: Content): boolean {
  const conclusionText = String(conclusion.value).toLowerCase();

  // Universal quantifiers that suggest overgeneralization
  const universalQuantifiers = [
    'all ',
    'every ',
    'always',
    'never',
    'none ',
    'no one',
    'everyone',
    'everything',
    'nothing',
  ];

  const hasUniversalClaim = universalQuantifiers.some((q) => conclusionText.includes(q));

  if (!hasUniversalClaim) return false;

  // Check if premises support universal claim
  const premiseTexts = premises.map((p) => String(p.value).toLowerCase());

  // Specific/limited premises
  const limitedIndicators = [
    'some',
    'few',
    'example',
    'instance',
    'case',
    'observation',
    'one',
    'two',
    'three',
  ];

  const hasLimitedPremises = premiseTexts.some((p) =>
    limitedIndicators.some((indicator) => p.includes(indicator))
  );

  // Insufficient premise count for universal claim
  const insufficientPremises = premises.length < 5;

  return hasLimitedPremises || insufficientPremises;
}

/**
 * Detect all fallacies present in an inference step.
 *
 * @param step - The inference step to analyze
 * @returns Array of detected fallacies
 */
export function detectFallacy(step: InferenceStep): InferenceFallacy[] {
  const detected: InferenceFallacy[] = [];

  // Run all pattern checks
  for (const [fallacy, pattern] of Object.entries(FALLACY_PATTERNS)) {
    try {
      if (pattern.structuralCheck(step.premises, step.conclusion)) {
        detected.push(fallacy as InferenceFallacy);
      }
    } catch {
      // Ignore errors in pattern checking
      continue;
    }
  }

  // Additional specific checks
  if (checkCircularity(step.premises, step.conclusion)) {
    if (!detected.includes(InferenceFallacy.CIRCULAR_REASONING)) {
      detected.push(InferenceFallacy.CIRCULAR_REASONING);
    }
  }

  if (checkOvergeneralization(step.premises, step.conclusion)) {
    if (!detected.includes(InferenceFallacy.HASTY_GENERALIZATION)) {
      detected.push(InferenceFallacy.HASTY_GENERALIZATION);
    }
  }

  return detected;
}

/**
 * Generate a fix suggestion for a specific fallacy.
 *
 * @param fallacy - The fallacy to suggest a fix for
 * @param step - The inference step containing the fallacy
 * @returns A string describing how to fix the fallacy
 */
export function suggestFix(fallacy: InferenceFallacy, step: InferenceStep): string {
  const fixes: Record<InferenceFallacy, string> = {
    [InferenceFallacy.AFFIRMING_CONSEQUENT]:
      'Verify the causal direction. Consider alternative explanations for why Q might be true. Use modus ponens (affirm P to conclude Q) instead.',

    [InferenceFallacy.DENYING_ANTECEDENT]:
      'Consider that Q might be true for reasons other than P. Use modus tollens (deny Q to conclude not P) for valid reasoning.',

    [InferenceFallacy.HASTY_GENERALIZATION]:
      `Add more supporting evidence. Current premise count (${step.premises.length}) is insufficient for universal claims. Qualify the conclusion with "some" or "often" instead of "all" or "always".`,

    [InferenceFallacy.FALSE_CAUSE]:
      'Establish a causal mechanism. Consider confounding variables. Look for controlled studies or natural experiments that rule out alternative explanations.',

    [InferenceFallacy.CIRCULAR_REASONING]:
      'Provide independent evidence for the conclusion. Ensure premises do not assume what is being concluded.',

    [InferenceFallacy.APPEAL_TO_AUTHORITY]:
      'Add substantive evidence beyond authority citation. Verify the authority is relevant to the specific domain. Include methodology or data that supports the claim.',

    [InferenceFallacy.FALSE_DICHOTOMY]:
      'Consider additional alternatives. Question whether the options presented are truly exhaustive. Explicitly acknowledge and rule out other possibilities.',

    [InferenceFallacy.SLIPPERY_SLOPE]:
      'Justify each step in the causal chain. Provide evidence for why each consequence follows from the previous. Consider probabilistic language for uncertain connections.',

    [InferenceFallacy.STRAW_MAN]:
      'Represent the opposing argument accurately and charitably. Address the strongest version of the counterargument.',

    [InferenceFallacy.AD_HOMINEM]:
      'Focus on the argument itself rather than the source. Evaluate claims based on evidence and logic, not the characteristics of who made them.',
  };

  return fixes[fallacy];
}

// ============================================================================
// AUDIT FUNCTIONS
// ============================================================================

/**
 * Identify weaknesses in an inference step.
 */
function identifyWeaknesses(step: InferenceStep, fallacies: InferenceFallacy[]): string[] {
  const weaknesses: string[] = [];

  // Low confidence
  if (step.confidence < 0.5) {
    weaknesses.push(
      `Low confidence (${step.confidence.toFixed(2)}) suggests uncertain inference`
    );
  }

  // Insufficient premises
  if (step.premises.length === 0) {
    weaknesses.push('No premises provided - conclusion lacks any support');
  } else if (step.premises.length === 1 && step.rule === 'induction') {
    weaknesses.push('Single premise insufficient for inductive generalization');
  }

  // Unknown inference rule
  if (step.rule === 'unknown') {
    weaknesses.push('Inference rule not specified - validity cannot be verified');
  }

  // Rule-premise mismatches
  if (step.rule === 'modus_ponens' && step.premises.length < 2) {
    weaknesses.push('Modus ponens requires at least two premises (conditional and antecedent)');
  }

  if (step.rule === 'disjunctive_syllogism' && step.premises.length < 2) {
    weaknesses.push(
      'Disjunctive syllogism requires at least two premises (disjunction and negation)'
    );
  }

  // Fallacy-specific weaknesses
  for (const fallacy of fallacies) {
    weaknesses.push(`Contains ${fallacy}: ${FALLACY_DESCRIPTIONS[fallacy]}`);
  }

  return weaknesses;
}

/**
 * Determine the severity of audit findings.
 */
function determineSeverity(
  fallacies: InferenceFallacy[],
  weaknesses: string[],
  confidence: number
): AuditSeverity {
  // Critical: Major logical fallacies or no support
  const criticalFallacies = [
    InferenceFallacy.CIRCULAR_REASONING,
    InferenceFallacy.AFFIRMING_CONSEQUENT,
    InferenceFallacy.DENYING_ANTECEDENT,
  ];

  if (fallacies.some((f) => criticalFallacies.includes(f))) {
    return 'critical';
  }

  if (weaknesses.some((w) => w.includes('No premises provided'))) {
    return 'critical';
  }

  // Major: Significant reasoning errors
  const majorFallacies = [
    InferenceFallacy.HASTY_GENERALIZATION,
    InferenceFallacy.FALSE_CAUSE,
    InferenceFallacy.FALSE_DICHOTOMY,
  ];

  if (fallacies.some((f) => majorFallacies.includes(f))) {
    return 'major';
  }

  if (confidence < 0.3) {
    return 'major';
  }

  // Minor: Lesser issues
  if (fallacies.length > 0 || weaknesses.length > 2) {
    return 'minor';
  }

  if (confidence < 0.5 || weaknesses.length > 0) {
    return 'minor';
  }

  // Info: Only informational findings
  return 'info';
}

/**
 * Audit a single inference step for validity and issues.
 *
 * @param step - The inference step to audit
 * @returns A detailed audit report
 */
export function auditInference(step: InferenceStep): InferenceAuditReport {
  // Detect fallacies
  const fallaciesDetected = detectFallacy(step);

  // Identify weaknesses
  const weaknesses = identifyWeaknesses(step, fallaciesDetected);

  // Generate suggestions
  const suggestions = fallaciesDetected.map((f) => suggestFix(f, step));

  // Add general suggestions based on weaknesses
  if (step.premises.length < 2 && step.rule !== 'deduction') {
    suggestions.push('Consider adding additional supporting premises');
  }

  if (step.confidence < 0.7) {
    suggestions.push('Seek additional evidence to increase confidence');
  }

  // Determine validity
  const isValid = fallaciesDetected.length === 0 && step.premises.length > 0;

  // Determine severity
  const severity = determineSeverity(fallaciesDetected, weaknesses, step.confidence);

  // Calculate audit confidence based on how well patterns matched
  const auditConfidence = 0.7 + 0.3 * (fallaciesDetected.length > 0 ? 1 : 0);

  return {
    inference: step,
    isValid,
    fallaciesDetected,
    weaknesses,
    suggestions,
    severity,
    auditedAt: new Date().toISOString(),
    auditConfidence,
  };
}

/**
 * Audit a chain of inference steps.
 *
 * @param steps - The inference steps to audit
 * @returns An array of audit reports, one per step
 */
export function auditChain(steps: InferenceStep[]): InferenceAuditReport[] {
  const reports: InferenceAuditReport[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const report = auditInference(step);

    // Check for chain-specific issues
    if (i > 0) {
      const previousStep = steps[i - 1];
      const previousConclusion = String(previousStep.conclusion.value).toLowerCase();
      const currentPremises = step.premises.map((p) => String(p.value).toLowerCase());

      // Check if chain is properly connected
      const isConnected = currentPremises.some((p) =>
        contentSimilarity(p, previousConclusion) > 0.5
      );

      if (!isConnected) {
        const enhancedReport: InferenceAuditReport = {
          ...report,
          weaknesses: [...report.weaknesses, 'Inference chain gap: current step does not build on previous conclusion'],
          severity: report.severity === 'info' ? 'minor' : report.severity,
        };
        reports.push(enhancedReport);
        continue;
      }
    }

    reports.push(report);
  }

  // Check for chain-level circular reasoning
  if (steps.length > 1) {
    const firstPremises = steps[0].premises.map((p) => String(p.value).toLowerCase());
    const lastConclusion = String(steps[steps.length - 1].conclusion.value).toLowerCase();

    const chainCircular = firstPremises.some(
      (p) => contentSimilarity(p, lastConclusion) > 0.7
    );

    if (chainCircular) {
      // Mark all reports as part of circular chain
      return reports.map((r) => ({
        ...r,
        fallaciesDetected: r.fallaciesDetected.includes(InferenceFallacy.CIRCULAR_REASONING)
          ? r.fallaciesDetected
          : [...r.fallaciesDetected, InferenceFallacy.CIRCULAR_REASONING],
        weaknesses: [...r.weaknesses, 'Part of circular inference chain'],
        severity: 'critical' as AuditSeverity,
      }));
    }
  }

  return reports;
}

// ============================================================================
// HELPER FUNCTIONS FOR CREATING TEST CONTENT
// ============================================================================

/**
 * Create a content object from a string value.
 * Convenience function for testing.
 */
export function createTestContent(value: string, contentType?: ContentType): Content {
  return constructContent(value, contentType);
}

/**
 * Create a simple inference step from string premises and conclusion.
 * Convenience function for testing.
 */
export function createSimpleInferenceStep(
  premises: string[],
  conclusion: string,
  rule: InferenceRule = 'unknown',
  confidence: number = 0.7
): InferenceStep {
  return createInferenceStep(
    premises.map((p) => createTestContent(p)),
    createTestContent(conclusion),
    rule,
    confidence
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  contentSimilarity as _contentSimilarity, // Export for testing
  FALLACY_PATTERNS as _FALLACY_PATTERNS, // Export for testing
};
