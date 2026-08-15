/**
 * Geometric validity.
 *
 * This is the layer that answers "is this drawing possible", not "is this
 * building sensible" (see plausibility.js) and not "is this building legal"
 * (deliberately out of scope, see docs/adr and ARCHITECTURE.md section 11).
 */

import { distance, fromModel } from '../../geometry/vec.js';
import { distanceToSegment, projectPoint } from '../../geometry/segment.js';
import {
  area as polygonArea, checkSimple, containsPoint, edges as polygonEdges, polygonsOverlap,
} from '../../geometry/polygon.js';
import { openingSpan, pointOnWall, wallLength } from '../../geometry/wallGeometry.js';
import { checkAreaOverride } from '../../model/measure.js';
import { resolveWallHeight } from '../../model/document.js';
import { SPACE_WALL_SNAP_MM, TOLERANCE_MM } from '../../model/constants.js';

/** @typedef {import('../context.js').ValidationContext} ValidationContext */

/** Minimum wall stub next to an opening before we consider it suspicious. */
const MIN_WALL_STUB_MM = 50;

/**
 * @param {ValidationContext} ctx
 */
export function checkGeometry(ctx) {
  for (const levelCtx of ctx.levels) {
    checkWalls(ctx, levelCtx);
    checkOpenings(ctx, levelCtx);
    checkSpaces(ctx, levelCtx);
    checkStairs(ctx, levelCtx);
  }
}

/**
 * @param {ValidationContext} ctx
 * @param {import('../context.js').LevelContext} levelCtx
 */
function checkWalls(ctx, levelCtx) {
  const { level } = levelCtx;
  const walls = level.walls ?? [];

  for (const wall of walls) {
    const length = wallLength(wall);
    if (length < TOLERANCE_MM) {
      ctx.report({
        rule: 'WALL_ZERO_LENGTH',
        element_id: wall.id,
        level_id: level.id,
        message: `Wall "${wall.id}" has a length of ${length.toFixed(1)} mm; start and end are effectively the same point.`,
      });
    }
  }

  // --- near miss endpoints and free ends -------------------------------------
  /** @type {Array<{wall: import('../../model/types.js').Wall, end: 'start'|'end', point: import('../../geometry/vec.js').Vec}>} */
  const ends = [];
  for (const wall of walls) {
    if (wallLength(wall) < TOLERANCE_MM) continue;
    ends.push({ wall, end: 'start', point: fromModel(wall.start) });
    ends.push({ wall, end: 'end', point: fromModel(wall.end) });
  }

  for (let i = 0; i < ends.length; i += 1) {
    for (let j = i + 1; j < ends.length; j += 1) {
      if (ends[i].wall.id === ends[j].wall.id) continue;
      const d = distance(ends[i].point, ends[j].point);
      if (d > 0 && d <= SPACE_WALL_SNAP_MM) {
        ctx.report({
          rule: 'WALL_ENDPOINTS_NEAR_MISS',
          element_id: ends[i].wall.id,
          level_id: level.id,
          message: `The ${ends[i].end} of wall "${ends[i].wall.id}" and the ${ends[j].end} of wall "${ends[j].wall.id}" are ${d.toFixed(1)} mm apart but should probably be identical.`,
          data: { other_wall_id: ends[j].wall.id, gap_mm: Math.round(d * 10) / 10 },
          hint: 'Snap the endpoints to the same coordinates so the junction can be mitred.',
        });
      }
    }
  }

  for (const end of ends) {
    const connected = ends.some((other) => other.wall.id !== end.wall.id
      && distance(other.point, end.point) <= TOLERANCE_MM);
    if (connected) continue;
    const onAxis = walls.some((other) => {
      if (other.id === end.wall.id) return false;
      const otherLength = wallLength(other);
      if (otherLength < TOLERANCE_MM) return false;
      const projection = projectPoint({ a: fromModel(other.start), b: fromModel(other.end) }, end.point);
      return projection.distance <= TOLERANCE_MM
        && projection.t * otherLength > TOLERANCE_MM
        && projection.t * otherLength < otherLength - TOLERANCE_MM;
    });
    if (!onAxis) {
      ctx.report({
        rule: 'WALL_FREE_END',
        element_id: end.wall.id,
        level_id: level.id,
        message: `The ${end.end} of wall "${end.wall.id}" at (${end.point.x}, ${end.point.y}) does not meet another wall.`,
        data: { end: end.end, x_mm: end.point.x, y_mm: end.point.y },
        hint: 'Free ends are legitimate (a stub wall, an unfinished plan) but often indicate a gap in the layout.',
      });
    }
  }
}

