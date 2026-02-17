# Project Type Coverage Analysis

Status: Research Analysis
Last Updated: 2026-01-27
Owner: LiBrainian Core Team
Evidence: Source code analysis of `src/agents/ast_indexer.ts`, `src/agents/parser_registry.ts`, `src/evaluation/codebase_profiler.ts`

## Executive Summary

LiBrainian currently supports **4 languages with full AST parsing** (TypeScript, JavaScript, Python, Go, Rust) and has **LLM fallback** for all other languages. This analysis evaluates coverage across 15 project types and identifies gaps requiring attention.

**Current Coverage:**
- Full AST Support: TypeScript/JavaScript (ts-morph), Python, Go, Rust (tree-sitter)
- LLM Fallback: All other languages (reduced confidence, slower, less accurate)
- Universal: File detection, language identification, profiling

**Critical Gaps:**
- No native parser for: Java, C/C++, C#, Swift, Kotlin, PHP, Ruby, Dart, Solidity
- Limited pattern recognition for framework-specific constructs
- No support for non-text formats (WASM, bytecode, binaries)

---

## 1. Coverage Matrix by Project Type

| Project Type | Languages | AST Support | Pattern Support | Gap Severity |
|-------------|-----------|-------------|-----------------|--------------|
| Web Frontend | TS, JS, Vue, Svelte | Partial | Low | Medium |
| Web Backend (Node) | TS, JS | Full | Medium | Low |
| Web Backend (Python) | Python | Full | Medium | Low |
| Web Backend (Go) | Go | Full | Medium | Low |
| Web Backend (Java) | Java | LLM Fallback | None | High |
| Web Backend (Rust) | Rust | Full | Low | Low |
| Mobile (iOS) | Swift, Obj-C | LLM Fallback | None | High |
| Mobile (Android) | Kotlin, Java | LLM Fallback | None | High |
| Mobile (React Native) | TS, JS | Full | Low | Low |
| Mobile (Flutter) | Dart | LLM Fallback | None | High |
| Desktop (Electron) | TS, JS | Full | Low | Low |
| Desktop (Tauri) | Rust, TS | Full | Low | Low |
| Desktop (Native) | C++, C#, Swift | LLM Fallback | None | High |
| CLI Tools | Any | Varies | Low | Medium |
| Libraries/SDKs | Any | Varies | Medium | Medium |
| Microservices | Any | Varies | Low | Medium |
| Monoliths | Any | Varies | Low | Medium |
| Monorepos | Any | Varies | Medium | Low |
| Data Pipelines | Python, Scala | Partial | None | Medium |
| ML/AI Projects | Python | Full | Low | Low |
| Embedded Systems | C, C++, Rust | Partial | None | High |
| Game Development | C++, C#, GDScript | LLM Fallback | None | High |
| Infrastructure | HCL, YAML | LLM Fallback | None | Medium |
| Smart Contracts | Solidity, Rust | Partial | None | High |

---

## 2. Detailed Analysis by Project Type

### 2.1 Web Frontend (React, Vue, Angular, Svelte)

**Languages Used:**
- TypeScript, JavaScript (primary)
- Vue SFCs (.vue)
- Svelte components (.svelte)
- JSX/TSX
- CSS/SCSS/Less
- HTML templates

**Unique Patterns:**
- Component hierarchies and composition
- State management (Redux, Vuex, Pinia, stores)
- Hooks and lifecycle methods
- Props/events/slots contracts
- Routing configurations
- Build tool configurations (Vite, Webpack, Rollup)

**Current LiBrainian Support:**
- ts-morph parser: Full support for .ts, .tsx, .js, .jsx
- File extension detection: YES in codebase_profiler.ts
- Component detection: PARTIAL (functions/classes, not component-specific)

**Gaps:**
1. **Vue SFC Parsing**: No native .vue file support - requires extraction of script/template/style blocks
2. **Svelte Component Parsing**: No native .svelte support
3. **JSX/TSX Pattern Recognition**: AST parses JSX but no semantic understanding of component patterns
4. **State Management Patterns**: No detection of Redux slices, Vuex modules, etc.
5. **CSS-in-JS**: No understanding of styled-components, emotion, etc.

