/**
 * Structural operations: raw element manipulation, levels, document level settings.
 *
 * set_element / restore_element / delete_element are the universal inverses used
 * by the higher level operations. They are also available directly, but an agent
 * should prefer a specific operation whenever one exists — those carry the
 * domain checks (docs/agent-contract.md).
 */

import { getSchemaValidator } from '../../model/io.js';
import { validateDocument } from '../../validation/validate.js';
import { OperationError } from '../../util/errors.js';
import { collectionForType, ensureCollection, listLevels } from '../../model/document.js';
import { QUALITY_LEVELS } from '../../model/constants.js';
import {
  deleteElementOp, insertElement, label, removeElement, restoreElementOp, setElementOp, snapshot,
} from '../helpers.js';
import * as F from '../schemaFragments.js';

/** Map an element type to its definition inside the floorplan schema. */
const TYPE_TO_SCHEMA_REF = /** @type {Record<string, string>} */ ({
  wall: '#/$defs/wall',
  door: '#/$defs/opening',
  window: '#/$defs/opening',
  passage: '#/$defs/opening',
  generic_opening: '#/$defs/opening',
  space: '#/$defs/space',
  column: '#/$defs/column',
  stair: '#/$defs/stair',
  shaft: '#/$defs/shaft',
  dimension: '#/$defs/dimension',
  annotation: '#/$defs/annotation',
});

/**
 * Validate a raw element against the canonical schema before it enters the model.
 * @param {any} element
 * @param {string} op
 */
function assertValidElement(element, op) {
  if (!element || typeof element !== 'object' || typeof element.type !== 'string') {
    throw new OperationError('INVALID_ELEMENT', `${op}: "element" must be an object with a "type".`, { op });
  }
  const ref = TYPE_TO_SCHEMA_REF[element.type];
  if (!ref) {
    throw new OperationError('UNKNOWN_ELEMENT_TYPE', `${op}: unknown element type "${element.type}".`, { op });
  }
  const errors = getSchemaValidator('floorplan').validateSubschema(ref, element);
  if (errors.length > 0) {
    throw new OperationError(
      'INVALID_ELEMENT',
      `${op}: element "${element.id ?? '?'}" does not match the schema: ${errors[0].message}`,
      { op, details: errors.slice(0, 10) },
    );
  }
}

