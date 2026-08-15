/**
 * Observation reconciliation: hypotheses -> canonical model.
 *
 * Rule based and deterministic — there is no AI in here (docs/adr/0014-observation-layer.md).
 * Whatever interpreter produced the observations, the same input always yields
 * the same model, and every observation that could not be used is reported with
 * a reason. Nothing is dropped silently and nothing is invented:
 *
 *  - a wall observation without a thickness is rejected unless the caller
 *    explicitly supplies a default thickness, which is then recorded as
 *    `estimated`
 *  - `measured` and `provided` are never accepted from an interpreter; the
 *    strongest provenance an observation can claim is `parsed`
 *  - without a reliable calibration the resulting document stays at quality
 *    level `marketing`
 */

import { SCHEMA_VERSION } from '../../model/constants.js';
import { getSchemaValidator } from '../../model/io.js';
import { FloorplanError } from '../../util/errors.js';
import { distance, fromModel, roundMm, toModel } from '../../geometry/vec.js';
import { areCollinear, projectPoint, segmentLength } from '../../geometry/segment.js';
import { area as polygonArea, normalizeOrientation } from '../../geometry/polygon.js';
import { validateDocument } from '../../validation/validate.js';

/** @typedef {import('../../geometry/vec.js').Vec} Vec */

/**
 * @typedef {object} ReconcileOptions
 * @property {number} [minConfidence]        default 0.5
 * @property {number} [snapMm]               grid for coordinate snapping, default 10
 * @property {number} [maxHostDistanceMm]    how far an opening may sit from a wall axis, default 400
 * @property {number} [defaultThicknessMm]   explicit fallback for walls without a thickness
 * @property {string} [projectName]
 * @property {string} [projectId]
 */

/**
 * @typedef {object} ReconcileEntry
 * @property {string} observation_id
 * @property {'accepted'|'merged'|'rejected'} status
 * @property {string} [element_id]
 * @property {string} [reason]
 */

/**
 * @typedef {object} ReconcileResult
 * @property {import('../../model/types.js').FloorplanDocument} document
 * @property {{source: object, counts: Record<string, number>, entries: ReconcileEntry[],
 *   assumptions: string[], quality: string, quality_reason: string}} report
 */

/**
 * @param {unknown} observationSet
 * @param {ReconcileOptions} [options]
 * @returns {ReconcileResult}
 */
