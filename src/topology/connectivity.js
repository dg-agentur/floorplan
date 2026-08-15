/**
 * Topology: which room is behind which opening, and what is reachable from where.
 *
 * Coordinates alone are not enough — the product needs to answer questions like
 * "which rooms can be reached from the hallway" and "which door connects kitchen
 * and living room". Those answers are DERIVED from geometry here, never trusted
 * from the `connects_space_ids` field; the validator compares the two
 * (docs/adr/0005-opening-hosting.md).
 */

import { add, scale, fromModel, leftNormal } from '../geometry/vec.js';
import { containsPoint } from '../geometry/polygon.js';
import { pointOnWall, wallDirection, wallLength, openingSpan } from '../geometry/wallGeometry.js';
import { resolveState } from '../model/document.js';
import { spaceAreaMm2, toSquareMetres } from '../model/measure.js';

/** @typedef {import('../model/types.js').FloorplanDocument} FloorplanDocument */
/** @typedef {import('../model/types.js').Level} Level */
/** @typedef {import('../model/types.js').Opening} Opening */
/** @typedef {import('../model/types.js').Space} Space */
/** @typedef {import('../geometry/vec.js').Vec} Vec */

/** Node id used for everything that is not inside a space. */
export const OUTSIDE = 'outside';

/** Distances (mm) past the wall face at which we look for a room. */
const PROBE_DISTANCES = [60, 200, 500, 1200];

/**
 * Which space contains a probe point.
 * @param {Space[]} spaces
 * @param {Vec} point
 * @returns {string|null}
 */
function spaceAt(spaces, point) {
  for (const space of spaces) {
    if (containsPoint((space.boundary ?? []).map(fromModel), point)) return space.id;
  }
  return null;
}

/**
 * Probe outwards from the middle of an opening on both wall faces.
 *
 * @param {Level} level
 * @param {Opening} opening
 * @param {Map<string, import('../model/types.js').Wall>} wallsById
 * @returns {{left: string|null, right: string|null, probe_left: Vec, probe_right: Vec}|null}
 */
export function probeOpening(level, opening, wallsById) {
  const wall = wallsById.get(opening.host_wall_id);
  if (!wall) return null;
  const spaces = level.spaces ?? [];
  const len = wallLength(wall);
  if (len <= 0) return null;

  const span = openingSpan(opening);
  const centreAlong = Math.max(0, Math.min(len, (span.from + span.to) / 2));
  const axisPoint = pointOnWall(wall, centreAlong, 0);
  const normal = leftNormal(wallDirection(wall));
  const half = wall.thickness_mm / 2;

  /** @param {number} sign */
  const probe = (sign) => {
    for (const extra of PROBE_DISTANCES) {
      const point = add(axisPoint, scale(normal, sign * (half + extra)));
      const hit = spaceAt(spaces, point);
      if (hit) return { id: hit, point };
    }
    return { id: null, point: add(axisPoint, scale(normal, sign * (half + PROBE_DISTANCES[0]))) };
  };

  const left = probe(1);
  const right = probe(-1);
  return { left: left.id, right: right.id, probe_left: left.point, probe_right: right.point };
}

/**
 * @typedef {object} OpeningConnection
 * @property {string} opening_id
 * @property {string} type
 * @property {string} host_wall_id
 * @property {string|null} left_space_id   space on the +90 degrees side of the wall
 * @property {string|null} right_space_id  space on the -90 degrees side
 * @property {string[]} derived_space_ids  the non null sides, sorted
 * @property {string|null} swings_into_space_id  for doors: where the leaf opens
 * @property {boolean} leads_outside
 * @property {string} state
 */

/**
 * @param {FloorplanDocument} doc
 * @param {Level} level
 * @returns {OpeningConnection[]}
 */
