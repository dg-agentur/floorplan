/**
 * Opening operations (doors, windows, passages, generic openings).
 *
 * Reminder on the anchoring convention: offset_mm addresses the CENTRE of the
 * opening, measured from wall.start along the centerline
 * (docs/adr/0005-opening-hosting.md). Every operation here checks that the
 * opening still fits inside its wall before it changes anything.
 */

import { OperationError } from '../../util/errors.js';
import { TOLERANCE_MM } from '../../model/constants.js';
import { ensureCollection } from '../../model/document.js';
import { openingSpan, wallLength } from '../../geometry/wallGeometry.js';
import {
  applyOptionalFields, deleteElementOp, label, removeElement, restoreElementOp, setElementOp, snapshot,
} from '../helpers.js';
import * as F from '../schemaFragments.js';

/** Fields that only make sense for one opening type. */
const TYPE_SPECIFIC_FIELDS = {
  door: ['door_type', 'hinge', 'swing'],
  window: ['window_type', 'sill_mm'],
  passage: ['has_threshold'],
  generic_opening: ['sill_mm'],
};

/**
 * Shared placement check.
 * @param {import('../helpers.js').OperationContext} ctx
 * @param {string} hostWallId
 * @param {number} offsetMm
 * @param {number} widthMm
 * @param {string} op
 * @param {string} [ignoreOpeningId]
 */
function assertFits(ctx, hostWallId, offsetMm, widthMm, op, ignoreOpeningId) {
  const wall = ctx.index.requireWall(hostWallId);
  const length = wallLength(wall);
  const half = widthMm / 2;
  if (widthMm > length) {
    throw new OperationError(
      'OPENING_WIDER_THAN_WALL',
      `${op}: an opening of ${widthMm} mm does not fit into wall "${hostWallId}", which is ${Math.round(length)} mm long.`,
      { op },
    );
  }
  if (offsetMm - half < -TOLERANCE_MM || offsetMm + half > length + TOLERANCE_MM) {
    throw new OperationError(
      'OPENING_OUTSIDE_WALL',
      `${op}: offset ${offsetMm} mm with width ${widthMm} mm spans ${offsetMm - half}..${offsetMm + half} mm, outside wall "${hostWallId}" (0..${Math.round(length)} mm).`,
      {
        op,
        hint: `offset_mm addresses the centre of the opening, so the valid range here is ${Math.ceil(half)}..${Math.floor(length - half)} mm.`,
      },
    );
  }
  for (const other of ctx.index.openingsOf(hostWallId)) {
    if (other.id === ignoreOpeningId) continue;
    const span = openingSpan(other);
    if (offsetMm - half < span.to - TOLERANCE_MM && offsetMm + half > span.from + TOLERANCE_MM) {
      throw new OperationError(
        'OPENING_OVERLAP',
        `${op}: the new position overlaps opening "${other.id}" (${Math.round(span.from)}..${Math.round(span.to)} mm) on wall "${hostWallId}".`,
        { op },
      );
    }
  }
  return { wall, length };
}

/**
 * @param {string} type
 * @param {string} idPrefixType
 * @param {Record<string, object>} extraProperties
 * @param {string[]} extraFields
 * @param {string[]} [requiredExtra]
 * @returns {import('../registry.js').OperationDefinition}
 */
