/**
 * Deterministic formatting for SVG output.
 *
 * Every number that reaches the SVG goes through fmt(). No locale dependent
 * formatting, no -0, no floating point noise — that is what makes byte identical
 * golden tests possible (ARCHITECTURE.md section 6).
 */

/** Decimal places kept in path coordinates. Model units are millimetres. */
const COORD_DECIMALS = 2;

/**
 * @param {number} value
 * @param {number} [decimals]
 * @returns {string}
 */
export function fmt(value, decimals = COORD_DECIMALS) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number(value.toFixed(decimals));
  const normalised = Object.is(rounded, -0) ? 0 : rounded;
  return String(normalised);
}

/**
 * @param {{x: number, y: number}} point
 * @returns {string} "x y" in SVG coordinates (Y already flipped by the caller)
 */
export function pt(point) {
  return `${fmt(point.x)} ${fmt(point.y)}`;
}

/**
 * XML text escaping, including the characters that matter inside attributes.
 * @param {string} value
 * @returns {string}
 */
export function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Serialise SVG attributes in a stable order (insertion order of the object).
 * Attributes with value undefined or null are omitted.
 * @param {Record<string, string|number|undefined|null>} attributes
 * @returns {string}
 */
export function attrs(attributes) {
  const parts = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}="${esc(String(value))}"`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/**
 * Convert a theme dash pattern from px to user units.
 *
 * Themes express every visual weight in pixels, but the SVG user space is
 * millimetres, so a dash array has to be scaled exactly like a stroke width —
 * otherwise a "7 4" pattern becomes an invisible 7 mm dash on a 12 m plan.
 *
 * @param {string|undefined} dash
 * @param {(px: number) => number} u
 * @returns {string|undefined}
 */
export function dashArray(dash, u) {
  if (!dash) return undefined;
  const parts = dash.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.map((part) => fmt(u(Number(part)), 4)).join(' ');
}

/**
 * Format an area for a label, honouring the theme's decimal separator.
 * @param {number} squareMetres
 * @param {{area_decimals: number, area_suffix: string, decimal_separator: string}} labelTheme
 * @returns {string}
 */
export function formatArea(squareMetres, labelTheme) {
  const text = squareMetres.toFixed(labelTheme.area_decimals);
  const separated = labelTheme.decimal_separator === '.'
    ? text
    : text.replace('.', labelTheme.decimal_separator);
  return `${separated}${labelTheme.area_suffix}`;
}

/**
 * Format a length for a dimension label.
 * @param {number} millimetres
 * @param {{format: 'mm'|'cm'|'m', decimals: number}} dimensionTheme
 * @param {string} [decimalSeparator]
 * @returns {string}
 */
export function formatLength(millimetres, dimensionTheme, decimalSeparator = ',') {
  const divisor = dimensionTheme.format === 'm' ? 1000 : dimensionTheme.format === 'cm' ? 10 : 1;
  const value = millimetres / divisor;
  const text = value.toFixed(dimensionTheme.decimals);
  const separated = decimalSeparator === '.' ? text : text.replace('.', decimalSeparator);
  return dimensionTheme.format === 'mm' ? separated : `${separated} ${dimensionTheme.format}`;
}
