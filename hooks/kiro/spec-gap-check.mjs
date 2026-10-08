/**
 * Kiro spec tasks structure check (Agent Stop, Shell Command action).
 *
 * Deterministic and silent by default: it prints only when a full spec's tasks.md that
 * changed this turn lacks a section the spec-readiness rule requires. It never asks the
 * model for an open-ended review, because that cost a review pass on every spec edit and
 * mostly restated what the model had just checked.
 *
 * Skipped:
 * - checkbox-only edits (ticking tasks while running them), detected by content: the file
 *   is compared with checkbox states stripped against the last version this hook saw, or
 *   HEAD when it has seen none;
 * - Quick Specs (`.config.kiro` with `workflowType: fast-task`), which have no tasks.md
 *   sections to check;
 * - `_archive/`, which is finished by definition.
 *
 * Exits 0 always; stdout (when non-empty) is added to the agent's context.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { detectTouched, readState, writeState } from '../lib/detect-changes.mjs';

/** A full spec's task plan, outside `_archive/`. */
const TASKS_FILE = /(?:^|[\\/])\.kiro[\\/]specs[\\/](?!_archive[\\/])[^\\/]+[\\/]tasks\.md$/i;

/** Sections every full-spec tasks.md needs. */
export const REQUIRED_TASKS_SECTIONS = ['## Notes', '## Task Dependency Graph'];

const CONTENT_STATE = 'kiro-spec-gap-content';

/** The text with every task checkbox state (`[ ]`, `[x]`, `[-]`, `[~]`, optional `*`) erased. */
export function stripCheckboxes(text) {
  return text.replace(/\r\n/g, '\n').replace(/^(\s*-\s*\[)[ xX~-](\]\*?)/gm, '$1$2');
}

/** A key that is equal for two versions differing only in checkbox states. */
export function contentKey(text) {
  return createHash('sha1').update(stripCheckboxes(text)).digest('hex');
}

export function missingSections(text) {
  return REQUIRED_TASKS_SECTIONS.filter((section) => !text.includes(section));
}

/** True when the spec folder's `.config.kiro` marks it as a Quick Spec. */
export function isQuickSpec(specDir) {
  try {
    return JSON.parse(readFileSync(join(specDir, '.config.kiro'), 'utf8')).workflowType === 'fast-task';
  } catch {
    return false;
  }
}

/**
 * Decide what to report for the touched tasks.md entries.
 *
 * `entries` are `{ path, absolute }` from detectTouched. `previousKeys` maps a path to the
 * content key this hook last saw; `readFile`, `readHead` and `isQuick` are injected so the
 * decision can be tested without git or a working tree.
 */
export function evaluate(entries, { previousKeys = {}, readFile, readHead, isQuick }) {
  const keys = { ...previousKeys };
  const reports = [];

  for (const entry of entries) {
    const text = readFile(entry.absolute);
    if (text === null) continue; // deleted or renamed this turn

    const key = contentKey(text);
    let baseline = previousKeys[entry.path];
    if (baseline === undefined) {
      const head = readHead(entry.path);
      if (head !== null) baseline = contentKey(head);
    }
    if (baseline === key) continue; // checkbox-only change

    keys[entry.path] = key;
    if (isQuick(dirname(entry.absolute))) continue;

    const missing = missingSections(text);
    if (missing.length > 0) reports.push({ path: entry.path, missing });
  }

  return { reports, keys };
}

export function formatReport(reports) {
  const lines = reports.map((r) => `- ${r.path}: ${r.missing.join(', ')}`);
  return [
    'Spec task plans missing required sections (checked directly):',
    ...lines,
    'Add them using the "tasks.md structure" format in the spec-readiness rule; derive the waves from the existing task order and list required tasks only. If your previous message asked the user a question, do not answer it yourself: end your turn and add the sections after they reply.',
  ].join('\n');
}

function readFileOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function headReader() {
  let root;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return () => null;
  }
  return (path) => {
    try {
      return execFileSync('git', ['show', `HEAD:${path.replace(/\\/g, '/')}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return null; // untracked or new since HEAD
    }
  };
}

function main() {
  const touched = detectTouched('kiro-spec-gap', (path) => TASKS_FILE.test(path));
  if (!touched || touched.length === 0) return;

  const state = readState(CONTENT_STATE);
  const { reports, keys } = evaluate(touched, {
    previousKeys: state?.keys ?? {},
    readFile: readFileOrNull,
    readHead: headReader(),
    isQuick: isQuickSpec,
  });
  writeState(CONTENT_STATE, { keys });

  if (reports.length > 0) process.stdout.write(formatReport(reports));
}

function isMain() {
  return Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);
}

if (isMain()) {
  try {
    main();
  } catch {
    // Advisory only; never block the turn.
  }
  process.exit(0);
}