**Priority Fixes:**
1. Add Vue SFC preprocessor (extract script blocks for ts-morph)
2. Add Svelte preprocessor
3. Add component pattern detection heuristics
4. Add framework configuration file parsing (vite.config, next.config, etc.)

---

### 2.2 Web Backend (Node.js, Python, Go, Java, Rust)

**Languages Used:**
- Node.js: TypeScript, JavaScript
- Python: Python
- Go: Go
- Java: Java
- Rust: Rust

**Unique Patterns:**
- HTTP route definitions
- Middleware chains
- Database models/schemas (ORM)
- Authentication/authorization patterns
- Message queue handlers
- API contracts (OpenAPI, GraphQL schemas)
- Dependency injection

**Current LiBrainian Support:**
- Node.js: FULL (ts-morph)
- Python: FULL (tree-sitter-python)
- Go: FULL (tree-sitter-go)
- Rust: FULL (tree-sitter-rust)
- Java: LLM FALLBACK ONLY

**Gaps:**
1. **Java Parser**: No tree-sitter-java integration - critical gap
2. **Route Detection**: No automatic detection of Express routes, FastAPI endpoints, etc.
3. **ORM Model Detection**: No understanding of Prisma, SQLAlchemy, GORM models
4. **GraphQL Schema Parsing**: No .graphql file support
5. **OpenAPI/Swagger**: No spec file understanding

**Priority Fixes:**
1. Add tree-sitter-java for Java support
2. Add route detection patterns for major frameworks
3. Add ORM schema extraction
4. Add GraphQL/OpenAPI file parsing

---

### 2.3 Mobile Development (iOS, Android, React Native, Flutter)

**Languages Used:**
- iOS: Swift, Objective-C
- Android: Kotlin, Java
- React Native: TypeScript, JavaScript
- Flutter: Dart

**Unique Patterns:**
- View hierarchies and lifecycle
- Platform-specific APIs
- Native module bridges
- State management (BLoC, Provider, Redux)
- Navigation patterns
- Platform configuration (Info.plist, AndroidManifest.xml)

**Current LiBrainian Support:**
- React Native: FULL (ts-morph for TS/JS)
- iOS (Swift): LLM FALLBACK
- iOS (Objective-C): LLM FALLBACK
- Android (Kotlin): LLM FALLBACK
- Android (Java): LLM FALLBACK
- Flutter (Dart): LLM FALLBACK

**Gaps:**
1. **Swift Parser**: No tree-sitter-swift integration - HIGH priority
2. **Kotlin Parser**: No tree-sitter-kotlin integration - HIGH priority
3. **Dart Parser**: No tree-sitter-dart integration - HIGH priority
4. **Objective-C Parser**: No tree-sitter-objc integration
5. **Platform Config Parsing**: No plist/manifest parsing

**Priority Fixes:**
1. Add tree-sitter-swift for iOS
2. Add tree-sitter-kotlin for Android
3. Add tree-sitter-dart for Flutter
4. Add platform manifest parsers

---

### 2.4 Desktop Applications (Electron, Tauri, Native)

**Languages Used:**
- Electron: TypeScript, JavaScript
- Tauri: Rust + TypeScript/JavaScript
- Native Windows: C++, C#
- Native macOS: Swift, Objective-C
- Native Linux: C, C++, Rust

**Unique Patterns:**
- IPC communication patterns
- Main/renderer process separation
- Native API bindings
- Menu/dialog systems
- System tray integration
- Auto-update mechanisms

**Current LiBrainian Support:**
- Electron: FULL (ts-morph)
- Tauri: FULL (ts-morph + tree-sitter-rust)
- C++: LLM FALLBACK
- C#: LLM FALLBACK
- Swift: LLM FALLBACK

**Gaps:**
1. **C++ Parser**: No tree-sitter-cpp integration - HIGH priority for native
2. **C# Parser**: No tree-sitter-c-sharp integration
3. **IPC Pattern Detection**: No understanding of Electron/Tauri IPC
4. **Native API Usage**: No detection of system API calls

**Priority Fixes:**
1. Add tree-sitter-cpp
2. Add tree-sitter-c-sharp
3. Add Electron/Tauri pattern recognition

---

### 2.5 CLI Tools

**Languages Used:**
- Go, Rust (compiled)
- Python (scripted)
- Node.js (npm packages)
- Bash/Shell (scripts)

