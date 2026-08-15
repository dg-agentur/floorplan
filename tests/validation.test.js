/**
 * Every semantic rule gets at least one test that makes it fire, and the
 * severity matrix is verified against the quality levels.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateDocument, assertValid } from '../src/validation/validate.js';
import { SEVERITY_POLICY, listRules, severityFor } from '../src/validation/severityPolicy.js';
import { QUALITY_LEVELS } from '../src/model/constants.js';
import { FIXTURES, issuesFor, loadFixture, minimalDocument } from './helpers.js';

/**
 * @param {any} doc
 * @param {string} rule
 * @param {string} [quality]
 */
function assertFires(doc, rule, quality) {
  const report = validateDocument(doc, { quality });
  const hits = issuesFor(report, rule);
  assert.ok(hits.length > 0, `expected rule ${rule} to fire; got: ${report.issues.map((i) => i.rule).join(', ') || '(none)'}`);
  return hits;
}

/**
 * @param {any} doc
 * @param {string} rule
 */
function assertQuiet(doc, rule) {
  const report = validateDocument(doc);
  assert.equal(issuesFor(report, rule).length, 0, `rule ${rule} should not fire here`);
}

/** @returns {any} a level with a door, used as a base for negative cases */
function docWithDoor() {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].openings = [{
    id: 'door_001',
    type: 'door',
    host_wall_id: 'wall_001',
    offset_mm: 2000,
    width_mm: 900,
    height_mm: 2010,
    door_type: 'swing',
    hinge: 'left',
    swing: 'left',
  }];
  return doc;
}

// --- the fixtures are the positive control ---------------------------------

test('all fixtures validate at their declared quality level', () => {
  for (const [name, path] of Object.entries(FIXTURES)) {
    const doc = loadFixture(path);
    const report = validateDocument(doc);
    assert.equal(report.ok, true, `${name}: ${report.issues.filter((i) => i.severity === 'ERROR').map((i) => `${i.rule} ${i.message}`).join(' | ')}`);
  }
});

test('assertValid throws with a machine readable report', () => {
  const doc = docWithDoor();
  doc.buildings[0].levels[0].openings[0].host_wall_id = 'wall_nope';
  assert.throws(() => assertValid(doc), (error) => {
    const err = /** @type {any} */ (error);
    return err.code === 'VALIDATION_FAILED' && err.report.counts.ERROR > 0;
  });
});

// --- referential rules -------------------------------------------------------

test('DUPLICATE_ID', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].walls[1].id = 'wall_001';
  assertFires(doc, 'DUPLICATE_ID');
});

test('UNKNOWN_HOST_WALL', () => {
  const doc = docWithDoor();
  doc.buildings[0].levels[0].openings[0].host_wall_id = 'wall_missing';
  assertFires(doc, 'UNKNOWN_HOST_WALL');
});

test('HOST_WALL_OTHER_LEVEL', () => {
  const doc = docWithDoor();
  const building = doc.buildings[0];
  building.levels.push({
    id: 'level_og', name: 'Upper', index: 1, elevation_mm: 2800,
    openings: [{
      id: 'door_002', type: 'door', host_wall_id: 'wall_001',
      offset_mm: 1000, width_mm: 900, door_type: 'swing',
    }],
  });
  assertFires(doc, 'HOST_WALL_OTHER_LEVEL');
});

test('UNKNOWN_SPACE_REF', () => {
  const doc = docWithDoor();
  doc.buildings[0].levels[0].openings[0].connects_space_ids = ['space_nope'];
  assertFires(doc, 'UNKNOWN_SPACE_REF');
});

test('UNKNOWN_LEVEL_REF', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].stairs = [{
    id: 'stair_001',
    type: 'stair',
    footprint: [{ x_mm: 500, y_mm: 500 }, { x_mm: 1500, y_mm: 500 }, { x_mm: 1500, y_mm: 2500 }, { x_mm: 500, y_mm: 2500 }],
    run_start: { x_mm: 1000, y_mm: 500 },
    run_end: { x_mm: 1000, y_mm: 2500 },
    to_level_id: 'level_nope',
  }];
  assertFires(doc, 'UNKNOWN_LEVEL_REF');
});

test('UNKNOWN_SOURCE_REF', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].walls[0].source_id = 'src_nope';
  assertFires(doc, 'UNKNOWN_SOURCE_REF');
});

