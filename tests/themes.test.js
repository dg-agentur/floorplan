import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { parseYaml } from '../src/themes/yaml.js';
import { listThemes, loadTheme, mergeDeep, readThemeFile, resolveThemePath } from '../src/themes/load.js';
import { DEFAULT_THEME } from '../src/themes/defaults.js';
import { getSchemaValidator } from '../src/model/io.js';
import { FloorplanError, UsageError } from '../src/util/errors.js';

// --- YAML subset ---------------------------------------------------------------

test('parses nested maps, scalars and comments', () => {
  const result = parseYaml(`
# a comment
name: technical
page:
  background: "#ffffff"
  margin_mm: 700
  scale_mode: fit   # trailing comment
  enabled: true
  disabled: false
  nothing: null
  ratio: 0.28
  negative: -12
`, 'test');
  assert.deepEqual(result, {
    name: 'technical',
    page: {
      background: '#ffffff',
      margin_mm: 700,
      scale_mode: 'fit',
      enabled: true,
      disabled: false,
      nothing: null,
      ratio: 0.28,
      negative: -12,
    },
  });
});

test('a hash inside a quoted string is not a comment', () => {
  const result = parseYaml('color: "#ffffff"\nother: \'#abc\'\n', 'test');
  assert.deepEqual(result, { color: '#ffffff', other: '#abc' });
});

test('parses sequences of scalars and of maps', () => {
  const result = parseYaml(`
list:
  - a
  - 2
  - true
items:
  - name: one
    value: 1
  - name: two
    value: 2
`, 'test');
  assert.deepEqual(result, {
    list: ['a', 2, true],
    items: [{ name: 'one', value: 1 }, { name: 'two', value: 2 }],
  });
});

test('deep nesting is preserved', () => {
  const result = parseYaml(`
walls:
  by_state:
    demolish:
      stroke: "#b03a2e"
      dash: "7 4"
    new:
      fill: "#20558a"
labels:
  show_name: true
`, 'test');
  assert.equal(/** @type {any} */ (result).walls.by_state.demolish.dash, '7 4');
  assert.equal(/** @type {any} */ (result).walls.by_state.new.fill, '#20558a');
  assert.equal(/** @type {any} */ (result).labels.show_name, true);
});

test('unsupported YAML constructs fail loudly with a line number', () => {
  for (const [source, expected] of [
    ['a: &anchor 1\n', /anchors/],
    ['a: *ref\n', /aliases/],
    ['a: !!str 1\n', /tags/],
    ['a: [1, 2]\n', /flow collections/],
    ['a: 1\n\tb: 2\n', /tabs/],
    ['a: 1\n   b: 2\n', /multiple of 2/],
  ]) {
    assert.throws(
      () => parseYaml(/** @type {string} */ (source), 'test.yaml'),
      (error) => error instanceof FloorplanError
        && error.code === 'YAML_PARSE_ERROR'
        && /** @type {RegExp} */ (expected).test(error.message)
        && /test\.yaml:\d+/.test(error.message),
      `expected ${expected} for ${JSON.stringify(source)}`,
    );
  }
});

test('block scalars are supported for multi line values', () => {
  assert.deepEqual(parseYaml('a: |\n  line one\n  line two\nb: 2\n', 'test'),
    { a: 'line one\nline two\n', b: 2 });
  assert.deepEqual(parseYaml('a: |-\n  kept\n', 'test'), { a: 'kept' });
  assert.deepEqual(parseYaml('a: >-\n  one\n  two\n\n  second\n', 'test'), { a: 'one two\nsecond' });
  assert.deepEqual(parseYaml('a: >\n  folded\nb: 2\n', 'test'), { a: 'folded\n', b: 2 });
});

test('a block scalar header with trailing content is still refused', () => {
  assert.throws(() => parseYaml('a: | inline\n', 'test'), (error) => /block scalars/.test(String(/** @type {Error} */ (error).message)));
});

test('a duplicate key is an error, not a silent overwrite', () => {
  assert.throws(() => parseYaml('a: 1\na: 2\n', 'test'), (error) => /duplicate key/.test(/** @type {Error} */ (error).message));
});

test('a missing "key: value" separator is an error', () => {
  assert.throws(() => parseYaml('just some text\n', 'test'), (error) => /expected "key: value"/.test(/** @type {Error} */ (error).message));
});

test('an empty document parses to an empty object', () => {
  assert.deepEqual(parseYaml('\n# only comments\n', 'test'), {});
});

// --- theme loading -----------------------------------------------------------

test('the built in themes load, validate and differ from each other', () => {
  const names = listThemes().map((theme) => theme.name);
  for (const required of ['technical', 'marketing', 'minimal']) {
    assert.ok(names.includes(required), `theme ${required} is missing`);
  }
  const technical = loadTheme('technical');
  const marketing = loadTheme('marketing');
  assert.notEqual(technical.walls.default.fill, marketing.walls.default.fill);
  assert.notEqual(technical.dimensions.show, marketing.dimensions.show);
});

test('a theme file only needs to state its differences', () => {
  const theme = loadTheme('minimal');
  assert.equal(theme.walls.default.fill, 'none', 'from the file');
  assert.equal(theme.openings.window.reveal_stroke, DEFAULT_THEME.openings.window.reveal_stroke, 'from the defaults');
  assert.equal(theme.spaces.by_category.kitchen.fill, DEFAULT_THEME.spaces.by_category.kitchen.fill);
});

test('loadTheme without a name returns the built in default', () => {
  assert.deepEqual(loadTheme(), DEFAULT_THEME);
});

