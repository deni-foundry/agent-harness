---
targets: ["*"]
description: "Never simplify, skip or mask a failing test (unit, property, integration or E2E): investigate the root cause first"
globs: ["**/*.test.*", "**/*.spec.*", "**/e2e/**"]
kiro:
  inclusion: fileMatch
  fileMatchPattern: ["**/*.test.*", "**/*.spec.*", "**/e2e/**"]
---

> Source: agent-harness `core/rules/testing-discipline.md`. Edit it there; this copy is generated.

# Testing Discipline

## Never Skip or Mask Failing Tests

1. **Never simplify tests without verification** - When tests fail, investigate the root cause rather than simplifying the test case. The test may be correct and the application may have a bug.

2. **Never mask failures** - Do not skip tests or mark them as expected failures when they timeout or fail unexpectedly. Skipping tests that should pass masks real issues and defeats the purpose of the test. Always investigate why a test fails or times out before making any changes.

If a test fails:
1. Investigate the root cause
2. Fix the test or implementation
3. If clarification is needed, document it and ask the user