/** @type {import('../registry.js').OperationDefinition[]} */
export const structureOperations = [
  {
    op: 'set_element',
    category: 'structure',
    summary: 'Replace an existing element with a complete new version.',
    description:
      'Low level operation. Replaces the element with the same id, keeping its position in its collection. '
      + 'Used as the exact inverse of geometry changing operations. Prefer a specific operation when one exists.',
    schema: F.operationSchema('set_element', {
      required: ['level_id', 'element'],
      properties: {
        level_id: F.id(),
        element: { type: 'object' },
      },
    }),
    examples: [
      { op: 'set_element', level_id: 'level_eg', element: { id: 'wall_001', type: 'wall', start: { x_mm: 0, y_mm: 0 }, end: { x_mm: 4000, y_mm: 0 }, thickness_mm: 300 } },
    ],
    apply(ctx, operation) {
      assertValidElement(operation.element, 'set_element');
      const ref = ctx.index.require(operation.element.id);
      if (ref.level.id !== operation.level_id) {
        throw new OperationError('LEVEL_MISMATCH', `set_element: element "${operation.element.id}" is on level "${ref.level.id}", not "${operation.level_id}".`, { op: 'set_element' });
      }
      const collection = collectionForType(operation.element.type);
      if (collection !== ref.collection) {
        throw new OperationError('TYPE_CHANGE_NOT_ALLOWED', `set_element cannot move element "${operation.element.id}" from ${ref.collection} to ${collection}.`, { op: 'set_element' });
      }
      const list = /** @type {any[]} */ (/** @type {any} */ (ref.level)[ref.collection]);
      const index = list.findIndex((item) => item.id === operation.element.id);
      const before = snapshot(list[index]);
      list[index] = snapshot(operation.element);
      ctx.reindex();
      return {
        summary: `Replaced ${operation.element.type} ${label(operation.element)}.`,
        affected_ids: [operation.element.id],
        inverse: [setElementOp(ref.level.id, before)],
      };
    },
  },

  {
    op: 'restore_element',
    category: 'structure',
    summary: 'Insert a previously removed element back into a level.',
    description: 'Low level operation, used as the inverse of delete operations. Fails if the id already exists.',
    schema: F.operationSchema('restore_element', {
      required: ['level_id', 'element'],
      properties: {
        level_id: F.id(),
        element: { type: 'object' },
        at_index: { type: 'integer', minimum: 0 },
      },
    }),
    examples: [],
    apply(ctx, operation) {
      assertValidElement(operation.element, 'restore_element');
      if (ctx.index.has(operation.element.id)) {
        throw new OperationError('ID_ALREADY_IN_USE', `restore_element: the id "${operation.element.id}" already exists.`, { op: 'restore_element' });
      }
      const level = ctx.index.requireLevel(operation.level_id);
      insertElement(level, snapshot(operation.element), operation.at_index);
      ctx.ids.taken.add(operation.element.id);
      ctx.reindex();
      return {
        summary: `Restored ${operation.element.type} ${label(operation.element)} on level "${level.id}".`,
        affected_ids: [operation.element.id],
        inverse: [deleteElementOp(operation.element.id)],
      };
    },
  },

  {
    op: 'delete_element',
    category: 'structure',
    summary: 'Remove any element by id.',
    description:
      'Low level operation. Does NOT cascade: deleting a wall that still hosts openings is refused. '
      + 'Use delete_wall for the cascading variant.',
    schema: F.operationSchema('delete_element', {
      required: ['target_id'],
      properties: { target_id: F.id() },
    }),
    examples: [{ op: 'delete_element', target_id: 'note_001' }],
    apply(ctx, operation) {
      const ref = ctx.index.require(operation.target_id);
      if (ref.element.type === 'wall') {
        const hosted = ctx.index.openingsOf(operation.target_id);
        if (hosted.length > 0) {
          throw new OperationError(
            'WALL_STILL_HOSTS_OPENINGS',
            `delete_element: wall "${operation.target_id}" still hosts ${hosted.length} opening(s): ${hosted.map((o) => o.id).join(', ')}.`,
            { op: 'delete_element', hint: 'Use delete_wall, which removes the hosted openings as well.' },
          );
        }
      }
      const removed = removeElement(ctx, operation.target_id);
      return {
        summary: `Deleted ${removed.element.type} ${label(removed.element)}.`,
        affected_ids: [operation.target_id],
        inverse: [restoreElementOp(removed.level.id, removed.element, removed.index)],
      };
    },
  },

  {
    op: 'create_level',
    category: 'structure',
    summary: 'Add a level to a building.',
    description: 'Creates an empty level. The building defaults to the first building in the document.',
    schema: F.operationSchema('create_level', {
      required: ['name', 'index', 'elevation_mm'],
      properties: {
        id: F.id(),
        building_id: F.id(),
        name: F.name(),
        index: { type: 'integer', minimum: -20, maximum: 200 },
        elevation_mm: { type: 'integer', minimum: -100000, maximum: 1000000 },
        height_mm: F.positiveMm(),
      },
    }),
    examples: [{ op: 'create_level', name: 'Upper floor', index: 1, elevation_mm: 2900, height_mm: 2500 }],
    apply(ctx, operation) {
      const building = operation.building_id
        ? ctx.index.buildings.get(operation.building_id)
        : ctx.doc.buildings?.[0];
      if (!building) {
        throw new OperationError('UNKNOWN_BUILDING', `create_level: no building "${operation.building_id ?? '(first)'}".`, { op: 'create_level' });
      }
      const id = ctx.ids.next('level', operation.id);
      /** @type {any} */
      const level = { id, name: operation.name, index: operation.index, elevation_mm: operation.elevation_mm };
      if (operation.height_mm !== undefined) level.height_mm = operation.height_mm;
      building.levels.push(level);
      ctx.reindex();
      return {
        summary: `Created level "${id}" ("${operation.name}") in building "${building.id}".`,
        affected_ids: [id],
        inverse: [{ op: 'delete_level', target_id: id }],
      };
    },
  },

  {
    op: 'delete_level',
    category: 'structure',
    summary: 'Remove an empty level.',
    description: 'Refuses to delete a level that still contains elements, and refuses to delete the last level.',
    schema: F.operationSchema('delete_level', {
      required: ['target_id'],
      properties: { target_id: F.id() },
    }),
    examples: [],
    apply(ctx, operation) {
      const entry = ctx.index.levels.get(operation.target_id);
      if (!entry) {
        throw new OperationError('UNKNOWN_LEVEL', `delete_level: no level "${operation.target_id}".`, { op: 'delete_level' });
      }
      const { level, building } = entry;
      const elementCount = ['walls', 'openings', 'spaces', 'columns', 'stairs', 'shafts', 'dimensions', 'annotations']
        .reduce((sum, collection) => sum + (/** @type {any} */ (level)[collection]?.length ?? 0), 0);
      if (elementCount > 0) {
        throw new OperationError('LEVEL_NOT_EMPTY', `delete_level: level "${level.id}" still contains ${elementCount} element(s).`, { op: 'delete_level' });
      }
      if (listLevels(ctx.doc).length === 1) {
        throw new OperationError('LAST_LEVEL', 'delete_level: a document must keep at least one level.', { op: 'delete_level' });
      }
      const index = building.levels.findIndex((l) => l.id === level.id);
      const [removed] = building.levels.splice(index, 1);
      ctx.reindex();
      return {
        summary: `Deleted level "${removed.id}".`,
        affected_ids: [removed.id],
        inverse: [{
          op: 'create_level',
          id: removed.id,
          building_id: building.id,
          name: removed.name,
          index: removed.index,
          elevation_mm: removed.elevation_mm,
          ...(removed.height_mm !== undefined ? { height_mm: removed.height_mm } : {}),
        }],
      };
    },
  },

  {
    op: 'set_project_quality',
    category: 'structure',
    summary: 'Change the quality level of the document.',
    description:
      'Raising the quality level is only allowed if the document actually validates without errors at the target '
      + 'level. A quality level is a proven property, not a claim (docs/adr/0015-quality-levels.md).',
    schema: F.operationSchema('set_project_quality', {
      required: ['quality'],
      properties: {
        quality: { enum: [...QUALITY_LEVELS] },
        force: { type: 'boolean' },
      },
    }),
    examples: [{ op: 'set_project_quality', quality: 'scaled' }],
    apply(ctx, operation) {
      const before = ctx.doc.project.quality;
      const targetRank = QUALITY_LEVELS.indexOf(operation.quality);
      const currentRank = QUALITY_LEVELS.indexOf(before);
      ctx.doc.project.quality = operation.quality;
      if (targetRank > currentRank && operation.force !== true) {
        const report = validateDocument(ctx.doc, { quality: operation.quality });
        if (!report.ok) {
          ctx.doc.project.quality = before;
          throw new OperationError(
            'QUALITY_NOT_REACHED',
            `set_project_quality: the document does not validate at level "${operation.quality}" (${report.counts.ERROR} error(s)).`,
            {
              op: 'set_project_quality',
              details: report.issues.filter((i) => i.severity === 'ERROR').slice(0, 5),
              hint: 'Run `floorplan validate <file> --quality ' + operation.quality + '` to see what is missing.',
            },
          );
        }
      }
      return {
        summary: `Project quality changed from "${before}" to "${operation.quality}".`,
        affected_ids: [ctx.doc.project.id],
        inverse: [{ op: 'set_project_quality', quality: before, force: true }],
      };
    },
  },

  {
    op: 'add_annotation',
    category: 'structure',
    summary: 'Add a free text annotation at a position.',
    description: 'Annotations are drawing notes. They never influence geometry or validation.',
    schema: F.operationSchema('add_annotation', {
      required: ['position', 'text'],
      properties: {
        id: F.id(),
        level_id: F.id(),
        position: F.point(),
        text: { type: 'string', minLength: 1, maxLength: 500 },
        annotation_kind: { enum: ['note', 'label', 'room_tag', 'north_arrow', 'scale_bar', 'title'] },
        rotation_deg: { type: 'number', minimum: -360, maximum: 360 },
      },
    }),
    examples: [{ op: 'add_annotation', position: { x_mm: 1000, y_mm: 1000 }, text: 'Bestand, Aufmaß 2026-03-04' }],
    apply(ctx, operation) {
      const level = operation.level_id ? ctx.index.requireLevel(operation.level_id) : ctx.defaultLevel();
      const id = ctx.ids.next('annotation', operation.id);
      /** @type {any} */
      const annotation = { id, type: 'annotation', position: operation.position, text: operation.text };
      if (operation.annotation_kind) annotation.annotation_kind = operation.annotation_kind;
      if (operation.rotation_deg !== undefined) annotation.rotation_deg = operation.rotation_deg;
      ensureCollection(level, 'annotations').push(annotation);
      ctx.reindex();
      return {
        summary: `Added annotation "${id}" on level "${level.id}".`,
        affected_ids: [id],
        inverse: [deleteElementOp(id)],
      };
    },
  },

  {
    op: 'add_dimension',
    category: 'structure',
    summary: 'Add a dimension line between two points.',
    description: 'The measured value is always derived from the two points and is never stored separately.',
    schema: F.operationSchema('add_dimension', {
      required: ['start', 'end'],
      properties: {
        id: F.id(),
        level_id: F.id(),
        start: F.point(),
        end: F.point(),
        offset_mm: { type: 'integer', minimum: -100000, maximum: 100000 },
        label_override: { type: 'string', maxLength: 100 },
        provenance: F.provenance(),
        confidence: F.confidence(),
        source_id: F.id(),
      },
    }),
    examples: [{ op: 'add_dimension', start: { x_mm: 0, y_mm: -400 }, end: { x_mm: 4500, y_mm: -400 }, offset_mm: 0 }],
    apply(ctx, operation) {
      const level = operation.level_id ? ctx.index.requireLevel(operation.level_id) : ctx.defaultLevel();
      const id = ctx.ids.next('dimension', operation.id);
      /** @type {any} */
      const dimension = { id, type: 'dimension', start: operation.start, end: operation.end };
      for (const field of ['offset_mm', 'label_override', 'provenance', 'confidence', 'source_id']) {
        if (operation[field] !== undefined) dimension[field] = operation[field];
      }
      ensureCollection(level, 'dimensions').push(dimension);
      ctx.reindex();
      return {
        summary: `Added dimension "${id}" on level "${level.id}".`,
        affected_ids: [id],
        inverse: [deleteElementOp(id)],
      };
    },
  },
];
