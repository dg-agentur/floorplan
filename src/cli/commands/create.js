import { existsSync } from 'node:fs';
import { saveDocument } from '../../model/io.js';
import { SCHEMA_VERSION } from '../../model/constants.js';
import { validateDocument } from '../../validation/validate.js';
import { UsageError } from '../../util/errors.js';
import { boolFlag, integerFlag, parseArgs, requirePositional, stringFlag } from '../args.js';
import { finish } from '../output.js';

export const createSpec = {
  boolean: ['json', 'debug', 'force'],
  string: [
    'template', 'name', 'quality', 'project-id', 'level-name',
    'width-mm', 'depth-mm', 'wall-thickness-mm', 'wall-height-mm',
  ],
};

const TEMPLATES = ['empty', 'room'];

/**
 * `create` never invents a dimension: the "room" template requires the clear
 * inner width and depth, and marks the resulting values as `provided`.
 *
 * @param {string[]} argv
 * @param {import('../output.js').OutputContext} out
 * @returns {number}
 */
export function createCommand(argv, out) {
  const args = parseArgs(argv, createSpec);
  const target = requirePositional(args, 0, 'the output file');
  const template = stringFlag(args, 'template') ?? 'empty';
  if (!TEMPLATES.includes(template)) {
    throw new UsageError('UNKNOWN_TEMPLATE', `Unknown template "${template}".`, {
      hint: `Available templates: ${TEMPLATES.join(', ')}`,
    });
  }
  if (existsSync(target) && !boolFlag(args, 'force')) {
    throw new UsageError('FILE_EXISTS', `${target} already exists.`, { hint: 'Pass --force to overwrite it.' });
  }

  const name = stringFlag(args, 'name') ?? 'Untitled floorplan';
  const quality = stringFlag(args, 'quality') ?? 'marketing';
  const projectId = stringFlag(args, 'project-id') ?? 'project_001';
  const levelName = stringFlag(args, 'level-name') ?? 'Ground floor';
  const wallHeight = integerFlag(args, 'wall-height-mm');

  /** @type {any} */
  const level = { id: 'level_eg', name: levelName, index: 0, elevation_mm: 0 };
  if (wallHeight) level.height_mm = wallHeight;

  /** @type {any} */
  const doc = {
    schema_version: SCHEMA_VERSION,
    unit: 'mm',
    project: {
      id: projectId,
      name,
      quality,
      defaults: { state: 'new', provenance: 'provided' },
    },
    buildings: [{ id: 'building_main', name: 'Main building', levels: [level] }],
    revision: 0,
  };
  if (wallHeight) doc.project.defaults.wall_height_mm = wallHeight;

  if (template === 'room') {
    const width = integerFlag(args, 'width-mm');
    const depth = integerFlag(args, 'depth-mm');
    const thickness = integerFlag(args, 'wall-thickness-mm') ?? 300;
    if (!width || !depth) {
      throw new UsageError('MISSING_DIMENSIONS', 'The "room" template needs --width-mm and --depth-mm (clear inner dimensions).', {
        hint: 'Dimensions are never guessed. Supply the measurements you actually have.',
      });
    }
    buildRoom(level, width, depth, thickness);
  }

  const report = validateDocument(doc);
  const written = saveDocument(target, doc);

  return finish(out, {
    data: { output: written, template, project_id: projectId, level_id: level.id, report },
    human: [
      `created: ${written}`,
      `template: ${template}   quality: ${quality}`,
      `validation: ${report.ok ? 'OK' : 'FAILED'} (errors ${report.counts.ERROR}, warnings ${report.counts.WARNING}, info ${report.counts.INFO})`,
      template === 'empty'
        ? 'Next: add walls with `floorplan apply` — see `floorplan ops describe create_wall`.'
        : 'Next: add doors and windows — see `floorplan ops describe create_door`.',
    ].join('\n'),
    exitCode: report.ok ? 0 : 1,
  });
}

/**
 * Four exterior walls around a clear inner rectangle, plus the room itself.
 * The centerlines sit half a wall thickness outside the clear dimensions.
 * @param {any} level
 * @param {number} width clear inner width in mm
 * @param {number} depth clear inner depth in mm
 * @param {number} thickness
 */
function buildRoom(level, width, depth, thickness) {
  const half = Math.round(thickness / 2);
  const x0 = -half;
  const y0 = -half;
  const x1 = width + half;
  const y1 = depth + half;

  /** @param {number} ax @param {number} ay @param {number} bx @param {number} by @param {number} n */
  const wall = (ax, ay, bx, by, n) => ({
    id: `wall_${String(n).padStart(3, '0')}`,
    type: 'wall',
    start: { x_mm: ax, y_mm: ay },
    end: { x_mm: bx, y_mm: by },
    thickness_mm: thickness,
    classification: 'exterior',
    state: 'new',
    provenance: 'provided',
  });

  level.walls = [
    wall(x0, y0, x1, y0, 1),
    wall(x1, y0, x1, y1, 2),
    wall(x1, y1, x0, y1, 3),
    wall(x0, y1, x0, y0, 4),
  ];
  level.spaces = [{
    id: 'space_001',
    type: 'space',
    name: 'Room',
    category: 'other',
    boundary: [
      { x_mm: 0, y_mm: 0 },
      { x_mm: width, y_mm: 0 },
      { x_mm: width, y_mm: depth },
      { x_mm: 0, y_mm: depth },
    ],
    state: 'new',
    provenance: 'derived',
  }];
}
