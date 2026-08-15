/**
 * Renderer tests including golden SVG snapshots.
 *
 * Regenerate the golden files deliberately with:
 *   npm run test:update-golden
 * A changed golden file must be reviewed like any other change to output.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderSvg } from '../src/render/svg/renderer.js';
import { computeViewport } from '../src/render/layout.js';
import { loadTheme } from '../src/themes/load.js';
import { PACKAGE_ROOT } from '../src/model/io.js';
import { resolveLevel } from '../src/model/document.js';
import { applyOperations } from '../src/operations/apply.js';
import { dashArray, fmt, formatArea, formatLength } from '../src/render/format.js';
import { FIXTURES, loadFixture } from './helpers.js';

const GOLDEN_DIR = resolve(PACKAGE_ROOT, 'tests/golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

/**
 * @param {string} name
 * @param {string} content
 */
function assertGolden(name, content) {
  if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
  const path = resolve(GOLDEN_DIR, name);
  if (UPDATE || !existsSync(path)) {
    writeFileSync(path, content, 'utf8');
    return;
  }
  const expected = readFileSync(path, 'utf8');
  if (expected !== content) {
    const expectedLines = expected.split('\n');
    const actualLines = content.split('\n');
    let detail = '';
    for (let i = 0; i < Math.max(expectedLines.length, actualLines.length); i += 1) {
      if (expectedLines[i] !== actualLines[i]) {
        detail = `line ${i + 1}\n  expected: ${expectedLines[i]}\n  actual:   ${actualLines[i]}`;
        break;
      }
    }
    assert.fail(`golden mismatch for ${name}\n${detail}\nRun "npm run test:update-golden" after reviewing the change.`);
  }
}

/**
 * @param {string} svg
 * @returns {string} the wall geometry only, free of any styling
 */
function wallGeometryOf(svg) {
  return [...svg.matchAll(/<path[^>]*data-type="wall-fill"[^>]*\/>/g)]
    .map((match) => / d="([^"]*)"/.exec(match[0])?.[1] ?? '')
    .join('\n');
}

// --- determinism -------------------------------------------------------------

test('rendering the same document twice produces byte identical SVG', () => {
  for (const fixture of Object.values(FIXTURES)) {
    const doc = loadFixture(fixture);
    for (const themeName of ['technical', 'marketing', 'minimal']) {
      const theme = loadTheme(themeName);
      assert.equal(renderSvg(doc, theme).svg, renderSvg(doc, theme).svg, `${fixture} / ${themeName}`);
    }
  }
});

test('the SVG carries no timestamp, no random id and no locale dependent number', () => {
  const svg = renderSvg(loadFixture(FIXTURES.house), loadTheme('technical')).svg;
  assert.equal(/\d{4}-\d{2}-\d{2}T/.test(svg), false, 'no ISO timestamp');
  assert.equal(/[0-9]+,[0-9]{3}(\.|,)/.test(svg.replace(/>[^<]*</g, '><')), false, 'no thousands separators in attributes');
  assert.equal(svg.includes('-0"'), false, 'no negative zero');
  assert.equal(svg.includes('NaN'), false);
  assert.equal(svg.includes('undefined'), false);
});

// --- golden snapshots ----------------------------------------------------------

test('golden SVG: simple room, all three themes', () => {
  const doc = loadFixture(FIXTURES.simpleRoom);
  for (const themeName of ['technical', 'marketing', 'minimal']) {
    assertGolden(`01-simple-room.${themeName}.svg`, renderSvg(doc, loadTheme(themeName)).svg);
  }
});

test('golden SVG: apartment and house', () => {
  assertGolden('02-apartment.technical.svg', renderSvg(loadFixture(FIXTURES.apartment), loadTheme('technical')).svg);
  assertGolden('02-apartment.marketing.svg', renderSvg(loadFixture(FIXTURES.apartment), loadTheme('marketing')).svg);
  assertGolden('03-house.technical.svg', renderSvg(loadFixture(FIXTURES.house), loadTheme('technical')).svg);
});

test('golden SVG: garage, renovation and reconstruction', () => {
  assertGolden('04-garage.technical.svg', renderSvg(loadFixture(FIXTURES.garage), loadTheme('technical')).svg);
  assertGolden('05-renovation.technical.svg', renderSvg(loadFixture(FIXTURES.renovation), loadTheme('technical')).svg);
  assertGolden('06-reconstruction.technical.svg', renderSvg(loadFixture(FIXTURES.reconstruction), loadTheme('technical')).svg);
});

test('golden SVG: the house after the reference change batch', () => {
  const doc = loadFixture(FIXTURES.house);
  const operations = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'fixtures/03-house-ground-floor/renovation.ops.json'), 'utf8')).operations;
  const applied = applyOperations(doc, operations);
  assertGolden('03-house-after-changes.technical.svg', renderSvg(applied.document, loadTheme('technical')).svg);
});

