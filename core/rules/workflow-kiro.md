---
targets: ["kiro-ide"]
description: "Choosing between chat, Bugfix Spec, Quick Spec and full spec in Kiro; scheduler contradictions; where plans live"
---

> Source: agent-harness `core/rules/workflow-kiro.md`. Edit it there; this copy is generated.

# Workflow (Kiro)

## Scheduler Contradictions

The task queue, not the dependency graph, is the authority on what is in scope. When the scheduler reports no ready tasks while queued tasks remain, the graph contradicts itself — that is a defect to surface, not a puzzle to solve by picking a task yourself. Reading the graph and dispatching what "should" be next silently widens the scope past what the user asked for, typically by running optional tasks nobody requested.

Report the contradiction and stop. Never dispatch a task the batch queue did not return, and in particular never run an optional task to unblock a wave.

## Choosing a Workflow

Pick the lightest workflow that fits, because spec overhead must pay for itself: Opus 5.x writes long documents and widens narrow tasks, so an unneeded spec costs time and adds scope.

- **Chat (vibe):** a bug with a clear cause, a change in 1–3 files, copy or style, a mechanical refactor.
- **Bugfix Spec:** a bug on a critical path (payments, access control, auth, or the project's own critical paths), an unclear root cause, or regression risk.
- **Quick Spec:** a well-understood feature of up to ~15 tasks.
- **Full Requirements-First spec:** a new data model or cross-cutting dimension (multi-tenancy, permissions), payments or legal, or real uncertainty about scope.

When unsure, start in chat and say "Generate spec" once the shape is clear. Spec budgets: the `implementation-readiness` rule.

Plans and specs are committed in the folder of whichever IDE wrote them: `.kiro/specs/`, `.claude/plans/` or `.cursor/plans/`. Before planning a change, check all three for one already under way and continue it in place.
