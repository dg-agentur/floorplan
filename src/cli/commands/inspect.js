import { loadDocument } from '../../model/io.js';
import { indexDocument, listLevels, resolveLevel, resolveState, resolveWallHeight } from '../../model/document.js';
import { elementProvenance, isReliable, resolveProvenance } from '../../model/provenance.js';
import { levelMetrics, spaceAreaMm2, spacePerimeterMm, toSquareMetres } from '../../model/measure.js';
import { wallLength, openingSpan } from '../../geometry/wallGeometry.js';
import { buildConnectivityGraph } from '../../topology/connectivity.js';
import { levelBounds } from '../../geometry/bounds.js';
import { UsageError } from '../../util/errors.js';
import { parseArgs, requirePositional, stringFlag } from '../args.js';
import { finish, table } from '../output.js';

export const inspectSpec = {
  boolean: ['json', 'debug'],
  string: ['section', 'level'],
};

const SECTIONS = ['summary', 'levels', 'walls', 'openings', 'spaces', 'graph', 'provenance', 'history', 'all'];

/**
 * @param {string[]} argv
 * @param {import('../output.js').OutputContext} out
 * @returns {number}
 */
export function inspectCommand(argv, out) {
  const args = parseArgs(argv, inspectSpec);
  const file = requirePositional(args, 0, 'the floorplan file to inspect');
  const section = stringFlag(args, 'section') ?? 'summary';
  if (!SECTIONS.includes(section)) {
    throw new UsageError('UNKNOWN_SECTION', `Unknown section "${section}".`, {
      hint: `Available sections: ${SECTIONS.join(', ')}`,
    });
  }

  const { document: doc } = loadDocument(file);
  const level = resolveLevel(doc, stringFlag(args, 'level'));
  const wanted = section === 'all' ? SECTIONS.filter((s) => s !== 'all') : [section];

  /** @type {Record<string, unknown>} */
  const data = {};
  /** @type {string[]} */
  const human = [];

  if (wanted.includes('summary')) {
    const summary = buildSummary(doc);
    data.summary = summary;
    human.push(
      `project:  ${doc.project.name} (${doc.project.id})`,
      `quality:  ${doc.project.quality}    schema: ${doc.schema_version}    revision: ${doc.revision ?? 0}`,
      `levels:   ${summary.levels.length}   total floor area: ${summary.total_floor_area_m2.toFixed(2)} m²`,
      '',
      table(
        ['level', 'name', 'idx', 'walls', 'openings', 'spaces', 'area m²'],
        summary.levels.map((l) => [l.id, l.name, l.index, l.walls, l.openings, l.spaces, l.floor_area_m2.toFixed(2)]),
      ),
    );
  }

  if (wanted.includes('levels')) {
    const levels = listLevels(doc).map(({ level: lvl, building }) => ({
      id: lvl.id,
      name: lvl.name,
      index: lvl.index,
      elevation_mm: lvl.elevation_mm,
      height_mm: lvl.height_mm,
      building_id: building.id,
      bounds: levelBounds(lvl),
      ...levelMetrics(lvl),
    }));
    data.levels = levels;
  }

  if (wanted.includes('walls')) {
    const walls = (level.walls ?? []).map((wall) => ({
      id: wall.id,
      name: wall.name,
      length_mm: Math.round(wallLength(wall)),
      thickness_mm: wall.thickness_mm,
      height_mm: resolveWallHeight(doc, wall, level),
      classification: wall.classification,
      state: resolveState(doc, wall),
      provenance: resolveProvenance(doc, wall).provenance,
      start: wall.start,
      end: wall.end,
      opening_ids: (level.openings ?? []).filter((o) => o.host_wall_id === wall.id).map((o) => o.id),
    }));
    data.walls = walls;
    if (section !== 'all') {
      human.push(table(
        ['id', 'length', 'thick', 'class', 'state', 'provenance', 'openings'],
        walls.map((w) => [w.id, `${w.length_mm} mm`, `${w.thickness_mm} mm`, w.classification ?? '-', w.state, w.provenance, w.opening_ids.join(',') || '-']),
      ));
    }
  }

  if (wanted.includes('openings')) {
    const graph = buildConnectivityGraph(doc, level);
    const byId = new Map(graph.connections.map((c) => [c.opening_id, c]));
    const openings = (level.openings ?? []).map((opening) => {
      const connection = byId.get(opening.id);
      const span = openingSpan(opening);
      return {
        id: opening.id,
        type: opening.type,
        host_wall_id: opening.host_wall_id,
        offset_mm: opening.offset_mm,
        width_mm: opening.width_mm,
        height_mm: opening.height_mm,
        sill_mm: opening.sill_mm,
        span_mm: [Math.round(span.from), Math.round(span.to)],
        door_type: opening.door_type,
        hinge: opening.hinge,
        swing: opening.swing,
        state: resolveState(doc, opening),
        provenance: resolveProvenance(doc, opening).provenance,
        declared_space_ids: opening.connects_space_ids,
        derived_space_ids: connection?.derived_space_ids ?? [],
        swings_into_space_id: connection?.swings_into_space_id ?? null,
        leads_outside: connection?.leads_outside ?? null,
      };
    });
    data.openings = openings;
    if (section !== 'all') {
      human.push(table(
        ['id', 'type', 'wall', 'offset', 'width', 'connects', 'swings into'],
        openings.map((o) => [
          o.id, o.type, o.host_wall_id, `${o.offset_mm} mm`, `${o.width_mm} mm`,
          o.derived_space_ids.join(' + ') || (o.leads_outside ? 'outside' : '-'),
          o.swings_into_space_id ?? '-',
        ]),
      ));
    }
  }

  if (wanted.includes('spaces')) {
    const spaces = (level.spaces ?? []).map((space) => {
      const areaMm2 = spaceAreaMm2(space);
      const provenance = resolveProvenance(doc, space, 'boundary');
      return {
        id: space.id,
        name: space.name,
        category: space.category,
        floor_area_m2: toSquareMetres(areaMm2),
        perimeter_mm: Math.round(spacePerimeterMm(space)),
        declared_area_m2: space.area_override_mm2 !== undefined ? toSquareMetres(space.area_override_mm2) : undefined,
        height_mm: space.height_mm,
        state: resolveState(doc, space),
        provenance: provenance.provenance,
        reliable: isReliable(provenance),
        vertices: space.boundary.length,
      };
    });
    data.spaces = spaces;
    data.total_floor_area_m2 = Math.round(spaces.reduce((sum, s) => sum + s.floor_area_m2, 0) * 10000) / 10000;
    if (section !== 'all') {
      human.push(table(
        ['id', 'name', 'category', 'area m²', 'state', 'provenance'],
        spaces.map((s) => [s.id, s.name, s.category ?? '-', s.floor_area_m2.toFixed(2), s.state, s.provenance + (s.reliable ? '' : ' (!)')]),
      ));
      human.push('', `total floor area: ${Number(data.total_floor_area_m2).toFixed(2)} m² (geometric, not a living-area calculation)`);
    }
  }

  if (wanted.includes('graph')) {
    const graph = buildConnectivityGraph(doc, level);
    data.graph = { nodes: graph.nodes, edges: graph.edges };
    if (section !== 'all') {
      human.push(table(
        ['opening', 'type', 'from', 'to', 'width', 'walkable'],
        graph.edges.map((e) => [e.id, e.type, e.from, e.to, `${e.width_mm} mm`, e.passable ? 'yes' : 'no']),
      ));
    }
  }

  if (wanted.includes('provenance')) {
    const index = indexDocument(doc);
    /** @type {Array<{element_id: string, property: string, provenance: string, confidence?: number, verified: boolean, reliable: boolean}>} */
    const entries = [];
    for (const [id, ref] of index.byId) {
      for (const { property, resolved } of elementProvenance(doc, ref.element)) {
        entries.push({
          element_id: id,
          property,
          provenance: resolved.provenance,
          confidence: resolved.confidence,
          verified: resolved.verified,
          reliable: isReliable(resolved),
        });
      }
    }
    const counts = entries.reduce((acc, entry) => {
      acc[entry.provenance] = (acc[entry.provenance] ?? 0) + 1;
      return acc;
    }, /** @type {Record<string, number>} */ ({}));
    data.provenance = { counts, reliable: entries.filter((e) => e.reliable).length, total: entries.length, entries };
    if (section !== 'all') {
      human.push(
        `dimensional values: ${entries.length}, of which reliable (provided/measured/parsed): ${entries.filter((e) => e.reliable).length}`,
        '',
        table(['provenance', 'count'], Object.entries(counts).sort().map(([k, v]) => [k, v])),
      );
    }
  }

  if (wanted.includes('history')) {
    const history = (doc.history ?? []).map((entry) => ({
      index: entry.index,
      op: /** @type {any} */ (entry.operation)?.op,
      summary: entry.summary,
      affected_ids: entry.affected_ids,
      undoable: Array.isArray(entry.inverse) && entry.inverse.length > 0,
      stamp: entry.stamp,
    }));
    data.history = history;
    if (section !== 'all') {
      human.push(history.length === 0
        ? 'no operations have been applied to this document'
        : table(['#', 'op', 'summary'], history.map((h) => [h.index, h.op ?? '-', h.summary])));
    }
  }

  return finish(out, { data: { file, level_id: level.id, ...data }, human: human.join('\n') });
}

/**
 * @param {import('../../model/types.js').FloorplanDocument} doc
 */
function buildSummary(doc) {
  const levels = listLevels(doc).map(({ level, building }) => {
    const metrics = levelMetrics(level);
    return {
      id: level.id,
      name: level.name,
      index: level.index,
      building_id: building.id,
      walls: metrics.wall_count,
      openings: metrics.opening_count,
      spaces: metrics.space_count,
      floor_area_m2: toSquareMetres(metrics.total_floor_area_mm2),
    };
  });
  return {
    project_id: doc.project.id,
    project_name: doc.project.name,
    quality: doc.project.quality,
    schema_version: doc.schema_version,
    revision: doc.revision ?? 0,
    levels,
    total_floor_area_m2: Math.round(levels.reduce((sum, l) => sum + l.floor_area_m2, 0) * 10000) / 10000,
  };
}
