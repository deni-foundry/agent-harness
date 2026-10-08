---
name: tasks-to-tdd
description: "Rewrites a spec's tasks.md into red/green/refactor form: each unit of work becomes a failing test, the implementation that passes it, and an optional cleanup step. Invoke after the spec's requirements, design and tasks are settled."
targets: ["claudecode", "cursor"]
disable-model-invocation: true
---

> Source: agent-harness `core/skills/tasks-to-tdd/SKILL.md`. Edit it there; this copy is generated.

# Rewrite Spec Tasks in Red/Green/Refactor Form

Take the `tasks.md` of the spec currently in play and rewrite its tasks as TDD cycles.
Confirm which spec folder to operate on if more than one is open.

For each unit of behaviour:

1. **Red** — the test to write first, named for the behaviour it pins down, and the
   assertion that will fail. Say which file it goes in and which layer it belongs to
   (unit, component, property or E2E) per the project's testing strategy (its `tech` or
   testing rule).
2. **Green** — the smallest implementation that makes it pass. No extra abstraction, no
   configurability that no requirement asks for.
3. **Refactor** — only when there is a concrete duplication or naming problem to resolve.
   Omit the step rather than inventing one.

Rules for the rewrite:

- Preserve the existing task numbering and dependency order; migrations still precede
  services, services still precede UI.
- Keep the `## Notes` and `## Task Dependency Graph` sections intact, updating task IDs in
  the graph if the rewrite splits or merges any.
- Keep each requirement traceable — every requirement referenced by the old tasks must
  still be referenced by at least one new cycle.
- Do not invent new scope. If a task cannot be expressed as a test-first cycle (a pure
  config change, a copy edit, a generated-types refresh), leave it as a plain task and say
  why.

Show the rewritten `tasks.md` before writing it, so the ordering can be checked.
