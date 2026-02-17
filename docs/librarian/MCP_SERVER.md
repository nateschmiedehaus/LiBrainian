# LiBrainian MCP Server Documentation

## Overview

The LiBrainian MCP (Model Context Protocol) Server provides a standardized interface for AI agents to access repository knowledge. It implements the MCP specification with tools, resources, and comprehensive security controls.

## Quick Start

```typescript
import { createLibrarianMCPServer, startStdioServer } from 'LiBrainian/mcp';

// Create and start server
const server = await createLibrarianMCPServer({
  name: 'LiBrainian',
  version: '1.0.0',
});

// Start stdio transport (for CLI integration)
await startStdioServer();
```

## Tools

### bootstrap

Initialize or refresh the knowledge index for a workspace.

**Input Schema:**
```typescript
{
  workspace: string;       // Absolute path to workspace
  force?: boolean;         // Force re-index even if cached data exists
  include?: string[];      // Glob patterns to include
  exclude?: string[];      // Glob patterns to exclude
  llmProvider?: 'claude' | 'codex'; // Preferred LLM provider (CLI-auth only)
  maxFiles?: number;       // Max files to index (testing)
  fileTimeoutMs?: number;  // Per-file timeout (0 disables)
  fileTimeoutRetries?: number;
  fileTimeoutPolicy?: 'skip' | 'retry' | 'fail';
}
```

**Output:**
```typescript
{
  success: boolean;
  workspace: string;
  durationMs: number;
  stats: { ... };
  error?: string;
}
```

### query

Query the knowledge index for relevant context.

**Input Schema:**
```typescript
{
  workspace?: string;      // Optional; uses first ready workspace if omitted
  intent: string;          // Natural language query
  intentType?: 'understand' | 'debug' | 'refactor' | 'impact' | 'security' | 'test' | 'document' | 'navigate' | 'general';
  affectedFiles?: string[]; // Optional file scoping
  depth?: 'L0' | 'L1' | 'L2' | 'L3';  // Context depth
  minConfidence?: number;  // v1: heuristic/ranking threshold (NOT calibrated claim confidence)
  includeEngines?: boolean;
  includeEvidence?: boolean;
}
```

**Output:**
```typescript
{
  packs: Array<{
    packId: string;
    packType: string;
    targetId: string;
    summary: string;
    keyFacts: string[];
    relatedFiles: string[];
    confidence: number; // v1: ranking/heuristic signal; see specs/core/confidence-boundary.md
  }>;
  totalConfidence: number;
  latencyMs: number;
  cacheHit: boolean;
  synthesis?: string;
  verificationPlan?: unknown;
  drillDownHints?: string[];
  error?: string;
}
```

**Confidence note (no-theater)**:
- v1 surfaces numeric `confidence` values. Treat them as *ranking signals*, not epistemic claim confidence.
- The spec-system target is `ConfidenceValue` for claim confidence. Until migrated, LiBrainian must disclose calibration absence (see `docs/LiBrainian/specs/INTEGRATION_CHANGE_LIST.md`).

### verify_claim

Verify a code-related claim against indexed evidence.

**Input Schema:**
```typescript
{
  claimId: string;         // Context pack / claim identifier
  force?: boolean;         // Force re-verification
}
```

**Output:**
```typescript
{
  claimId: string;
  verified: boolean;
  confidence: number;       // v1 signal (migration pending)
  activeDefeaters?: Array<{ type: string; activated: boolean; reason: string; severity: string }>;
  defeaterResults?: Array<{ type: string; activated: boolean; reason: string; severity: string }>;
  error?: string;
}
```

### run_audit

Run an audit on the indexed knowledge.

**Input Schema:**
```typescript
{
  workspace: string;
  type: 'completeness' | 'freshness' | 'confidence' | 'coverage' | 'full';
}
```

**Output:**
```typescript
{
  audit_type: string;
  timestamp: string;
  findings: Array<{
    category: string;
    severity: string;
    message: string;
    recommendation?: string;
  }>;
  summary: {
    total_findings: number;
    critical: number;
    warnings: number;
    info: number;
  };
}
```

### diff_runs

Compare two bootstrap runs.

**Input Schema:**
```typescript
{
  workspace: string;
  run1: string;            // Run ID or "latest"
  run2: string;            // Run ID or timestamp
}
```

