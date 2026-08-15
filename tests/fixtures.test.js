/**
 * Fixture integrity.
 *
 * The fixtures are test data, not normative examples — but they are the only
 * data the project has, so they have to stay honest: valid, deterministic,
 * renderable, and collectively covering the features they claim to cover.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PACKAGE_ROOT, parseDocument, getSchemaValidator } from '../src/model/io.js';
import { validateDocument } from '../src/validation/validate.js';
import { renderSvg } from '../src/render/svg/renderer.js';
import { loadTheme } from '../src/themes/load.js';
import { indexDocument, listLevels } from '../src/model/document.js';
import { stringifyStable } from '../src/util/json.js';
import { FIXTURES, loadFixture, readFixtureJson } from './helpers.js';

const FIXTURE_ROOT = resolve(PACKAGE_ROOT, 'fixtures');

/** @returns {string[]} */
function fixtureDirectories() {
  return readdirSync(FIXTURE_ROOT).filter((entry) => /^\d\d-/.test(entry)).sort();
}

test('the six required fixtures exist', () => {
  const dirs = fixtureDirectories();
  assert.deepEqual(dirs, [
    '01-simple-room',
    '02-apartment',
    '03-house-ground-floor',
    '04-garage',
    '05-renovation',
    '06-uncertain-reconstruction',
  ]);
});

test('every floorplan fixture is schema valid and semantically valid', () => {
  for (const [name, path] of Object.entries(FIXTURES)) {
    const raw = readFixtureJson(path);
    assert.deepEqual(getSchemaValidator('floorplan').validate(raw), [], `${name} violates the schema`);
    const { document } = parseDocument(raw, { label: path });
    const report = validateDocument(document);
    assert.equal(report.ok, true, `${name}: ${report.issues.filter((i) => i.severity === 'ERROR').map((i) => i.message).join(' | ')}`);
  }
});

test('every fixture file is stored in the canonical serialisation', () => {
  for (const path of Object.values(FIXTURES)) {
    const text = readFileSync(resolve(PACKAGE_ROOT, path), 'utf8');
    assert.match(text, /\n$/, `${path} must end with a newline`);
    assert.equal(text.includes('\r\n'), false, `${path} must use LF line endings`);
    assert.equal(text.includes('\t'), false, `${path} must not contain tabs`);
  }
});

test('every fixture renders in every theme', () => {
  for (const [name, path] of Object.entries(FIXTURES)) {
    const doc = loadFixture(path);
    for (const themeName of ['technical', 'marketing', 'minimal']) {
      const { svg } = renderSvg(doc, loadTheme(themeName));
      assert.match(svg, /<svg /, `${name}/${themeName}`);
      assert.match(svg, /<\/svg>\n$/, `${name}/${themeName}`);
    }
  }
});

test('fixture ids are unique and follow the convention', () => {
  for (const [name, path] of Object.entries(FIXTURES)) {
    const doc = loadFixture(path);
    const index = indexDocument(doc);
    assert.deepEqual(index.duplicateIds, [], `${name} has duplicate ids`);
    for (const id of index.allIds()) {
      assert.match(id, /^[a-z][a-z0-9_]{0,63}$/, `${name}: invalid id ${id}`);
    }
  }
});

test('the fixtures together exercise the feature matrix they claim to', () => {
  /** @type {Set<string>} */
  const seen = new Set();
  for (const path of Object.values(FIXTURES)) {
    const doc = loadFixture(path);
    for (const { level } of listLevels(doc)) {
      for (const wall of level.walls ?? []) {
        seen.add(`classification:${wall.classification ?? 'none'}`);
        seen.add(`state:${wall.state ?? doc.project.defaults?.state ?? 'existing'}`);
      }
      for (const opening of level.openings ?? []) {
        seen.add(`opening:${opening.type}`);
        if (opening.door_type) seen.add(`door_type:${opening.door_type}`);
        seen.add(`opening_state:${opening.state ?? doc.project.defaults?.state ?? 'existing'}`);
      }
      for (const space of level.spaces ?? []) seen.add(`category:${space.category}`);
      if ((level.stairs ?? []).length > 0) seen.add('stairs');
      if ((level.columns ?? []).length > 0) seen.add('columns');
      if ((level.dimensions ?? []).length > 0) seen.add('dimensions');
      if ((level.annotations ?? []).length > 0) seen.add('annotations');
    }
    seen.add(`quality:${doc.project.quality}`);
  }

  const required = [
    'opening:door', 'opening:window', 'opening:passage', 'opening:generic_opening',
    'door_type:swing', 'door_type:garage',
    'state:existing', 'state:new', 'state:demolish', 'opening_state:planned',
    'classification:exterior', 'classification:interior', 'classification:partition', 'classification:structural',
    'quality:marketing', 'quality:scaled', 'quality:verified',
    'stairs', 'columns', 'dimensions', 'annotations',
  ];
  for (const feature of required) {
    assert.ok(seen.has(feature), `no fixture covers ${feature}`);
  }
});

test('the observation fixture and its reconciled output stay in sync', async () => {
  const { reconcileObservations } = await import('../src/importers/observations/reconcile.js');
  const observations = readFixtureJson('fixtures/06-uncertain-reconstruction/expose-plan.observations.json');
  const { document } = reconcileObservations(observations, {
    defaultThicknessMm: 120,
    snapMm: 10,
    projectName: 'Fixture 06 - Uncertain reconstruction',
    projectId: 'fixture_06',
  });
  const onDisk = readFileSync(resolve(PACKAGE_ROOT, FIXTURES.reconstruction), 'utf8');
  assert.equal(
    stringifyStable(document),
    onDisk,
    'fixtures/06-uncertain-reconstruction/reconstruction.floorplan.json is stale — regenerate it with '
    + '`node bin/floorplan.js reconcile fixtures/06-uncertain-reconstruction/expose-plan.observations.json '
    + '--default-thickness-mm 120 --snap-mm 10 --project-name "Fixture 06 - Uncertain reconstruction" '
    + '--project-id fixture_06 --output fixtures/06-uncertain-reconstruction/reconstruction.floorplan.json`',
  );
});

test('every fixture states that it is synthetic test data', () => {
  for (const [name, path] of Object.entries(FIXTURES)) {
    const text = readFileSync(resolve(PACKAGE_ROOT, path), 'utf8');
    assert.match(
      text,
      /[Ss]ynthetic|Reconstructed|interpreted, not measured/,
      `${name} must say that it is not a real building`,
    );
  }
});

test('the reference operations file applies to its fixture', async () => {
  const { applyOperations } = await import('../src/operations/apply.js');
  const doc = loadFixture(FIXTURES.house);
  const ops = readFixtureJson('fixtures/03-house-ground-floor/renovation.ops.json');
  const applied = applyOperations(doc, ops);
  assert.equal(applied.report.ok, true);
  assert.equal(applied.results.length, 4);
});
