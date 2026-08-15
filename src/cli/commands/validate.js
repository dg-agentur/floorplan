import { loadDocument } from '../../model/io.js';
import { validateDocument } from '../../validation/validate.js';
import { listRules } from '../../validation/severityPolicy.js';
import { boolFlag, parseArgs, requirePositional, stringFlag } from '../args.js';
import { finish, note, table } from '../output.js';

export const validateSpec = {
  boolean: ['json', 'debug', 'quiet', 'no-schema'],
  string: ['quality', 'min-severity'],
};

const SEVERITY_ORDER = ['ERROR', 'WARNING', 'INFO'];

/**
 * @param {string[]} argv
 * @param {import('../output.js').OutputContext} out
 * @returns {number}
 */
export function validateCommand(argv, out) {
  const args = parseArgs(argv, validateSpec);
  const file = requirePositional(args, 0, 'the floorplan file to validate');
  const quality = stringFlag(args, 'quality');
  const minSeverity = (stringFlag(args, 'min-severity') ?? 'INFO').toUpperCase();
  const cutoff = SEVERITY_ORDER.indexOf(minSeverity);

  const { document, warnings } = loadDocument(file, { validate: false });
  for (const warning of warnings) note(out, warning);

  const report = validateDocument(document, {
    quality,
    skipSchema: boolFlag(args, 'no-schema'),
  });
  const issues = cutoff >= 0
    ? report.issues.filter((issue) => SEVERITY_ORDER.indexOf(issue.severity) <= cutoff)
    : report.issues;

  const human = [
    `${report.ok ? 'VALID' : 'INVALID'}  ${file}`,
    `quality level: ${report.quality}   errors: ${report.counts.ERROR}  warnings: ${report.counts.WARNING}  info: ${report.counts.INFO}`,
    ...(issues.length > 0
      ? ['', table(
        ['severity', 'rule', 'element', 'message'],
        issues.map((issue) => [
          issue.severity,
          issue.rule,
          issue.element_id ?? issue.pointer ?? '-',
          issue.message,
        ]),
      )]
      : []),
    ...(issues.some((i) => i.hint)
      ? ['', 'hints:', ...[...new Set(issues.filter((i) => i.hint).map((i) => `  - ${i.hint}`))]]
      : []),
  ].join('\n');

  return finish(out, {
    data: { file, ...report, issues },
    human: boolFlag(args, 'quiet') ? `${report.ok ? 'VALID' : 'INVALID'} ${file}` : human,
    exitCode: report.ok ? 0 : 1,
  });
}

export const rulesSpec = { boolean: ['json', 'debug'], string: [] };

/**
 * @param {string[]} argv
 * @param {import('../output.js').OutputContext} out
 * @returns {number}
 */
export function rulesCommand(argv, out) {
  parseArgs(argv, rulesSpec);
  const rules = listRules();
  const human = [
    'Validation rules and their severity per quality level.',
    'A rule that is ERROR at a level makes a document invalid at that level.',
    '',
    table(
      ['rule', 'marketing', 'scaled', 'verified', 'description'],
      rules.map((rule) => [rule.rule, rule.marketing, rule.scaled, rule.verified, rule.description]),
    ),
  ].join('\n');
  return finish(out, { data: { rules }, human });
}
