import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, finishSource, adopt } from '../lib/adopt.mjs';
import { HOOK_MARKER, installHooks, touchesAgentFiles } from '../lib/git-hooks.mjs';
import { gitChangedPaths, parseDryRun, unmanagedFiles, writeManifest, readManifest } from '../lib/protect.mjs';
import { parseSource } from '../lib/sources.mjs';
import { rulesyncCli, HARNESS_ROOT } from '../lib/sync.mjs';

function write(root, rel, content) {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'harness-git-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'core.autocrlf', 'false');
  return dir;
}

describe('parseSource block lists', () => {
  it('reads block-style lists the way rulesync import writes them', () => {
    const { fields } = parseSource("---\nroot: false\ntargets:\n  - '*'\nglobs:\n  - src/**\n  - lib/**\ncursor:\n  alwaysApply: false\n---\nBody\n");
    assert.deepEqual(fields.targets, ['*']);
    assert.deepEqual(fields.globs, ['src/**', 'lib/**']);
    assert.equal(fields.cursor, '');
    assert.equal(fields.root, false);
  });
});

describe('parseDryRun', () => {
  it('collects writes, file deletes and directory deletes as project paths', () => {
    const root = 'C:\\proj';
    const text = [
      'No root rulesync rule file found',
      '[DRY RUN] Would write: C:\\proj\\.claude\\rules\\tech.md',
      '[DRY RUN] Would delete directory: "C:\\\\proj\\\\.claude\\\\skills\\\\stray"',
      '[DRY RUN] Would delete: C:\\proj\\CLAUDE.md',
      '[DRY RUN] Would delete: C:\\proj\\CLAUDE.md',
    ].join('\n');
    const plan = parseDryRun(text, root);
    if (process.platform === 'win32') {
      assert.deepEqual(plan.write, ['.claude/rules/tech.md']);
      assert.deepEqual(plan.delete, ['.claude/skills/stray', 'CLAUDE.md']);
    } else {
      assert.equal(plan.write.length, 1);
      assert.equal(plan.delete.length, 2);
    }
  });
});

describe('unmanagedFiles', () => {
  let dir;
  beforeEach(() => {
    dir = gitRepo();
    write(dir, '.claude/rules/tech.md', 'generated v1\n');
    write(dir, '.claude/settings.json', '{}\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'init');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('allows committed output, flags hand edits and stray files, and trusts the last sync', () => {
    write(dir, '.claude/skills/stray/SKILL.md', 'installed\n');
    const changed = gitChangedPaths(dir);
    assert.deepEqual(unmanagedFiles(dir, ['.claude/rules/tech.md', '.claude/skills/stray'], { changed, manifest: {} }), ['.claude/skills/stray/SKILL.md']);

    write(dir, '.claude/rules/tech.md', 'hand edit\n');
    const changed2 = gitChangedPaths(dir);
    assert.deepEqual(unmanagedFiles(dir, ['.claude/rules/tech.md'], { changed: changed2, manifest: {} }), ['.claude/rules/tech.md']);

    // The same content written by the previous sync is ours, even if not committed yet.
    writeManifest(dir);
    assert.deepEqual(unmanagedFiles(dir, ['.claude/rules/tech.md'], { changed: changed2, manifest: readManifest(dir) }), []);
  });

  it('never treats .claude/settings.json as unmanaged, because rulesync merges into it', () => {
    write(dir, '.claude/settings.json', '{"permissions":{}}\n');
    assert.deepEqual(unmanagedFiles(dir, ['.claude/settings.json'], { changed: gitChangedPaths(dir), manifest: {} }), []);
  });
});

describe('pre-commit', () => {
  it('runs only when staged files touch agent files or their sources', () => {
    assert.equal(touchesAgentFiles(['src/app.ts', 'README.md']), false);
    for (const p of ['.rulesync/rules/a.md', '.claude/skills/x/SKILL.md', '.cursor/rules/a.mdc', 'CLAUDE.md', 'package.json', 'rulesync.jsonc']) {
      assert.equal(touchesAgentFiles([p]), true, p);
    }
  });

  it('installs into the hooks folder, is idempotent, and leaves a foreign hook alone', () => {
    const dir = gitRepo();
    try {
      assert.equal(installHooks(dir, { env: { CI: 'true' } }).status, 'skipped');
      const first = installHooks(dir, { env: {} });
      assert.equal(first.status, 'installed');
      assert.match(readFileSync(first.file, 'utf8'), new RegExp(HOOK_MARKER));
      assert.equal(installHooks(dir, { env: {} }).status, 'unchanged');
      writeFileSync(first.file, '#!/bin/sh\necho mine\n');
      assert.equal(installHooks(dir, { env: {} }).status, 'conflict');
      assert.equal(readFileSync(first.file, 'utf8'), '#!/bin/sh\necho mine\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('adopt', () => {
  it('classifies IDE files and refuses anything else', () => {
    assert.deepEqual(
      { ...classify('.claude/skills/my-skill/references/a.md'), re: undefined },
      { target: 'claudecode', feature: 'skills', unit: '.claude/skills/my-skill', re: undefined },
    );
    assert.equal(classify('.cursor/rules/r.mdc').feature, 'rules');
    assert.equal(classify('.kiro/steering/s.md').target, 'kiro-ide');
    assert.equal(classify('src/index.ts'), null);
  });

  it('adds the source line, a missing description, and narrows targets with --only', () => {
    const { text, notes } = finishSource("---\nroot: false\ntargets:\n  - '*'\n---\n# Kiro rule\n\nBody.\n", '.rulesync/rules/k.md', {
      only: 'kiro-ide',
      fallbackName: '.kiro/steering/k.md',
    });
    const { fields, body } = parseSource(text);
    assert.deepEqual(fields.targets, ['kiro-ide']);
    assert.equal(fields.description, 'Kiro rule');
    assert.ok(body.startsWith('\n> Source: `.rulesync/rules/k.md`.'));
    assert.equal(notes.length, 1);
  });

  const cli = rulesyncCli(HARNESS_ROOT);
  it('moves an installed Claude skill into .rulesync/', { skip: cli ? false : 'rulesync not installed' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-adopt-'));
    try {
      write(dir, '.claude/skills/my-skill/SKILL.md', '---\nname: my-skill\ndescription: Does a thing\n---\n\nSkill body.\n');
      const { adopted, problems } = adopt(dir, ['.claude/skills/my-skill'], { cli });
      assert.deepEqual(problems, []);
      assert.deepEqual(adopted[0].to, ['.rulesync/skills/my-skill/SKILL.md']);
      assert.equal(existsSync(join(dir, '.claude/skills/my-skill')), false);
      const { fields, body } = parseSource(readFileSync(join(dir, '.rulesync/skills/my-skill/SKILL.md'), 'utf8'));
      assert.equal(fields.name, 'my-skill');
      assert.deepEqual(fields.targets, ['*']);
      assert.ok(body.includes('> Source: `.rulesync/skills/my-skill/SKILL.md`.'));
      // A second copy is refused rather than overwriting the source.
      write(dir, '.claude/skills/my-skill/SKILL.md', '---\nname: my-skill\ndescription: Again\n---\n\nAgain.\n');
      assert.match(adopt(dir, ['.claude/skills/my-skill'], { cli }).problems[0], /already exists/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
