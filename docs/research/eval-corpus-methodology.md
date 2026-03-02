# Eval Corpus Methodology: AST-Based Ground Truth Extraction

## Why AST-Based Ground Truth?

LiBrainian is a semantic codebase intelligence tool that uses LLMs for synthesis. Measuring its
quality against an LLM-generated corpus creates **circular evaluation**: the same LLMs that
generate synthetic repositories are also used to score responses against those repositories.
This inflates metrics artificially and provides no signal about real-world performance.

**The fix is non-negotiable**: ground truth must come from real external repositories, extracted
via deterministic AST analysis — not LLM generation.

---

## Corpus Selection Criteria

Repos are selected to minimize training contamination risk:

1. **Post-2024 creation date** — Repos created after common LLM training cutoffs are unlikely
   to appear in training data, reducing the risk that LiBrainian has "memorized" the answers.
2. **Low star count (< 500)** — High-popularity repos are more likely to have been included in
   LLM training corpora. We prefer obscure-but-real repos.
3. **Language diversity** — The corpus covers TypeScript, Python, Go, Rust, Java, Ruby, and
   other languages to test LiBrainian's polyglot capability.
4. **Clear module structure** — Repos with clear separation of concerns produce more verifiable
   AST facts (function boundaries, import relationships, class hierarchies).

The selected repos are documented in `state/benchmarks/corpus/external-repos.json` and the
expanded manifest in `eval-corpus/external-repos/manifest.json`.

---

## AST Extraction Process

Ground truth facts are extracted using:

- **`src/agents/ast_indexer.ts`** — Orchestrates AST-based indexing of source files
- **`src/agents/parsers/tree_sitter_parser.ts`** — tree-sitter parser for multi-language support

### Extracted Fact Types

| Fact Kind | AST Node Type | Example |
|-----------|--------------|---------|
| `function` | function_declaration, function_item (Rust), function_definition (Python) | `function main()` in `main.go` |
| `class` | class_declaration, class_definition | `class TokenExplorer` in `explorer.py` |
| `interface` | interface_declaration (TypeScript/Java) | `interface ScoreboardAPI` |
| `import` | import_statement, use_declaration (Rust), import_declaration (Java) | `import tiktoken` |
| `export` | export_statement | `export { TypeDriver }` |
| `module` | module_declaration (Ruby) | `module ActiveRecordTracer` |
| `struct` | struct_item (Rust) | `struct Message` |

### What Is NOT Extracted via LLM

- Behavioral descriptions are not inferred by LLM — only structural facts from AST
- "Intent" summaries are minimal and scoped to what is directly readable from file structure
- No free-form text generation for ground truth answers

---

## QA Pair Construction

QA pairs are built from verifiable structural facts:

**Answerable question types:**
- "What does this module import from?" → verified via `import_statement` AST nodes
- "Is there a class/interface for X?" → verified via `class_declaration` / `interface_declaration`
- "What language/framework is used?" → verified via file extensions and import patterns
- "Does the repository have tests?" → verified via presence of test files/directories

**Unanswerable question types (≥20% of corpus):**
These are questions whose answers do NOT exist in the repository source code. They test that
LiBrainian refuses to hallucinate rather than fabricating plausible-sounding answers.

Examples:
- "How many downloads does this package have?" (requires external registry)
- "What was the author's original motivation?" (not in source)
- "How does this compare in performance to X?" (no benchmarks in repo)
- "What is the production deployment configuration?" (not in source)

The **≥20% unanswerable ratio** is critical for calibration testing — it verifies epistemic
honesty and that LiBrainian says "I don't know" when appropriate.

---

## Corpus Pinning for Reproducibility

Each repo is pinned to a specific commit SHA in `state/benchmarks/corpus/external-repos.json`.
This ensures:
- Reproducible evaluation across CI runs
- Ground truth facts remain valid (source hasn't changed)
- Metrics can be compared across LiBrainian versions

---

## RAGAS Metrics

When LLM/embedding providers are available, run:

```bash
LIBRARIAN_TEST_MODE=system npm test -- --run src/__tests__/retrieval_benchmark.system.test.ts
```

The metrics measured are:
- **Recall@5** — What fraction of relevant files appear in the top-5 retrieved results?
- **Precision@5** — What fraction of the top-5 retrieved results are relevant?
- **Hallucination Rate** — What fraction of claims are unsupported by the retrieved context?
- **Faithfulness** — Are the claims in the synthesized answer grounded in the retrieved context?

### Previous Invalid Baseline (DO NOT USE)

The following metrics were measured against AI-generated synthetic repos and are **invalid**
due to circular evaluation:

| Metric | Invalid Baseline |
|--------|-----------------|
| Recall@5 | 0.82 |
| Precision@5 | 0.74 |
| Hallucination | 3% |
| Faithfulness | 0.87 |

These numbers are meaningless because the eval corpus was generated by the same LLMs used
for synthesis.

### Valid Measurements

Re-run metrics against the real external corpus documented in
`state/benchmarks/corpus/external-repos.json` and update `docs/LiBrainian/GATES.json`
`layer5.retrievalRecall`, `layer5.retrievalPrecision`, and `layer5.hallucinationRate`
with the new values.

---

## Gate Status

The `layer5.evalCorpus` gate in `docs/LiBrainian/GATES.json` tracks this corpus's status.
It must show `status: "pass"` only when:

1. ≥10 real external repos are included (not AI-generated)
2. All ground truth is derived from AST extraction (no LLM facts)
3. ≥20% unanswerable questions are included
4. All repos are pinned to specific commit SHAs
5. The `eval_corpus_structure.test.ts` "external real repos corpus validity" suite passes
