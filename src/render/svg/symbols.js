/**
 * Drawing symbols for openings and stairs.
 *
 * Every symbol is derived from the model geometry — never from hard coded
 * offsets — and returns plain SVG fragments. The wall gap itself is produced by
 * the wall segmentation (src/geometry/wallGeometry.js); the symbols only add what
 * sits inside the gap.
 */

import { add, distance, normalize, scale, sub } from '../../geometry/vec.js';
import { attrs, dashArray, fmt, pt } from '../format.js';

/** @typedef {import('../../geometry/vec.js').Vec} Vec */

/**
 * Flip model coordinates into SVG coordinates (Y grows downwards).
 * @param {Vec} v
 * @returns {Vec}
 */
export function toSvg(v) {
  return { x: v.x, y: -v.y };
}

/**
 * @param {Vec[]} points
 * @returns {string}
 */
export function polygonPath(points) {
  return `M ${points.map((p) => pt(toSvg(p))).join(' L ')} Z`;
}

/**
 * @param {Vec} a
 * @param {Vec} b
 * @returns {string}
 */
export function linePath(a, b) {
  return `M ${pt(toSvg(a))} L ${pt(toSvg(b))}`;
}

/**
 * Quarter circle arc from `from` to `to` around `centre`.
 * The sweep flag is derived from the cross product in SVG space, so the arc
 * always bulges the way the door actually opens.
 * @param {Vec} centre
 * @param {Vec} from
 * @param {Vec} to
 * @returns {string}
 */
export function arcPath(centre, from, to) {
  const c = toSvg(centre);
  const p1 = toSvg(from);
  const p2 = toSvg(to);
  const radius = distance(c, p1);
  const cross = (p1.x - c.x) * (p2.y - c.y) - (p1.y - c.y) * (p2.x - c.x);
  const sweep = cross > 0 ? 1 : 0;
  return `M ${pt(p1)} A ${fmt(radius)} ${fmt(radius)} 0 0 ${sweep} ${pt(p2)}`;
}

/**
 * @typedef {object} SymbolContext
 * @property {any} theme
 * @property {any} style          resolved opening style
 * @property {(px: number) => number} u px -> user units
 * @property {import('../../geometry/wallGeometry.js').WallGeometry} wallGeometry
 * @property {import('../../geometry/wallGeometry.js').OpeningGeometry} geometry
 * @property {any} opening
 */

/**
 * Door: leaf plus opening arc.
 * @param {SymbolContext} ctx
 * @returns {string[]}
 */
export function doorSymbol(ctx) {
  const { opening, geometry, wallGeometry, style, u } = ctx;
  /** @type {string[]} */
  const out = [];

  const [r0, r1, l1, l0] = geometry.quad;
  const width = distance(r0, r1);
  if (width < 1) return out;

  const doorType = opening.door_type ?? 'swing';
  const swing = opening.swing;
  // hinge defaults to the start-near edge; that only shifts the symbol, whereas
  // an unknown swing side would invent which way the door opens (see docs/rendering.md).
  const hinge = opening.hinge ?? 'left';

  if (doorType === 'sliding' || doorType === 'pocket') {
    return slidingLeaf(ctx);
  }
  if (doorType === 'garage' || doorType === 'revolving' || doorType === 'folding') {
    return plainLeaf(ctx);
  }
  if (swing === undefined || swing === 'none') {
    // The model does not say which way this door opens. Drawing an arc anyway
    // would invent information, so the leaf is shown closed.
    return plainLeaf(ctx);
  }

  const leaves = doorType === 'double'
    ? [
      { hinge: 'left', from: 0, to: 0.5 },
      { hinge: 'right', from: 0.5, to: 1 },
    ]
    : [{ hinge, from: 0, to: 1 }];

  for (const leaf of leaves) {
    const sideStart = swing === 'left' ? l0 : r0;
    const sideEnd = swing === 'left' ? l1 : r1;
    const along = sub(sideEnd, sideStart);
    const a = add(sideStart, scale(along, leaf.from));
    const b = add(sideStart, scale(along, leaf.to));
    const hingePoint = leaf.hinge === 'left' ? a : b;
    const freeJamb = leaf.hinge === 'left' ? b : a;
    const leafWidth = distance(a, b);
    if (leafWidth < 1) continue;

    const outward = scale(wallGeometry.normal, swing === 'left' ? 1 : -1);
    const tip = add(hingePoint, scale(outward, leafWidth));

    if (style.show_leaf !== false) {
      const thickness = Math.max(1, style.leaf_thickness_mm ?? 40);
      const alongUnit = normalize(sub(freeJamb, hingePoint));
      const leafPolygon = [
        hingePoint,
        tip,
        add(tip, scale(alongUnit, thickness)),
        add(hingePoint, scale(alongUnit, thickness)),
      ];
      out.push(`<path${attrs({
        d: polygonPath(leafPolygon),
        fill: style.leaf_fill ?? 'none',
        stroke: style.leaf_stroke,
        'stroke-width': fmt(u(style.leaf_stroke_width_px ?? 1), 4),
        'stroke-dasharray': dashArray(style.dash, u),
        'stroke-linejoin': 'miter',
      })}/>`);
    }

    if (style.show_arc !== false) {
      out.push(`<path${attrs({
        d: arcPath(hingePoint, tip, freeJamb),
        fill: 'none',
        stroke: style.arc_stroke,
        'stroke-width': fmt(u(style.arc_stroke_width_px ?? 0.8), 4),
        'stroke-dasharray': dashArray(style.arc_dash, u),
      })}/>`);
    }
  }

  return out;
}

