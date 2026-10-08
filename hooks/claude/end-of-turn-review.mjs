/**
 * Single end-of-turn review. Asks Claude to audit the files it changed this turn, and
 * stays completely silent when the turn changed no code (questions, research, read-only
 * work) so those turns carry no overhead at all.
 *
 * Event: Stop. `additionalContext` keeps Claude working with the review as its next
 * instruction, labelled as hook feedback rather than a hook error (which is what
 * `decision: "block"` would show). `stop_hook_active` is set when Claude is already
 * continuing because of a Stop hook, so the review can never chain into itself.
 */

import { readHookInput, emit, readChangedPaths, clearChangedPaths } from '../lib/hook-io.mjs';
import { buildReview } from '../lib/build-review.mjs';
import { loadConfig, projectRoot } from '../lib/config.mjs';

const payload = await readHookInput();
const sessionId = payload?.session_id;

const changed = readChangedPaths(sessionId);
// Always reset: the next turn should start from a clean slate whether or not a review
// runs, so a skipped turn can't leak its files into the following one.
clearChangedPaths(sessionId);

const root = projectRoot(payload?.cwd || process.cwd());
const review = payload?.stop_hook_active ? null : buildReview(changed, loadConfig(root).review, root);
emit(review ? { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: review } } : {});
