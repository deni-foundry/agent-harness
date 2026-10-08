import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexRule, kiroManualRule, parseSource, readTree, validate } from '../lib/sources.mjs';
import { DERIVED_DIR, INDEX_RULE, findRulesyncCli, planSync, readSyncConfig } from '../lib/sync.mjs';

const HARNESS = fileURLToPath(new URL('..', import.meta.url));

function write(root, rel, content) {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

const rule = (src, fm = 'targets: ["*"]\ndescription: "A rule. More text."') =>
  `---\n${fm}\n---\n\n> Source: ${src}. Edit it there; this copy is generated.\n\nBody.\n`;

describe('parseSource', () => {
  it('reads top-level fields and skips tool blocks', () => {
    const { fields, body } = parseSource(
      '---\r\ntargets: ["claudecode", "cursor"]\r\ndescription: "Say \\"hi\\""\r\ndisable-model-invocation: true\r\ncursor:\r\n  alwaysApply: true\r\n---\r\n\r\nText\r\n',
    );
    assert.deepEqual(fields, { targets: ['claudecode', 'cursor'], description: 'Say "hi"', 'disable-model-invocation': true, cursor: '' });
    assert.equal(body, '\nText\n');
  });

  it('treats a file without front matter as all body', () => {
    assert.deepEqual(parseSource('# Title\n'), { fields: {}, body: '# Title\n' });
  });
});

describe('validate', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'harness-validate-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('accepts a correct source line and reports a wrong one', () => {
    write(dir, 'rules/good.md', rule('`.rulesync/rules/good.md`'));
    write(dir, 'rules/bad.md', rule('`.rulesync/rules/elsewhere.md`'));
    const entries = readTree(dir, 'project');
    const problems = validate([{ entries, sourcePrefix: '`.rulesync/' }]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /rules\/bad\.md: first body line/);
  });

  it('requires a skill name equal to its folder, and a description', () => {
    write(dir, 'skills/x/SKILL.md', '---\nname: y\n---\n\n> Source: `.rulesync/skills/x/SKILL.md`. Edit it there.\n');
    const problems = validate([{ entries: readTree(dir, 'project'), sourcePrefix: '`.rulesync/' }]);
    assert.ok(problems.some((p) => p.includes('must equal its folder')));
    assert.ok(problems.some((p) => p.includes('no description')));
  });

  it('refuses a name in two trees unless it is a declared override', () => {
    const a = { entries: [{ kind: 'rules', name: 'x', rel: 'rules/x.md', tree: 'a', fields: { description: 'd' }, body: '> Source: A`rules/x.md`' }], sourcePrefix: 'A`' };
    const b = { entries: [{ kind: 'rules', name: 'x', rel: 'rules/x.md', tree: 'b', fields: { description: 'd' }, body: '> Source: B`rules/x.md`' }], sourcePrefix: 'B`' };
    assert.equal(validate([a, b]).length, 1);
    assert.deepEqual(validate([a, b], { overrides: ['rules/x'] }), []);
  });
});

describe('derived files', () => {
  const skill = {
    kind: 'skills',
    name: 'audit',
    fields: { description: 'Runs an audit. Only on request.', 'disable-model-invocation': true },
    body: '\n> Source: `.rulesync/skills/audit/SKILL.md`. Edit it there.\n\nDo it.\n',
  };

  it('turns a user-only skill into a manual Kiro rule with the same body', () => {
    const text = kiroManualRule(skill);
    const { fields, body } = parseSource(text);
    assert.deepEqual(fields.targets, ['kiro-ide']);
    assert.equal(fields.description, skill.fields.description);
    assert.match(text, /\nkiro:\n {2}inclusion: manual\n/);
    assert.ok(body.startsWith('\n> Source: `.rulesync/skills/audit/SKILL.md`'));
  });

  it('indexes path-scoped rules, loadable skills and user-only workflows, but not always-on rules', () => {
    const entries = [
      { kind: 'rules', name: 'always', fields: { description: 'Always on.' } },
      { kind: 'rules', name: 'scoped', fields: { description: 'Scoped. Extra.', globs: ['src/**'] } },
      { kind: 'skills', name: 'helper', fields: { description: 'Helps.' } },
      { kind: 'skills', name: 'kiro-only', fields: { description: 'K.', targets: ['kiro-ide'] } },
      skill,
    ];
    const text = indexRule(entries);
    assert.match(text, /- `scoped` — Scoped\.\n/);
    assert.match(text, /- `helper` — Helps\./);
    assert.match(text, /- `audit` — Runs an audit\./);
    assert.doesNotMatch(text, /`always`|`kiro-only`/);
    assert.match(text, /\ncursor:\n {2}alwaysApply: true\n/);
  });
});

