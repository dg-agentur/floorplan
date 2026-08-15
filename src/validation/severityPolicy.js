/**
 * Rule severity per quality level (docs/adr/0015-quality-levels.md).
 *
 * Rules report facts; this table decides how serious they are. Keeping the
 * matrix in one place is what makes the quality levels a real mechanism instead
 * of a label: raising a document from `marketing` to `verified` is only possible
 * if the same findings stop appearing.
 */

import { QUALITY_LEVELS } from '../model/constants.js';
import { FloorplanError } from '../util/errors.js';

const E = 'ERROR';
const W = 'WARNING';
const I = 'INFO';

/**
 * @type {Record<string, {marketing: string, scaled: string, verified: string, description: string}>}
 */
export const SEVERITY_POLICY = {
  // --- structural integrity: always fatal -----------------------------------
  SCHEMA_VIOLATION: { marketing: E, scaled: E, verified: E, description: 'Document does not match the JSON schema.' },
  DUPLICATE_ID: { marketing: E, scaled: E, verified: E, description: 'An id is used more than once.' },
  UNKNOWN_HOST_WALL: { marketing: E, scaled: E, verified: E, description: 'An opening references a wall that does not exist.' },
  HOST_WALL_OTHER_LEVEL: { marketing: E, scaled: E, verified: E, description: 'An opening and its host wall are on different levels.' },
  UNKNOWN_SPACE_REF: { marketing: E, scaled: E, verified: E, description: 'A reference points to a space that does not exist.' },
  UNKNOWN_LEVEL_REF: { marketing: E, scaled: E, verified: E, description: 'A reference points to a level that does not exist.' },
  UNKNOWN_SOURCE_REF: { marketing: W, scaled: E, verified: E, description: 'source_id does not appear in the document sources.' },
  NON_FINITE_NUMBER: { marketing: E, scaled: E, verified: E, description: 'A numeric value is NaN or Infinity.' },
  LEVEL_INDEX_DUPLICATE: { marketing: W, scaled: E, verified: E, description: 'Two levels of one building share the same index.' },

  // --- geometry -------------------------------------------------------------
  WALL_ZERO_LENGTH: { marketing: E, scaled: E, verified: E, description: 'A wall has (almost) no length.' },
  OPENING_OUTSIDE_WALL: { marketing: E, scaled: E, verified: E, description: 'An opening does not fit inside its host wall.' },
  OPENING_WIDER_THAN_WALL: { marketing: E, scaled: E, verified: E, description: 'An opening is wider than its host wall is long.' },
  OPENING_OVERLAP: { marketing: E, scaled: E, verified: E, description: 'Two openings on the same wall overlap.' },
  SPACE_SELF_INTERSECTING: { marketing: E, scaled: E, verified: E, description: 'A space boundary crosses itself.' },
  SPACE_DEGENERATE: { marketing: E, scaled: E, verified: E, description: 'A space boundary encloses no area.' },
  SPACE_OVERLAP: { marketing: W, scaled: E, verified: E, description: 'Two spaces of one level overlap.' },
  SPACE_BOUNDARY_OFF_WALL: { marketing: I, scaled: W, verified: E, description: 'A space boundary edge does not follow a wall face.' },
  SPACE_AREA_MISMATCH: { marketing: I, scaled: W, verified: E, description: 'A declared area deviates from the polygon area.' },
  WALL_ENDPOINTS_NEAR_MISS: { marketing: W, scaled: E, verified: E, description: 'Two wall ends nearly, but not exactly, coincide.' },
  WALL_FREE_END: { marketing: I, scaled: W, verified: W, description: 'A wall end connects to nothing.' },
  OPENING_NEAR_WALL_END: { marketing: I, scaled: W, verified: W, description: 'An opening leaves almost no wall next to it.' },
  STAIR_RUN_OUTSIDE_FOOTPRINT: { marketing: W, scaled: W, verified: E, description: 'The stair run axis is not inside its footprint.' },
  WINDOW_ABOVE_WALL: { marketing: W, scaled: W, verified: E, description: 'Sill plus opening height exceeds the wall height.' },

  // --- topology -------------------------------------------------------------
  OPENING_CONNECTIVITY_MISMATCH: { marketing: W, scaled: E, verified: E, description: 'connects_space_ids contradicts the geometry.' },
  OPENING_WITHOUT_SPACE: { marketing: I, scaled: I, verified: W, description: 'No space could be found on either side of an opening.' },
  SPACE_ISOLATED: { marketing: I, scaled: W, verified: W, description: 'A space has no walkable connection at all.' },
  PLAN_DISCONNECTED: { marketing: I, scaled: W, verified: W, description: 'The plan falls apart into several unconnected groups of rooms.' },
  SPACE_WITHOUT_EXIT: { marketing: I, scaled: I, verified: W, description: 'A space cannot reach the outside through openings.' },

  // --- provenance and quality ----------------------------------------------
  PROVENANCE_ESTIMATED: { marketing: I, scaled: W, verified: E, description: 'Dimensions are estimated rather than measured.' },
  PROVENANCE_UNKNOWN: { marketing: I, scaled: E, verified: E, description: 'The origin of dimensions is unknown.' },
  MISSING_SCALE_REFERENCE: { marketing: I, scaled: E, verified: E, description: 'No reliable dimension anywhere in the document.' },
  GEOMETRY_NOT_ANCHORED: { marketing: I, scaled: E, verified: E, description: 'Only annotations are reliable; no wall, opening or space carries a dependable dimension.' },
  UNVERIFIED_VALUES: { marketing: I, scaled: I, verified: W, description: 'Values are reliable but not explicitly verified.' },

  // --- architectural plausibility (never a legal statement) ------------------
  DOOR_WIDTH_UNUSUAL: { marketing: I, scaled: I, verified: I, description: 'A door width lies outside the usual range.' },
  WALL_THICKNESS_UNUSUAL: { marketing: I, scaled: I, verified: I, description: 'A wall thickness lies outside the usual range.' },
  SPACE_WITHOUT_CATEGORY: { marketing: I, scaled: I, verified: I, description: 'A space has no category.' },
  EMPTY_LEVEL: { marketing: I, scaled: I, verified: I, description: 'A level contains no elements.' },
};

/**
 * @param {string} rule
 * @param {string} quality
 * @returns {string} ERROR | WARNING | INFO
 */
export function severityFor(rule, quality) {
  const entry = SEVERITY_POLICY[rule];
  if (!entry) {
    throw new FloorplanError('UNKNOWN_RULE', `No severity policy defined for rule "${rule}".`, {
      exitCode: 3,
      hint: 'Add the rule to src/validation/severityPolicy.js. Rules must never invent their own severity.',
    });
  }
  if (!(/** @type {readonly string[]} */ (QUALITY_LEVELS).includes(quality))) {
    throw new FloorplanError('UNKNOWN_QUALITY_LEVEL', `Unknown quality level "${quality}".`, {
      hint: `Expected one of: ${QUALITY_LEVELS.join(', ')}`,
    });
  }
  return /** @type {any} */ (entry)[quality];
}

/**
 * @returns {Array<{rule: string, description: string, marketing: string, scaled: string, verified: string}>}
 */
export function listRules() {
  return Object.entries(SEVERITY_POLICY)
    .map(([rule, entry]) => ({ rule, ...entry }))
    .sort((a, b) => (a.rule < b.rule ? -1 : 1));
}
