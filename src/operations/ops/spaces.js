/**
 * Space (room) operations.
 */

import { OperationError } from '../../util/errors.js';
import { ensureCollection } from '../../model/document.js';
import { fromModel, toModel } from '../../geometry/vec.js';
import { area as polygonArea, checkSimple, normalizeOrientation } from '../../geometry/polygon.js';
import { mergePolygons, splitPolygonByLine } from '../../geometry/polygonOps.js';
import { spaceAreaMm2, toSquareMetres } from '../../model/measure.js';
import {
  applyOptionalFields, deleteElementOp, label, removeElement, restoreElementOp, setElementOp, snapshot,
} from '../helpers.js';
import * as F from '../schemaFragments.js';

/**
 * @param {any[]} boundary
 * @param {string} op
 * @returns {any[]} normalised (counter clockwise) boundary
 */
function validateBoundary(boundary, op) {
  const polygon = boundary.map(fromModel);
  if (polygon.length < 3) {
    throw new OperationError('INVALID_BOUNDARY', `${op}: a boundary needs at least 3 points.`, { op });
  }
  const simple = checkSimple(polygon);
  if (simple.selfIntersects) {
    throw new OperationError('INVALID_BOUNDARY', `${op}: the boundary crosses itself.`, { op });
  }
  if (polygonArea(polygon) < 1000) {
    throw new OperationError('INVALID_BOUNDARY', `${op}: the boundary encloses no usable area.`, { op });
  }
  return normalizeOrientation(polygon).map(toModel);
}