### export_index

Export the index to various formats.

**Input Schema:**
```typescript
{
  workspace: string;
  format: 'json' | 'sqlite' | 'markdown';
  outputPath?: string;
}
```

### get_context_pack_bundle

Get a bundle of context packs for a specific topic.

**Input Schema:**
```typescript
{
  workspace: string;
  topic: string;
  bundleType: 'task' | 'review' | 'debug' | 'comprehensive';
  maxTokens?: number;
}
```

## Resources

### LiBrainian://workspace/file-tree

Returns the file tree structure of the indexed workspace.

### LiBrainian://workspace/symbols

Returns all indexed symbols (functions, classes, interfaces).

### LiBrainian://workspace/knowledge-maps

Returns knowledge aggregations and relationships.

### LiBrainian://workspace/method-packs

Returns method-level context packs.

### LiBrainian://workspace/provenance

Returns indexing provenance and history.

### LiBrainian://workspace/identity

Returns workspace identity and configuration.

## Authentication

The MCP server supports session-based authentication with scoped permissions.

### Creating a Session

```typescript
const { token, sessionId } = server.createAuthSession({
  clientId: 'my-agent',
  scopes: ['read', 'execute'],
  metadata: { purpose: 'code-analysis' },
});
```

### Available Scopes

| Scope | Description | Required Tools |
|-------|-------------|----------------|
| `read` | Read resources and query | query, verify_claim |
| `write` | Modify index | bootstrap |
| `execute` | Run operations | run_audit, export_index |
| `network` | External connections | bootstrap with providers |
| `admin` | Administrative operations | All tools |

### Authorization Flow

1. Create session with required scopes
2. Include token in requests
3. Server validates token and checks scopes
4. High-risk operations require explicit consent

```typescript
// Grant consent for sensitive operations
server.grantConsent(sessionId, 'bootstrap');
```

## Audit Logging

All operations are logged to the audit trail.

### Event Types

- `tool_call` - Tool invocations
- `resource_read` - Resource access
- `authorization` - Auth decisions
- `session` - Session lifecycle
- `error` - Error events
- `system` - System events

### Querying Audit Logs

```typescript
const events = auditLogger.query({
  type: 'tool_call',
  sessionId: 'sess_123',
  since: '2024-01-01T00:00:00Z',
  limit: 100,
});
```

### Audit Statistics

```typescript
const stats = auditLogger.getStats();
// {
//   totalEvents: 1234,
//   byType: { tool_call: 500, resource_read: 600, ... },
//   byStatus: { success: 1100, failure: 100, ... },
//   uniqueSessions: 15,
//   avgToolDurationMs: 250,
//   errorRate: 8.1,
// }
```

## Security

### Input Sanitization

All inputs are sanitized before processing:

- Path traversal prevention
- Injection protection
- Size limit enforcement
- Query validation

```typescript
import { sanitizePath, sanitizeQuery } from 'LiBrainian/security';

const pathResult = sanitizePath(userPath, {
  baseDir: workspace,
  allowAbsolute: false,
});

if (!pathResult.valid) {
  throw new ValidationError(pathResult.errors[0].message);
}
```

### Rate Limiting

Built-in rate limiting with circuit breaker:

```typescript
import { createDefaultRateLimiter } from 'LiBrainian/security';

const rateLimiter = createDefaultRateLimiter();

const result = rateLimiter.check(clientId, 'query');
if (!result.allowed) {
  throw new RateLimitError(result.resetMs);
}
```

### Error Boundaries

Safe error handling with no sensitive data leakage:

```typescript
import { withErrorBoundary, normalizeError } from 'LiBrainian/security';

const result = await withErrorBoundary(
  async () => await operation(),
  { operation: 'query', workspace: '/path' }
);

if (!result.success) {
  // error is safe for external exposure
  return { error: result.error };
}
```

## Evaluation

### Quality Metrics

The evaluation harness measures:

- **Precision@k** - Relevance of top k results
- **Recall@k** - Coverage of relevant results
- **F1 Score** - Harmonic mean of precision/recall
- **nDCG** - Normalized discounted cumulative gain
- **MRR** - Mean reciprocal rank
- **MAP** - Mean average precision
- **Latency** - Query response time
- **Throughput** - Queries per second

