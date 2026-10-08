/**
 * Working-tree change detection for Stop hooks that are not told which files changed
 * (Kiro's Stop payload carries no file list, and Claude Code shell commands name none).
 *
 * Reads `git status` and narrows it to files whose mtime advanced since the previous
 * call, so pre-existing uncommitted work is ignored.
 *
 * Deliberately NOT diffed against a stored HEAD: that would fix the rare case of the
 * agent committing mid-turn, at the cost of treating every pull, rebase or branch switch
 * as "changed this turn".
 *
 * Each caller passes its own `snapshotName` so hooks keep independent baselines and can
 * be enabled or disabled without disturbing each other. State is kept per repository, so
 * two projects using the harness never share a baseline.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function repoRoot() {
  try {
    return git(['rev-parse', '--show-toplevel']).trim();
  } catch {
    return process.cwd();
  }
}

function stateDir() {
  const key = createHash('sha1').update(repoRoot()).digest('hex').slice(0, 12);
  return join(tmpdir(), 'agent-harness', key);
}

function stateFile(name) {
  return join(stateDir(), `${name}.json`);
}

/** Read a state blob, or null when absent/unreadable. */
export function readState(name) {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(name), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist a state blob. Best-effort: a failure just re-baselines next turn. */
export function writeState(name, data) {
  try {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(stateFile(name), JSON.stringify(data), 'utf8');
  } catch {
    // Ignored on purpose.
  }
}

function mtimeOf(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/** Parsed `git status --porcelain` rows for the whole working tree. */
function workingTreeEntries() {
  const root = git(['rev-parse', '--show-toplevel']).trim();
  return git(['status', '--porcelain', '--untracked-files=all'])
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const status = line.slice(0, 2);
      const raw = line.slice(3).trim();
      // Renames report "old -> new"; keep the destination.
      const path = (raw.includes(' -> ') ? raw.split(' -> ')[1] : raw).replace(/^"|"$/g, '');
      return { status, path, absolute: resolve(root, path), isNew: status.trim() === '??' };
    });
}

/**
 * Files matching `matches(path)` that were touched since the previous call.
 *
 * Returns null when detection is unavailable (not a git repo, git missing) or on the
 * very first run, which only establishes the baseline — reporting every pre-existing
 * dirty file once would be pure noise.
 */
export function detectTouched(snapshotName, matches) {
  let entries;
  try {
    entries = workingTreeEntries();
  } catch {
    return null;
  }

  const relevant = entries.filter((entry) => matches(entry.path));
  const current = Object.fromEntries(relevant.map((e) => [e.absolute, mtimeOf(e.absolute)]));
  const previous = readState(snapshotName);
  writeState(snapshotName, current);

  if (previous === null) return null;

  return relevant.filter((e) => !(e.absolute in previous) || current[e.absolute] > previous[e.absolute]);
}
