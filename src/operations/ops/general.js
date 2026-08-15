/**
 * Cross cutting operations: construction state, provenance, safe attributes.
 */

import { OperationError } from '../../util/errors.js';
import { getSchemaValidator } from '../../model/io.js';
import { PROVENANCE_VALUES, STATES } from '../../model/constants.js';
import { label, setElementOp, snapshot } from '../helpers.js';
import * as F from '../schemaFragments.js';

/**
 * Attributes that may be written through set_attribute.
 *
 * Deliberately excluded: everything that defines geometry (start, end,
 * thickness_mm, offset_mm of an opening, width_mm, boundary, footprint, center,
 * host_wall_id). Those are only reachable through their dedicated operations,
 * which carry the domain checks (docs/adr/0009-operations-and-history.md).
 */
export const SETTABLE_ATTRIBUTES = /** @type {Record<string, string[]>} */ ({
  wall: ['name', 'material', 'height_mm', 'base_z_mm', 'classification', 'tags'],
  door: ['name', 'height_mm', 'door_type', 'hinge', 'swing', 'connects_space_ids', 'tags'],
  window: ['name', 'height_mm', 'sill_mm', 'window_type', 'connects_space_ids', 'tags'],
  passage: ['name', 'height_mm', 'has_threshold', 'connects_space_ids', 'tags'],
  generic_opening: ['name', 'height_mm', 'sill_mm', 'connects_space_ids', 'tags'],
  space: ['name', 'category', 'height_mm', 'area_override_mm2', 'label_anchor', 'tags'],
  column: ['name', 'height_mm', 'rotation_deg', 'tags'],
  stair: ['name', 'step_count', 'rise_mm', 'run_mm', 'direction', 'to_level_id', 'tags'],
  shaft: ['name', 'shaft_kind', 'tags'],
  dimension: ['label_override', 'offset_mm', 'tags'],
  annotation: ['text', 'annotation_kind', 'rotation_deg', 'tags'],
});

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

