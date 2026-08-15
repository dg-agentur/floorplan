/**
 * Document traversal and indexing.
 *
 * The canonical model is nested (building -> level -> collection -> element) because
 * that is what humans and agents read well. Everything that needs random access
 * builds a DocumentIndex once and uses it; the index is never cached across
 * mutations, so a stale index cannot exist.
 */

import { ELEMENT_COLLECTIONS, TYPE_TO_COLLECTION, DEFAULT_STATE, DEFAULT_WALL_HEIGHT_MM, DEFAULT_LEVEL_HEIGHT_MM } from './constants.js';
import { DomainError } from '../util/errors.js';

/** @typedef {import('./types.js').FloorplanDocument} FloorplanDocument */
/** @typedef {import('./types.js').Element} Element */
/** @typedef {import('./types.js').Level} Level */
/** @typedef {import('./types.js').Building} Building */
/** @typedef {import('./types.js').Wall} Wall */
/** @typedef {import('./types.js').Opening} Opening */
/** @typedef {import('./types.js').Space} Space */
/** @typedef {import('./types.js').ElementRef} ElementRef */

export class DocumentIndex {
  /** @param {FloorplanDocument} doc */
  constructor(doc) {
    this.doc = doc;
    /** @type {Map<string, ElementRef>} */
    this.byId = new Map();
    /** @type {Map<string, {level: Level, building: Building}>} */
    this.levels = new Map();
    /** @type {Map<string, Building>} */
    this.buildings = new Map();
    /** @type {Map<string, Opening[]>} */
    this.openingsByWall = new Map();
    /** @type {string[]} */
    this.duplicateIds = [];

    for (const building of doc.buildings ?? []) {
      if (this.buildings.has(building.id)) this.duplicateIds.push(building.id);
      this.buildings.set(building.id, building);
      for (const level of building.levels ?? []) {
        if (this.levels.has(level.id)) this.duplicateIds.push(level.id);
        this.levels.set(level.id, { level, building });
        for (const collection of ELEMENT_COLLECTIONS) {
          const items = /** @type {Element[]} */ (/** @type {any} */ (level)[collection] ?? []);
          for (const element of items) {
            if (this.byId.has(element.id) || this.levels.has(element.id) || this.buildings.has(element.id)) {
              this.duplicateIds.push(element.id);
            }
            this.byId.set(element.id, { element, level, building, collection });
          }
        }
        for (const opening of /** @type {Opening[]} */ (level.openings ?? [])) {
          const list = this.openingsByWall.get(opening.host_wall_id);
          if (list) list.push(opening);
          else this.openingsByWall.set(opening.host_wall_id, [opening]);
        }
      }
    }
  }

  /**
   * @param {string} id
   * @returns {ElementRef|undefined}
   */
  get(id) {
    return this.byId.get(id);
  }

  /**
   * @param {string} id
   * @param {string} [what] description used in the error message
   * @returns {ElementRef}
   */
  require(id, what = 'element') {
    const ref = this.byId.get(id);
    if (!ref) {
      throw new DomainError('UNKNOWN_ID', `No ${what} with id "${id}" exists in this document.`, {
        hint: 'Use `floorplan inspect <file> --json` to list the available ids.',
      });
    }
    return ref;
  }

  /**
   * @param {string} id
   * @returns {Wall}
   */
  requireWall(id) {
    const ref = this.require(id, 'wall');
    if (ref.element.type !== 'wall') {
      throw new DomainError('WRONG_ELEMENT_TYPE', `Element "${id}" is a ${ref.element.type}, not a wall.`);
    }
    return /** @type {Wall} */ (ref.element);
  }

  /**
   * @param {string} id
   * @returns {Space}
   */
  requireSpace(id) {
    const ref = this.require(id, 'space');
    if (ref.element.type !== 'space') {
      throw new DomainError('WRONG_ELEMENT_TYPE', `Element "${id}" is a ${ref.element.type}, not a space.`);
    }
    return /** @type {Space} */ (ref.element);
  }

  /**
   * @param {string} id
   * @returns {Opening}
   */
  requireOpening(id) {
    const ref = this.require(id, 'opening');
    if (ref.collection !== 'openings') {
      throw new DomainError('WRONG_ELEMENT_TYPE', `Element "${id}" is a ${ref.element.type}, not an opening.`);
    }
    return /** @type {Opening} */ (ref.element);
  }

  /**
   * @param {string} id
   * @returns {Level}
   */
  requireLevel(id) {
    const entry = this.levels.get(id);
    if (!entry) {
      throw new DomainError('UNKNOWN_LEVEL', `No level with id "${id}" exists in this document.`);
    }
    return entry.level;
  }

