/**
 * Polygon split and merge.
 *
 * These are the two geometric operations behind split_space and merge_spaces.
 * Both are deliberately strict: they solve the cases that actually occur in
 * floorplans (a straight cut through a room, two rooms sharing a wall) and
 * refuse anything else with a clear message, instead of producing a plausible
 * looking but wrong polygon.
 */

import { distance, roundMm } from './vec.js';
import { distanceToSegment, lineIntersection } from './segment.js';
import { area as polygonArea, normalizeOrientation } from './polygon.js';
import { TOLERANCE_MM } from '../model/constants.js';

/** @typedef {import('./vec.js').Vec} Vec */

/**
 * @param {Vec} p
 * @returns {string}
 */
function key(p) {
  return `${roundMm(p.x)},${roundMm(p.y)}`;
}

/**
 * Split a simple polygon with an infinite line through two points.
 *
 * @param {Vec[]} polygon counter clockwise
 * @param {Vec} lineA
 * @param {Vec} lineB
 * @returns {{ok: true, parts: [Vec[], Vec[]], cut: [Vec, Vec]} | {ok: false, reason: string, crossings: number}}
 */
export function splitPolygonByLine(polygon, lineA, lineB) {
  const line = { a: lineA, b: lineB };
  const n = polygon.length;
  /** @type {Array<{edge: number, t: number, point: Vec}>} */
  const hits = [];

  for (let i = 0; i < n; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const point = lineIntersection({ a, b }, line);
    if (!point) continue; // edge parallel to the cut
    const edgeLength = distance(a, b);
    if (edgeLength < TOLERANCE_MM) continue;
    const t = distance(a, point) / edgeLength;
    const onEdge = distanceToSegment({ a, b }, point) <= TOLERANCE_MM;
    if (!onEdge) continue;
    // A hit exactly on the end vertex belongs to the next edge; skip it here so
    // that a cut through a vertex is counted once, not twice.
    if (t > 1 - 1e-9) continue;
    hits.push({ edge: i, t: Math.max(0, Math.min(1, t)), point });
  }

  if (hits.length !== 2) {
    return {
      ok: false,
      crossings: hits.length,
      reason: hits.length < 2
        ? 'The cutting line does not cross the boundary twice.'
        : `The cutting line crosses the boundary ${hits.length} times; only a single straight cut is supported.`,
    };
  }

  hits.sort((x, y) => x.edge - y.edge || x.t - y.t);
  const [h1, h2] = hits;
  const p1 = { x: roundMm(h1.point.x), y: roundMm(h1.point.y) };
  const p2 = { x: roundMm(h2.point.x), y: roundMm(h2.point.y) };

  /** @type {Vec[]} */
  const partA = [p1];
  for (let i = h1.edge + 1; i <= h2.edge; i += 1) partA.push(polygon[i % n]);
  partA.push(p2);

  /** @type {Vec[]} */
  const partB = [p2];
  for (let i = h2.edge + 1; i <= h1.edge + n; i += 1) partB.push(polygon[i % n]);
  partB.push(p1);

  const cleanA = dedupe(partA);
  const cleanB = dedupe(partB);
  if (cleanA.length < 3 || cleanB.length < 3) {
    return { ok: false, crossings: 2, reason: 'The cut produces a degenerate part.' };
  }
  return {
    ok: true,
    parts: [normalizeOrientation(cleanA), normalizeOrientation(cleanB)],
    cut: [p1, p2],
  };
}

/**
 * @param {Vec[]} points
 * @returns {Vec[]}
 */
function dedupe(points) {
  /** @type {Vec[]} */
  const out = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || distance(last, point) > TOLERANCE_MM / 2) out.push(point);
  }
  while (out.length > 1 && distance(out[0], out[out.length - 1]) <= TOLERANCE_MM / 2) out.pop();
  return out;
}

/**
 * Merge two polygons that share a common boundary.
 *
 * Works by cancelling directed edge pairs: with both rings oriented counter
 * clockwise, a shared boundary appears once in each direction and drops out.
 * The remaining edges must stitch into exactly one ring.
 *
 * @param {Vec[]} a counter clockwise
 * @param {Vec[]} b counter clockwise
 * @returns {{ok: true, polygon: Vec[]} | {ok: false, reason: string}}
 */
