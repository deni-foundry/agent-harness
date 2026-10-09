/**
 * Reading rulesync source trees, and the files `agent-harness sync` derives from them.
 *
 * A source tree is a folder with `rules/*.md`, `skills/<name>/SKILL.md` and
 * `subagents/*.md` (plus `hooks.jsonc` and `mcp.jsonc`, which rulesync reads itself).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Split a source file into its front matter fields and its body. */
export function parseSource(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { fields: {}, body: normalized };
  const fields = {};
  let listKey = null;
  for (const line of match[1].split('\n')) {
    // A block list (`targets:` then `  - '*'`), as `rulesync import` writes them.
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      fields[listKey].push(parseValue(item[1].trim()));
      continue;
    }
    // Top-level keys only; other indented lines belong to tool blocks (cursor:, kiro:, …).
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) {
      if (!/^\s/.test(line)) listKey = null;
      continue;
    }
    const value = parseValue(kv[2].trim());
    fields[kv[1]] = value === '' ? [] : value;
    listKey = value === '' ? kv[1] : null;
  }
  // A key with an empty value and no list items is a tool block or a blank field, not a list.
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value) && value.length === 0) fields[key] = '';
  }
  return { fields, body: normalized.slice(match[0].length) };
}

function parseValue(raw) {
  if (raw === '') return '';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('[') || raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}

/**
 * Every rule, skill and subagent in one source tree.
 * `label` names the tree in messages and in the `> Source:` line it must carry.
 */
export function readTree(root, label) {
  const entries = [];
  const rulesDir = join(root, 'rules');
  if (existsSync(rulesDir)) {
    for (const file of readdirSync(rulesDir).filter((f) => f.endsWith('.md'))) {
      entries.push(entry('rules', basename(file, '.md'), join(rulesDir, file), `rules/${file}`));
    }
  }
  const skillsDir = join(root, 'skills');
  if (existsSync(skillsDir)) {
    for (const name of readdirSync(skillsDir)) {
      const file = join(skillsDir, name, 'SKILL.md');
      if (statSync(join(skillsDir, name)).isDirectory() && existsSync(file)) {
        entries.push(entry('skills', name, file, `skills/${name}/SKILL.md`));
      }
    }
  }
  const agentsDir = join(root, 'subagents');
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir).filter((f) => f.endsWith('.md'))) {
      entries.push(entry('subagents', basename(file, '.md'), join(agentsDir, file), `subagents/${file}`));
    }
  }
  return entries.map((e) => ({ ...e, tree: label }));

  function entry(kind, name, path, rel) {
    const { fields, body } = parseSource(readFileSync(path, 'utf8'));
    return { kind, name, path, rel, fields, body };
  }
}

/** The path a source's `> Source:` line must name, e.g. agent-harness `core/rules/x.md`. */
export function expectedSourceRef(entry, treePrefix) {
  return `${treePrefix}${entry.rel}\``;
}

/**
 * Problems that make a sync unsafe: a missing or wrong source line, a skill whose `name`
 * is not its folder, and the same name in two trees (a later tree silently replaces an
 * earlier one, so that must be declared in `overrides`).
 */
export function validate(trees, { overrides = [] } = {}) {
  const problems = [];
  const seen = new Map();
  for (const { entries, sourcePrefix } of trees) {
    for (const e of entries) {
      const first = e.body.replace(/^\n+/, '').split('\n')[0] ?? '';
      const want = `> Source: ${expectedSourceRef(e, sourcePrefix)}`;
      if (!first.startsWith(want)) {
        problems.push(`${e.tree} ${e.rel}: first body line must start with "${want}"`);
      }
      if (e.kind === 'skills' && e.fields.name !== e.name) {
        problems.push(`${e.tree} ${e.rel}: name "${e.fields.name}" must equal its folder "${e.name}"`);
      }
      if (!e.fields.description) problems.push(`${e.tree} ${e.rel}: no description`);
      const key = `${e.kind}/${e.name}`;
      if (seen.has(key) && !overrides.includes(key)) {
        problems.push(
          `${key} is defined in ${seen.get(key)} and ${e.tree}; the later one replaces the earlier. ` +
            `Rename it, or list "${key}" in harness.json "overrides" if that is intended.`,
        );
      }
      seen.set(key, e.tree);
    }
  }
  return problems;
}

/** Skills only the user may start: no model invocation, and not generated for Kiro. */
export function isUserOnlySkill(entry) {
  return entry.kind === 'skills' && entry.fields['disable-model-invocation'] === true;
}

const q = (s) => JSON.stringify(s);

/**
 * Kiro skills have no user-only flag, so a user-only skill reaches Kiro as a manual
 * steering rule with the same body (Kiro lists manual rules as `#name` / slash commands).
 */
export function kiroManualRule(skill) {
  const body = skill.body.replace(/^\n+/, '');
  return [
    '---',
    'targets: ["kiro-ide"]',
    `description: ${q(skill.fields.description)}`,
    'kiro:',
    '  inclusion: manual',
    '---',
    '',
    body,
  ].join('\n');
}

/** First sentence of a description, for a compact index line. */
function short(description) {
  const text = String(description ?? '').replace(/\s+/g, ' ').trim();
  const end = text.search(/\.(\s|$)/);
  return end > 0 ? text.slice(0, end + 1) : text;
}

/**
 * An always-on rule listing what is not always loaded: path-scoped rules, skills the
 * agent may load, and workflows only the user starts. It replaces a hand-kept index,
 * which goes stale the moment a rule is added.
 */
export function indexRule(entries) {
  const live = (e) => {
    const t = e.fields.targets;
    return !Array.isArray(t) || t.includes('*') || t.some((x) => x !== 'kiro-ide');
  };
  const pathRules = entries
    .filter((e) => e.kind === 'rules' && Array.isArray(e.fields.globs) && e.fields.globs.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const skills = entries
    .filter((e) => e.kind === 'skills' && !isUserOnlySkill(e) && live(e))
    .sort((a, b) => a.name.localeCompare(b.name));
  const workflows = entries.filter(isUserOnlySkill).sort((a, b) => a.name.localeCompare(b.name));

  const lines = [
    '---',
    'targets: ["*"]',
    'description: "Index of the rules, skills and workflows that are not always loaded"',
    'cursor:',
    '  alwaysApply: true',
    '---',
    '',
    '> Source: generated by `agent-harness sync` from the front matter of every rule and skill. Edit those sources, not this file.',
    '',
    '# Rules, Skills and Workflows',
    '',
    'Only rules that apply to every request load at launch. The rest load when you read a file',
    'they govern, or on demand. When you need depth on a topic that is not loaded, read the rule',
    'or load the skill rather than guess.',
    '',
    '**Path-scoped rules** (load when you read a matching file):',
    '',
    ...pathRules.map((e) => `- \`${e.name}\` — ${short(e.fields.description)}`),
    '',
    '**Skills you may load when relevant:**',
    '',
    ...skills.map((e) => `- \`${e.name}\` — ${short(e.fields.description)}`),
    '',
    '**Workflows only the user starts** (`/name`; in Kiro, `#name`). Never run one unprompted:',
    '',
    ...workflows.map((e) => `- \`${e.name}\` — ${short(e.fields.description)}`),
    '',
  ];
  return lines.join('\n');
}
