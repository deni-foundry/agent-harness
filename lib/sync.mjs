/**
 * `agent-harness sync`: check the source trees, write the files rulesync cannot express
 * (Kiro rules for user-only skills, the index rule), then run `rulesync generate` over
 * every tree in order.
 *
 * Tree order is harness core, the project's stacks, the derived tree, the project. rulesync
 * lets a later tree replace an earlier file of the same path, so `validate` refuses a clash
 * unless `.rulesync/harness.json` lists it in `overrides`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitChangedPaths, parseDryRun, readManifest, unmanagedFiles, writeManifest } from './protect.mjs';
import { indexRule, isUserOnlySkill, kiroManualRule, readTree, validate } from './sources.mjs';

export const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_SOURCE = '.rulesync';
export const CONFIG_FILE = join(PROJECT_SOURCE, 'harness.json');
/** Rebuilt on every run, so it never needs committing or cleaning. */
export const DERIVED_DIR = join('node_modules', '.cache', 'agent-harness');
export const INDEX_RULE = 'harness-index';

/**
 * The fields of `.rulesync/harness.json` the sync reads (the hooks read the rest). Unlike the
 * hooks, which fall back to defaults, a sync stops on a malformed file: guessing would silently
 * drop a stack.
 */
export function readSyncConfig(projectDir) {
  const path = join(projectDir, CONFIG_FILE);
  if (!existsSync(path)) return { stacks: [], overrides: [] };
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const list = (field) => {
    const value = raw[field];
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      throw new Error(`${CONFIG_FILE}: "${field}" must be an array of strings`);
    }
    return [...new Set(value)];
  };
  return { stacks: list('stacks'), overrides: list('overrides') };
}

