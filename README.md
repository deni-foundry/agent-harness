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
bin/, lib/       the `agent-harness sync` command
test/            node --test suites for the hook scripts and the sync
```

Stacks: `supabase` (patterns, hosted-database safety, MCP, troubleshooting), `github-actions`
(CI and deploy pitfalls with Supabase and Cloudflare), `playwright`, `fast-check`,
`framer-motion`, `react-vite` (lazy routes, caching, load and error states, the global Sass
bundle, troubleshooting).

## Using it in a project

1. Install a tag as a dev dependency, plus rulesync pinned to an exact version:

   ```bash
   npm i -D github:deni-foundry/agent-harness#v0.3.0
   npm i -D -E rulesync@28.0.0
   ```

   The repository is public, so installing it needs no GitHub credentials, in CI or anywhere
   else. The lockfile records it as a `git+ssh://` URL, but npm downloads public GitHub
   dependencies over HTTPS, so a runner without an SSH key installs it too.

2. Add `rulesync.jsonc`:

   ```jsonc
   {
     "targets": ["claudecode", "cursor", "kiro-ide", "kiro-cli"],
     "features": ["rules", "skills", "subagents", "hooks", "mcp"],
     "delete": true
   }
   ```

3. Add the scripts:

   ```json
   "rules:sync": "agent-harness sync",
   "rules:check": "agent-harness sync --check"
   ```

   `agent-harness sync` reads `.rulesync/harness.json`, checks every source (below), writes
   the derived files into `node_modules/.cache/agent-harness/`, then runs `rulesync generate`
   with the input roots in order: harness `core`, the project's stacks, the derived files,
   the project's `.rulesync`. Extra arguments go to `rulesync generate` (`--dry-run`,
   `--targets claudecode`, …). `--check` writes nothing and exits 1 when an output is stale.

4. Mark the generated paths LF in `.gitattributes`. On a CRLF checkout `--check` otherwise
   reports `.mdc` files as stale:

   ```
   .claude/** text eol=lf
   .cursor/** text eol=lf
   .kiro/** text eol=lf
   .mcp.json text eol=lf
   ```

5. Configure it in `.rulesync/harness.json`. Every field is optional:

   ```json
   {
     "stacks": ["supabase", "react-vite"],
     "overrides": [],
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

   `stacks` picks the stack trees to include. `overrides` lists project sources that replace a
   harness file of the same name on purpose (`"rules/workflow"`); any other clash stops the
   sync, because rulesync would silently keep only the later file. `review` drives the
   end-of-turn review: which changed files trigger it and the project-specific checks it asks
   for after the universal completeness check. `generated.extraPaths` adds files or
   directories (trailing `/`) to the edit guard.

The hooks run from `node_modules`, so they need `npm install` to have run in that checkout,
including a fresh worktree.

### What the sync adds

- **Checks** before anything is written: every source starts with its `> Source:` line, a
  skill's `name` equals its folder, every source has a `description`, and no name is defined
  twice except as a declared override.
- **Kiro rules for user-only workflows.** Kiro skills have no user-only flag, so for each skill
  with `disable-model-invocation: true` the sync writes a `kiro-ide` rule with
  `inclusion: manual` and the skill's body. The skill itself targets Claude Code and Cursor.
- **`harness-index`**, an always-on rule listing the path-scoped rules, the skills the agent may
  load and the workflows only the user starts, each with the first sentence of its
  description. It replaces a hand-kept index, which goes stale as soon as a rule is added.

`harness-index` and the user-only skills' names are reserved: a source rule may not use them.

### CI

Run `rules:check` after `npm ci` in a job that gates the build:

```yaml
- run: npm ci
- run: npm run rules:check
```

## Writing sources

- **Always-on rule**: omit `globs` and add `cursor: { alwaysApply: true }`. `globs: ["**/*"]`
  is wrong: Claude turns it into `paths`, which loads only after a file is read.
- **Path-scoped rule**: `globs`, plus `kiro: { inclusion: fileMatch, fileMatchPattern }`.
- **No `root: true` rule**: it makes Kiro write an `AGENTS.md` listing `.kiro/steering`
  paths, which Cursor also reads. rulesync warns that no root exists; that is expected.
- **User-only workflow**: a skill with `disable-model-invocation: true` and
  `targets: ["claudecode", "cursor"]`. The sync derives its Kiro rule; do not write one.
- **Source line**: start every body with
  `> Source: <where this file lives>. Edit it there; this copy is generated.` Claude strips
  HTML comments, so a comment banner never reaches the agent.
- **Hooks**: only `core/hooks.jsonc`. A `hooks.jsonc` in any later input root replaces this
  one whole; MCP config, by contrast, merges across roots.
- **MCP**: `core/mcp.jsonc` for servers every project gets, a stack's `mcp.jsonc` for servers
  every project on that stack gets, and the project's `.rulesync/mcp.jsonc` for its own. A later
  root's server with the same name replaces the earlier one; `{tool}.mcpServers.<name>: null`
  drops a server for one IDE. Write tokens as `${VAR}` (rulesync writes `${env:VAR}` for Cursor)
  and keep servers that need personal tokens in the user-level IDE configs.

## Model tuning

The working-method rules differ by IDE because the models differ, not the projects:

- `agent-method` — every IDE: evidence discipline, propose before implementing, layered
  enforcement, API version checks, table formatting.
- `agent-method-tuned` — Claude Code and Kiro, tuned for Opus 5.5 and Sonnet 5.5, which
  self-verify and delegate unprompted: no explicit verification pass, capped delegation.
  Effort per session: Opus 5.5 medium (high for spec design), Sonnet 5.5 medium or high,
  xhigh or max only for security/RLS reviews and hard debugging. Sonnet 5.5 at low effort may
  skip verification, which is why the end-of-turn review hook stays on.
- `agent-method-checklists` — Cursor, which runs several models interchangeably, so it keeps
  the explicit verification and quality checklists.
- `workflow` (Claude Code, Cursor) and `workflow-kiro` (Kiro's spec types and task scheduler)
  decide how much process a change gets.

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
error never blocks the agent. `rules:check` in CI is the backstop.

## Releasing

Run `npm test`, bump `version` in `package.json`, tag `vX.Y.Z` and push the tag. Projects
move by changing the tag in their `package.json`.