/** @type {import('../registry.js').OperationDefinition[]} */
export const spaceOperations = [
  {
    op: 'create_space',
    category: 'spaces',
    summary: 'Create a room from a boundary polygon.',
    description:
      'The boundary should follow the clear inner face of the enclosing walls. It is stored counter clockwise; '
      + 'the orientation is normalised automatically.',
    schema: F.operationSchema('create_space', {
      required: ['name', 'boundary'],
      properties: {
        id: F.id(),
        level_id: F.id(),
        name: F.name(),
        category: F.spaceCategory(),
        boundary: F.polygon(),
        height_mm: F.positiveMm(),
        area_override_mm2: { type: 'integer', minimum: 1 },
        label_anchor: F.point(),
        ...F.provenanceProperties(),
      },
    }),
    examples: [
      {
        op: 'create_space',
        name: 'Büro',
        category: 'office',
        boundary: [
          { x_mm: 0, y_mm: 0 }, { x_mm: 3000, y_mm: 0 },
          { x_mm: 3000, y_mm: 2500 }, { x_mm: 0, y_mm: 2500 },
        ],
        state: 'new',
        provenance: 'derived',
      },
    ],
    apply(ctx, operation) {
      const level = operation.level_id ? ctx.index.requireLevel(operation.level_id) : ctx.defaultLevel();
      const boundary = validateBoundary(operation.boundary, 'create_space');
      const id = ctx.ids.next('space', operation.id);
      /** @type {any} */
      const space = { id, type: 'space', name: operation.name, boundary };
      applyOptionalFields(space, operation, [
        'category', 'height_mm', 'area_override_mm2', 'label_anchor', ...F.PROVENANCE_FIELD_NAMES,
      ]);
      ensureCollection(level, 'spaces').push(space);
      ctx.reindex();
      return {
        summary: `Created space "${id}" ("${operation.name}", ${toSquareMetres(spaceAreaMm2(space)).toFixed(2)} m²) on level "${level.id}".`,
        affected_ids: [id],
        inverse: [deleteElementOp(id)],
      };
    },
  },

  {
    op: 'delete_space',
    category: 'spaces',
    summary: 'Remove a room.',
    description: 'Walls and openings are not affected; only the room definition disappears.',
    schema: F.operationSchema('delete_space', {
      required: ['target_id'],
      properties: { target_id: F.id() },
    }),
    examples: [{ op: 'delete_space', target_id: 'space_storage' }],
    apply(ctx, operation) {
      ctx.index.requireSpace(operation.target_id);
      const removed = removeElement(ctx, operation.target_id);
      return {
        summary: `Deleted space ${label(removed.element)}.`,
        affected_ids: [operation.target_id],
        inverse: [restoreElementOp(removed.level.id, removed.element, removed.index)],
      };
    },
  },

  {
    op: 'rename_space',
    category: 'spaces',
    summary: 'Change the display name of a room.',
    description: 'Only the name changes. The id stays as it is — ids are immutable (docs/adr/0007-identifiers.md).',
    schema: F.operationSchema('rename_space', {
      required: ['target_id', 'name'],
      properties: { target_id: F.id(), name: F.name() },
    }),
    examples: [{ op: 'rename_space', target_id: 'space_office', name: 'Gästezimmer' }],
    apply(ctx, operation) {
      const space = ctx.index.requireSpace(operation.target_id);
      const before = space.name;
      space.name = operation.name;
      return {
        summary: `Renamed space "${space.id}" from "${before}" to "${operation.name}".`,
        affected_ids: [space.id],
        inverse: [{ op: 'rename_space', target_id: space.id, name: before }],
      };
    },
  },

  {
    op: 'set_space_category',
    category: 'spaces',
    summary: 'Change the category of a room.',
    description: 'The category drives theme colours and future rule modules. It is not a legal use classification.',
    schema: F.operationSchema('set_space_category', {
      required: ['target_id', 'category'],
      properties: { target_id: F.id(), category: F.spaceCategory() },
    }),
    examples: [{ op: 'set_space_category', target_id: 'space_room', category: 'bedroom' }],
    apply(ctx, operation) {
      const space = ctx.index.requireSpace(operation.target_id);
      const level = ctx.index.require(space.id).level;
      const before = snapshot(space);
      space.category = operation.category;
      return {
        summary: `Space "${space.id}" category changed from "${before.category ?? 'none'}" to "${operation.category}".`,
        affected_ids: [space.id],
        inverse: [setElementOp(level.id, before)],
      };
    },
  },

  {
    op: 'set_space_boundary',
    category: 'spaces',
    summary: 'Replace the boundary polygon of a room.',
    description: 'Use this when a room outline has to be corrected directly. For wall driven changes prefer move_wall.',
    schema: F.operationSchema('set_space_boundary', {
      required: ['target_id', 'boundary'],
      properties: { target_id: F.id(), boundary: F.polygon() },
    }),
    examples: [],
    apply(ctx, operation) {
      const space = ctx.index.requireSpace(operation.target_id);
      const level = ctx.index.require(space.id).level;
      const before = snapshot(space);
      space.boundary = validateBoundary(operation.boundary, 'set_space_boundary');
      return {
        summary: `Boundary of space "${space.id}" replaced (${toSquareMetres(spaceAreaMm2(before)).toFixed(2)} m² -> ${toSquareMetres(spaceAreaMm2(space)).toFixed(2)} m²).`,
        affected_ids: [space.id],
        inverse: [setElementOp(level.id, before)],
      };
    },
  },

  {
    op: 'split_space',
    category: 'spaces',
    summary: 'Split a room into two along a straight line.',
    description:
      'The line is infinite and must cross the room boundary exactly twice. The original room keeps its id and '
      + 'the larger part; the smaller part becomes a new room. Note that this changes only the room definition — '
      + 'add a wall separately if the split is a real partition.',
    schema: F.operationSchema('split_space', {
      required: ['target_id', 'line_start', 'line_end'],
      properties: {
        target_id: F.id(),
        line_start: F.point(),
        line_end: F.point(),
        new_id: F.id(),
        new_name: F.name(),
        new_category: F.spaceCategory(),
      },
    }),
    examples: [
      {
        op: 'split_space',
        target_id: 'space_living',
        line_start: { x_mm: 3000, y_mm: 0 },
        line_end: { x_mm: 3000, y_mm: 6000 },
        new_name: 'Arbeitsecke',
      },
    ],
    apply(ctx, operation) {
      const space = ctx.index.requireSpace(operation.target_id);
      const level = ctx.index.require(space.id).level;
      const before = snapshot(space);
      const result = splitPolygonByLine(
        space.boundary.map(fromModel),
        fromModel(operation.line_start),
        fromModel(operation.line_end),
      );
      if (!result.ok) {
        throw new OperationError('SPLIT_NOT_POSSIBLE', `split_space: ${result.reason}`, {
          op: 'split_space',
          hint: 'Choose a line that passes straight through the room.',
        });
      }
      const [first, second] = result.parts;
      const [keep, split] = polygonArea(first) >= polygonArea(second) ? [first, second] : [second, first];

      space.boundary = keep.map(toModel);
      if (space.area_override_mm2 !== undefined) delete space.area_override_mm2;

      const newId = ctx.ids.next('space', operation.new_id);
      /** @type {any} */
      const newSpace = {
        id: newId,
        type: 'space',
        name: operation.new_name ?? `${before.name} 2`,
        boundary: split.map(toModel),
      };
      if (operation.new_category ?? before.category) newSpace.category = operation.new_category ?? before.category;
      for (const field of ['height_mm', 'state', 'source_id']) {
        if (/** @type {any} */ (before)[field] !== undefined) newSpace[field] = /** @type {any} */ (before)[field];
      }
      newSpace.provenance = 'derived';
      ensureCollection(level, 'spaces').push(newSpace);
      ctx.reindex();

      return {
        summary: `Split space "${space.id}" into "${space.id}" (${toSquareMetres(polygonArea(keep)).toFixed(2)} m²) and "${newId}" (${toSquareMetres(polygonArea(split)).toFixed(2)} m²).`,
        affected_ids: [space.id, newId],
        inverse: [deleteElementOp(newId), setElementOp(level.id, before)],
      };
    },
  },

  {
    op: 'merge_spaces',
    category: 'spaces',
    summary: 'Merge two adjacent rooms into one.',
    description:
      'The two rooms must share a common boundary. The first id survives and keeps its identity; the second is '
      + 'removed. Use this after removing a partition wall.',
    schema: F.operationSchema('merge_spaces', {
      required: ['target_ids'],
      properties: {
        target_ids: { type: 'array', minItems: 2, maxItems: 2, items: F.id() },
        name: F.name(),
        category: F.spaceCategory(),
      },
    }),
    examples: [{ op: 'merge_spaces', target_ids: ['space_kitchen', 'space_dining'], name: 'Wohnküche' }],
    apply(ctx, operation) {
      const [firstId, secondId] = operation.target_ids;
      if (firstId === secondId) {
        throw new OperationError('INVALID_TARGET', 'merge_spaces: the two ids must be different.', { op: 'merge_spaces' });
      }
      const first = ctx.index.requireSpace(firstId);
      const second = ctx.index.requireSpace(secondId);
      const firstLevel = ctx.index.require(firstId).level;
      const secondLevel = ctx.index.require(secondId).level;
      if (firstLevel.id !== secondLevel.id) {
        throw new OperationError('LEVEL_MISMATCH', 'merge_spaces: both spaces must be on the same level.', { op: 'merge_spaces' });
      }

      const beforeFirst = snapshot(first);
      const merged = mergePolygons(first.boundary.map(fromModel), second.boundary.map(fromModel));
      if (!merged.ok) {
        throw new OperationError('MERGE_NOT_POSSIBLE', `merge_spaces: ${merged.reason}`, {
          op: 'merge_spaces',
          hint: 'Both room boundaries must touch along a shared edge with identical coordinates.',
        });
      }

      first.boundary = merged.polygon.map(toModel);
      if (operation.name) first.name = operation.name;
      if (operation.category) first.category = operation.category;
      if (first.area_override_mm2 !== undefined) delete first.area_override_mm2;

      const removed = removeElement(ctx, secondId);
      return {
        summary: `Merged space "${secondId}" into "${firstId}" (${toSquareMetres(spaceAreaMm2(first)).toFixed(2)} m² total).`,
        affected_ids: [firstId, secondId],
        inverse: [
          restoreElementOp(removed.level.id, removed.element, removed.index),
          setElementOp(firstLevel.id, beforeFirst),
        ],
      };
    },
  },
];