export function availableStacks(harnessRoot = HARNESS_ROOT) {
  const dir = join(harnessRoot, 'stacks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
}

/** The source trees in rulesync order, without the derived tree. */
export function sourceTrees(projectDir, stacks, harnessRoot = HARNESS_ROOT) {
  const known = availableStacks(harnessRoot);
  const unknown = stacks.filter((s) => !known.includes(s));
  if (unknown.length > 0) {
    throw new Error(`${CONFIG_FILE}: unknown stack(s) ${unknown.join(', ')}. Available: ${known.join(', ')}`);
  }
  return [
    { root: join(harnessRoot, 'core'), label: 'agent-harness core', sourcePrefix: 'agent-harness `core/' },
    ...stacks.map((s) => ({
      root: join(harnessRoot, 'stacks', s),
      label: `agent-harness stacks/${s}`,
      sourcePrefix: `agent-harness \`stacks/${s}/`,
    })),
    { root: join(projectDir, PROJECT_SOURCE), label: 'project', sourcePrefix: `\`${PROJECT_SOURCE}/` },
  ];
}

/** What rulesync will see: a later tree's entry replaces an earlier one of the same kind and name. */
export function effectiveEntries(trees) {
  const byKey = new Map();
  for (const { entries } of trees) {
    for (const e of entries) byKey.set(`${e.kind}/${e.name}`, e);
  }
  return [...byKey.values()];
}

/** Source rules that would collide with a derived file. */
export function reservedNameProblems(entries) {
  const rules = new Set(entries.filter((e) => e.kind === 'rules').map((e) => e.name));
  const problems = [];
  if (rules.has(INDEX_RULE)) {
    problems.push(`rules/${INDEX_RULE} is written by agent-harness sync; rename the source rule`);
  }
  for (const skill of entries.filter(isUserOnlySkill)) {
    if (rules.has(skill.name)) {
      problems.push(`rules/${skill.name} clashes with the Kiro rule derived from user-only skill "${skill.name}"; rename one`);
    }
  }
  return problems;
}

/** The derived tree's files, as relative path → content. */
export function derivedFiles(entries) {
  const files = { [`rules/${INDEX_RULE}.md`]: indexRule(entries) };
  for (const skill of entries.filter(isUserOnlySkill)) {
    files[`rules/${skill.name}.md`] = kiroManualRule(skill);
  }
  return files;
}

export function writeDerived(dir, files) {
  rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

/** The installed rulesync CLI, searched the way Node resolves a package: nearest `node_modules` upward. */
export function findRulesyncCli(projectDir) {
  let dir = resolve(projectDir);
  for (;;) {
    const pkgPath = join(dir, 'node_modules', 'rulesync', 'package.json');
    if (existsSync(pkgPath)) {
      const { bin } = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const rel = typeof bin === 'string' ? bin : bin?.rulesync;
      if (rel) return join(dirname(pkgPath), rel);
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Plan a sync without running rulesync: every problem, the derived files, and the input roots.
 * Absolute roots, because rulesync rejects `C:/…` but accepts native `C:\…` paths.
 */
export function planSync(projectDir, harnessRoot = HARNESS_ROOT) {
  const { stacks, overrides } = readSyncConfig(projectDir);
  const trees = sourceTrees(projectDir, stacks, harnessRoot).map((t) => ({
    ...t,
    entries: existsSync(t.root) ? readTree(t.root, t.label) : [],
  }));
  const entries = effectiveEntries(trees);
  const problems = [...validate(trees, { overrides }), ...reservedNameProblems(entries)];
  const derivedDir = resolve(projectDir, DERIVED_DIR);
  const roots = trees.map((t) => resolve(t.root));
  roots.splice(roots.length - 1, 0, derivedDir);
  return { problems, files: derivedFiles(entries), derivedDir, roots, trees };
}

/** The rulesync CLI for a project: its own install first, then the harness's. */
export function rulesyncCli(projectDir, harnessRoot = HARNESS_ROOT) {
  return findRulesyncCli(projectDir) ?? findRulesyncCli(harnessRoot);
}

/**
 * Run a sync; returns the process exit code. `extraArgs` go to `rulesync generate` as given.
 * A writing sync first refuses to overwrite or delete work that no source produced (see
 * `protect.mjs`); `force` skips that check. `quiet` keeps rulesync's output off stdout, which
 * a hook needs because its stdout is the reply to the IDE.
 */
export function sync({ projectDir = process.cwd(), check = false, force = false, quiet = false, extraArgs = [], harnessRoot = HARNESS_ROOT } = {}) {
  let plan;
  try {
    plan = planSync(projectDir, harnessRoot);
  } catch (error) {
    console.error(`agent-harness: ${error.message}`);
    return 1;
  }
  if (plan.problems.length > 0) {
    console.error(`agent-harness: ${plan.problems.length} problem(s) in the sources:`);
    for (const p of plan.problems) console.error(`  - ${p}`);
    return 1;
  }

  const cli = rulesyncCli(projectDir, harnessRoot);
  if (!cli) {
    console.error('agent-harness: rulesync is not installed; add it as an exact-version devDependency');
    return 1;
  }

  writeDerived(plan.derivedDir, plan.files);
  const generate = (mode) => [cli, 'generate', ...mode, ...extraArgs, '--input-roots', ...plan.roots];
  const writes = !check && !extraArgs.includes('--dry-run');
  const extraPaths = readHarnessConfig(projectDir).extraPaths;

  if (writes && !force) {
    const blocked = unmanagedChanges(projectDir, generate(['--dry-run']));
    if (blocked === null) return 1;
    if (blocked.length > 0) {
      console.error(
        `agent-harness: the sync would overwrite or delete ${blocked.length} file(s) that no source produced:\n` +
          blocked.map((f) => `  - ${f}`).join('\n') +
          '\n\nThese hold work outside the source of truth (a hand edit, an installed skill, a rule made in an IDE).\n' +
          'Keep a new rule or skill by moving it into .rulesync/:  npx agent-harness adopt <path>\n' +
          'Carry a hand edit over to the source named on its "> Source:" line, then delete the edited copy.\n' +
          'To discard them instead, run the sync with --force.',
      );
      return 1;
    }
  }

  const result = spawnSync(process.execPath, generate(check ? ['--check'] : []), { cwd: projectDir, stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit' });
  if (result.error) {
    console.error(`agent-harness: could not run rulesync: ${result.error.message}`);
    return 1;
  }
  if (writes && result.status === 0) writeManifest(projectDir, extraPaths);
  return result.status ?? 1;
}

/** Files a dry run would change that hold unmanaged work; null when the dry run fails. */
function unmanagedChanges(projectDir, dryRunArgs) {
  const changed = gitChangedPaths(projectDir);
  if (changed === null) return []; // not a git work tree: nothing to compare against
  const dry = spawnSync(process.execPath, dryRunArgs, { cwd: projectDir, encoding: 'utf8' });
  if (dry.error || dry.status !== 0) {
    console.error(`agent-harness: the dry run failed:\n${dry.stderr || dry.error?.message || ''}`);
    return null;
  }
  const planned = parseDryRun(`${dry.stdout}\n${dry.stderr}`, projectDir);
  return unmanagedFiles(projectDir, [...planned.write, ...planned.delete], { changed, manifest: readManifest(projectDir) });
}

function readHarnessConfig(projectDir) {
  try {
    const raw = JSON.parse(readFileSync(join(projectDir, CONFIG_FILE), 'utf8'));
    const extra = raw?.generated?.extraPaths;
    return { extraPaths: Array.isArray(extra) ? extra.filter((p) => typeof p === 'string') : [] };
  } catch {
    return { extraPaths: [] };
  }
}
