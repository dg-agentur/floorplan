/**
 * Wall body construction: centerline + thickness -> drawable, topologically
 * correct solids (docs/adr/0004-wall-model.md).
 *
 * Two things happen here:
 *
 *  1. **Junction resolution.** Wall ends that meet are mitred (L joint), butt
 *     extended (X joint, three or more walls) or extended to the far face of the
 *     wall they run into (T joint). Junctions are resolved once per junction and
 *     shared by all participating walls, so both sides agree bit for bit.
 *
 *  2. **Opening segmentation.** A wall with openings becomes several solid
 *     pieces. Openings are real gaps in the geometry, not white rectangles drawn
 *     on top — which is what makes exports and later boolean operations correct.
 */

import { add, cross, dot, fromModel, leftNormal, normalize, scale, sub, distance } from './vec.js';
import { lineIntersection, projectPoint } from './segment.js';
import { TOLERANCE_MM } from '../model/constants.js';

/** @typedef {import('./vec.js').Vec} Vec */
/** @typedef {import('../model/types.js').Wall} Wall */
/** @typedef {import('../model/types.js').Opening} Opening */

/**
 * @typedef {object} WallCorners
 * @property {Vec} startLeft
 * @property {Vec} startRight
 * @property {Vec} endLeft
 * @property {Vec} endRight
 */

/**
 * @typedef {object} OpeningGeometry
 * @property {Opening} opening
 * @property {number} from   distance along the wall axis
 * @property {number} to
 * @property {Vec} center    world position of the opening centre on the axis
 * @property {Vec[]} quad    the opening footprint inside the wall, counter clockwise
 * @property {[Vec, Vec]} startReveal  the jamb face at `from`, from right to left side
 * @property {[Vec, Vec]} endReveal    the jamb face at `to`, from right to left side
 * @property {boolean} clipped whether the opening had to be clamped to the wall
 */

/**
 * @typedef {object} WallGeometry
 * @property {Wall} wall
 * @property {{a: Vec, b: Vec}} axis
 * @property {number} length
 * @property {Vec} direction  unit vector start -> end
 * @property {Vec} normal     unit left normal (+90 degrees from direction)
 * @property {number} thickness
 * @property {WallCorners} corners
 * @property {Array<{from: number, to: number, polygon: Vec[]}>} solids
 * @property {OpeningGeometry[]} openings
 * @property {Vec[]} body  full wall outline ignoring openings, counter clockwise
 */

/**
 * @param {Wall} wall
 * @returns {{a: Vec, b: Vec}}
 */
export function wallAxis(wall) {
  return { a: fromModel(wall.start), b: fromModel(wall.end) };
}

/**
 * @param {Wall} wall
 * @returns {number}
 */
export function wallLength(wall) {
  return distance(fromModel(wall.start), fromModel(wall.end));
}

/**
 * @param {Wall} wall
 * @returns {Vec} unit vector from start to end
 */
export function wallDirection(wall) {
  return normalize(sub(fromModel(wall.end), fromModel(wall.start)));
}

/**
 * Unit normal pointing to the left of start -> end. This is the reference for
 * door hinge and swing sides (ADR 0005).
 * @param {Wall} wall
 * @returns {Vec}
 */
export function wallNormal(wall) {
  return leftNormal(wallDirection(wall));
}

/**
 * Point at `dist` along the wall axis, offset sideways by `offset`
 * (positive = left of start -> end).
 * @param {Wall} wall
 * @param {number} dist
 * @param {number} [offset]
 * @returns {Vec}
 */
export function pointOnWall(wall, dist, offset = 0) {
  const d = wallDirection(wall);
  const n = leftNormal(d);
  return add(add(fromModel(wall.start), scale(d, dist)), scale(n, offset));
}

/**
 * Distance along the wall axis of the projection of a world point.
 * @param {Wall} wall
 * @param {Vec} point
 * @returns {{along: number, offset: number}}
 */
