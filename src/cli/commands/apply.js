import { loadDocument, readJsonFile, saveDocument } from '../../model/io.js';
import { applyOperations, undoOperations } from '../../operations/apply.js';
import { UsageError } from '../../util/errors.js';
import { boolFlag, integerFlag, parseArgs, requirePositional, stringFlag } from '../args.js';
import { finish, note, table } from '../output.js';

export const applySpec = {
  boolean: ['json', 'debug', 'dry-run', 'in-place', 'force'],
  string: ['output', 'stamp', 'quality'],
};

/**
 * Decide where to write, refusing to overwrite silently.
 * @param {import('../args.js').ParsedArgs} args
 * @param {string} inputFile
 * @returns {string|null} null means "do not write"
 */
function resolveTarget(args, inputFile) {
  if (boolFlag(args, 'dry-run')) return null;
  const output = stringFlag(args, 'output');
  if (output) return output;
  if (boolFlag(args, 'in-place')) return inputFile;
  throw new UsageError('MISSING_OUTPUT', 'Specify --output <file>, or --in-place to overwrite the input, or --dry-run to only preview.', {
    hint: 'Writing over the source file is never implicit.',
  });
}

/**
 * @param {string[]} argv
 * @param {import('../output.js').OutputContext} out
 * @returns {number}
 */
export function applyCommand(argv, out) {
  const args = parseArgs(argv, applySpec);
  const file = requirePositional(args, 0, 'the floorplan file');
  const opsFile = requirePositional(args, 1, 'the operations file');

  const { document } = loadDocument(file);
  const operations = readJsonFile(opsFile, opsFile);
  const target = resolveTarget(args, file);

  const result = applyOperations(document, operations, {
    stamp: stringFlag(args, 'stamp'),
    quality: stringFlag(args, 'quality'),
  });

  const blocked = !result.report.ok && !boolFlag(args, 'force');
  let written = null;
  if (target && !blocked) {
    written = saveDocument(target, result.document);
  } else if (blocked) {
    note(out, `not written: the result has ${result.report.counts.ERROR} validation error(s). Use --force to write anyway.`);
  }

  const human = [
    table(['#', 'operation', 'result'], result.results.map((r) => [r.index, r.op, r.summary])),
    '',
    `validation: ${result.report.ok ? 'OK' : 'FAILED'} (errors ${result.report.counts.ERROR}, warnings ${result.report.counts.WARNING}, info ${result.report.counts.INFO})`,
    ...(result.report.issues.filter((i) => i.severity === 'ERROR').map((i) => `  ERROR ${i.rule} ${i.element_id ?? ''}: ${i.message}`)),
    written ? `written: ${written}` : (target ? 'not written (validation failed)' : 'dry run: nothing written'),
  ].join('\n');

  return finish(out, {
    data: {
      input: file,
      operations_file: opsFile,
      applied: result.results,
      report: result.report,
      output: written,
      dry_run: target === null,
    },
    human,
    exitCode: blocked ? 1 : 0,
  });
}

export const undoSpec = {
  boolean: ['json', 'debug', 'dry-run', 'in-place', 'force'],
  string: ['output', 'steps', 'quality'],
};

/**
 * @param {string[]} argv
 * @param {import('../output.js').OutputContext} out
 * @returns {number}
 */
export function undoCommand(argv, out) {
  const args = parseArgs(argv, undoSpec);
  const file = requirePositional(args, 0, 'the floorplan file');
  const steps = integerFlag(args, 'steps') ?? 1;

  const { document } = loadDocument(file);
  const target = resolveTarget(args, file);
  const result = undoOperations(document, { steps, quality: stringFlag(args, 'quality') });

  const blocked = !result.report.ok && !boolFlag(args, 'force');
  let written = null;
  if (target && !blocked) written = saveDocument(target, result.document);

  const human = [
    `undone ${result.undone.length} operation(s):`,
    ...result.undone.map((entry) => `  - ${entry}`),
    '',
    `validation: ${result.report.ok ? 'OK' : 'FAILED'} (errors ${result.report.counts.ERROR})`,
    written ? `written: ${written}` : (target ? 'not written (validation failed)' : 'dry run: nothing written'),
  ].join('\n');

  return finish(out, {
    data: { input: file, undone: result.undone, report: result.report, output: written, dry_run: target === null },
    human,
    exitCode: blocked ? 1 : 0,
  });
}
