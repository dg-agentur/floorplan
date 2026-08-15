/**
 * Minimal YAML parser for configuration files.
 *
 * Consequence of the zero dependency decision (ADR 0001). The supported subset
 * is deliberately small and documented in ADR 0012; anything outside it raises a
 * precise error with a line number rather than being silently misread.
 *
 * Supported:  nested maps by indentation · sequences of scalars and maps ·
 *             quoted and bare scalars · numbers · booleans · null · comments ·
 *             block scalars (| and >, with the - and + chomping indicators)
 * Not supported: anchors, aliases, tags, flow collections, multi document files,
 *             complex keys.
 *
 * Block scalars were added for the skill frontmatter, whose description spans
 * several lines (ADR 0012). Folding is the simple form: consecutive lines join
 * with a space, a blank line becomes a newline. That is predictable and covers
 * configuration use; it does not implement YAML's more-indented-line rule.
 */

import { FloorplanError } from '../util/errors.js';

/**
 * @param {string} message
 * @param {number} line
 * @param {string} label
 * @returns {FloorplanError}
 */
function yamlError(message, line, label) {
  return new FloorplanError('YAML_PARSE_ERROR', `${label}:${line}: ${message}`, {
    exitCode: 2,
    hint: 'Supported YAML subset: nested maps, sequences, scalars, comments. See docs/adr/0012-themes.md.',
  });
}

/**
 * Constructs outside the supported subset. Checked against the line with all
 * quoted sections blanked out, so a "&" inside a font stack is not mistaken for
 * an anchor.
 */
const UNSUPPORTED = [
  { pattern: /(^|\s)&\S+/, what: 'anchors (&name)' },
  { pattern: /(^|\s)\*\S+/, what: 'aliases (*name)' },
  { pattern: /(^|\s)!!\S*/, what: 'tags (!!type)' },
  { pattern: /^\s*---\s*$/, what: 'multi document markers (---)' },
];

/** `key: |`, `key: >-`, … — a block scalar header and its chomping indicator. */
const BLOCK_SCALAR_HEADER = /^([|>])([-+]?)$/;

/**
 * Replace the content of quoted strings with spaces so that structural checks
 * cannot be confused by string content.
 * @param {string} line
 * @returns {string}
 */
function blankQuoted(line) {
  let out = '';
  let quote = '';
  for (const ch of line) {
    if (quote) {
      out += ch === quote ? ch : ' ';
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * @typedef {{indent: number, text: string, line: number, blockValue?: string}} SourceLine
 */

/**
 * @param {string} text
 * @param {string} [label]
 * @returns {unknown}
 */
export function parseYaml(text, label = 'yaml') {
  /** @type {SourceLine[]} */
  const lines = [];
  const rawLines = text.split(/\r?\n/);

  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    const lineNumber = i + 1;
    if (raw.includes('\t')) throw yamlError('tabs are not allowed for indentation', lineNumber, label);
    const withoutComment = stripComment(raw);
    if (withoutComment.trim().length === 0) continue;
    const structural = blankQuoted(withoutComment);
    for (const rule of UNSUPPORTED) {
      if (rule.pattern.test(structural)) {
        throw yamlError(`${rule.what} are not supported`, lineNumber, label);
      }
    }
    const indent = withoutComment.length - withoutComment.trimStart().length;
    if (indent % 2 !== 0) throw yamlError(`indentation must be a multiple of 2 spaces (got ${indent})`, lineNumber, label);
    const trimmed = withoutComment.trim();

    // A block scalar swallows the following, more indented raw lines. They are
    // taken verbatim, so comments and quoting rules do not apply inside them.
    const separator = findKeySeparator(trimmed);
    if (separator >= 0) {
      const header = BLOCK_SCALAR_HEADER.exec(trimmed.slice(separator + 1).trim());
      if (header) {
        const [, style, chomping] = header;
        const { value, next } = readBlockScalar(rawLines, i + 1, indent, style, chomping);
        lines.push({ indent, text: trimmed.slice(0, separator + 1), line: lineNumber, blockValue: value });
        i = next - 1;
        continue;
      }
    }

    lines.push({ indent, text: trimmed, line: lineNumber });
  }

  if (lines.length === 0) return {};
  const { value, next } = parseBlock(lines, 0, lines[0].indent, label);
  if (next < lines.length) {
    throw yamlError('unexpected content after the end of the document', lines[next].line, label);
  }
  return value;
}

/**
 * Collect the body of a block scalar.
 *
 * @param {string[]} rawLines
 * @param {number} start        first line after the header
 * @param {number} parentIndent indentation of the key that owns the block
 * @param {string} style        "|" literal or ">" folded
 * @param {string} chomping     "" clip, "-" strip, "+" keep
 * @returns {{value: string, next: number}}
 */
function readBlockScalar(rawLines, start, parentIndent, style, chomping) {
  /** @type {string[]} */
  const body = [];
  let blockIndent = null;
  let cursor = start;

  while (cursor < rawLines.length) {
    const raw = rawLines[cursor];
    if (raw.trim().length === 0) {
      body.push('');
      cursor += 1;
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    if (indent <= parentIndent) break;
    if (blockIndent === null) blockIndent = indent;
    body.push(raw.slice(Math.min(blockIndent, indent)));
    cursor += 1;
  }

  while (body.length > 0 && body[body.length - 1] === '') body.pop();

  const joined = style === '|' ? body.join('\n') : foldLines(body);
  const value = chomping === '-' ? joined : `${joined}\n`;
  return { value, next: cursor };
}

/**
 * Folding for ">": consecutive lines join with a space, a blank line becomes a
 * newline. Deliberately the simple rule (see the module header).
 * @param {string[]} body
 * @returns {string}
 */
function foldLines(body) {
  /** @type {string[]} */
  const paragraphs = [];
  /** @type {string[]} */
  let current = [];
  for (const line of body) {
    if (line.trim().length === 0) {
      paragraphs.push(current.join(' '));
      current = [];
    } else {
      current.push(line.trim());
    }
  }
  paragraphs.push(current.join(' '));
  return paragraphs.join('\n');
}

/**
 * Remove a trailing comment, respecting quoted strings.
 * @param {string} raw
 * @returns {string}
 */
function stripComment(raw) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(raw[i - 1])) return raw.slice(0, i);
    }
  }
  return raw;
}