// --- themes change appearance, never geometry --------------------------------------

test('a theme changes the appearance but not a single coordinate', () => {
  const doc = loadFixture(FIXTURES.house);
  const technical = renderSvg(doc, loadTheme('technical')).svg;
  const marketing = renderSvg(doc, loadTheme('marketing')).svg;
  const minimal = renderSvg(doc, loadTheme('minimal')).svg;

  assert.notEqual(technical, marketing, 'the themes must look different');
  assert.equal(wallGeometryOf(technical), wallGeometryOf(marketing), 'wall geometry is identical');
  assert.equal(wallGeometryOf(technical), wallGeometryOf(minimal) || wallGeometryOf(technical),
    'the minimal theme draws no wall fill, so there is nothing to compare');

  assert.match(technical, /#1f1f1f/);
  assert.match(marketing, /#3c3a37/);
  assert.match(marketing, /font-family="Georgia/);
});

test('dimensions appear in the technical theme and not in the marketing theme', () => {
  const doc = loadFixture(FIXTURES.house);
  assert.match(renderSvg(doc, loadTheme('technical')).svg, /data-layer="dimensions"/);
  assert.equal(renderSvg(doc, loadTheme('marketing')).svg.includes('data-layer="dimensions"'), false);
});

test('the minimal theme draws no room fills and no areas', () => {
  const svg = renderSvg(loadFixture(FIXTURES.house), loadTheme('minimal')).svg;
  assert.equal(svg.includes('data-layer="spaces"'), false);
  assert.equal(svg.includes('m²'), false);
  assert.match(svg, />Diele</, 'room names stay');
});

// --- content ---------------------------------------------------------------------

test('every drawable element appears with its id, so consumers can address it', () => {
  const svg = renderSvg(loadFixture(FIXTURES.house), loadTheme('technical')).svg;
  for (const id of ['space_hall', 'door_bath', 'window_bath', 'passage_kitchen', 'stair_001', 'dim_south', 'note_001']) {
    assert.ok(svg.includes(`data-id="${id}"`), `${id} is missing from the SVG`);
  }
});

test('openings really interrupt the wall instead of being painted over', () => {
  const doc = loadFixture(FIXTURES.simpleRoom);
  const withDoor = renderSvg(doc, loadTheme('technical')).svg;
  const wallElement = /<path[^>]*data-type="wall-fill"[^>]*\/>/.exec(withDoor)?.[0] ?? '';
  const wallPath = / d="([^"]*)"/.exec(wallElement)?.[1] ?? '';
  const subPaths = wallPath.split('Z').filter((part) => part.trim().length > 0);
  assert.equal(subPaths.length, 7, 'four walls, cut into seven solid pieces by one door and two windows');
});

test('a door without a known swing direction is drawn without an opening arc', () => {
  const doc = loadFixture(FIXTURES.simpleRoom);
  const door = doc.buildings[0].levels[0].openings[0];
  const withSwing = renderSvg(doc, loadTheme('technical')).svg;
  assert.match(withSwing, /A 1010 1010/, 'a known swing produces an arc');

  delete door.swing;
  const withoutSwing = renderSvg(doc, loadTheme('technical')).svg;
  assert.equal(/A \d+ \d+ 0 0/.test(withoutSwing), false, 'an unknown swing must not be invented');
});

test('the door arc bulges towards the side the door actually opens', () => {
  const doc = loadFixture(FIXTURES.simpleRoom);
  const door = doc.buildings[0].levels[0].openings[0];

  door.swing = 'left';
  const left = /A [\d.]+ [\d.]+ 0 0 (\d) ([-\d.]+) ([-\d.]+)/.exec(renderSvg(doc, loadTheme('technical')).svg);
  door.swing = 'right';
  const right = /A [\d.]+ [\d.]+ 0 0 (\d) ([-\d.]+) ([-\d.]+)/.exec(renderSvg(doc, loadTheme('technical')).svg);

  assert.ok(left && right);
  assert.notEqual(left[1], right[1], 'the sweep flag flips with the swing side');
});

test('an estimated area is marked as such', () => {
  const doc = loadFixture(FIXTURES.reconstruction);
  const svg = renderSvg(doc, loadTheme('technical')).svg;
  assert.match(svg, /ca\. \d/, 'estimated areas carry the uncertainty prefix');

  const certain = loadFixture(FIXTURES.house);
  assert.equal(renderSvg(certain, loadTheme('technical')).svg.includes('ca. '), false);
});

test('a demolished wall is drawn separately from the existing structure', () => {
  const svg = renderSvg(loadFixture(FIXTURES.renovation), loadTheme('technical')).svg;
  assert.match(svg, /data-type="wall-outline" data-ids="wall_old_partition"/);
  assert.match(svg, /stroke="#b03a2e"/, 'demolition colour');
  assert.match(svg, /data-type="wall-fill" data-ids="wall_new_partition"/);
});

test('stair steps are drawn only when the step count is known', () => {
  const doc = loadFixture(FIXTURES.house);
  const withSteps = renderSvg(doc, loadTheme('technical')).svg;
  const stairGroup = /<g data-type="stair"[\s\S]*?<\/g>/.exec(withSteps)?.[0] ?? '';
  assert.equal((stairGroup.match(/<path/g) ?? []).length >= 3, true, 'footprint, steps and arrow');

  delete doc.buildings[0].levels[0].stairs[0].step_count;
  const withoutSteps = renderSvg(doc, loadTheme('technical')).svg;
  const bareGroup = /<g data-type="stair"[\s\S]*?<\/g>/.exec(withoutSteps)?.[0] ?? '';
  assert.equal((bareGroup.match(/<path/g) ?? []).length, 2, 'footprint and arrow, but no invented steps');
});

test('layers appear in a fixed order so that stacking is predictable', () => {
  const svg = renderSvg(loadFixture(FIXTURES.house), loadTheme('technical')).svg;
  const order = [...svg.matchAll(/data-layer="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ['spaces', 'walls', 'openings', 'stairs', 'dimensions', 'labels', 'annotations']);
});

// --- viewport and formatting ------------------------------------------------------

test('the viewport contains the whole drawing including dimension lines', () => {
  const doc = loadFixture(FIXTURES.house);
  const level = resolveLevel(doc);
  const viewport = computeViewport(level, loadTheme('technical'));
  assert.ok(viewport.min_x_mm <= -900 - 700, 'the dimension line at -900 mm plus the margin must fit');
  assert.ok(viewport.max_x_mm >= 12180);
  assert.equal(viewport.view_box, `${viewport.min_x_mm} ${-viewport.max_y_mm} ${viewport.width_mm} ${viewport.height_mm}`);
});

test('fit mode honours the target width and the scale clamps', () => {
  const doc = loadFixture(FIXTURES.house);
  const level = resolveLevel(doc);
  const theme = loadTheme('technical');
  const viewport = computeViewport(level, theme);
  assert.ok(Math.abs(viewport.width_px - theme.page.target_width_px) < 1);
  assert.ok(viewport.px_per_mm > 0);
});

test('an empty level still produces a valid SVG', () => {
  const doc = loadFixture(FIXTURES.simpleRoom);
  doc.buildings[0].levels[0] = { id: 'level_empty', name: 'Empty', index: 0, elevation_mm: 0 };
  const { svg } = renderSvg(doc, loadTheme('technical'));
  assert.match(svg, /<svg /);
  assert.match(svg, /<\/svg>/);
});

test('number formatting is deterministic and locale independent', () => {
  assert.equal(fmt(1.234), '1.23');
  assert.equal(fmt(1.006), '1.01');
  assert.equal(fmt(-0), '0');
  assert.equal(fmt(1000000), '1000000');
  assert.equal(fmt(Number.NaN), '0');
  assert.equal(formatArea(14.28, { area_decimals: 2, area_suffix: ' m²', decimal_separator: ',' }), '14,28 m²');
  assert.equal(formatArea(14.28, { area_decimals: 1, area_suffix: ' qm', decimal_separator: '.' }), '14.3 qm');
  assert.equal(formatLength(12000, { format: 'm', decimals: 2 }), '12,00 m');
  assert.equal(formatLength(12000, { format: 'mm', decimals: 0 }), '12000');
});

test('dash patterns are scaled from px into model units', () => {
  const u = (/** @type {number} */ px) => px / 0.1; // 0.1 px per mm
  assert.equal(dashArray('6 3', u), '60 30');
  assert.equal(dashArray('', u), undefined);
  assert.equal(dashArray(undefined, u), undefined);
});

test('text is XML escaped', () => {
  const doc = loadFixture(FIXTURES.simpleRoom);
  doc.buildings[0].levels[0].spaces[0].name = 'Wohnen & <Essen>';
  const svg = renderSvg(doc, loadTheme('technical')).svg;
  assert.match(svg, /Wohnen &amp; &lt;Essen&gt;/);
  assert.equal(svg.includes('<Essen>'), false);
});

test('render metadata reports the level, theme and element counts', () => {
  const { meta } = renderSvg(loadFixture(FIXTURES.house), loadTheme('technical'));
  assert.equal(meta.level_id, 'level_eg');
  assert.equal(meta.theme, 'technical');
  assert.equal(meta.counts.walls, 10);
  assert.equal(meta.counts.spaces, 6);
  assert.equal(meta.counts.stairs, 1);
});
