---
name: local-test-runner
description: "Run unit tests and summarize failures"
---

## TOOL_DEFINITIONS
- name: run_tests
  command: "npm test -- --run"

## SKILL_INSTRUCTIONS
Run tests in the current workspace and report failures with file paths.
