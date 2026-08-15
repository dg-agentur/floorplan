/**
 * Viewport computation.
 *
 * The SVG coordinate system IS the model coordinate system in millimetres, with
 * the Y axis flipped (model Y up, SVG Y down). Consequences:
 *   - coordinates in the output file are readable millimetres, which makes the
 *     SVG inspectable and diffable
 *   - the drawing scales through width/height and viewBox alone
 *   - visual weights (line widths, font sizes) are given in px by the theme and
 *     divided by px_per_mm so they stay constant at any scale
 */

import { expandBounds, levelBounds } from '../geometry/bounds.js';

/**
 * @typedef {object} Viewport
 * @property {number} min_x_mm
 * @property {number} min_y_mm
 * @property {number} max_x_mm
 * @property {number} max_y_mm
 * @property {number} width_mm
 * @property {number} height_mm
 * @property {number} px_per_mm
 * @property {number} width_px
 * @property {number} height_px
 * @property {string} view_box
 * @property {(px: number) => number} u  px -> user units (millimetres)
 */

/**
 * @param {import('../model/types.js').Level} level
 * @param {any} theme
 * @param {{padding_mm?: number}} [options]
 * @returns {Viewport}
 */
export function computeViewport(level, theme, options = {}) {
  const margin = options.padding_mm ?? theme.page.margin_mm ?? 0;
  const raw = levelBounds(level);
  const bounds = raw.empty
    ? { min_x_mm: 0, min_y_mm: 0, max_x_mm: 1000, max_y_mm: 1000, width_mm: 1000, height_mm: 1000, empty: false }
    : expandBounds(raw, margin);

  const pxPerMm = resolveScale(bounds.width_mm, theme);
  const widthPx = round4(bounds.width_mm * pxPerMm);
  const heightPx = round4(bounds.height_mm * pxPerMm);

  // SVG y grows downwards, so the top of the drawing is -max_y.
  const viewBox = `${round4(bounds.min_x_mm)} ${round4(-bounds.max_y_mm)} ${round4(bounds.width_mm)} ${round4(bounds.height_mm)}`;

  return {
    ...bounds,
    px_per_mm: pxPerMm,
    width_px: widthPx,
    height_px: heightPx,
    view_box: viewBox,
    u: (px) => px / pxPerMm,
  };
}

/**
 * @param {number} widthMm
 * @param {any} theme
 * @returns {number}
 */
function resolveScale(widthMm, theme) {
  const page = theme.page;
  if (page.scale_mode === 'fixed' || widthMm <= 0) {
    return clamp(page.px_per_mm, page.min_px_per_mm, page.max_px_per_mm);
  }
  return clamp(round6(page.target_width_px / widthMm), page.min_px_per_mm, page.max_px_per_mm);
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min ?? value), max ?? value);
}

/** @param {number} value @returns {number} */
function round4(value) {
  return Math.round(value * 10000) / 10000;
}

/** @param {number} value @returns {number} */
function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}
