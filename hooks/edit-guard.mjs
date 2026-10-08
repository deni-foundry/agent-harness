/**
 * Blocks the agent from editing a file rulesync generates, and points it at the source.
 *
 * Usage: `node edit-guard.mjs <claude|cursor|kiro>` as a pre-tool-use hook on write tools.
 * Each IDE expects a different reply to a blocked call:
 *   claude — exit 2; stderr is shown to Claude as the reason.
 *   cursor — JSON `{ permission: "deny", agent_message }` on stdout. Cursor blocks any
 *            permission hook whose output is not valid JSON, so "allow" is explicit too.
 *   kiro   — a non-zero exit; stderr is sent to the agent and the tool call is blocked.
 *
 * Fails open: an internal error allows the edit, because a broken guard must not stop
 * all writes. `rulesync generate --check` in CI is the backstop.
 */

import { readHookInput, targetPaths } from './lib/hook-io.mjs';
import { loadConfig, projectRoot } from './lib/config.mjs';
import { generatedTargets, guardMessage } from './lib/generated-paths.mjs';

const ide = process.argv[2];

function allow() {
  if (ide === 'cursor') process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
}

function deny(message) {
  if (ide === 'cursor') {
    process.stdout.write(
      JSON.stringify({ permission: 'deny', user_message: 'Blocked an edit to a generated file.', agent_message: message }),
    );
    process.exit(0);
  }
  process.stderr.write(message);
  process.exit(2);
}

try {
  const payload = await readHookInput();
  const root = projectRoot(payload?.cwd || process.cwd());
  const config = loadConfig(root);
  const blocked = generatedTargets(targetPaths(payload), root, config.generated.extraPaths);
  if (blocked.length === 0) allow();
  else deny(guardMessage(blocked, config.syncCommand));
} catch {
  allow();
}
