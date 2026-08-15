import { loadDocument, writeTextFile } from '../../model/io.js';
import { loadTheme } from '../../themes/load.js';
import { renderSvg } from '../../render/svg/renderer.js';
import { validateDocument } from '../../validation/validate.js';
import { DomainError } from '../../util/errors.js';
import { boolFlag, parseArgs, requirePositional, stringFlag } from '../args.js';
import { finish, note } from '../output.js';

export const renderSpec = {
  boolean: ['json', 'debug', 'force', 'skip-validation'],
  string: ['theme', 'output', 'level', 'title', 'quality'],
};

/**
 * @param {string[]} argv
 * @param {import('../output.js').OutputContext} out
 * @returns {number}
 */
export function renderCommand(argv, out) {
  const args = parseArgs(argv, renderSpec);
  const file = requirePositional(args, 0, 'the floorplan file to render');
  const { document: doc } = loadDocument(file);

  // A broken model must not produce a picture that looks fine.
  if (!boolFlag(args, 'skip-validation')) {
    const report = validateDocument(doc, { quality: stringFlag(args, 'quality') });
    if (!report.ok && !boolFlag(args, 'force')) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `Refusing to render: the document has ${report.counts.ERROR} validation error(s).`,
        {
          details: report.issues.filter((i) => i.severity === 'ERROR').slice(0, 5),
          hint: 'Fix the errors, or pass --force to render anyway (the drawing may be wrong).',
        },
      );
    }
    if (!report.ok) note(out, `rendering an invalid document because --force was given (${report.counts.ERROR} error(s)).`);
  }

  const themeName = stringFlag(args, 'theme') ?? 'technical';
  const theme = loadTheme(themeName);
  const result = renderSvg(doc, theme, {
    levelId: stringFlag(args, 'level'),
    title: stringFlag(args, 'title'),
  });

  const output = stringFlag(args, 'output');
  let written = null;
  if (output) {
    written = writeTextFile(output, result.svg);
  } else if (!out.json) {
    process.stdout.write(result.svg);
    return finish(out, { data: {}, human: '' });
  }

  return finish(out, {
    data: {
      input: file,
      output: written,
      ...result.meta,
      ...(written ? {} : { svg: result.svg }),
    },
    human: written ? `written: ${written}  (${result.meta.viewport.width_px.toFixed(0)} x ${result.meta.viewport.height_px.toFixed(0)} px, theme "${theme.name}")` : '',
  });
}
