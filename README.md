# agent-harness

Shared agent instructions, skills, subagents and hooks for Claude Code, Cursor and Kiro IDE.
Each project installs a tagged version and generates every IDE's files with
[rulesync](https://github.com/dyoshikawa/rulesync), layering its own `.rulesync/` on top.

## Layout

```
core/            rulesync source tree for every project: rules/, skills/, subagents/,
                 hooks.jsonc, mcp.jsonc
stacks/<name>/   one rulesync source tree per technology (supabase, react-vite, …);
                 a project picks the stacks it uses
hooks/           the scripts core/hooks.jsonc runs, one adapter folder per IDE
test/            node --test suites for the hook scripts
```

## Using it in a project

1. Install a tag as a dev dependency, plus rulesync pinned to an exact version:

   ```bash
   npm i -D github:deni-foundry/agent-harness#v0.1.0 rulesync@28.0.0
   ```

2. Add `rulesync.jsonc`:

   ```jsonc
   {
     "targets": ["claudecode", "cursor", "kiro-ide"],
     "features": ["rules", "skills", "subagents", "hooks", "mcp"],
     "delete": true
   }
   ```

3. Add the scripts. Later input roots override earlier ones file by file, so the project
   comes last:

   ```json
   "rules:sync": "rulesync generate --input-roots node_modules/@deni-foundry/agent-harness/core node_modules/@deni-foundry/agent-harness/stacks/<name> .rulesync",
   "rules:check": "rulesync generate --check --input-roots <same roots>"
   ```

   Run `rules:check` in CI.

4. Mark the generated paths LF in `.gitattributes`. On a CRLF checkout `--check` otherwise
   reports `.mdc` files as stale:

   ```
   .claude/** text eol=lf
   .cursor/** text eol=lf
   .kiro/** text eol=lf
   .mcp.json text eol=lf
   ```

5. Optionally tune the hooks in `.rulesync/harness.json`:

   ```json
   {
     "syncCommand": "npm run rules:sync",
     "review": {
       "watch": ["src", "supabase"],
       "extensions": ["ts", "tsx", "sql", "scss"],
       "checks": ["i18n — new strings use t() with keys in every locale file."],
       "conditionalChecks": [
         { "match": "supabase/migrations/[^/]+\\.sql$", "checks": ["Seed and reset scripts match the migration."] }
       ]
     },
     "generated": { "extraPaths": [] }
   }
   ```

   `review` drives the end-of-turn review: which changed files trigger it and the
   project-specific checks it asks for after the universal completeness check.
   `generated.extraPaths` adds files or directories (trailing `/`) to the edit guard.

The hooks run from `node_modules`, so they need `npm install` to have run in that checkout,
including a fresh worktree.

## Writing sources

- **Always-on rule**: omit `globs` and add `cursor: { alwaysApply: true }`. `globs: ["**/*"]`
  is wrong: Claude turns it into `paths`, which loads only after a file is read.
- **Path-scoped rule**: `globs`, plus `kiro: { inclusion: fileMatch, fileMatchPattern }`.
- **No `root: true` rule**: it makes Kiro write an `AGENTS.md` listing `.kiro/steering`
  paths, which Cursor also reads. rulesync warns that no root exists; that is expected.
- **User-only workflow**: a skill with `disable-model-invocation: true` and
  `targets: ["claudecode", "cursor"]`, plus a `kiro-ide`-only rule with
  `kiro: { inclusion: manual }` and the same body. Kiro skills have no user-only flag, so a
  Kiro skill would let the agent run the workflow on its own.
- **Source line**: start every body with
  `> Source: <where this file lives>. Edit it there; this copy is generated.` Claude strips
  HTML comments, so a comment banner never reaches the agent.
- **Hooks**: only `core/hooks.jsonc`. A `hooks.jsonc` in any later input root replaces this
  one whole; MCP config, by contrast, merges across roots.

## Hooks

| Script                            | IDE         | Event               | Does                                                    |
|-----------------------------------|-------------|---------------------|---------------------------------------------------------|
| `edit-guard.mjs <ide>`            | all three   | pre tool use        | Blocks edits to generated files, names the source       |
| `claude/record-changed-files.mjs` | Claude Code | pre/post tool use   | Records files changed this turn                         |
| `cursor/record-changed-files.mjs` | Cursor      | post tool use       | Records files changed this turn                         |
| `*/end-of-turn-review.mjs`        | all three   | stop                | One review of the turn's code changes, silent otherwise |
| `kiro/spec-gap-check.mjs`         | Kiro        | stop                | Reports a spec `tasks.md` missing required sections     |
| `kiro/spec-alignment-check.mjs`   | Kiro        | stop                | Asks for a requirements/design/tasks check of new specs |

All hooks are advisory except the edit guard, and every script fails open: an internal
error never blocks the agent. `rulesync generate --check` in CI is the backstop.

## Releasing

Run `npm test`, bump `version` in `package.json`, tag `vX.Y.Z` and push the tag. Projects
move by changing the tag in their `package.json`.
