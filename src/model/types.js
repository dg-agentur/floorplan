/**
 * Type definitions for the canonical model.
 *
 * These mirror schema/floorplan.schema.json. The schema is the normative
 * contract; these typedefs exist so that `npx tsc --noEmit` can check the
 * implementation without a build step (see docs/adr/0001-language-and-runtime.md).
 *
 * This module intentionally exports nothing at runtime.
 */

/**
 * @typedef {'existing'|'planned'|'new'|'demolish'|'unknown'} State
 * @typedef {'provided'|'measured'|'parsed'|'derived'|'estimated'|'unknown'} Provenance
 * @typedef {'marketing'|'scaled'|'verified'} Quality
 * @typedef {'exterior'|'interior'|'partition'|'structural'|'retaining'|'virtual'} WallClassification
 * @typedef {'door'|'window'|'passage'|'generic_opening'} OpeningType
 */

/**
 * @typedef {object} Point
 * @property {number} x_mm
 * @property {number} y_mm
 */

/**
 * @typedef {object} PropertyProvenance
 * @property {Provenance} provenance
 * @property {number} [confidence]
 * @property {boolean} [verified]
 * @property {string} [source_id]
 * @property {string} [note]
 */

/**
 * @typedef {object} ProvenanceFields
 * @property {Provenance} [provenance]
 * @property {number} [confidence]
 * @property {boolean} [verified]
 * @property {Record<string, PropertyProvenance>} [property_provenance]
 * @property {string} [source_id]
 * @property {string[]} [observation_ids]
 */

/**
 * @typedef {ProvenanceFields & {
 *   id: string,
 *   type: 'wall',
 *   name?: string,
 *   start: Point,
 *   end: Point,
 *   thickness_mm: number,
 *   height_mm?: number,
 *   base_z_mm?: number,
 *   classification?: WallClassification,
 *   material?: string,
 *   state?: State,
 *   tags?: string[],
 *   meta?: Record<string, unknown>,
 * }} Wall
 */

/**
 * @typedef {ProvenanceFields & {
 *   id: string,
 *   type: OpeningType,
 *   name?: string,
 *   host_wall_id: string,
 *   offset_mm: number,
 *   width_mm: number,
 *   height_mm?: number,
 *   sill_mm?: number,
 *   door_type?: 'swing'|'double'|'sliding'|'pocket'|'folding'|'garage'|'revolving',
 *   hinge?: 'left'|'right',
 *   swing?: 'left'|'right'|'none',
 *   window_type?: 'fixed'|'casement'|'tilt_turn'|'sliding'|'french'|'skylight',
 *   has_threshold?: boolean,
 *   connects_space_ids?: string[],
 *   state?: State,
 *   tags?: string[],
 *   meta?: Record<string, unknown>,
 * }} Opening
 */

/**
 * @typedef {ProvenanceFields & {
 *   id: string,
 *   type: 'space',
 *   name: string,
 *   category?: string,
 *   boundary: Point[],
 *   height_mm?: number,
 *   area_override_mm2?: number,
 *   label_anchor?: Point,
 *   state?: State,
 *   tags?: string[],
 *   meta?: Record<string, unknown>,
 * }} Space
 */

/**
 * @typedef {ProvenanceFields & {
 *   id: string, type: 'column', name?: string, shape: 'rect'|'circle', center: Point,
 *   width_mm?: number, depth_mm?: number, diameter_mm?: number, rotation_deg?: number,
 *   height_mm?: number, state?: State, tags?: string[], meta?: Record<string, unknown>
 * }} Column
 */

/**
 * @typedef {ProvenanceFields & {
 *   id: string, type: 'stair', name?: string, footprint: Point[], run_start: Point, run_end: Point,
 *   step_count?: number, direction?: 'up'|'down', to_level_id?: string,
 *   state?: State, tags?: string[], meta?: Record<string, unknown>
 * }} Stair
 */

/**
 * @typedef {ProvenanceFields & {
 *   id: string, type: 'shaft', name?: string, boundary: Point[],
 *   shaft_kind: 'elevator'|'duct'|'chimney'|'plumbing'|'other',
 *   state?: State, tags?: string[], meta?: Record<string, unknown>
 * }} Shaft
 */

/**
 * @typedef {object} Dimension
 * @property {string} id
 * @property {'dimension'} type
 * @property {Point} start
 * @property {Point} end
 * @property {number} [offset_mm]
 * @property {string} [label_override]
 * @property {Provenance} [provenance]
 * @property {number} [confidence]
 * @property {boolean} [verified]
 * @property {string} [source_id]
 * @property {string[]} [tags]
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @typedef {object} Annotation
 * @property {string} id
 * @property {'annotation'} type
 * @property {Point} position
 * @property {string} text
 * @property {'note'|'label'|'room_tag'|'north_arrow'|'scale_bar'|'title'} [annotation_kind]
 * @property {number} [rotation_deg]
 * @property {string[]} [tags]
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @typedef {Wall|Opening|Space|Column|Stair|Shaft|Dimension|Annotation} Element
 */

/**
 * @typedef {object} Level
 * @property {string} id
 * @property {string} name
 * @property {number} index
 * @property {number} elevation_mm
 * @property {number} [height_mm]
 * @property {Wall[]} [walls]
 * @property {Opening[]} [openings]
 * @property {Space[]} [spaces]
 * @property {Column[]} [columns]
 * @property {Stair[]} [stairs]
 * @property {Shaft[]} [shafts]
 * @property {Dimension[]} [dimensions]
 * @property {Annotation[]} [annotations]
 * @property {string[]} [tags]
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @typedef {object} Building
 * @property {string} id
 * @property {string} name
 * @property {string} [address]
 * @property {Level[]} levels
 * @property {string[]} [tags]
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @typedef {object} Defaults
 * @property {State} [state]
 * @property {Provenance} [provenance]
 * @property {number} [wall_height_mm]
 */

/**
 * @typedef {object} Project
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {string} [client]
 * @property {string} [address]
 * @property {Quality} quality
 * @property {Defaults} [defaults]
 * @property {string[]} [tags]
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @typedef {object} SourceRef
 * @property {string} id
 * @property {string} kind
 * @property {string} [uri]
 * @property {number} [page]
 * @property {string} [description]
 * @property {string} [captured_at]
 */

/**
 * @typedef {object} HistoryEntry
 * @property {number} index
 * @property {Record<string, unknown>} operation
 * @property {string} summary
 * @property {string[]} [affected_ids]
 * @property {Record<string, unknown>[]} [inverse]
 * @property {string} [digest]
 * @property {string} [stamp]
 */

/**
 * @typedef {object} FloorplanDocument
 * @property {'0.1'} schema_version
 * @property {'mm'} unit
 * @property {Project} project
 * @property {SourceRef[]} [sources]
 * @property {Building[]} buildings
 * @property {HistoryEntry[]} [history]
 * @property {number} [revision]
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @typedef {object} ElementRef
 * @property {Element} element
 * @property {Level} level
 * @property {Building} building
 * @property {string} collection
 */

export {};
