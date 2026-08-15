/**
 * Shared, precomputed context for the semantic rules.
 *
 * Built once per validation run so that expensive derivations (wall geometry,
 * connectivity graph) happen a single time and every rule sees exactly the same
 * picture of the document.
 */

import { indexDocument, listLevels } from '../model/document.js';
import { buildWallGeometry } from '../geometry/wallGeometry.js';
import { buildConnectivityGraph } from '../topology/connectivity.js';

/** @typedef {import('../model/types.js').FloorplanDocument} FloorplanDocument */

/**
 * @typedef {object} Finding
 * @property {string} rule
 * @property {string} message
 * @property {string} [element_id]
 * @property {string} [level_id]
 * @property {string} [pointer]
 * @property {Record<string, unknown>} [data]
 * @property {string} [hint]
 */

/**
 * @typedef {object} LevelContext
 * @property {import('../model/types.js').Building} building
 * @property {import('../model/types.js').Level} level
 * @property {Map<string, import('../model/types.js').Wall>} wallsById
 * @property {Map<string, import('../geometry/wallGeometry.js').WallGeometry>} wallGeometry
 * @property {import('../topology/connectivity.js').ConnectivityGraph} graph
 */

/**
 * @typedef {object} ValidationContext
 * @property {FloorplanDocument} doc
 * @property {import('../model/document.js').DocumentIndex} index
 * @property {string} quality
 * @property {LevelContext[]} levels
 * @property {(finding: Finding) => void} report
 * @property {Finding[]} findings
 */

/**
 * @param {FloorplanDocument} doc
 * @param {string} quality
 * @returns {ValidationContext}
 */
export function buildValidationContext(doc, quality) {
  const index = indexDocument(doc);
  /** @type {Finding[]} */
  const findings = [];

  /** @type {LevelContext[]} */
  const levels = listLevels(doc).map(({ level, building }) => {
    const walls = level.walls ?? [];
    const wallsById = new Map(walls.map((w) => [w.id, w]));
    /** @type {Map<string, import('../model/types.js').Opening[]>} */
    const openingsByWall = new Map();
    for (const opening of level.openings ?? []) {
      const list = openingsByWall.get(opening.host_wall_id);
      if (list) list.push(opening);
      else openingsByWall.set(opening.host_wall_id, [opening]);
    }
    return {
      building,
      level,
      wallsById,
      wallGeometry: buildWallGeometry(walls, openingsByWall),
      graph: buildConnectivityGraph(doc, level),
    };
  });

  return {
    doc,
    index,
    quality,
    levels,
    findings,
    report(finding) {
      findings.push(finding);
    },
  };
}
