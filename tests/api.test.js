/**
 * The public JavaScript API surface.
 *
 * The CLI is the primary interface, but package.json points `main` at src/index.js,
 * so that surface is a promise too and must keep working.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as api from '../src/index.js';
import { PACKAGE_ROOT } from '../src/model/io.js';
import { FIXTURES } from './helpers.js';

test('package.json main and exports point at files that exist', () => {
  const manifest = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'));
  assert.doesNotThrow(() => readFileSync(resolve(PACKAGE_ROOT, manifest.main), 'utf8'));
  assert.doesNotThrow(() => readFileSync(resolve(PACKAGE_ROOT, manifest.bin.floorplan), 'utf8'));
  assert.deepEqual(manifest.dependencies, {}, 'the core must stay dependency free (ADR 0001)');
  assert.deepEqual(manifest.devDependencies, {}, 'tests run on node --test alone');
});

test('the documented entry points are exported', () => {
  for (const name of [
    'loadDocument', 'parseDocument', 'saveDocument',
    'validateDocument', 'assertValid',
    'applyOperations', 'undoOperations', 'listOperations', 'getOperation',
    'renderSvg', 'loadTheme', 'listThemes',
    'buildConnectivityGraph', 'reachableFrom', 'findPath',
    'reconcileObservations',
    'indexDocument', 'resolveLevel', 'resolveProvenance', 'spaceAreaMm2',
    'stringifyStable', 'FloorplanError', 'runCli',
    'SCHEMA_VERSION', 'QUALITY_LEVELS', 'SEVERITY_POLICY',
  ]) {
    assert.ok(name in api, `the public API must export ${name}`);
  }
  assert.equal(api.SCHEMA_VERSION, '0.1');
  assert.equal(api.UNIT, 'mm');
});

test('the README example works end to end through the API', () => {
  const { document } = api.loadDocument(resolve(PACKAGE_ROOT, FIXTURES.apartment));
  const report = api.validateDocument(document);
  assert.equal(report.ok, true);

  const applied = api.applyOperations(document, [
    { op: 'move_opening', target_id: 'door_bath', offset_delta_mm: 400 },
  ]);
  assert.equal(applied.report.ok, true);

  const { svg, meta } = api.renderSvg(applied.document, api.loadTheme('marketing'));
  assert.match(svg, /^<\?xml/);
  assert.equal(meta.theme, 'marketing');

  const graph = api.buildConnectivityGraph(applied.document, api.resolveLevel(applied.document));
  assert.ok(graph.edges.length > 0);
});

test('geometry helpers are reachable as namespaces', () => {
  assert.equal(typeof api.vec.roundMm, 'function');
  assert.equal(typeof api.polygon.area, 'function');
  assert.equal(typeof api.segment.projectPoint, 'function');
  assert.equal(api.vec.roundMm(-1.5), -2);
});
