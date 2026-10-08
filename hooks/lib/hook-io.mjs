/**
 * Shared plumbing for the Claude Code, Cursor and Kiro hooks.
 *
 * All three send a JSON payload on stdin. Everything here is advisory, so any parsing or
 * I/O problem resolves to "nothing to report" rather than an error.
 */

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Read and parse the hook payload. */
export async function readHookInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Write a JSON hook response. `{}` means "no opinion, carry on". */
export function emit(output) {
  process.stdout.write(JSON.stringify(output ?? {}));
}

/**
 * Path-ish string values from the tool input.
 *
 * The IDEs name a write tool's target differently (`path`, `file_path`, `target_file`, …),
 * so match any key that looks like one rather than guessing a single spelling. Only the
 * input is inspected, never file contents, so a document that merely mentions a path
 * can't be mistaken for an edit.
 */
export function targetPaths(payload) {
  const input = payload?.tool_input;
  if (!input || typeof input !== 'object') return [];
  return Object.entries(input)
    .filter(([key, value]) => typeof value === 'string' && /path|file|target/i.test(key))
    .map(([, value]) => value.replace(/["']/g, ''));
}

// ── Per-conversation scratch state ─────────────────────────────────────────────
// The recorder hook accumulates changed paths during a turn; the stop hook reads and
// clears them. Kept in the OS temp dir so the repo stays clean. Keyed by Cursor's
// `conversation_id` or Claude Code's `session_id`, both unique per chat.

const STATE_DIR = join(tmpdir(), 'agent-harness', 'changed-files');

function stateFile(conversationId) {
  const safeId = String(conversationId ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
  return join(STATE_DIR, `${safeId || 'unknown'}.json`);
}

/** Append paths to this conversation's changed-file list. */
export function recordChangedPaths(conversationId, paths) {
  if (paths.length === 0) return;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const merged = [...new Set([...readChangedPaths(conversationId), ...paths])];
    writeFileSync(stateFile(conversationId), JSON.stringify(merged), 'utf8');
  } catch {
    // Recording is best-effort; a failure just means no review this turn.
  }
}

/** Read this conversation's changed-file list. */
export function readChangedPaths(conversationId) {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(conversationId), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Drop the list so the next turn starts fresh. */
export function clearChangedPaths(conversationId) {
  try {
    rmSync(stateFile(conversationId), { force: true });
  } catch {
    // Nothing to clean up.
  }
}