**Unique Patterns:**
- Argument parsing (cobra, clap, argparse, commander)
- Subcommand structures
- Configuration file handling
- Output formatting (JSON, YAML, table)
- Exit codes and error handling

**Current LiBrainian Support:**
- Go: FULL
- Rust: FULL
- Python: FULL
- Node.js: FULL
- Bash: LLM FALLBACK (shell extension detected in codebase_profiler)

**Gaps:**
1. **Shell Script Parsing**: No tree-sitter-bash integration
2. **Argument Parser Detection**: No pattern recognition for CLI frameworks
3. **Subcommand Structure**: No command hierarchy extraction

**Priority Fixes:**
1. Add tree-sitter-bash for shell scripts
2. Add CLI argument parser pattern detection

---

### 2.6 Libraries and SDKs

**Languages Used:**
- All languages (depends on target platform)

**Unique Patterns:**
- Public API surface definition
- Semantic versioning compliance
- Backward compatibility contracts
- Extension points and hooks
- Type definitions (.d.ts, .pyi stubs)
- Documentation annotations

**Current LiBrainian Support:**
- Export detection: YES (via parser_registry module extraction)
- Public API extraction: PARTIAL (exports only, no visibility analysis)
- Type stub detection: NO

**Gaps:**
1. **Public API Boundaries**: No distinction between public/internal APIs
2. **Type Stub Parsing**: .d.ts supported, .pyi not fully understood
3. **Semver Violation Detection**: No automatic breaking change detection
4. **Doc Comment Extraction**: PARTIAL (JSDoc in ts-morph)

**Priority Fixes:**
1. Add public/private API boundary detection
2. Add Python stub file parsing
3. Add breaking change detection heuristics

---

### 2.7 Microservices

**Languages Used:**
- Any (polyglot common)
- Often: Go, Java, Python, Node.js, Rust

**Unique Patterns:**
- Service boundaries and contracts
- Inter-service communication (gRPC, REST, message queues)
- Service discovery patterns
- Circuit breakers, retries, timeouts
- Distributed tracing instrumentation
- Container/orchestration configs (Dockerfile, k8s manifests)

**Current LiBrainian Support:**
- Language support: Varies (see per-language analysis)
- Dependency detection: YES (module imports)
- Service boundary detection: NO

**Gaps:**
1. **gRPC/Protobuf Parsing**: No .proto file support - MEDIUM priority
2. **Service Contract Extraction**: No automatic API contract detection
3. **Docker/K8s Config Parsing**: No YAML schema understanding
4. **Distributed Tracing**: No span/trace detection

**Priority Fixes:**
1. Add tree-sitter-protobuf or protobuf schema parser
2. Add Dockerfile parsing
3. Add Kubernetes manifest understanding

---

### 2.8 Monoliths

**Languages Used:**
- Typically single language dominant
- Often: Java, Ruby, Python, PHP

**Unique Patterns:**
- Large file counts (detected in codebase_profiler)
- Module boundaries within single codebase
- Layered architecture (controller/service/repository)
- Database migrations
- Background job definitions

**Current LiBrainian Support:**
- Size detection: YES (totalLines, totalFiles in CodebaseProfile)
- Complexity metrics: YES (averageFunctionsPerFile, deepestNesting)
- Large file detection: YES (largeFiles in RiskIndicators)
- Risk indicators: YES (complexFunctions, circularDependencies)

**Gaps:**
1. **Ruby Parser**: No tree-sitter-ruby for Rails apps - MEDIUM priority
2. **PHP Parser**: No tree-sitter-php for Laravel/Symfony - MEDIUM priority
3. **Layer Detection**: No automatic controller/service/repo pattern detection
4. **Migration Tracking**: No database migration understanding

**Priority Fixes:**
1. Add tree-sitter-ruby
2. Add tree-sitter-php
3. Add architectural layer detection

---

### 2.9 Monorepos

**Languages Used:**
- Multiple (polyglot)
- Build tools: nx, turborepo, lerna, rush, pnpm workspaces

**Unique Patterns:**
- Workspace configuration
- Package interdependencies
- Shared code boundaries
- Build caching configurations
- Change detection scopes

