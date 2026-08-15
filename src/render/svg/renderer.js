/**
 * Deterministic SVG renderer.
 *
 * Guarantees:
 *   - the same document plus the same theme always produce byte identical output
 *   - no generative image model, no randomness, no timestamps
 *   - the SVG coordinate system is the model coordinate system in millimetres
 *     with the Y axis flipped, so the output stays readable and diffable
 *
 * Priority order, as specified: geometric correctness > reproducibility > design.
 */

import { ELEMENT_COLLECTIONS } from '../../model/constants.js';
import { resolveLevel, resolveState } from '../../model/document.js';
import { resolveProvenance, isReliable } from '../../model/provenance.js';
import { spaceAreaMm2, toSquareMetres } from '../../model/measure.js';
import { add, distance, fromModel, leftNormal, normalize, scale, sub } from '../../geometry/vec.js';
import { clipLineToPolygon, labelPoint } from '../../geometry/polygon.js';
import { buildWallGeometry } from '../../geometry/wallGeometry.js';
import { unionOutline } from '../../geometry/outline.js';
import { computeViewport } from '../layout.js';
import { openingStyle, spaceStyle, styleKey, wallStyle } from '../style.js';
import { attrs, dashArray, esc, fmt, formatArea, formatLength } from '../format.js';
import {
  arrowHead, doorSymbol, genericOpeningSymbol, linePath, passageSymbol, polygonPath, toSvg, windowSymbol,
} from './symbols.js';

/** @typedef {import('../../model/types.js').FloorplanDocument} FloorplanDocument */
/** @typedef {import('../../geometry/vec.js').Vec} Vec */

/**
 * @typedef {object} RenderResult
 * @property {string} svg
 * @property {{level_id: string, theme: string, viewport: object, counts: Record<string, number>}} meta
 */

/**
 * @param {FloorplanDocument} doc
 * @param {any} theme
 * @param {{levelId?: string, title?: string}} [options]
 * @returns {RenderResult}
 */
