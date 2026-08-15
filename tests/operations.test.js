/**
 * Operation tests.
 *
 * The scenarios required by the brief each get a full apply -> validate -> render
 * cycle, because a change that validates but cannot be drawn is not done.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyOperations, undoOperations, normaliseOperationInput } from '../src/operations/apply.js';
import { getOperation, listOperations, buildOperationsSchema } from '../src/operations/registry.js';
import { validateDocument } from '../src/validation/validate.js';
import { renderSvg } from '../src/render/svg/renderer.js';
import { loadTheme } from '../src/themes/load.js';
import { indexDocument } from '../src/model/document.js';
import { spaceAreaMm2, toSquareMetres } from '../src/model/measure.js';
import { canonicalise, stringifyStable } from '../src/util/json.js';
import { buildConnectivityGraph } from '../src/topology/connectivity.js';
import { compileSchema } from '../src/validation/schemaValidator.js';
import { FIXTURES, loadFixture, minimalDocument, readFixtureJson } from './helpers.js';

const THEME = loadTheme('technical');

/**
 * apply -> validate -> render, the cycle the agent contract prescribes.
 * @param {any} doc
 * @param {any[]} operations
 * @returns {{document: any, results: any[], report: any, svg: string}}
 */
function cycle(doc, operations) {
  const applied = applyOperations(doc, operations);
  const report = validateDocument(applied.document);
  assert.equal(
    report.ok,
    true,
    `document invalid after apply: ${report.issues.filter((i) => i.severity === 'ERROR').map((i) => i.message).join(' | ')}`,
  );
  const { svg } = renderSvg(applied.document, THEME);
  assert.match(svg, /^<\?xml/);
  return { ...applied, report, svg };
}

// --- required change scenarios ------------------------------------------------

test('scenario: move a door', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const { document, results } = cycle(doc, [
    { op: 'move_opening', target_id: 'door_bath', offset_delta_mm: 800 },
  ]);
  const opening = indexDocument(document).requireOpening('door_bath');
  assert.equal(opening.offset_mm, 8600);
  assert.match(results[0].summary, /from 7800 mm to 8600 mm/);
});

test('scenario: delete a door', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const { document, svg } = cycle(doc, [{ op: 'delete_opening', target_id: 'door_bath' }]);
  assert.equal(indexDocument(document).get('door_bath'), undefined);
  assert.equal(svg.includes('data-id="door_bath"'), false);
});

test('scenario: create an open passage', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const { document, svg } = cycle(doc, [
    { op: 'delete_opening', target_id: 'door_kitchen' },
    {
      op: 'create_passage', id: 'passage_kitchen', host_wall_id: 'wall_corridor_n',
      offset_mm: 2600, width_mm: 1600, height_mm: 2200, state: 'new', provenance: 'provided',
    },
  ]);
  const passage = indexDocument(document).requireOpening('passage_kitchen');
  assert.equal(passage.type, 'passage');
  assert.equal(passage.width_mm, 1600);
  assert.match(svg, /data-type="passage" data-id="passage_kitchen"/);

  const graph = buildConnectivityGraph(document, document.buildings[0].levels[0]);
  const edge = graph.edges.find((e) => e.id === 'passage_kitchen');
  assert.deepEqual([edge?.from, edge?.to].sort(), ['space_hall', 'space_kitchen']);
});

test('scenario: convert a door into a passage in one step, keeping its identity', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const { document } = cycle(doc, [
    { op: 'convert_opening', target_id: 'door_kitchen', to_type: 'passage', width_mm: 1600, state: 'new' },
  ]);
  const opening = indexDocument(document).requireOpening('door_kitchen');
  assert.equal(opening.type, 'passage');
  assert.equal(opening.width_mm, 1600);
  assert.equal('door_type' in opening, false, 'door specific attributes are dropped');
  assert.equal('hinge' in opening, false);
});

