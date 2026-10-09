/**
 * Session-start and stop hook: adopts rules and skills that appeared only in an IDE folder
 * (see `lib/auto-adopt.mjs`) and tells the user and the agent what happened.
 *
 * Usage: `node auto-adopt.mjs <claude|cursor|kiro> <session-start|stop>`
 *   claude — JSON on stdout: `systemMessage` is shown to the user; at session start
 *            `additionalContext` also gives the agent the report.
 *   cursor — JSON on stdout. A stop reply that sends a follow-up would start another agent
 *            turn, so Cursor gets `{}` and sees the adoption as file changes.
 *   kiro   — plain stdout is added to the agent's context.
 *
 * Fails open: any error prints nothing a session would act on and exits 0.
 */

import { readHookInput } from './lib/hook-io.mjs';
import { loadConfig, projectRoot } from './lib/config.mjs';
import { autoAdopt, describeResult } from '../lib/auto-adopt.mjs';

const [ide, event] = process.argv.slice(2);

function reply(message) {
  if (ide === 'claude') {
    if (!message) return process.stdout.write('{}');
    const output = { systemMessage: message };
    if (event === 'session-start') output.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: message };
    return process.stdout.write(JSON.stringify(output));
  }
  if (ide === 'cursor') {
    if (message) process.stderr.write(`${message}\n`);
    return process.stdout.write('{}');
  }
  if (message) process.stdout.write(message);
}

try {
  const payload = ide === 'kiro' ? {} : await readHookInput();
  const root = projectRoot(payload?.cwd || process.cwd());
  const result = autoAdopt(root);
  // Hand edits are reported once per session, not after every turn.
  if (event === 'stop') result.edits = [];
  reply(describeResult(result, { syncCommand: loadConfig(root).syncCommand }));
} catch {
  reply('');
}
process.exit(0);