export function reconcileObservations(observationSet, options = {}) {
  const schemaErrors = getSchemaValidator('observations').validate(observationSet);
  if (schemaErrors.length > 0) {
    throw new FloorplanError('INVALID_OBSERVATIONS', `Observation set is invalid: ${schemaErrors[0].message}`, {
      details: schemaErrors.slice(0, 10),
      exitCode: 1,
    });
  }

  const set = /** @type {any} */ (observationSet);
  const minConfidence = options.minConfidence ?? 0.5;
  const snapMm = Math.max(1, options.snapMm ?? 10);
  const maxHostDistance = options.maxHostDistanceMm ?? 400;

  /** @type {ReconcileEntry[]} */
  const entries = [];
  /** @type {string[]} */
  const assumptions = [];

  /** @param {string} id @param {string} reason */
  const reject = (id, reason) => entries.push({ observation_id: id, status: 'rejected', reason });

  const usable = [];
  for (const observation of set.observations ?? []) {
    if (observation.confidence < minConfidence) {
      reject(observation.id, `confidence ${observation.confidence} is below the threshold of ${minConfidence}`);
      continue;
    }
    usable.push(observation);
  }
  const superseded = new Set(usable.flatMap((o) => o.supersedes ?? []));
  const active = usable.filter((observation) => {
    if (superseded.has(observation.id)) {
      entries.push({ observation_id: observation.id, status: 'rejected', reason: 'superseded by a later observation' });
      return false;
    }
    return true;
  });

  // ---- walls ---------------------------------------------------------------
  const wallCandidates = [];
  for (const observation of active.filter((o) => o.candidate_type === 'wall')) {
    if (observation.geometry.kind !== 'segment') {
      reject(observation.id, 'a wall observation needs geometry of kind "segment"');
      continue;
    }
    const thickness = observation.attributes?.thickness_mm ?? options.defaultThicknessMm;
    if (!thickness) {
      reject(observation.id, 'no thickness_mm, and no explicit default thickness was supplied');
      continue;
    }
    const thicknessEstimated = observation.attributes?.thickness_mm === undefined;
    const a = snapPoint(fromModel(observation.geometry.start), snapMm);
    const b = snapPoint(fromModel(observation.geometry.end), snapMm);
    if (distance(a, b) < snapMm) {
      reject(observation.id, 'the segment collapses to a point after snapping');
      continue;
    }
    wallCandidates.push({
      observations: [observation.id],
      a,
      b,
      thickness,
      thicknessEstimated,
      classification: observation.attributes?.classification,
      confidence: observation.confidence,
      provenance: clampProvenance(observation.provenance_hint, observation.id, assumptions),
      state: observation.attributes?.state,
    });
  }
  if (wallCandidates.some((c) => c.thicknessEstimated)) {
    assumptions.push(`Default wall thickness ${options.defaultThicknessMm} mm was applied where the observation gave none; recorded as "estimated".`);
  }

  const mergedWalls = mergeCollinearWalls(wallCandidates, snapMm);
  snapJunctions(mergedWalls, snapMm * 2);

  /** @type {any[]} */
  const walls = mergedWalls.map((candidate, i) => {
    const id = `wall_${String(i + 1).padStart(3, '0')}`;
    /** @type {any} */
    const wall = {
      id,
      type: 'wall',
      start: toModel(candidate.a),
      end: toModel(candidate.b),
      thickness_mm: candidate.thickness,
      state: candidate.state ?? 'existing',
      provenance: candidate.provenance,
      confidence: round2(candidate.confidence),
      observation_ids: candidate.observations,
    };
    if (candidate.classification) wall.classification = candidate.classification;
    if (candidate.thicknessEstimated) {
      wall.property_provenance = {
        thickness_mm: { provenance: 'estimated', confidence: 0.3, note: 'default thickness supplied at import time' },
      };
    }
    for (const observationId of candidate.observations) {
      entries.push({
        observation_id: observationId,
        status: candidate.observations.length > 1 ? 'merged' : 'accepted',
        element_id: id,
      });
    }
    return wall;
  });

  // ---- spaces ---------------------------------------------------------------
  /** @type {any[]} */
  const spaces = [];
  for (const observation of active.filter((o) => o.candidate_type === 'space')) {
    if (observation.geometry.kind !== 'polygon') {
      reject(observation.id, 'a space observation needs geometry of kind "polygon"');
      continue;
    }
    const polygon = normalizeOrientation(observation.geometry.points.map(fromModel).map((p) => snapPoint(p, snapMm)));
    if (polygon.length < 3 || polygonArea(polygon) < 1000) {
      reject(observation.id, 'the polygon encloses no usable area after snapping');
      continue;
    }
    const id = `space_${String(spaces.length + 1).padStart(3, '0')}`;
    /** @type {any} */
    const space = {
      id,
      type: 'space',
      name: observation.attributes?.name ?? `Room ${spaces.length + 1}`,
      boundary: polygon.map(toModel),
      state: observation.attributes?.state ?? 'existing',
      provenance: clampProvenance(observation.provenance_hint, observation.id, assumptions),
      confidence: round2(observation.confidence),
      observation_ids: [observation.id],
    };
    if (observation.attributes?.category) space.category = observation.attributes.category;
    if (!observation.attributes?.name) {
      assumptions.push(`Space "${id}" has a generated name because the observation carried none.`);
    }
    spaces.push(space);
    entries.push({ observation_id: observation.id, status: 'accepted', element_id: id });
  }

  // ---- openings ------------------------------------------------------------
  /** @type {any[]} */
  const openings = [];
  const openingTypes = ['door', 'window', 'passage', 'opening'];
  for (const observation of active.filter((o) => openingTypes.includes(o.candidate_type))) {
    const centre = openingCentre(observation);
    if (!centre) {
      reject(observation.id, 'an opening observation needs geometry of kind "segment" or "point"');
      continue;
    }
    const host = findHostWall(walls, centre, maxHostDistance);
    if (!host) {
      reject(observation.id, `no wall found within ${maxHostDistance} mm of the opening`);
      continue;
    }
    const width = observation.attributes?.width_mm
      ?? (observation.geometry.kind === 'segment'
        ? Math.round(segmentLength({ a: fromModel(observation.geometry.start), b: fromModel(observation.geometry.end) }))
        : undefined);
    if (!width) {
      reject(observation.id, 'no width_mm, and the geometry does not imply one');
      continue;
    }

    const type = observation.candidate_type === 'opening' ? 'generic_opening' : observation.candidate_type;
    const prefix = type === 'generic_opening' ? 'opening' : type;
    const id = `${prefix}_${String(openings.filter((o) => o.type === type).length + 1).padStart(3, '0')}`;
    const offset = clamp(Math.round(host.along), Math.ceil(width / 2), Math.floor(host.length - width / 2));
    if (offset < Math.ceil(width / 2)) {
      reject(observation.id, `an opening of ${width} mm does not fit into wall "${host.wall.id}"`);
      continue;
    }

    /** @type {any} */
    const opening = {
      id,
      type,
      host_wall_id: host.wall.id,
      offset_mm: offset,
      width_mm: width,
      state: observation.attributes?.state ?? 'existing',
      provenance: clampProvenance(observation.provenance_hint, observation.id, assumptions),
      confidence: round2(observation.confidence),
      observation_ids: [observation.id],
    };
    if (observation.attributes?.height_mm) opening.height_mm = observation.attributes.height_mm;

    if (type === 'door') {
      opening.door_type = observation.attributes?.door_type ?? 'swing';
      if (!observation.attributes?.door_type) {
        assumptions.push(`Door "${id}" was classified as a swing door; the observation did not say.`);
      }
      // hinge and swing are left out when unknown: the renderer then draws the
      // leaf without an opening arc instead of inventing a direction.
      if (observation.attributes?.hinge) opening.hinge = observation.attributes.hinge;
      if (observation.attributes?.swing) opening.swing = observation.attributes.swing;
    }
    if (type === 'window') {
      if (observation.attributes?.sill_mm === undefined) {
        reject(observation.id, 'a window needs sill_mm; the sill height is never guessed');
        continue;
      }
      opening.sill_mm = observation.attributes.sill_mm;
      if (observation.attributes?.window_type) opening.window_type = observation.attributes.window_type;
    }
    if (type === 'generic_opening' && observation.attributes?.sill_mm !== undefined) {
      opening.sill_mm = observation.attributes.sill_mm;
    }

    openings.push(opening);
    entries.push({ observation_id: observation.id, status: 'accepted', element_id: id });
  }

  // ---- dimensions and labels -------------------------------------------------
  /** @type {any[]} */
  const dimensions = [];
  for (const observation of active.filter((o) => o.candidate_type === 'dimension')) {
    if (observation.geometry.kind !== 'segment') {
      reject(observation.id, 'a dimension observation needs geometry of kind "segment"');
      continue;
    }
    const id = `dim_${String(dimensions.length + 1).padStart(3, '0')}`;
    dimensions.push({
      id,
      type: 'dimension',
      start: toModel(snapPoint(fromModel(observation.geometry.start), snapMm)),
      end: toModel(snapPoint(fromModel(observation.geometry.end), snapMm)),
      provenance: clampProvenance(observation.provenance_hint, observation.id, assumptions),
      confidence: round2(observation.confidence),
      ...(observation.attributes?.text ? { label_override: observation.attributes.text } : {}),
    });
    entries.push({ observation_id: observation.id, status: 'accepted', element_id: id });
  }

  /** @type {any[]} */
  const annotations = [];
  for (const observation of active.filter((o) => o.candidate_type === 'label')) {
    const text = observation.attributes?.text ?? observation.attributes?.name;
    if (!text || observation.geometry.kind !== 'point') {
      reject(observation.id, 'a label observation needs geometry of kind "point" and a text attribute');
      continue;
    }
    const id = `note_${String(annotations.length + 1).padStart(3, '0')}`;
    annotations.push({
      id,
      type: 'annotation',
      position: toModel(snapPoint(fromModel(observation.geometry.position), snapMm)),
      text,
      annotation_kind: 'label',
    });
    entries.push({ observation_id: observation.id, status: 'accepted', element_id: id });
  }

  for (const observation of active.filter((o) => ['stair', 'column', 'unknown'].includes(o.candidate_type))) {
    reject(observation.id, `candidate_type "${observation.candidate_type}" is not reconciled by this version`);
  }

  // ---- assemble ---------------------------------------------------------------
  /** @type {any} */
  const level = { id: 'level_eg', name: 'Reconstructed level', index: 0, elevation_mm: 0 };
  if (walls.length > 0) level.walls = walls;
  if (openings.length > 0) level.openings = openings;
  if (spaces.length > 0) level.spaces = spaces;
  if (dimensions.length > 0) level.dimensions = dimensions;
  if (annotations.length > 0) level.annotations = annotations;

  const calibrationReliable = ['provided', 'measured', 'parsed'].includes(set.calibration?.provenance ?? '');

  /** @type {any} */
  const document = {
    schema_version: SCHEMA_VERSION,
    unit: 'mm',
    project: {
      id: options.projectId ?? 'project_reconstructed',
      name: options.projectName ?? `Reconstruction of ${set.source.uri ?? set.source.id}`,
      description: `Reconstructed from ${set.observations?.length ?? 0} observations`
        + `${set.interpreter?.name ? ` produced by ${set.interpreter.name}` : ''}.`
        + ' Values are interpreted, not measured.',
      quality: 'marketing',
      defaults: { state: 'existing', provenance: 'estimated' },
    },
    sources: [{
      id: set.source.id,
      kind: set.source.kind,
      ...(set.source.uri ? { uri: set.source.uri } : {}),
      ...(set.source.page ? { page: set.source.page } : {}),
      ...(set.source.description ? { description: set.source.description } : {}),
    }],
    buildings: [{ id: 'building_main', name: 'Reconstructed building', levels: [level] }],
    revision: 0,
  };
  for (const element of [...walls, ...openings, ...spaces, ...dimensions]) {
    element.source_id = set.source.id;
  }

  let quality = 'marketing';
  let qualityReason = 'No reliable calibration: the document stays at "marketing".';
  if (calibrationReliable) {
    const scaledReport = validateDocument(document, { quality: 'scaled' });
    if (scaledReport.ok) {
      document.project.quality = 'scaled';
      quality = 'scaled';
      qualityReason = `Calibration provenance is "${set.calibration.provenance}" and the document validates at "scaled".`;
    } else {
      qualityReason = `Calibration is reliable, but the document does not validate at "scaled" (${scaledReport.counts.ERROR} error(s)); staying at "marketing".`;
    }
  }

  entries.sort((a, b) => (a.observation_id < b.observation_id ? -1 : a.observation_id > b.observation_id ? 1 : 0));

  const counts = entries.reduce((acc, entry) => {
    acc[entry.status] = (acc[entry.status] ?? 0) + 1;
    return acc;
  }, /** @type {Record<string, number>} */ ({ accepted: 0, merged: 0, rejected: 0 }));
  counts.walls = walls.length;
  counts.openings = openings.length;
  counts.spaces = spaces.length;

  return {
    document,
    report: {
      source: set.source,
      counts,
      entries,
      assumptions: [...new Set(assumptions)],
      quality,
      quality_reason: qualityReason,
    },
  };
}

