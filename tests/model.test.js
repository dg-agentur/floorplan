import { test } from 'node:test';
import assert from 'node:assert/strict';

import { indexDocument, listLevels, resolveLevel, resolveState, resolveWallHeight, wallVerticalExtent } from '../src/model/document.js';
import { resolveProvenance, isReliable, elementProvenance } from '../src/model/provenance.js';
import { createIdAllocator, generateId, isValidId, collectIdLikeStrings } from '../src/model/ids.js';
import { spaceAreaMm2, toSquareMetres, checkAreaOverride, levelMetrics } from '../src/model/measure.js';
import { canonicalise, deepClone, parseJson, stringifyStable } from '../src/util/json.js';
import { digest } from '../src/util/hash.js';
import { parseDocument, checkSchemaVersion } from '../src/model/io.js';
import { FloorplanError, DomainError } from '../src/util/errors.js';
import { FIXTURES, loadFixture, minimalDocument } from './helpers.js';

test('the document index finds every element and reports duplicates', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const index = indexDocument(doc);
  assert.equal(index.duplicateIds.length, 0);
  assert.equal(index.get('wall_ext_s')?.element.type, 'wall');
  assert.equal(index.get('space_hall')?.element.type, 'space');
  assert.equal(index.openingsOf('wall_corridor_n').map((o) => o.id).sort().join(','), 'door_bedroom,door_kitchen');
  assert.equal(index.get('does_not_exist'), undefined);
});

test('the index detects duplicate ids across different collections', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].spaces[0].id = 'wall_001';
  const index = indexDocument(doc);
  assert.deepEqual(index.duplicateIds, ['wall_001']);
});

test('require throws a helpful error for an unknown id', () => {
  const index = indexDocument(minimalDocument());
  assert.throws(() => index.require('nope'), (error) => error instanceof DomainError && error.code === 'UNKNOWN_ID');
  assert.throws(() => index.requireWall('space_001'), (error) => /** @type {any} */ (error).code === 'WRONG_ELEMENT_TYPE');
});

test('resolveLevel prefers the lowest non negative level index', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels.unshift({ id: 'level_kg', name: 'Basement', index: -1, elevation_mm: -2800 });
  doc.buildings[0].levels.push({ id: 'level_og', name: 'Upper', index: 1, elevation_mm: 2800 });
  assert.equal(resolveLevel(doc).id, 'level_eg');
  assert.equal(resolveLevel(doc, 'level_og').id, 'level_og');
  assert.throws(() => resolveLevel(doc, 'level_x'), (error) => /** @type {any} */ (error).code === 'UNKNOWN_LEVEL');
  assert.equal(listLevels(doc).length, 3);
});

test('defaults resolve element -> project defaults -> hard fallback', () => {
  const doc = minimalDocument();
  const wall = doc.buildings[0].levels[0].walls[0];
  assert.equal(resolveState(doc, wall), 'existing', 'from project defaults');
  wall.state = 'demolish';
  assert.equal(resolveState(doc, wall), 'demolish', 'element wins');
  delete doc.project.defaults;
  delete wall.state;
  assert.equal(resolveState(doc, wall), 'existing', 'hard fallback');
});

test('wall height falls back through project defaults to the level height', () => {
  const doc = minimalDocument();
  const level = doc.buildings[0].levels[0];
  const wall = level.walls[0];
  assert.equal(resolveWallHeight(doc, wall, level), 2500, 'level height');
  doc.project.defaults.wall_height_mm = 2600;
  assert.equal(resolveWallHeight(doc, wall, level), 2600);
  wall.height_mm = 3000;
  assert.equal(resolveWallHeight(doc, wall, level), 3000);
});

test('vertical extents are derived, never stored', () => {
  const doc = minimalDocument();
  const level = doc.buildings[0].levels[0];
  level.elevation_mm = 500;
  const wall = level.walls[0];
  wall.height_mm = 2400;
  wall.base_z_mm = 100;
  assert.deepEqual(wallVerticalExtent(doc, wall, level), { bottom_z_mm: 600, top_z_mm: 3000 });
  assert.equal('top_z_mm' in wall, false, 'derived values must not be persisted');
});

// --- provenance -------------------------------------------------------------

