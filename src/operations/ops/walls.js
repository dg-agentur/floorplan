/**
 * Wall operations.
 *
 * move_wall is the most consequential operation in the system: moving a wall
 * has to take the connected walls and the room boundaries with it, otherwise the
 * model degrades silently with every edit. What it changed is always reported in
 * `affected_ids`, and its inverse is an exact snapshot of everything it touched.
 */

import { OperationError } from '../../util/errors.js';
import { TOLERANCE_MM } from '../../model/constants.js';
import { ensureCollection } from '../../model/document.js';
import { add, dot, fromModel, leftNormal, scale, toModel, distance } from '../../geometry/vec.js';
import { lineIntersection, projectPoint, signedDistanceToLine } from '../../geometry/segment.js';
import { openingSpan, pointOnWall, wallDirection, wallLength } from '../../geometry/wallGeometry.js';
import {
  applyOptionalFields, deleteElementOp, label, removeElement, restoreElementOp, setElementOp, snapshot,
} from '../helpers.js';
import * as F from '../schemaFragments.js';

/** Maximum factor by which a neighbouring wall may be stretched by a projection. */
const MAX_NEIGHBOUR_STRETCH = 20;

/** @type {import('../registry.js').OperationDefinition[]} */
export const wallOperations = [
  {
    op: 'create_wall',
    category: 'walls',
    summary: 'Create a new wall from its centerline and thickness.',
    description:
      'start and end are the centerline endpoints in millimetres. Snap them exactly to existing wall endpoints '
      + 'so that corners can be mitred (docs/geometry-model.md).',
    schema: F.operationSchema('create_wall', {
      required: ['start', 'end', 'thickness_mm'],
      properties: {
        id: F.id(),
        level_id: F.id(),
        name: F.name(),
        start: F.point(),
        end: F.point(),
        thickness_mm: F.positiveMm(),
        height_mm: F.positiveMm(),
        base_z_mm: { type: 'integer', minimum: -10000, maximum: 100000 },
        classification: F.classification(),
        material: { type: 'string', maxLength: 200 },
        ...F.provenanceProperties(),
      },
    }),
    examples: [
      {
        op: 'create_wall',
        start: { x_mm: 0, y_mm: 0 },
        end: { x_mm: 4200, y_mm: 0 },
        thickness_mm: 115,
        classification: 'partition',
        state: 'new',
        provenance: 'provided',
      },
    ],
    apply(ctx, operation) {
      const level = operation.level_id ? ctx.index.requireLevel(operation.level_id) : ctx.defaultLevel();
      const length = distance(fromModel(operation.start), fromModel(operation.end));
      if (length < TOLERANCE_MM) {
        throw new OperationError('WALL_ZERO_LENGTH', 'create_wall: start and end are the same point.', { op: 'create_wall' });
      }
      const id = ctx.ids.next('wall', operation.id);
      /** @type {any} */
      const wall = {
        id,
        type: 'wall',
        start: operation.start,
        end: operation.end,
        thickness_mm: operation.thickness_mm,
      };
      applyOptionalFields(wall, operation, [
        'name', 'height_mm', 'base_z_mm', 'classification', 'material', ...F.PROVENANCE_FIELD_NAMES,
      ]);
      ensureCollection(level, 'walls').push(wall);
      ctx.reindex();
      return {
        summary: `Created wall "${id}" (${Math.round(length)} mm long, ${operation.thickness_mm} mm thick) on level "${level.id}".`,
        affected_ids: [id],
        inverse: [deleteElementOp(id)],
      };
    },
  },

  {
    op: 'delete_wall',
    category: 'walls',
    summary: 'Delete a wall together with every opening hosted by it.',
    description:
      'Cascades to the hosted openings, because an opening without its wall is meaningless. The inverse restores '
      + 'the wall and all removed openings.',
    schema: F.operationSchema('delete_wall', {
      required: ['target_id'],
      properties: { target_id: F.id() },
    }),
    examples: [{ op: 'delete_wall', target_id: 'wall_007' }],
    apply(ctx, operation) {
      const wall = ctx.index.requireWall(operation.target_id);
      const hosted = ctx.index.openingsOf(wall.id).map((o) => o.id);
      /** @type {Record<string, unknown>[]} */
      const inverse = [];
      /** @type {string[]} */
      const affected = [wall.id];

      for (const openingId of hosted) {
        const removed = removeElement(ctx, openingId);
        inverse.unshift(restoreElementOp(removed.level.id, removed.element, removed.index));
        affected.push(openingId);
      }
      const removedWall = removeElement(ctx, wall.id);
      inverse.unshift(restoreElementOp(removedWall.level.id, removedWall.element, removedWall.index));

      return {
        summary: hosted.length > 0
          ? `Deleted wall ${label(wall)} and ${hosted.length} opening(s): ${hosted.join(', ')}.`
          : `Deleted wall ${label(wall)}.`,
        affected_ids: affected,
        inverse,
      };
    },
  },

  {
    op: 'move_wall',
    category: 'walls',
    summary: 'Move a wall, dragging connected walls and room boundaries with it.',
    description:
      'mode "translate" shifts the wall by delta_mm. mode "offset_normal" shifts it sideways by offset_mm '
      + '(positive = to the left of start -> end). Connected wall ends are re-projected onto the new centerline so '
      + 'the layout stays closed, and space boundary points that sat on the moved wall faces move with it. '
      + 'Everything that changed is listed in affected_ids.',
    schema: F.operationSchema('move_wall', {
      required: ['target_id'],
      properties: {
        target_id: F.id(),
        mode: { enum: ['translate', 'offset_normal'] },
        delta_mm: {
          type: 'object',
          required: ['dx_mm', 'dy_mm'],
          additionalProperties: false,
          properties: {
            dx_mm: { type: 'integer', minimum: -1000000, maximum: 1000000 },
            dy_mm: { type: 'integer', minimum: -1000000, maximum: 1000000 },
          },
        },
        offset_mm: { type: 'integer', minimum: -1000000, maximum: 1000000 },
        keep_connections: { type: 'boolean' },
      },
    }),
    examples: [
      { op: 'move_wall', target_id: 'wall_005', mode: 'offset_normal', offset_mm: 500 },
      { op: 'move_wall', target_id: 'wall_005', mode: 'translate', delta_mm: { dx_mm: 0, dy_mm: -250 } },
    ],
    apply(ctx, operation) {
      const wall = ctx.index.requireWall(operation.target_id);
      const level = ctx.index.require(wall.id).level;
      const mode = operation.mode ?? (operation.offset_mm !== undefined ? 'offset_normal' : 'translate');
      const keepConnections = operation.keep_connections ?? true;

      /** @type {{x: number, y: number}} */
      let delta;
      if (mode === 'offset_normal') {
        if (operation.offset_mm === undefined) {
          throw new OperationError('MISSING_PARAMETER', 'move_wall: mode "offset_normal" requires offset_mm.', { op: 'move_wall' });
        }
        delta = scale(leftNormal(wallDirection(wall)), operation.offset_mm);
      } else {
        if (!operation.delta_mm) {
          throw new OperationError('MISSING_PARAMETER', 'move_wall: mode "translate" requires delta_mm.', { op: 'move_wall' });
        }
        delta = { x: operation.delta_mm.dx_mm, y: operation.delta_mm.dy_mm };
      }
      if (Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) {
        throw new OperationError('NO_OP', 'move_wall: the resulting displacement is zero.', { op: 'move_wall' });
      }

      const oldStart = fromModel(wall.start);
      const oldEnd = fromModel(wall.end);
      const normal = leftNormal(wallDirection(wall));
      const perpendicularShift = dot(delta, normal);

      /** @type {Map<string, any>} */
      const before = new Map();
      /** @param {any} element */
      const remember = (element) => {
        if (!before.has(element.id)) before.set(element.id, snapshot(element));
      };

      remember(wall);
      wall.start = toModel(add(oldStart, delta));
      wall.end = toModel(add(oldEnd, delta));
      const newAxis = { a: fromModel(wall.start), b: fromModel(wall.end) };

      if (keepConnections) {
        adjustNeighbours(ctx, level, wall, { a: oldStart, b: oldEnd }, newAxis, delta, remember);
        if (Math.abs(perpendicularShift) > 0.5) {
          adjustSpaces(level, wall, { a: oldStart, b: oldEnd }, normal, perpendicularShift, remember);
        }
      }

      ctx.reindex();
      const affected = [...before.keys()];
      const description = mode === 'offset_normal'
        ? `offset by ${operation.offset_mm} mm`
        : `translated by (${operation.delta_mm.dx_mm}, ${operation.delta_mm.dy_mm}) mm`;
      return {
        summary: `Wall ${label(wall)} ${description}${affected.length > 1 ? `; ${affected.length - 1} connected element(s) followed` : ''}.`,
        affected_ids: affected,
        inverse: affected.map((id) => setElementOp(level.id, before.get(id))).reverse(),
      };
    },
  },

  {
    op: 'set_wall_thickness',
    category: 'walls',
    summary: 'Change the thickness of a wall.',
    description: 'The centerline stays where it is, so the wall grows or shrinks symmetrically on both sides.',
    schema: F.operationSchema('set_wall_thickness', {
      required: ['target_id', 'thickness_mm'],
      properties: {
        target_id: F.id(),
        thickness_mm: F.positiveMm(),
        provenance: F.provenance(),
        confidence: F.confidence(),
      },
    }),
    examples: [{ op: 'set_wall_thickness', target_id: 'wall_003', thickness_mm: 175 }],
    apply(ctx, operation) {
      const wall = ctx.index.requireWall(operation.target_id);
      const level = ctx.index.require(wall.id).level;
      const before = snapshot(wall);
      wall.thickness_mm = operation.thickness_mm;
      if (operation.provenance) {
        wall.property_provenance = wall.property_provenance ?? {};
        wall.property_provenance.thickness_mm = {
          provenance: operation.provenance,
          ...(operation.confidence !== undefined ? { confidence: operation.confidence } : {}),
        };
      }
      return {
        summary: `Wall ${label(wall)} thickness changed from ${before.thickness_mm} mm to ${operation.thickness_mm} mm.`,
        affected_ids: [wall.id],
        inverse: [setElementOp(level.id, before)],
      };
    },
  },

  {
    op: 'split_wall',
    category: 'walls',
    summary: 'Split a wall into two at a distance along its centerline.',
    description:
      'Openings are reassigned to the part they fall into. An opening that straddles the split point is refused '
      + 'rather than silently moved.',
    schema: F.operationSchema('split_wall', {
      required: ['target_id', 'at_mm'],
      properties: {
        target_id: F.id(),
        at_mm: F.positiveMm(),
        new_id: F.id(),
      },
    }),
    examples: [{ op: 'split_wall', target_id: 'wall_002', at_mm: 2400 }],
    apply(ctx, operation) {
      const wall = ctx.index.requireWall(operation.target_id);
      const level = ctx.index.require(wall.id).level;
      const length = wallLength(wall);
      if (operation.at_mm <= TOLERANCE_MM || operation.at_mm >= length - TOLERANCE_MM) {
        throw new OperationError(
          'SPLIT_OUT_OF_RANGE',
          `split_wall: at_mm must lie strictly inside 0..${Math.round(length)} mm (got ${operation.at_mm}).`,
          { op: 'split_wall' },
        );
      }

      const hosted = ctx.index.openingsOf(wall.id);
      const straddling = hosted.filter((opening) => {
        const span = openingSpan(opening);
        return span.from < operation.at_mm - TOLERANCE_MM && span.to > operation.at_mm + TOLERANCE_MM;
      });
      if (straddling.length > 0) {
        throw new OperationError(
          'OPENING_STRADDLES_SPLIT',
          `split_wall: opening(s) ${straddling.map((o) => o.id).join(', ')} cross the split point at ${operation.at_mm} mm.`,
          { op: 'split_wall', hint: 'Move or resize the opening first, or split at a different position.' },
        );
      }

      const beforeWall = snapshot(wall);
      const splitPoint = toModel(pointOnWall(wall, operation.at_mm));
      const newId = ctx.ids.next('wall', operation.new_id);

      /** @type {any} */
      const secondHalf = { ...snapshot(wall), id: newId, start: splitPoint, end: snapshot(wall.end) };
      wall.end = splitPoint;

      // Inverse order matters: the original wall and the reassigned openings have
      // to be restored BEFORE the new wall disappears, otherwise the new wall
      // still hosts openings at the moment it is deleted.
      /** @type {Record<string, unknown>[]} */
      const inverse = [setElementOp(level.id, beforeWall)];
      /** @type {string[]} */
      const affected = [wall.id, newId];

      for (const opening of hosted) {
        const span = openingSpan(opening);
        if (span.from >= operation.at_mm - TOLERANCE_MM) {
          inverse.push(setElementOp(level.id, snapshot(opening)));
          opening.host_wall_id = newId;
          opening.offset_mm = opening.offset_mm - operation.at_mm;
          affected.push(opening.id);
        }
      }
      inverse.push(deleteElementOp(newId));

      ensureCollection(level, 'walls').push(secondHalf);
      ctx.reindex();
      return {
        summary: `Wall ${label(beforeWall)} split at ${operation.at_mm} mm; new wall "${newId}" carries the remaining ${Math.round(length - operation.at_mm)} mm.`,
        affected_ids: affected,
        inverse,
      };
    },
  },
];

