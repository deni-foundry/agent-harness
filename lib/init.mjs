/**
 * `agent-harness init`: sets a project up in one go. Every step is skipped when its result is
 * already there, so running it again is safe.
 *
 * Existing agent files are adopted first. Without that, the first sync would delete them: a
 * committed, unmodified file in a generated folder looks like old output to the sync.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATED_DIRS } from '../hooks/lib/generated-paths.mjs';
import { adopt, classify } from './adopt.mjs';
import { availableStacks, CONFIG_FILE, HARNESS_ROOT, PROJECT_SOURCE, rulesyncCli, sync } from './sync.mjs';

export const DEFAULT_TARGETS = ['claudecode', 'cursor', 'kiro-ide', 'kiro-cli'];

const GITATTRIBUTES = `
# Agent instructions: the rulesync sources and everything \`npm run rules:sync\` generates.
# rulesync writes LF, so a CRLF checkout of either side makes \`rules:check\` report drift.
.rulesync/** text eol=lf
rulesync.jsonc text eol=lf
.claude/** text eol=lf
.cursor/** text eol=lf
.kiro/** text eol=lf
.mcp.json text eol=lf
`;

const harnessPackage = (harnessRoot) => JSON.parse(readFileSync(join(harnessRoot, 'package.json'), 'utf8'));

/** Every rule, skill or subagent unit already sitting in an IDE folder. */
export function existingUnits(projectDir) {
  const units = new Set();
  const walk = (rel) => {
    const abs = join(projectDir, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs)) walk(`${rel}/${name}`);
      return;
    }
    const kind = classify(rel);
    if (kind) units.add(kind.unit);
  };
  for (const dir of GENERATED_DIRS) walk(dir.replace(/\/$/, ''));
  return [...units].sort();
}

/** CLAUDE.md becomes an always-on project rule, since the sync deletes a hand-written one. */
function adoptClaudeMd(projectDir, notes) {
  const file = join(projectDir, 'CLAUDE.md');
  const dest = join(projectDir, PROJECT_SOURCE, 'rules', 'project-overview.md');
  if (!existsSync(file)) return;
  if (existsSync(dest)) {
    notes.push('CLAUDE.md was left in place: .rulesync/rules/project-overview.md already exists; merge it by hand');
    return;
  }
  const body = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim();
  mkdirSync(join(projectDir, PROJECT_SOURCE, 'rules'), { recursive: true });
  writeFileSync(
    dest,
    [
      '---',
      'targets: ["*"]',
      'description: "Project overview and conventions, moved from CLAUDE.md"',
      'cursor:',
      '  alwaysApply: true',
      '---',
      '',
      '> Source: `.rulesync/rules/project-overview.md`. Edit it there; this copy is generated.',
      '',
      body,
      '',
    ].join('\n'),
  );
  rmSync(file);
  notes.push('CLAUDE.md -> .rulesync/rules/project-overview.md (always on in every IDE)');
}

/**
 * Set the project up. Returns `{ done, notes, problems }` for the CLI to print; `install`
 * runs `npm install` and the first sync.
 */
