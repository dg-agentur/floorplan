import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reconcileObservations } from '../src/importers/observations/reconcile.js';
import { validateDocument } from '../src/validation/validate.js';
import { indexDocument } from '../src/model/document.js';
import { canonicalise } from '../src/util/json.js';
import { getSchemaValidator } from '../src/model/io.js';
import { OBSERVATION_FIXTURES, readFixtureJson } from './helpers.js';

/** @returns {any} */
function observationSet() {
  return readFixtureJson(OBSERVATION_FIXTURES.expose);
}

/**
 * @param {{observations?: any[], calibration?: any}} [overrides]
 * @returns {any}
 */
function minimalSet(overrides = {}) {
  return {
    schema_version: '0.1',
    unit: 'mm',
    source: { id: 'src_test', kind: 'image', uri: 'test.png' },
    observations: overrides.observations ?? [],
    ...(overrides.calibration ? { calibration: overrides.calibration } : {}),
  };
}

/**
 * @param {string} id
 * @param {number[]} coords
 * @param {any} [extra]
 * @returns {any}
 */
function wallObservation(id, [ax, ay, bx, by], extra = {}) {
  return {
    id,
    candidate_type: 'wall',
    confidence: 0.9,
    geometry: { kind: 'segment', start: { x_mm: ax, y_mm: ay }, end: { x_mm: bx, y_mm: by } },
    attributes: { thickness_mm: 200, ...(extra.attributes ?? {}) },
    ...extra,
  };
}

test('the fixture observation set is schema valid', () => {
  assert.deepEqual(getSchemaValidator('observations').validate(observationSet()), []);
});

test('reconciliation is deterministic', () => {
  const options = { defaultThicknessMm: 120, snapMm: 10 };
  const a = reconcileObservations(observationSet(), options);
  const b = reconcileObservations(observationSet(), options);
  assert.equal(canonicalise(a.document), canonicalise(b.document));
  assert.equal(canonicalise(a.report), canonicalise(b.report));
});

test('the reconstruction validates and stays at marketing quality', () => {
  const { document, report } = reconcileObservations(observationSet(), { defaultThicknessMm: 120 });
  assert.equal(validateDocument(document).ok, true);
  assert.equal(document.project.quality, 'marketing');
  assert.match(report.quality_reason, /No reliable calibration/);
});

test('every observation is accounted for — nothing disappears silently', () => {
  const set = observationSet();
  const { report } = reconcileObservations(set, { defaultThicknessMm: 120 });
  const reported = new Set(report.entries.map((entry) => entry.observation_id));
  for (const observation of set.observations) {
    assert.ok(reported.has(observation.id), `${observation.id} is missing from the report`);
  }
  assert.equal(report.entries.length, set.observations.length);
});

test('collinear wall fragments are merged into one wall', () => {
  const { document, report } = reconcileObservations(observationSet(), { defaultThicknessMm: 120 });
  const merged = report.entries.filter((entry) => entry.status === 'merged');
  assert.equal(merged.length, 2, 'the two halves of the north wall');
  assert.equal(new Set(merged.map((entry) => entry.element_id)).size, 1, 'they became a single wall');

  const level = document.buildings[0].levels[0];
  const north = level.walls.find((/** @type {any} */ w) => w.observation_ids.length === 2);
  assert.ok(north);
  assert.equal(Math.abs(north.start.x_mm - north.end.x_mm), 7000, 'the merged wall spans the full width');
  assert.equal(north.start.y_mm, north.end.y_mm, 'and is straightened');
});

test('a wall without a thickness is rejected unless a default is supplied explicitly', () => {
  const set = minimalSet({
    observations: [{
      id: 'obs_a',
      candidate_type: 'wall',
      confidence: 0.9,
      geometry: { kind: 'segment', start: { x_mm: 0, y_mm: 0 }, end: { x_mm: 3000, y_mm: 0 } },
    }],
  });
  const without = reconcileObservations(set);
  assert.equal(without.report.entries[0].status, 'rejected');
  assert.match(String(without.report.entries[0].reason), /no explicit default thickness/);

  const withDefault = reconcileObservations(set, { defaultThicknessMm: 115 });
  assert.equal(withDefault.report.entries[0].status, 'accepted');
  const wall = withDefault.document.buildings[0].levels[0].walls[0];
  assert.equal(wall.thickness_mm, 115);
  assert.equal(wall.property_provenance.thickness_mm.provenance, 'estimated', 'the assumption is recorded');
  assert.match(withDefault.report.assumptions.join(' '), /default wall thickness/i);
});

test('an interpreter can never claim that something was measured', () => {
  const set = minimalSet({
    observations: [wallObservation('obs_a', [0, 0, 3000, 0], { provenance_hint: 'measured' })],
  });
  const { document, report } = reconcileObservations(set);
  assert.equal(document.buildings[0].levels[0].walls[0].provenance, 'parsed');
  assert.match(report.assumptions.join(' '), /downgraded to "parsed"/);
});

test('a window without a sill height is rejected instead of being guessed', () => {
  const { report } = reconcileObservations(observationSet(), { defaultThicknessMm: 120 });
  const rejected = report.entries.find((entry) => entry.observation_id === 'obs_window_no_sill');
  assert.equal(rejected?.status, 'rejected');
  assert.match(String(rejected?.reason), /sill height is never guessed/);
});

