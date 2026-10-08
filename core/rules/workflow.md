---
targets: ["claudecode", "cursor"]
description: "How much process a change needs: direct edit, short plan or spec; where plans live"
cursor:
  alwaysApply: true
---

> Source: agent-harness `core/rules/workflow.md`. Edit it there; this copy is generated.

# Workflow

## Right-size the Process

Match the process to the change, because long plans take time to write and widen what gets built.

- Go straight to the change for a bug with a clear cause, an edit to 1–3 files, a copy or style change, or a mechanical refactor.
- Write a short plan first for a bug on a critical path (payments, access control, auth, or the project's own critical paths) or one with an unclear cause.
- Write a spec only for a new data model or cross-cutting dimension (multi-tenancy, permissions), payments or legal work, or real uncertainty about scope, and keep it within the budgets in the `implementation-readiness` rule.

Plans and specs are committed in the folder of whichever IDE wrote them: `.kiro/specs/`, `.claude/plans/` or `.cursor/plans/`. Before planning a change, check all three for one already under way and continue it in place.
