/**
 * Integration adapter tests.
 *
 * The adapters for Claude Code, Codex and ChatGPT must stay thin and consistent.
 * This suite is the mechanism that enforces vendor neutrality — not good intentions,
 * but a red test when a platform starts to drift.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';

import { PACKAGE_ROOT, packageVersion } from '../src/model/io.js';
import { OPERATIONS } from '../src/operations/registry.js';
import { SYNCED_REFERENCES } from '../scripts/sync-chatgpt-skill.js';

const INTEGRATIONS = resolve(PACKAGE_ROOT, 'integrations');

/** Every adapter file that instructs an agent. */
const ADAPTER_FILES = [
  'claude-code/CLAUDE.md',
  'claude-code/.claude/commands/grundriss-pruefen.md',
  'claude-code/.claude/commands/grundriss-aendern.md',
  'claude-code/.claude/commands/grundriss-rendern.md',
  'claude-code/.claude/commands/grundriss-rekonstruieren.md',
  'codex/AGENTS.md',
  'chatgpt/floorplan/SKILL.md',
  'chatgpt/floorplan/agents/openai.yaml',
];

/** The commands the CLI actually offers. */
const CLI_COMMANDS = [
  'create', 'inspect', 'validate', 'apply', 'undo', 'render',
  'graph', 'reconcile', 'ops', 'theme', 'schema', 'rules',
];

/**
 * @param {string} relativePath
 * @returns {string}
 */
function read(relativePath) {
  return readFileSync(resolve(INTEGRATIONS, relativePath), 'utf8');
}

test('all three platforms have an adapter', () => {
  for (const platform of ['claude-code', 'codex', 'chatgpt']) {
    assert.ok(statSync(resolve(INTEGRATIONS, platform)).isDirectory(), `missing adapter: ${platform}`);
    assert.ok(existsSync(resolve(INTEGRATIONS, platform, 'README.md')), `${platform} needs a README`);
  }
});

test('every adapter file exists', () => {
  for (const file of ADAPTER_FILES) {
    assert.ok(existsSync(resolve(INTEGRATIONS, file)), `missing: integrations/${file}`);
  }
});

test('every adapter points at the shared agent contract', () => {
  for (const file of ADAPTER_FILES) {
    const text = read(file);
    assert.match(
      text,
      /agent-contract\.md/,
      `integrations/${file} must reference the agent contract instead of restating the rules`,
    );
  }
});

