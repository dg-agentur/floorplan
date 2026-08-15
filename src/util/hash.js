import { createHash } from 'node:crypto';
import { canonicalise } from './json.js';

/**
 * Stable digest of any JSON serialisable value.
 * Used for operation digests in the document history and for golden test keys.
 *
 * @param {unknown} value
 * @param {number} [length] number of hex characters, 16..64
 * @returns {string}
 */
export function digest(value, length = 16) {
  const hex = createHash('sha256').update(canonicalise(value), 'utf8').digest('hex');
  return hex.slice(0, Math.max(16, Math.min(64, length)));
}
