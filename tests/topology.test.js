import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OUTSIDE, adjacency, buildConnectivityGraph, components, deriveOpeningConnections,
  findPath, isolatedSpaces, reachableFrom,
} from '../src/topology/connectivity.js';
import { resolveLevel } from '../src/model/document.js';
import { FIXTURES, loadFixture } from './helpers.js';

/**
 * @param {string} fixture
 * @returns {{doc: any, level: any, graph: any}}
 */
function graphOf(fixture) {
  const doc = loadFixture(fixture);
  const level = resolveLevel(doc);
  return { doc, level, graph: buildConnectivityGraph(doc, level) };
}

test('opening connections are derived from geometry, not from the declaration', () => {
  const { doc, level } = graphOf(FIXTURES.apartment);
  // Wipe every declaration: the derivation must still be complete.
  for (const opening of level.openings) delete opening.connects_space_ids;
  const connections = deriveOpeningConnections(doc, level);
  const byId = new Map(connections.map((c) => [c.opening_id, c]));

  assert.deepEqual(byId.get('door_kitchen')?.derived_space_ids, ['space_hall', 'space_kitchen']);
  assert.deepEqual(byId.get('passage_living')?.derived_space_ids, ['space_hall', 'space_living']);
  assert.deepEqual(byId.get('door_entrance')?.derived_space_ids, ['space_hall']);
  assert.equal(byId.get('door_entrance')?.leads_outside, true);
});

test('the derived connections agree with what the fixtures declare', () => {
  for (const fixture of [FIXTURES.apartment, FIXTURES.house, FIXTURES.garage, FIXTURES.renovation]) {
    const { doc, level } = graphOf(fixture);
    for (const connection of deriveOpeningConnections(doc, level)) {
      const opening = level.openings.find((/** @type {any} */ o) => o.id === connection.opening_id);
      if (!opening?.connects_space_ids) continue;
      assert.deepEqual(
        [...opening.connects_space_ids].sort(),
        connection.derived_space_ids,
        `${fixture}: ${connection.opening_id}`,
      );
    }
  }
});

test('a door reports which room its leaf swings into', () => {
  const { doc, level } = graphOf(FIXTURES.apartment);
  const byId = new Map(deriveOpeningConnections(doc, level).map((c) => [c.opening_id, c]));
  assert.equal(byId.get('door_kitchen')?.swings_into_space_id, 'space_kitchen');
  assert.equal(byId.get('door_bath')?.swings_into_space_id, 'space_bath');
  assert.equal(byId.get('passage_living')?.swings_into_space_id, null, 'a passage has no leaf');
});

test('the graph contains one node per room plus outside when needed', () => {
  const { graph } = graphOf(FIXTURES.apartment);
  assert.equal(graph.nodes.length, 6);
  assert.ok(graph.nodes.some((/** @type {any} */ n) => n.id === OUTSIDE));
  assert.equal(graph.nodes.find((/** @type {any} */ n) => n.id === 'space_hall')?.floor_area_m2 > 0, true);
});

test('windows are edges but are not walkable', () => {
  const { graph } = graphOf(FIXTURES.apartment);
  const window = graph.edges.find((/** @type {any} */ e) => e.id === 'window_living');
  assert.equal(window?.passable, false);
  const walkable = adjacency(graph, { passableOnly: true });
  assert.equal(
    (walkable.get('space_living') ?? []).some((/** @type {any} */ n) => n.via === 'window_living'),
    false,
  );
  const all = adjacency(graph, { passableOnly: false });
  assert.equal((all.get('space_living') ?? []).some((/** @type {any} */ n) => n.via === 'window_living'), true);
});

test('every room in the apartment is reachable from outside', () => {
  const { graph } = graphOf(FIXTURES.apartment);
  assert.deepEqual(
    reachableFrom(graph, OUTSIDE),
    ['space_bath', 'space_bedroom', 'space_hall', 'space_kitchen', 'space_living'],
  );
});

test('findPath returns the rooms and the openings used', () => {
  const { graph } = graphOf(FIXTURES.apartment);
  const path = findPath(graph, 'space_kitchen', 'space_bath');
  assert.deepEqual(path?.nodes, ['space_kitchen', 'space_hall', 'space_bath']);
  assert.deepEqual(path?.openings, ['door_kitchen', 'door_bath']);
});

test('findPath returns null when there is no connection', () => {
  const { doc, level } = graphOf(FIXTURES.apartment);
  level.openings = level.openings.filter((/** @type {any} */ o) => o.id !== 'door_bath');
  const graph = buildConnectivityGraph(doc, level);
  assert.equal(findPath(graph, 'space_kitchen', 'space_bath'), null);
});

test('demolished openings do not connect anything', () => {
  const { doc, level } = graphOf(FIXTURES.renovation);
  const graph = buildConnectivityGraph(doc, level);
  assert.equal(graph.edges.some((/** @type {any} */ e) => e.id === 'door_old'), false);
  const withDemolished = buildConnectivityGraph(doc, level, { includeDemolished: true });
  void withDemolished;
  assert.ok(graph.edges.some((/** @type {any} */ e) => e.id === 'door_planned'), 'a planned door does connect');
});

test('components detects a plan that falls apart', () => {
  const { doc, level } = graphOf(FIXTURES.apartment);
  assert.equal(components(buildConnectivityGraph(doc, level)).length, 1);
  level.openings = level.openings.filter((/** @type {any} */ o) => !['door_bath', 'window_bath'].includes(o.id));
  const groups = components(buildConnectivityGraph(doc, level));
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.find((g) => g.includes('space_bath')), ['space_bath']);
});

test('isolatedSpaces finds rooms without any opening', () => {
  const { doc, level } = graphOf(FIXTURES.apartment);
  level.openings = level.openings.filter((/** @type {any} */ o) => !o.id.includes('bath'));
  assert.deepEqual(isolatedSpaces(buildConnectivityGraph(doc, level)), ['space_bath']);
});

test('an opening whose two faces are in the same room is not a connection', () => {
  const { doc, level } = graphOf(FIXTURES.renovation);
  const graph = buildConnectivityGraph(doc, level);
  // door_old sits in the wall that runs through the planned living space.
  assert.equal(graph.edges.some((/** @type {any} */ e) => e.id === 'door_old'), false);
});

test('graph output is deterministic', () => {
  const { doc, level } = graphOf(FIXTURES.house);
  assert.deepEqual(buildConnectivityGraph(doc, level), buildConnectivityGraph(doc, level));
  assert.deepEqual(reachableFrom(buildConnectivityGraph(doc, level), OUTSIDE), reachableFrom(buildConnectivityGraph(doc, level), OUTSIDE));
});

test('the L shaped hall connects to every adjacent room of the house fixture', () => {
  const { graph } = graphOf(FIXTURES.house);
  const neighbours = (adjacency(graph).get('space_hall') ?? []).map((/** @type {any} */ n) => n.node).sort();
  assert.deepEqual(neighbours, ['outside', 'space_bath', 'space_bedroom', 'space_kitchen', 'space_living']);
});
