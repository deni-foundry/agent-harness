/**
 * The pre-commit check and its installer.
 *
 * `agent-harness precommit` runs the sync check when a commit touches the agent files or
 * their sources, so drift is caught before it reaches CI. `agent-harness install-hooks`
 * writes the git hook that calls it; projects run it from their npm `prepare` script so every
 * clone gets it on `npm install`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isGenerated } from '../hooks/lib/generated-paths.mjs';
import { classify } from './adopt.mjs';
import { sourceKey } from './auto-adopt.mjs';
import { gitStatus } from './protect.mjs';

export const HOOK_MARKER = '# agent-harness pre-commit';

/** Paths whose change can make the generated agent files stale. */
export function touchesAgentFiles(paths, extraPaths = []) {
  return paths.some(
    (p) =>
      isGenerated(p, extraPaths) ||
      p.startsWith('.rulesync/') ||
      p === 'rulesync.jsonc' ||
      p === 'package.json' || // the harness version
      p === '.claude/settings.json', // carries the generated hooks
  );
}

export function stagedPaths(projectDir) {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { cwd: projectDir, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

/**
 * Stage what an adoption changed: the new sources, and the generated files of the adopted
 * names in every IDE folder (including a staged original, now replaced by its generated copy).
 */
export function stageAdopted(projectDir, adopted) {
  const keys = new Set(adopted.map((a) => sourceKey(classify(a.from))));
  const status = gitStatus(projectDir) ?? new Map();
  const paths = adopted.flatMap((a) => a.to);
  for (const file of status.keys()) {
    const kind = classify(file);
    if (kind && isGenerated(file) && keys.has(sourceKey(kind))) paths.push(file);
  }
  if (paths.length > 0) execFileSync('git', ['add', '-A', '--', ...new Set(paths)], { cwd: projectDir, stdio: 'ignore' });
}

export const PRECOMMIT_HELP = [
  'agent-harness: the agent files do not match their sources, so this commit is stopped.',
  '  - Changed .rulesync/ or the harness version? Run `npm run rules:sync` and stage the result.',
  '  - Added or edited a file in .claude/, .cursor/ or .kiro/ directly? Move a new rule or skill',
  '    into .rulesync/ with `npx agent-harness adopt <path>`, or carry an edit over to the file',
  '    named on its "> Source:" line, then run `npm run rules:sync`.',
  'The check compares the working tree, so unstaged changes count too. Skip it once with',
  '`git commit --no-verify` only if you know the files are right.',
].join('\n');

const SCRIPT = `#!/bin/sh
${HOOK_MARKER}: checks the agent instruction files against their sources.
# Installed by \`agent-harness install-hooks\` (npm prepare). Delete this file to turn it off.
if [ -f node_modules/@deni-foundry/agent-harness/bin/agent-harness.mjs ]; then
  exec node node_modules/@deni-foundry/agent-harness/bin/agent-harness.mjs precommit
fi
echo "agent-harness pre-commit: the harness is not installed in this checkout (npm install); skipping." >&2
exit 0
`;

/**
 * Write the pre-commit hook into git's hooks folder (shared by every worktree). Never
 * replaces a hook it did not write. Returns what happened, for the caller to report.
 */
export function installHooks(projectDir, { env = process.env } = {}) {
  if (env.CI) return { status: 'skipped', reason: 'CI' };
  let hooksDir;
  try {
    const rel = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    hooksDir = resolve(projectDir, rel);
  } catch {
    return { status: 'skipped', reason: 'not a git repository' };
  }
  const file = join(hooksDir, 'pre-commit');
  if (existsSync(file)) {
    const current = readFileSync(file, 'utf8');
    if (!current.includes(HOOK_MARKER)) return { status: 'conflict', file };
    if (current === SCRIPT) return { status: 'unchanged', file };
  }
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(file, SCRIPT, { mode: 0o755 });
  return { status: 'installed', file };
}