export function deriveOpeningConnections(doc, level) {
  /** @type {Map<string, import('../model/types.js').Wall>} */
  const wallsById = new Map((level.walls ?? []).map((w) => [w.id, w]));
  /** @type {OpeningConnection[]} */
  const out = [];

  for (const opening of level.openings ?? []) {
    const probe = probeOpening(level, opening, wallsById);
    const left = probe?.left ?? null;
    const right = probe?.right ?? null;
    const derived = [left, right].filter((v) => v !== null).sort();
    /** @type {string|null} */
    let swingsInto = null;
    if (opening.type === 'door' && opening.swing && opening.swing !== 'none') {
      swingsInto = opening.swing === 'left' ? left : right;
    }
    out.push({
      opening_id: opening.id,
      type: opening.type,
      host_wall_id: opening.host_wall_id,
      left_space_id: left,
      right_space_id: right,
      derived_space_ids: /** @type {string[]} */ (derived),
      swings_into_space_id: swingsInto,
      leads_outside: left === null || right === null,
      state: resolveState(doc, opening),
    });
  }
  return out;
}

/**
 * @typedef {object} GraphNode
 * @property {string} id
 * @property {string} name
 * @property {string} [category]
 * @property {number} floor_area_m2
 * @property {string} state
 */

/**
 * @typedef {object} GraphEdge
 * @property {string} id           the opening id
 * @property {string} type         door | window | passage | generic_opening
 * @property {string} from
 * @property {string} to
 * @property {number} width_mm
 * @property {boolean} passable    windows are connections, but not walkable ones
 * @property {string} state
 */

/**
 * @typedef {object} ConnectivityGraph
 * @property {GraphNode[]} nodes
 * @property {GraphEdge[]} edges
 * @property {OpeningConnection[]} connections
 * @property {string} level_id
 */

/**
 * Build the space connectivity graph of a level.
 *
 * Openings whose state is `demolish` are excluded: a demolished door does not
 * connect anything in the planned state. Everything else counts.
 *
 * @param {FloorplanDocument} doc
 * @param {Level} level
 * @param {{includeWindows?: boolean, includeDemolished?: boolean}} [options]
 * @returns {ConnectivityGraph}
 */
export function buildConnectivityGraph(doc, level, options = {}) {
  const includeWindows = options.includeWindows ?? true;
  const includeDemolished = options.includeDemolished ?? false;
  const connections = deriveOpeningConnections(doc, level);

  /** @type {GraphNode[]} */
  const nodes = (level.spaces ?? []).map((space) => ({
    id: space.id,
    name: space.name,
    category: space.category,
    floor_area_m2: toSquareMetres(spaceAreaMm2(space)),
    state: resolveState(doc, space),
  }));

  /** @type {GraphEdge[]} */
  const edges = [];
  let usesOutside = false;
  for (const connection of connections) {
    if (!includeDemolished && connection.state === 'demolish') continue;
    if (!includeWindows && connection.type === 'window') continue;
    const from = connection.left_space_id ?? OUTSIDE;
    const to = connection.right_space_id ?? OUTSIDE;
    if (from === OUTSIDE && to === OUTSIDE) continue; // opening in a wall with no room on either side
    if (from === to) continue; // both faces in the same room: not a connection
    if (from === OUTSIDE || to === OUTSIDE) usesOutside = true;
    const opening = (level.openings ?? []).find((o) => o.id === connection.opening_id);
    edges.push({
      id: connection.opening_id,
      type: connection.type,
      from,
      to,
      width_mm: opening?.width_mm ?? 0,
      passable: connection.type !== 'window',
      state: connection.state,
    });
  }

  if (usesOutside) {
    nodes.push({ id: OUTSIDE, name: 'Outside', floor_area_m2: 0, state: 'existing' });
  }

  return { nodes, edges, connections, level_id: level.id };
}

/**
 * Adjacency map. Only walkable edges are used unless stated otherwise.
 * @param {ConnectivityGraph} graph
 * @param {{passableOnly?: boolean}} [options]
 * @returns {Map<string, Array<{node: string, via: string}>>}
 */