test('every CLI command mentioned by an adapter really exists', () => {
  // Only invocations, not prose: the token must be at the start of a line, after a shell
  // prompt, after `node …`, or inside inline code.
  const pattern = /(?:^|[`$]\s*|node\s+\S*[/\\])floorplan(?:\.js)?\s+([a-z][a-z-]*)/gm;
  const allowed = new Set([...CLI_COMMANDS, 'help', 'version']);
  let checked = 0;
  for (const file of ADAPTER_FILES) {
    const text = read(file);
    for (const match of text.matchAll(pattern)) {
      const command = match[1];
      if (command.startsWith('-')) continue;
      checked += 1;
      assert.ok(
        allowed.has(command),
        `integrations/${file} mentions "floorplan ${command}", which is not a command`,
      );
    }
  }
  assert.ok(checked > 20, `expected the adapters to show real invocations, found ${checked}`);
});

test('every operation name mentioned by an adapter exists in the registry', () => {
  // Operation-shaped tokens: verb_noun in backticks or in a JSON "op" field.
  const patterns = [/`([a-z]+_[a-z_]+)`/g, /"op":\s*"([a-z_]+)"/g];
  const knownNonOperations = new Set([
    'schema_version', 'offset_delta_mm', 'offset_mm', 'width_mm', 'height_mm', 'sill_mm',
    'thickness_mm', 'target_id', 'target_ids', 'host_wall_id', 'connects_space_ids',
    'area_override_mm2', 'wall_height_mm', 'level_id', 'space_hall', 'space_kitchen',
    'space_bath', 'door_014', 'wall_001', 'wall_end', 'wall_start', 'candidate_type',
    'source_ref', 'provenance_hint', 'floor_area_m2', 'default_thickness_mm',
    'scale_mm_per_px', 'property_provenance', 'x_mm', 'y_mm', 'label_anchor',
    'min_confidence', 'step_count', 'door_type', 'window_type', 'has_threshold',
    'to_level_id', 'base_z_mm', 'run_start', 'run_end', 'shaft_kind', 'rotation_deg',
    'label_override', 'annotation_kind', 'observation_ids', 'source_id', 'meta_data',
  ]);
  for (const file of ADAPTER_FILES) {
    const text = read(file);
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const token = match[1];
        if (knownNonOperations.has(token)) continue;
        if (!/^(create|delete|move|set|split|merge|rename|convert|resize|add|restore)_/.test(token)) continue;
        assert.ok(
          OPERATIONS.has(token),
          `integrations/${file} mentions the operation "${token}", which does not exist`,
        );
      }
    }
  }
});

test('every documentation file an adapter references exists', () => {
  const pattern = /(?:docs|references)\/([a-z0-9-]+\.md)/g;
  for (const file of ADAPTER_FILES.concat(['README.md', 'claude-code/README.md', 'codex/README.md', 'chatgpt/README.md'])) {
    const text = read(file);
    for (const match of text.matchAll(pattern)) {
      const name = match[1];
      const inDocs = existsSync(resolve(PACKAGE_ROOT, 'docs', name));
      const inReferences = existsSync(resolve(INTEGRATIONS, 'chatgpt/floorplan/references', name));
      assert.ok(inDocs || inReferences, `integrations/${file} references ${name}, which does not exist`);
    }
  }
});

test('no adapter invents its own dimension or quality rules', () => {
  // An adapter may quote a rule, but it must not define a numeric default that the core
  // does not have. These phrases would mean a platform has started to diverge.
  const forbidden = [
    /(?:standard|default|typical|üblich\w*)\s+(?:wall\s+thickness|Wandstärke)\s+(?:of\s+)?\d/i,
    /assume\s+\d+\s*mm/i,
    /nimm\s+(?:einfach\s+)?\d+\s*mm\s+an/i,
    /if\s+unknown[^.\n]{0,40}use\s+\d/i,
    /wenn\s+unbekannt[^.\n]{0,40}(?:nimm|verwende)\s+\d/i,
  ];
  for (const file of ADAPTER_FILES) {
    const text = read(file);
    for (const pattern of forbidden) {
      assert.equal(
        pattern.test(text),
        false,
        `integrations/${file} appears to define its own dimension default (${pattern})`,
      );
    }
  }
});

/** Adapters through which an agent can create or change data. */
const WRITING_ADAPTERS = [
  'claude-code/CLAUDE.md',
  'claude-code/.claude/commands/grundriss-aendern.md',
  'claude-code/.claude/commands/grundriss-rekonstruieren.md',
  'codex/AGENTS.md',
  'chatgpt/floorplan/SKILL.md',
  'chatgpt/floorplan/agents/openai.yaml',
];

/** Adapters that report results to a human. */
const REPORTING_ADAPTERS = [
  'claude-code/CLAUDE.md',
  'claude-code/.claude/commands/grundriss-pruefen.md',
  'codex/AGENTS.md',
  'chatgpt/floorplan/SKILL.md',
  'chatgpt/floorplan/agents/openai.yaml',
];

test('every writing adapter states the no-invented-dimensions rule', () => {
  for (const file of WRITING_ADAPTERS) {
    const text = read(file);
    assert.match(
      text,
      /(?:never invent|nicht erfunden|Never invent|erfinde|invent a dimension)/i,
      `integrations/${file} must carry the core rule about invented dimensions`,
    );
  }
});

test('every reporting adapter disclaims building regulations', () => {
  for (const file of REPORTING_ADAPTERS) {
    const text = read(file);
    assert.match(
      text,
      /(?:baurechtlich|building regulation|Rettungsweg|escape route|Brandschutz|fire safety)/i,
      `integrations/${file} must state that legal admissibility is out of scope`,
    );
  }
});

test('the ChatGPT skill references are in sync with the documentation', () => {
  for (const name of SYNCED_REFERENCES) {
    const source = readFileSync(resolve(PACKAGE_ROOT, 'docs', name), 'utf8');
    const copy = readFileSync(resolve(INTEGRATIONS, 'chatgpt/floorplan/references', name), 'utf8');
    assert.equal(
      copy,
      source,
      `integrations/chatgpt/floorplan/references/${name} is stale — run \`node scripts/sync-chatgpt-skill.js\``,
    );
  }
});