test('scenario: move a wall, dragging neighbours and room boundaries with it', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const before = toSquareMetres(spaceAreaMm2(indexDocument(doc).requireSpace('space_living')));

  const { document, results } = cycle(doc, [
    { op: 'move_wall', target_id: 'wall_corridor_s', mode: 'offset_normal', offset_mm: 500 },
  ]);
  const index = indexDocument(document);
  const wall = index.requireWall('wall_corridor_s');
  assert.equal(wall.start.y_mm, 4100);
  assert.equal(wall.end.y_mm, 4100);

  const living = index.requireSpace('space_living');
  assert.equal(Math.max(...living.boundary.map((p) => p.y_mm)), 4040, 'the room follows the wall face');
  assert.ok(toSquareMetres(spaceAreaMm2(living)) > before, 'the living room got bigger');

  const hall = index.requireSpace('space_hall');
  assert.equal(Math.min(...hall.boundary.map((p) => p.y_mm)), 4160, 'the corridor got smaller');

  assert.ok(results[0].affected_ids.length >= 3, 'the operation reports everything it touched');
  assert.match(results[0].summary, /connected element\(s\) followed/);
});

test('scenario: rename a room', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const { document, svg } = cycle(doc, [
    { op: 'rename_space', target_id: 'space_bedroom', name: 'Arbeitszimmer' },
  ]);
  assert.equal(indexDocument(document).requireSpace('space_bedroom').name, 'Arbeitszimmer');
  assert.match(svg, />Arbeitszimmer</);
});

test('scenario: mark an existing wall for demolition', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const { document, svg } = cycle(doc, [
    { op: 'set_state', target_id: 'wall_div_s', state: 'demolish' },
  ]);
  assert.equal(indexDocument(document).requireWall('wall_div_s').state, 'demolish');
  assert.match(svg, /data-type="wall-outline" data-ids="wall_div_s"/, 'demolished walls form their own style group');
});

test('scenario: add a new wall', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const { document } = cycle(doc, [
    {
      op: 'create_wall', id: 'wall_new',
      start: { x_mm: 2600, y_mm: 4800 }, end: { x_mm: 2600, y_mm: 7500 },
      thickness_mm: 120, classification: 'partition', state: 'new', provenance: 'provided',
    },
  ]);
  const wall = indexDocument(document).requireWall('wall_new');
  assert.equal(wall.thickness_mm, 120);
  assert.equal(wall.state, 'new');
});

// --- purity, atomicity, reversibility ---------------------------------------------

test('apply never mutates the input document', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const before = stringifyStable(doc);
  applyOperations(doc, [{ op: 'move_opening', target_id: 'door_bath', offset_delta_mm: 300 }]);
  assert.equal(stringifyStable(doc), before);
});

test('a failing operation aborts the whole batch', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const before = stringifyStable(doc);
  assert.throws(() => applyOperations(doc, [
    { op: 'rename_space', target_id: 'space_bath', name: 'Wellness' },
    { op: 'move_opening', target_id: 'door_bath', offset_delta_mm: 999999 },
  ]), (error) => /** @type {any} */ (error).code === 'OPENING_OUTSIDE_WALL');
  assert.equal(stringifyStable(doc), before, 'nothing was applied');
});

test('the failing operation is identified by index and name', () => {
  const doc = loadFixture(FIXTURES.apartment);
  assert.throws(
    () => applyOperations(doc, [
      { op: 'rename_space', target_id: 'space_bath', name: 'A' },
      { op: 'delete_opening', target_id: 'door_does_not_exist' },
    ]),
    (error) => /** @type {any} */ (error).opIndex === 1 && /** @type {any} */ (error).op === 'delete_opening',
  );
});

