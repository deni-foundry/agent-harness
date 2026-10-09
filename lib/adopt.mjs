/**
 * `agent-harness adopt <path...>`: moves a rule, skill or subagent that exists only in an IDE
 * folder (an installed skill, a rule made with an IDE's "new rule" button) into the project's
 * `.rulesync/`, so it becomes a source every IDE is generated from.
 *
 * The format conversion is rulesync's own: each file is imported from a scratch copy of the
 * project, so `rulesync import` sees only it and not the generated files around it.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { parseSource } from './sources.mjs';

const KINDS = [
  { re: /^\.claude\/skills\/([^/]+)/, target: 'claudecode', feature: 'skills' },
  { re: /^\.cursor\/skills\/([^/]+)/, target: 'cursor', feature: 'skills' },
  { re: /^\.kiro\/skills\/([^/]+)/, target: 'kiro-ide', feature: 'skills' },
  { re: /^\.claude\/rules\/([^/]+\.md)$/, target: 'claudecode', feature: 'rules' },
  { re: /^\.cursor\/rules\/([^/]+\.mdc)$/, target: 'cursor', feature: 'rules' },
  { re: /^\.kiro\/steering\/([^/]+\.md)$/, target: 'kiro-ide', feature: 'rules' },
  { re: /^\.claude\/agents\/([^/]+\.md)$/, target: 'claudecode', feature: 'subagents' },
  { re: /^\.cursor\/agents\/([^/]+\.md)$/, target: 'cursor', feature: 'subagents' },
];

/** What `path` is, and the folder or file that moves as one unit. */
export function classify(relPath) {
  for (const kind of KINDS) {
    const m = relPath.match(kind.re);
    if (m) {
      const unit = kind.feature === 'skills' ? relPath.slice(0, m.index + m[0].length) : relPath;
      return { ...kind, unit };
    }
  }
  return null;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** First Markdown heading or first sentence, for a source that arrives without a description. */
export function deriveDescription(body, fallback) {
  const heading = body.match(/^#+\s+(.+)$/m);
  if (heading) return heading[1].trim();
  const sentence = body.replace(/^>.*$/gm, '').trim().split(/(?<=\.)\s/)[0];
  return (sentence || fallback).slice(0, 160);
}

/**
 * Add the `> Source:` line, a description if missing, and narrow `targets` to the original IDE
 * when `only` is set. Works on the front matter text so rulesync's own formatting survives.
 */
export function finishSource(text, sourceRef, { only, fallbackName, feature = 'rules' }) {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  let front = match ? match[1] : '';
  let body = match ? normalized.slice(match[0].length) : normalized;
  const { fields } = parseSource(normalized);
  const notes = [];

  // rulesync import leaves an always-on rule (Claude without paths, Kiro `inclusion: always`)
  // without Cursor's flag, so Cursor would only load it on request.
  if (feature === 'rules') {
    const hasGlobs = Array.isArray(fields.globs) ? fields.globs.length > 0 : Boolean(fields.globs);
    const inclusion = front.match(/^\s+inclusion:\s*(\w+)/m)?.[1];
    const cursorFlag = front.match(/^\s+alwaysApply:\s*(true|false)/m)?.[1];
    if (!hasGlobs && !cursorFlag && (!inclusion || inclusion === 'always')) {
      front = /^cursor:\s*$/m.test(front)
        ? front.replace(/^cursor:\s*$/m, 'cursor:\n  alwaysApply: true')
        : `${front}\ncursor:\n  alwaysApply: true`;
    }
  }

  if (!fields.description) {
    const description = deriveDescription(body, fallbackName);
    front += `\ndescription: ${JSON.stringify(description)}`;
    notes.push(`added the description "${description}"; refine it in the source`);
  }
  if (only) {
    front = front.replace(/^targets:.*\n(?:\s+-.*\n?)*/m, '');
    front = `targets: ["${only}"]\n${front}`.replace(/\n{2,}/g, '\n');
  }
  const sourceLine = `> Source: \`${sourceRef}\`. Edit it there; this copy is generated.`;
  if (!body.replace(/^\n+/, '').startsWith('> Source:')) body = `\n${sourceLine}\n\n${body.replace(/^\n+/, '')}`;
  return { text: `---\n${front.trim()}\n---\n${body}`, notes };
}

/**
 * Adopt each path into `projectDir/.rulesync/`. Returns `{ adopted, problems }`; nothing is
 * moved for a path that has a problem.
 */
export function adopt(projectDir, paths, { cli, only = false } = {}) {
  const adopted = [];
  const problems = [];
  for (const input of paths) {
    const rel = (isAbsolute(input) ? relative(projectDir, input) : input).replace(/\\/g, '/').replace(/\/$/, '');
    const kind = classify(rel);
    if (!kind) {
      problems.push(`${rel}: not a rule, skill or subagent in .claude/, .cursor/ or .kiro/`);
      continue;
    }
    const unitAbs = join(projectDir, kind.unit);
    if (!existsSync(unitAbs)) {
      problems.push(`${rel}: does not exist`);
      continue;
    }

    const scratch = mkdtempSync(join(tmpdir(), 'agent-harness-adopt-'));
    try {
      mkdirSync(join(scratch, dirname(kind.unit)), { recursive: true });
      cpSync(unitAbs, join(scratch, kind.unit), { recursive: true });
      const run = spawnSync(process.execPath, [cli, 'import', '-t', kind.target, '-f', kind.feature], { cwd: scratch, encoding: 'utf8' });
      const imported = existsSync(join(scratch, '.rulesync')) ? walk(join(scratch, '.rulesync')) : [];
      if (run.status !== 0 || imported.length === 0) {
        problems.push(`${rel}: rulesync import failed${run.stderr ? `: ${run.stderr.trim().split('\n')[0]}` : ''}`);
        continue;
      }
      const targets = imported.map((abs) => ({ abs, dest: join(projectDir, '.rulesync', relative(join(scratch, '.rulesync'), abs)) }));
      const clash = targets.find((t) => existsSync(t.dest));
      if (clash) {
        problems.push(`${rel}: ${relative(projectDir, clash.dest).replace(/\\/g, '/')} already exists; rename one of them`);
        continue;
      }
      const notes = [];
      for (const { abs, dest } of targets) {
        const destRel = relative(projectDir, dest).replace(/\\/g, '/');
        const isMain = /(?:^|\/)(SKILL\.md|rules\/[^/]+\.md|subagents\/[^/]+\.md)$/.test(destRel);
        mkdirSync(dirname(dest), { recursive: true });
        if (isMain) {
          const done = finishSource(readFileSync(abs, 'utf8'), destRel, { only: only ? kind.target : false, fallbackName: kind.unit, feature: kind.feature });
          writeFileSync(dest, done.text);
          notes.push(...done.notes);
        } else {
          cpSync(abs, dest);
        }
      }
      rmSync(unitAbs, { recursive: true, force: true });
      adopted.push({ from: kind.unit, to: targets.map((t) => relative(projectDir, t.dest).replace(/\\/g, '/')), notes });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  return { adopted, problems };
}
