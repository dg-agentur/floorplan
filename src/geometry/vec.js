/**
 * 2D vector primitives.
 *
 * Internal geometry uses plain {x, y} in millimetres and may be fractional.
 * Model points use {x_mm, y_mm} and are always integers. The conversion happens
 * exclusively through fromModel/toModel, which is where rounding is allowed
 * (docs/adr/0002-units-and-coordinates.md).
 */

import { TOLERANCE_MM } from '../model/constants.js';

/** @typedef {{x: number, y: number}} Vec */
/** @typedef {import('../model/types.js').Point} Point */

/**
 * @param {Point} p
 * @returns {Vec}
 */
export function fromModel(p) {
  return { x: p.x_mm, y: p.y_mm };
}

/**
 * @param {Vec} v
 * @returns {Point}
 */
export function toModel(v) {
  return { x_mm: roundMm(v.x), y_mm: roundMm(v.y) };
}

/**
 * Round to whole millimetres. Half away from zero, and never produces -0.
 * @param {number} value
 * @returns {number}
 */
export function roundMm(value) {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot round non finite value: ${value}`);
  }
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

/** @param {Vec} a @param {Vec} b @returns {Vec} */
export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** @param {Vec} a @param {Vec} b @returns {Vec} */
export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** @param {Vec} a @param {number} s @returns {Vec} */
export function scale(a, s) {
  return { x: a.x * s, y: a.y * s };
}

/** @param {Vec} a @param {Vec} b @returns {number} */
export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

/** 2D cross product (z component). @param {Vec} a @param {Vec} b @returns {number} */
export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

/** @param {Vec} a @returns {number} */
export function length(a) {
  return Math.hypot(a.x, a.y);
}

/** @param {Vec} a @param {Vec} b @returns {number} */
export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * @param {Vec} a
 * @returns {Vec}
 */
export function normalize(a) {
  const len = length(a);
  if (len === 0) return { x: 0, y: 0 };
  return { x: a.x / len, y: a.y / len };
}

/**
 * Left normal: rotate 90 degrees counter clockwise.
 * With X right and Y up this points to the left when walking from start to end,
 * which is the definition used for door hinge and swing sides (ADR 0005).
 * @param {Vec} a
 * @returns {Vec}
 */
export function leftNormal(a) {
  return { x: noNegativeZero(-a.y), y: noNegativeZero(a.x) };
}

/** @param {Vec} a @returns {Vec} */
export function rightNormal(a) {
  return { x: noNegativeZero(a.y), y: noNegativeZero(-a.x) };
}

/**
 * Negating a zero component yields -0, which compares unequal to 0 under strict
 * deep equality and would leak into serialised output. Normalise it away.
 * @param {number} value
 * @returns {number}
 */
export function noNegativeZero(value) {
  return value === 0 ? 0 : value;
}

/**
 * @param {Vec} a
 * @param {Vec} b
 * @param {number} t
 * @returns {Vec}
 */
export function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * @param {Vec} a
 * @param {Vec} b
 * @param {number} [tolerance]
 * @returns {boolean}
 */
export function nearlyEqual(a, b, tolerance = TOLERANCE_MM) {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

/**
 * Angle of a vector in degrees, 0 = +X, counter clockwise positive, range (-180, 180].
 * @param {Vec} a
 * @returns {number}
 */
export function angleDeg(a) {
  const deg = (Math.atan2(a.y, a.x) * 180) / Math.PI;
  return deg === -180 ? 180 : deg;
}

/**
 * Rotate around the origin.
 * @param {Vec} a
 * @param {number} deg
 * @returns {Vec}
 */
export function rotate(a, deg) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}
