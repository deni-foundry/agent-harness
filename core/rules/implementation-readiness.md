---
targets: ["*"]
description: "Writing and readying specs and plans: size budget, what goes where, plans from other IDEs, tasks.md structure"
globs: ["**/.kiro/specs/**", "**/.claude/plans/**", "**/.cursor/plans/**"]
kiro:
  inclusion: fileMatch
  fileMatchPattern: ["**/.kiro/specs/**", "**/.claude/plans/**", "**/.cursor/plans/**"]
---

> Source: agent-harness `core/rules/implementation-readiness.md`. Edit it there; this copy is generated.

# Writing and Readying Specs

A spec pays for itself only when it is short enough to read in one sitting. Long design
documents are the model's default, and every extra page slows each later step: review, task
generation and every task that rereads the design. Whether a change needs a spec at all is
decided by the `workflow` rule (`workflow-kiro` in Kiro).

## Size budget

| Document          | Budget                      |
|-------------------|-----------------------------|
| `requirements.md` | ≤ ~150 lines                |
| `design.md`       | ≤ ~400 lines                |
| `tasks.md`        | ≤ ~25 tasks, 2–6 lines each |

If a feature needs more, split the spec rather than grow it.

## What goes where

- `design.md` covers decisions (a one-clause reason each), interfaces and types, the files
  involved, what is out of scope, and one end-to-end verification step.
- Review rounds, characterisation results and rejected alternatives go in
  `.agents/tasks/<task>/`, or collapse into a short `## Decisions` list once resolved, because
  the design describes what will be built, not how it was argued.
- Tasks reference design sections instead of restating them.
- Keep one plan of record, `tasks.md` or FEAT JSON, not both, because two plans drift.

## Organisation

- Spec folders are per feature, not per layer, so one folder holds the whole context.
- `_archive/` holds shipped or superseded specs, kept so the reasoning stays searchable. Look
  there before concluding something was never specced.
- Quick Specs write `quickspec.md` (`.config.kiro` has `"workflowType": "fast-task"`) and need
  neither tasks.md section below, because Kiro orders their tasks itself.

## Plans from other IDEs

Kiro specs live in `.kiro/specs/`, Claude Code plans in `.claude/plans/` (`plansDirectory` in
`.claude/settings.json`) and Cursor plans in `.cursor/plans/`. All three are committed, so a
plan started in one IDE can be finished in another.

- Continue a plan from another IDE in place: tick its checkboxes and amend it, rather than
  re-planning in your own format, because two plans for one change drift.
- The size budget above applies to every plan, whatever its format.
- Cursor writes plans to `~/.cursor/plans` until the user picks "Save to Workspace" in the
  plan editor, so a Cursor plan the user mentions may not be in the repo yet; ask for it.
- A shipped or abandoned plan moves to `_archive/` inside its own folder.

## tasks.md structure (full specs)

`tasks.md` needs a `## Notes` section (non-obvious decisions, what can be skipped) and a
`## Task Dependency Graph` section. The spec-gap-check hook (Kiro only) reports either when it is missing.
Most older specs lack the graph; bring one up to standard when you next work in it rather than
backfilling all of them at once.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1", "4.1"] }
  ]
}
```

Tasks in the same wave can run in parallel; each wave depends on all previous waves.

Waves list required tasks only. Optional tasks (an asterisk after the checkbox,
`- [ ]* 3.2`) go in a sibling `## Optional Task Dependencies` section: a separate fenced JSON
block mapping each optional task to the task it depends on. Keep them out of the `waves`
object, because Kiro parses it and only understands `id` and `tasks`.

```json
{ "waves": [ { "id": 0, "tasks": ["1.1"] } ] }
```
```json
{ "3.2": "3.1", "4.2": "4.1" }
```

The split prevents a deadlock: Run all Tasks never queues optional tasks, so an optional task
inside a wave never resolves and stalls that wave and every later one.

Checkpoint tasks are required, so they belong in the waves; they are the ones most often left
out.
