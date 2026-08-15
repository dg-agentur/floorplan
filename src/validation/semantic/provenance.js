/**
 * Provenance rules — the mechanism behind "the system does not invent dimensions".
 *
 * These rules are informational for a marketing plan and fatal for a verified
 * one. That difference is what makes a quality level a claim that can be
 * checked instead of a label somebody typed (docs/adr/0015-quality-levels.md).
 */

import { levelElements } from '../../model/document.js';
import { elementProvenance, isReliable } from '../../model/provenance.js';

/** @typedef {import('../context.js').ValidationContext} ValidationContext */

/** Report at most this many individual elements per rule before summarising. */
const DETAIL_LIMIT = 12;

/**
 * @param {ValidationContext} ctx
 */
export function checkProvenance(ctx) {
  /** @type {Array<{element_id: string, level_id: string, property: string, provenance: string, confidence?: number}>} */
  const estimated = [];
  /** @type {Array<{element_id: string, level_id: string, property: string}>} */
  const unknown = [];
  /** @type {Array<{element_id: string, level_id: string, property: string}>} */
  const unverified = [];
  let reliableCount = 0;
  let anchoredElements = 0;

  for (const { level } of ctx.levels) {
    for (const element of levelElements(level)) {
      // A dimension annotation is a label about the drawing; a wall, opening or
      // space is the drawing. Both count as "a reliable value exists", but only
      // the latter anchors the geometry itself.
      const isBuildingElement = element.type !== 'dimension' && element.type !== 'annotation';
      let elementAnchored = false;
      for (const { property, resolved } of elementProvenance(ctx.doc, element)) {
        if (resolved.provenance === 'unknown') {
          unknown.push({ element_id: element.id, level_id: level.id, property });
        } else if (resolved.provenance === 'estimated' || (resolved.provenance === 'derived' && !resolved.verified)) {
          estimated.push({
            element_id: element.id,
            level_id: level.id,
            property,
            provenance: resolved.provenance,
            confidence: resolved.confidence,
          });
        } else if (isReliable(resolved)) {
          reliableCount += 1;
          if (isBuildingElement) elementAnchored = true;
          if (!resolved.verified) {
            unverified.push({ element_id: element.id, level_id: level.id, property });
          }
        }
      }
      if (elementAnchored) anchoredElements += 1;
    }
  }

  emit(ctx, 'PROVENANCE_ESTIMATED', estimated, (entry) =>
    `Dimension "${entry.property}" of element "${entry.element_id}" is ${entry.provenance}${entry.confidence !== undefined ? ` (confidence ${entry.confidence})` : ''}, not measured.`);

  emit(ctx, 'PROVENANCE_UNKNOWN', unknown, (entry) =>
    `The origin of "${entry.property}" on element "${entry.element_id}" is unknown.`);

  // Aggregated on purpose: "not explicitly confirmed" is a property of the
  // document as a whole, and a per-value list would bury the actionable findings.
  if (unverified.length > 0) {
    const elements = [...new Set(unverified.map((entry) => entry.element_id))].sort();
    ctx.report({
      rule: 'UNVERIFIED_VALUES',
      message: `${unverified.length} reliable dimension(s) on ${elements.length} element(s) are not marked as verified.`,
      data: { count: unverified.length, element_ids: elements.slice(0, 50) },
      hint: 'Set verified: true (operation set_provenance) once a human has confirmed the values.',
    });
  }

  if (reliableCount === 0) {
    ctx.report({
      rule: 'MISSING_SCALE_REFERENCE',
      message: 'The document contains no dimension with provenance "provided", "measured" or "parsed". Nothing anchors the drawing to reality.',
      hint: 'Add at least one known dimension (a measured wall, a parsed dimension string) and mark its provenance accordingly.',
    });
  } else if (anchoredElements === 0) {
    ctx.report({
      rule: 'GEOMETRY_NOT_ANCHORED',
      message: 'Every wall, opening and space in this document carries estimated or unknown dimensions. Only annotations are reliable, so the geometry itself rests on nothing.',
      hint: 'Confirm at least one building dimension (set_provenance with "measured" or "parsed") before claiming quality level "scaled".',
    });
  }
}

/**
 * Emit findings with a cap, so a fully estimated reconstruction produces a
 * readable report instead of 400 identical lines.
 * @template T
 * @param {ValidationContext} ctx
 * @param {string} rule
 * @param {Array<T & {element_id: string, level_id: string, property: string}>} entries
 * @param {(entry: T & {element_id: string, level_id: string, property: string}) => string} format
 */
function emit(ctx, rule, entries, format) {
  const sorted = [...entries].sort((a, b) =>
    (a.element_id < b.element_id ? -1 : a.element_id > b.element_id ? 1 : a.property < b.property ? -1 : 1));
  for (const entry of sorted.slice(0, DETAIL_LIMIT)) {
    ctx.report({
      rule,
      element_id: entry.element_id,
      level_id: entry.level_id,
      message: format(entry),
      data: { property: entry.property },
    });
  }
  if (sorted.length > DETAIL_LIMIT) {
    ctx.report({
      rule,
      message: `... and ${sorted.length - DETAIL_LIMIT} further value(s) with the same issue (${sorted.length} in total).`,
      data: { total: sorted.length, shown: DETAIL_LIMIT },
    });
  }
}
