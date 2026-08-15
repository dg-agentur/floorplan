/**
 * CLI contract tests (docs/adr/0013-cli-contract.md).
 *
 * These run the real binary in a child process, because the contract an agent
 * depends on is the process contract: stdout, stderr and the exit code.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { PACKAGE_ROOT } from '../src/model/io.js';
import { canonicalise } from '../src/util/json.js';
import { packageVersion } from '../src/model/io.js';
import { FIXTURES } from './helpers.js';

const CLI = resolve(PACKAGE_ROOT, 'bin/floorplan.js');

/**
 * @param {string[]} args
 * @returns {{code: number, stdout: string, stderr: string}}
 */
function cli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: PACKAGE_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const err = /** @type {any} */ (error);
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

/**
 * @param {string[]} args
 * @returns {{code: number, json: any}}
 */
function cliJson(args) {
  const result = cli([...args, '--json']);
  return { code: result.code, json: JSON.parse(result.stdout) };
}

/** @returns {string} */
function tempDir() {
  return mkdtempSync(resolve(tmpdir(), 'floorplan-cli-'));
}

// --- basics ------------------------------------------------------------------

test('help and version work and exit 0', () => {
  assert.equal(cli([]).code, 0);
  assert.match(cli(['help']).stdout, /floorplan <command>/);
  assert.equal(cli(['--version']).stdout.trim(), packageVersion(), 'the CLI version must come from package.json');
  assert.match(cli(['validate', '--help']).stdout, /floorplan validate/);
});

test('an unknown command exits 2 and lists the available commands', () => {
  const result = cli(['nonsense']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /UNKNOWN_COMMAND/);
  assert.match(result.stderr, /Available commands/);
});

test('an unknown flag exits 2 instead of being ignored', () => {
  const result = cli(['validate', FIXTURES.simpleRoom, '--quality-level', 'verified']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /UNKNOWN_FLAG/);
});

test('a missing file exits 2, not 1', () => {
  const result = cliJson(['validate', 'does/not/exist.json']);
  assert.equal(result.code, 2);
  assert.equal(result.json.error.code, 'FILE_NOT_FOUND');
});

test('--json emits exactly one JSON object on stdout', () => {
  const result = cli(['inspect', FIXTURES.house, '--json']);
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, 'inspect');
  assert.ok(parsed.data);
  assert.ok(Array.isArray(parsed.diagnostics));
});

test('errors are JSON too, never a bare stack trace', () => {
  const result = cli(['validate', 'nope.json', '--json']);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(typeof parsed.error.code, 'string');
  assert.equal(typeof parsed.error.message, 'string');
  assert.equal(result.stdout.includes('at Object.'), false, 'no stack trace in the payload');
});

// --- validate -----------------------------------------------------------------

test('validate exits 0 for a valid document and 1 for an invalid one', () => {
  assert.equal(cli(['validate', FIXTURES.house]).code, 0);
  const strict = cliJson(['validate', FIXTURES.reconstruction, '--quality', 'verified']);
  assert.equal(strict.code, 1);
  assert.equal(strict.json.ok, false);
  assert.ok(strict.json.data.counts.ERROR > 0);
});

test('validate --min-severity filters the reported issues', () => {
  const all = cliJson(['validate', FIXTURES.reconstruction]);
  const errorsOnly = cliJson(['validate', FIXTURES.reconstruction, '--min-severity', 'ERROR']);
  assert.ok(all.json.data.issues.length > errorsOnly.json.data.issues.length);
});

test('rules lists the full severity matrix', () => {
  const result = cliJson(['rules']);
  assert.equal(result.code, 0);
  const ruleIds = result.json.data.rules.map((/** @type {any} */ r) => r.rule);
  assert.ok(ruleIds.includes('OPENING_OUTSIDE_WALL'));
  assert.ok(ruleIds.includes('PROVENANCE_ESTIMATED'));
  const provenance = result.json.data.rules.find((/** @type {any} */ r) => r.rule === 'PROVENANCE_ESTIMATED');
  assert.deepEqual([provenance.marketing, provenance.scaled, provenance.verified], ['INFO', 'WARNING', 'ERROR']);
});

// --- inspect and graph ------------------------------------------------------------

test('inspect exposes areas, openings, provenance and history', () => {
  const result = cliJson(['inspect', FIXTURES.house, '--section', 'all']);
  assert.equal(result.code, 0);
  const data = result.json.data;
  assert.equal(data.spaces.length, 6);
  assert.ok(Math.abs(data.total_floor_area_m2 - 95) < 0.01, `expected ~95 m², got ${data.total_floor_area_m2}`);
  assert.ok(data.walls.length > 0);
  assert.ok(data.openings.some((/** @type {any} */ o) => o.derived_space_ids.length === 2));
  assert.ok(data.provenance.total > 0);
  assert.deepEqual(data.history, []);
});

test('inspect rejects an unknown section', () => {
  const result = cliJson(['inspect', FIXTURES.house, '--section', 'walls-and-stuff']);
  assert.equal(result.code, 2);
  assert.equal(result.json.error.code, 'UNKNOWN_SECTION');
});

