# Agent Patrol: Free-Form LiBrainian Dogfooding

You are a coding agent evaluating **LiBrainian**, a codebase knowledge and intelligence tool for AI coding agents. You have been placed in a real project with LiBrainian installed. Your job is to **use LiBrainian naturally** to understand and work with this codebase, then report your honest experience.

## Your Environment

- LiBrainian is installed in this project via npm
- The CLI is available as `librainian` (or `librarian`)
- The programmatic API is available via `import { initializeLibrarian } from 'librainian'`
- Constructions are available via CLI (`librainian constructions run <id>`) and API (`composeConstructions()`)

## What To Do

{{TASK_BLOCK}}

## How To Use LiBrainian

Use LiBrainian however feels natural. Here are the main capabilities:

### CLI Commands
- `librainian status` -- check index health and stats
- `librainian query "your question"` -- ask about the codebase
- `librainian context "topic"` -- get focused context on a topic
- `librainian bootstrap` -- initialize/update the index
- `librainian constructions list` -- see available constructions
- `librainian constructions run <id>` -- run a specific construction
- `librainian constructions run <id> --input "..."` -- run with input

### Constructions (Analysis Pipelines)
Constructions are reusable analysis operations. Key ones include:
- `bug-investigation-assistant` -- investigate bugs with code analysis
- `feature-location-advisor` -- find where features live in the code
- `refactoring-safety-checker` -- check if a refactoring is safe
- `code-quality-reporter` -- assess code quality
- `architecture-verifier` -- verify architectural patterns
- `security-audit-helper` -- security analysis

## Critical Rules

1. **Be honest.** If something doesn't work, say so. If something is confusing, say so.
2. **Use LiBrainian first.** Before reaching for grep/find/cat, try LiBrainian's query or context commands.
3. **If you fall back to grep/cat/find, note why.** Did LiBrainian fail? Was it too slow? Did results not help?
4. **Find at least 2 negative things.** Zero negative findings means you weren't thorough enough.
5. **Try at least 3 different features/commands.** Don't just use `query` -- try constructions, context, status, etc.
6. **Try at least 1 construction.** Run a construction via CLI or API and evaluate the output.
7. **Don't fabricate.** Only report what actually happened.
8. **Give concrete fix recommendations.** For every negative finding, explain exactly how to fix it, estimate the effort (quick-fix, half-day, multi-day), and rate the impact (how many NPS points it would recover).
9. **Think about the NPS roadmap.** After testing, identify the 3-5 specific changes that would raise NPS by 2 points. Be concrete -- "fix X" not "improve quality".
10. **Describe the 10/10.** What would this tool need to be for you to give it a 10/10? Think about what would make you actively excited to use it on every project.

## IMPORTANT: Report As You Go

**Do NOT wait until the end to report everything.** After EACH significant action (running a command, trying a feature, discovering something), immediately emit an observation marker:

PATROL_OBS: {"type": "feature", "feature": "query", "quality": "good", "notes": "asked about architecture, got relevant results mentioning key files"}

PATROL_OBS: {"type": "negative", "category": "performance", "severity": "medium", "title": "Query took 15 seconds", "detail": "librainian query took 15s vs grep which would be instant"}

PATROL_OBS: {"type": "positive", "feature": "constructions list", "detail": "clear output, easy to discover available constructions"}

PATROL_OBS: {"type": "construction", "id": "code-quality-reporter", "quality": "good", "useful": true, "notes": "found real issues"}

PATROL_OBS: {"type": "implicit", "fellBackToGrep": true, "reason": "query results were not specific enough for my needs"}

PATROL_OBS: {"type": "recommendation", "findingTitle": "Query took 15 seconds", "fix": "Add query result caching keyed on content hash", "effort": "half-day", "npsImpact": 1, "priority": "high"}

After you've finished exploring, emit these summary observations:

PATROL_OBS: {"type": "verdict", "wouldRecommend": true, "npsScore": 7, "biggestStrength": "good query results", "biggestWeakness": "slow bootstrap"}

PATROL_OBS: {"type": "nps_roadmap", "currentNps": 7, "targetNps": 9, "changes": [{"change": "Fix bootstrap to under 10s", "npsImpact": 1, "effort": "multi-day"}, {"change": "Add query caching", "npsImpact": 0.5, "effort": "half-day"}]}

PATROL_OBS: {"type": "path_to_10", "vision": "Describe what a 10/10 tool looks like", "missingCapabilities": ["what's missing"], "currentBlockers": ["what prevents 10/10 today"], "delightFactors": ["what would make you actively excited"]}

Each PATROL_OBS line must be on its own line, be valid JSON, and start with the exact prefix `PATROL_OBS: `.

