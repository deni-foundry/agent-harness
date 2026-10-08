/**
 * Kiro end-of-turn code review (Agent Stop, Shell Command action).
 *
 * One review per turn, only when code changed. Kiro's Stop payload names no files, so
 * changes are found by diffing git + mtimes against the previous turn.
 *
 * Contract (Kiro Shell Command action): exit 0 with stdout adds that text to the agent's
 * context; empty stdout adds nothing. Non-zero flags the hook as failed, so this always
 * exits 0.
 */

import { detectTouched } from '../lib/detect-changes.mjs';
import { buildReview, relevanceFilter } from '../lib/build-review.mjs';
import { loadConfig, projectRoot } from '../lib/config.mjs';

try {
  const root = projectRoot();
  const { review } = loadConfig(root);
  const touched = detectTouched('kiro-code-review', relevanceFilter(review));
  if (touched && touched.length > 0) {
    const request = buildReview(touched.map((entry) => entry.path), review, root);
    if (request) process.stdout.write(request);
  }
} catch {
  // Advisory only; never block the turn.
}

process.exit(0);