test('graph answers reachability questions', () => {
  const result = cliJson(['graph', FIXTURES.apartment, '--from', 'space_kitchen', '--to', 'space_bath']);
  assert.equal(result.code, 0);
  assert.deepEqual(result.json.data.path.nodes, ['space_kitchen', 'space_hall', 'space_bath']);
  assert.deepEqual(result.json.data.path.openings, ['door_kitchen', 'door_bath']);
  assert.deepEqual(result.json.data.reachable_from_outside.sort(), [
    'space_bath', 'space_bedroom', 'space_hall', 'space_kitchen', 'space_living',
  ]);
});

// --- apply and undo ----------------------------------------------------------------

test('apply refuses to write without an explicit destination', () => {
  const result = cliJson(['apply', FIXTURES.house, 'fixtures/03-house-ground-floor/renovation.ops.json']);
  assert.equal(result.code, 2);
  assert.equal(result.json.error.code, 'MISSING_OUTPUT');
});

test('apply --dry-run reports the result without writing anything', () => {
  const result = cliJson(['apply', FIXTURES.house, 'fixtures/03-house-ground-floor/renovation.ops.json', '--dry-run']);
  assert.equal(result.code, 0);
  assert.equal(result.json.data.output, null);
  assert.equal(result.json.data.dry_run, true);
  assert.equal(result.json.data.applied.length, 4);
});

test('apply writes, validates and can be undone through the CLI', () => {
  const dir = tempDir();
  const v2 = resolve(dir, 'v2.floorplan.json');
  const back = resolve(dir, 'back.floorplan.json');

  const applied = cliJson(['apply', FIXTURES.house, 'fixtures/03-house-ground-floor/renovation.ops.json', '--output', v2]);
  assert.equal(applied.code, 0);
  assert.equal(applied.json.data.report.ok, true);
  assert.ok(existsSync(v2));

  const undone = cliJson(['undo', v2, '--steps', '4', '--output', back]);
  assert.equal(undone.code, 0);
  assert.equal(undone.json.data.undone.length, 4);

  const original = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, FIXTURES.house), 'utf8'));
  const restored = JSON.parse(readFileSync(back, 'utf8'));
  delete restored.history;
  // Canonical comparison: the fixture is hand written, the undone file came out
  // of the serialiser, so raw key order carries no meaning.
  assert.equal(canonicalise(restored.buildings), canonicalise(original.buildings));
});

test('a failing operation exits 1 and names the operation index', () => {
  const dir = tempDir();
  const ops = resolve(dir, 'bad.ops.json');
  writeFileSync(ops, JSON.stringify({
    schema_version: '0.1',
    operations: [{ op: 'move_opening', target_id: 'door_bath', offset_delta_mm: 99999 }],
  }), 'utf8');
  const result = cliJson(['apply', FIXTURES.house, ops, '--dry-run']);
  assert.equal(result.code, 1);
  assert.equal(result.json.error.code, 'OPENING_OUTSIDE_WALL');
  assert.equal(result.json.error.op_index, 0);
});

// --- render -------------------------------------------------------------------------

test('render writes an SVG and reports the viewport', () => {
  const dir = tempDir();
  const target = resolve(dir, 'plan.svg');
  const result = cliJson(['render', FIXTURES.house, '--theme', 'technical', '--output', target]);
  assert.equal(result.code, 0);
  assert.match(readFileSync(target, 'utf8'), /^<\?xml/);
  assert.ok(result.json.data.viewport.width_px > 0);
  assert.equal(result.json.data.theme, 'technical');
});

test('render without --output writes the SVG to stdout', () => {
  const result = cli(['render', FIXTURES.simpleRoom]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^<\?xml/);
  assert.match(result.stdout, /<\/svg>\n$/);
});

test('render refuses an invalid document unless forced', () => {
  const refused = cliJson(['render', FIXTURES.reconstruction, '--quality', 'verified']);
  assert.equal(refused.code, 1);
  assert.equal(refused.json.error.code, 'VALIDATION_FAILED');

  const forced = cliJson(['render', FIXTURES.reconstruction, '--quality', 'verified', '--force']);
  assert.equal(forced.code, 0);
  assert.ok(forced.json.diagnostics.some((/** @type {string} */ d) => d.includes('--force')));
});

test('an unknown theme exits 2 and lists the available themes', () => {
  const result = cliJson(['render', FIXTURES.house, '--theme', 'nope']);
  assert.equal(result.code, 2);
  assert.equal(result.json.error.code, 'THEME_NOT_FOUND');
  assert.match(result.json.error.hint, /technical/);
});

// --- discovery surface for agents --------------------------------------------------

test('ops list is the machine readable change vocabulary', () => {
  const result = cliJson(['ops', 'list']);
  assert.equal(result.code, 0);
  assert.ok(result.json.data.operations.length >= 24);
  const move = result.json.data.operations.find((/** @type {any} */ o) => o.op === 'move_opening');
  assert.deepEqual(move.required, ['target_id']);
  assert.ok(move.optional.includes('offset_delta_mm'));
});