/**
 * @param {ValidationContext} ctx
 * @param {import('../context.js').LevelContext} levelCtx
 */
function checkOpenings(ctx, levelCtx) {
  const { level, wallsById } = levelCtx;

  /** @type {Map<string, Array<{opening: import('../../model/types.js').Opening, from: number, to: number}>>} */
  const byWall = new Map();

  for (const opening of level.openings ?? []) {
    const wall = wallsById.get(opening.host_wall_id);
    if (!wall) continue; // reported by the reference rules
    const length = wallLength(wall);
    const span = openingSpan(opening);

    if (opening.width_mm > length) {
      ctx.report({
        rule: 'OPENING_WIDER_THAN_WALL',
        element_id: opening.id,
        level_id: level.id,
        message: `Opening "${opening.id}" is ${opening.width_mm} mm wide but wall "${wall.id}" is only ${Math.round(length)} mm long.`,
      });
    } else if (span.from < -TOLERANCE_MM || span.to > length + TOLERANCE_MM) {
      ctx.report({
        rule: 'OPENING_OUTSIDE_WALL',
        element_id: opening.id,
        level_id: level.id,
        message: `Opening "${opening.id}" spans ${Math.round(span.from)}..${Math.round(span.to)} mm along wall "${wall.id}", which runs from 0 to ${Math.round(length)} mm.`,
        data: {
          span_from_mm: Math.round(span.from),
          span_to_mm: Math.round(span.to),
          wall_length_mm: Math.round(length),
        },
        hint: 'offset_mm addresses the CENTRE of the opening, so the valid range is width/2 .. wall_length - width/2.',
      });
    } else {
      const stubStart = span.from;
      const stubEnd = length - span.to;
      if (Math.min(stubStart, stubEnd) < MIN_WALL_STUB_MM) {
        ctx.report({
          rule: 'OPENING_NEAR_WALL_END',
          element_id: opening.id,
          level_id: level.id,
          message: `Opening "${opening.id}" leaves only ${Math.round(Math.min(stubStart, stubEnd))} mm of wall next to it.`,
          data: { stub_start_mm: Math.round(stubStart), stub_end_mm: Math.round(stubEnd) },
        });
      }
    }

    const list = byWall.get(opening.host_wall_id);
    const entry = { opening, from: span.from, to: span.to };
    if (list) list.push(entry);
    else byWall.set(opening.host_wall_id, [entry]);

    // --- vertical fit --------------------------------------------------------
    const wallHeight = resolveWallHeight(ctx.doc, wall, level);
    const top = (opening.sill_mm ?? 0) + (opening.height_mm ?? 0);
    if (opening.height_mm !== undefined && top > wallHeight) {
      ctx.report({
        rule: 'WINDOW_ABOVE_WALL',
        element_id: opening.id,
        level_id: level.id,
        message: `Opening "${opening.id}" reaches ${top} mm above floor level but wall "${wall.id}" is only ${wallHeight} mm high.`,
        data: { opening_top_mm: top, wall_height_mm: wallHeight },
      });
    }
  }

  for (const [wallId, entries] of [...byWall.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const sorted = [...entries].sort((a, b) => a.from - b.from || (a.opening.id < b.opening.id ? -1 : 1));
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (current.from < previous.to - TOLERANCE_MM) {
        ctx.report({
          rule: 'OPENING_OVERLAP',
          element_id: current.opening.id,
          level_id: level.id,
          message: `Openings "${previous.opening.id}" and "${current.opening.id}" overlap on wall "${wallId}" by ${Math.round(previous.to - current.from)} mm.`,
          data: { other_opening_id: previous.opening.id, overlap_mm: Math.round(previous.to - current.from) },
        });
      }
    }
  }
}

/**
 * @param {ValidationContext} ctx
 * @param {import('../context.js').LevelContext} levelCtx
 */
