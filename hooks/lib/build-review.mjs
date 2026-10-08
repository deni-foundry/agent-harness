/**
 * Shared end-of-turn review builder for the Claude Code, Cursor and Kiro hooks.
 *
 * All three review once at end of turn rather than after every write. They detect
 * changed files differently (Claude and Cursor record the write tool's input; Kiro diffs
 * git + mtimes), but the checklist is built here so they cannot drift.
 *
 * The checklist is the one universal check below plus the project's own checks from
 * `.rulesync/harness.json`, which carry the knowledge a model cannot derive from the diff.
 */

import { isAbsolute, relative } from 'node:path';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CORE_CHECKS = [
  'Completeness — if this was a codebase-wide fix, replacement, or consistency audit, search for remaining instances and confirm none are left. Skip this if the user scoped the change to one specific file.',
];

/** A predicate for "code the review should care about", from the project's `review` settings. */
export function relevanceFilter({ watch, extensions }) {
  if (watch.length === 0 || extensions.length === 0) return () => false;
  const dir = new RegExp(`(?:^|[\\\\/])(?:${watch.map(escapeRegExp).join('|')})[\\\\/]`, 'i');
  const ext = new RegExp(`\\.(?:${extensions.map(escapeRegExp).join('|')})$`, 'i');
  return (filePath) => typeof filePath === 'string' && dir.test(filePath) && ext.test(filePath);
}

/** Shorten an absolute path to a repo-relative one for a compact prompt. */
function toDisplayPath(filePath, root) {
  const shown = root && isAbsolute(filePath) ? relative(root, filePath) : filePath;
  return shown.replace(/\\/g, '/');
}

/**
 * Build the review request for a set of changed paths, or null when there is nothing
 * worth reviewing (so the hook can stay completely silent).
 */
export function buildReview(changedPaths, review, root) {
  const isRelevant = relevanceFilter(review);
  const relevant = [...new Set(changedPaths.filter(isRelevant))];
  if (relevant.length === 0) return null;

  const conditional = review.conditionalChecks
    .filter(({ match }) => {
      try {
        const pattern = new RegExp(match, 'i');
        return relevant.some((path) => pattern.test(path.replace(/\\/g, '/')));
      } catch {
        return false; // an invalid pattern in the project config must not break the review
      }
    })
    .flatMap(({ checks }) => checks);

  const checks = [...CORE_CHECKS, ...review.checks, ...conditional]
    .map((check, index) => `${index + 1}. ${check}`)
    .join('\n');
  const fileList = relevant.map((p) => `- ${toDisplayPath(p, root)}`).join('\n');

  return `Review the work you just finished before ending your turn.

Files changed this turn:
${fileList}

Check the following against those files:
${checks}

Report every problem you find rather than a representative sample, naming the specific file and what is wrong. Keep each finding to a sentence or two — brevity belongs in the individual finding, not in how many you report. If nothing is wrong, say nothing and end your turn. If your previous message asked the user a question or presented options, do not answer it yourself — end your turn instead.`;
}