export function projectOntoWall(wall, point) {
  const axis = wallAxis(wall);
  const { t } = projectPoint(axis, point);
  const len = wallLength(wall);
  const n = leftNormal(wallDirection(wall));
  return { along: t * len, offset: dot(sub(point, axis.a), n) };
}

/**
 * The span of an opening along its host wall, as [from, to] distances.
 * offset_mm addresses the CENTRE of the opening (ADR 0005).
 * @param {Opening} opening
 * @returns {{from: number, to: number}}
 */
export function openingSpan(opening) {
  const half = opening.width_mm / 2;
  return { from: opening.offset_mm - half, to: opening.offset_mm + half };
}

/**
 * Junction analysis for a set of walls.
 *
 * @param {Wall[]} walls
 * @returns {Map<string, WallCorners>}
 */
export function computeJunctions(walls) {
  /** @type {Map<string, WallCorners>} */
  const corners = new Map();

  // Default corners: square ends on the axis endpoints.
  for (const wall of walls) {
    const half = wall.thickness_mm / 2;
    corners.set(wall.id, {
      startLeft: pointOnWall(wall, 0, half),
      startRight: pointOnWall(wall, 0, -half),
      endLeft: pointOnWall(wall, wallLength(wall), half),
      endRight: pointOnWall(wall, wallLength(wall), -half),
    });
  }

  /** @typedef {{wall: Wall, end: 'start'|'end', point: Vec}} EndRef */
  /** @type {EndRef[]} */
  const ends = [];
  for (const wall of walls) {
    if (wallLength(wall) < TOLERANCE_MM) continue; // degenerate walls are reported by the validator
    ends.push({ wall, end: 'start', point: fromModel(wall.start) });
    ends.push({ wall, end: 'end', point: fromModel(wall.end) });
  }

  // Cluster coincident wall ends. Deterministic: ends are visited in document order.
  /** @type {EndRef[][]} */
  const clusters = [];
  /** @type {boolean[]} */
  const used = new Array(ends.length).fill(false);
  for (let i = 0; i < ends.length; i += 1) {
    if (used[i]) continue;
    /** @type {EndRef[]} */
    const cluster = [ends[i]];
    used[i] = true;
    for (let j = i + 1; j < ends.length; j += 1) {
      if (used[j]) continue;
      if (distance(ends[i].point, ends[j].point) <= TOLERANCE_MM) {
        cluster.push(ends[j]);
        used[j] = true;
      }
    }
    clusters.push(cluster);
  }

  for (const cluster of clusters) {
    const distinctWalls = new Set(cluster.map((e) => e.wall.id));
    if (cluster.length === 2 && distinctWalls.size === 2) {
      applyMitre(cluster[0], cluster[1], corners);
    } else if (cluster.length > 2) {
      for (const member of cluster) {
        const others = cluster.filter((e) => e.wall.id !== member.wall.id);
        if (others.length === 0) continue;
        const ext = Math.max(...others.map((e) => e.wall.thickness_mm / 2));
        extendEnd(member, ext, corners);
      }
    } else if (cluster.length === 1) {
      const member = cluster[0];
      const host = findAxisHost(member, walls);
      if (host) extendEnd(member, host.thickness_mm / 2, corners);
    }
  }

  return corners;
}

/**
 * A wall end that touches the interior of another wall's axis forms a T joint.
 * @param {{wall: Wall, end: 'start'|'end', point: Vec}} member
 * @param {Wall[]} walls
 * @returns {Wall|null}
 */
function findAxisHost(member, walls) {
  /** @type {Wall|null} */
  let best = null;
  let bestThickness = -1;
  for (const other of walls) {
    if (other.id === member.wall.id) continue;
    const len = wallLength(other);
    if (len < TOLERANCE_MM) continue;
    const { t, distance: dist } = projectPoint(wallAxis(other), member.point);
    if (dist > TOLERANCE_MM) continue;
    const along = t * len;
    if (along <= TOLERANCE_MM || along >= len - TOLERANCE_MM) continue; // endpoint, not interior
    if (other.thickness_mm > bestThickness) {
      best = other;
      bestThickness = other.thickness_mm;
    }
  }
  return best;
}