/**
 * Sliding door: leaf drawn parallel to the wall, offset to one side.
 * @param {SymbolContext} ctx
 * @returns {string[]}
 */
function slidingLeaf(ctx) {
  const { geometry, wallGeometry, style, u, opening } = ctx;
  const [r0, r1, l1, l0] = geometry.quad;
  const side = (opening.swing ?? 'left') === 'right' ? -1 : 1;
  const base0 = side > 0 ? l0 : r0;
  const base1 = side > 0 ? l1 : r1;
  const offset = scale(wallGeometry.normal, side * (style.sliding_offset_mm ?? 60));
  const thickness = Math.max(1, style.leaf_thickness_mm ?? 40);
  const outward = scale(wallGeometry.normal, side * thickness);
  const a = add(base0, offset);
  const b = add(base1, offset);
  return [`<path${attrs({
    d: polygonPath([a, b, add(b, outward), add(a, outward)]),
    fill: style.leaf_fill ?? 'none',
    stroke: style.leaf_stroke,
    'stroke-width': fmt(u(style.leaf_stroke_width_px ?? 1), 4),
    'stroke-dasharray': dashArray(style.dash, u),
  })}/>`];
}

/**
 * Fallback leaf for door types without a standard swing symbol
 * (garage, folding, revolving): the leaf is shown in the closed position.
 * @param {SymbolContext} ctx
 * @returns {string[]}
 */
function plainLeaf(ctx) {
  const { geometry, style, u } = ctx;
  const [r0, r1, l1, l0] = geometry.quad;
  const inset = 0.25;
  const a = add(r0, scale(sub(l0, r0), 0.5 - inset));
  const b = add(r1, scale(sub(l1, r1), 0.5 - inset));
  const c = add(r1, scale(sub(l1, r1), 0.5 + inset));
  const d = add(r0, scale(sub(l0, r0), 0.5 + inset));
  return [`<path${attrs({
    d: polygonPath([a, b, c, d]),
    fill: style.leaf_fill ?? 'none',
    stroke: style.leaf_stroke,
    'stroke-width': fmt(u(style.leaf_stroke_width_px ?? 1), 4),
    'stroke-dasharray': dashArray(style.dash, u),
  })}/>`];
}

/**
 * Window: frame lines running along the wall inside the opening, plus the
 * reveals that close the gap at both ends.
 * @param {SymbolContext} ctx
 * @returns {string[]}
 */