test('provenance resolves property override before element before defaults', () => {
  const doc = minimalDocument();
  const wall = doc.buildings[0].levels[0].walls[0];

  assert.deepEqual(resolveProvenance(doc, wall, 'thickness_mm'), {
    provenance: 'provided', verified: false, source_id: undefined, origin: 'defaults',
  });

  wall.provenance = 'measured';
  wall.confidence = 0.9;
  assert.equal(resolveProvenance(doc, wall, 'thickness_mm').provenance, 'measured');
  assert.equal(resolveProvenance(doc, wall, 'thickness_mm').origin, 'element');

  wall.property_provenance = { thickness_mm: { provenance: 'estimated', confidence: 0.4 } };
  const resolved = resolveProvenance(doc, wall, 'thickness_mm');
  assert.equal(resolved.provenance, 'estimated');
  assert.equal(resolved.confidence, 0.4);
  assert.equal(resolved.origin, 'property');
  assert.equal(resolveProvenance(doc, wall, 'start').provenance, 'measured', 'other properties are unaffected');
});

test('provenance falls back to unknown when nothing is declared', () => {
  const doc = minimalDocument();
  delete doc.project.defaults;
  const wall = doc.buildings[0].levels[0].walls[0];
  assert.equal(resolveProvenance(doc, wall).provenance, 'unknown');
});

test('isReliable treats derived as reliable only when verified', () => {
  assert.equal(isReliable('measured'), true);
  assert.equal(isReliable('provided'), true);
  assert.equal(isReliable('parsed'), true);
  assert.equal(isReliable('estimated'), false);
  assert.equal(isReliable('unknown'), false);
  assert.equal(isReliable({ provenance: 'derived', verified: false }), false);
  assert.equal(isReliable({ provenance: 'derived', verified: true }), true);
});

test('elementProvenance only reports properties that actually exist', () => {
  const doc = minimalDocument();
  const wall = doc.buildings[0].levels[0].walls[0];
  const properties = elementProvenance(doc, wall).map((entry) => entry.property).sort();
  assert.deepEqual(properties, ['end', 'start', 'thickness_mm']);
  assert.equal(properties.includes('height_mm'), false, 'height is not set on this wall');
});

// --- identifiers -------------------------------------------------------------

test('id validation follows the documented pattern', () => {
  assert.equal(isValidId('wall_001'), true);
  assert.equal(isValidId('space_kitchen'), true);
  assert.equal(isValidId('Wall_001'), false);
  assert.equal(isValidId('1wall'), false);
  assert.equal(isValidId('wall-001'), false);
  assert.equal(isValidId(''), false);
});

test('generated ids are deterministic and take the lowest free number', () => {
  const doc = minimalDocument();
  assert.equal(generateId(doc, 'wall'), 'wall_005');
  assert.equal(generateId(doc, 'door'), 'door_001');
  assert.equal(generateId(doc, 'wall'), 'wall_005', 'generation without an allocator is pure');
});

test('the id allocator never reuses an id, not even one only mentioned in history', () => {
  const doc = minimalDocument();
  doc.history = [{
    index: 0,
    operation: { op: 'delete_element', target_id: 'wall_009' },
    summary: 'deleted',
    inverse: [{ op: 'restore_element', level_id: 'level_eg', element: { id: 'wall_009', type: 'wall' } }],
  }];
  const allocator = createIdAllocator(doc);
  const generated = [];
  for (let i = 0; i < 6; i += 1) generated.push(allocator.next('wall'));
  assert.equal(generated.includes('wall_009'), false, 'an id held by an undo entry stays reserved');
  assert.deepEqual(generated, ['wall_005', 'wall_006', 'wall_007', 'wall_008', 'wall_010', 'wall_011']);
});

test('an explicit id that is already taken is refused', () => {
  const allocator = createIdAllocator(minimalDocument());
  assert.throws(() => allocator.next('wall', 'wall_001'), (error) => /** @type {any} */ (error).code === 'ID_ALREADY_IN_USE');
  assert.equal(allocator.next('wall', 'wall_custom'), 'wall_custom');
});

test('collectIdLikeStrings finds ids anywhere in the document', () => {
  const found = collectIdLikeStrings({ a: 'wall_001', b: [{ c: 'space_x' }], d: 'Not An Id' });
  assert.equal(found.has('wall_001'), true);
  assert.equal(found.has('space_x'), true);
  assert.equal(found.has('Not An Id'), false);
});

// --- measurement ---------------------------------------------------------------

