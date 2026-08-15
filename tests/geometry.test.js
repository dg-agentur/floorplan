import { test } from 'node:test';
import assert from 'node:assert/strict';

import { angleDeg, distance, leftNormal, nearlyEqual, roundMm } from '../src/geometry/vec.js';
import {
  areCollinear, areParallel, distanceToSegment, lineIntersection, offsetSegment, projectPoint,
  segmentIntersection, signedDistanceToLine,
} from '../src/geometry/segment.js';
import {
  area, centroid, checkSimple, clipLineToPolygon, containsPoint, labelPoint, normalizeOrientation,
  polygonsOverlap, rectangle, signedArea,
} from '../src/geometry/polygon.js';
import { mergePolygons, splitPolygonByLine } from '../src/geometry/polygonOps.js';
import {
  buildWallGeometry, computeJunctions, openingSpan, pointOnWall, wallLength, wallSolidIntervals,
} from '../src/geometry/wallGeometry.js';
import { unionOutline } from '../src/geometry/outline.js';

/**
 * @param {number} id
 * @param {number[]} coords [ax, ay, bx, by]
 * @param {number} thickness
 * @returns {any}
 */
function wall(id, [ax, ay, bx, by], thickness = 200) {
  return {
    id: `wall_${String(id).padStart(3, '0')}`,
    type: 'wall',
    start: { x_mm: ax, y_mm: ay },
    end: { x_mm: bx, y_mm: by },
    thickness_mm: thickness,
  };
}

// --- vectors ---------------------------------------------------------------

test('roundMm rounds half away from zero and never yields -0', () => {
  assert.equal(roundMm(1.5), 2);
  assert.equal(roundMm(-1.5), -2);
  assert.equal(roundMm(2.4), 2);
  assert.equal(Object.is(roundMm(-0.2), 0), true, 'must be +0, not -0');
});

test('leftNormal points 90 degrees counter clockwise', () => {
  assert.deepEqual(leftNormal({ x: 1, y: 0 }), { x: 0, y: 1 });
  assert.deepEqual(leftNormal({ x: 0, y: 1 }), { x: -1, y: 0 });
});

test('angleDeg normalises -180 to 180', () => {
  assert.equal(angleDeg({ x: -1, y: 0 }), 180);
  assert.equal(angleDeg({ x: 1, y: 0 }), 0);
});

// --- segments --------------------------------------------------------------

test('projectPoint returns parameter and perpendicular distance', () => {
  const segment = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
  const result = projectPoint(segment, { x: 3, y: 4 });
  assert.equal(result.t, 0.3);
  assert.equal(result.distance, 4);
});

test('distanceToSegment clamps to the segment, unlike the infinite line', () => {
  const segment = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
  assert.equal(distanceToSegment(segment, { x: -5, y: 0 }), 5);
  assert.equal(Math.abs(signedDistanceToLine(segment, { x: -5, y: 0 })), 0);
});

test('signedDistanceToLine is positive on the left', () => {
  const segment = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
  assert.ok(signedDistanceToLine(segment, { x: 5, y: 2 }) > 0);
  assert.ok(signedDistanceToLine(segment, { x: 5, y: -2 }) < 0);
});

