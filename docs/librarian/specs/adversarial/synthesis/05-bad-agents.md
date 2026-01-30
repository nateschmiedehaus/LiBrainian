# Part 5: Handling Bad Agents and Bad Inputs

[Back to Index](./index.md) | [Previous: Use Cases](./04-use-cases.md) | [Next: Course Correction](./06-course-correction.md)

---

## 5.1 Bad Agentic Logic Detection

**Problem**: Agents make incorrect inferences, leading to wrong conclusions.

**Detection Mechanism**:

```typescript
interface InferenceAudit {
  premise: EpistemicObject[];
  conclusion: EpistemicObject;
  inferenceRule: string;
  validity: 'valid' | 'invalid' | 'questionable';
  issues: string[];
}

function auditInference(
  premises: EpistemicObject[],
  conclusion: EpistemicObject,
  claimedRule: string
): InferenceAudit {
  const issues: string[] = [];

  // Check 1: Are premises grounded?
  for (const premise of premises) {
    const eval = evaluateObject(premise);
    if (eval.groundingStatus === 'ungrounded') {
      issues.push(`Premise "${premise.id}" is ungrounded - inference from ungrounded premises`);
    }
  }

  // Check 2: Does conclusion follow from premises?
  const impliedContent = deriveContent(premises, claimedRule);
  if (!contentMatches(impliedContent, conclusion.content)) {
    issues.push(`Conclusion does not follow from premises via ${claimedRule}`);
  }

  // Check 3: Is the inference rule valid for these premise types?
  if (!ruleApplicable(claimedRule, premises)) {
    issues.push(`Rule ${claimedRule} not applicable to these premise types`);
  }

  // Check 4: Are there defeaters for the inference?
  const defeaters = findDefeaters(premises, conclusion);
  if (defeaters.length > 0) {
    issues.push(`Inference defeated by: ${defeaters.map(d => d.id).join(', ')}`);
  }

  return {
    premise: premises,
    conclusion,
    inferenceRule: claimedRule,
    validity: issues.length === 0 ? 'valid' :
              issues.some(i => i.includes('does not follow')) ? 'invalid' : 'questionable',
    issues
  };
}
```

**Common Bad Logic Patterns**:

```
PATTERN 1: Affirming the Consequent
  Agent claims: "If A then B. B is true. Therefore A."
  Detection: Check inference rule validity

PATTERN 2: Hasty Generalization
  Agent claims: "X was true in cases 1,2,3. Therefore X is always true."
  Detection: Check if conclusion.scope > premises.scope

PATTERN 3: False Cause
  Agent claims: "A happened before B. Therefore A caused B."
  Detection: Check if grounding type is 'causal' without causal evidence

PATTERN 4: Circular Reasoning
  Agent claims: "A because B. B because A."
  Detection: findGroundingCycles(network)
```

---

## 5.2 Sloppiness Detection

**Problem**: Agents take shortcuts, miss details, skip verification.

**Detection Mechanisms**:

```typescript
interface SloppinessIndicators {
  unverifiedClaims: ObjectId[];
  weakGrounding: ObjectId[];
  missingSteps: string[];
  incompleteAnalysis: string[];
}

function detectSloppiness(
  network: CoherenceNetwork,
  expectedWorkflow: string[]
): SloppinessIndicators {
  const indicators: SloppinessIndicators = {
    unverifiedClaims: [],
    weakGrounding: [],
    missingSteps: [],
    incompleteAnalysis: []
  };

  // Check 1: Claims without sufficient grounding
  for (const [id, obj] of network.objects) {
    const eval = evaluateObject(obj);
    if (eval.groundingStatus === 'ungrounded' &&
        obj.attitude.type === 'accepting') {
      indicators.unverifiedClaims.push(id);
    }
    if (eval.effectiveStrength < 0.5 &&
        obj.attitude.type === 'accepting' &&
        (obj.attitude.strength?.value ?? 0) > 0.7) {
      // Claims high confidence but has weak grounding
      indicators.weakGrounding.push(id);
    }
  }

  // Check 2: Expected workflow steps missing
  const performedSteps = extractWorkflowSteps(network);
  for (const expected of expectedWorkflow) {
    if (!performedSteps.includes(expected)) {
      indicators.missingSteps.push(expected);
    }
  }

  // Check 3: Incomplete analysis
  const diagnosticObjects = network.objects.values()
    .filter(o => o.content.contentType === 'diagnostic');

  for (const diag of diagnosticObjects) {
    // Every diagnosis should have verification
    const hasVerification = Array.from(network.groundings.values())
      .some(g => g.from === diag.id && g.type === 'evidential');
    if (!hasVerification) {
      indicators.incompleteAnalysis.push(
        `Diagnosis "${diag.id}" lacks verification evidence`
      );
    }
  }

  return indicators;
}
```