/** @type {import('../registry.js').OperationDefinition[]} */
export const generalOperations = [
  {
    op: 'set_state',
    category: 'general',
    summary: 'Set the construction state of one or more elements.',
    description:
      'existing / planned / new / demolish / unknown. This is how a renovation is modelled: existing stock, '
      + 'demolition and new construction live in ONE document (docs/object-model.md).',
    schema: F.operationSchema('set_state', {
      required: ['state'],
      properties: {
        target_id: F.id(),
        target_ids: { type: 'array', minItems: 1, items: F.id() },
        state: { enum: [...STATES] },
      },
    }),
    examples: [
      { op: 'set_state', target_id: 'wall_002', state: 'demolish' },
      { op: 'set_state', target_ids: ['wall_010', 'door_004'], state: 'new' },
    ],
    apply(ctx, operation) {
      const targets = operation.target_ids ?? (operation.target_id ? [operation.target_id] : []);
      if (targets.length === 0) {
        throw new OperationError('MISSING_PARAMETER', 'set_state: provide target_id or target_ids.', { op: 'set_state' });
      }
      /** @type {Record<string, unknown>[]} */
      const inverse = [];
      /** @type {string[]} */
      const affected = [];
      /** @type {string[]} */
      const descriptions = [];

      for (const targetId of targets) {
        const ref = ctx.index.require(targetId);
        const element = /** @type {any} */ (ref.element);
        if (element.type === 'annotation' || element.type === 'dimension') {
          throw new OperationError('STATE_NOT_APPLICABLE', `set_state: ${element.type} "${targetId}" has no construction state.`, { op: 'set_state' });
        }
        const before = snapshot(element);
        inverse.push(setElementOp(ref.level.id, before));
        element.state = operation.state;
        affected.push(targetId);
        descriptions.push(`${element.type} "${targetId}": ${before.state ?? '(default)'} -> ${operation.state}`);
      }

      return {
        summary: `Set state to "${operation.state}" for ${affected.length} element(s) — ${descriptions.join('; ')}.`,
        affected_ids: affected,
        inverse,
      };
    },
  },

  {
    op: 'set_provenance',
    category: 'general',
    summary: 'Record where a value comes from and how sure we are.',
    description:
      'Without `property` the provenance applies to the whole element; with `property` it applies to that one '
      + 'value. Downgrading a doubtful value to "estimated" is the correct move — deleting the value is not '
      + '(docs/adr/0008-provenance.md).',
    schema: F.operationSchema('set_provenance', {
      required: ['target_id', 'provenance'],
      properties: {
        target_id: F.id(),
        property: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
        provenance: { enum: [...PROVENANCE_VALUES] },
        confidence: F.confidence(),
        verified: { type: 'boolean' },
        source_id: F.id(),
        note: { type: 'string', maxLength: 500 },
      },
    }),
    examples: [
      { op: 'set_provenance', target_id: 'wall_003', property: 'thickness_mm', provenance: 'estimated', confidence: 0.6 },
      { op: 'set_provenance', target_id: 'door_014', provenance: 'measured', verified: true },
    ],
    apply(ctx, operation) {
      const ref = ctx.index.require(operation.target_id);
      const element = /** @type {any} */ (ref.element);
      const before = snapshot(element);

      if (operation.property) {
        if (!(operation.property in element)) {
          throw new OperationError(
            'UNKNOWN_PROPERTY',
            `set_provenance: element "${operation.target_id}" has no property "${operation.property}".`,
            { op: 'set_provenance', hint: 'Provenance can only be recorded for a value that exists.' },
          );
        }
        element.property_provenance = element.property_provenance ?? {};
        /** @type {any} */
        const entry = { provenance: operation.provenance };
        for (const field of ['confidence', 'verified', 'source_id', 'note']) {
          if (operation[field] !== undefined) entry[field] = operation[field];
        }
        element.property_provenance[operation.property] = entry;
      } else {
        element.provenance = operation.provenance;
        for (const field of ['confidence', 'verified', 'source_id']) {
          if (operation[field] !== undefined) element[field] = operation[field];
        }
      }

      return {
        summary: operation.property
          ? `Provenance of "${operation.property}" on ${label(element)} set to "${operation.provenance}".`
          : `Provenance of ${label(element)} set to "${operation.provenance}".`,
        affected_ids: [operation.target_id],
        inverse: [setElementOp(ref.level.id, before)],
      };
    },
  },

  {
    op: 'set_attribute',
    category: 'general',
    summary: 'Set a non geometric attribute of an element.',
    description:
      'Only attributes from an allow list per element type can be written. Geometry defining fields are not '
      + 'reachable this way — use the dedicated operation instead. `floorplan ops describe set_attribute --json` '
      + 'lists the allowed attributes.',
    schema: F.operationSchema('set_attribute', {
      required: ['target_id', 'attribute'],
      properties: {
        target_id: F.id(),
        attribute: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
        value: {},
      },
    }),
    examples: [
      { op: 'set_attribute', target_id: 'wall_001', attribute: 'material', value: 'Kalksandstein' },
      { op: 'set_attribute', target_id: 'space_bath', attribute: 'height_mm', value: 2400 },
    ],
    apply(ctx, operation) {
      const ref = ctx.index.require(operation.target_id);
      const element = /** @type {any} */ (ref.element);
      const allowed = SETTABLE_ATTRIBUTES[element.type] ?? [];
      if (!allowed.includes(operation.attribute)) {
        throw new OperationError(
          'ATTRIBUTE_NOT_SETTABLE',
          `set_attribute: "${operation.attribute}" cannot be set on a ${element.type}.`,
          {
            op: 'set_attribute',
            hint: `Allowed for ${element.type}: ${allowed.join(', ') || '(none)'}. Geometry is changed through dedicated operations.`,
          },
        );
      }
      const before = snapshot(element);
      if (operation.value === null) {
        delete element[operation.attribute];
      } else {
        element[operation.attribute] = operation.value;
      }

      const errors = getSchemaValidator('floorplan').validateSubschema(TYPE_TO_SCHEMA_REF[element.type], element);
      if (errors.length > 0) {
        throw new OperationError(
          'INVALID_ATTRIBUTE_VALUE',
          `set_attribute: the resulting element is invalid — ${errors[0].message}.`,
          { op: 'set_attribute', details: errors.slice(0, 5) },
        );
      }

      return {
        summary: `Set ${operation.attribute} of ${label(element)} to ${JSON.stringify(operation.value)}.`,
        affected_ids: [operation.target_id],
        inverse: [setElementOp(ref.level.id, before)],
      };
    },
  },
];