test('an opening far from every wall is rejected with the distance in the reason', () => {
  const { report } = reconcileObservations(observationSet(), { defaultThicknessMm: 120 });
  const rejected = report.entries.find((entry) => entry.observation_id === 'obs_opening_floating');
  assert.equal(rejected?.status, 'rejected');
  assert.match(String(rejected?.reason), /no wall found within 400 mm/);
});

test('low confidence observations are filtered and the threshold is configurable', () => {
  const strict = reconcileObservations(observationSet(), { defaultThicknessMm: 120, minConfidence: 0.5 });
  assert.equal(strict.report.entries.find((e) => e.observation_id === 'obs_wall_ghost')?.status, 'rejected');

  const lenient = reconcileObservations(observationSet(), { defaultThicknessMm: 120, minConfidence: 0.2 });
  assert.notEqual(lenient.report.entries.find((e) => e.observation_id === 'obs_wall_ghost')?.status, 'rejected');
});

test('an unclear opening becomes a generic opening, not a guessed door', () => {
  const { document } = reconcileObservations(observationSet(), { defaultThicknessMm: 120 });
  const openings = document.buildings[0].levels[0].openings;
  const generic = openings.find((/** @type {any} */ o) => o.observation_ids.includes('obs_opening_unclear'));
  assert.equal(generic?.type, 'generic_opening');
});

test('a door with an unknown swing direction keeps that unknown', () => {
  const { document, report } = reconcileObservations(observationSet(), { defaultThicknessMm: 120 });
  const doors = document.buildings[0].levels[0].openings.filter((/** @type {any} */ o) => o.type === 'door');
  assert.ok(doors.length >= 2);
  for (const door of doors) {
    assert.equal('swing' in door, false, 'the swing side must not be invented');
  }
  assert.match(report.assumptions.join(' '), /classified as a swing door/);
});

test('observations superseded by a later one are ignored', () => {
  const set = minimalSet({
    observations: [
      wallObservation('obs_a', [0, 0, 3000, 0]),
      { ...wallObservation('obs_b', [0, 0, 4000, 0]), supersedes: ['obs_a'] },
    ],
  });
  const { document, report } = reconcileObservations(set);
  assert.equal(report.entries.find((e) => e.observation_id === 'obs_a')?.reason, 'superseded by a later observation');
  assert.equal(document.buildings[0].levels[0].walls.length, 1);
  assert.equal(document.buildings[0].levels[0].walls[0].end.x_mm, 4000);
});

test('a reliable calibration allows the quality level to rise, but only if it validates', () => {
  const set = minimalSet({
    calibration: { scale_mm_per_px: 8, provenance: 'parsed', confidence: 0.9 },
    observations: [
      wallObservation('obs_s', [0, 0, 4000, 0], { provenance_hint: 'parsed' }),
      wallObservation('obs_e', [4000, 0, 4000, 3000], { provenance_hint: 'parsed' }),
      wallObservation('obs_n', [4000, 3000, 0, 3000], { provenance_hint: 'parsed' }),
      wallObservation('obs_w', [0, 3000, 0, 0], { provenance_hint: 'parsed' }),
    ],
  });
  const { document, report } = reconcileObservations(set);
  assert.equal(document.project.quality, 'scaled');
  assert.match(report.quality_reason, /validates at "scaled"/);
  assert.equal(validateDocument(document, { quality: 'scaled' }).ok, true);
});

test('an estimated calibration keeps the document at marketing even when it would validate', () => {
  const set = minimalSet({
    calibration: { scale_mm_per_px: 8, provenance: 'estimated', confidence: 0.4 },
    observations: [wallObservation('obs_s', [0, 0, 4000, 0], { provenance_hint: 'parsed' })],
  });
  const { document } = reconcileObservations(set);
  assert.equal(document.project.quality, 'marketing');
});

test('wall ends that nearly meet are snapped so corners can be mitred', () => {
  const set = minimalSet({
    observations: [
      wallObservation('obs_a', [0, 0, 4000, 0]),
      wallObservation('obs_b', [4008, 6, 4008, 3000]),
    ],
  });
  const { document } = reconcileObservations(set, { snapMm: 10 });
  const walls = document.buildings[0].levels[0].walls;
  assert.deepEqual(walls[1].start, walls[0].end, 'the junction closes exactly');
});

test('candidate types that are not supported yet are reported, not ignored', () => {
  const { report } = reconcileObservations(observationSet(), { defaultThicknessMm: 120 });
  const stair = report.entries.find((entry) => entry.observation_id === 'obs_stair');
  assert.equal(stair?.status, 'rejected');
  assert.match(String(stair?.reason), /not reconciled by this version/);
});

test('a schema invalid observation set is refused with a precise message', () => {
  assert.throws(
    () => reconcileObservations({ schema_version: '0.1', unit: 'mm', source: { id: 'x', kind: 'image' }, observations: [{ id: 'a' }] }),
    (error) => /** @type {any} */ (error).code === 'INVALID_OBSERVATIONS',
  );
});

test('the resulting document references the source of every element', () => {
  const { document } = reconcileObservations(observationSet(), { defaultThicknessMm: 120 });
  const index = indexDocument(document);
  for (const [, ref] of index.byId) {
    if (ref.element.type === 'annotation') continue;
    assert.equal(/** @type {any} */ (ref.element).source_id, 'src_expose', `${ref.element.id} lost its source`);
  }
  assert.equal(document.sources[0].id, 'src_expose');
});
