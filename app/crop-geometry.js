import { clamp } from './poster.js';

/**
 * Calculates zoom value clamped between 1 and 3, rounded to 2 decimal places.
 */
export function calculateZoom(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.round(clamp(num, 1, 3) * 100) / 100;
}

/**
 * Clamps crop x, y offsets within maximum valid bounds (mx, my).
 */
export function clampCropOffsets(x, y, mx, my) {
  return {
    x: clamp(Number(x) || 0, -mx, mx),
    y: clamp(Number(y) || 0, -my, my),
  };
}

/**
 * Calculates new crop offsets from pointer movement relative to drag start.
 */
export function calculatePointerPan(drag, event, bounds) {
  const dx = (event.clientX - drag.x) * drag.unitsX;
  const dy = (event.clientY - drag.y) * drag.unitsY;
  const rawX = drag.cx + dx;
  const rawY = drag.cy + dy;
  return clampCropOffsets(rawX, rawY, bounds.mx, bounds.my);
}

/**
 * Calculates new crop offsets from keyboard arrow step.
 */
export function calculateKeyboardPan(crop, bounds, dx, dy, step = 0.015) {
  const rawX = crop.x + dx * step;
  const rawY = crop.y + dy * step;
  return clampCropOffsets(rawX, rawY, bounds.mx, bounds.my);
}

/**
 * Validates a crop object.
 */
export function validateCrop(crop, maxPhotos = 36) {
  if (!crop || typeof crop !== 'object') throw new Error('Invalid crop object');
  const photo = Number(crop.photo);
  if (!Number.isInteger(photo) || photo < 0 || photo >= maxPhotos) throw new Error('Invalid photo index');
  const x = Number(crop.x);
  const y = Number(crop.y);
  const z = Number(crop.z);
  const label = String(crop.label ?? '');
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error('Non-finite crop coordinates');
  if (z < 1 || z > 3) throw new Error('Invalid zoom level');
  if (label.length > 60) throw new Error('Excessive label length');
  return { photo, x, y, z, label };
}