**Enforcement**:

```typescript
interface QualityGate {
  name: string;
  check: (network: CoherenceNetwork) => boolean;
  severity: 'block' | 'warn';
  remediation: string;
}

const QUALITY_GATES: QualityGate[] = [
  {
    name: 'no_unverified_claims',
    check: (n) => detectSloppiness(n, []).unverifiedClaims.length === 0,
    severity: 'block',
    remediation: 'Add grounding evidence for all claims'
  },
  {
    name: 'testing_performed',
    check: (n) => hasWorkflowStep(n, 'test_execution'),
    severity: 'block',
    remediation: 'Execute tests before marking complete'
  },
  {
    name: 'diagnosis_verified',
    check: (n) => detectSloppiness(n, []).incompleteAnalysis.length === 0,
    severity: 'warn',
    remediation: 'Add verification for each diagnosis'
  }
];

function enforceQualityGates(
  network: CoherenceNetwork
): { passed: boolean; failures: QualityGate[] } {
  const failures = QUALITY_GATES.filter(gate => !gate.check(network));
  const blockers = failures.filter(f => f.severity === 'block');
  return {
    passed: blockers.length === 0,
    failures
  };
}
```

---

## 5.3 Bad Prompt Handling

**Problem**: User provides vague, contradictory, or misleading instructions.

**Epistemic Approach**:

```typescript
interface PromptAnalysis {
  clarity: number;           // 0-1: How clear is the request?
  completeness: number;      // 0-1: Is enough information provided?
  consistency: boolean;      // Are requirements internally consistent?
  issues: PromptIssue[];
  clarifyingQuestions: string[];
}

interface PromptIssue {
  type: 'vague' | 'contradictory' | 'incomplete' | 'ambiguous';
  description: string;
  location?: string;
}

function analyzePrompt(prompt: string): PromptAnalysis {
  const requirements = extractRequirements(prompt);
  const issues: PromptIssue[] = [];
  const questions: string[] = [];

  // Check for vagueness
  const vagueTerms = ['somehow', 'maybe', 'kind of', 'something like'];
  for (const term of vagueTerms) {
    if (prompt.toLowerCase().includes(term)) {
      issues.push({
        type: 'vague',
        description: `Vague term "${term}" - needs specificity`
      });
      questions.push(`What specifically do you mean by "${term}"?`);
    }
  }

  // Check for contradictions
  const contradictions = findContradictoryRequirements(requirements);
  for (const [r1, r2] of contradictions) {
    issues.push({
      type: 'contradictory',
      description: `"${r1}" contradicts "${r2}"`
    });
    questions.push(`Requirements conflict: "${r1}" vs "${r2}". Which takes priority?`);
  }

  // Check for completeness
  const missingInfo = identifyMissingInformation(requirements);
  for (const missing of missingInfo) {
    issues.push({
      type: 'incomplete',
      description: `Missing: ${missing}`
    });
    questions.push(`Could you specify: ${missing}?`);
  }

  // Calculate scores
  const clarity = 1 - (issues.filter(i => i.type === 'vague').length * 0.2);
  const completeness = 1 - (missingInfo.length * 0.15);
  const consistency = contradictions.length === 0;

  return {
    clarity: Math.max(0, clarity),
    completeness: Math.max(0, completeness),
    consistency,
    issues,
    clarifyingQuestions: questions
  };
}
```

**Resolution Strategies**:

