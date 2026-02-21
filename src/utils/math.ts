/**
 * @fileoverview Math utilities for librainian
 *
 * Consolidated clamping functions to avoid duplication across modules.
 */

/**
 * Clamp a value to a range [min, max].
 * @param value - The value to clamp
 * @param min - Minimum bound
 * @param max - Maximum bound
 * @returns The clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Clamp a value to [0, 1].
 * Useful for confidence scores and probabilities.
 * @param value - The value to clamp
 * @returns The value clamped to [0, 1]
 */
export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Clamp a confidence value, handling unknown types gracefully.
 * Returns 0.5 for invalid inputs.
 * @param value - The value to clamp (may be unknown type)
 * @returns A confidence value in [0, 1]
 */
export function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || isNaN(value)) {
    return 0.5;
  }
  return clamp01(value);
}

/**
 * Linear interpolation between two values.
 * @param a - Start value
 * @param b - End value
 * @param t - Interpolation factor [0, 1]
 * @returns Interpolated value
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}