### Running Evaluations

```typescript
import { createEvaluationHarness } from 'LiBrainian/evaluation';

const harness = createEvaluationHarness({
  cutoffK: 10,
  minPrecision: 0.7,
  minRecall: 0.6,
  maxLatencyMs: 500,
});

const report = await harness.runBatch(queries, async (query) => {
  const result = await LiBrainian.query({ intent: query.intent });
  return {
    docs: result.packs.map(p => p.id),
    confidence: result.packs[0]?.confidence,
  };
});

console.log(report.summary);
// {
//   qualityGrade: 'A',
//   qualityScore: 92,
//   passed: true,
//   findings: [...],
//   recommendations: [...],
// }
```

## Configuration

### Server Configuration

```typescript
const config: LibrarianMCPServerConfig = {
  name: 'LiBrainian',
  version: '1.0.0',
  capabilities: {
    tools: {},
    resources: {},
    prompts: {},
    logging: {},
  },
};
```

### Security Configuration

```typescript
const secureConfig = createSecureConfig({
  path: { allowAbsolute: false },
  rateLimit: { maxRequestsPerMinute: 100 },
  errors: { exposeDetails: false },
});
```

## Schema Validation

All tool inputs are validated against Zod schemas:

```typescript
import { validateToolInput, getToolJsonSchema } from 'LiBrainian/mcp';

// Get JSON Schema for documentation
const schema = getToolJsonSchema('query');

// Validate input
const validation = validateToolInput('query', input);
if (!validation.valid) {
  throw new ValidationError(validation.errors[0].message);
}
```

## Integration Examples

### With Claude Code

```typescript
// Claude Code automatically uses MCP servers
// Configure in .claude/settings.json
{
  "mcpServers": {
    "LiBrainian": {
      "command": "node",
      "args": ["./dist/LiBrainian/mcp/server.js"],
      "env": {}
    }
  }
}
```

### Programmatic Usage

```typescript
import { LiBrainian, createLibrarianMCPServer } from 'librainian';

// Initialize LiBrainian
const LiBrainian = await LiBrainian.create({ workspace: '/path' });
await LiBrainian.bootstrap();

// Create MCP server connected to LiBrainian
const server = await createLibrarianMCPServer();

// Query via MCP
const result = await server.callTool('query', {
  workspace: '/path',
  intent: 'How does authentication work?',
});
```

## Error Handling

### Error Codes

| Code | Category | HTTP Status |
|------|----------|-------------|
| INVALID_INPUT | validation | 400 |
| AUTHENTICATION_REQUIRED | authentication | 401 |
| PERMISSION_DENIED | authorization | 403 |
| RESOURCE_NOT_FOUND | resource_not_found | 404 |
| RATE_LIMIT_EXCEEDED | rate_limit | 429 |
| INTERNAL_ERROR | internal | 500 |

### Error Response Format

```typescript
{
  code: 'RATE_LIMIT_EXCEEDED',
  message: 'Rate limit exceeded',
  category: 'rate_limit',
  severity: 'low',
  statusCode: 429,
  retryable: true,
  retryDelayMs: 5000,
  timestamp: '2024-01-15T10:30:00.000Z',
}
```

## Performance

### Recommended Settings

- **Bootstrap**: Allow 30-60s for initial index
- **Query**: Target <500ms p95 latency
- **Rate Limits**: 100 req/min sustained, 20 burst
- **Max Results**: Default 10, max 100

### Caching

Query results are cached with file-change invalidation:

- Cache TTL: 60 seconds
- Invalidation: On file changes
- Cache key: Normalized query hash

## Troubleshooting

### Common Issues

1. **Bootstrap timeout**: Increase timeout or use incremental indexing
2. **High latency**: Enable caching, reduce maxPacks
3. **Low confidence**: Check embedding provider status
4. **Rate limit errors**: Implement backoff, reduce request frequency

### Debug Mode

Enable verbose logging:

```typescript
const server = await createLibrarianMCPServer({
  debug: true,
});
```

### Health Check

```typescript
const status = server.getStatus();
// {
//   state: 'running',
//   workspaces: ['workspace1', 'workspace2'],
//   activeSessions: 5,
//   uptime: 3600000,
// }
```