test('undo restores the exact original for every operation kind', () => {
  const scenarios = [
    [{ op: 'move_opening', target_id: 'door_bath', offset_delta_mm: 800 }],
    [{ op: 'move_opening', target_id: 'door_bath', offset_mm: 6000 }],
    [{ op: 'delete_opening', target_id: 'door_bath' }],
    [{ op: 'delete_wall', target_id: 'wall_div_s' }],
    [{ op: 'set_state', target_id: 'wall_div_s', state: 'demolish' }],
    [{ op: 'rename_space', target_id: 'space_bath', name: 'Wellness' }],
    [{ op: 'set_space_category', target_id: 'space_bath', category: 'wc' }],
    [{ op: 'set_wall_thickness', target_id: 'wall_div_s', thickness_mm: 240 }],
    [{ op: 'split_wall', target_id: 'wall_corridor_n', at_mm: 5400 }],
    [{ op: 'move_wall', target_id: 'wall_corridor_s', mode: 'offset_normal', offset_mm: 400 }],
    [{ op: 'convert_opening', target_id: 'door_kitchen', to_type: 'passage', width_mm: 1400 }],
    [{ op: 'resize_opening', target_id: 'door_bath', width_mm: 910 }],
    [{ op: 'set_provenance', target_id: 'wall_div_s', property: 'thickness_mm', provenance: 'estimated', confidence: 0.5 }],
    [{ op: 'set_attribute', target_id: 'wall_div_s', attribute: 'material', value: 'Gipskarton' }],
    [{ op: 'create_wall', start: { x_mm: 2600, y_mm: 4800 }, end: { x_mm: 2600, y_mm: 7500 }, thickness_mm: 120 }],
    [{
      op: 'create_space', name: 'Neu', category: 'other', boundary: [
        { x_mm: 6000, y_mm: 6000 }, { x_mm: 7000, y_mm: 6000 }, { x_mm: 7000, y_mm: 7000 }, { x_mm: 6000, y_mm: 7000 },
      ],
    }],
    [{ op: 'add_annotation', position: { x_mm: 100, y_mm: 100 }, text: 'Hinweis' }],
    [{ op: 'add_dimension', start: { x_mm: 0, y_mm: -500 }, end: { x_mm: 10500, y_mm: -500 }, offset_mm: 0 }],
  ];

  for (const operations of scenarios) {
    const doc = loadFixture(FIXTURES.apartment);
    const baseline = canonicalise({ ...doc, history: undefined, revision: undefined });
    const applied = applyOperations(doc, operations);
    const restored = undoOperations(applied.document, { steps: operations.length });
    assert.equal(
      canonicalise({ ...restored.document, history: undefined, revision: undefined }),
      baseline,
      `undo of ${operations.map((o) => o.op).join(', ')} did not restore the original`,
    );
    assert.equal(restored.document.history?.length ?? 0, 0);
  }
});

test('undo of a batch reverses the operations in the right order', () => {
  const doc = loadFixture(FIXTURES.house);
  const operations = readFixtureJson('fixtures/03-house-ground-floor/renovation.ops.json').operations;
  const baseline = canonicalise({ ...doc, history: undefined, revision: undefined });
  const applied = applyOperations(doc, operations);
  assert.equal(applied.document.history.length, 4);
  assert.equal(applied.document.revision, 1);
  const restored = undoOperations(applied.document, { steps: 4 });
  assert.equal(canonicalise({ ...restored.document, history: undefined, revision: undefined }), baseline);
});

test('partial undo keeps the earlier operations', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const applied = applyOperations(doc, [
    { op: 'rename_space', target_id: 'space_bath', name: 'Wellness' },
    { op: 'rename_space', target_id: 'space_bath', name: 'Spa' },
  ]);
  const undone = undoOperations(applied.document, { steps: 1 });
  assert.equal(indexDocument(undone.document).requireSpace('space_bath').name, 'Wellness');
  assert.equal(undone.document.history.length, 1);
});

test('undo without history is refused with a clear message', () => {
  assert.throws(
    () => undoOperations(loadFixture(FIXTURES.apartment)),
    (error) => /** @type {any} */ (error).code === 'NOTHING_TO_UNDO',
  );
});

test('history entries are deterministic and carry a digest', () => {
  const first = applyOperations(loadFixture(FIXTURES.apartment), [{ op: 'rename_space', target_id: 'space_bath', name: 'X' }]);
  const second = applyOperations(loadFixture(FIXTURES.apartment), [{ op: 'rename_space', target_id: 'space_bath', name: 'X' }]);
  assert.equal(stringifyStable(first.document), stringifyStable(second.document));
  assert.match(first.document.history[0].digest, /^[0-9a-f]{16}$/);
  assert.equal('stamp' in first.document.history[0], false, 'no timestamp unless explicitly requested');
});

test('a stamp is recorded only when supplied', () => {
  const applied = applyOperations(
    loadFixture(FIXTURES.apartment),
    [{ op: 'rename_space', target_id: 'space_bath', name: 'X' }],
    { stamp: '2026-08-15T10:00:00Z' },
  );
  assert.equal(applied.document.history[0].stamp, '2026-08-15T10:00:00Z');
});

