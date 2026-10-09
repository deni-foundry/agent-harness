/**
 * Automatic adoption: finds rules, skills and subagents that appeared in `.claude/`,
 * `.cursor/` or `.kiro/` without a source (a downloaded skill, a rule made with an IDE's
 * "new rule" button), moves them into `.rulesync/` and syncs every IDE.
 *
 * Runs from the session-start and stop hooks and from the pre-commit check. Only new,
 * untracked files are adopted. An edit to a generated file is reported instead: its source
 * may be in the harness, and an IDE's format does not map back to a source cleanly.
 *
 * Settings, `.rulesync/harness.json`:
 *   "adopt": { "auto": true, "targets": "all" }   // "origin" keeps it for the IDE it came from
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isGenerated } from '../hooks/lib/generated-paths.mjs';
import { adopt, classify } from './adopt.mjs';
import { gitStatus, hashFile, readManifest } from './protect.mjs';
import { CONFIG_FILE, HARNESS_ROOT, planSync, rulesyncCli, sync } from './sync.mjs';

export function readAdoptConfig(projectDir) {
  try {
    const raw = JSON.parse(readFileSync(join(projectDir, CONFIG_FILE), 'utf8'))?.adopt ?? {};
    return { auto: raw.auto !== false, targets: raw.targets === 'origin' ? 'origin' : 'all' };
  } catch {
    return { auto: true, targets: 'all' };
  }
}

/** `skills/<name>`, `rules/<name>` or `subagents/<name>` for a classified IDE path. */
export function sourceKey(kind) {
  const name = basename(kind.unit).replace(/\.(md|mdc)$/, '');
  return `${kind.feature}/${name}`;
}

/** Every key the sync itself produces: sources from all trees plus the derived rules. */
function producedKeys(projectDir, harnessRoot) {
  const plan = planSync(projectDir, harnessRoot);
  const keys = new Set(Object.keys(plan.files).map((rel) => rel.replace(/\.md$/, '')));
  for (const tree of plan.trees) for (const e of tree.entries) keys.add(`${e.kind}/${e.name}`);
  return keys;
}

/**
 * New units to adopt and generated files edited by hand. A path counts as ours, and is
 * skipped, when it matches what the previous sync wrote or when a source already produces
 * its name (generated output that is simply not committed yet).
 */
export function findStrays(projectDir, { harnessRoot = HARNESS_ROOT } = {}) {
  const status = gitStatus(projectDir);
  if (status === null) return { units: [], edits: [] };
  const manifest = readManifest(projectDir);
  const produced = producedKeys(projectDir, harnessRoot);
  const units = new Map();
  const edits = [];
  for (const [file, code] of status) {
    if (!isGenerated(file) || !existsSync(join(projectDir, file))) continue;
    if (manifest[file] && manifest[file] === hashFile(join(projectDir, file))) continue;
    const kind = classify(file);
    const isNew = code === '??' || code[0] === 'A'; // not in the last commit, staged or not
    if (isNew && kind && !produced.has(sourceKey(kind))) units.set(kind.unit, kind);
    else edits.push(file);
  }
  return { units: [...units.values()], edits: edits.sort() };
}

/**
 * Adopt every stray unit and sync. Returns what happened; never throws, because callers are
 * hooks that must not fail a session.
 */
export function autoAdopt(projectDir, { harnessRoot = HARNESS_ROOT } = {}) {
  const result = { adopted: [], edits: [], problems: [], synced: null };
  try {
    const config = readAdoptConfig(projectDir);
    if (!config.auto) return result;
    const { units, edits } = findStrays(projectDir, { harnessRoot });
    result.edits = edits;
    if (units.length === 0) return result;

    const cli = rulesyncCli(projectDir, harnessRoot);
    if (!cli) {
      result.problems.push('rulesync is not installed');
      return result;
    }
    // One unit per source name: the first wins, later copies are reported for a human.
    const seen = new Set();
    const toAdopt = [];
    for (const kind of units) {
      const key = sourceKey(kind);
      if (seen.has(key)) result.problems.push(`${kind.unit}: another copy of ${key} was adopted first; compare the two and delete this one`);
      else {
        seen.add(key);
        toAdopt.push(kind.unit);
      }
    }
    const { adopted, problems } = adopt(projectDir, toAdopt, { cli, only: config.targets === 'origin' });
    result.adopted = adopted;
    result.problems.push(...problems);
    if (adopted.length > 0) result.synced = sync({ projectDir, harnessRoot, quiet: true }) === 0;
  } catch (error) {
    result.problems.push(error.message);
  }
  return result;
}

/** A short report for the user and the agent, or '' when there is nothing to say. */
export function describeResult(result, { syncCommand = 'npm run rules:sync' } = {}) {
  const lines = [];
  if (result.adopted.length > 0) {
    lines.push(
      `agent-harness adopted ${result.adopted.length === 1 ? 'a rule or skill' : `${result.adopted.length} rules or skills`} that existed only in an IDE folder into the source of truth:`,
      ...result.adopted.map((a) => `  - ${a.from} -> ${a.to.join(', ')}${a.notes.length ? ` (${a.notes.join('; ')})` : ''}`),
      result.synced
        ? 'Every IDE now has it. Review it in .rulesync/ and commit it, or delete it there if it was only an experiment.'
        : `The sync did not finish, so the other IDEs do not have it yet; run \`${syncCommand}\` and fix what it reports.`,
    );
  }
  if (result.edits.length > 0) {
    lines.push(
      'These generated files were changed directly; the next sync would overwrite them:',
      ...result.edits.map((f) => `  - ${f}`),
      'Carry each change over to the file named on its "> Source:" line, then delete the edited copy.',
    );
  }
  for (const p of result.problems) lines.push(`agent-harness: ${p}`);
  return lines.join('\n');
}