**Current LiBrainian Support:**
- Monorepo detection: YES (hasWorkspaces, isMonorepo in StructureIndicators)
- Workspace config detection: YES (pnpm-workspace.yaml, lerna.json, rush.json, nx.json, turbo.json)
- Package.json workspaces: YES
- Classification: YES ("monorepo" SizeClassification)

**Gaps:**
1. **Cross-Package Dependencies**: No automatic package dependency graph
2. **Affected Package Detection**: No change impact analysis
3. **Shared Code Boundaries**: No detection of shared libraries vs apps

**Priority Fixes:**
1. Add package dependency graph construction
2. Add change impact analysis for monorepos

---

### 2.10 Data Pipelines (ETL, Streaming)

**Languages Used:**
- Python (Airflow, Luigi, Prefect)
- Scala (Spark)
- SQL (transformation queries)
- YAML (pipeline definitions)

**Unique Patterns:**
- DAG definitions
- Task dependencies
- Data source/sink configurations
- Schema evolution handling
- Scheduling configurations
- Idempotency patterns

**Current LiBrainian Support:**
- Python: FULL
- Scala: LLM FALLBACK
- SQL: Detected but not parsed (.sql in EXTENSION_TO_LANGUAGE)

**Gaps:**
1. **Scala Parser**: No tree-sitter-scala - MEDIUM priority
2. **SQL Parsing**: No tree-sitter-sql for query understanding
3. **DAG Detection**: No automatic DAG structure extraction
4. **Airflow/Prefect Patterns**: No framework-specific understanding

**Priority Fixes:**
1. Add tree-sitter-scala
2. Add tree-sitter-sql
3. Add DAG pattern detection for Airflow/Prefect

---

### 2.11 ML/AI Projects

**Languages Used:**
- Python (dominant)
- Jupyter notebooks (.ipynb)
- Configuration files (YAML, JSON)
- Model definition languages (ONNX, TensorFlow SavedModel)

**Unique Patterns:**
- Model architecture definitions
- Training loop patterns
- Data preprocessing pipelines
- Hyperparameter configurations
- Experiment tracking
- Model versioning

**Current LiBrainian Support:**
- Python: FULL (tree-sitter-python)
- Jupyter notebooks: NOT DIRECTLY (JSON format)
- YAML/JSON: Detected but not semantically parsed

**Gaps:**
1. **Jupyter Notebook Parsing**: No extraction of code cells from .ipynb
2. **ML Framework Patterns**: No detection of PyTorch/TensorFlow patterns
3. **Model Architecture Extraction**: No automatic layer/architecture understanding
4. **Experiment Config Parsing**: No hydra/wandb config understanding

**Priority Fixes:**
1. Add Jupyter notebook cell extraction
2. Add ML framework pattern detection
3. Add experiment configuration parsing

---

### 2.12 Embedded Systems (IoT, Firmware)

**Languages Used:**
- C (dominant)
- C++
- Rust (growing)
- Assembly

**Unique Patterns:**
- Hardware abstraction layers
- Interrupt handlers
- Memory-mapped I/O
- Real-time constraints
- Boot sequences
- Device tree configurations

**Current LiBrainian Support:**
- Rust: FULL
- C: LLM FALLBACK
- C++: LLM FALLBACK
- Assembly: LLM FALLBACK

**Gaps:**
1. **C Parser**: No tree-sitter-c - HIGH priority for embedded
2. **C++ Parser**: No tree-sitter-cpp - HIGH priority
3. **Assembly Parser**: No assembly support
4. **Hardware Pattern Detection**: No HAL/driver pattern recognition
5. **Memory Analysis**: No stack/heap usage understanding

**Priority Fixes:**
1. Add tree-sitter-c (critical for embedded)
2. Add tree-sitter-cpp
3. Add embedded-specific pattern detection

---

### 2.13 Game Development (Unity, Unreal, Custom)

**Languages Used:**
- Unity: C#
- Unreal: C++, Blueprints
- Godot: GDScript, C#
- Custom: C++, Rust

**Unique Patterns:**
- Entity-component-system (ECS)
- Game loop patterns
- Physics integration
- Asset references
- Scene/level definitions
- Shader code

**Current LiBrainian Support:**
- C#: LLM FALLBACK
- C++: LLM FALLBACK
- GDScript: LLM FALLBACK
- Rust: FULL

