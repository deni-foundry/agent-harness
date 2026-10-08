/**
 * Project settings for the harness hooks, read from `.rulesync/harness.json`.
 *
 * Every field is optional. A missing or unreadable file falls back to the defaults,
 * because a hook must never fail a turn over configuration.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONFIG_PATH = join('.rulesync', 'harness.json');

export const DEFAULTS = Object.freeze({
  syncCommand: 'npm run rules:sync',
  review: Object.freeze({
    watch: ['src'],
    extensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'css', 'scss', 'sql'],
    checks: [],
    conditionalChecks: [],
  }),
  generated: Object.freeze({ extraPaths: [] }),
});

const stringList = (value, fallback) =>
  Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : fallback;

/** Merge a parsed config object over the defaults, dropping fields of the wrong type. */
export function resolveConfig(raw) {
  const review = raw?.review ?? {};
  const conditional = Array.isArray(review.conditionalChecks)
    ? review.conditionalChecks.filter((c) => typeof c?.match === 'string' && stringList(c.checks, null))
    : DEFAULTS.review.conditionalChecks;

  return {
    syncCommand: typeof raw?.syncCommand === 'string' ? raw.syncCommand : DEFAULTS.syncCommand,
    review: {
      watch: stringList(review.watch, DEFAULTS.review.watch),
      extensions: stringList(review.extensions, DEFAULTS.review.extensions),
      checks: stringList(review.checks, DEFAULTS.review.checks),
      conditionalChecks: conditional,
    },
    generated: { extraPaths: stringList(raw?.generated?.extraPaths, DEFAULTS.generated.extraPaths) },
  };
}

/** The project's settings, or the defaults when there are none. */
export function loadConfig(root) {
  try {
    return resolveConfig(JSON.parse(readFileSync(join(root, CONFIG_PATH), 'utf8')));
  } catch {
    return resolveConfig({});
  }
}

/**
 * The project root: the git top level of `cwd` (which follows the agent into worktrees),
 * then Claude Code's project dir, then `cwd` itself.
 */
export function projectRoot(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.env.CLAUDE_PROJECT_DIR || cwd;
  }
}