describe('planSync', () => {
  let project;
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'harness-project-'));
  });
  afterEach(() => rmSync(project, { recursive: true, force: true }));

  it('orders roots core, stacks, derived, project and derives Kiro rules for user-only skills', () => {
    write(project, '.rulesync/harness.json', JSON.stringify({ stacks: ['supabase'] }));
    write(project, '.rulesync/rules/local.md', rule('`.rulesync/rules/local.md`'));
    const plan = planSync(project, HARNESS);

    assert.deepEqual(plan.problems, []);
    assert.deepEqual(plan.roots, [
      resolve(HARNESS, 'core'),
      resolve(HARNESS, 'stacks', 'supabase'),
      resolve(project, DERIVED_DIR),
      resolve(project, '.rulesync'),
    ]);
    assert.ok(plan.files[`rules/${INDEX_RULE}.md`]);
    // core's user-only skills each get a Kiro manual rule
    for (const name of ['dead-code-check', 'lessons-learned', 'tasks-to-tdd']) {
      assert.match(plan.files[`rules/${name}.md`], /inclusion: manual/, name);
    }
  });

  it('reports a project rule that reuses a harness name, and accepts it as a declared override', () => {
    write(project, '.rulesync/rules/workflow.md', rule('`.rulesync/rules/workflow.md`'));
    assert.ok(planSync(project, HARNESS).problems.some((p) => p.startsWith('rules/workflow is defined in')));

    write(project, '.rulesync/harness.json', JSON.stringify({ overrides: ['rules/workflow'] }));
    assert.deepEqual(planSync(project, HARNESS).problems, []);
  });

  it('reports a rule that would collide with a derived file', () => {
    write(project, `.rulesync/rules/${INDEX_RULE}.md`, rule(`\`.rulesync/rules/${INDEX_RULE}.md\``));
    write(project, '.rulesync/rules/tasks-to-tdd.md', rule('`.rulesync/rules/tasks-to-tdd.md`'));
    const { problems } = planSync(project, HARNESS);
    assert.ok(problems.some((p) => p.includes(`rules/${INDEX_RULE} is written by agent-harness sync`)));
    assert.ok(problems.some((p) => p.includes('user-only skill "tasks-to-tdd"')));
  });

  it('stops on an unknown stack or a malformed config', () => {
    write(project, '.rulesync/harness.json', JSON.stringify({ stacks: ['nope'] }));
    assert.throws(() => planSync(project, HARNESS), /unknown stack\(s\) nope/);
    write(project, '.rulesync/harness.json', JSON.stringify({ stacks: 'supabase' }));
    assert.throws(() => readSyncConfig(project), /"stacks" must be an array/);
  });

  it('works without a harness.json or a .rulesync folder', () => {
    const plan = planSync(project, HARNESS);
    assert.deepEqual(plan.problems, []);
    assert.equal(plan.roots.length, 3);
  });
});

describe('findRulesyncCli', () => {
  it('finds the CLI in an ancestor node_modules', () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-cli-'));
    try {
      write(root, 'node_modules/rulesync/package.json', JSON.stringify({ bin: { rulesync: 'dist/cli/index.js' } }));
      mkdirSync(join(root, 'a', 'b'), { recursive: true });
      assert.equal(findRulesyncCli(join(root, 'a', 'b')), join(root, 'node_modules', 'rulesync', 'dist', 'cli', 'index.js'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
