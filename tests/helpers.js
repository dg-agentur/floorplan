/**
 * Shared test helpers.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PACKAGE_ROOT } from '../src/model/io.js';
import { parseDocument } from '../src/model/io.js';
import { deepClone } from '../src/util/json.js';

export const FIXTURES = {
  simpleRoom: 'fixtures/01-simple-room/simple-room.floorplan.json',
  apartment: 'fixtures/02-apartment/apartment.floorplan.json',
  house: 'fixtures/03-house-ground-floor/house-ground-floor.floorplan.json',
  garage: 'fixtures/04-garage/double-garage.floorplan.json',
  renovation: 'fixtures/05-renovation/renovation.floorplan.json',
  reconstruction: 'fixtures/06-uncertain-reconstruction/reconstruction.floorplan.json',
};

export const OBSERVATION_FIXTURES = {
  expose: 'fixtures/06-uncertain-reconstruction/expose-plan.observations.json',
};

/**
 * @param {string} relativePath
 * @returns {string}
 */
export function fixturePath(relativePath) {
  return resolve(PACKAGE_ROOT, relativePath);
}

/**
 * @param {string} relativePath
 * @returns {any}
 */
export function readFixtureJson(relativePath) {
  return JSON.parse(readFileSync(fixturePath(relativePath), 'utf8'));
}

/**
 * Load a fixture as a validated document. Returns a fresh copy every time, so a
 * test can mutate it without affecting other tests.
 * @param {string} relativePath
 * @returns {import('../src/model/types.js').FloorplanDocument}
 */
export function loadFixture(relativePath) {
  const { document } = parseDocument(readFixtureJson(relativePath), { label: relativePath });
  return deepClone(document);
}

/**
 * A minimal but valid document, built in code so that structural tests do not
 * depend on any fixture file.
 * @param {{quality?: string}} [options]
 * @returns {any}
 */
export function minimalDocument(options = {}) {
  return {
    schema_version: '0.1',
    unit: 'mm',
    project: {
      id: 'project_test',
      name: 'Test',
      quality: options.quality ?? 'marketing',
      defaults: { state: 'existing', provenance: 'provided' },
    },
    buildings: [{
      id: 'building_main',
      name: 'Test building',
      levels: [{
        id: 'level_eg',
        name: 'Ground floor',
        index: 0,
        elevation_mm: 0,
        height_mm: 2500,
        walls: [
          { id: 'wall_001', type: 'wall', start: { x_mm: 0, y_mm: 0 }, end: { x_mm: 4000, y_mm: 0 }, thickness_mm: 200, classification: 'exterior' },
          { id: 'wall_002', type: 'wall', start: { x_mm: 4000, y_mm: 0 }, end: { x_mm: 4000, y_mm: 3000 }, thickness_mm: 200, classification: 'exterior' },
          { id: 'wall_003', type: 'wall', start: { x_mm: 4000, y_mm: 3000 }, end: { x_mm: 0, y_mm: 3000 }, thickness_mm: 200, classification: 'exterior' },
          { id: 'wall_004', type: 'wall', start: { x_mm: 0, y_mm: 3000 }, end: { x_mm: 0, y_mm: 0 }, thickness_mm: 200, classification: 'exterior' },
        ],
        spaces: [{
          id: 'space_001',
          type: 'space',
          name: 'Room',
          category: 'other',
          boundary: [
            { x_mm: 100, y_mm: 100 },
            { x_mm: 3900, y_mm: 100 },
            { x_mm: 3900, y_mm: 2900 },
            { x_mm: 100, y_mm: 2900 },
          ],
          provenance: 'derived',
          verified: true,
        }],
      }],
    }],
    revision: 0,
  };
}

/**
 * @param {import('../src/validation/validate.js').ValidationReport} report
 * @param {string} rule
 * @returns {import('../src/validation/validate.js').ValidationIssue[]}
 */
export function issuesFor(report, rule) {
  return report.issues.filter((issue) => issue.rule === rule);
}