export function init(projectDir, { stacks = [], targets = DEFAULT_TARGETS, install = true, adoptExisting = true, harnessRoot = HARNESS_ROOT } = {}) {
  const done = [];
  const notes = [];
  const problems = [];
  const pkgPath = join(projectDir, 'package.json');
  if (!existsSync(pkgPath)) {
    problems.push('no package.json here; run `npm init -y` first, then run init again');
    return { done, notes, problems };
  }
  const known = availableStacks(harnessRoot);
  const unknown = stacks.filter((s) => !known.includes(s));
  if (unknown.length > 0) {
    problems.push(`unknown stack(s) ${unknown.join(', ')}. Available: ${known.join(', ')}`);
    return { done, notes, problems };
  }

  // package.json: dependencies and scripts.
  const harness = harnessPackage(harnessRoot);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.devDependencies ??= {};
  pkg.scripts ??= {};
  let pkgChanged = false;
  if (!pkg.devDependencies[harness.name] && !pkg.dependencies?.[harness.name]) {
    pkg.devDependencies[harness.name] = `github:deni-foundry/agent-harness#v${harness.version}`;
    pkgChanged = true;
  }
  const rulesyncVersion = harness.devDependencies?.rulesync ?? harness.peerDependencies?.rulesync?.replace(/^\^/, '');
  if (!pkg.devDependencies.rulesync && !pkg.dependencies?.rulesync && rulesyncVersion) {
    pkg.devDependencies.rulesync = rulesyncVersion;
    pkgChanged = true;
  }
  const scripts = { 'rules:sync': 'agent-harness sync', 'rules:check': 'agent-harness sync --check' };
  for (const [name, command] of Object.entries(scripts)) {
    if (!pkg.scripts[name]) {
      pkg.scripts[name] = command;
      pkgChanged = true;
    }
  }
  if (!pkg.scripts.prepare) {
    pkg.scripts.prepare = 'agent-harness install-hooks';
    pkgChanged = true;
  } else if (!pkg.scripts.prepare.includes('agent-harness install-hooks')) {
    pkg.scripts.prepare = `${pkg.scripts.prepare} && agent-harness install-hooks`;
    pkgChanged = true;
  }
  if (pkgChanged) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    done.push('package.json: harness and rulesync dev dependencies, rules:sync, rules:check and prepare scripts');
  }

  // rulesync.jsonc
  const rulesyncConfig = join(projectDir, 'rulesync.jsonc');
  if (!existsSync(rulesyncConfig)) {
    writeFileSync(
      rulesyncConfig,
      `${JSON.stringify({ targets, features: ['rules', 'skills', 'subagents', 'hooks', 'mcp'], delete: true }, null, 2)}\n`,
    );
    done.push(`rulesync.jsonc: targets ${targets.join(', ')}`);
  }

  // .gitattributes
  const attributes = join(projectDir, '.gitattributes');
  const currentAttributes = existsSync(attributes) ? readFileSync(attributes, 'utf8') : '';
  if (!currentAttributes.includes('.rulesync/** text eol=lf')) {
    writeFileSync(attributes, `${currentAttributes.replace(/\s*$/, currentAttributes ? '\n' : '')}${GITATTRIBUTES}`.replace(/^\n/, ''));
    done.push('.gitattributes: LF for the sources and generated files');
  }

  // .rulesync/harness.json
  const configPath = join(projectDir, CONFIG_FILE);
  if (!existsSync(configPath)) {
    mkdirSync(join(projectDir, PROJECT_SOURCE), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify({ stacks, exclude: [] }, null, 2)}\n`);
    done.push(`${CONFIG_FILE.replace(/\\/g, '/')}: stacks ${stacks.length ? stacks.join(', ') : '(none yet)'}`);
  } else if (stacks.length > 0) {
    notes.push(`${CONFIG_FILE.replace(/\\/g, '/')} already exists, so --stacks was not applied; edit it directly`);
  }

  // Existing agent files move into the source before the first sync can delete them.
  if (adoptExisting) {
    adoptClaudeMd(projectDir, notes);
    const units = existingUnits(projectDir);
    if (units.length > 0) {
      const cli = rulesyncCli(projectDir, harnessRoot);
      if (!cli) {
        problems.push(`rulesync is not available to adopt ${units.length} existing file(s); after \`npm install\`, run \`npx agent-harness adopt ${units.join(' ')}\` before syncing`);
      } else {
        const { adopted, problems: adoptProblems } = adopt(projectDir, units, { cli });
        for (const a of adopted) notes.push(`${a.from} -> ${a.to.join(', ')}${a.notes.length ? ` (${a.notes.join('; ')})` : ''}`);
        problems.push(...adoptProblems);
      }
    }
  }

  if (install && problems.length === 0) {
    const npm = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: projectDir, stdio: 'inherit', shell: process.platform === 'win32' });
    if (npm.status !== 0) {
      problems.push('npm install failed; fix it, then run `npm run rules:sync`');
      return { done, notes, problems };
    }
    done.push('npm install (installs the harness, rulesync and the pre-commit hook)');
    if (sync({ projectDir, harnessRoot }) === 0) done.push('first sync: every IDE folder generated');
    else problems.push('the first sync did not finish; run `npm run rules:sync` and fix what it reports');
  }
  return { done, notes, problems };
}

export const NEXT_STEPS = [
  'Next:',
  '  npx agent-harness list          see every rule, skill and stack, and what this project uses',
  '  .rulesync/harness.json          turn stacks on ("stacks") or leave harness items out ("exclude")',
  '  .rulesync/rules/, skills/       add this project\'s own rules and skills, then `npm run rules:sync`',
  '  CI                              run `npm run rules:check` after `npm ci`',
  'The harness README explains everything: node_modules/@deni-foundry/agent-harness/README.md',
  'or https://github.com/deni-foundry/agent-harness',
].join('\n');