test('LEVEL_INDEX_DUPLICATE', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels.push({ id: 'level_two', name: 'Also ground', index: 0, elevation_mm: 0 });
  assertFires(doc, 'LEVEL_INDEX_DUPLICATE');
});

test('EMPTY_LEVEL', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels.push({ id: 'level_og', name: 'Upper', index: 1, elevation_mm: 2800 });
  assertFires(doc, 'EMPTY_LEVEL');
});

test('NON_FINITE_NUMBER is caught even though JSON cannot express it', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].walls[0].thickness_mm = Number.NaN;
  const report = validateDocument(doc, { skipSchema: true });
  assert.ok(issuesFor(report, 'NON_FINITE_NUMBER').length > 0);
});

// --- geometry rules ------------------------------------------------------------

test('WALL_ZERO_LENGTH', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].walls[0].end = { x_mm: 0, y_mm: 0 };
  assertFires(doc, 'WALL_ZERO_LENGTH');
});

test('OPENING_OUTSIDE_WALL fires when the opening runs past the wall end', () => {
  const doc = docWithDoor();
  doc.buildings[0].levels[0].openings[0].offset_mm = 3800;
  assertFires(doc, 'OPENING_OUTSIDE_WALL');
});

test('OPENING_OUTSIDE_WALL treats offset as the centre, not the edge', () => {
  const doc = docWithDoor();
  doc.buildings[0].levels[0].openings[0].offset_mm = 450;
  doc.buildings[0].levels[0].openings[0].width_mm = 900;
  assertQuiet(doc, 'OPENING_OUTSIDE_WALL');

  const tooFar = docWithDoor();
  tooFar.buildings[0].levels[0].openings[0].offset_mm = 400;
  tooFar.buildings[0].levels[0].openings[0].width_mm = 900;
  assertFires(tooFar, 'OPENING_OUTSIDE_WALL');
});

test('OPENING_WIDER_THAN_WALL', () => {
  const doc = docWithDoor();
  doc.buildings[0].levels[0].openings[0].width_mm = 5000;
  doc.buildings[0].levels[0].openings[0].offset_mm = 2000;
  assertFires(doc, 'OPENING_WIDER_THAN_WALL');
});

test('OPENING_OVERLAP', () => {
  const doc = docWithDoor();
  doc.buildings[0].levels[0].openings.push({
    id: 'door_002', type: 'door', host_wall_id: 'wall_001',
    offset_mm: 2400, width_mm: 900, door_type: 'swing',
  });
  assertFires(doc, 'OPENING_OVERLAP');
});

test('OPENING_NEAR_WALL_END', () => {
  const doc = docWithDoor();
  doc.buildings[0].levels[0].openings[0].offset_mm = 460;
  doc.buildings[0].levels[0].openings[0].width_mm = 900;
  assertFires(doc, 'OPENING_NEAR_WALL_END');
});

test('WINDOW_ABOVE_WALL', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].openings = [{
    id: 'window_001', type: 'window', host_wall_id: 'wall_001',
    offset_mm: 2000, width_mm: 1000, height_mm: 1400, sill_mm: 2000, window_type: 'fixed',
  }];
  assertFires(doc, 'WINDOW_ABOVE_WALL');
});

test('SPACE_SELF_INTERSECTING', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].spaces[0].boundary = [
    { x_mm: 100, y_mm: 100 }, { x_mm: 3900, y_mm: 2900 },
    { x_mm: 3900, y_mm: 100 }, { x_mm: 100, y_mm: 2900 },
  ];
  assertFires(doc, 'SPACE_SELF_INTERSECTING');
});

test('SPACE_DEGENERATE', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].spaces[0].boundary = [
    { x_mm: 100, y_mm: 100 }, { x_mm: 110, y_mm: 100 }, { x_mm: 110, y_mm: 110 },
  ];
  assertFires(doc, 'SPACE_DEGENERATE');
});

test('SPACE_OVERLAP', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].spaces.push({
    id: 'space_002', type: 'space', name: 'Overlapping', category: 'other',
    boundary: [
      { x_mm: 1000, y_mm: 1000 }, { x_mm: 3000, y_mm: 1000 },
      { x_mm: 3000, y_mm: 2000 }, { x_mm: 1000, y_mm: 2000 },
    ],
    provenance: 'derived', verified: true,
  });
  assertFires(doc, 'SPACE_OVERLAP');
});

