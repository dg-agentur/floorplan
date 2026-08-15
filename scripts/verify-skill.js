#!/usr/bin/env node
/**
 * Prove that the built skill bundle is self-contained.
 *
 *   node scripts/verify-skill.js
 *
 * The bundle is extracted into a temporary directory OUTSIDE the repository and
 * exercised there with a stripped environment: no FLOORPLAN_HOME, no usable PATH,
 * no node_modules, no network. If anything in the skill still needed a git clone
 * or an npm install, this step fails.
 *
 * It also verifies that the bundled core produces exactly the same output as the
 * repository core — a bundle that silently drifts would be worse than no bundle.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { PACKAGE_ROOT } from '../src/model/io.js';
import { buildSkill } from './build-skill.js';
import { readZip } from './lib/zip.js';

const FORBIDDEN = [/Beispiele/i, /node_modules/, /\.git\//, /\.private\./, /(^|\/)tests?\//];

let failures = 0;

/**
 * @param {string} label
 * @param {() => void} body
 */
function step(label, body) {
  try {
    body();
    process.stdout.write(`  ok    ${label}\n`);
  } catch (error) {
    failures += 1;
    process.stdout.write(`  FAIL  ${label}\n        ${/** @type {Error} */ (error).message}\n`);
  }
}

/**
 * @param {boolean} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

process.stdout.write('Verifying the ChatGPT skill bundle\n\n');

const { zip, version } = buildSkill();
const entries = readZip(zip);
const root = mkdtempSync(join(tmpdir(), 'floorplan-skill-'));
const skillDir = join(root, 'floorplan');

// --- unpack -------------------------------------------------------------------
for (const entry of entries) {
  const target = join(root, entry.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, entry.data, { mode: entry.mode & 0o777 ? entry.mode & 0o777 : 0o644 });
}

step('archive has a single top level directory named after the skill', () => {
  const tops = new Set(entries.map((entry) => entry.path.split('/')[0]));
  assert(tops.size === 1 && tops.has('floorplan'), `top level entries: ${[...tops].join(', ')}`);
});

step('archive contains no private or irrelevant material', () => {
  for (const entry of entries) {
    for (const pattern of FORBIDDEN) {
      assert(!pattern.test(entry.path), `${entry.path} matches ${pattern}`);
    }
  }
});

step('SKILL.md carries valid Agent Skills frontmatter', () => {
  const text = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert(match !== null, 'no YAML frontmatter found');
  const frontmatter = /** @type {RegExpExecArray} */ (match)[1];
  assert(/^name: floorplan$/m.test(frontmatter), 'name must be "floorplan"');
  assert(/^description: /m.test(frontmatter), 'description is required');
  const description = /description: >-\n([\s\S]*?)\n[a-z]/.exec(frontmatter)?.[1] ?? '';
  assert(description.length > 40 && description.length <= 1024, `description length ${description.length}`);
});

step('MANIFEST.json matches every bundled file', () => {
  const manifest = JSON.parse(readFileSync(join(skillDir, 'MANIFEST.json'), 'utf8'));
  assert(manifest.version === version, `manifest version ${manifest.version} != ${version}`);
  assert(manifest.self_contained === true, 'manifest must declare self_contained');
  assert(manifest.runtime.install_required === false, 'manifest must declare install_required: false');
  for (const file of manifest.files) {
    const actual = createHash('sha256').update(readFileSync(join(skillDir, file.path))).digest('hex');
    assert(actual === file.sha256, `checksum mismatch for ${file.path}`);
  }
  assert(manifest.files.length + 1 === entries.length, 'manifest must cover every file except itself');
});

step('the bundle contains no dependency manifest that implies an install', () => {
  const core = JSON.parse(readFileSync(join(skillDir, 'core/package.json'), 'utf8'));
  assert(Object.keys(core.dependencies ?? {}).length === 0, 'core must have no dependencies');
  assert(core.devDependencies === undefined, 'core must not ship devDependencies');
  assert(core.scripts === undefined, 'core must not ship npm scripts');
  assert(!existsSync(join(skillDir, 'core/node_modules')), 'node_modules must not be bundled');
  assert(!existsSync(join(skillDir, 'core/package-lock.json')), 'a lockfile would imply an install');
});

// --- run it, isolated ------------------------------------------------------------
const wrapper = join(skillDir, 'scripts/floorplan.js');
/** Environment with no help: no FLOORPLAN_HOME, no PATH, no npm. */
const ISOLATED = { PATH: '/nonexistent', HOME: root, NODE_PATH: '/nonexistent' };

/**
 * @param {string[]} args
 * @returns {string}
 */
