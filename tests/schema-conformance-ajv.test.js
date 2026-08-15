/**
 * Optional conformance check against Ajv.
 *
 * Ajv is NOT a dependency of this project (docs/adr/0001-language-and-runtime.md).
 * When it happens to be installed — for instance in CI, via
 * `npm install --no-save ajv` — this suite compares our validator against the
 * reference implementation on every schema and every fixture.
 *
 * If Ajv is absent the tests are SKIPPED, never silently passed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PACKAGE_ROOT, SCHEMA_NAMES, loadSchema, getSchemaValidator } from '../src/model/io.js';
import { minimalDocument } from './helpers.js';

/** @returns {Promise<any|null>} */
async function tryLoadAjv() {
  try {
    const module = await import('ajv/dist/2020.js');
    return module.default ?? module;
  } catch {
    try {
      const module = await import('ajv');
      return module.default ?? module;
    } catch {
      return null;
    }
  }
}

const Ajv = await tryLoadAjv();
const SKIP = Ajv ? false : 'ajv is not installed — run `npm install --no-save ajv` to enable the conformance check';

/**
 * @param {object} schema
 * @returns {(data: unknown) => boolean}
 */
function ajvValidator(schema) {
  const ajv = new Ajv({ strict: false, allErrors: true });
  return ajv.compile(schema);
}

test('our validator agrees with Ajv on every schema and every fixture', { skip: SKIP }, () => {
  const fixtureFiles = [];
  const fixtureRoot = resolve(PACKAGE_ROOT, 'fixtures');
  for (const dir of readdirSync(fixtureRoot)) {
    for (const file of readdirSync(resolve(fixtureRoot, dir))) {
      if (file.endsWith('.json')) fixtureFiles.push(resolve(fixtureRoot, dir, file));
    }
  }
  assert.ok(fixtureFiles.length >= 7);

  for (const path of fixtureFiles) {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const schemaName = path.endsWith('.observations.json') ? 'observations'
      : path.endsWith('.ops.json') ? 'operations' : 'floorplan';
    const mine = getSchemaValidator(schemaName).isValid(data);
    const theirs = ajvValidator(loadSchema(schemaName))(data);
    assert.equal(mine, theirs, `${path} (${schemaName}): ours=${mine} ajv=${theirs}`);
  }
});

test('our validator agrees with Ajv on deliberately broken documents', { skip: SKIP }, () => {
  /** @type {Array<[string, (doc: any) => void]>} */
  const mutations = [
    ['missing required field', (doc) => { delete doc.project.quality; }],
    ['wrong type', (doc) => { doc.buildings[0].levels[0].walls[0].thickness_mm = '200'; }],
    ['out of range', (doc) => { doc.buildings[0].levels[0].walls[0].thickness_mm = 0; }],
    ['unknown property', (doc) => { doc.buildings[0].levels[0].walls[0].colour = 'red'; }],
    ['bad enum', (doc) => { doc.project.quality = 'perfect'; }],
    ['bad pattern', (doc) => { doc.buildings[0].levels[0].walls[0].id = 'Wall-1'; }],
    ['too few polygon points', (doc) => { doc.buildings[0].levels[0].spaces[0].boundary.length = 2; }],
    ['non integer coordinate', (doc) => { doc.buildings[0].levels[0].walls[0].start.x_mm = 1.5; }],
    ['door without door_type', (doc) => {
      doc.buildings[0].levels[0].openings = [{
        id: 'door_001', type: 'door', host_wall_id: 'wall_001', offset_mm: 1000, width_mm: 900,
      }];
    }],
    ['window with a door attribute', (doc) => {
      doc.buildings[0].levels[0].openings = [{
        id: 'window_001', type: 'window', host_wall_id: 'wall_001', offset_mm: 1000,
        width_mm: 900, sill_mm: 900, hinge: 'left',
      }];
    }],
    ['valid door for contrast', (doc) => {
      doc.buildings[0].levels[0].openings = [{
        id: 'door_001', type: 'door', host_wall_id: 'wall_001', offset_mm: 1000,
        width_mm: 900, door_type: 'swing', hinge: 'left', swing: 'left',
      }];
    }],
  ];

  const schema = loadSchema('floorplan');
  const validate = ajvValidator(schema);
  for (const [label, mutate] of mutations) {
    const doc = minimalDocument();
    mutate(doc);
    const mine = getSchemaValidator('floorplan').isValid(doc);
    const theirs = validate(doc);
    assert.equal(mine, theirs, `${label}: ours=${mine} ajv=${theirs}`);
  }
});

test('every schema file compiles under Ajv as well', { skip: SKIP }, () => {
  for (const name of SCHEMA_NAMES) {
    assert.doesNotThrow(() => ajvValidator(loadSchema(name)), `ajv could not compile ${name}`);
  }
});