// --- individual operation behaviour --------------------------------------------------

test('move_opening refuses to push an opening out of its wall', () => {
  assert.throws(
    () => applyOperations(loadFixture(FIXTURES.apartment), [{ op: 'move_opening', target_id: 'door_bath', offset_delta_mm: 5000 }]),
    (error) => /** @type {any} */ (error).code === 'OPENING_OUTSIDE_WALL',
  );
});

test('move_opening refuses to collide with another opening', () => {
  assert.throws(
    () => applyOperations(loadFixture(FIXTURES.apartment), [{ op: 'move_opening', target_id: 'door_bedroom', offset_mm: 2900 }]),
    (error) => /** @type {any} */ (error).code === 'OPENING_OVERLAP',
  );
});

test('move_opening rejects contradictory parameters', () => {
  assert.throws(
    () => applyOperations(loadFixture(FIXTURES.apartment), [{ op: 'move_opening', target_id: 'door_bath', offset_mm: 100, offset_delta_mm: 100 }]),
    (error) => /** @type {any} */ (error).code === 'CONFLICTING_PARAMETERS',
  );
});

test('resize_opening keeps the centre, so the opening does not drift', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const applied = applyOperations(doc, [{ op: 'resize_opening', target_id: 'door_bath', width_mm: 1200 }]);
  const opening = indexDocument(applied.document).requireOpening('door_bath');
  assert.equal(opening.offset_mm, 7800, 'the centre is unchanged');
  assert.equal(opening.width_mm, 1200);
});

test('delete_wall cascades to the openings it hosts, delete_element does not', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const applied = applyOperations(doc, [{ op: 'delete_wall', target_id: 'wall_corridor_n' }]);
  const index = indexDocument(applied.document);
  assert.equal(index.get('wall_corridor_n'), undefined);
  assert.equal(index.get('door_kitchen'), undefined);
  assert.equal(index.get('door_bedroom'), undefined);

  assert.throws(
    () => applyOperations(loadFixture(FIXTURES.apartment), [{ op: 'delete_element', target_id: 'wall_corridor_n' }]),
    (error) => /** @type {any} */ (error).code === 'WALL_STILL_HOSTS_OPENINGS',
  );
});

test('split_wall reassigns openings to the correct half', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const applied = applyOperations(doc, [{ op: 'split_wall', target_id: 'wall_corridor_n', at_mm: 5400, new_id: 'wall_split' }]);
  const index = indexDocument(applied.document);
  assert.equal(index.requireWall('wall_corridor_n').end.x_mm, 5400);
  assert.equal(index.requireWall('wall_split').start.x_mm, 5400);
  assert.equal(index.requireOpening('door_kitchen').host_wall_id, 'wall_corridor_n');
  const bedroom = index.requireOpening('door_bedroom');
  assert.equal(bedroom.host_wall_id, 'wall_split');
  assert.equal(bedroom.offset_mm, 2500, 'the offset is rebased onto the new wall');
  assert.equal(validateDocument(applied.document).ok, true);
});

test('split_wall refuses to cut through an opening', () => {
  assert.throws(
    () => applyOperations(loadFixture(FIXTURES.apartment), [{ op: 'split_wall', target_id: 'wall_corridor_n', at_mm: 2600 }]),
    (error) => /** @type {any} */ (error).code === 'OPENING_STRADDLES_SPLIT',
  );
});

test('split_space cuts a room in two and keeps the larger part', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const applied = applyOperations(doc, [{
    op: 'split_space',
    target_id: 'space_living',
    line_start: { x_mm: 3500, y_mm: -1000 },
    line_end: { x_mm: 3500, y_mm: 5000 },
    new_id: 'space_nook',
    new_name: 'Arbeitsecke',
  }]);
  const index = indexDocument(applied.document);
  const original = index.requireSpace('space_living');
  const created = index.requireSpace('space_nook');
  assert.ok(spaceAreaMm2(original) > spaceAreaMm2(created));
  assert.equal(created.name, 'Arbeitsecke');
  assert.equal(created.provenance, 'derived');
  assert.equal(
    Math.round(spaceAreaMm2(original) + spaceAreaMm2(created)),
    Math.round(spaceAreaMm2(indexDocument(loadFixture(FIXTURES.apartment)).requireSpace('space_living'))),
    'no area is lost or invented by the split',
  );
});