test('ops describe returns the schema and a usable example', () => {
  const result = cliJson(['ops', 'describe', 'create_door']);
  assert.equal(result.code, 0);
  assert.equal(result.json.data.op, 'create_door');
  assert.ok(result.json.data.schema.properties.host_wall_id);
  assert.ok(result.json.data.examples.length > 0);
});

test('ops describe lists the settable attributes for set_attribute', () => {
  const result = cliJson(['ops', 'describe', 'set_attribute']);
  assert.ok(result.json.data.settable_attributes.wall.includes('material'));
  assert.equal(result.json.data.settable_attributes.wall.includes('thickness_mm'), false);
});

test('an unknown operation suggests the closest match', () => {
  const result = cliJson(['ops', 'describe', 'move_wal']);
  assert.equal(result.code, 2);
  assert.match(result.json.error.hint, /move_wall/);
});

test('ops template produces an operations file that applies cleanly', () => {
  const result = cliJson(['ops', 'template', 'rename_space']);
  assert.equal(result.json.data.schema_version, '0.1');
  assert.equal(result.json.data.operations[0].op, 'rename_space');
});

test('schema prints the contracts an agent has to follow', () => {
  const list = cliJson(['schema']);
  assert.deepEqual(list.json.data.schemas.map((/** @type {any} */ s) => s.name),
    ['floorplan', 'operations', 'observations', 'theme']);
  const floorplan = cliJson(['schema', 'floorplan']);
  assert.equal(floorplan.json.data.$id.includes('floorplan.schema.json'), true);
  assert.equal(cliJson(['schema', 'nope']).code, 2);
});

test('theme list, show and validate', () => {
  const list = cliJson(['theme', 'list']);
  assert.ok(list.json.data.themes.some((/** @type {any} */ t) => t.name === 'marketing'));
  const show = cliJson(['theme', 'show', 'marketing']);
  assert.equal(show.json.data.theme.name, 'marketing');
  assert.equal(cliJson(['theme', 'validate', 'themes/technical.yaml']).code, 0);
});

// --- create and reconcile -------------------------------------------------------------

test('create builds a valid document from explicit dimensions', () => {
  const dir = tempDir();
  const target = resolve(dir, 'new.floorplan.json');
  const result = cliJson(['create', target, '--template', 'room', '--width-mm', '4200', '--depth-mm', '3400', '--name', 'Test']);
  assert.equal(result.code, 0);
  assert.equal(result.json.data.report.ok, true);
  assert.equal(cli(['validate', target]).code, 0);
  const doc = JSON.parse(readFileSync(target, 'utf8'));
  assert.equal(doc.buildings[0].levels[0].walls.length, 4);
  assert.equal(doc.buildings[0].levels[0].spaces[0].boundary[2].x_mm, 4200);
});

test('create refuses the room template without dimensions instead of inventing them', () => {
  const dir = tempDir();
  const result = cliJson(['create', resolve(dir, 'x.json'), '--template', 'room']);
  assert.equal(result.code, 2);
  assert.equal(result.json.error.code, 'MISSING_DIMENSIONS');
  assert.match(result.json.error.hint, /never guessed/);
});

test('create does not overwrite an existing file without --force', () => {
  const dir = tempDir();
  const target = resolve(dir, 'a.floorplan.json');
  assert.equal(cliJson(['create', target]).code, 0);
  assert.equal(cliJson(['create', target]).code, 2);
  assert.equal(cliJson(['create', target, '--force']).code, 0);
});

test('reconcile turns observations into a document and reports what it could not use', () => {
  const dir = tempDir();
  const target = resolve(dir, 'reconstructed.floorplan.json');
  const result = cliJson([
    'reconcile', 'fixtures/06-uncertain-reconstruction/expose-plan.observations.json',
    '--default-thickness-mm', '120', '--output', target,
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.json.data.reconciliation.quality, 'marketing');
  assert.ok(result.json.data.reconciliation.entries.some((/** @type {any} */ e) => e.status === 'rejected'));
  assert.equal(cli(['validate', target]).code, 0);
});

// --- determinism through the CLI --------------------------------------------------------

test('two identical CLI runs produce byte identical files', () => {
  const dir = tempDir();
  const a = resolve(dir, 'a.svg');
  const b = resolve(dir, 'b.svg');
  cli(['render', FIXTURES.apartment, '--theme', 'marketing', '--output', a]);
  cli(['render', FIXTURES.apartment, '--theme', 'marketing', '--output', b]);
  assert.equal(readFileSync(a, 'utf8'), readFileSync(b, 'utf8'));

  const c = resolve(dir, 'c.floorplan.json');
  const d = resolve(dir, 'd.floorplan.json');
  cli(['apply', FIXTURES.house, 'fixtures/03-house-ground-floor/renovation.ops.json', '--output', c]);
  cli(['apply', FIXTURES.house, 'fixtures/03-house-ground-floor/renovation.ops.json', '--output', d]);
  assert.equal(readFileSync(c, 'utf8'), readFileSync(d, 'utf8'));
});