function makeCreateOperation(type, idPrefixType, extraProperties, extraFields, requiredExtra = []) {
  const op = type === 'generic_opening' ? 'create_opening' : `create_${type}`;
  return {
    op,
    category: 'openings',
    summary: `Create a ${type.replace('_', ' ')} in a wall.`,
    description:
      `offset_mm is the distance from wall.start to the CENTRE of the opening, measured along the wall centerline. `
      + `The operation fails if the opening does not fit or overlaps an existing one.`,
    schema: F.operationSchema(op, {
      required: ['host_wall_id', 'offset_mm', 'width_mm', ...requiredExtra],
      properties: {
        id: F.id(),
        name: F.name(),
        host_wall_id: F.id(),
        offset_mm: F.nonNegativeMm(),
        width_mm: F.positiveMm(),
        height_mm: F.positiveMm(),
        connects_space_ids: { type: 'array', minItems: 1, maxItems: 2, items: F.id() },
        ...extraProperties,
        ...F.provenanceProperties(),
      },
    }),
    examples: type === 'door'
      ? [{ op: 'create_door', host_wall_id: 'wall_008', offset_mm: 1840, width_mm: 1010, height_mm: 2010, door_type: 'swing', hinge: 'left', swing: 'left', state: 'new', provenance: 'provided' }]
      : type === 'window'
        ? [{ op: 'create_window', host_wall_id: 'wall_001', offset_mm: 2000, width_mm: 1200, height_mm: 1400, sill_mm: 900, window_type: 'tilt_turn' }]
        : type === 'passage'
          ? [{ op: 'create_passage', host_wall_id: 'wall_004', offset_mm: 1500, width_mm: 1600, height_mm: 2100, state: 'new' }]
          : [{ op: 'create_opening', host_wall_id: 'wall_002', offset_mm: 1200, width_mm: 900, provenance: 'estimated', confidence: 0.6 }],
    apply(ctx, operation) {
      const { wall } = assertFits(ctx, operation.host_wall_id, operation.offset_mm, operation.width_mm, op);
      const level = ctx.index.require(wall.id).level;
      const id = ctx.ids.next(type, operation.id);
      /** @type {any} */
      const opening = {
        id,
        type,
        host_wall_id: operation.host_wall_id,
        offset_mm: operation.offset_mm,
        width_mm: operation.width_mm,
      };
      applyOptionalFields(opening, operation, [
        'name', 'height_mm', 'connects_space_ids', ...extraFields, ...F.PROVENANCE_FIELD_NAMES,
      ]);
      if (type === 'window' && opening.sill_mm === undefined) {
        throw new OperationError('MISSING_PARAMETER', 'create_window: sill_mm is required — the sill height is not something the system may guess.', {
          op,
          hint: 'Provide the measured sill height, or use create_opening if it is genuinely unknown.',
        });
      }
      ensureCollection(level, 'openings').push(opening);
      ctx.reindex();
      return {
        summary: `Created ${type} "${id}" (${operation.width_mm} mm wide) at ${operation.offset_mm} mm on wall "${wall.id}".`,
        affected_ids: [id],
        inverse: [deleteElementOp(id)],
      };
    },
  };
}

