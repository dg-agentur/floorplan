/**
 * Style resolution: theme + element -> concrete drawing attributes.
 *
 * The renderer asks this module for styles and never reads the theme directly,
 * so there is exactly one place where "which colour does this wall get" is
 * decided.
 */

/**
 * @typedef {object} SurfaceStyle
 * @property {string} fill
 * @property {number} fill_opacity
 * @property {string} stroke
 * @property {number} stroke_width_px
 * @property {string} dash
 * @property {string} hatch
 * @property {string} hatch_color
 * @property {number} hatch_spacing_px
 */

/**
 * @param {any} base
 * @param {...any} overrides
 * @returns {any}
 */
function layer(base, ...overrides) {
  const out = { ...base };
  for (const override of overrides) {
    if (!override) continue;
    for (const [key, value] of Object.entries(override)) {
      if (value !== undefined && value !== null) out[key] = value;
    }
  }
  return out;
}

/**
 * @param {any} theme
 * @param {{classification?: string}} wall
 * @param {string} state
 * @returns {SurfaceStyle}
 */
export function wallStyle(theme, wall, state) {
  return layer(
    theme.walls.default,
    wall.classification ? theme.walls.by_classification?.[wall.classification] : undefined,
    theme.walls.by_state?.[state],
  );
}

/**
 * A key that identifies visually identical walls. Walls sharing a key are
 * unioned into one outline, so no seams appear between them.
 * @param {SurfaceStyle} style
 * @returns {string}
 */
export function styleKey(style) {
  return [style.fill, style.fill_opacity, style.stroke, style.stroke_width_px, style.dash, style.hatch].join('|');
}

/**
 * @param {any} theme
 * @param {{category?: string}} space
 * @returns {SurfaceStyle}
 */
export function spaceStyle(theme, space) {
  return layer(
    theme.spaces.default,
    space.category ? theme.spaces.by_category?.[space.category] : undefined,
  );
}

/**
 * @param {any} theme
 * @param {string} openingType
 * @param {string} state
 * @returns {any}
 */
export function openingStyle(theme, openingType, state) {
  const key = openingType === 'generic_opening' ? 'generic' : openingType;
  return layer(theme.openings[key] ?? {}, theme.openings.by_state?.[state]);
}

/**
 * @param {any} theme
 * @returns {any}
 */
export function stairStyle(theme) {
  return theme.stairs;
}
