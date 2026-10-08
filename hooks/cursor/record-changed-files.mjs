/**
 * Records which files the agent wrote during a turn. Injects nothing into the
 * conversation — it exists purely so `end-of-turn-review.mjs` can scope its single
 * review to the files that actually changed.
 *
 * Event: postToolUse (matcher: Write, Delete)
 */

import { readHookInput, emit, targetPaths, recordChangedPaths } from '../lib/hook-io.mjs';
import { relevanceFilter } from '../lib/build-review.mjs';
import { loadConfig, projectRoot } from '../lib/config.mjs';

const payload = await readHookInput();
const isRelevant = relevanceFilter(loadConfig(projectRoot(payload?.cwd || process.cwd())).review);
recordChangedPaths(payload?.conversation_id, targetPaths(payload).filter(isRelevant));
emit({});