  /**
   * Openings hosted by a wall, in document order.
   * @param {string} wallId
   * @returns {Opening[]}
   */
  openingsOf(wallId) {
    return this.openingsByWall.get(wallId) ?? [];
  }

  /** @returns {boolean} */
  has(id) {
    return this.byId.has(id) || this.levels.has(id) || this.buildings.has(id);
  }

  /** @returns {string[]} every id used in the document, in document order */
  allIds() {
    /** @type {string[]} */
    const ids = [];
    for (const [id] of this.buildings) ids.push(id);
    for (const [id] of this.levels) ids.push(id);
    for (const [id] of this.byId) ids.push(id);
    return ids;
  }
}

/**
 * @param {FloorplanDocument} doc
 * @returns {DocumentIndex}
 */
export function indexDocument(doc) {
  return new DocumentIndex(doc);
}

/**
 * Iterate all levels in document order.
 * @param {FloorplanDocument} doc
 * @returns {Array<{level: Level, building: Building}>}
 */
export function listLevels(doc) {
  /** @type {Array<{level: Level, building: Building}>} */
  const out = [];
  for (const building of doc.buildings ?? []) {
    for (const level of building.levels ?? []) out.push({ level, building });
  }
  return out;
}

/**
 * The level a command works on when none is specified: the lowest index >= 0,
 * otherwise the first level in document order. Deterministic by construction.
 * @param {FloorplanDocument} doc
 * @param {string} [levelId]
 * @returns {Level}
 */
export function resolveLevel(doc, levelId) {
  const levels = listLevels(doc);
  if (levels.length === 0) {
    throw new DomainError('NO_LEVELS', 'Document contains no levels.');
  }
  if (levelId) {
    const found = levels.find((l) => l.level.id === levelId);
    if (!found) {
      throw new DomainError('UNKNOWN_LEVEL', `No level with id "${levelId}".`, {
        hint: `Available levels: ${levels.map((l) => l.level.id).join(', ')}`,
      });
    }
    return found.level;
  }
  const ground = levels.filter((l) => l.level.index >= 0).sort((a, b) => a.level.index - b.level.index)[0];
  return (ground ?? levels[0]).level;
}

/**
 * All elements of a level in a stable order (collection order, then document order).
 * @param {Level} level
 * @returns {Element[]}
 */
export function levelElements(level) {
  /** @type {Element[]} */
  const out = [];
  for (const collection of ELEMENT_COLLECTIONS) {
    const items = /** @type {Element[]} */ (/** @type {any} */ (level)[collection] ?? []);
    out.push(...items);
  }
  return out;
}

/**
 * Ensure a collection array exists on a level and return it.
 * @param {Level} level
 * @param {string} collection
 * @returns {any[]}
 */
export function ensureCollection(level, collection) {
  const target = /** @type {any} */ (level);
  if (!Array.isArray(target[collection])) target[collection] = [];
  return target[collection];
}

/**
 * @param {string} type
 * @returns {string}
 */
export function collectionForType(type) {
  const collection = TYPE_TO_COLLECTION[type];
  if (!collection) {
    throw new DomainError('UNKNOWN_ELEMENT_TYPE', `Unknown element type "${type}".`);
  }
  return collection;
}

/**
 * Resolved construction state of an element.
 * @param {FloorplanDocument} doc
 * @param {{state?: string}} element
 * @returns {string}
 */
export function resolveState(doc, element) {
  return element.state ?? doc.project?.defaults?.state ?? DEFAULT_STATE;
}

/**
 * Resolved wall height: wall -> project default -> level height -> hard default.
 * @param {FloorplanDocument} doc
 * @param {Wall} wall
 * @param {Level} [level]
 * @returns {number}
 */
export function resolveWallHeight(doc, wall, level) {
  return wall.height_mm
    ?? doc.project?.defaults?.wall_height_mm
    ?? level?.height_mm
    ?? DEFAULT_WALL_HEIGHT_MM;
}

/**
 * @param {Level} level
 * @returns {number}
 */
export function resolveLevelHeight(level) {
  return level.height_mm ?? DEFAULT_LEVEL_HEIGHT_MM;
}

/**
 * Derived vertical extents of a wall. Never stored (see ADR 0003).
 * @param {FloorplanDocument} doc
 * @param {Wall} wall
 * @param {Level} level
 * @returns {{bottom_z_mm: number, top_z_mm: number}}
 */
export function wallVerticalExtent(doc, wall, level) {
  const bottom = level.elevation_mm + (wall.base_z_mm ?? 0);
  return { bottom_z_mm: bottom, top_z_mm: bottom + resolveWallHeight(doc, wall, level) };
}