/**
 * Re-project the ends of walls that were connected to the moved wall.
 *
 * A neighbour that is not parallel gets its endpoint placed on the intersection
 * with the new centerline, which keeps the neighbour straight and simply makes it
 * longer or shorter. Parallel neighbours cannot be projected and are translated
 * instead.
 *
 * @param {import('../helpers.js').OperationContext} ctx
 * @param {import('../../model/types.js').Level} level
 * @param {any} movedWall
 * @param {{a: {x: number, y: number}, b: {x: number, y: number}}} oldAxis
 * @param {{a: {x: number, y: number}, b: {x: number, y: number}}} newAxis
 * @param {{x: number, y: number}} delta
 * @param {(element: any) => void} remember
 */
function adjustNeighbours(ctx, level, movedWall, oldAxis, newAxis, delta, remember) {
  const oldLength = distance(oldAxis.a, oldAxis.b);
  for (const other of level.walls ?? []) {
    if (other.id === movedWall.id) continue;
    const otherLength = wallLength(other);
    if (otherLength < TOLERANCE_MM) continue;

    for (const end of /** @type {const} */ (['start', 'end'])) {
      const point = fromModel(other[end]);
      const projection = projectPoint(oldAxis, point);
      const along = projection.t * oldLength;
      const touches = projection.distance <= TOLERANCE_MM
        && along >= -TOLERANCE_MM && along <= oldLength + TOLERANCE_MM;
      if (!touches) continue;

      remember(other);
      const otherAxis = { a: fromModel(other.start), b: fromModel(other.end) };
      const intersection = lineIntersection(otherAxis, newAxis);
      if (!intersection) {
        other[end] = toModel(add(point, delta));
        continue;
      }
      const otherEndFixed = end === 'start' ? fromModel(other.end) : fromModel(other.start);
      const newLength = distance(intersection, otherEndFixed);
      if (newLength < TOLERANCE_MM || newLength > otherLength * MAX_NEIGHBOUR_STRETCH + 1000) {
        other[end] = toModel(add(point, delta));
        continue;
      }
      other[end] = toModel(intersection);
    }
  }
}