export function windowSymbol(ctx) {
  const { geometry, style, u } = ctx;
  const [r0, r1, l1, l0] = geometry.quad;
  /** @type {string[]} */
  const out = [];
  const strokeWidth = fmt(u(style.stroke_width_px ?? 1), 4);

  if (style.fill && style.fill !== 'none') {
    out.push(`<path${attrs({ d: polygonPath([r0, r1, l1, l0]), fill: style.fill, stroke: 'none' })}/>`);
  }

  /** @param {number} t @returns {[Vec, Vec]} */
  const lineAt = (t) => [add(r0, scale(sub(l0, r0), t)), add(r1, scale(sub(l1, r1), t))];

  /** @type {number[]} */
  let fractions;
  if (style.style === 'single_line') {
    fractions = [0.5];
  } else if (style.style === 'frame') {
    fractions = [0, 1];
  } else {
    const ratio = Math.min(0.49, Math.max(0, style.frame_ratio ?? 0.28));
    fractions = [0, ratio, 1 - ratio, 1];
  }

  for (const t of fractions) {
    const [a, b] = lineAt(t);
    out.push(`<path${attrs({
      d: linePath(a, b), fill: 'none', stroke: style.stroke, 'stroke-width': strokeWidth,
    })}/>`);
  }

  const revealStroke = style.reveal_stroke ?? style.stroke;
  const revealWidth = fmt(u(style.reveal_stroke_width_px ?? style.stroke_width_px ?? 1), 4);
  for (const reveal of [geometry.startReveal, geometry.endReveal]) {
    out.push(`<path${attrs({
      d: linePath(reveal[0], reveal[1]), fill: 'none', stroke: revealStroke, 'stroke-width': revealWidth,
    })}/>`);
  }
  return out;
}

/**
 * Passage: an opening without a leaf. The wall gap already carries the meaning;
 * the theme decides whether the jambs are emphasised.
 * @param {SymbolContext} ctx
 * @returns {string[]}
 */
export function passageSymbol(ctx) {
  const { geometry, style, u } = ctx;
  const mode = style.style ?? 'reveal';
  if (mode === 'none') return [];
  /** @type {string[]} */
  const out = [];
  const strokeWidth = fmt(u(style.stroke_width_px ?? 1), 4);
  const dash = mode === 'dashed' ? (style.dash || '6 4') : (style.dash || undefined);

  for (const reveal of [geometry.startReveal, geometry.endReveal]) {
    out.push(`<path${attrs({
      d: linePath(reveal[0], reveal[1]),
      fill: 'none',
      stroke: style.stroke,
      'stroke-width': strokeWidth,
      'stroke-dasharray': dashArray(dash, u),
    })}/>`);
  }
  if (mode === 'threshold') {
    const [r0] = geometry.quad;
    const r1 = geometry.quad[1];
    const l1 = geometry.quad[2];
    const l0 = geometry.quad[3];
    const midA = add(r0, scale(sub(l0, r0), 0.5));
    const midB = add(r1, scale(sub(l1, r1), 0.5));
    out.push(`<path${attrs({
      d: linePath(midA, midB), fill: 'none', stroke: style.stroke, 'stroke-width': strokeWidth,
    })}/>`);
  }
  return out;
}

/**
 * Generic opening: deliberately marked as "we do not know what this is".
 * @param {SymbolContext} ctx
 * @returns {string[]}
 */
export function genericOpeningSymbol(ctx) {
  const { geometry, style, u } = ctx;
  if ((style.style ?? 'hatched') === 'none') return [];
  const [r0, r1, l1, l0] = geometry.quad;
  return [`<path${attrs({
    d: polygonPath([r0, r1, l1, l0]),
    fill: 'none',
    stroke: style.stroke,
    'stroke-width': fmt(u(style.stroke_width_px ?? 1), 4),
    'stroke-dasharray': dashArray(style.dash || '4 3', u),
  })}/>`];
}

/**
 * Arrow head at the end of a line, sized in user units.
 * @param {Vec} from
 * @param {Vec} to
 * @param {number} size
 * @returns {string}
 */
export function arrowHead(from, to, size) {
  const direction = normalize(sub(to, from));
  if (direction.x === 0 && direction.y === 0) return '';
  const back = scale(direction, -size);
  const side = { x: -direction.y * size * 0.4, y: direction.x * size * 0.4 };
  const p1 = add(add(to, back), side);
  const p2 = add(add(to, back), scale(side, -1));
  return `M ${pt(toSvg(p1))} L ${pt(toSvg(to))} L ${pt(toSvg(p2))}`;
}