function checkSpaces(ctx, levelCtx) {
  const { level } = levelCtx;
  const spaces = level.spaces ?? [];
  const walls = level.walls ?? [];

  /** Wall faces as segments, used to check that room boundaries follow walls. */
  const faces = walls.flatMap((wall) => {
    const half = wall.thickness_mm / 2;
    const length = wallLength(wall);
    return [half, -half].map((offset) => ({
      wallId: wall.id,
      a: pointOnWall(wall, 0, offset),
      b: pointOnWall(wall, length, offset),
    }));
  });

  for (const space of spaces) {
    const polygon = (space.boundary ?? []).map(fromModel);
    const spaceArea = polygonArea(polygon);

    // Self intersection is checked first: a crossing boundary can have an area of
    // zero, and "the outline crosses itself" is the more useful message.
    const simple = polygon.length >= 3 ? checkSimple(polygon) : { selfIntersects: false };
    if (simple.selfIntersects) {
      ctx.report({
        rule: 'SPACE_SELF_INTERSECTING',
        element_id: space.id,
        level_id: level.id,
        message: `The boundary of space "${space.id}" crosses itself between edge ${simple.edges?.[0]} and edge ${simple.edges?.[1]}.`,
        data: simple.at ? { x_mm: Math.round(simple.at.x), y_mm: Math.round(simple.at.y) } : undefined,
      });
      continue;
    }

    if (polygon.length < 3 || spaceArea < 1000) {
      ctx.report({
        rule: 'SPACE_DEGENERATE',
        element_id: space.id,
        level_id: level.id,
        message: `Space "${space.id}" ("${space.name}") encloses ${Math.round(spaceArea)} mm², which is not a usable area.`,
      });
      continue;
    }

    // --- boundary follows wall faces ----------------------------------------
    if (faces.length > 0) {
      /** @type {number[]} */
      const offEdges = [];
      polygonEdges(polygon).forEach((edge, i) => {
        const midpoint = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
        const nearest = Math.min(...faces.map((face) => distanceToSegment(face, midpoint)));
        if (nearest > SPACE_WALL_SNAP_MM) offEdges.push(i);
      });
      if (offEdges.length > 0) {
        ctx.report({
          rule: 'SPACE_BOUNDARY_OFF_WALL',
          element_id: space.id,
          level_id: level.id,
          message: `${offEdges.length} of ${polygon.length} boundary edges of space "${space.id}" are further than ${SPACE_WALL_SNAP_MM} mm from any wall face.`,
          data: { edge_indices: offEdges },
          hint: 'Room boundaries should follow the clear inner face of the enclosing walls (docs/adr/0006-space-model.md).',
        });
      }
    }

    // --- declared vs computed area ------------------------------------------
    const areaCheck = checkAreaOverride(space);
    if (areaCheck && !areaCheck.matches) {
      ctx.report({
        rule: 'SPACE_AREA_MISMATCH',
        element_id: space.id,
        level_id: level.id,
        message: `Space "${space.id}" declares ${(areaCheck.declared_mm2 / 1e6).toFixed(2)} m² but its polygon measures ${(areaCheck.computed_mm2 / 1e6).toFixed(2)} m² (${(areaCheck.deviation_ratio * 100).toFixed(1)} % deviation).`,
        data: areaCheck,
        hint: 'The declared area is never used to change geometry. Either correct the polygon or drop area_override_mm2.',
      });
    }
  }

  // --- overlapping rooms ----------------------------------------------------
  for (let i = 0; i < spaces.length; i += 1) {
    for (let j = i + 1; j < spaces.length; j += 1) {
      const a = (spaces[i].boundary ?? []).map(fromModel);
      const b = (spaces[j].boundary ?? []).map(fromModel);
      if (a.length < 3 || b.length < 3) continue;
      if (polygonsOverlap(a, b)) {
        ctx.report({
          rule: 'SPACE_OVERLAP',
          element_id: spaces[i].id,
          level_id: level.id,
          message: `Spaces "${spaces[i].id}" and "${spaces[j].id}" overlap.`,
          data: { other_space_id: spaces[j].id },
        });
      }
    }
  }
}

/**
 * @param {ValidationContext} ctx
 * @param {import('../context.js').LevelContext} levelCtx
 */
function checkStairs(ctx, levelCtx) {
  const { level } = levelCtx;
  for (const stair of level.stairs ?? []) {
    const footprint = (stair.footprint ?? []).map(fromModel);
    if (footprint.length < 3) continue;
    const runStart = fromModel(stair.run_start);
    const runEnd = fromModel(stair.run_end);
    const outside = [runStart, runEnd].filter((p) => !containsPoint(footprint, p, TOLERANCE_MM));
    if (outside.length > 0) {
      ctx.report({
        rule: 'STAIR_RUN_OUTSIDE_FOOTPRINT',
        element_id: stair.id,
        level_id: level.id,
        message: `The run axis of stair "${stair.id}" has ${outside.length} endpoint(s) outside its footprint polygon.`,
      });
    }
  }
}