/**
 * Push a wall end outwards along its own direction. Used for T and X joints.
 * @param {{wall: Wall, end: 'start'|'end'}} member
 * @param {number} extension
 * @param {Map<string, WallCorners>} corners
 */
function extendEnd(member, extension, corners) {
  const { wall, end } = member;
  const current = corners.get(wall.id);
  if (!current) return;
  const half = wall.thickness_mm / 2;
  const len = wallLength(wall);
  if (end === 'start') {
    current.startLeft = pointOnWall(wall, -extension, half);
    current.startRight = pointOnWall(wall, -extension, -half);
  } else {
    current.endLeft = pointOnWall(wall, len + extension, half);
    current.endRight = pointOnWall(wall, len + extension, -half);
  }
}

/**
 * Mitre two wall ends that meet in a corner.
 *
 * The inner corner is the intersection of the two faces that point towards each
 * other; the outer corner is the intersection of the two faces that point away.
 * Both walls receive the identical points, so the corner closes exactly.
 *
 * @param {{wall: Wall, end: 'start'|'end', point: Vec}} m1
 * @param {{wall: Wall, end: 'start'|'end', point: Vec}} m2
 * @param {Map<string, WallCorners>} corners
 */
function applyMitre(m1, m2, corners) {
  const u1 = outgoingDirection(m1);
  const u2 = outgoingDirection(m2);
  if (Math.abs(cross(u1, u2)) < 1e-6) return; // collinear: a butt joint is correct

  const n1 = leftNormal(wallDirection(m1.wall));
  const n2 = leftNormal(wallDirection(m2.wall));
  const half1 = m1.wall.thickness_mm / 2;
  const half2 = m2.wall.thickness_mm / 2;

  const leftFace1 = faceLine(m1.wall, half1);
  const rightFace1 = faceLine(m1.wall, -half1);
  const leftFace2 = faceLine(m2.wall, half2);
  const rightFace2 = faceLine(m2.wall, -half2);

  // "towards" = the face whose outward normal points at the other wall
  const oneLeftTowards = dot(n1, u2) > 0;
  const twoLeftTowards = dot(n2, u1) > 0;

  const face1Towards = oneLeftTowards ? leftFace1 : rightFace1;
  const face1Away = oneLeftTowards ? rightFace1 : leftFace1;
  const face2Towards = twoLeftTowards ? leftFace2 : rightFace2;
  const face2Away = twoLeftTowards ? rightFace2 : leftFace2;

  const inner = lineIntersection(face1Towards, face2Towards);
  const outer = lineIntersection(face1Away, face2Away);
  if (!inner || !outer) return;

  assignCorner(m1, corners, oneLeftTowards ? inner : outer, oneLeftTowards ? outer : inner);
  assignCorner(m2, corners, twoLeftTowards ? inner : outer, twoLeftTowards ? outer : inner);
}

/**
 * @param {{wall: Wall, end: 'start'|'end'}} member
 * @param {Map<string, WallCorners>} corners
 * @param {Vec} left
 * @param {Vec} right
 */
function assignCorner(member, corners, left, right) {
  const current = corners.get(member.wall.id);
  if (!current) return;
  if (member.end === 'start') {
    current.startLeft = left;
    current.startRight = right;
  } else {
    current.endLeft = left;
    current.endRight = right;
  }
}

/**
 * Unit vector pointing away from the junction along the wall.
 * @param {{wall: Wall, end: 'start'|'end'}} member
 * @returns {Vec}
 */
function outgoingDirection(member) {
  const d = wallDirection(member.wall);
  return member.end === 'start' ? d : { x: -d.x, y: -d.y };
}

/**
 * The infinite line of one wall face, as a segment on the wall axis offset sideways.
 * @param {Wall} wall
 * @param {number} offset
 * @returns {{a: Vec, b: Vec}}
 */