test('SPACE_BOUNDARY_OFF_WALL', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].spaces[0].boundary = [
    { x_mm: 500, y_mm: 500 }, { x_mm: 3000, y_mm: 500 },
    { x_mm: 3000, y_mm: 2000 }, { x_mm: 500, y_mm: 2000 },
  ];
  assertFires(doc, 'SPACE_BOUNDARY_OFF_WALL');
});

test('SPACE_AREA_MISMATCH', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].spaces[0].area_override_mm2 = 20_000_000;
  const hits = assertFires(doc, 'SPACE_AREA_MISMATCH');
  assert.match(hits[0].message, /m²/);
});

test('SPACE_AREA_MISMATCH tolerates a small deviation', () => {
  const doc = minimalDocument();
  const exact = 3800 * 2800;
  doc.buildings[0].levels[0].spaces[0].area_override_mm2 = Math.round(exact * 1.01);
  assertQuiet(doc, 'SPACE_AREA_MISMATCH');
});

test('WALL_ENDPOINTS_NEAR_MISS', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].walls[1].start = { x_mm: 4005, y_mm: 3 };
  assertFires(doc, 'WALL_ENDPOINTS_NEAR_MISS');
});

test('WALL_FREE_END', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].walls.push({
    id: 'wall_stub', type: 'wall',
    start: { x_mm: 2000, y_mm: 1000 }, end: { x_mm: 3000, y_mm: 1000 },
    thickness_mm: 100,
  });
  const hits = assertFires(doc, 'WALL_FREE_END');
  assert.equal(hits.length, 2, 'both ends of the stub are free');
});

test('STAIR_RUN_OUTSIDE_FOOTPRINT', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].stairs = [{
    id: 'stair_001', type: 'stair',
    footprint: [{ x_mm: 500, y_mm: 500 }, { x_mm: 1500, y_mm: 500 }, { x_mm: 1500, y_mm: 2500 }, { x_mm: 500, y_mm: 2500 }],
    run_start: { x_mm: 3000, y_mm: 500 },
    run_end: { x_mm: 3000, y_mm: 2500 },
  }];
  assertFires(doc, 'STAIR_RUN_OUTSIDE_FOOTPRINT');
});

// --- topology rules --------------------------------------------------------------

test('OPENING_CONNECTIVITY_MISMATCH catches a declaration that contradicts geometry', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const opening = doc.buildings[0].levels[0].openings.find((o) => o.id === 'door_kitchen');
  opening.connects_space_ids = ['space_bath', 'space_living'];
  const hits = assertFires(doc, 'OPENING_CONNECTIVITY_MISMATCH');
  assert.match(hits[0].message, /geometrically connects/);
});

test('OPENING_WITHOUT_SPACE', () => {
  const doc = docWithDoor();
  delete doc.buildings[0].levels[0].spaces;
  assertFires(doc, 'OPENING_WITHOUT_SPACE');
});

test('SPACE_ISOLATED', () => {
  const doc = minimalDocument();
  assertFires(doc, 'SPACE_ISOLATED');
});

test('PLAN_DISCONNECTED', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const level = doc.buildings[0].levels[0];
  level.openings = level.openings.filter((o) => o.id !== 'door_bath');
  assertFires(doc, 'PLAN_DISCONNECTED');
});

test('SPACE_WITHOUT_EXIT', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const level = doc.buildings[0].levels[0];
  level.openings = level.openings.filter((o) => o.id !== 'door_entrance');
  const report = validateDocument(doc, { quality: 'verified' });
  assert.ok(issuesFor(report, 'SPACE_WITHOUT_EXIT').length > 0);
});

// --- provenance rules --------------------------------------------------------------

test('PROVENANCE_ESTIMATED and PROVENANCE_UNKNOWN', () => {
  const doc = minimalDocument();
  doc.project.defaults.provenance = 'estimated';
  assertFires(doc, 'PROVENANCE_ESTIMATED');

  const unknownDoc = minimalDocument();
  delete unknownDoc.project.defaults.provenance;
  unknownDoc.buildings[0].levels[0].spaces[0].provenance = 'unknown';
  assertFires(unknownDoc, 'PROVENANCE_UNKNOWN');
});

test('MISSING_SCALE_REFERENCE fires only when nothing is reliable', () => {
  const doc = minimalDocument();
  doc.project.defaults.provenance = 'estimated';
  doc.buildings[0].levels[0].spaces[0].provenance = 'estimated';
  delete doc.buildings[0].levels[0].spaces[0].verified;
  assertFires(doc, 'MISSING_SCALE_REFERENCE');

  doc.buildings[0].levels[0].walls[0].provenance = 'measured';
  assertQuiet(doc, 'MISSING_SCALE_REFERENCE');
});

