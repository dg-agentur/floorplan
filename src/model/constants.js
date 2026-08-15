/**
 * Single source of truth for versions, enumerations and tolerances.
 * Nothing in this codebase may invent a local tolerance value.
 */

export const SCHEMA_VERSION = '0.1';
export const OPERATIONS_SCHEMA_VERSION = '0.1';
export const OBSERVATIONS_SCHEMA_VERSION = '0.1';

/** The one and only unit of the model. */
export const UNIT = 'mm';

/**
 * Geometric tolerances. All in millimetres unless stated otherwise.
 * Rationale: the model stores integer millimetres, so 1 mm is the smallest
 * meaningful difference; anything below is rounding, not intent.
 */
export const TOLERANCE_MM = 1;
/** Maximum distance for "this point lies on that line" during wall joins. */
export const COLLINEARITY_TOLERANCE_MM = 2;
/** Maximum angular deviation (degrees) for "these walls are parallel". */
export const PARALLEL_TOLERANCE_DEG = 0.5;
/** Relative deviation allowed between a declared area and the polygon area. */
export const AREA_TOLERANCE_RATIO = 0.02;
/** How far a space boundary edge may sit from a wall face before it is reported. */
export const SPACE_WALL_SNAP_MM = 30;

/** Fallbacks used when neither the element nor project.defaults specify a value. */
export const DEFAULT_STATE = 'existing';
export const DEFAULT_PROVENANCE = 'unknown';
export const DEFAULT_WALL_HEIGHT_MM = 2500;
export const DEFAULT_LEVEL_HEIGHT_MM = 2500;

export const STATES = /** @type {const} */ (['existing', 'planned', 'new', 'demolish', 'unknown']);
export const PROVENANCE_VALUES = /** @type {const} */ ([
  'provided', 'measured', 'parsed', 'derived', 'estimated', 'unknown',
]);
/** Provenance values considered dimensionally reliable. */
export const RELIABLE_PROVENANCE = /** @type {const} */ (['provided', 'measured', 'parsed']);
export const QUALITY_LEVELS = /** @type {const} */ (['marketing', 'scaled', 'verified']);

export const WALL_CLASSIFICATIONS = /** @type {const} */ ([
  'exterior', 'interior', 'partition', 'structural', 'retaining', 'virtual',
]);
export const OPENING_TYPES = /** @type {const} */ (['door', 'window', 'passage', 'generic_opening']);
export const DOOR_TYPES = /** @type {const} */ ([
  'swing', 'double', 'sliding', 'pocket', 'folding', 'garage', 'revolving',
]);
export const WINDOW_TYPES = /** @type {const} */ ([
  'fixed', 'casement', 'tilt_turn', 'sliding', 'french', 'skylight',
]);
export const SPACE_CATEGORIES = /** @type {const} */ ([
  'living', 'bedroom', 'kitchen', 'dining', 'bath', 'wc', 'hall', 'corridor',
  'office', 'storage', 'technical', 'garage', 'stairwell', 'balcony', 'terrace',
  'outdoor', 'other',
]);
export const SHAFT_KINDS = /** @type {const} */ (['elevator', 'duct', 'chimney', 'plumbing', 'other']);

/** Ordered list of element collections inside a level. Iteration order is part of the contract. */
export const ELEMENT_COLLECTIONS = /** @type {const} */ ([
  'walls', 'openings', 'spaces', 'columns', 'stairs', 'shafts', 'dimensions', 'annotations',
]);

/** Maps an element type to the collection that holds it. */
export const TYPE_TO_COLLECTION = /** @type {Record<string, string>} */ ({
  wall: 'walls',
  door: 'openings',
  window: 'openings',
  passage: 'openings',
  generic_opening: 'openings',
  space: 'spaces',
  column: 'columns',
  stair: 'stairs',
  shaft: 'shafts',
  dimension: 'dimensions',
  annotation: 'annotations',
});

/** Prefix used when generating an id for a given element type. */
export const TYPE_TO_ID_PREFIX = /** @type {Record<string, string>} */ ({
  wall: 'wall',
  door: 'door',
  window: 'window',
  passage: 'passage',
  generic_opening: 'opening',
  space: 'space',
  column: 'column',
  stair: 'stair',
  shaft: 'shaft',
  dimension: 'dim',
  annotation: 'note',
  level: 'level',
  building: 'building',
});

/** Severity levels, ordered from most to least severe. */
export const SEVERITIES = /** @type {const} */ (['ERROR', 'WARNING', 'INFO']);