test('areas are computed from the polygon, never stored', () => {
  const doc = loadFixture(FIXTURES.simpleRoom);
  const space = doc.buildings[0].levels[0].spaces[0];
  assert.equal(spaceAreaMm2(space), 4200 * 3400);
  assert.equal(toSquareMetres(spaceAreaMm2(space)), 14.28);
});

test('a declared area is cross checked but never used to change geometry', () => {
  const doc = loadFixture(FIXTURES.simpleRoom);
  const space = doc.buildings[0].levels[0].spaces[0];
  assert.equal(checkAreaOverride(space), null);

  space.area_override_mm2 = 14_280_000;
  assert.equal(checkAreaOverride(space)?.matches, true);

  space.area_override_mm2 = 16_000_000;
  const mismatch = checkAreaOverride(space);
  assert.equal(mismatch?.matches, false);
  assert.equal(spaceAreaMm2(space), 4200 * 3400, 'the polygon is untouched');
});

test('level metrics sum the room polygons, excluding walls', () => {
  const metrics = levelMetrics(loadFixture(FIXTURES.apartment).buildings[0].levels[0]);
  assert.equal(metrics.space_count, 5);
  assert.equal(metrics.wall_count, 8);
  assert.equal(metrics.opening_count, 9);
  assert.ok(metrics.total_floor_area_mm2 > 60_000_000 && metrics.total_floor_area_mm2 < 80_000_000);
});

// --- serialisation ------------------------------------------------------------

test('stable serialisation is byte identical regardless of key insertion order', () => {
  const a = { b: 1, a: 2, meta: {}, id: 'x' };
  const b = { id: 'x', a: 2, meta: {}, b: 1 };
  assert.equal(stringifyStable(a), stringifyStable(b));
  assert.match(stringifyStable(a), /^\{\n  "id": "x"/, 'id comes first');
  assert.match(stringifyStable(a), /\n$/, 'ends with a newline');
});

test('points are serialised inline for readability', () => {
  const text = stringifyStable({ start: { x_mm: 0, y_mm: 100 } });
  assert.match(text, /"start": \{ "x_mm": 0, "y_mm": 100 \}/);
});

test('serialisation refuses non finite numbers instead of writing null', () => {
  assert.throws(() => stringifyStable({ x: Number.NaN }), (error) => error instanceof FloorplanError && error.code === 'NON_FINITE_NUMBER');
});

test('canonicalise is order independent and drives stable digests', () => {
  assert.equal(canonicalise({ a: 1, b: 2 }), canonicalise({ b: 2, a: 1 }));
  assert.equal(digest({ op: 'x', a: 1 }), digest({ a: 1, op: 'x' }));
  assert.notEqual(digest({ op: 'x' }), digest({ op: 'y' }));
  assert.equal(digest({ op: 'x' }).length, 16);
});

test('parseJson reports line and column', () => {
  assert.throws(
    () => parseJson('{\n  "a": 1,\n}', 'test'),
    (error) => error instanceof FloorplanError && error.code === 'INVALID_JSON' && /line \d+/.test(error.message),
  );
});

test('deepClone produces an independent copy', () => {
  const original = minimalDocument();
  const copy = deepClone(original);
  copy.buildings[0].levels[0].walls[0].thickness_mm = 999;
  assert.equal(original.buildings[0].levels[0].walls[0].thickness_mm, 200);
});

// --- versioning ---------------------------------------------------------------

test('schema version compatibility follows the documented rules', () => {
  assert.equal(checkSchemaVersion('0.1'), undefined);
  assert.match(String(checkSchemaVersion('0.2')), /newer minor schema version/);
  assert.throws(() => checkSchemaVersion('1.0'), (error) => /** @type {any} */ (error).code === 'INCOMPATIBLE_SCHEMA_VERSION');
  assert.throws(() => checkSchemaVersion('nonsense'), (error) => /** @type {any} */ (error).code === 'INVALID_SCHEMA_VERSION');
});

test('parseDocument rejects a document that violates the schema', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].walls[0].thickness_mm = 0;
  assert.throws(() => parseDocument(doc), (error) => /** @type {any} */ (error).code === 'SCHEMA_INVALID');
});

test('parseDocument rejects an unknown property, so typos cannot pass silently', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].walls[0].thikness_mm = 200;
  assert.throws(() => parseDocument(doc), (error) => /** @type {any} */ (error).code === 'SCHEMA_INVALID');
});