/**
 * An interpreter may never claim that something was measured on site.
 * @param {string|undefined} hint
 * @param {string} observationId
 * @param {string[]} assumptions
 * @returns {string}
 */
function clampProvenance(hint, observationId, assumptions) {
  if (hint === 'measured' || hint === 'provided') {
    assumptions.push(`Observation ${observationId} claimed provenance "${hint}"; downgraded to "parsed" because an interpretation is not a measurement.`);
    return 'parsed';
  }
  return hint ?? 'estimated';
}

/**
 * @param {Vec} point
 * @param {number} grid
 * @returns {Vec}
 */
function snapPoint(point, grid) {
  return { x: Math.round(point.x / grid) * grid, y: Math.round(point.y / grid) * grid };
}

/**
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * @param {any} observation
 * @returns {Vec|null}
 */
function openingCentre(observation) {
  if (observation.geometry.kind === 'point') return fromModel(observation.geometry.position);
  if (observation.geometry.kind === 'segment') {
    const a = fromModel(observation.geometry.start);
    const b = fromModel(observation.geometry.end);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return null;
}

/**
 * Merge segments that lie on the same line and overlap or nearly touch.
 * @param {any[]} candidates
 * @param {number} tolerance
 * @returns {any[]}
 */
function mergeCollinearWalls(candidates, tolerance) {
  const result = [...candidates];
  let changed = true;
  while (changed) {
    changed = false;
    outer:
    for (let i = 0; i < result.length; i += 1) {
      for (let j = i + 1; j < result.length; j += 1) {
        const first = result[i];
        const second = result[j];
        if (first.thickness !== second.thickness) continue;
        const s1 = { a: first.a, b: first.b };
        const s2 = { a: second.a, b: second.b };
        if (!areCollinear(s1, s2, tolerance, 1.5)) continue;

        const length = distance(s1.a, s1.b);
        const t2a = projectPoint(s1, s2.a).t * length;
        const t2b = projectPoint(s1, s2.b).t * length;
        const low = Math.min(t2a, t2b);
        const high = Math.max(t2a, t2b);
        if (high < -tolerance || low > length + tolerance) continue; // disjoint

        const from = Math.min(0, low);
        const to = Math.max(length, high);
        const direction = { x: (s1.b.x - s1.a.x) / length, y: (s1.b.y - s1.a.y) / length };
        result[i] = {
          ...first,
          a: { x: roundMm(s1.a.x + direction.x * from), y: roundMm(s1.a.y + direction.y * from) },
          b: { x: roundMm(s1.a.x + direction.x * to), y: roundMm(s1.a.y + direction.y * to) },
          observations: [...first.observations, ...second.observations],
          confidence: Math.max(first.confidence, second.confidence),
          thicknessEstimated: first.thicknessEstimated && second.thicknessEstimated,
          classification: first.classification ?? second.classification,
        };
        result.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return result;
}

/**
 * Pull wall ends that nearly meet onto a common point, and project ends that sit
 * close to another wall's axis exactly onto that axis. Without this step no
 * corner would ever be mitred and the reconstruction would look ragged.
 * @param {any[]} walls
 * @param {number} tolerance
 */
function snapJunctions(walls, tolerance) {
  /** @type {Array<{wall: any, key: 'a'|'b'}>} */
  const ends = [];
  for (const wall of walls) {
    ends.push({ wall, key: 'a' }, { wall, key: 'b' });
  }
  for (let i = 0; i < ends.length; i += 1) {
    for (let j = i + 1; j < ends.length; j += 1) {
      if (ends[i].wall === ends[j].wall) continue;
      const p = ends[i].wall[ends[i].key];
      const q = ends[j].wall[ends[j].key];
      const d = distance(p, q);
      if (d > 0 && d <= tolerance) {
        ends[j].wall[ends[j].key] = { x: p.x, y: p.y };
      }
    }
  }
  for (const end of ends) {
    const point = end.wall[end.key];
    for (const other of walls) {
      if (other === end.wall) continue;
      const axis = { a: other.a, b: other.b };
      const length = distance(axis.a, axis.b);
      if (length < 1) continue;
      const projection = projectPoint(axis, point);
      const along = projection.t * length;
      if (projection.distance > 0 && projection.distance <= tolerance
        && along > tolerance && along < length - tolerance) {
        end.wall[end.key] = { x: roundMm(projection.point.x), y: roundMm(projection.point.y) };
        break;
      }
    }
  }
}

/**
 * @param {any[]} walls
 * @param {Vec} point
 * @param {number} maxDistance
 * @returns {{wall: any, along: number, length: number}|null}
 */
function findHostWall(walls, point, maxDistance) {
  /** @type {{wall: any, along: number, length: number}|null} */
  let best = null;
  let bestDistance = Infinity;
  for (const wall of walls) {
    const axis = { a: fromModel(wall.start), b: fromModel(wall.end) };
    const length = distance(axis.a, axis.b);
    if (length < 1) continue;
    const projection = projectPoint(axis, point);
    const along = projection.t * length;
    if (along < 0 || along > length) continue;
    if (projection.distance < bestDistance && projection.distance <= maxDistance) {
      bestDistance = projection.distance;
      best = { wall, along, length };
    }
  }
  return best;
}