**Gaps:**
1. **C# Parser**: No tree-sitter-c-sharp - HIGH priority for Unity
2. **C++ Parser**: No tree-sitter-cpp - HIGH priority for Unreal
3. **GDScript Parser**: No tree-sitter-gdscript
4. **Shader Parsing**: No HLSL/GLSL support
5. **Asset Reference Tracking**: No understanding of .prefab, .uasset, etc.

**Priority Fixes:**
1. Add tree-sitter-c-sharp (Unity)
2. Add tree-sitter-cpp (Unreal)
3. Add shader language support

---

### 2.14 Infrastructure (Terraform, CloudFormation)

**Languages Used:**
- HCL (Terraform)
- YAML (CloudFormation, Ansible)
- JSON (ARM templates)
- Pulumi: TypeScript, Python, Go

**Unique Patterns:**
- Resource definitions
- Dependency graphs
- Variable/output declarations
- Module composition
- State management
- Provider configurations

**Current LiBrainian Support:**
- Pulumi (TS/Python/Go): FULL for language, no IaC semantics
- HCL: LLM FALLBACK
- YAML: Detected, not semantically parsed
- JSON: Detected, not semantically parsed

**Gaps:**
1. **HCL Parser**: No tree-sitter-hcl - MEDIUM priority
2. **CloudFormation Understanding**: No YAML schema awareness
3. **Resource Graph Extraction**: No automatic dependency detection
4. **State File Analysis**: No terraform.tfstate understanding

**Priority Fixes:**
1. Add tree-sitter-hcl for Terraform
2. Add CloudFormation/ARM template schema awareness
3. Add IaC resource graph extraction

---

### 2.15 Smart Contracts (Solidity, Rust/Solana)

**Languages Used:**
- Solidity (Ethereum)
- Rust (Solana, Near)
- Vyper (Ethereum alternative)
- Move (Aptos, Sui)

**Unique Patterns:**
- Contract inheritance
- Storage layouts
- Modifier chains
- Event definitions
- External call patterns
- Gas optimization patterns
- Security vulnerability patterns

**Current LiBrainian Support:**
- Rust (Solana): FULL (tree-sitter-rust)
- Solidity: LLM FALLBACK
- Vyper: LLM FALLBACK
- Move: LLM FALLBACK

**Gaps:**
1. **Solidity Parser**: No tree-sitter-solidity - HIGH priority for Web3
2. **Security Pattern Detection**: No reentrancy/overflow detection
3. **Storage Layout Analysis**: No slot/offset understanding
4. **Cross-Contract Call Tracking**: No external call graph

**Priority Fixes:**
1. Add tree-sitter-solidity
2. Add smart contract security pattern detection
3. Add storage layout analysis

---

## 3. Parser Gap Summary

### Currently Supported (Full AST)
| Language | Parser | Extensions | Confidence |
|----------|--------|------------|------------|
| TypeScript | ts-morph | .ts, .tsx | 0.95 |
| JavaScript | ts-morph | .js, .jsx, .mjs, .cjs | 0.95 |
| Python | tree-sitter-python | .py, .pyi, .pyw | 0.90 |
| Go | tree-sitter-go | .go | 0.90 |
| Rust | tree-sitter-rust | .rs | 0.90 |

### LLM Fallback Only (Gaps)
| Language | Priority | Project Types Affected | Tree-Sitter Module |
|----------|----------|----------------------|-------------------|
| Java | HIGH | Backend, Android, Enterprise | tree-sitter-java |
| C | HIGH | Embedded, Systems | tree-sitter-c |
| C++ | HIGH | Games, Embedded, Desktop | tree-sitter-cpp |
| C# | HIGH | Unity, Windows, Enterprise | tree-sitter-c-sharp |
| Swift | HIGH | iOS, macOS | tree-sitter-swift |
| Kotlin | HIGH | Android | tree-sitter-kotlin |
| Dart | MEDIUM | Flutter | tree-sitter-dart |
| Ruby | MEDIUM | Rails, Scripts | tree-sitter-ruby |
| PHP | MEDIUM | Web Backend | tree-sitter-php |
| Scala | MEDIUM | Data Pipelines | tree-sitter-scala |
| Solidity | MEDIUM | Smart Contracts | tree-sitter-solidity |
| HCL | MEDIUM | Infrastructure | tree-sitter-hcl |
| Bash | LOW | Scripts, CI | tree-sitter-bash |
| SQL | LOW | Data, Backend | tree-sitter-sql |

