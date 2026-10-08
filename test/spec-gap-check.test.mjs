/**
 * Decision logic of the Kiro spec tasks structure hook: checkbox-only edits stay silent,
 * complete files stay silent, missing sections are reported, Quick Specs are skipped.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contentKey, evaluate, missingSections, stripCheckboxes } from '../hooks/kiro/spec-gap-check.mjs';

const PATH = '.kiro/specs/demo/tasks.md';
const ENTRY = { path: PATH, absolute: `/repo/${PATH}` };
const COMPLETE = '# Tasks\n\n- [ ] 1. Build it\n\n## Notes\n\n## Task Dependency Graph\n';
const NO_GRAPH = '# Tasks\n\n- [ ] 1. Build it\n\n## Notes\n';

const deps = (text, head = null, quick = false) => ({
  readFile: () => text,
  readHead: () => head,
  isQuick: () => quick,
});

describe('stripCheckboxes', () => {
  it('erases every checkbox state', () => {
    const states = ['- [ ] 1.1', '- [x] 1.1', '- [X] 1.1', '- [-] 1.1', '- [~] 1.1'].map(stripCheckboxes);
    assert.equal(new Set(states).size, 1);
  });

  it('erases optional-task checkbox states', () => {
    assert.equal(stripCheckboxes('  - [ ]* 3.2'), stripCheckboxes('  - [x]* 3.2'));
  });

  it('ignores line endings', () => {
    assert.equal(contentKey('- [ ] a\r\n'), contentKey('- [x] a\n'));
  });
});

describe('missingSections', () => {
  it('finds none, one or both', () => {
    assert.deepEqual(missingSections(COMPLETE), []);
    assert.deepEqual(missingSections(NO_GRAPH), ['## Task Dependency Graph']);
    assert.deepEqual(missingSections('# Tasks\n'), ['## Notes', '## Task Dependency Graph']);
  });
});

describe('evaluate', () => {
  it('skips a checkbox-only change against a stored key', () => {
    const ticked = NO_GRAPH.replace('[ ]', '[x]');
    const { reports } = evaluate([ENTRY], { previousKeys: { [PATH]: contentKey(NO_GRAPH) }, ...deps(ticked) });
    assert.deepEqual(reports, []);
  });

  it('skips a checkbox-only change against HEAD', () => {
    const ticked = NO_GRAPH.replace('[ ]', '[-]');
    const { reports } = evaluate([ENTRY], deps(ticked, NO_GRAPH));
    assert.deepEqual(reports, []);
  });

  it('reports a real edit that lacks the dependency graph', () => {
    const edited = `${NO_GRAPH}\n- [ ] 2. Another task\n`;
    const { reports, keys } = evaluate([ENTRY], deps(edited, NO_GRAPH));
    assert.deepEqual(reports, [{ path: PATH, missing: ['## Task Dependency Graph'] }]);
    assert.equal(keys[PATH], contentKey(edited));
  });

  it('stays silent for a complete file', () => {
    const { reports } = evaluate([ENTRY], deps(`${COMPLETE}extra\n`, COMPLETE));
    assert.deepEqual(reports, []);
  });

  it('skips a Quick Spec', () => {
    const { reports } = evaluate([ENTRY], deps('# Tasks\n', null, true));
    assert.deepEqual(reports, []);
  });

  it('reports a new untracked file with missing sections', () => {
    const { reports } = evaluate([ENTRY], deps('- [ ] 1. Do x\n', null));
    assert.deepEqual(reports, [{ path: PATH, missing: ['## Notes', '## Task Dependency Graph'] }]);
  });

  it('skips a file deleted this turn', () => {
    const { reports } = evaluate([ENTRY], deps(null, NO_GRAPH));
    assert.deepEqual(reports, []);
  });
});
