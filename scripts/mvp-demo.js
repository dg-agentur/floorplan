#!/usr/bin/env node
/**
 * The MVP demonstration, executable end to end.
 *
 *   npm run demo
 *
 * Runs the ten steps of the MVP definition against the synthetic house fixture
 * and writes every artefact to ./out. Uses the real CLI, not internal APIs, so
 * what it proves is exactly what an agent can reproduce.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { PACKAGE_ROOT } from '../src/model/io.js';
import { canonicalise } from '../src/util/json.js';

const OUT = resolve(PACKAGE_ROOT, 'out');
const CLI = resolve(PACKAGE_ROOT, 'bin/floorplan.js');
const HOUSE = 'fixtures/03-house-ground-floor/house-ground-floor.floorplan.json';
const OPS = 'fixtures/03-house-ground-floor/renovation.ops.json';

let step = 0;
/** @type {string[]} */
const summary = [];

/**
 * @param {string} title
 * @param {string[]} args
 * @param {{expectFailure?: boolean}} [options]
 * @returns {any}
 */
function run(title, args, options = {}) {
  step += 1;
  process.stdout.write(`\n[${String(step).padStart(2, '0')}] ${title}\n     $ floorplan ${args.join(' ')}\n`);
  let stdout = '';
  let failed = false;
  try {
    stdout = execFileSync(process.execPath, [CLI, ...args, '--json'], {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    failed = true;
    stdout = /** @type {any} */ (error).stdout ?? '';
  }
  const parsed = stdout ? JSON.parse(stdout) : {};
  if (failed !== Boolean(options.expectFailure)) {
    process.stderr.write(`\nUnexpected result in step ${step}:\n${JSON.stringify(parsed, null, 2)}\n`);
    process.exit(1);
  }
  return parsed;
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

process.stdout.write('Floorplan platform — MVP demonstration\n');
process.stdout.write('=====================================\n');

// 1 + 2: load and validate the synthetic house.
const validated = run('Load the synthetic house and validate it', ['validate', HOUSE]);
summary.push(`1/2  document valid: ${validated.data.ok} (${validated.data.counts.ERROR} errors, ${validated.data.counts.WARNING} warnings)`);

const inspected = run('Inspect areas and connectivity', ['inspect', HOUSE, '--section', 'spaces']);
summary.push(`     ${inspected.data.spaces.length} rooms, ${inspected.data.total_floor_area_m2.toFixed(2)} m² geometric floor area`);

// 3: deterministic SVG.
const before = run('Render SVG (technical theme)', [
  'render', HOUSE, '--theme', 'technical', '--output', 'out/house-before-technical.svg',
]);
const beforeAgain = run('Render the same SVG again to prove determinism', [
  'render', HOUSE, '--theme', 'technical', '--output', 'out/house-before-technical-again.svg',
]);
const identical = readFileSync(resolve(OUT, 'house-before-technical.svg'), 'utf8')
  === readFileSync(resolve(OUT, 'house-before-technical-again.svg'), 'utf8');
if (!identical) {
  process.stderr.write('\nRendering is not deterministic — aborting.\n');
  process.exit(1);
}
summary.push(`3    SVG rendered deterministically: ${before.data.viewport.width_px.toFixed(0)}x${before.data.viewport.height_px.toFixed(0)} px, byte identical on re-render`);
void beforeAgain;

// 4 + 5 + 6 + 7: apply the operation batch, which moves a door, marks a wall for
// demolition and replaces a door with an open passage; validation runs inside apply.
const applied = run('Apply operations: move a door, demolish a wall, create a passage', [
  'apply', HOUSE, OPS, '--output', 'out/house-v2.floorplan.json',
]);
for (const entry of applied.data.applied) {
  process.stdout.write(`     - ${entry.summary}\n`);
}
summary.push(`4-6  ${applied.data.applied.length} operations applied atomically`);
summary.push(`7    revalidated after apply: ok=${applied.data.report.ok} (${applied.data.report.counts.ERROR} errors)`);

// 8: render the changed model.
const after = run('Render the changed model', [
  'render', 'out/house-v2.floorplan.json', '--theme', 'technical', '--output', 'out/house-after-technical.svg',
]);
summary.push(`8    changed model rendered: ${after.data.output}`);

// 9: same geometry, two themes.
const marketing = run('Render the same geometry with the marketing theme', [
  'render', 'out/house-v2.floorplan.json', '--theme', 'marketing', '--output', 'out/house-after-marketing.svg',
]);
const technicalSvg = readFileSync(resolve(OUT, 'house-after-technical.svg'), 'utf8');
const marketingSvg = readFileSync(resolve(OUT, 'house-after-marketing.svg'), 'utf8');
const geometryIdentical = extractGeometry(technicalSvg) === extractGeometry(marketingSvg);
summary.push(`9    two themes, visibly different (${technicalSvg.length} vs ${marketingSvg.length} bytes), same wall geometry: ${geometryIdentical}`);
void marketing;

// Undo proves the operations are reversible.
const undone = run('Undo the whole batch and compare against the original', [
  'undo', 'out/house-v2.floorplan.json', '--steps', '4', '--output', 'out/house-undone.floorplan.json',
]);
const original = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, HOUSE), 'utf8'));
const restored = JSON.parse(readFileSync(resolve(OUT, 'house-undone.floorplan.json'), 'utf8'));
// Compare canonically: the fixture is hand written, the undone file was produced
// by the serialiser, so raw key order is irrelevant. History and revision are
// bookkeeping and are compared separately.
delete restored.history;
delete original.history;
restored.revision = original.revision;
const roundTrip = canonicalise(restored) === canonicalise(original);
if (!roundTrip) {
  process.stderr.write('\nUndo did not restore the original model. Differences:\n');
  process.stderr.write(`${firstDifference(canonicalise(original), canonicalise(restored))}\n`);
}
summary.push(`10   undo restored the original model exactly: ${roundTrip} (${undone.data.undone.length} operations reversed)`);

// A refusal is part of the contract too: quality levels cannot simply be claimed.
const refused = run('Try to declare the reconstruction as "scaled" (must fail)', [
  'validate', 'fixtures/06-uncertain-reconstruction/reconstruction.floorplan.json', '--quality', 'scaled',
], { expectFailure: true });
summary.push(`+    a purely estimated reconstruction is refused at quality "scaled": ${refused.data.issues.filter((/** @type {any} */ i) => i.severity === 'ERROR').map((/** @type {any} */ i) => i.rule).join(', ')}`);

process.stdout.write('\n\nResult\n======\n');
for (const line of summary) process.stdout.write(`${line}\n`);
process.stdout.write(`\nArtefacts in ${OUT}\n`);

if (!roundTrip || !geometryIdentical) {
  process.stderr.write('\nDemo finished with a failed assertion.\n');
  process.exit(1);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function firstDifference(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return `  at offset ${i}\n  expected: ...${a.slice(Math.max(0, i - 60), i + 60)}\n  actual:   ...${b.slice(Math.max(0, i - 60), i + 60)}`;
    }
  }
  return '  (no difference found)';
}

/**
 * The wall geometry layer of an SVG, with all styling attributes removed.
 * Used to show that a theme changes appearance but never geometry.
 * @param {string} svg
 * @returns {string}
 */
function extractGeometry(svg) {
  const paths = [...svg.matchAll(/<path[^>]*data-type="wall-fill"[^>]*\/>/g)].map((match) => match[0]);
  return paths.map((path) => (/ d="([^"]*)"/.exec(path)?.[1] ?? '')).join('\n');
}
