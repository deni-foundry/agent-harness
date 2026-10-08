---
targets: ["claudecode", "kiro-ide"]
description: "Working method for models that self-verify: scope before editing, capped delegation"
---

> Source: agent-harness `core/rules/agent-method-tuned.md`. Edit it there; this copy is generated.

# Agent Method — Scope and Delegation

## Scope Before Editing

When asked to fix, replace, or audit something across the codebase, establish the full scope **before** you start changing files:

1. Search the entire relevant scope first — all relevant files, not just the ones currently open (unless specified)
2. Work from that list and fix every instance; don't stop after the first few
3. If the user scoped the change to specific files, stay inside them

The failure mode this prevents is the partial sweep: three of eleven call sites updated because only three were visible. Enumerating up front is the fix — re-auditing afterwards is a more expensive way to reach the same place.

When the request is to review rather than to change, report every issue you find rather than a representative sample. Keep each finding to a sentence or two: brevity belongs in the individual finding, not in how many you report.

## Subagent Delegation

Delegate only for large tracks of work that are genuinely independent and parallelizable — a wide multi-file investigation, or mapping an unfamiliar feature area. Do not delegate work you can finish yourself in a handful of tool calls, and do not use a subagent to review or double-check your own work. If one subagent is enough, use one rather than several.

Do not read a file in the same turn as the subagent that writes it. Parallel reads
race the write and return missing, partial or stale content, which then has to be
re-read — and a stale read that looks plausible is worse than an empty one, because
it invites a wrong conclusion. Dispatch first, read the result afterwards.
