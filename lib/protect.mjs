/**
 * Keeps a sync from destroying work that is not in the sources.
 *
 * With `delete: true`, rulesync overwrites every generated file that differs from its source
 * and deletes every file in a generated folder that no source produces. That is right for
 * its own output and wrong for a skill someone installed into `.claude/skills/`, a rule made
 * with an IDE's "new rule" button, or a hand edit. Before writing, the sync asks rulesync
 * for a dry run and refuses when it would change a file that neither matches the last commit
 * nor matches what the previous sync wrote.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { GENERATED_DIRS, GENERATED_FILES } from '../hooks/lib/generated-paths.mjs';

/** rulesync merges its hooks into this file and keeps every other key, so overwriting loses nothing. */
const MERGED_FILES = new Set(['.claude/settings.json']);

const toRel = (projectDir, path) =>
  (isAbsolute(path) ? relative(projectDir, path) : path).replace(/\\/g, '/');

/** The project-relative files a `rulesync generate --dry-run` would write or delete. */
export function parseDryRun(text, projectDir) {
  const plan = { write: [], delete: [] };
  for (const line of String(text).split(/\r?\n/)) {
    let m = line.match(/\[DRY RUN\] Would write: (.+?)\s*$/);
    if (m) {
      plan.write.push(toRel(projectDir, m[1]));
      continue;
    }
    m = line.match(/\[DRY RUN\] Would delete directory: (.+?)\s*$/);
    if (m) {
      let path = m[1];
      try {
        path = JSON.parse(path); // printed as a JSON string
      } catch {
        path = path.replace(/^"|"$/g, '');
      }
      plan.delete.push(toRel(projectDir, path));
      continue;
    }
    m = line.match(/\[DRY RUN\] Would delete: (.+?)\s*$/);
    if (m) plan.delete.push(toRel(projectDir, m[1]));
  }
  plan.write = [...new Set(plan.write)];
  plan.delete = [...new Set(plan.delete)];
  return plan;
}

const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function filesUnder(projectDir, rel) {
  const abs = join(projectDir, rel);
  if (!existsSync(abs)) return [];
  if (!statSync(abs).isDirectory()) return [rel];
  return readdirSync(abs).flatMap((name) => filesUnder(projectDir, `${rel}/${name}`));
}

/**
 * Git's two-letter status (`??` untracked, ` M` modified, …) of every untracked or changed
 * path, keyed by project-relative path; null outside a git work tree.
 */
export function gitStatus(projectDir) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const out = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const status = new Map();
    const entries = out.split('\0');
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.length < 4) continue;
      const code = entry.slice(0, 2);
      status.set(toRel(projectDir, join(top, entry.slice(3))), code);
      if (code.startsWith('R') || code.startsWith('C')) i++; // the original path follows a rename
    }
    return status;
  } catch {
    return null;
  }
}

/** Paths git reports as untracked or changed; null outside a git work tree (no protection is possible there). */
export function gitChangedPaths(projectDir) {
  const status = gitStatus(projectDir);
  return status === null ? null : new Set(status.keys());
}

export const hashFile = (path) => hash(path);

/** Outside the derived folder, which every sync recreates. */
export const MANIFEST = join('node_modules', '.cache', 'agent-harness-state', 'last-sync.json');

export function readManifest(projectDir) {
  try {
    return JSON.parse(readFileSync(join(projectDir, MANIFEST), 'utf8'));
  } catch {
    return {};
  }
}

/** Records the hash of every generated file, so the next sync recognises its own output. */
export function writeManifest(projectDir, extraPaths = []) {
  const roots = [...GENERATED_DIRS.map((d) => d.replace(/\/$/, '')), ...GENERATED_FILES, ...extraPaths.map((p) => p.replace(/\/$/, ''))];
  const manifest = {};
  for (const root of roots) {
    for (const rel of filesUnder(projectDir, root)) manifest[rel] = hash(join(projectDir, rel));
  }
  const path = join(projectDir, MANIFEST);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 1));
}

/**
 * The files among `paths` (a sync's planned writes and deletes) that hold work no source
 * produced: changed or untracked in git, and not what the previous sync wrote.
 */
export function unmanagedFiles(projectDir, paths, { changed, manifest }) {
  const result = [];
  for (const rel of paths) {
    for (const file of filesUnder(projectDir, rel)) {
      if (MERGED_FILES.has(file) || !changed.has(file)) continue;
      if (manifest[file] && manifest[file] === hash(join(projectDir, file))) continue;
      result.push(file);
    }
  }
  return [...new Set(result)].sort();
}
