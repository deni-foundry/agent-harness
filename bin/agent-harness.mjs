#!/usr/bin/env node
/**
 * agent-harness sync [--check] [other `rulesync generate` options]
 *
 * Generates every IDE's agent files from the harness and the project's `.rulesync/`.
 * `--check` writes nothing and exits 1 when a generated file is out of date.
 */

import { sync } from '../lib/sync.mjs';

const USAGE = 'Usage: agent-harness sync [--check] [rulesync generate options]';
const [command, ...rest] = process.argv.slice(2);

if (command === 'sync') {
  process.exitCode = sync({
    check: rest.includes('--check'),
    extraArgs: rest.filter((arg) => arg !== '--check'),
  });
} else if (command === undefined || command === '--help' || command === '-h') {
  console.log(USAGE);
} else {
  console.error(`agent-harness: unknown command "${command}"\n${USAGE}`);
  process.exitCode = 1;
}