---

## 4. Pattern Recognition Gaps

### Framework-Specific Patterns Not Detected
| Pattern | Frameworks | Impact |
|---------|------------|--------|
| Component hierarchy | React, Vue, Angular, Svelte | Understanding UI structure |
| Route definitions | Express, FastAPI, Flask, Spring | API surface discovery |
| ORM models | Prisma, SQLAlchemy, GORM, ActiveRecord | Data model understanding |
| State management | Redux, Vuex, MobX, BLoC | State flow tracing |
| Dependency injection | Spring, NestJS, Angular | Object graph understanding |
| Test patterns | Jest, Pytest, JUnit, Go testing | Test coverage mapping |
| IaC resources | Terraform, CloudFormation | Infrastructure graph |
| DAG definitions | Airflow, Prefect, Luigi | Pipeline understanding |

### Missing File Type Support
| File Type | Purpose | Parser Needed |
|-----------|---------|---------------|
| .vue | Vue SFCs | Custom preprocessor |
| .svelte | Svelte components | Custom preprocessor |
| .proto | gRPC definitions | tree-sitter-protobuf |
| .graphql | GraphQL schemas | tree-sitter-graphql |
| .ipynb | Jupyter notebooks | JSON extraction |
| .tf | Terraform | tree-sitter-hcl |
| .yaml/.yml | Config files | Schema-aware parsing |
| .sol | Solidity contracts | tree-sitter-solidity |

---

## 5. Priority Roadmap

### Phase 1: Critical Language Gaps (Immediate)
1. **tree-sitter-java** - Unlocks enterprise backend, Android
2. **tree-sitter-c** - Unlocks embedded systems
3. **tree-sitter-cpp** - Unlocks games, embedded, desktop
4. **tree-sitter-c-sharp** - Unlocks Unity, Windows apps

### Phase 2: Mobile & Modern Stacks (Short-term)
1. **tree-sitter-swift** - Unlocks iOS development
2. **tree-sitter-kotlin** - Unlocks Android development
3. **tree-sitter-dart** - Unlocks Flutter development

### Phase 3: Specialized Domains (Medium-term)
1. **tree-sitter-solidity** - Unlocks Web3/blockchain
2. **tree-sitter-hcl** - Unlocks infrastructure-as-code
3. **tree-sitter-scala** - Unlocks data engineering
4. **tree-sitter-ruby** - Unlocks Rails ecosystem
5. **tree-sitter-php** - Unlocks PHP ecosystem

### Phase 4: Pattern Recognition (Ongoing)
1. Framework-specific pattern detectors
2. SFC preprocessors (Vue, Svelte)
3. Configuration file schema awareness
4. Jupyter notebook extraction

---

## 6. LLM Fallback Assessment

The current LLM fallback (`parseWithLlmFallback` in ast_indexer.ts) provides:

**Capabilities:**
- Function boundary detection
- Basic export/import extraction
- Line number mapping

**Limitations:**
- Lower confidence scores (0.45 vs 0.90+ for AST)
- Higher latency (LLM call required)
- Token budget consumption
- Potential hallucination risk
- No call graph extraction
- Limited accuracy for complex syntax

**Recommendation:**
LLM fallback is suitable for:
- Initial exploration of unknown codebases
- Rare languages with no tree-sitter support
- One-off analysis tasks

LLM fallback is NOT suitable for:
- Production indexing of major codebases
- Continuous integration pipelines
- Performance-sensitive applications

---

## 7. Conclusion

LiBrainian's current architecture is **sound and extensible**, with the ParserRegistry pattern allowing easy addition of new tree-sitter parsers. The critical path to universal project type support is:

1. **Add 4 high-priority tree-sitter parsers** (Java, C, C++, C#) to cover 80% of enterprise codebases
2. **Add 3 mobile parsers** (Swift, Kotlin, Dart) to cover mobile development
3. **Add framework pattern recognition** to move beyond syntax to semantics
4. **Maintain LLM fallback** as safety net for edge cases

The modular architecture means each parser addition is incremental and low-risk. The `recordLanguageGap` and `createLanguageOnboardingEvent` mechanisms already track gaps automatically, enabling data-driven prioritization.