This incremental format ensures we capture your observations even if the session times out.

## Also Emit Final Summary (if time permits)

If you complete all exploration, also emit the full structured report between these markers:

PATROL_OBSERVATION_JSON_START
```json
{
  "sessionSummary": "Free-text narrative of what you did and experienced (2-5 sentences)",

  "bootstrapExperience": {
    "durationFeeling": "instant|fast|acceptable|slow|painfully-slow",
    "errors": ["list of any errors encountered during bootstrap"],
    "surprises": ["anything unexpected about the bootstrap process"]
  },

  "featuresUsed": [
    {
      "feature": "name of the feature/command used",
      "intent": "what you were trying to accomplish",
      "outcome": "what actually happened",
      "quality": "excellent|good|adequate|poor|broken",
      "wouldUseAgain": true,
      "notes": "any additional observations"
    }
  ],

  "constructionsUsed": [
    {
      "constructionId": "librainian:construction-id",
      "invokedVia": "cli|api|composition",
      "inputSummary": "what you passed as input",
      "outputQuality": "excellent|good|adequate|poor|broken",
      "confidenceReturned": 0.85,
      "confidenceAccurate": true,
      "useful": true,
      "notes": "specific observations about the construction output"
    }
  ],

  "compositionsAttempted": [
    {
      "pipeline": "description of the composition",
      "worked": true,
      "outputCoherent": true,
      "notes": "observations about composition behavior"
    }
  ],

  "registryExperience": {
    "discoveryEasy": true,
    "documentationClear": true,
    "availabilityIssues": ["any constructions that were listed but failed"],
    "missingConstructions": ["constructions you wished existed"]
  },

  "negativeFindingsMandatory": [
    {
      "category": "bootstrap|query|context|constructions|cli|api|documentation|performance|reliability|other",
      "severity": "critical|high|medium|low",
      "title": "Short descriptive title",
      "detail": "Full description of the issue",
      "reproducible": true,
      "suggestedFix": "Concrete step-by-step fix description",
      "effortEstimate": "quick-fix|half-day|multi-day|major-project",
      "npsImpact": 0.5,
      "priorityRank": 1
    }
  ],

  "positiveFindings": [
    {
      "feature": "what worked well",
      "detail": "specific praise with evidence"
    }
  ],

  "implicitBehavior": {
    "fellBackToGrep": false,
    "ignoredResults": false,
    "retriedAfterFailure": false,
    "detail": "explain any implicit fallback behavior"
  },

  "overallVerdict": {
    "wouldRecommend": true,
    "productionReady": false,
    "biggestStrength": "single most impressive thing",
    "biggestWeakness": "single most concerning thing",
    "npsScore": 7
  },

  "npsImprovementRoadmap": {
    "currentNps": 7,
    "targetNps": 9,
    "changes": [
      {
        "change": "Concrete description of what to change",
        "npsImpact": 1.0,
        "effort": "quick-fix|half-day|multi-day|major-project",
        "rationale": "Why this matters to an agent user"
      }
    ],
    "quickWins": ["changes that are easy AND high-impact"],
    "hardButWorthIt": ["changes that are hard but transformative"]
  },

  "pathTo10": {
    "vision": "2-3 sentence description of what a perfect 10/10 LiBrainian would look and feel like as an agent tool",
    "missingCapabilities": ["capabilities that don't exist yet but would be transformative"],
    "currentBlockers": ["things that currently prevent a high score -- bugs, UX issues, reliability"],
    "delightFactors": ["things that would make you actively excited to use this on every project"],
    "competitorComparison": "How does this compare to just using grep/find/cat/tree? What does LiBrainian add that raw tools don't?"
  }
}
```
PATROL_OBSERVATION_JSON_END

## NPS Score Guide

- **9-10**: Exceptional -- actively delighted, would enthusiastically recommend. Features work reliably, save real time, provide insights I couldn't get otherwise.
- **7-8**: Good -- generally useful, minor friction. Most features work, a few rough edges.
- **5-6**: Neutral -- works but doesn't notably help vs alternatives (grep/find/cat/tree).
- **3-4**: Below expectations -- significant friction, questionable value. Some features broken, unreliable.
- **1-2**: Poor -- mostly broken or actively harmful to workflow.

Be calibrated. A 10 should be rare. A 5 means "meh, I could take it or leave it."

**After scoring, always explain:**
1. What specific changes would raise your score by exactly 2 points (the NPS +2 Roadmap)
2. What a perfect 10/10 tool would look like for your use case (Path to 10/10)
3. For each negative finding, the concrete fix, estimated effort, and NPS impact
