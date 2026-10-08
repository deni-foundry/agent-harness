/**
 * Kiro spec alignment check (Agent Stop, Shell Command action).
 *
 * Runs at Stop, not on file create, so it never analyses a half-written plan.
 *
 * The prompt deliberately tells the agent NOT to edit the spec; rewriting tasks is the
 * job of the tasks-to-tdd workflow, which the user invokes on purpose.
 *
 * Two guards keep it quiet:
 *   1. Only a NEW spec counts (tasks.md still untracked in git), so ticking checkboxes
 *      in a committed plan does not re-trigger it.
 *   2. Each tasks.md is checked at most once.
 *
 * Exits 0 always; stdout (when non-empty) is added to the agent's context.
 */

import { detectTouched, readState, writeState } from '../lib/detect-changes.mjs';

const SPEC_TASKS = /(?:^|[\\/])\.kiro[\\/]specs[\\/].*tasks\.md$/i;
const CHECKED_STATE = 'kiro-spec-alignment-checked';

const prompt = (specPaths) => `A new spec task plan was just written (${specPaths.join(', ')}). Now that the file is complete, analyze the requirements, design, and implementation tasks for alignment. Perform the following checks:

1. **Requirements Coverage**: Verify that every requirement has corresponding tasks in the implementation plan
2. **Scope Compliance**: Ensure no tasks exist that fall outside the defined requirements
3. **Design Alignment**: Check that the design properly addresses all requirements and that tasks implement the design

For each issue found, provide:
- The specific requirement/design/task that is misaligned
- The nature of the misalignment (missing coverage, out of scope, design gap)
- Concrete remediation steps (update requirements, add tasks, remove tasks, clarify design)

Present findings ONE-BY-ONE, with recommendations in order from best recommendation to least, in a clear, actionable format with severity levels (Critical, Important, Minor). Give options and a recommendation. Report every misalignment you find rather than a representative sample; keep each one to a sentence or two.

Review the requirements.md, design.md and tasks.md in the same spec folder. Do not change any of them yet — wait for the user to decide which findings to act on.`;

try {
  const touched = detectTouched('kiro-spec-alignment', (path) => SPEC_TASKS.test(path));

  if (touched && touched.length > 0) {
    // Untracked means the spec is new rather than an existing plan being updated.
    const newPlans = touched.filter((entry) => entry.isNew).map((entry) => entry.path);
    const alreadyChecked = readState(CHECKED_STATE)?.paths ?? [];
    const pending = newPlans.filter((path) => !alreadyChecked.includes(path));

    if (pending.length > 0) {
      writeState(CHECKED_STATE, { paths: [...alreadyChecked, ...pending] });
      process.stdout.write(prompt(pending));
    }
  }
} catch {
  // Advisory only; never block the turn.
}

process.exit(0);
