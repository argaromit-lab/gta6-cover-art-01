import { sizes } from './poster.js';

const VALID_SIZES = Object.keys(sizes);
const VALID_LAYOUTS = ['coast', 'boulevard', 'tidal'];
const VALID_GRADES = ['sunset', 'neon', 'ink'];
const VALID_TYPES = ['marquee', 'minimal'];

export function freshCrop(photo, label = '') {
  return { photo: Number(photo) || 0, x: 0, y: 0, z: 1, label: String(label || '') };
}

export function defaultState() {
  const samples = [
    ['boulevard', 'Boulevard'],
    ['sunset', 'Last light'],
    ['neon', 'Ocean Drive'],
    ['wake', 'Open water'],
    ['pier', 'The pier'],
    ['skyline', 'Skyline'],
  ];
  return {
    size: 'landscape',
    layout: 'coast',
    grade: 'sunset',
    intensity: 74,
    caption: 'Salt & Static',
    subtitle: 'The coast after dark',
    type: 'marquee',
    typeScale: 100,
    showLabels: false,
    crops: Array.from({ length: 6 }, (_, i) => freshCrop(i, samples[i]?.[1] || `Panel ${i + 1}`)),
  };
}

export function validateState(state, maxPhotos = 36) {
  if (!state || typeof state !== 'object') throw new Error('Invalid state object');
  if (!VALID_SIZES.includes(state.size)) throw new Error('Invalid size');
  if (!VALID_LAYOUTS.includes(state.layout)) throw new Error('Invalid layout');
  if (!VALID_GRADES.includes(state.grade)) throw new Error('Invalid grade');
  if (typeof state.intensity !== 'number' || !Number.isFinite(state.intensity) || state.intensity < 0 || state.intensity > 100) throw new Error('Invalid intensity');
  if (typeof state.caption !== 'string' || state.caption.length > 100) throw new Error('Invalid caption');
  if (typeof state.subtitle !== 'string' || state.subtitle.length > 100) throw new Error('Invalid subtitle');
  if (!VALID_TYPES.includes(state.type)) throw new Error('Invalid type style');
  if (typeof state.typeScale !== 'number' || !Number.isFinite(state.typeScale) || state.typeScale < 65 || state.typeScale > 115) throw new Error('Invalid typeScale');
  if (typeof state.showLabels !== 'boolean') throw new Error('Invalid showLabels');
  if (!Array.isArray(state.crops) || state.crops.length === 0 || state.crops.length > 36) throw new Error('Invalid crops array');

  const validatedCrops = state.crops.map(crop => {
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
  });

  return {
    size: state.size,
    layout: state.layout,
    grade: state.grade,
    intensity: state.intensity,
    caption: state.caption,
    subtitle: state.subtitle,
    type: state.type,
    typeScale: state.typeScale,
    showLabels: state.showLabels,
    crops: validatedCrops,
  };
}

export function createHistoryStore(initialState) {
  let state = structuredClone(initialState);
  const undoStack = [];
  const redoStack = [];
  let activeCoalesceKey = null;

  return {
    getState() {
      return state;
    },
    canUndo() {
      return undoStack.length > 0;
    },
    canRedo() {
      return redoStack.length > 0;
    },
    commit(updater, coalesceKey = null) {
      const before = structuredClone(state);
      const nextState = structuredClone(state);
      const result = typeof updater === 'function' ? updater(nextState) : structuredClone(updater);
      const next = (result !== undefined && typeof result === 'object') ? result : nextState;
      if (JSON.stringify(before) === JSON.stringify(next)) return;

      if (coalesceKey && coalesceKey === activeCoalesceKey && undoStack.length > 0) {
        state = next;
        return;
      }

      undoStack.push(before);
      if (undoStack.length > 60) undoStack.shift();
      redoStack.length = 0;
      state = next;
      activeCoalesceKey = coalesceKey;
    },
    endCoalesce() {
      activeCoalesceKey = null;
    },
    undo() {
      if (!undoStack.length) return false;
      redoStack.push(structuredClone(state));
      state = undoStack.pop();
      activeCoalesceKey = null;
      return true;
    },
    redo() {
      if (!redoStack.length) return false;
      undoStack.push(structuredClone(state));
      state = redoStack.pop();
      activeCoalesceKey = null;
      return true;
    },
    reset(newState) {
      state = structuredClone(newState);
      undoStack.length = 0;
      redoStack.length = 0;
      activeCoalesceKey = null;
    }
  };
}
