# Language Support (Polyglot)

This document defines LiBrainian’s **Top-20 language support target** and the
extension/back-end mapping used for indexing. The key contract is reliability:
LiBrainian must not end up in “0 indexed” states just because a native grammar
is missing on a given machine.

## Support Levels (What “Supported” Means)

LiBrainian intentionally supports languages at multiple levels:

1. **Indexable (always)**: file is indexed into storage as a module with embeddings (provider permitting),
   even if no language-specific parser is available.
2. **Deterministic extraction (when available)**: conservative, provider-free extraction of basic facts
   (exports/import-like deps, function-like defs) for common languages that lack a working grammar.
3. **Full AST extraction (when available)**: tree-sitter or ts-morph parses real syntax for call/import graphs
   and rich symbol facts.

This makes “semantic indexing” resilient: LLMs can be used for enrichment and higher-order cognition, but the
core index must not hard-depend on LLM availability or on native build toolchains.

## Top-20 Languages (first-class ingestion target)

| Language | Extensions | Preferred AST backend | Deterministic fallback |
| --- | --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts` | `ts-morph` | Text module |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | `tree-sitter-javascript` | Text module |
| Python | `.py`, `.pyi`, `.pyw` | `tree-sitter-python` | Text module |
| Java | `.java` | `tree-sitter-java` | Text module |
| Go | `.go` | `tree-sitter-go` | Text module |
| Rust | `.rs` | `tree-sitter-rust` | Text module |
| C | `.c`, `.h` | `tree-sitter-c` | Text module |
| C++ | `.cpp`, `.hpp`, `.cc`, `.hh`, `.cxx`, `.hxx` | `tree-sitter-cpp` | Text module |
| C# | `.cs` | `tree-sitter-c-sharp` | Regex facts (basic) |
| PHP | `.php`, `.phtml` | `tree-sitter-php` | Regex facts (basic) |
| Ruby | `.rb`, `.rake`, `.gemspec` | `tree-sitter-ruby` | Regex facts (basic) |
| Kotlin | `.kt`, `.kts` | `tree-sitter-kotlin` (optional) | Regex facts (basic) |
| Swift | `.swift` | `tree-sitter-swift` (optional) | Regex facts (basic) |
| Scala | `.scala`, `.sc` | `tree-sitter-scala` | Regex facts (basic) |
| Dart | `.dart` | `tree-sitter-dart` | Regex facts (basic) |
| Lua | `.lua` | `tree-sitter-lua` | Regex facts (basic) |
| Shell | `.sh`, `.bash`, `.zsh` | `tree-sitter-bash` (optional) | Text module |
| SQL | `.sql` | (optional) | Text module |
| HTML | `.html`, `.htm` | (optional) | Text module |
| CSS | `.css`, `.scss`, `.sass`, `.less` | (optional) | Text module |

Notes:
- “Preferred AST backend” may be unavailable on some machines (native toolchain constraints).
- Deterministic fallbacks are provider-free and are designed to prevent empty indexes, not to fully model syntax.

## Packaging Strategy (deps vs optionalDeps)

To keep onboarding “buttery” without making installs brittle:

- **Hard deps**: stable, cross-platform index core and local embedding backends.
- **Optional deps**: native tree-sitter grammars (best-effort).
- **Best-effort auto-install**: first-run readiness can attempt to install missing grammars, but failure is non-fatal.

LLM parsing (when enabled) is treated as an optional enrichment channel, not a prerequisite for indexing.
