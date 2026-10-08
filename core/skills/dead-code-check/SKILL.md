---
name: dead-code-check
description: "Manually triggered audit for exported functions and classes in library code that no application code imports, and barrel exports with zero external consumers. Reports findings as a list with file paths."
targets: ["claudecode", "cursor"]
disable-model-invocation: true
---

> Source: agent-harness `core/skills/dead-code-check/SKILL.md`. Edit it there; this copy is generated.

Run a dead code audit: search for exported functions/classes in the project's library code (for example `src/lib/`) that are never imported by its application code (for example `src/components/` or `src/hooks/`); check the repo layout first and adapt the folders. Check barrel files (index.ts) for exports with zero external consumers. Also check for @deprecated annotations and files that are exported from barrels but have no imports from outside their own directory. Report findings as a concise list with file paths and recommended action (delete or investigate).
