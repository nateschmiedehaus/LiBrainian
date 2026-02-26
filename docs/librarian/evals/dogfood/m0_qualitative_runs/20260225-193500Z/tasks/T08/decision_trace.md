# Decision Trace — T08

- task: Identify retrieval latency bottlenecks.
- used_librarian: yes
- uncertainty: high (retrieval/rerank/cache interplay)
- query_intent: "Identify retrieval hot paths and likely latency bottlenecks under load"
- output_quality: partial
- what_changed_due_to_librarian: narrowed hotspot investigation to query pipeline and rerank stages before deep profiling.
- counterfactual_without_librarian: slower convergence to high-impact bottlenecks.
- follow_up: add explicit query-stage timing summaries in default outputs.
