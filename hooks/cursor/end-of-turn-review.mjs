/**
 * Single end-of-turn review. Asks the agent to audit the files it changed this turn,
 * and stays completely silent when the turn changed no code (questions, research,
 * read-only work) so those turns carry no overhead at all.
 *
 * Event: stop. The follow-up is submitted as the next user message, so it fires only
 * for a turn that actually completed and only on the first stop (`loop_count === 0`) —
 * paired with `loop_limit: 1` in hooks.json so the review can never chain into itself.
 */

import { readHookInput, emit, readChangedPaths, clearChangedPaths } from '../lib/hook-io.mjs';
import { buildReview } from '../lib/build-review.mjs';
import { loadConfig, projectRoot } from '../lib/config.mjs';

const payload = await readHookInput();
const conversationId = payload?.conversation_id;
const loopCount = typeof payload?.loop_count === 'number' ? payload.loop_count : 0;

const changed = readChangedPaths(conversationId);
// Always reset: the next turn should start from a clean slate whether or not a review
// runs, so a skipped turn can't leak its files into the following one.
clearChangedPaths(conversationId);

if (payload?.status !== 'completed' || loopCount > 0) {
  emit({});
} else {
  const root = projectRoot(payload?.cwd || process.cwd());
  const review = buildReview(changed, loadConfig(root).review, root);
  emit(review ? { followup_message: review } : {});
}
