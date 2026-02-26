# Decision Trace — T12

- task: Strict gate fails due to incomplete evidence artifact.
- used_librarian: yes
- uncertainty: medium-high (artifact-chain diagnosis)
- query_intent: "Strict gate fails with incomplete evidence artifact; determine why"
- output_quality: partial
- what_changed_due_to_librarian: checked evidence-manifest chain inputs first, then validated filesystem state and gate assumptions.
- counterfactual_without_librarian: slower path through unrelated strict-gate checks.
- follow_up: improve evidence-chain troubleshooting hints in gate output.