/**
 * @param {SourceLine[]} lines
 * @param {number} start
 * @param {number} indent
 * @param {string} label
 * @returns {{value: unknown, next: number}}
 */
function parseBlock(lines, start, indent, label) {
  if (start >= lines.length) return { value: null, next: start };
  if (lines[start].text.startsWith('- ') || lines[start].text === '-') {
    return parseSequence(lines, start, indent, label);
  }
  return parseMapping(lines, start, indent, label);
}

/**
 * @param {SourceLine[]} lines
 * @param {number} start
 * @param {number} indent
 * @param {string} label
 * @returns {{value: Record<string, unknown>, next: number}}
 */
function parseMapping(lines, start, indent, label) {
  /** @type {Record<string, unknown>} */
  const map = {};
  let i = start;
  while (i < lines.length) {
    const current = lines[i];
    if (current.indent < indent) break;
    if (current.indent > indent) throw yamlError('unexpected indentation', current.line, label);
    if (current.text.startsWith('- ')) throw yamlError('unexpected sequence item inside a mapping', current.line, label);

    const separator = findKeySeparator(current.text);
    if (separator < 0) throw yamlError(`expected "key: value" but found "${current.text}"`, current.line, label);
    const key = unquote(current.text.slice(0, separator).trim());
    if (key.length === 0) throw yamlError('empty key', current.line, label);
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      throw yamlError(`duplicate key "${key}"`, current.line, label);
    }
    if (current.blockValue !== undefined) {
      map[key] = current.blockValue;
      i += 1;
      continue;
    }

    const inline = current.text.slice(separator + 1).trim();

    if (inline.length > 0) {
      map[key] = parseScalar(inline, current.line, label);
      i += 1;
      continue;
    }
    const nextLine = lines[i + 1];
    if (!nextLine || nextLine.indent <= current.indent) {
      map[key] = null;
      i += 1;
      continue;
    }
    const child = parseBlock(lines, i + 1, nextLine.indent, label);
    map[key] = child.value;
    i = child.next;
  }
  return { value: map, next: i };
}

/**
 * @param {SourceLine[]} lines
 * @param {number} start
 * @param {number} indent
 * @param {string} label
 * @returns {{value: unknown[], next: number}}
 */
function parseSequence(lines, start, indent, label) {
  /** @type {unknown[]} */
  const items = [];
  let i = start;
  while (i < lines.length) {
    const current = lines[i];
    if (current.indent < indent) break;
    if (current.indent > indent) throw yamlError('unexpected indentation in sequence', current.line, label);
    if (!current.text.startsWith('- ') && current.text !== '-') break;

    const inline = current.text === '-' ? '' : current.text.slice(2).trim();
    if (inline.length === 0) {
      const nextLine = lines[i + 1];
      if (!nextLine || nextLine.indent <= current.indent) {
        items.push(null);
        i += 1;
        continue;
      }
      const child = parseBlock(lines, i + 1, nextLine.indent, label);
      items.push(child.value);
      i = child.next;
      continue;
    }
    if (findKeySeparator(inline) >= 0) {
      // "- key: value" starts a nested map whose first line is inline.
      /** @type {SourceLine[]} */
      const synthetic = [{ indent: current.indent + 2, text: inline, line: current.line }];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > current.indent) {
        synthetic.push(lines[j]);
        j += 1;
      }
      const child = parseMapping(synthetic, 0, current.indent + 2, label);
      items.push(child.value);
      i = j;
      continue;
    }
    items.push(parseScalar(inline, current.line, label));
    i += 1;
  }
  return { value: items, next: i };
}

/**
 * Index of the ":" that separates key and value, ignoring quoted sections.
 * @param {string} text
 * @returns {number}
 */
function findKeySeparator(text) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ':' && !inSingle && !inDouble) {
      const next = text[i + 1];
      if (next === undefined || next === ' ') return i;
    }
  }
  return -1;
}

/**
 * @param {string} text
 * @returns {string}
 */
function unquote(text) {
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * @param {string} text
 * @param {number} line
 * @param {string} label
 * @returns {unknown}
 */
function parseScalar(text, line, label) {
  if (text.startsWith('[') || text.startsWith('{')) {
    throw yamlError('flow collections ([...] / {...}) are not supported', line, label);
  }
  if (text.startsWith('|') || text.startsWith('>')) {
    throw yamlError('block scalars (| and >) are not supported', line, label);
  }
  if ((text.startsWith('"') && text.endsWith('"') && text.length >= 2)
    || (text.startsWith("'") && text.endsWith("'") && text.length >= 2)) {
    const inner = text.slice(1, -1);
    return text.startsWith('"') ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner;
  }
  if (text === 'null' || text === '~') return null;
  if (text === 'true' || text === 'yes') return true;
  if (text === 'false' || text === 'no') return false;
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?\d*\.\d+$/.test(text)) return Number.parseFloat(text);
  if (/^-?\d+\.?\d*e-?\d+$/i.test(text)) return Number.parseFloat(text);
  return text;
}