```typescript
async function handleBadPrompt(
  prompt: string,
  analysis: PromptAnalysis
): Promise<ResolvedPrompt> {

  if (analysis.clarity < 0.5) {
    // Too vague - must clarify
    return {
      status: 'needs_clarification',
      questions: analysis.clarifyingQuestions,
      proceedWith: null
    };
  }

  if (!analysis.consistency) {
    // Contradictory - must resolve
    return {
      status: 'contradictory',
      questions: analysis.clarifyingQuestions,
      proceedWith: null
    };
  }

  if (analysis.completeness < 0.7) {
    // Incomplete - can proceed with assumptions
    const assumptions = generateAssumptions(prompt, analysis);
    return {
      status: 'proceeding_with_assumptions',
      assumptions,
      proceedWith: enrichPrompt(prompt, assumptions)
    };
  }

  // Good enough to proceed
  return {
    status: 'ready',
    questions: [],
    proceedWith: prompt
  };
}
```

---

## 5.4 Bad Project Handling

**Problem**: Codebase is poorly structured, undocumented, inconsistent.

**Minimum Viable Epistemic Grounding**:

```typescript
interface MinimalProjectUnderstanding {
  entryPoints: EpistemicObject[];      // How does it start?
  criticalPaths: EpistemicObject[];    // What are the main flows?
  knownRisks: EpistemicObject[];       // What's dangerous to touch?
  uncertainties: EpistemicObject[];    // What don't we understand?
}

function buildMinimalUnderstanding(
  project: ProjectFiles
): MinimalProjectUnderstanding {

  // Even the worst project has SOME grounded facts
  const entryPoints: EpistemicObject[] = [];

  // Look for entry points
  const entryPointPatterns = [
    'main.', 'index.', 'app.', 'server.', 'start.'
  ];
  for (const file of project.files) {
    for (const pattern of entryPointPatterns) {
      if (file.name.includes(pattern)) {
        entryPoints.push(constructEpistemicObject(
          constructContent(`Entry point: ${file.path}`, 'propositional'),
          constructAttitude('accepting', { value: 0.8, basis: 'measured' }),
          { source: { type: 'tool', description: 'pattern matching' } }
        ));
      }
    }
  }

  // Identify critical paths via dependency analysis
  const criticalPaths = identifyCriticalPaths(project);

  // Flag known risks (common code smells)
  const knownRisks = detectCodeSmells(project).map(smell =>
    constructEpistemicObject(
      constructContent(`Risk: ${smell.description}`, 'propositional'),
      constructAttitude('accepting', { value: 0.7, basis: 'estimated' }),
      { source: { type: 'tool', description: 'static analysis' } }
    )
  );

  // Catalog uncertainties explicitly
  const uncertainties = project.files
    .filter(f => f.complexity > threshold || f.documentation === null)
    .map(f => constructEpistemicObject(
      constructContent(`Uncertainty: ${f.path} not understood`, 'propositional'),
      constructAttitude('questioning'),  // Explicitly unknown
      { source: { type: 'tool', description: 'complexity analysis' } }
    ));

  return { entryPoints, criticalPaths, knownRisks, uncertainties };
}
```

**Graceful Degradation**:

```typescript
interface ConfidenceLevel {
  overall: number;
  perComponent: Map<string, number>;
}

function computeConfidenceLevel(
  understanding: MinimalProjectUnderstanding
): ConfidenceLevel {
  // More unknowns = lower confidence
  const unknownRatio = understanding.uncertainties.length /
    (understanding.entryPoints.length + understanding.criticalPaths.length);

  const overall = Math.max(0.3, 1 - unknownRatio);

  const perComponent = new Map<string, number>();
  // Components with more grounded objects have higher confidence
  // Components in uncertainties have lower confidence

  return { overall, perComponent };
}

function adjustRecommendationsForConfidence(
  recommendations: EvaluationRecommendation[],
  confidence: ConfidenceLevel
): EvaluationRecommendation[] {

  if (confidence.overall < 0.5) {
    // Low confidence - add safety recommendations
    recommendations.unshift({
      type: 'add_evidence',
      priority: 0,
      description: 'Project understanding is low. Gather more information before major changes.',
      affectedObjects: [],
      action: 'Run comprehensive analysis or consult with domain experts'
    });
  }

  // Increase priority of risky recommendations when confidence is low
  return recommendations.map(r => ({
    ...r,
    priority: confidence.overall < 0.5 ? r.priority + 1 : r.priority
  }));
}
```

---

[Back to Index](./index.md) | [Previous: Use Cases](./04-use-cases.md) | [Next: Course Correction](./06-course-correction.md)