function faceLine(wall, offset) {
  return { a: pointOnWall(wall, 0, offset), b: pointOnWall(wall, wallLength(wall), offset) };
}

/**
 * Solid intervals of a wall after subtracting its openings.
 * Openings are clamped to the wall and sorted by position, so the result is
 * deterministic regardless of the document order of the openings.
 *
 * @param {Wall} wall
 * @param {Opening[]} openings
 * @returns {{solids: Array<{from: number, to: number}>, spans: Array<{opening: Opening, from: number, to: number, clipped: boolean}>}}
 */
export function wallSolidIntervals(wall, openings) {
  const len = wallLength(wall);
  const spans = openings
    .map((opening) => {
      const raw = openingSpan(opening);
      const from = Math.max(0, Math.min(len, raw.from));
      const to = Math.max(0, Math.min(len, raw.to));
      return { opening, from, to, clipped: from !== raw.from || to !== raw.to };
    })
    .filter((span) => span.to - span.from > 0.5)
    .sort((a, b) => (a.from - b.from) || (a.to - b.to) || (a.opening.id < b.opening.id ? -1 : 1));

  /** @type {Array<{from: number, to: number}>} */
  const solids = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.from > cursor + 0.5) solids.push({ from: cursor, to: span.from });
    cursor = Math.max(cursor, span.to);
  }
  if (len - cursor > 0.5) solids.push({ from: cursor, to: len });
  return { solids, spans };
}

/**
 * Build the full geometry of one wall.
 * @param {Wall} wall
 * @param {Opening[]} openings
 * @param {WallCorners} corners
 * @returns {WallGeometry}
 */
export function buildWall(wall, openings, corners) {
  const len = wallLength(wall);
  const half = wall.thickness_mm / 2;
  const direction = wallDirection(wall);
  const normal = leftNormal(direction);

  /**
   * @param {number} dist
   * @param {number} side +1 left, -1 right
   * @returns {Vec}
   */
  const face = (dist, side) => {
    if (dist <= 0.5) return side > 0 ? corners.startLeft : corners.startRight;
    if (dist >= len - 0.5) return side > 0 ? corners.endLeft : corners.endRight;
    return pointOnWall(wall, dist, side * half);
  };

  const { solids, spans } = wallSolidIntervals(wall, openings);

  const solidPolygons = solids.map(({ from, to }) => ({
    from,
    to,
    polygon: [face(from, -1), face(to, -1), face(to, 1), face(from, 1)],
  }));

  /** @type {OpeningGeometry[]} */
  const openingGeometries = spans.map(({ opening, from, to, clipped }) => {
    const r0 = face(from, -1);
    const r1 = face(to, -1);
    const l1 = face(to, 1);
    const l0 = face(from, 1);
    return {
      opening,
      from,
      to,
      center: pointOnWall(wall, (from + to) / 2, 0),
      quad: [r0, r1, l1, l0],
      startReveal: [r0, l0],
      endReveal: [r1, l1],
      clipped,
    };
  });

  return {
    wall,
    axis: wallAxis(wall),
    length: len,
    direction,
    normal,
    thickness: wall.thickness_mm,
    corners,
    solids: solidPolygons,
    openings: openingGeometries,
    body: [corners.startRight, corners.endRight, corners.endLeft, corners.startLeft],
  };
}

/**
 * Build geometry for every wall of a level.
 * @param {Wall[]} walls
 * @param {Map<string, Opening[]>|Record<string, Opening[]>} openingsByWall
 * @returns {Map<string, WallGeometry>}
 */
export function buildWallGeometry(walls, openingsByWall) {
  const corners = computeJunctions(walls);
  /** @type {Map<string, WallGeometry>} */
  const out = new Map();
  for (const wall of walls) {
    const openings = openingsByWall instanceof Map
      ? (openingsByWall.get(wall.id) ?? [])
      : (openingsByWall[wall.id] ?? []);
    const wallCorners = corners.get(wall.id);
    if (!wallCorners) continue;
    out.set(wall.id, buildWall(wall, openings, wallCorners));
  }
  return out;
}