test('merge_spaces joins two rooms that share a boundary', () => {
  const doc = minimalDocument();
  const level = doc.buildings[0].levels[0];
  level.spaces = [
    {
      id: 'space_a', type: 'space', name: 'A', category: 'other',
      boundary: [{ x_mm: 0, y_mm: 0 }, { x_mm: 1000, y_mm: 0 }, { x_mm: 1000, y_mm: 1000 }, { x_mm: 0, y_mm: 1000 }],
      provenance: 'derived', verified: true,
    },
    {
      id: 'space_b', type: 'space', name: 'B', category: 'other',
      boundary: [{ x_mm: 1000, y_mm: 0 }, { x_mm: 2000, y_mm: 0 }, { x_mm: 2000, y_mm: 1000 }, { x_mm: 1000, y_mm: 1000 }],
      provenance: 'derived', verified: true,
    },
  ];
  const applied = applyOperations(doc, [{ op: 'merge_spaces', target_ids: ['space_a', 'space_b'], name: 'Wohnküche' }]);
  const index = indexDocument(applied.document);
  assert.equal(index.get('space_b'), undefined);
  const merged = index.requireSpace('space_a');
  assert.equal(merged.name, 'Wohnküche');
  assert.equal(spaceAreaMm2(merged), 2_000_000);
});

test('merge_spaces refuses rooms that do not touch', () => {
  const doc = loadFixture(FIXTURES.apartment);
  assert.throws(
    () => applyOperations(doc, [{ op: 'merge_spaces', target_ids: ['space_kitchen', 'space_bath'] }]),
    (error) => /** @type {any} */ (error).code === 'MERGE_NOT_POSSIBLE',
  );
});

test('set_state accepts several targets at once', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const applied = applyOperations(doc, [{ op: 'set_state', target_ids: ['wall_div_s', 'wall_div_n'], state: 'demolish' }]);
  const index = indexDocument(applied.document);
  assert.equal(index.requireWall('wall_div_s').state, 'demolish');
  assert.equal(index.requireWall('wall_div_n').state, 'demolish');
});

test('set_attribute only accepts whitelisted, non geometric attributes', () => {
  const doc = loadFixture(FIXTURES.apartment);
  assert.throws(
    () => applyOperations(doc, [{ op: 'set_attribute', target_id: 'wall_div_s', attribute: 'thickness_mm', value: 999 }]),
    (error) => /** @type {any} */ (error).code === 'ATTRIBUTE_NOT_SETTABLE',
  );
  assert.throws(
    () => applyOperations(doc, [{ op: 'set_attribute', target_id: 'space_bath', attribute: 'boundary', value: [] }]),
    (error) => /** @type {any} */ (error).code === 'ATTRIBUTE_NOT_SETTABLE',
  );
  const ok = applyOperations(doc, [{ op: 'set_attribute', target_id: 'wall_div_s', attribute: 'material', value: 'Gipskarton' }]);
  assert.equal(indexDocument(ok.document).requireWall('wall_div_s').material, 'Gipskarton');
});

test('set_attribute rejects a value that would make the element invalid', () => {
  assert.throws(
    () => applyOperations(loadFixture(FIXTURES.apartment), [{ op: 'set_attribute', target_id: 'space_bath', attribute: 'category', value: 'sauna' }]),
    (error) => /** @type {any} */ (error).code === 'INVALID_ATTRIBUTE_VALUE',
  );
});

test('set_provenance refuses to describe a value that does not exist', () => {
  assert.throws(
    () => applyOperations(loadFixture(FIXTURES.apartment), [{ op: 'set_provenance', target_id: 'wall_div_s', property: 'height_mm', provenance: 'measured' }]),
    (error) => /** @type {any} */ (error).code === 'UNKNOWN_PROPERTY',
  );
});

test('create_window insists on a sill height rather than inventing one', () => {
  assert.throws(
    () => applyOperations(loadFixture(FIXTURES.apartment), [{
      op: 'create_window', host_wall_id: 'wall_ext_s', offset_mm: 5000, width_mm: 1000, height_mm: 1400,
    }]),
    (error) => /** @type {any} */ (error).code === 'INVALID_OPERATION',
  );
});

