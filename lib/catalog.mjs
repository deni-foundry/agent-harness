/**
 * `agent-harness list`: everything the harness offers and what this project uses, so choosing
 * stacks and exclusions does not mean reading the harness repo.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isUserOnlySkill, readTree } from './sources.mjs';
import { availableStacks, HARNESS_ROOT, PROJECT_SOURCE, readSyncConfig, REQUIRED } from './sync.mjs';

/** JSON with comments and trailing commas, as rulesync's `.jsonc` files are written. */
export function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
      if (i === 0) break;
    } else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function mcpServers(root) {
  const file = join(root, 'mcp.jsonc');
  if (!existsSync(file)) return [];
  try {
    const servers = parseJsonc(readFileSync(file, 'utf8')).mcpServers ?? {};
    return Object.entries(servers).map(([name, s]) => (s?.disabled ? `${name} (off)` : name));
  } catch {
    return [];
  }
}

const first = (text) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  const end = t.search(/\.(\s|$)/);
  return end > 0 ? t.slice(0, end + 1) : t;
};

function mode(e) {
  if (e.kind === 'subagents') return 'subagent';
  if (e.kind === 'skills') return isUserOnlySkill(e) ? 'workflow, user starts it' : 'skill';
  return Array.isArray(e.fields.globs) && e.fields.globs.length > 0 ? 'rule, path-scoped' : 'rule, always on';
}

function ides(e) {
  const t = e.fields.targets;
  return Array.isArray(t) && !t.includes('*') ? ` [${t.join(', ')}]` : '';
}

/** The catalog as data: core, each stack with its state, and the project's own items. */
export function catalog(projectDir, harnessRoot = HARNESS_ROOT) {
  let config = { stacks: [], exclude: [] };
  let configError = null;
  try {
    config = readSyncConfig(projectDir);
  } catch (error) {
    configError = error.message;
  }
  const excluded = new Set(config.exclude);
  const projectRoot = join(projectDir, PROJECT_SOURCE);
  const projectKeys = new Set(existsSync(projectRoot) ? readTree(projectRoot, 'project').map((e) => `${e.kind}/${e.name}`) : []);
  const describe = (e, active) => {
    const key = `${e.kind}/${e.name}`;
    let state = active ? 'on' : 'off';
    if (active && excluded.has(key)) state = 'excluded';
    if (active && projectKeys.has(key)) state = 'replaced by the project';
    if (REQUIRED.has(key)) state += ', required';
    return { key, mode: `${mode(e)}${ides(e)}`, description: first(e.fields.description), state };
  };
  const tree = (root, label, active) => ({
    items: existsSync(root) ? readTree(root, label).map((e) => describe(e, active)) : [],
    mcp: mcpServers(root),
  });
  const stacks = availableStacks(harnessRoot).map((name) => {
    const root = join(harnessRoot, 'stacks', name);
    let description = '';
    try {
      description = JSON.parse(readFileSync(join(root, 'stack.json'), 'utf8')).description ?? '';
    } catch {
      // A stack without a description still lists its items.
    }
    return { name, description, active: config.stacks.includes(name), ...tree(root, `stacks/${name}`, config.stacks.includes(name)) };
  });
  const project = existsSync(projectRoot) ? readTree(projectRoot, 'project').map((e) => ({ key: `${e.kind}/${e.name}`, mode: `${mode(e)}${ides(e)}`, description: first(e.fields.description), state: 'on' })) : [];
  return { configError, core: tree(join(harnessRoot, 'core'), 'core', true), stacks, project, projectMcp: mcpServers(projectRoot) };
}

/** Plain-text rendering for the terminal. */
export function formatCatalog(c) {
  const lines = [];
  const items = (list) => {
    const width = Math.max(0, ...list.map((i) => i.key.length));
    for (const i of list) lines.push(`  ${i.key.padEnd(width)}  ${i.mode} · ${i.state}${i.description ? `\n  ${' '.repeat(width)}  ${i.description}` : ''}`);
  };
  if (c.configError) lines.push(`! ${c.configError}`, '');
  lines.push('CORE (every project)');
  items(c.core.items);
  if (c.core.mcp.length) lines.push(`  MCP servers: ${c.core.mcp.join(', ')}`);
  lines.push('  Hooks: edit guard, end-of-turn review, automatic adoption, Kiro spec checks', '');
  for (const s of c.stacks) {
    lines.push(`STACK ${s.name} · ${s.active ? 'on' : 'off'}${s.description ? `\n  ${s.description}` : ''}`);
    items(s.items);
    if (s.mcp.length) lines.push(`  MCP servers: ${s.mcp.join(', ')}`);
    lines.push('');
  }
  lines.push(`PROJECT (${PROJECT_SOURCE}/)`);
  if (c.project.length) items(c.project);
  else lines.push('  nothing yet');
  if (c.projectMcp.length) lines.push(`  MCP servers: ${c.projectMcp.join(', ')}`);
  lines.push(
    '',
    'Change it in .rulesync/harness.json, then run `npm run rules:sync`:',
    '  "stacks": ["supabase", ...]           turn a stack on',
    '  "exclude": ["skills/frontend-design"]  leave out a core or stack item',
    'Add your own rules and skills in .rulesync/rules/ and .rulesync/skills/.',
  );
  return lines.join('\n');
}