/**
 * Drag space boundary points that lay on a face of the moved wall.
 * Only the component perpendicular to the wall is applied, so a room corner that
 * sits on two wall faces keeps its position on the other wall.
 *
 * @param {import('../../model/types.js').Level} level
 * @param {any} wall
 * @param {{a: {x: number, y: number}, b: {x: number, y: number}}} oldAxis
 * @param {{x: number, y: number}} normal
 * @param {number} perpendicularShift
 * @param {(element: any) => void} remember
 */
function adjustSpaces(level, wall, oldAxis, normal, perpendicularShift, remember) {
  const half = wall.thickness_mm / 2;
  const oldLength = distance(oldAxis.a, oldAxis.b);
  const shift = scale(normal, perpendicularShift);

  for (const space of level.spaces ?? []) {
    let changed = false;
    const boundary = space.boundary.map((/** @type {any} */ modelPoint) => {
      const point = fromModel(modelPoint);
      const offset = signedDistanceToLine(oldAxis, point);
      const along = projectPoint(oldAxis, point).t * oldLength;
      const onFace = Math.abs(Math.abs(offset) - half) <= TOLERANCE_MM;
      const withinExtent = along >= -half - TOLERANCE_MM && along <= oldLength + half + TOLERANCE_MM;
      if (!onFace || !withinExtent) return modelPoint;
      changed = true;
      return toModel(add(point, shift));
    });
    if (changed) {
      remember(space);
      space.boundary = boundary;
    }
  }
}

export { adjustNeighbours, adjustSpaces };