test('set_project_quality is a proof, not a claim', () => {
  const doc = loadFixture(FIXTURES.reconstruction);
  assert.throws(
    () => applyOperations(doc, [{ op: 'set_project_quality', quality: 'scaled' }]),
    (error) => /** @type {any} */ (error).code === 'QUALITY_NOT_REACHED',
  );
  const downgrade = applyOperations(loadFixture(FIXTURES.apartment), [{ op: 'set_project_quality', quality: 'marketing' }]);
  assert.equal(downgrade.document.project.quality, 'marketing', 'lowering the claim is always allowed');
});

test('ids are never reused, not even after delete and undo', () => {
  const doc = loadFixture(FIXTURES.apartment);
  const deleted = applyOperations(doc, [{ op: 'delete_opening', target_id: 'door_bath' }]);
  const created = applyOperations(deleted.document, [{
    op: 'create_door', host_wall_id: 'wall_corridor_s', offset_mm: 7800, width_mm: 810, door_type: 'swing',
  }]);
  const newIds = created.results[0].affected_ids;
  assert.equal(newIds.includes('door_bath'), false, 'the id of an undoable deletion stays reserved');
});

// --- input handling and the registry ----------------------------------------------

test('normaliseOperationInput accepts a file, a bare array or a single operation', () => {
  assert.equal(normaliseOperationInput({ schema_version: '0.1', operations: [{ op: 'a' }] }).length, 1);
  assert.equal(normaliseOperationInput([{ op: 'a' }]).length, 1);
  assert.equal(normaliseOperationInput({ op: 'a' }).length, 1);
  assert.throws(() => normaliseOperationInput('nonsense'), (error) => /** @type {any} */ (error).code === 'INVALID_OPERATIONS_FILE');
  assert.throws(
    () => normaliseOperationInput({ schema_version: '9.9', operations: [] }),
    (error) => /** @type {any} */ (error).code === 'INCOMPATIBLE_OPERATIONS_VERSION',
  );
});

test('an unknown operation suggests the closest match', () => {
  assert.throws(
    () => getOperation('move_openning'),
    (error) => /** @type {any} */ (error).code === 'UNKNOWN_OPERATION' && /move_opening/.test(/** @type {any} */ (error).hint),
  );
});

test('every operation is documented and exposes a valid schema', () => {
  const operations = listOperations();
  assert.ok(operations.length >= 24, `expected a rich vocabulary, got ${operations.length}`);
  for (const definition of operations) {
    assert.ok(definition.summary.length > 10, `${definition.op} needs a summary`);
    assert.ok(definition.description.length > 20, `${definition.op} needs a description`);
    assert.equal(definition.schema.properties.op.const, definition.op);
    assert.equal(definition.schema.additionalProperties, false, `${definition.op} must reject unknown parameters`);
    assert.doesNotThrow(() => compileSchema(definition.schema, `op:${definition.op}`));
  }
});

test('every documented example validates against its own schema', () => {
  for (const definition of listOperations()) {
    const validator = compileSchema(definition.schema, `example:${definition.op}`);
    for (const example of definition.examples) {
      const errors = validator.validate(example);
      assert.equal(errors.length, 0, `${definition.op} example invalid: ${errors[0]?.message}`);
    }
  }
});

test('the published operations schema matches the registry', () => {
  const generated = buildOperationsSchema();
  const onDisk = readFixtureJson('schema/operations.schema.json');
  assert.equal(
    canonicalise(generated),
    canonicalise(onDisk),
    'schema/operations.schema.json is out of date — run `node scripts/generate-operations-schema.js`',
  );
});

test('the published operations schema accepts real operation files', () => {
  const validator = compileSchema(buildOperationsSchema(), 'operations');
  const file = readFixtureJson('fixtures/03-house-ground-floor/renovation.ops.json');
  assert.deepEqual(validator.validate(file), []);
  assert.ok(validator.validate({ schema_version: '0.1', operations: [{ op: 'move_opening' }] }).length > 0, 'missing target_id must be caught');
});
