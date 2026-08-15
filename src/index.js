/**
 * Public JavaScript API of the floorplan platform.
 *
 * The CLI is the primary interface (docs/adr/0013-cli-contract.md) — it is the one
 * every agent platform can drive. This module exists for programs that embed the
 * core directly, and it exposes exactly the same capabilities.
 *
 *   import { loadDocument, validateDocument, applyOperations, renderSvg, loadTheme }
 *     from 'floorplan-platform';
 *
 *   const { document } = loadDocument('plan.floorplan.json');
 *   const report = validateDocument(document);
 *   const { document: next } = applyOperations(document, [
 *     { op: 'move_opening', target_id: 'door_014', offset_delta_mm: 800 },
 *   ]);
 *   const { svg } = renderSvg(next, loadTheme('marketing'));
 */

// --- versions and vocabularies ----------------------------------------------
export {
  SCHEMA_VERSION, OPERATIONS_SCHEMA_VERSION, OBSERVATIONS_SCHEMA_VERSION, UNIT,
  TOLERANCE_MM, AREA_TOLERANCE_RATIO,
  STATES, PROVENANCE_VALUES, QUALITY_LEVELS, WALL_CLASSIFICATIONS,
  OPENING_TYPES, DOOR_TYPES, WINDOW_TYPES, SPACE_CATEGORIES, SEVERITIES,
} from './model/constants.js';

// --- documents ---------------------------------------------------------------
export {
  loadDocument, parseDocument, saveDocument, loadSchema, getSchemaValidator,
  checkSchemaVersion, readJsonFile, writeJsonFile, writeTextFile, PACKAGE_ROOT, SCHEMA_NAMES,
} from './model/io.js';

export {
  DocumentIndex, indexDocument, listLevels, resolveLevel, levelElements,
  resolveState, resolveWallHeight, resolveLevelHeight, wallVerticalExtent,
} from './model/document.js';

export { resolveProvenance, isReliable, elementProvenance, DIMENSIONAL_PROPERTIES } from './model/provenance.js';
export { generateId, createIdAllocator, isValidId } from './model/ids.js';
export {
  spaceAreaMm2, spacePerimeterMm, toSquareMetres, checkAreaOverride, levelMetrics,
} from './model/measure.js';

// --- geometry ------------------------------------------------------------------
export * as vec from './geometry/vec.js';
export * as polygon from './geometry/polygon.js';
export * as segment from './geometry/segment.js';
export { buildWallGeometry, wallLength, wallDirection, wallNormal, pointOnWall, openingSpan } from './geometry/wallGeometry.js';
export { unionOutline } from './geometry/outline.js';
export { levelBounds, expandBounds } from './geometry/bounds.js';
export { splitPolygonByLine, mergePolygons } from './geometry/polygonOps.js';

// --- topology --------------------------------------------------------------------
export {
  OUTSIDE, buildConnectivityGraph, deriveOpeningConnections, adjacency,
  reachableFrom, findPath, components, isolatedSpaces,
} from './topology/connectivity.js';

// --- validation ---------------------------------------------------------------------
export { validateDocument, assertValid } from './validation/validate.js';
export { SEVERITY_POLICY, severityFor, listRules } from './validation/severityPolicy.js';
export { SchemaValidator, compileSchema } from './validation/schemaValidator.js';

// --- operations ------------------------------------------------------------------------
export { applyOperations, undoOperations, normaliseOperationInput } from './operations/apply.js';
export { OPERATIONS, listOperations, getOperation, buildOperationsSchema } from './operations/registry.js';

// --- rendering and themes ------------------------------------------------------------------
export { renderSvg } from './render/svg/renderer.js';
export { computeViewport } from './render/layout.js';
export { loadTheme, listThemes, readThemeFile, resolveThemePath, mergeDeep } from './themes/load.js';
export { DEFAULT_THEME } from './themes/defaults.js';
export { parseYaml } from './themes/yaml.js';

// --- import -----------------------------------------------------------------------------------
export { reconcileObservations } from './importers/observations/reconcile.js';

// --- utilities ---------------------------------------------------------------------------------
export { stringifyStable, canonicalise, parseJson, deepClone } from './util/json.js';
export { digest } from './util/hash.js';
export { FloorplanError, UsageError, DomainError, OperationError } from './util/errors.js';

// --- CLI (for embedding) --------------------------------------------------------------------------
export { run as runCli } from './cli/main.js';