/** @type {import('../registry.js').OperationDefinition[]} */
export const openingOperations = [
  makeCreateOperation('door', 'door', {
    door_type: F.doorType(),
    hinge: { enum: ['left', 'right'] },
    swing: { enum: ['left', 'right', 'none'] },
  }, TYPE_SPECIFIC_FIELDS.door, ['door_type']),

  makeCreateOperation('window', 'window', {
    window_type: F.windowType(),
    sill_mm: F.nonNegativeMm(),
  }, TYPE_SPECIFIC_FIELDS.window, ['sill_mm']),

  makeCreateOperation('passage', 'passage', {
    has_threshold: { type: 'boolean' },
  }, TYPE_SPECIFIC_FIELDS.passage),

  makeCreateOperation('generic_opening', 'generic_opening', {
    sill_mm: F.nonNegativeMm(),
  }, TYPE_SPECIFIC_FIELDS.generic_opening),

  {
    op: 'delete_opening',
    category: 'openings',
    summary: 'Remove a door, window or passage.',
    description: 'Works for every opening type. The wall closes up again automatically because openings are gaps in the wall geometry.',
    schema: F.operationSchema('delete_opening', {
      required: ['target_id'],
      properties: { target_id: F.id() },
    }),
    examples: [{ op: 'delete_opening', target_id: 'door_014' }],
    apply(ctx, operation) {
      const opening = ctx.index.requireOpening(operation.target_id);
      const removed = removeElement(ctx, opening.id);
      return {
        summary: `Deleted ${removed.element.type} ${label(removed.element)} from wall "${removed.element.host_wall_id}".`,
        affected_ids: [opening.id],
        inverse: [restoreElementOp(removed.level.id, removed.element, removed.index)],
      };
    },
  },

  {
    op: 'move_opening',
    category: 'openings',
    summary: 'Move an opening along its host wall.',
    description:
      'Provide either offset_delta_mm (relative) or offset_mm (absolute). Positive delta moves towards wall.end. '
      + 'The move is refused if the opening would leave the wall or collide with another opening.',
    schema: F.operationSchema('move_opening', {
      required: ['target_id'],
      properties: {
        target_id: F.id(),
        offset_delta_mm: { type: 'integer', minimum: -1000000, maximum: 1000000 },
        offset_mm: F.nonNegativeMm(),
      },
    }),
    examples: [
      { op: 'move_opening', target_id: 'door_014', offset_delta_mm: 800 },
      { op: 'move_opening', target_id: 'door_014', offset_mm: 2400 },
    ],
    apply(ctx, operation) {
      const opening = ctx.index.requireOpening(operation.target_id);
      const level = ctx.index.require(opening.id).level;
      if (operation.offset_delta_mm === undefined && operation.offset_mm === undefined) {
        throw new OperationError('MISSING_PARAMETER', 'move_opening: provide offset_delta_mm or offset_mm.', { op: 'move_opening' });
      }
      if (operation.offset_delta_mm !== undefined && operation.offset_mm !== undefined) {
        throw new OperationError('CONFLICTING_PARAMETERS', 'move_opening: provide either offset_delta_mm or offset_mm, not both.', { op: 'move_opening' });
      }
      const before = snapshot(opening);
      const target = operation.offset_mm !== undefined
        ? operation.offset_mm
        : opening.offset_mm + operation.offset_delta_mm;

      assertFits(ctx, opening.host_wall_id, target, opening.width_mm, 'move_opening', opening.id);
      opening.offset_mm = target;

      const inverse = operation.offset_delta_mm !== undefined
        ? [{ op: 'move_opening', target_id: opening.id, offset_delta_mm: -operation.offset_delta_mm }]
        : [{ op: 'move_opening', target_id: opening.id, offset_mm: before.offset_mm }];

      return {
        summary: `Moved ${opening.type} "${opening.id}" from ${before.offset_mm} mm to ${target} mm along wall "${opening.host_wall_id}".`,
        affected_ids: [opening.id],
        inverse,
      };
    },
  },

  {
    op: 'resize_opening',
    category: 'openings',
    summary: 'Change the width (and optionally the height) of an opening.',
    description: 'The width changes symmetrically around offset_mm, so the opening does not move.',
    schema: F.operationSchema('resize_opening', {
      required: ['target_id'],
      properties: {
        target_id: F.id(),
        width_mm: F.positiveMm(),
        width_delta_mm: { type: 'integer', minimum: -1000000, maximum: 1000000 },
        height_mm: F.positiveMm(),
        provenance: F.provenance(),
        confidence: F.confidence(),
      },
    }),
    examples: [{ op: 'resize_opening', target_id: 'passage_001', width_mm: 1600 }],
    apply(ctx, operation) {
      const opening = ctx.index.requireOpening(operation.target_id);
      const level = ctx.index.require(opening.id).level;
      const before = snapshot(opening);
      if (operation.width_mm === undefined && operation.width_delta_mm === undefined && operation.height_mm === undefined) {
        throw new OperationError('MISSING_PARAMETER', 'resize_opening: provide width_mm, width_delta_mm or height_mm.', { op: 'resize_opening' });
      }
      const width = operation.width_mm !== undefined
        ? operation.width_mm
        : operation.width_delta_mm !== undefined
          ? opening.width_mm + operation.width_delta_mm
          : opening.width_mm;
      if (width < 1) {
        throw new OperationError('INVALID_WIDTH', `resize_opening: the resulting width would be ${width} mm.`, { op: 'resize_opening' });
      }
      assertFits(ctx, opening.host_wall_id, opening.offset_mm, width, 'resize_opening', opening.id);
      opening.width_mm = width;
      if (operation.height_mm !== undefined) opening.height_mm = operation.height_mm;
      if (operation.provenance) {
        opening.property_provenance = opening.property_provenance ?? {};
        opening.property_provenance.width_mm = {
          provenance: operation.provenance,
          ...(operation.confidence !== undefined ? { confidence: operation.confidence } : {}),
        };
      }
      return {
        summary: `Resized ${opening.type} "${opening.id}" from ${before.width_mm} mm to ${width} mm.`,
        affected_ids: [opening.id],
        inverse: [setElementOp(level.id, before)],
      };
    },
  },

  {
    op: 'convert_opening',
    category: 'openings',
    summary: 'Convert an opening into another type, e.g. a door into an open passage.',
    description:
      'Keeps id, host wall and position. Attributes that do not apply to the new type are dropped, and the '
      + 'attributes required by the new type must be supplied. This is the operation for "remove the door and '
      + 'make it a 1.60 m opening" — it keeps the identity of the opening instead of deleting and recreating it.',
    schema: F.operationSchema('convert_opening', {
      required: ['target_id', 'to_type'],
      properties: {
        target_id: F.id(),
        to_type: { enum: ['door', 'window', 'passage', 'generic_opening'] },
        width_mm: F.positiveMm(),
        height_mm: F.positiveMm(),
        sill_mm: F.nonNegativeMm(),
        door_type: F.doorType(),
        hinge: { enum: ['left', 'right'] },
        swing: { enum: ['left', 'right', 'none'] },
        window_type: F.windowType(),
        has_threshold: { type: 'boolean' },
        state: F.state(),
        provenance: F.provenance(),
        confidence: F.confidence(),
      },
    }),
    examples: [
      { op: 'convert_opening', target_id: 'door_003', to_type: 'passage', width_mm: 1600, height_mm: 2100, state: 'new' },
    ],
    apply(ctx, operation) {
      const opening = ctx.index.requireOpening(operation.target_id);
      const level = ctx.index.require(opening.id).level;
      const before = snapshot(opening);
      const fromType = opening.type;
      if (fromType === operation.to_type && operation.width_mm === undefined) {
        throw new OperationError('NO_OP', `convert_opening: "${opening.id}" is already a ${operation.to_type}.`, { op: 'convert_opening' });
      }

      const width = operation.width_mm ?? opening.width_mm;
      assertFits(ctx, opening.host_wall_id, opening.offset_mm, width, 'convert_opening', opening.id);

      // Drop attributes that belong to the previous type.
      for (const fields of Object.values(TYPE_SPECIFIC_FIELDS)) {
        for (const field of fields) delete (/** @type {any} */ (opening))[field];
      }
      opening.type = operation.to_type;
      opening.width_mm = width;
      for (const field of ['height_mm', 'state', 'provenance', 'confidence',
        ...TYPE_SPECIFIC_FIELDS[/** @type {'door'} */ (operation.to_type)] ?? []]) {
        if (operation[field] !== undefined) (/** @type {any} */ (opening))[field] = operation[field];
      }

      if (operation.to_type === 'door' && opening.door_type === undefined) {
        throw new OperationError('MISSING_PARAMETER', 'convert_opening: converting to a door requires door_type.', { op: 'convert_opening' });
      }
      if (operation.to_type === 'window' && opening.sill_mm === undefined) {
        throw new OperationError('MISSING_PARAMETER', 'convert_opening: converting to a window requires sill_mm.', {
          op: 'convert_opening',
          hint: 'The sill height is a real dimension and is never guessed.',
        });
      }

      return {
        summary: `Converted ${fromType} "${opening.id}" into a ${operation.to_type}${width !== before.width_mm ? ` and resized it to ${width} mm` : ''}.`,
        affected_ids: [opening.id],
        inverse: [setElementOp(level.id, before)],
      };
    },
  },
];