test('GEOMETRY_NOT_ANCHORED fires when only annotations are reliable', () => {
  const doc = loadFixture(FIXTURES.reconstruction);
  assertFires(doc, 'GEOMETRY_NOT_ANCHORED');
  assert.equal(severityFor('GEOMETRY_NOT_ANCHORED', 'scaled'), 'ERROR');
  const strict = validateDocument(doc, { quality: 'scaled' });
  assert.equal(strict.ok, false, 'a purely estimated reconstruction cannot be "scaled"');
});

test('UNVERIFIED_VALUES is aggregated into a single finding', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const hits = assertFires(doc, 'UNVERIFIED_VALUES');
  assert.equal(hits.length, 1, 'one summary, not one line per value');
});

// --- plausibility ------------------------------------------------------------------

test('plausibility rules stay informational at every quality level', () => {
  const doc = minimalDocument();
  doc.buildings[0].levels[0].walls[0].thickness_mm = 1200;
  const hits = assertFires(doc, 'WALL_THICKNESS_UNUSUAL');
  assert.match(hits[0].hint ?? '', /not a requirement/);
  for (const quality of QUALITY_LEVELS) {
    assert.equal(severityFor('WALL_THICKNESS_UNUSUAL', quality), 'INFO');
    assert.equal(severityFor('DOOR_WIDTH_UNUSUAL', quality), 'INFO');
  }
});

test('DOOR_WIDTH_UNUSUAL knows that garage doors are wide', () => {
  const doc = docWithDoor();
  doc.buildings[0].levels[0].walls[0].end = { x_mm: 8000, y_mm: 0 };
  doc.buildings[0].levels[0].walls[1].start = { x_mm: 8000, y_mm: 0 };
  const opening = doc.buildings[0].levels[0].openings[0];
  opening.width_mm = 2500;
  opening.offset_mm = 2000;
  assertFires(doc, 'DOOR_WIDTH_UNUSUAL');

  opening.door_type = 'garage';
  delete opening.hinge;
  delete opening.swing;
  assertQuiet(doc, 'DOOR_WIDTH_UNUSUAL');
});

test('SPACE_WITHOUT_CATEGORY', () => {
  const doc = minimalDocument();
  delete doc.buildings[0].levels[0].spaces[0].category;
  assertFires(doc, 'SPACE_WITHOUT_CATEGORY');
});

// --- the severity policy itself ------------------------------------------------------

test('every rule that can be reported has a severity for every quality level', () => {
  for (const rule of listRules()) {
    for (const quality of QUALITY_LEVELS) {
      const severity = severityFor(rule.rule, quality);
      assert.ok(['ERROR', 'WARNING', 'INFO'].includes(severity), `${rule.rule}/${quality}`);
    }
  }
});

test('an unknown rule id is a bug, not a silent pass', () => {
  assert.throws(() => severityFor('NOT_A_RULE', 'marketing'), (error) => /** @type {any} */ (error).code === 'UNKNOWN_RULE');
});

test('severity never gets weaker as the quality level rises', () => {
  const rank = { ERROR: 3, WARNING: 2, INFO: 1 };
  for (const [rule, entry] of Object.entries(SEVERITY_POLICY)) {
    assert.ok(
      rank[/** @type {'ERROR'} */ (entry.marketing)] <= rank[/** @type {'ERROR'} */ (entry.scaled)]
      && rank[/** @type {'ERROR'} */ (entry.scaled)] <= rank[/** @type {'ERROR'} */ (entry.verified)],
      `${rule}: severity must be monotonic across marketing -> scaled -> verified`,
    );
  }
});

test('the same document is judged differently at different quality levels', () => {
  const doc = loadFixture(FIXTURES.reconstruction);
  assert.equal(validateDocument(doc, { quality: 'marketing' }).ok, true);
  assert.equal(validateDocument(doc, { quality: 'scaled' }).ok, false);
  assert.equal(validateDocument(doc, { quality: 'verified' }).ok, false);
});

test('an unknown quality level is rejected', () => {
  assert.throws(
    () => validateDocument(minimalDocument(), { quality: 'perfect' }),
    (error) => /** @type {any} */ (error).code === 'UNKNOWN_QUALITY_LEVEL',
  );
});

test('issues are ordered deterministically', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const first = validateDocument(doc);
  const second = validateDocument(doc);
  assert.deepEqual(first.issues, second.issues);
});
