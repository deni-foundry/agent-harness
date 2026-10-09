#!/usr/bin/env node
/**
 * The agent-harness command line. `agent-harness help` prints what every command does; the
 * README (next to this package, or on GitHub) has the full guide.
 */

import { createInterface } from 'node:readline/promises';
import { adopt } from '../lib/adopt.mjs';
import { autoAdopt, describeResult } from '../lib/auto-adopt.mjs';
import { catalog, formatCatalog } from '../lib/catalog.mjs';
import { installHooks, PRECOMMIT_HELP, stagedPaths, stageAdopted, touchesAgentFiles } from '../lib/git-hooks.mjs';
import { DEFAULT_TARGETS, init, NEXT_STEPS } from '../lib/init.mjs';
import { availableStacks, rulesyncCli, sync } from '../lib/sync.mjs';

const HELP = `agent-harness: one source of truth for Claude Code, Cursor and Kiro agent files.

Set up and choose
  init [--stacks a,b] [--targets claudecode,cursor,kiro-ide,kiro-cli] [--no-install] [--no-adopt]
      Sets this project up: dependencies, rulesync.jsonc, scripts, .gitattributes and
      .rulesync/harness.json. Moves agent files already in .claude/, .cursor/, .kiro/ or
      CLAUDE.md into .rulesync/ first, then installs and runs the first sync. Asks which
      stacks to use when --stacks is not given. Safe to run again.
      Without the harness installed yet:  npx github:deni-foundry/agent-harness init
  list
      Every rule, skill, subagent and stack the harness offers, and what this project uses
      (on, off, excluded, replaced by the project).

Generate
  sync [--check] [--force] [rulesync generate options]
      Generates every IDE's files from the harness and .rulesync/ (npm run rules:sync).
      --check writes nothing and fails when a file is stale (npm run rules:check, CI).
      Refuses to overwrite or delete work no source produced; --force discards it.
  adopt [--only] <path...>
      Moves a rule, skill or subagent that exists only in an IDE folder into .rulesync/ and
      syncs. --only keeps it for the IDE it came from. Runs on its own from the session
      hooks and the pre-commit check, so it is rarely needed by hand.

Git
  precommit       The pre-commit check: adopts stray files, then checks the agent files.
  install-hooks   Installs that check as a git pre-commit hook (npm prepare does this).

Settings live in .rulesync/harness.json: "stacks", "exclude", "overrides", "adopt",
"review", "generated". Guide: node_modules/@deni-foundry/agent-harness/README.md or
https://github.com/deni-foundry/agent-harness`;

const [command, ...rest] = process.argv.slice(2);
const projectDir = process.cwd();

/** The value after `--name`, split on commas; undefined when the flag is absent. */
function listFlag(name) {
  const i = rest.indexOf(`--${name}`);
  if (i < 0) return undefined;
  return String(rest[i + 1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function askStacks() {
  const stacks = availableStacks();
  if (!process.stdin.isTTY || stacks.length === 0) return [];
  console.log('Stacks (technology-specific rules and skills; `npx agent-harness list` shows their contents):');
  stacks.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Which ones does this project use? Numbers or names, comma-separated (Enter for none): ');
  rl.close();
  return answer
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^\d+$/.test(s) ? stacks[Number(s) - 1] : s))
    .filter(Boolean);
}

async function run() {
  switch (command) {
    case 'init': {
      const stacks = listFlag('stacks') ?? (await askStacks());
      const result = init(projectDir, {
        stacks,
        targets: listFlag('targets') ?? DEFAULT_TARGETS,
        install: !rest.includes('--no-install'),
        adoptExisting: !rest.includes('--no-adopt'),
      });
      for (const d of result.done) console.log(`done: ${d}`);
      for (const n of result.notes) console.log(`moved: ${n}`);
      for (const p of result.problems) console.error(`agent-harness: ${p}`);
      if (rest.includes('--no-install') && result.problems.length === 0) {
        console.log('Run `npm install`, then `npm run rules:sync`.');
      }
      console.log(`\n${NEXT_STEPS}`);
      return result.problems.length > 0 ? 1 : 0;
    }

    case 'list':
      console.log(formatCatalog(catalog(projectDir)));
      return 0;

    case 'sync':
      return sync({
        projectDir,
        check: rest.includes('--check'),
        force: rest.includes('--force'),
        extraArgs: rest.filter((arg) => arg !== '--check' && arg !== '--force'),
      });

    case 'adopt': {
      const paths = rest.filter((arg) => !arg.startsWith('--'));
      if (paths.length === 0) {
        console.error('Usage: agent-harness adopt [--only] <path...>');
        return 1;
      }
      const cli = rulesyncCli(projectDir);
      if (!cli) {
        console.error('agent-harness: rulesync is not installed; add it as an exact-version devDependency');
        return 1;
      }
      const { adopted, problems } = adopt(projectDir, paths, { cli, only: rest.includes('--only') });
      for (const a of adopted) {
        console.log(`adopted ${a.from} -> ${a.to.join(', ')}`);
        for (const note of a.notes) console.log(`  note: ${note}`);
      }
      for (const p of problems) console.error(`agent-harness: ${p}`);
      if (adopted.length === 0) return 1;
      const status = sync({ projectDir });
      return problems.length > 0 ? 1 : status;
    }

    case 'precommit': {
      let staged;
      try {
        staged = stagedPaths(projectDir);
      } catch {
        return 0; // not a git repository: nothing to check
      }
      // Adopt new rules and skills found only in an IDE folder before checking.
      const adoption = autoAdopt(projectDir);
      if (adoption.adopted.length > 0) {
        const intoThisCommit = touchesAgentFiles(staged);
        if (intoThisCommit) stageAdopted(projectDir, adoption.adopted);
        console.error(
          `${describeResult({ ...adoption, edits: [] })}\n` +
            (intoThisCommit
              ? 'Staged into this commit.'
              : 'Not staged: this commit does not touch agent files, so commit the adoption on its own.'),
        );
        staged = stagedPaths(projectDir);
      } else if (adoption.problems.length > 0) {
        console.error(describeResult(adoption));
      }
      if (!touchesAgentFiles(staged)) return 0;
      const status = sync({ projectDir, check: true });
      if (status !== 0) console.error(`\n${PRECOMMIT_HELP}`);
      return status;
    }

    case 'install-hooks': {
      const result = installHooks(projectDir);
      if (result.status === 'installed') console.log(`agent-harness: installed the pre-commit check in ${result.file}`);
      if (result.status === 'conflict') {
        console.warn(
          `agent-harness: ${result.file} already exists and is not ours, so the pre-commit check is not installed.\n` +
            'Call `npx agent-harness precommit` from that hook to add it.',
        );
      }
      return 0; // never fail an install over a hook
    }

    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;

    default:
      console.error(`agent-harness: unknown command "${command}"\n\n${HELP}`);
      return 1;
  }
}

process.exitCode = await run();
