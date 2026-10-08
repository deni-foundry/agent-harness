/**
 * Records which files Claude changed during a turn. Injects nothing into the
 * conversation — it exists purely so `end-of-turn-review.mjs` can scope its single
 * review to the files that actually changed.
 *
 * Events:
 *   PostToolUse (Write|Edit|MultiEdit|NotebookEdit) — the target is in the tool input.
 *   PreToolUse + PostToolUse/PostToolUseFailure (Bash|PowerShell) — Claude also edits
 *   through shell commands, which name no file. The working tree is snapshotted before
 *   the command and diffed after it (a failed command can still have written files), so
 *   only what that command touched is recorded, not the user's own edits in an editor.
 */

import { readHookInput, emit, targetPaths, recordChangedPaths } from '../lib/hook-io.mjs';
import { relevanceFilter } from '../lib/build-review.mjs';
import { loadConfig, projectRoot } from '../lib/config.mjs';
import { detectTouched } from '../lib/detect-changes.mjs';

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

const payload = await readHookInput();
const sessionId = payload?.session_id;
const isRelevant = relevanceFilter(loadConfig(projectRoot(payload?.cwd || process.cwd())).review);

if (SHELL_TOOLS.has(payload?.tool_name)) {
  // `cwd` follows Claude into worktrees; the hook process itself starts at the project root.
  try {
    if (payload.cwd) process.chdir(payload.cwd);
  } catch {
    // Fall back to the project root.
  }
  const snapshot = `claude-shell-${String(sessionId ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // PreToolUse establishes the baseline; the Post events report what changed since it.
  const touched = detectTouched(snapshot, isRelevant);
  if (payload.hook_event_name !== 'PreToolUse' && touched) {
    recordChangedPaths(sessionId, touched.map((entry) => entry.absolute));
  }
} else {
  recordChangedPaths(sessionId, targetPaths(payload).filter(isRelevant));
}

emit({});
