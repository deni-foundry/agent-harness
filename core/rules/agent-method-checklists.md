---
targets: ["cursor"]
description: "Explicit verification checklists for IDEs that run several models: thoroughness, scope fence, quality check, delegation"
cursor:
  alwaysApply: true
---

> Source: agent-harness `core/rules/agent-method-checklists.md`. Edit it there; this copy is generated.

# Agent Method — Checklists

## Thoroughness & Verification

When asked to fix, replace, or audit something across the codebase:

1. Before making changes, search the entire relevant scope (grep/search all files, not just the ones currently open)
2. List all instances found and fix every one — don't stop after the first few files
3. After making changes, run a verification search to confirm zero remaining instances
4. Report the before/after count so the user can see completeness

When asked to "review for consistency" or "check for issues":
1. Do a systematic file-by-file scan — don't rely on memory or sampling
2. Create a checklist of what you're checking before you start
3. Report every issue you find rather than a representative sample. Keep each finding to a sentence or two: brevity belongs in the individual finding, not in how many you report

Never assume a task is done until you've verified it. "I fixed the ones I saw" is not complete — "I searched all files, found N instances, fixed all N, verified 0 remain" is complete.

## Scope Fence

Deliver what was asked, at the scope intended. Make routine judgment calls yourself, and check in only when different readings of the request would lead to materially different work. If the request seems mistaken or a better approach exists, say so in a sentence and continue with the task as asked rather than quietly widening or transforming it. A bug fix doesn't need the surrounding code cleaned up; a small feature doesn't need extra configurability.

## Quality Check Before Completion

Before considering a task complete, briefly scan these perspectives:

**Developer** — Does the code follow existing patterns? Imports from the right locations (shared constants, ui components)? No hardcoded values that should be constants or translations?

**Completeness** — If fixing a pattern across files: did I search ALL files? If adding a new component pattern: did I check if similar components should also be updated? Did I check for compile/lint errors on changed files?

**UX Consistency** — Does the change match the design system (tokens, spacing, colors)? Is the behavior consistent with similar features elsewhere?

**Security** — No sensitive data exposed in client-side code? Input validation and sanitization in place? RLS policies considered for new database operations?

## Subagent Delegation

If subagents are available, delegate only for large tracks of work that are genuinely independent and parallelizable — a wide multi-file investigation, or mapping an unfamiliar feature area. Don't delegate work you can finish yourself in a handful of tool calls; the coordination costs more than it saves.

Don't use a subagent to review or double-check your own work. A reviewer that inherits your context inherits your blind spots, so it tends to confirm the original reasoning rather than catch what it missed. Use the checklist above instead. If one subagent is enough, use one rather than several.