export function renderSvg(doc, theme, options = {}) {
  const level = resolveLevel(doc, options.levelId);
  const viewport = computeViewport(level, theme);
  const u = viewport.u;

  /** @type {Map<string, import('../../model/types.js').Opening[]>} */
  const openingsByWall = new Map();
  for (const opening of level.openings ?? []) {
    const list = openingsByWall.get(opening.host_wall_id);
    if (list) list.push(opening);
    else openingsByWall.set(opening.host_wall_id, [opening]);
  }
  const wallGeometry = buildWallGeometry(level.walls ?? [], openingsByWall);

  /** @type {string[]} */
  const body = [];

  body.push(`<rect${attrs({
    x: fmt(viewport.min_x_mm), y: fmt(-viewport.max_y_mm),
    width: fmt(viewport.width_mm), height: fmt(viewport.height_mm),
    fill: theme.page.background,
  })}/>`);

  body.push(...layer('spaces', renderSpaces(doc, level, theme, u)));
  body.push(...layer('shafts', renderShafts(level, theme, u)));
  body.push(...layer('walls', renderWalls(doc, level, theme, u, wallGeometry)));
  body.push(...layer('columns', renderColumns(level, theme, u)));
  body.push(...layer('openings', renderOpenings(doc, level, theme, u, wallGeometry)));
  body.push(...layer('stairs', renderStairs(level, theme, u)));
  body.push(...layer('dimensions', renderDimensions(level, theme, u)));
  body.push(...layer('labels', renderSpaceLabels(doc, level, theme, u)));
  body.push(...layer('annotations', renderAnnotations(level, theme, u)));

  const title = options.title ?? `${doc.project.name} — ${level.name}`;
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg${attrs({
      xmlns: 'http://www.w3.org/2000/svg',
      version: '1.1',
      width: fmt(viewport.width_px, 2),
      height: fmt(viewport.height_px, 2),
      viewBox: viewport.view_box,
      'data-floorplan-schema': doc.schema_version,
      'data-level-id': level.id,
      'data-project-id': doc.project.id,
      'data-quality': doc.project.quality,
      'data-unit': 'mm',
    })}>`,
    `  <title>${esc(title)}</title>`,
    `  <desc>${esc(`Deterministically rendered from a canonical floorplan model. Coordinates are millimetres; the Y axis is flipped for SVG. Quality level: ${doc.project.quality}.`)}</desc>`,
    `  <g${attrs({ 'font-family': theme.page.font_family })}>`,
    ...body.map((line) => `    ${line}`),
    '  </g>',
    '</svg>',
    '',
  ].join('\n');

  /** @type {Record<string, number>} */
  const counts = {};
  for (const collection of ELEMENT_COLLECTIONS) {
    counts[collection] = (/** @type {any} */ (level)[collection] ?? []).length;
  }

  return {
    svg,
    meta: {
      level_id: level.id,
      theme: theme.name,
      viewport: {
        min_x_mm: viewport.min_x_mm,
        min_y_mm: viewport.min_y_mm,
        width_mm: viewport.width_mm,
        height_mm: viewport.height_mm,
        px_per_mm: viewport.px_per_mm,
        width_px: viewport.width_px,
        height_px: viewport.height_px,
      },
      counts,
    },
  };
}

/**
 * @param {string} name
 * @param {string[]} content
 * @returns {string[]}
 */
function layer(name, content) {
  if (content.length === 0) return [];
  return [`<g data-layer="${name}">`, ...content.map((line) => `  ${line}`), '</g>'];
}

/**
 * @param {FloorplanDocument} doc
 * @param {any} level
 * @param {any} theme
 * @param {(px: number) => number} u
 * @returns {string[]}
 */
function renderSpaces(doc, level, theme, u) {
  if (!theme.spaces.show_fill) return [];
  /** @type {string[]} */
  const out = [];
  for (const space of level.spaces ?? []) {
    const style = spaceStyle(theme, space);
    if ((!style.fill || style.fill === 'none') && (!style.stroke || style.stroke === 'none')) continue;
    const polygon = (space.boundary ?? []).map(fromModel);
    if (polygon.length < 3) continue;
    out.push(`<path${attrs({
      d: polygonPath(polygon),
      fill: style.fill,
      'fill-opacity': style.fill_opacity !== 1 ? fmt(style.fill_opacity, 3) : undefined,
      stroke: style.stroke && style.stroke !== 'none' ? style.stroke : undefined,
      'stroke-width': style.stroke && style.stroke !== 'none' ? fmt(u(style.stroke_width_px ?? 0), 4) : undefined,
      'data-type': 'space',
      'data-id': space.id,
    })}/>`);
  }
  return out;
}

/**
 * Walls are drawn per visual style group: all walls that look alike are unioned,
 * so no seams appear between them, while a demolished wall keeps its own outline.
 * @param {FloorplanDocument} doc
 * @param {any} level
 * @param {any} theme
 * @param {(px: number) => number} u
 * @param {Map<string, import('../../geometry/wallGeometry.js').WallGeometry>} wallGeometry
 * @returns {string[]}
 */
function renderWalls(doc, level, theme, u, wallGeometry) {
  /** @type {Map<string, {style: any, polygons: Vec[][], ids: string[]}>} */
  const groups = new Map();

  for (const wall of level.walls ?? []) {
    const geometry = wallGeometry.get(wall.id);
    if (!geometry) continue;
    const style = wallStyle(theme, wall, resolveState(doc, wall));
    const key = styleKey(style);
    const group = groups.get(key) ?? { style, polygons: [], ids: [] };
    for (const solid of geometry.solids) group.polygons.push(solid.polygon);
    group.ids.push(wall.id);
    groups.set(key, group);
  }

  /** @type {string[]} */
  const out = [];
  for (const group of groups.values()) {
    if (group.polygons.length === 0) continue;
    const hasFill = group.style.fill && group.style.fill !== 'none';
    if (hasFill) {
      out.push(`<path${attrs({
        d: group.polygons.map(polygonPath).join(' '),
        fill: group.style.fill,
        'fill-opacity': group.style.fill_opacity !== 1 ? fmt(group.style.fill_opacity, 3) : undefined,
        stroke: 'none',
        'fill-rule': 'nonzero',
        'data-type': 'wall-fill',
        'data-ids': group.ids.join(' '),
      })}/>`);
    }
    if (group.style.hatch === 'diagonal') {
      out.push(...hatchPolygons(group.polygons, group.style, u, 45));
    }
    const hasStroke = group.style.stroke && group.style.stroke !== 'none' && (group.style.stroke_width_px ?? 0) > 0;
    if (hasStroke) {
      const outline = unionOutline(group.polygons);
      if (outline.length > 0) {
        out.push(`<path${attrs({
          d: outline.map((segment) => linePath(segment.a, segment.b)).join(' '),
          fill: 'none',
          stroke: group.style.stroke,
          'stroke-width': fmt(u(group.style.stroke_width_px), 4),
          'stroke-dasharray': dashArray(group.style.dash, u),
          'stroke-linecap': 'square',
          'data-type': 'wall-outline',
          'data-ids': group.ids.join(' '),
        })}/>`);
      }
    }
  }
  return out;
}

/**
 * @param {Vec[][]} polygons
 * @param {any} style
 * @param {(px: number) => number} u
 * @param {number} angleDeg
 * @returns {string[]}
 */
function hatchPolygons(polygons, style, u, angleDeg) {
  const spacing = u(style.hatch_spacing_px ?? 6);
  if (spacing <= 0) return [];
  const radians = (angleDeg * Math.PI) / 180;
  const direction = { x: Math.cos(radians), y: Math.sin(radians) };
  const normal = { x: -direction.y, y: direction.x };
  /** @type {string[]} */
  const segments = [];

  for (const polygon of polygons) {
    let min = Infinity;
    let max = -Infinity;
    for (const point of polygon) {
      const projection = point.x * normal.x + point.y * normal.y;
      if (projection < min) min = projection;
      if (projection > max) max = projection;
    }
    const first = Math.ceil(min / spacing);
    const last = Math.floor(max / spacing);
    for (let i = first; i <= last; i += 1) {
      const base = scale(normal, i * spacing);
      const a = add(base, scale(direction, -1e6));
      const b = add(base, scale(direction, 1e6));
      for (const piece of clipLineToPolygon(polygon, a, b)) {
        segments.push(linePath(piece.a, piece.b));
      }
    }
  }
  if (segments.length === 0) return [];
  return [`<path${attrs({
    d: segments.join(' '),
    fill: 'none',
    stroke: style.hatch_color ?? style.stroke,
    'stroke-width': fmt(u(0.5), 4),
    'data-type': 'hatch',
  })}/>`];
}

/**
 * @param {FloorplanDocument} doc
 * @param {any} level
 * @param {any} theme
 * @param {(px: number) => number} u
 * @param {Map<string, import('../../geometry/wallGeometry.js').WallGeometry>} wallGeometry
 * @returns {string[]}
 */
function renderOpenings(doc, level, theme, u, wallGeometry) {
  /** @type {string[]} */
  const out = [];
  for (const wall of level.walls ?? []) {
    const geometry = wallGeometry.get(wall.id);
    if (!geometry) continue;
    for (const openingGeometry of geometry.openings) {
      const opening = openingGeometry.opening;
      const style = openingStyle(theme, opening.type, resolveState(doc, opening));
      const ctx = { theme, style, u, wallGeometry: geometry, geometry: openingGeometry, opening };
      /** @type {string[]} */
      let fragments = [];
      if (opening.type === 'door') fragments = doorSymbol(ctx);
      else if (opening.type === 'window') fragments = windowSymbol(ctx);
      else if (opening.type === 'passage') fragments = passageSymbol(ctx);
      else fragments = genericOpeningSymbol(ctx);
      if (fragments.length === 0) continue;
      out.push(`<g${attrs({
        'data-type': opening.type,
        'data-id': opening.id,
        opacity: style.opacity !== undefined && style.opacity !== 1 ? fmt(style.opacity, 3) : undefined,
      })}>`);
      out.push(...fragments.map((fragment) => `  ${fragment}`));
      out.push('</g>');
    }
  }
  return out;
}

/**
 * @param {any} level
 * @param {any} theme
 * @param {(px: number) => number} u
 * @returns {string[]}
 */
function renderColumns(level, theme, u) {
  /** @type {string[]} */
  const out = [];
  const style = theme.columns;
  for (const column of level.columns ?? []) {
    const centre = toSvg(fromModel(column.center));
    if (column.shape === 'circle') {
      out.push(`<circle${attrs({
        cx: fmt(centre.x), cy: fmt(centre.y), r: fmt((column.diameter_mm ?? 0) / 2),
        fill: style.fill, stroke: style.stroke, 'stroke-width': fmt(u(style.stroke_width_px ?? 1), 4),
        'data-type': 'column', 'data-id': column.id,
      })}/>`);
    } else {
      const width = column.width_mm ?? 0;
      const depth = column.depth_mm ?? 0;
      const rotation = column.rotation_deg ?? 0;
      out.push(`<rect${attrs({
        x: fmt(-width / 2), y: fmt(-depth / 2), width: fmt(width), height: fmt(depth),
        transform: `translate(${fmt(centre.x)} ${fmt(centre.y)}) rotate(${fmt(-rotation, 4)})`,
        fill: style.fill, stroke: style.stroke, 'stroke-width': fmt(u(style.stroke_width_px ?? 1), 4),
        'data-type': 'column', 'data-id': column.id,
      })}/>`);
    }
  }
  return out;
}

/**
 * @param {any} level
 * @param {any} theme
 * @param {(px: number) => number} u
 * @returns {string[]}
 */
function renderShafts(level, theme, u) {
  /** @type {string[]} */
  const out = [];
  const style = theme.shafts;
  for (const shaft of level.shafts ?? []) {
    const polygon = (shaft.boundary ?? []).map(fromModel);
    if (polygon.length < 3) continue;
    out.push(`<path${attrs({
      d: polygonPath(polygon),
      fill: style.fill,
      stroke: style.stroke,
      'stroke-width': fmt(u(style.stroke_width_px ?? 1), 4),
      'stroke-dasharray': dashArray(style.dash, u),
      'data-type': 'shaft',
      'data-id': shaft.id,
    })}/>`);
    if (style.hatch === 'diagonal') out.push(...hatchPolygons([polygon], style, u, 45));
  }
  return out;
}

/**
 * Stairs.
 *
 * Step lines are drawn only when step_count is present in the model. A stair
 * without a known step count is drawn as an outline with a direction arrow —
 * the system does not invent a riser height to make a picture look complete.
 * @param {any} level
 * @param {any} theme
 * @param {(px: number) => number} u
 * @returns {string[]}
 */
function renderStairs(level, theme, u) {
  /** @type {string[]} */
  const out = [];
  const style = theme.stairs;
  for (const stair of level.stairs ?? []) {
    const polygon = (stair.footprint ?? []).map(fromModel);
    if (polygon.length < 3) continue;
    out.push(`<g${attrs({ 'data-type': 'stair', 'data-id': stair.id })}>`);
    out.push(`  <path${attrs({
      d: polygonPath(polygon),
      fill: style.fill,
      stroke: style.stroke,
      'stroke-width': fmt(u(style.stroke_width_px ?? 1), 4),
    })}/>`);

    const runStart = fromModel(stair.run_start);
    const runEnd = fromModel(stair.run_end);
    const runLength = distance(runStart, runEnd);

    if (stair.step_count && runLength > 1) {
      const direction = normalize(sub(runEnd, runStart));
      const across = leftNormal(direction);
      /** @type {string[]} */
      const stepPaths = [];
      for (let i = 1; i < stair.step_count; i += 1) {
        const position = add(runStart, scale(direction, (runLength * i) / stair.step_count));
        const a = add(position, scale(across, -1e5));
        const b = add(position, scale(across, 1e5));
        for (const piece of clipLineToPolygon(polygon, a, b)) {
          stepPaths.push(linePath(piece.a, piece.b));
        }
      }
      if (stepPaths.length > 0) {
        out.push(`  <path${attrs({
          d: stepPaths.join(' '),
          fill: 'none',
          stroke: style.step_stroke,
          'stroke-width': fmt(u(style.step_stroke_width_px ?? 0.7), 4),
        })}/>`);
      }
    }

    if (style.show_arrow && runLength > 1) {
      const arrowSize = u(10);
      out.push(`  <path${attrs({
        d: `${linePath(runStart, runEnd)} ${arrowHead(runStart, runEnd, arrowSize)}`,
        fill: 'none',
        stroke: style.arrow_color ?? style.stroke,
        'stroke-width': fmt(u(style.arrow_stroke_width_px ?? 1), 4),
        'stroke-linejoin': 'miter',
      })}/>`);
    }
    out.push('</g>');
  }
  return out;
}

/**
 * @param {any} level
 * @param {any} theme
 * @param {(px: number) => number} u
 * @returns {string[]}
 */
function renderDimensions(level, theme, u) {
  const style = theme.dimensions;
  if (!style.show) return [];
  /** @type {string[]} */
  const out = [];
  for (const dimension of level.dimensions ?? []) {
    const start = fromModel(dimension.start);
    const end = fromModel(dimension.end);
    const length = distance(start, end);
    if (length < 1) continue;
    const direction = normalize(sub(end, start));
    const normal = leftNormal(direction);
    const offset = scale(normal, dimension.offset_mm ?? 0);
    const a = add(start, offset);
    const b = add(end, offset);
    const strokeWidth = fmt(u(style.stroke_width_px ?? 0.7), 4);

    /** @type {string[]} */
    const paths = [linePath(a, b)];
    const extension = u(style.extension_px ?? 6);
    if ((dimension.offset_mm ?? 0) !== 0) {
      paths.push(linePath(start, add(a, scale(normal, Math.sign(dimension.offset_mm) * extension))));
      paths.push(linePath(end, add(b, scale(normal, Math.sign(dimension.offset_mm) * extension))));
    }
    const tick = u(style.tick_size_px ?? 5);
    if (style.tick_style === 'slash') {
      const slash = normalize(add(direction, normal));
      for (const point of [a, b]) {
        paths.push(linePath(add(point, scale(slash, -tick / 2)), add(point, scale(slash, tick / 2))));
      }
    } else if (style.tick_style === 'arrow') {
      paths.push(arrowHead(b, a, tick));
      paths.push(arrowHead(a, b, tick));
    }

    out.push(`<g${attrs({ 'data-type': 'dimension', 'data-id': dimension.id })}>`);
    out.push(`  <path${attrs({
      d: paths.filter(Boolean).join(' '),
      fill: 'none',
      stroke: style.stroke,
      'stroke-width': strokeWidth,
    })}/>`);

    const label = dimension.label_override
      ?? formatLength(length, style, theme.labels.decimal_separator ?? ',');
    const mid = add(a, scale(sub(b, a), 0.5));
    const textPoint = add(mid, scale(normal, u(style.font_size_px * 0.4 + (style.text_gap_px ?? 3))));
    const angle = angleForText(direction);
    const svgPoint = toSvg(textPoint);
    out.push(`  <text${attrs({
      x: fmt(svgPoint.x), y: fmt(svgPoint.y),
      'font-size': fmt(u(style.font_size_px), 4),
      fill: style.text_color,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      transform: angle !== 0 ? `rotate(${fmt(angle, 4)} ${fmt(svgPoint.x)} ${fmt(svgPoint.y)})` : undefined,
    })}>${esc(label)}</text>`);
    out.push('</g>');
  }
  return out;
}

/**
 * Keep dimension text upright: rotate with the line, but never upside down.
 * @param {Vec} direction
 * @returns {number} rotation in SVG degrees
 */
function angleForText(direction) {
  let degrees = (Math.atan2(-direction.y, direction.x) * 180) / Math.PI;
  if (degrees > 90) degrees -= 180;
  if (degrees < -90) degrees += 180;
  return Math.abs(degrees) < 1e-9 ? 0 : degrees;
}

/**
 * @param {FloorplanDocument} doc
 * @param {any} level
 * @param {any} theme
 * @param {(px: number) => number} u
 * @returns {string[]}
 */
function renderSpaceLabels(doc, level, theme, u) {
  const style = theme.labels;
  if (!style.show_name && !style.show_area && !style.show_id) return [];
  /** @type {string[]} */
  const out = [];

  for (const space of level.spaces ?? []) {
    const polygon = (space.boundary ?? []).map(fromModel);
    if (polygon.length < 3) continue;
    const areaM2 = toSquareMetres(spaceAreaMm2(space));
    if (areaM2 < (style.min_label_area_m2 ?? 0)) continue;

    const anchor = space.label_anchor ? fromModel(space.label_anchor) : labelPoint(polygon);
    const svgAnchor = toSvg(anchor);

    const areaProvenance = resolveProvenance(doc, space, 'boundary');
    const uncertain = theme.uncertainty?.mark_estimated && !isReliable(areaProvenance);
    const prefix = uncertain ? (theme.uncertainty.estimated_prefix ?? '') : '';

    /** @type {Array<{text: string, size: number, color: string, weight?: string}>} */
    const lines = [];
    if (style.show_name) {
      const name = style.name_transform === 'uppercase' ? space.name.toUpperCase() : space.name;
      lines.push({ text: name, size: style.name_font_size_px, color: style.name_color, weight: style.name_weight });
    }
    if (style.show_area) {
      lines.push({
        text: `${prefix}${formatArea(areaM2, style)}`,
        size: style.area_font_size_px,
        color: uncertain ? (theme.uncertainty.estimated_color ?? style.area_color) : style.area_color,
      });
    }
    if (style.show_id) {
      lines.push({ text: space.id, size: style.area_font_size_px, color: style.area_color });
    }
    if (lines.length === 0) continue;

    const gap = style.line_gap_px ?? 4;
    const totalPx = lines.reduce((sum, line) => sum + line.size, 0) + gap * (lines.length - 1);
    let cursorPx = -totalPx / 2;

    out.push(`<g${attrs({ 'data-type': 'space-label', 'data-id': space.id })}>`);
    for (const line of lines) {
      const centrePx = cursorPx + line.size / 2;
      const y = svgAnchor.y + u(centrePx);
      out.push(`  <text${attrs({
        x: fmt(svgAnchor.x), y: fmt(y),
        'font-size': fmt(u(line.size), 4),
        'font-weight': line.weight && line.weight !== 'normal' ? line.weight : undefined,
        'letter-spacing': style.letter_spacing_px ? fmt(u(style.letter_spacing_px), 4) : undefined,
        fill: line.color,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      })}>${esc(line.text)}</text>`);
      cursorPx += line.size + gap;
    }
    out.push('</g>');
  }
  return out;
}

/**
 * @param {any} level
 * @param {any} theme
 * @param {(px: number) => number} u
 * @returns {string[]}
 */
function renderAnnotations(level, theme, u) {
  const style = theme.annotations;
  if (!style.show) return [];
  /** @type {string[]} */
  const out = [];
  for (const annotation of level.annotations ?? []) {
    const position = toSvg(fromModel(annotation.position));
    const rotation = annotation.rotation_deg ? -annotation.rotation_deg : 0;
    out.push(`<text${attrs({
      x: fmt(position.x), y: fmt(position.y),
      'font-size': fmt(u(style.font_size_px), 4),
      fill: style.color,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      transform: rotation !== 0 ? `rotate(${fmt(rotation, 4)} ${fmt(position.x)} ${fmt(position.y)})` : undefined,
      'data-type': 'annotation',
      'data-id': annotation.id,
    })}>${esc(annotation.text)}</text>`);
  }
  return out;
}

export { computeViewport };