export function mergePolygons(a, b) {
  const ringA = splitAtForeignVertices(normalizeOrientation(a), b);
  const ringB = splitAtForeignVertices(normalizeOrientation(b), a);

  /** @type {Array<{from: Vec, to: Vec}>} */
  const edges = [...directedEdges(ringA), ...directedEdges(ringB)];

  /** @type {Map<string, number[]>} */
  const byPair = new Map();
  edges.forEach((edge, i) => {
    const k = `${key(edge.from)}|${key(edge.to)}`;
    const list = byPair.get(k);
    if (list) list.push(i);
    else byPair.set(k, [i]);
  });

  /** @type {Set<number>} */
  const removed = new Set();
  edges.forEach((edge, i) => {
    if (removed.has(i)) return;
    const reverseKey = `${key(edge.to)}|${key(edge.from)}`;
    const partners = (byPair.get(reverseKey) ?? []).filter((j) => !removed.has(j) && j !== i);
    if (partners.length > 0) {
      removed.add(i);
      removed.add(partners[0]);
    }
  });

  const remaining = edges.filter((_, i) => !removed.has(i));
  if (remaining.length === edges.length) {
    return { ok: false, reason: 'The two boundaries do not share a common edge.' };
  }
  if (remaining.length < 3) {
    return { ok: false, reason: 'Merging leaves no usable boundary.' };
  }

  /** @type {Map<string, Array<{to: Vec, index: number}>>} */
  const outgoing = new Map();
  remaining.forEach((edge, index) => {
    const k = key(edge.from);
    const list = outgoing.get(k);
    if (list) list.push({ to: edge.to, index });
    else outgoing.set(k, [{ to: edge.to, index }]);
  });

  const start = remaining[0].from;
  /** @type {Vec[]} */
  const ring = [start];
  /** @type {Set<number>} */
  const used = new Set();
  let cursor = start;
  for (let guard = 0; guard < remaining.length + 1; guard += 1) {
    const candidates = (outgoing.get(key(cursor)) ?? []).filter((c) => !used.has(c.index));
    if (candidates.length === 0) break;
    const next = candidates[0];
    used.add(next.index);
    cursor = next.to;
    if (key(cursor) === key(start)) break;
    ring.push(cursor);
  }

  if (used.size !== remaining.length) {
    return {
      ok: false,
      reason: `The merged boundary is not a single ring (${remaining.length - used.size} edge(s) left over). The spaces probably touch in more than one place or overlap.`,
    };
  }

  const cleaned = dedupe(ring);
  if (cleaned.length < 3 || polygonArea(cleaned) < 1000) {
    return { ok: false, reason: 'The merged boundary encloses no usable area.' };
  }
  return { ok: true, polygon: normalizeOrientation(cleaned) };
}

/**
 * @param {Vec[]} ring
 * @returns {Array<{from: Vec, to: Vec}>}
 */
function directedEdges(ring) {
  return ring.map((point, i) => ({ from: point, to: ring[(i + 1) % ring.length] }));
}

/**
 * Insert the vertices of `other` that lie on an edge of `ring`, so that a shared
 * boundary is represented by identical edge pairs on both sides.
 * @param {Vec[]} ring
 * @param {Vec[]} other
 * @returns {Vec[]}
 */
function splitAtForeignVertices(ring, other) {
  /** @type {Vec[]} */
  const out = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push(a);
    const edgeLength = distance(a, b);
    if (edgeLength < TOLERANCE_MM) continue;
    const inserts = other
      .filter((v) => distanceToSegment({ a, b }, v) <= TOLERANCE_MM
        && distance(v, a) > TOLERANCE_MM && distance(v, b) > TOLERANCE_MM)
      .map((v) => ({ v, t: distance(a, v) / edgeLength }))
      .sort((x, y) => x.t - y.t);
    for (const insert of inserts) {
      const last = out[out.length - 1];
      if (distance(last, insert.v) > TOLERANCE_MM) out.push({ x: roundMm(insert.v.x), y: roundMm(insert.v.y) });
    }
  }
  return out;
}