test('an unknown theme lists the available ones', () => {
  assert.throws(
    () => loadTheme('does-not-exist'),
    (error) => error instanceof UsageError && /Available themes/.test(String(error.hint)),
  );
});

test('unknown keys in a theme are rejected so a typo cannot disable a setting', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'floorplan-theme-'));
  const path = resolve(dir, 'typo.yaml');
  writeFileSync(path, 'name: typo\nwalls:\n  defualt:\n    fill: "#000000"\n', 'utf8');
  assert.throws(
    () => readThemeFile(path),
    (error) => error instanceof FloorplanError && error.code === 'INVALID_THEME' && /defualt/.test(error.message),
  );
});

test('an invalid colour value is rejected', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'floorplan-theme-'));
  const path = resolve(dir, 'badcolor.yaml');
  writeFileSync(path, 'name: badcolor\npage:\n  background: rebeccapurple\n', 'utf8');
  assert.throws(() => readThemeFile(path), (error) => /** @type {any} */ (error).code === 'INVALID_THEME');
});

test('theme inheritance merges deeply and detects cycles', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'floorplan-theme-'));
  mkdirSync(resolve(dir, 'themes'), { recursive: true });
  writeFileSync(resolve(dir, 'themes/child.yaml'), 'name: child\nextends: parent\nlabels:\n  name_font_size_px: 20\n', 'utf8');
  writeFileSync(resolve(dir, 'themes/parent.yaml'), 'name: parent\nlabels:\n  show_area: false\n  name_font_size_px: 9\n', 'utf8');
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    const theme = loadTheme('child');
    assert.equal(theme.name, 'child');
    assert.equal(theme.labels.name_font_size_px, 20, 'the child wins');
    assert.equal(theme.labels.show_area, false, 'inherited from the parent');
    assert.equal(theme.labels.area_font_size_px, DEFAULT_THEME.labels.area_font_size_px, 'inherited from the defaults');
    assert.equal('extends' in theme, false, 'the resolved theme has no extends left');

    writeFileSync(resolve(dir, 'themes/parent.yaml'), 'name: parent\nextends: child\n', 'utf8');
    assert.throws(() => loadTheme('child'), (error) => /** @type {any} */ (error).code === 'THEME_INHERITANCE_CYCLE');
  } finally {
    process.chdir(cwd);
  }
});

test('a JSON theme file is accepted as well', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'floorplan-theme-'));
  const path = resolve(dir, 'json-theme.json');
  writeFileSync(path, JSON.stringify({ name: 'json_theme', page: { margin_mm: 123 } }), 'utf8');
  assert.equal(loadTheme(path).page.margin_mm, 123);
});

test('mergeDeep replaces arrays and scalars but merges objects', () => {
  assert.deepEqual(mergeDeep({ a: { b: 1, c: 2 } }, { a: { c: 3 } }), { a: { b: 1, c: 3 } });
  assert.deepEqual(mergeDeep({ a: [1, 2] }, { a: [3] }), { a: [3] });
  assert.deepEqual(mergeDeep({ a: 1 }, { a: null }), { a: null });
});

// --- the architectural boundary between theme and geometry ---------------------

test('the theme schema exposes no building dimension', () => {
  const schema = /** @type {any} */ (getSchemaValidator('theme').schema);
  /** @type {string[]} */
  const offenders = [];
  walk(schema, '');
  // Allowed, with reasons:
  //   leaf_thickness_mm, sliding_offset_mm — symbol geometry: how thick/offset the
  //     DRAWN door leaf is. Not a property of the building.
  //   margin_mm — page padding around the drawing.
  //   px_per_mm, min_px_per_mm, max_px_per_mm — scale factors, not lengths.
  const allowed = ['leaf_thickness_mm', 'sliding_offset_mm', 'margin_mm',
    'px_per_mm', 'min_px_per_mm', 'max_px_per_mm'];
  assert.deepEqual(
    offenders.filter((name) => !allowed.includes(name)),
    [],
    'a theme must never carry a building dimension (docs/adr/0012-themes.md)',
  );

  /**
   * @param {any} node
   * @param {string} pointer
   */
  function walk(node, pointer) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, pointer);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties') {
        for (const name of Object.keys(/** @type {object} */ (value))) {
          if (name.endsWith('_mm')) offenders.push(name);
        }
      }
      walk(value, `${pointer}/${key}`);
    }
  }
});

test('the default theme validates against the theme schema', () => {
  const { name, description, ...rest } = DEFAULT_THEME;
  const errors = getSchemaValidator('theme').validate({ name, description, ...rest });
  assert.deepEqual(errors, []);
});

test('every theme resolves to a complete theme with no missing keys', () => {
  for (const { name } of listThemes()) {
    const theme = loadTheme(name);
    for (const section of Object.keys(DEFAULT_THEME)) {
      assert.ok(section in theme, `${name} is missing section ${section}`);
    }
    assert.ok(theme.page.font_family);
    assert.ok(theme.walls.default.fill !== undefined);
    assert.ok(theme.labels.name_font_size_px > 0);
  }
});

test('resolveThemePath accepts both a name and a path', () => {
  assert.match(resolveThemePath('technical'), /themes[/\\]technical\.yaml$/);
  assert.match(resolveThemePath('themes/marketing.yaml'), /themes[/\\]marketing\.yaml$/);
  assert.throws(() => resolveThemePath('themes/nope.yaml'), (error) => /** @type {any} */ (error).code === 'THEME_NOT_FOUND');
});
