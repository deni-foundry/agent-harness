import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalog, formatCatalog, parseJsonc } from '../lib/catalog.mjs';
import { existingUnits, init } from '../lib/init.mjs';
import { applyExclusions, FILTERED_DIR, HARNESS_ROOT, planSync, rulesyncCli, sourceTrees, sync } from '../lib/sync.mjs';
import { readTree } from '../lib/sources.mjs';

function write(root, rel, content) {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const cli = rulesyncCli(HARNESS_ROOT);

describe('exclude', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'harness-exclude-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const trees = (stacks = []) =>
    sourceTrees(dir, stacks).map((t) => ({ ...t, entries: existsSync(t.root) ? readTree(t.root, t.label) : [] }));

  it('refuses unknown and required items', () => {
    const { problems } = applyExclusions(trees(), ['skills/no-such-skill', 'rules/agent-instructions', 'rules/property-testing'], dir);
    assert.equal(problems.length, 3);
    assert.match(problems[0], /no-such-skill.*agent-harness list/);
    assert.match(problems[1], /agent-instructions cannot be excluded/);
    // A stack item counts only when its stack is on.
    assert.match(problems[2], /property-testing/);
    assert.deepEqual(applyExclusions(trees(['fast-check']), ['rules/property-testing'], dir).problems, []);
  });

  it('feeds rulesync a filtered copy and drops derived files of excluded items', () => {
    write(dir, '.rulesync/harness.json', '{"exclude":["skills/tasks-to-tdd","rules/workflow-kiro"]}\n');
    const plan = planSync(dir);
    assert.deepEqual(plan.problems, []);
    assert.ok(plan.roots[0].startsWith(join(dir, FILTERED_DIR)), plan.roots[0]);
    assert.equal(plan.files['rules/tasks-to-tdd.md'], undefined, 'no Kiro rule for an excluded user-only skill');
    assert.doesNotMatch(plan.files['rules/harness-index.md'], /tasks-to-tdd/);
    assert.ok(plan.files['rules/lessons-learned.md'], 'other user-only skills keep their Kiro rule');
  });

  it('leaves excluded items out of every IDE', { skip: cli ? false : 'rulesync not installed' }, () => {
    write(dir, 'rulesync.jsonc', '{"targets":["claudecode","kiro-ide"],"features":["rules","skills"],"delete":true}\n');
    write(dir, '.rulesync/harness.json', '{"exclude":["skills/frontend-design","rules/workflow-kiro"]}\n');
    assert.equal(sync({ projectDir: dir, quiet: true }), 0);
    assert.ok(!existsSync(join(dir, '.claude/skills/frontend-design')));
    assert.ok(!existsSync(join(dir, '.kiro/steering/workflow-kiro.md')));
    assert.ok(existsSync(join(dir, '.claude/skills/mcp-usage/SKILL.md')));
    assert.ok(existsSync(join(dir, '.claude/rules/agent-instructions.md')));
    assert.equal(sync({ projectDir: dir, check: true, quiet: true }), 0);
  });
});

describe('list', () => {
  it('parses JSONC without touching strings', () => {
    const parsed = parseJsonc('{\n  // a comment\n  "url": "https://example.com/*x*/", /* block */\n  "list": [1, 2,],\n}\n');
    assert.deepEqual(parsed, { url: 'https://example.com/*x*/', list: [1, 2] });
  });

  it('shows what the project uses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-list-'));
    try {
      write(dir, '.rulesync/harness.json', '{"stacks":["fast-check"],"exclude":["skills/frontend-design"],"overrides":["rules/workflow"]}\n');
      write(dir, '.rulesync/rules/workflow.md', '---\ndescription: Our workflow\n---\n\n> Source: `.rulesync/rules/workflow.md`.\n');
      const c = catalog(dir);
      const core = Object.fromEntries(c.core.items.map((i) => [i.key, i.state]));
      assert.equal(core['skills/frontend-design'], 'excluded');
      assert.equal(core['rules/workflow'], 'replaced by the project');
      assert.equal(core['rules/agent-instructions'], 'on, required');
      const stacks = Object.fromEntries(c.stacks.map((s) => [s.name, s.active]));
      assert.equal(stacks['fast-check'], true);
      assert.equal(stacks.supabase, false);
      assert.deepEqual(c.project.map((i) => i.key), ['rules/workflow']);
      const text = formatCatalog(c);
      assert.match(text, /STACK fast-check · on/);
      assert.match(text, /STACK supabase · off/);
      assert.match(text, /"exclude"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('init', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'harness-init-'));
    git(dir, 'init', '-q');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('needs a package.json and known stacks', () => {
    assert.match(init(dir, { install: false }).problems[0], /npm init/);
    write(dir, 'package.json', '{"name":"p"}\n');
    assert.match(init(dir, { stacks: ['nope'], install: false }).problems[0], /unknown stack/);
  });

  it('sets a project up, keeps what is there and adopts existing agent files', { skip: cli ? false : 'rulesync not installed' }, () => {
    write(dir, 'package.json', '{\n  "name": "p",\n  "scripts": { "prepare": "husky" }\n}\n');
    write(dir, '.gitattributes', '*.png binary\n');
    write(dir, 'CLAUDE.md', '# Project\n\nUse pnpm.\n');
    write(dir, '.cursor/rules/style.mdc', '---\ndescription: House style\nglobs: src/**\nalwaysApply: false\n---\n\nTabs.\n');
    assert.deepEqual(existingUnits(dir), ['.cursor/rules/style.mdc']);

    const result = init(dir, { stacks: ['fast-check'], install: false });
    assert.deepEqual(result.problems, []);

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    assert.match(pkg.devDependencies['@deni-foundry/agent-harness'], /^github:deni-foundry\/agent-harness#v\d/);
    assert.match(pkg.devDependencies.rulesync, /^\d/);
    assert.equal(pkg.scripts['rules:sync'], 'agent-harness sync');
    assert.equal(pkg.scripts['rules:check'], 'agent-harness sync --check');
    assert.equal(pkg.scripts.prepare, 'husky && agent-harness install-hooks');

    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.rulesync/harness.json'), 'utf8')), { stacks: ['fast-check'], exclude: [] });
    assert.ok(existsSync(join(dir, 'rulesync.jsonc')));
    const attributes = readFileSync(join(dir, '.gitattributes'), 'utf8');
    assert.match(attributes, /^\*\.png binary\n/);
    assert.match(attributes, /\.rulesync\/\*\* text eol=lf/);

    const overview = readFileSync(join(dir, '.rulesync/rules/project-overview.md'), 'utf8');
    assert.match(overview, /alwaysApply: true/);
    assert.match(overview, /Use pnpm\./);
    assert.ok(!existsSync(join(dir, 'CLAUDE.md')));
    assert.ok(existsSync(join(dir, '.rulesync/rules/style.md')));
    assert.ok(!existsSync(join(dir, '.cursor/rules/style.mdc')));

    // A second run changes nothing.
    const again = init(dir, { install: false });
    assert.deepEqual(again, { done: [], notes: [], problems: [] });
  });
});