function run(args) {
  return execFileSync(process.execPath, [wrapper, ...args], {
    cwd: root,
    env: ISOLATED,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

step('runs with no environment help at all', () => {
  assert(run(['--version']).trim() === version, 'version mismatch');
});

step('the change vocabulary is available offline', () => {
  const ops = JSON.parse(run(['ops', 'list', '--json']));
  assert(ops.ok === true && ops.data.operations.length >= 30, 'operations missing');
  const rules = JSON.parse(run(['rules', '--json']));
  assert(rules.data.rules.length >= 30, 'validation rules missing');
  const schema = JSON.parse(run(['schema', 'floorplan', '--json']));
  assert(String(schema.data.$id).includes('floorplan.schema.json'), 'schema missing');
});

step('bundled fixtures load, validate and render', () => {
  const fixture = 'floorplan/core/fixtures/03-house-ground-floor/house-ground-floor.floorplan.json';
  const report = JSON.parse(run(['validate', fixture, '--json']));
  assert(report.ok === true, 'bundled fixture does not validate');
  const rendered = JSON.parse(run(['render', fixture, '--theme', 'marketing', '--output', 'plan.svg', '--json']));
  assert(rendered.ok === true, 'render failed');
  assert(readFileSync(join(root, 'plan.svg'), 'utf8').startsWith('<?xml'), 'no SVG written');
});

step('the full create -> change -> validate -> render loop works offline', () => {
  const created = JSON.parse(run([
    'create', 'demo.floorplan.json', '--template', 'room',
    '--width-mm', '4200', '--depth-mm', '3400', '--json',
  ]));
  assert(created.ok === true, 'create failed');

  writeFileSync(join(root, 'change.ops.json'), JSON.stringify({
    schema_version: '0.1',
    operations: [{
      op: 'create_door', host_wall_id: 'wall_001', offset_mm: 2100, width_mm: 1010,
      height_mm: 2010, door_type: 'swing', hinge: 'left', swing: 'left', provenance: 'provided',
    }],
  }), 'utf8');

  const applied = JSON.parse(run(['apply', 'demo.floorplan.json', 'change.ops.json', '--output', 'demo-v2.floorplan.json', '--json']));
  assert(applied.ok === true && applied.data.report.ok === true, 'apply failed');
  const undone = JSON.parse(run(['undo', 'demo-v2.floorplan.json', '--steps', '1', '--output', 'demo-v1.floorplan.json', '--json']));
  assert(undone.ok === true, 'undo failed');
  const graph = JSON.parse(run(['graph', 'demo-v2.floorplan.json', '--json']));
  assert(graph.ok === true, 'graph failed');
});

step('the observation pipeline works offline', () => {
  const observations = 'floorplan/core/fixtures/06-uncertain-reconstruction/expose-plan.observations.json';
  const result = JSON.parse(run([
    'reconcile', observations, '--default-thickness-mm', '120', '--output', 'reconstructed.floorplan.json', '--json',
  ]));
  assert(result.ok === true, 'reconcile failed');
  assert(result.data.reconciliation.quality === 'marketing', 'quality must stay marketing');
  assert(result.data.reconciliation.counts.rejected > 0, 'the report must name unusable observations');
});

step('the bundled core renders byte identically to the repository core', () => {
  const fixture = 'core/fixtures/02-apartment/apartment.floorplan.json';
  run(['render', `floorplan/${fixture}`, '--theme', 'technical', '--output', 'bundled.svg', '--json']);
  const bundled = readFileSync(join(root, 'bundled.svg'), 'utf8');

  const repoOut = join(root, 'repo.svg');
  execFileSync(process.execPath, [
    resolve(PACKAGE_ROOT, 'bin/floorplan.js'),
    resolve(PACKAGE_ROOT, 'fixtures/02-apartment/apartment.floorplan.json'),
  ].slice(0, 1).concat([
    'render', resolve(PACKAGE_ROOT, 'fixtures/02-apartment/apartment.floorplan.json'),
    '--theme', 'technical', '--output', repoOut, '--json',
  ]), { cwd: PACKAGE_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  assert(bundled === readFileSync(repoOut, 'utf8'), 'bundled and repository renderer disagree');
});

step('a missing core is reported as a usage error, never worked around', () => {
  const broken = mkdtempSync(join(tmpdir(), 'floorplan-broken-'));
  mkdirSync(join(broken, 'floorplan/scripts'), { recursive: true });
  writeFileSync(join(broken, 'floorplan/scripts/floorplan.js'), readFileSync(wrapper));
  try {
    execFileSync(process.execPath, [join(broken, 'floorplan/scripts/floorplan.js'), '--version'], {
      cwd: broken, env: ISOLATED, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    throw new Error('the wrapper should have failed without a core');
  } catch (error) {
    const err = /** @type {any} */ (error);
    assert(err.status === 2, `expected exit code 2, got ${err.status}`);
    assert(/CORE_NOT_FOUND/.test(err.stderr ?? ''), 'the error must name the cause');
  } finally {
    rmSync(broken, { recursive: true, force: true });
  }
});

rmSync(root, { recursive: true, force: true });

process.stdout.write(`\n${failures === 0 ? 'skill bundle verified: self-contained, offline capable, faithful to the core' : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