test('the ChatGPT skill has valid frontmatter', () => {
  const text = read('chatgpt/floorplan/SKILL.md');
  assert.match(text, /^---\n/);
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  assert.match(frontmatter, /^name: floorplan$/m);
  assert.match(frontmatter, /^description: /m);
  assert.match(frontmatter, /^ {2}version: /m, 'the version belongs under metadata, not at the top level');
  assert.ok(frontmatter.length < 2000, 'the frontmatter description should stay compact');
});

test('the ChatGPT wrapper contains no floorplan logic of its own', () => {
  const text = read('chatgpt/floorplan/scripts/floorplan.js');
  for (const forbidden of ['thickness', 'offset_mm', 'polygon', 'wall', 'validate(']) {
    assert.equal(
      text.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `the wrapper must not contain "${forbidden}" — it may only locate and forward`,
    );
  }
  assert.match(text, /spawnSync/, 'it should forward to the core');
});

test('the ChatGPT wrapper finds the core and forwards arguments', () => {
  const wrapper = resolve(INTEGRATIONS, 'chatgpt/floorplan/scripts/floorplan.js');
  const output = execFileSync(process.execPath, [wrapper, '--version'], {
    encoding: 'utf8',
    env: { ...process.env, FLOORPLAN_HOME: PACKAGE_ROOT },
  });
  assert.equal(output.trim(), packageVersion());
});

test('the ChatGPT wrapper fails loudly when the core is missing', () => {
  // Copied out of the repository so that none of the relative fallbacks can hit the core.
  const dir = mkdtempSync(resolve(tmpdir(), 'floorplan-wrapper-'));
  const wrapper = resolve(dir, 'floorplan.js');
  copyFileSync(resolve(INTEGRATIONS, 'chatgpt/floorplan/scripts/floorplan.js'), wrapper);
  try {
    execFileSync(process.execPath, [wrapper, '--version'], {
      encoding: 'utf8',
      cwd: dir,
      env: { PATH: '/nonexistent', FLOORPLAN_HOME: '/nonexistent/floorplan' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.fail('the wrapper should have failed');
  } catch (error) {
    const err = /** @type {any} */ (error);
    assert.equal(err.status, 2, 'a missing core is a usage error');
    assert.match(err.stderr, /CORE_NOT_FOUND/);
    assert.match(err.stderr, /FLOORPLAN_HOME/, 'it must say how to fix it');
  }
});

test('the Claude Code commands carry usable frontmatter', () => {
  const commandDir = resolve(INTEGRATIONS, 'claude-code/.claude/commands');
  const files = readdirSync(commandDir).filter((file) => file.endsWith('.md'));
  assert.ok(files.length >= 4, 'expected at least four slash commands');
  for (const file of files) {
    const text = readFileSync(resolve(commandDir, file), 'utf8');
    assert.match(text, /^---\n/, `${file} needs frontmatter`);
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    assert.match(frontmatter, /^description: /m, `${file} needs a description`);
    assert.match(frontmatter, /^argument-hint: /m, `${file} needs an argument hint`);
  }
});

test('no adapter contains executable floorplan logic', () => {
  /** @type {string[]} */
  const offenders = [];
  walk(INTEGRATIONS);
  assert.deepEqual(offenders, [], 'adapters must be instructions and wrappers only');

  /** @param {string} dir */
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.js')) continue;
      const text = readFileSync(full, 'utf8');
      // The only permitted script is the ChatGPT wrapper.
      if (full.endsWith('chatgpt/floorplan/scripts/floorplan.js')) continue;
      offenders.push(relative(PACKAGE_ROOT, full));
      void text;
    }
  }
});
