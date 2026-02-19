# A2A Integration

Status: adapter contract (preview).

A2A integration converts agent-to-agent task envelopes into LiBrainian context queries and returns evidence-rich responses to the calling agent.

## Prerequisites

- An A2A runtime with task request/response hooks
- Adapter logic that maps A2A task fields to LiBrainian query fields
- A shared workspace mount visible to the LiBrainian side

## Working example

```typescript
type A2ATask = {
  id: string;
  taskType: 'code_context';
  prompt: string;
  workspace: string;
};

type LibrarianQuery = {
  intent: string;
  workspace: string;
  depth: 'L0' | 'L1' | 'L2' | 'L3';
};

export function mapA2ATaskToLibrarianQuery(task: A2ATask): LibrarianQuery {
  return {
    intent: task.prompt,
    workspace: task.workspace,
    depth: 'L2',
  };
}
```

## Real-world use case

Use A2A when one coordinating agent delegates code-context gathering to a specialist agent that uses LiBrainian as its retrieval backend.

## Troubleshooting

1. Delegated agent gets low-quality context
   - Pass task-specific prompts instead of generic "analyze codebase" instructions.
2. Response objects are too large for A2A transport
   - Cap pack counts or trim snippet payloads at the adapter boundary.
3. Correlation IDs are lost
   - Carry `task.id` through adapter metadata for end-to-end tracing.

## Related tests

- `src/__tests__/integration_guide_docs.test.ts`
- `src/__tests__/agent_session_test_docs.test.ts`
