/**
 * The validator entry point: schema validation plus semantic rules, combined
 * into one report whose severities depend on the document quality level.
 */

import { getSchemaValidator } from '../model/io.js';
import { QUALITY_LEVELS, SEVERITIES } from '../model/constants.js';
import { buildValidationContext } from './context.js';
import { severityFor, SEVERITY_POLICY } from './severityPolicy.js';
import { checkReferences } from './semantic/references.js';
import { checkGeometry } from './semantic/geometry.js';
import { checkTopology } from './semantic/topology.js';
import { checkProvenance } from './semantic/provenance.js';
import { checkPlausibility } from './semantic/plausibility.js';
import { DomainError, UsageError } from '../util/errors.js';

/**
 * @typedef {object} ValidationIssue
 * @property {string} severity ERROR | WARNING | INFO
 * @property {string} rule
 * @property {string} message
 * @property {string} [element_id]
 * @property {string} [level_id]
 * @property {string} [pointer]
 * @property {string} [hint]
 * @property {Record<string, unknown>} [data]
 */

/**
 * @typedef {object} ValidationReport
 * @property {boolean} ok            true when there is no ERROR
 * @property {string} quality        quality level the document was checked against
 * @property {boolean} schema_valid
 * @property {{ERROR: number, WARNING: number, INFO: number}} counts
 * @property {ValidationIssue[]} issues
 */

/** Semantic rule modules, executed in this order. */
const RULE_MODULES = [
  { name: 'references', run: checkReferences },
  { name: 'geometry', run: checkGeometry },
  { name: 'topology', run: checkTopology },
  { name: 'provenance', run: checkProvenance },
  { name: 'plausibility', run: checkPlausibility },
];

/**
 * @param {import('../model/types.js').FloorplanDocument} doc
 * @param {{quality?: string, skipSchema?: boolean}} [options]
 * @returns {ValidationReport}
 */
export function validateDocument(doc, options = {}) {
  const quality = options.quality ?? doc?.project?.quality ?? 'marketing';
  if (!(/** @type {readonly string[]} */ (QUALITY_LEVELS).includes(quality))) {
    throw new UsageError('UNKNOWN_QUALITY_LEVEL', `Unknown quality level "${quality}".`, {
      hint: `Expected one of: ${QUALITY_LEVELS.join(', ')}`,
    });
  }

  /** @type {ValidationIssue[]} */
  const issues = [];
  let schemaValid = true;

  if (!options.skipSchema) {
    const schemaErrors = getSchemaValidator('floorplan').validate(doc);
    schemaValid = schemaErrors.length === 0;
    for (const error of schemaErrors) {
      issues.push({
        severity: severityFor('SCHEMA_VIOLATION', quality),
        rule: 'SCHEMA_VIOLATION',
        message: error.message,
        pointer: error.pointer || '/',
        data: { keyword: error.keyword },
      });
    }
  }

  // Semantic rules assume a structurally sound document. Running them on a
  // document that fails the schema produces noise, not information.
  if (schemaValid) {
    const ctx = buildValidationContext(doc, quality);
    for (const module of RULE_MODULES) {
      module.run(ctx);
    }
    for (const finding of ctx.findings) {
      issues.push({
        severity: severityFor(finding.rule, quality),
        rule: finding.rule,
        message: finding.message,
        element_id: finding.element_id,
        level_id: finding.level_id,
        pointer: finding.pointer,
        hint: finding.hint,
        data: finding.data,
      });
    }
  }

  issues.sort(compareIssues);

  const counts = { ERROR: 0, WARNING: 0, INFO: 0 };
  for (const issue of issues) {
    counts[/** @type {'ERROR'|'WARNING'|'INFO'} */ (issue.severity)] += 1;
  }

  return {
    ok: counts.ERROR === 0,
    quality,
    schema_valid: schemaValid,
    counts,
    issues,
  };
}

/**
 * Deterministic ordering: severity, then rule, then element, then message.
 * @param {ValidationIssue} a
 * @param {ValidationIssue} b
 * @returns {number}
 */
function compareIssues(a, b) {
  const sa = SEVERITIES.indexOf(/** @type {any} */ (a.severity));
  const sb = SEVERITIES.indexOf(/** @type {any} */ (b.severity));
  if (sa !== sb) return sa - sb;
  if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
  const ea = a.element_id ?? '';
  const eb = b.element_id ?? '';
  if (ea !== eb) return ea < eb ? -1 : 1;
  const pa = a.pointer ?? '';
  const pb = b.pointer ?? '';
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

/**
 * Throwing variant used before rendering and after applying operations.
 * @param {import('../model/types.js').FloorplanDocument} doc
 * @param {{quality?: string, context?: string}} [options]
 * @returns {ValidationReport}
 */
export function assertValid(doc, options = {}) {
  const report = validateDocument(doc, options);
  if (!report.ok) {
    const firstErrors = report.issues.filter((i) => i.severity === 'ERROR').slice(0, 5);
    const error = new DomainError(
      'VALIDATION_FAILED',
      `${options.context ? `${options.context}: ` : ''}the document has ${report.counts.ERROR} validation error(s).`,
      {
        details: firstErrors,
        hint: 'Run `floorplan validate <file> --json` for the complete report.',
      },
    );
    /** @type {any} */ (error).report = report;
    throw error;
  }
  return report;
}

export { SEVERITY_POLICY };