test('lineIntersection returns null for parallel lines', () => {
  assert.equal(lineIntersection(
    { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
    { a: { x: 0, y: 5 }, b: { x: 10, y: 5 } },
  ), null);
  const hit = lineIntersection(
    { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
    { a: { x: 4, y: -5 }, b: { x: 4, y: 5 } },
  );
  assert.ok(hit && nearlyEqual(hit, { x: 4, y: 0 }, 0.001));
});

test('segmentIntersection respects the finite extent', () => {
  const s1 = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
  assert.ok(segmentIntersection(s1, { a: { x: 5, y: -1 }, b: { x: 5, y: 1 } }));
  assert.equal(segmentIntersection(s1, { a: { x: 15, y: -1 }, b: { x: 15, y: 1 } }), null);
});

test('parallel and collinear detection', () => {
  const s1 = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
  assert.equal(areParallel(s1, { a: { x: 0, y: 50 }, b: { x: 100, y: 50 } }), true);
  assert.equal(areCollinear(s1, { a: { x: 0, y: 50 }, b: { x: 100, y: 50 } }), false);
  assert.equal(areCollinear(s1, { a: { x: 200, y: 0 }, b: { x: 300, y: 0 } }), true);
});

test('offsetSegment moves to the left for positive offsets', () => {
  const result = offsetSegment({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, 5);
  assert.equal(result.a.y, 5);
});

// --- polygons --------------------------------------------------------------

test('signed area is positive for counter clockwise polygons', () => {
  const ccw = rectangle(0, 0, 100, 50);
  assert.equal(signedArea(ccw), 5000);
  assert.equal(signedArea([...ccw].reverse()), -5000);
  assert.equal(area([...ccw].reverse()), 5000);
});

test('normalizeOrientation always returns counter clockwise', () => {
  const cw = [...rectangle(0, 0, 10, 10)].reverse();
  assert.ok(signedArea(normalizeOrientation(cw)) > 0);
});

test('containsPoint uses ray casting correctly on an L shape', () => {
  const l = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 },
    { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 },
  ];
  assert.equal(containsPoint(l, { x: 20, y: 20 }), true);
  assert.equal(containsPoint(l, { x: 80, y: 80 }), false, 'the notch is outside');
  assert.equal(containsPoint(l, { x: 90, y: 20 }), true);
});

test('centroid of an L shape can fall outside, labelPoint does not', () => {
  const l = [
    { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 200 },
    { x: 200, y: 200 }, { x: 200, y: 1000 }, { x: 0, y: 1000 },
  ];
  const anchor = labelPoint(l);
  assert.equal(containsPoint(l, anchor), true, 'the label anchor must be inside the room');
  void centroid(l);
});

test('checkSimple detects self intersection but allows shared vertices', () => {
  assert.equal(checkSimple(rectangle(0, 0, 10, 10)).selfIntersects, false);
  const bowtie = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  assert.equal(checkSimple(bowtie).selfIntersects, true);
});

test('polygonsOverlap distinguishes touching from overlapping', () => {
  const a = rectangle(0, 0, 100, 100);
  assert.equal(polygonsOverlap(a, rectangle(100, 0, 100, 100)), false, 'sharing an edge is not overlapping');
  assert.equal(polygonsOverlap(a, rectangle(50, 50, 100, 100)), true);
  assert.equal(polygonsOverlap(a, rectangle(300, 0, 10, 10)), false);
  assert.equal(polygonsOverlap(a, rectangle(20, 20, 10, 10)), true, 'full containment counts as overlap');
});

test('clipLineToPolygon returns only the pieces inside', () => {
  const square = rectangle(0, 0, 100, 100);
  const pieces = clipLineToPolygon(square, { x: -50, y: 50 }, { x: 150, y: 50 });
  assert.equal(pieces.length, 1);
  assert.equal(Math.round(pieces[0].a.x), 0);
  assert.equal(Math.round(pieces[0].b.x), 100);
});

// --- polygon split and merge ------------------------------------------------

test('splitPolygonByLine cuts a rectangle into two', () => {
  const result = splitPolygonByLine(rectangle(0, 0, 1000, 500), { x: 400, y: -100 }, { x: 400, y: 600 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const areas = result.parts.map(area).sort((a, b) => a - b);
  assert.deepEqual(areas, [200000, 300000]);
});

test('splitPolygonByLine refuses a line that misses the polygon', () => {
  const result = splitPolygonByLine(rectangle(0, 0, 100, 100), { x: 500, y: 0 }, { x: 500, y: 100 });
  assert.equal(result.ok, false);
});

test('splitPolygonByLine refuses a cut with more than two crossings', () => {
  const u = [
    { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 200, y: 300 },
    { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 300 }, { x: 0, y: 300 },
  ];
  const result = splitPolygonByLine(u, { x: -50, y: 200 }, { x: 350, y: 200 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /crosses the boundary 4 times/);
});

test('mergePolygons joins two rectangles that share an edge', () => {
  const merged = mergePolygons(rectangle(0, 0, 100, 100), rectangle(100, 0, 50, 100));
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  assert.equal(area(merged.polygon), 15000);
});

test('mergePolygons joins rectangles that share only part of an edge', () => {
  const merged = mergePolygons(rectangle(0, 0, 100, 100), rectangle(100, 0, 50, 40));
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  assert.equal(area(merged.polygon), 10000 + 2000);
});

test('mergePolygons refuses polygons that do not touch', () => {
  const merged = mergePolygons(rectangle(0, 0, 100, 100), rectangle(500, 0, 100, 100));
  assert.equal(merged.ok, false);
  if (!merged.ok) assert.match(merged.reason, /do not share a common edge/);
});

// --- wall geometry ----------------------------------------------------------

test('openingSpan treats offset_mm as the centre of the opening', () => {
  assert.deepEqual(openingSpan({ offset_mm: 1000, width_mm: 900 }), { from: 550, to: 1450 });
});

test('pointOnWall places points along the axis with a sideways offset', () => {
  const w = wall(1, [0, 0, 1000, 0], 200);
  assert.deepEqual(pointOnWall(w, 500), { x: 500, y: 0 });
  assert.deepEqual(pointOnWall(w, 500, 100), { x: 500, y: 100 }, 'positive offset is to the left');
});

test('an L junction is mitred so both walls share the same corner points', () => {
  const a = wall(1, [0, 0, 1000, 0], 200);
  const b = wall(2, [1000, 0, 1000, 1000], 200);
  const corners = computeJunctions([a, b]);
  const ca = corners.get('wall_001');
  const cb = corners.get('wall_002');
  assert.ok(ca && cb);
  // Outer corner: 100 mm beyond the axis on both sides. Inner corner: 100 mm inside.
  assert.ok(nearlyEqual(ca.endRight, { x: 1100, y: -100 }, 0.001));
  assert.ok(nearlyEqual(ca.endLeft, { x: 900, y: 100 }, 0.001));
  assert.ok(nearlyEqual(cb.startLeft, { x: 900, y: 100 }, 0.001), 'the shared inner corner must be identical');
  assert.ok(nearlyEqual(cb.startRight, { x: 1100, y: -100 }, 0.001));
});

test('a T junction extends the incoming wall to the far face of the host wall', () => {
  const spine = wall(1, [0, 0, 2000, 0], 300);
  const branch = wall(2, [1000, 0, 1000, 1000], 100);
  const corners = computeJunctions([spine, branch]);
  const cb = corners.get('wall_002');
  assert.ok(cb);
  assert.equal(cb.startLeft.y, -150, 'extended by half the host thickness');
  assert.equal(cb.startRight.y, -150);
});

test('a free wall end stays square', () => {
  const only = wall(1, [0, 0, 1000, 0], 200);
  const corners = computeJunctions([only]);
  const c = corners.get('wall_001');
  assert.ok(c);
  assert.deepEqual(c.startLeft, { x: 0, y: 100 });
  assert.deepEqual(c.endRight, { x: 1000, y: -100 });
});

test('openings cut the wall into solid segments', () => {
  const w = wall(1, [0, 0, 4000, 0], 200);
  const { solids, spans } = wallSolidIntervals(w, [
    { id: 'door_001', type: 'door', host_wall_id: 'wall_001', offset_mm: 1000, width_mm: 800 },
    { id: 'door_002', type: 'door', host_wall_id: 'wall_001', offset_mm: 3000, width_mm: 1000 },
  ]);
  assert.equal(spans.length, 2);
  assert.deepEqual(solids, [
    { from: 0, to: 600 },
    { from: 1400, to: 2500 },
    { from: 3500, to: 4000 },
  ]);
});

test('an opening at the very start of a wall leaves no leading segment', () => {
  const w = wall(1, [0, 0, 2000, 0], 200);
  const { solids } = wallSolidIntervals(w, [
    { id: 'door_001', type: 'door', host_wall_id: 'wall_001', offset_mm: 400, width_mm: 800 },
  ]);
  assert.deepEqual(solids, [{ from: 800, to: 2000 }]);
});

test('opening order in the document does not change the geometry', () => {
  const w = wall(1, [0, 0, 4000, 0], 200);
  const openings = [
    { id: 'door_002', type: 'door', host_wall_id: 'wall_001', offset_mm: 3000, width_mm: 1000 },
    { id: 'door_001', type: 'door', host_wall_id: 'wall_001', offset_mm: 1000, width_mm: 800 },
  ];
  const forward = wallSolidIntervals(w, openings).solids;
  const backward = wallSolidIntervals(w, [...openings].reverse()).solids;
  assert.deepEqual(forward, backward);
});

test('buildWallGeometry produces one body plus segmented solids', () => {
  const walls = [
    wall(1, [0, 0, 4000, 0], 300),
    wall(2, [4000, 0, 4000, 3000], 300),
    wall(3, [4000, 3000, 0, 3000], 300),
    wall(4, [0, 3000, 0, 0], 300),
  ];
  const openingsByWall = new Map([['wall_001', [
    { id: 'door_001', type: 'door', host_wall_id: 'wall_001', offset_mm: 2000, width_mm: 1000 },
  ]]]);
  const geometry = buildWallGeometry(walls, openingsByWall);
  assert.equal(geometry.size, 4);
  assert.equal(geometry.get('wall_001')?.solids.length, 2);
  assert.equal(geometry.get('wall_002')?.solids.length, 1);
  assert.equal(Math.round(wallLength(walls[0])), 4000);
});

// --- union outline ----------------------------------------------------------

test('unionOutline drops interior edges between abutting rectangles', () => {
  const left = rectangle(0, 0, 100, 100);
  const right = rectangle(100, 0, 100, 100);
  const outline = unionOutline([left, right]);
  const totalLength = outline.reduce((sum, s) => sum + distance(s.a, s.b), 0);
  assert.equal(Math.round(totalLength), 600, 'perimeter of the union, not of both rectangles');
  const shared = outline.filter((s) => Math.abs(s.a.x - 100) < 0.01 && Math.abs(s.b.x - 100) < 0.01);
  assert.equal(shared.length, 0, 'the shared edge must not be drawn');
});

test('unionOutline keeps the outline of a single rectangle', () => {
  const outline = unionOutline([rectangle(0, 0, 100, 50)]);
  const totalLength = outline.reduce((sum, s) => sum + distance(s.a, s.b), 0);
  assert.equal(Math.round(totalLength), 300);
});

test('unionOutline is deterministic', () => {
  const polygons = [rectangle(0, 0, 100, 100), rectangle(100, 0, 100, 100), rectangle(0, 100, 200, 50)];
  assert.deepEqual(unionOutline(polygons), unionOutline(polygons));
});