export function adjacency(graph, options = {}) {
  const passableOnly = options.passableOnly ?? true;
  /** @type {Map<string, Array<{node: string, via: string}>>} */
  const map = new Map();
  for (const node of graph.nodes) map.set(node.id, []);
  for (const edge of graph.edges) {
    if (passableOnly && !edge.passable) continue;
    if (!map.has(edge.from)) map.set(edge.from, []);
    if (!map.has(edge.to)) map.set(edge.to, []);
    /** @type {Array<{node: string, via: string}>} */ (map.get(edge.from)).push({ node: edge.to, via: edge.id });
    /** @type {Array<{node: string, via: string}>} */ (map.get(edge.to)).push({ node: edge.from, via: edge.id });
  }
  // Deterministic neighbour order.
  for (const list of map.values()) {
    list.sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.via < b.via ? -1 : 1));
  }
  return map;
}

/**
 * Breadth first reachability.
 * @param {ConnectivityGraph} graph
 * @param {string} start
 * @param {{passableOnly?: boolean}} [options]
 * @returns {string[]} reachable node ids excluding the start, sorted
 */
export function reachableFrom(graph, start, options = {}) {
  const map = adjacency(graph, options);
  if (!map.has(start)) return [];
  /** @type {Set<string>} */
  const seen = new Set([start]);
  /** @type {string[]} */
  const queue = [start];
  while (queue.length > 0) {
    const current = /** @type {string} */ (queue.shift());
    for (const neighbour of map.get(current) ?? []) {
      if (!seen.has(neighbour.node)) {
        seen.add(neighbour.node);
        queue.push(neighbour.node);
      }
    }
  }
  seen.delete(start);
  return [...seen].sort();
}

/**
 * Shortest path between two spaces, as the list of openings used.
 * @param {ConnectivityGraph} graph
 * @param {string} from
 * @param {string} to
 * @param {{passableOnly?: boolean}} [options]
 * @returns {{nodes: string[], openings: string[]}|null}
 */
export function findPath(graph, from, to, options = {}) {
  const map = adjacency(graph, options);
  if (!map.has(from) || !map.has(to)) return null;
  /** @type {Map<string, {prev: string, via: string}>} */
  const cameFrom = new Map();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = /** @type {string} */ (queue.shift());
    if (current === to) break;
    for (const neighbour of map.get(current) ?? []) {
      if (seen.has(neighbour.node)) continue;
      seen.add(neighbour.node);
      cameFrom.set(neighbour.node, { prev: current, via: neighbour.via });
      queue.push(neighbour.node);
    }
  }
  if (from !== to && !cameFrom.has(to)) return null;
  /** @type {string[]} */
  const nodes = [to];
  /** @type {string[]} */
  const openings = [];
  let cursor = to;
  while (cursor !== from) {
    const step = cameFrom.get(cursor);
    if (!step) return null;
    openings.unshift(step.via);
    nodes.unshift(step.prev);
    cursor = step.prev;
  }
  return { nodes, openings };
}

/**
 * Connected components of the space graph. More than one component means parts
 * of the plan cannot be reached from each other.
 * @param {ConnectivityGraph} graph
 * @param {{passableOnly?: boolean}} [options]
 * @returns {string[][]} each component sorted, components sorted by first member
 */
export function components(graph, options = {}) {
  const map = adjacency(graph, options);
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[][]} */
  const result = [];
  for (const node of graph.nodes) {
    if (seen.has(node.id)) continue;
    /** @type {string[]} */
    const component = [];
    const queue = [node.id];
    seen.add(node.id);
    while (queue.length > 0) {
      const current = /** @type {string} */ (queue.shift());
      component.push(current);
      for (const neighbour of map.get(current) ?? []) {
        if (!seen.has(neighbour.node)) {
          seen.add(neighbour.node);
          queue.push(neighbour.node);
        }
      }
    }
    result.push(component.sort());
  }
  return result.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * Spaces without any walkable connection at all.
 * @param {ConnectivityGraph} graph
 * @returns {string[]}
 */
export function isolatedSpaces(graph) {
  const map = adjacency(graph, { passableOnly: true });
  return graph.nodes
    .filter((n) => n.id !== OUTSIDE && (map.get(n.id) ?? []).length === 0)
    .map((n) => n.id)
    .sort();
}
