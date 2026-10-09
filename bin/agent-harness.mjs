#!/usr/bin/env node
/**
 * agent-harness sync [--check] [--force] [other `rulesync generate` options]
 *   Generates every IDE's agent files from the harness and the project's `.rulesync/`.
 *   `--check` writes nothing and exits 1 when a generated file is out of date. A writing
 *   sync refuses to overwrite or delete work no source produced; `--force` discards it.
 * agent-harness adopt [--only] <path...>
 *   Moves a rule, skill or subagent that exists only in an IDE folder into `.rulesync/`,
 *   then syncs. `--only` keeps it for the IDE it came from instead of every IDE.
 * agent-harness precommit
 *   The git pre-commit check: runs `sync --check` when staged files touch agent files.
 * agent-harness install-hooks
 *   Installs that pre-commit hook; meant for the project's npm `prepare` script.
 */

import { adopt } from '../lib/adopt.mjs';
import { installHooks, PRECOMMIT_HELP, stagedPaths, touchesAgentFiles } from '../lib/git-hooks.mjs';
import { rulesyncCli, sync } from '../lib/sync.mjs';

const USAGE = `Usage:
  agent-harness sync [--check] [--force] [rulesync generate options]
  agent-harness adopt [--only] <path...>
  agent-harness precommit
  agent-harness install-hooks`;
const [command, ...rest] = process.argv.slice(2);
const projectDir = process.cwd();

function run() {
  switch (command) {
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
        console.error(USAGE);
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
    case '--help':
    case '-h':
      console.log(USAGE);
      return 0;

    default:
      console.error(`agent-harness: unknown command "${command}"\n${USAGE}`);
      return 1;
  }
}

process.exitCode = run();
