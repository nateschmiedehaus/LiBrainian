# Python SDK Integration

Status: SDK-style bridge (preview).

Until a standalone Python package is published, Python integrations can use a thin typed client over the OpenAPI/REST adapter.

## Prerequisites

- Python 3.10+
- `pip install requests`
- A running LiBrainian REST adapter endpoint

## Working example

```python
from dataclasses import dataclass
from typing import Any, Dict
import requests


@dataclass
class LibrarianClient:
    base_url: str
    token: str | None = None

    def query(self, intent: str, workspace: str, depth: str = "L2") -> Dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        response = requests.post(
            f"{self.base_url}/v1/query",
            headers=headers,
            json={"intent": intent, "workspace": workspace, "depth": depth},
            timeout=30,
        )
        response.raise_for_status()
        return response.json()


client = LibrarianClient(base_url="http://localhost:8787")
result = client.query("Find auth middleware entry points", "/workspace/app")
print(result.get("summary", "<no summary>"))
```

## Real-world use case

Use this path when your automation stack is Python-first (CrewAI orchestration, notebooks, or custom ops scripts) but you still want LiBrainian retrieval and citations.

## Troubleshooting

1. `ConnectionError` to adapter host
   - Confirm adapter host/port and container networking.
2. HTTP timeout on large repos
   - Increase request timeout and lower depth/pack count in adapter defaults.
3. `401 Unauthorized`
   - Set token headers consistently across notebook/script environments.

## Related tests

- `src/__tests__/integration_guide_docs.test.ts`
- `src/__tests__/github_readiness_docs.test.ts`
