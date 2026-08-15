/**
 * Provenance resolution.
 *
 * Decision (docs/adr/0008-provenance.md): provenance lives on the element with an
 * optional per property override, never as a wrapper around every number.
 *
 * Resolution order:
 *   element.property_provenance[prop] -> element -> project.defaults -> "unknown"
 */

import { DEFAULT_PROVENANCE, RELIABLE_PROVENANCE } from './constants.js';

/** @typedef {import('./types.js').FloorplanDocument} FloorplanDocument */
/** @typedef {import('./types.js').Provenance} Provenance */

/**
 * @typedef {object} ResolvedProvenance
 * @property {Provenance} provenance
 * @property {number} [confidence]
 * @property {boolean} verified
 * @property {string} [source_id]
 * @property {'property'|'element'|'defaults'|'fallback'} origin where the value came from
 */

/**
 * @param {FloorplanDocument} doc
 * @param {any} element
 * @param {string} [property] when omitted, the element level provenance is returned
 * @returns {ResolvedProvenance}
 */
export function resolveProvenance(doc, element, property) {
  if (property && element?.property_provenance?.[property]) {
    const p = element.property_provenance[property];
    return {
      provenance: p.provenance,
      confidence: p.confidence,
      verified: p.verified ?? false,
      source_id: p.source_id ?? element.source_id,
      origin: 'property',
    };
  }
  if (element?.provenance) {
    return {
      provenance: element.provenance,
      confidence: element.confidence,
      verified: element.verified ?? false,
      source_id: element.source_id,
      origin: 'element',
    };
  }
  const fallback = doc?.project?.defaults?.provenance;
  if (fallback) {
    return { provenance: fallback, verified: false, source_id: element?.source_id, origin: 'defaults' };
  }
  return { provenance: DEFAULT_PROVENANCE, verified: false, source_id: element?.source_id, origin: 'fallback' };
}

/**
 * A value is dimensionally reliable when it was provided, measured or parsed
 * from a dimensioned source. Derived values inherit reliability from their inputs
 * and are therefore treated as reliable only when explicitly verified.
 * @param {ResolvedProvenance|Provenance} value
 * @returns {boolean}
 */
export function isReliable(value) {
  const resolved = typeof value === 'string' ? { provenance: value, verified: false } : value;
  if (/** @type {readonly string[]} */ (RELIABLE_PROVENANCE).includes(resolved.provenance)) return true;
  if (resolved.provenance === 'derived') return resolved.verified === true;
  return false;
}

/**
 * Properties whose provenance actually matters per element type. Used by the
 * validator and by `inspect --section provenance`. Cosmetic fields are excluded
 * on purpose: nobody needs to know where a room name came from.
 */
export const DIMENSIONAL_PROPERTIES = /** @type {Record<string, string[]>} */ ({
  wall: ['start', 'end', 'thickness_mm', 'height_mm'],
  door: ['offset_mm', 'width_mm', 'height_mm'],
  window: ['offset_mm', 'width_mm', 'height_mm', 'sill_mm'],
  passage: ['offset_mm', 'width_mm', 'height_mm'],
  generic_opening: ['offset_mm', 'width_mm', 'height_mm'],
  space: ['boundary', 'area_override_mm2', 'height_mm'],
  column: ['center', 'width_mm', 'depth_mm', 'diameter_mm'],
  stair: ['footprint', 'run_start', 'run_end', 'rise_mm', 'run_mm'],
  shaft: ['boundary'],
  dimension: ['start', 'end'],
});

/**
 * Every dimensional property of an element together with its resolved provenance.
 * Only properties that are actually present on the element are reported — the
 * system never claims provenance for a value it does not have.
 * @param {FloorplanDocument} doc
 * @param {any} element
 * @returns {Array<{property: string, resolved: ResolvedProvenance}>}
 */
export function elementProvenance(doc, element) {
  const properties = DIMENSIONAL_PROPERTIES[element.type] ?? [];
  return properties
    .filter((prop) => element[prop] !== undefined)
    .map((prop) => ({ property: prop, resolved: resolveProvenance(doc, element, prop) }));
}
