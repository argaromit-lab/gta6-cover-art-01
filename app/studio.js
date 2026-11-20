import { sizes, clamp, cropBounds, panelBox, panelPath, panelShapes, paintPoster } from './poster.js';
import { defaultState, validateState, createHistoryStore, freshCrop } from './project-state.js';
import { serializeProject, importProjectJson, sanitizeFilename } from './project-archive.js';
import { calculateZoom, clampCropOffsets, calculatePointerPan, calculateKeyboardPan } from './crop-geometry.js';
import { createShortcutManager } from './editor-shortcuts.js';
import { decodePhotoBlob, disposePhotoResource } from './photo-resources.js';

const byId = id => document.getElementById(id);
const canvas = byId('cover');
const ctx = canvas.getContext('2d', { alpha: false });
const photos = [];
const historyStore = createHistoryStore(defaultState());
const fields = ['caption', 'subtitle', 'type', 'typeScale', 'layout', 'intensity'];
const samples = [
  ['boulevard', 'Boulevard'],
  ['sunset', 'Last light'],
  ['neon', 'Ocean Drive'],
  ['wake', 'Open water'],
  ['pier', 'The pier'],
  ['skyline', 'Skyline'],
];

let editing = null;
let selected = 0;
let pointerDrag = null;
let frame = 0;
let ready = false;
let exporting = false;
let uploads = Promise.resolve();
let wheelTimer = null;

function applyChange(updater, coalesceKey = null) {
  editing = null;
  historyStore.commit(updater, coalesceKey);
  refresh();
}

function queueRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    paintPoster(canvas, historyStore.getState(), photos);
  });
}

function setPanelCount(count) {
  const row = byId('panels');
  if (row.children.length === count) return;
  if (row.children.length > count) {
    while (row.children.length > count) row.lastElementChild.remove();
  }
  for (let i = row.children.length; i < count; i += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Panel ${i + 1}`;
    button.addEventListener('click', () => selectPanel(i));
    row.append(button);
  }
}

function refresh() {
  const state = historyStore.getState();
  const points = panelShapes(state);
  const [width, height] = sizes[state.size];
  selected = Math.min(selected, points.length - 1);
  const crop = state.crops[selected] || freshCrop(0);
  setPanelCount(points.length);

  for (const id of fields) {
    const el = byId(id);
    if (el && el.value !== String(state[id])) el.value = state[id];
  }
  byId('zoom').value = crop.z;
  byId('zoom-value').textContent = `${crop.z.toFixed(2)}×`;
  byId('intensity-value').textContent = `${state.intensity}%`;
  byId('typeScale-value').textContent = `${state.typeScale}%`;
  byId('sceneLabel').value = crop.label ?? '';
  byId('showLabels').checked = !!state.showLabels;
  byId('undo').disabled = !historyStore.canUndo();
  byId('redo').disabled = !historyStore.canRedo();
  byId('export').disabled = !ready || exporting;
  byId('dimensions').textContent = `${width} × ${height} px`;
  byId('crop-label').textContent = `Panel ${selected + 1} zoom`;
  byId('assign-hint').textContent = `Choose a photo for Panel ${selected + 1}.`;
  byId('stage').dataset.size = state.size;
  byId('selection').firstElementChild.setAttribute('points',
    points[selected].map(([x, y]) => `${x * 1000},${y * 1000}`).join(' '));

  document.querySelectorAll('button[data-size], button[data-grade]').forEach(button => {
    const active = button.dataset.size === state.size || button.dataset.grade === state.grade;
    button.setAttribute('aria-pressed', String(active));
  });
  Array.from(byId('panels').children).forEach((button, i) => {
    button.setAttribute('aria-pressed', String(i === selected));
  });
  photos.forEach(({ button }, i) => button.setAttribute('aria-pressed', String(i === crop.photo)));
  queueRender();
}

function selectPanel(index) {
  editing = null;
  selected = index;
  refresh();
}

function addPhoto(photo) {
  const index = photos.length;
  const button = document.createElement('button');
  button.type = 'button';
  button.title = `Assign ${photo.name}`;
  const thumb = document.createElement('img');
  thumb.src = photo.image.src;
  thumb.alt = '';
  const label = document.createElement('span');
  label.textContent = photo.name;
  button.append(thumb, label);
  button.addEventListener('click', () => {
    applyChange(state => {
      state.crops[selected].photo = index;
    });
  });
  byId('photos').append(button);
  photos.push({ ...photo, button });
}

async function addFiles(files) {
  const decoded = [];
  const startingPanel = selected;
  let skipped = 0;
  for (const file of files) {
    if ((file.type && !file.type.startsWith('image/')) || file.size > 10 * 1024 * 1024 || photos.length + decoded.length >= 36) {
      skipped += 1;
      continue;
    }
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const mime = file.type || 'image/jpeg';
      const resource = await decodePhotoBlob(bytes, mime, file.name.replace(/\.[^.]+$/, '') || 'New photo');
      decoded.push(resource);
    } catch {
      skipped += 1;
    }
  }
  if (decoded.length) {
    const start = photos.length;
    decoded.forEach(addPhoto);
    applyChange(state => {
      const count = panelShapes(state).length;
      const panel = Math.min(startingPanel, count - 1);
      decoded.forEach((p, i) => {
        const targetIndex = (panel + i) % count;
        if (!state.crops[targetIndex]) {
          state.crops[targetIndex] = freshCrop(start + i, p.name.replace(/\.[^.]+$/, '') || 'Photo');
        } else {
          state.crops[targetIndex].photo = start + i;
        }
      });
    });
    decoded[0] && photos[start].button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const message = decoded.length ? `Added ${decoded.length} ${decoded.length === 1 ? 'photo' : 'photos'}.` : '';
  const failure = skipped ? ` ${skipped} skipped. Try a JPG, PNG or WebP under 10 MB. The shelf holds 36 photos.` : '';
  byId('status').textContent = (message + failure).trim();
}

byId('sceneLabel').addEventListener('input', () => {
  applyChange(state => {
    if (state.crops[selected]) {
      state.crops[selected].label = byId('sceneLabel').value;
    }
  }, 'sceneLabel');
});
byId('sceneLabel').addEventListener('blur', () => { editing = null; historyStore.endCoalesce(); });

byId('showLabels').addEventListener('change', () => {
  applyChange(state => {
    state.showLabels = byId('showLabels').checked;
  });
});

byId('fill-all').addEventListener('click', () => {
  applyChange(state => {
    const activeCount = panelShapes(state).length;
    const source = state.crops[selected];
    if (source) {
      for (let i = 0; i < activeCount; i++) {
        state.crops[i] = structuredClone(source);
      }
    }
  });
});

byId('clear-lettering').addEventListener('click', () => {
  applyChange(state => {
    state.caption = '';
    state.subtitle = '';
  });
});

function enqueueFiles(files) {
  if (!files.length) return;
  byId('status').textContent = 'Opening photos…';
  uploads = uploads.then(() => addFiles(files)).catch(() => {
    byId('status').textContent = 'Could not open the photos. Try a JPG, PNG or WebP.';
  });
}

fields.forEach(id => {
  const field = byId(id);
  if (!field) return;
  const continuous = field.matches('[type="text"], [type="range"]');
  field.addEventListener(continuous ? 'input' : 'change', event => {
    const value = field.type === 'range' ? Number(field.value) : field.value;
    const write = state => { state[id] = value; };
    if (continuous) {
      applyChange(write, id);
    } else {
      applyChange(write);
    }
  });
  field.addEventListener('blur', () => { editing = null; historyStore.endCoalesce(); });
  if (field.type === 'range') {
    field.addEventListener('change', () => { editing = null; historyStore.endCoalesce(); });
  }
});

document.querySelectorAll('button[data-size], button[data-grade]').forEach(button => {
  button.addEventListener('click', () => {
    applyChange(state => {
      Object.assign(state, button.dataset);
    });
  });
});

function activeCropBounds() {
  const state = historyStore.getState();
  const crop = state.crops[selected];
  if (!crop) return null;
  const photo = photos[crop.photo];
  if (!photo) return null;
  const [width, height] = sizes[state.size];
  const box = panelBox(panelShapes(state)[selected], width, height);
  return { box, ...cropBounds(photo.image, box, crop) };
}

function setZoom(value) {
  applyChange(state => {
    const crop = state.crops[selected];
    if (!crop) return;
    crop.z = calculateZoom(value);
    const photo = photos[crop.photo];
    if (!photo) return;
    const [width, height] = sizes[state.size];
    const box = panelBox(panelShapes(state)[selected], width, height);
    const cb = cropBounds(photo.image, box, crop);
    const clamped = clampCropOffsets(crop.x, crop.y, cb.mx, cb.my);
    crop.x = clamped.x;
    crop.y = clamped.y;
  }, 'zoom');
}

byId('zoom').addEventListener('input', () => setZoom(Number(byId('zoom').value)));
byId('zoom').addEventListener('change', () => { historyStore.endCoalesce(); });
byId('zoom').addEventListener('blur', () => { historyStore.endCoalesce(); });

byId('reset').addEventListener('click', () => applyChange(state => {
  if (state.crops[selected]) {
    state.crops[selected] = freshCrop(state.crops[selected].photo, state.crops[selected].label);
  }
}));

byId('undo').addEventListener('click', () => {
  historyStore.undo();
  refresh();
});
byId('redo').addEventListener('click', () => {
  historyStore.redo();
  refresh();
});

byId('add-photo').addEventListener('click', () => byId('upload').click());
byId('upload').addEventListener('change', event => {
  enqueueFiles(Array.from(event.target.files));
  event.target.value = '';
});

// Project Save / Open handlers using project-bundle.js
byId('save-project').addEventListener('click', async () => {
  try {
    const state = historyStore.getState();
    const json = await serializeProject(state, photos);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFilename(state.caption || 'project');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    byId('status').textContent = 'Project saved. Photos stay on your device and project JSON contains them.';
  } catch (err) {
    byId('status').textContent = 'Could not save project.';
  }
});

byId('open-project').addEventListener('click', () => {
  byId('import-project').click();
});

byId('import-project').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 40 * 1024 * 1024) {
    byId('status').textContent = 'Could not open project. File exceeds 40 MB limit.';
    return;
  }
  try {
    byId('status').textContent = 'Opening project…';
    const text = await file.text();
    const result = await importProjectJson(text);
    if (!result.success) {
      throw new Error(result.error);
    }

    photos.forEach(p => {
      if (p.button) p.button.remove();
      if (typeof p.dispose === 'function') p.dispose();
    });
    photos.length = 0;
    result.photos.forEach(p => addPhoto(p));
    historyStore.reset(result.state);
    selected = 0;
    refresh();
    byId('status').textContent = `Loaded project with ${result.photos.length} photos. Project recovery successful.`;
  } catch (err) {
    byId('status').textContent = `Could not open project: ${err.message || 'Invalid file or unsupported images'}. Prior project preserved.`;
  }
});

let fileDragDepth = 0;
const hasFiles = event => Array.from(event.dataTransfer.types).includes('Files');
document.addEventListener('dragenter', event => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  fileDragDepth += 1;
  byId('stage').classList.add('dropping');
});
document.addEventListener('dragover', event => {
  if (hasFiles(event)) event.preventDefault();
});
document.addEventListener('dragleave', () => {
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (!fileDragDepth) byId('stage').classList.remove('dropping');
});
document.addEventListener('drop', event => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  fileDragDepth = 0;
  byId('stage').classList.remove('dropping');
  enqueueFiles(Array.from(event.dataTransfer.files));
});

canvas.addEventListener('pointerdown', event => {
  if (!ready || !event.isPrimary || event.button !== 0) return;
  const state = historyStore.getState();
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * canvas.width / rect.width;
  const y = (event.clientY - rect.top) * canvas.height / rect.height;
  const index = panelShapes(state).findIndex(points =>
    ctx.isPointInPath(panelPath(points, canvas.width, canvas.height), x, y));
  if (index < 0) return;

  selectPanel(index);
  const bounds = activeCropBounds();
  if (!bounds) return;
  const crop = state.crops[selected];
  pointerDrag = {
    id: event.pointerId, x: event.clientX, y: event.clientY,
    cx: clamp(crop.x, -bounds.mx, bounds.mx), cy: clamp(crop.y, -bounds.my, bounds.my),
    unitsX: canvas.width / (rect.width * bounds.box.width),
    unitsY: canvas.height / (rect.height * bounds.box.height),
    moved: false,
  };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', event => {
  const drag = pointerDrag;
  if (!drag || drag.id !== event.pointerId) return;
  const bounds = activeCropBounds();
  if (!bounds) return;
  const newOffsets = calculatePointerPan(drag, event, bounds);
  const state = historyStore.getState();
  const crop = state.crops[selected];
  if (!crop || (newOffsets.x === crop.x && newOffsets.y === crop.y)) return;

  if (!drag.moved) {
    historyStore.commit(s => s, 'pan');
  }
  drag.moved = true;
  applyChange(s => {
    const c = s.crops[selected];
    if (c) {
      c.x = newOffsets.x;
      c.y = newOffsets.y;
    }
  }, 'pan');
});

canvas.addEventListener('lostpointercapture', () => {
  if (pointerDrag && pointerDrag.moved) {
    historyStore.endCoalesce();
  }
  pointerDrag = null;
});

canvas.addEventListener('wheel', event => {
  if (!ready || event.ctrlKey) return;
  event.preventDefault();
  const state = historyStore.getState();
  const crop = state.crops[selected];
  if (!crop) return;
  setZoom(crop.z - Math.sign(event.deltaY) * .06);
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => { historyStore.endCoalesce(); }, 230);
}, { passive: false });

// Keyboard shortcut manager integration
const shortcuts = createShortcutManager();

shortcuts.register('Ctrl+z', () => {
  historyStore.undo();
  refresh();
});
shortcuts.register('Ctrl+Shift+z', () => {
  historyStore.redo();
  refresh();
});
shortcuts.register('Ctrl+y', () => {
  historyStore.redo();
  refresh();
});
shortcuts.register('+', () => {
  const state = historyStore.getState();
  const crop = state.crops[selected];
  if (crop) setZoom(crop.z + 0.08);
});
shortcuts.register('-', () => {
  const state = historyStore.getState();
  const crop = state.crops[selected];
  if (crop) setZoom(crop.z - 0.08);
});
shortcuts.register('=', () => {
  const state = historyStore.getState();
  const crop = state.crops[selected];
  if (crop) setZoom(crop.z + 0.08);
});

const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
for (const arrow of Object.keys(arrows)) {
  shortcuts.register(arrow, event => {
    const bounds = activeCropBounds();
    if (!bounds) return;
    event.preventDefault();
    const [dx, dy] = arrows[arrow];
    const step = event.shiftKey ? .06 : .015;
    applyChange(state => {
      const crop = state.crops[selected];
      if (crop) {
        const newOffsets = calculateKeyboardPan(crop, bounds, dx, dy, step);
        crop.x = newOffsets.x;
        crop.y = newOffsets.y;
      }
    });
  });
}

document.addEventListener('keydown', event => {
  shortcuts.handle(event);
});

byId('export').addEventListener('click', () => {
  const exportState = structuredClone(historyStore.getState());
  const output = document.createElement('canvas');
  try {
    paintPoster(output, exportState, photos);
    const [width, height] = sizes[exportState.size];
    output.toBlob(blob => {
      if (!blob) {
        byId('status').textContent = 'Could not save the PNG. Try exporting again.';
        return;
      }
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `coastline-${width}x${height}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      byId('status').textContent = `Exported PNG at ${width} × ${height} px.`;
    }, 'image/png');
  } catch (err) {
    byId('status').textContent = 'Could not save the PNG. Try exporting again.';
  }
});

const fontLoads = [
  document.fonts.load('italic 900 100px "Barlow Condensed"'),
  document.fonts.load('600 100px "Barlow Condensed"'),
  document.fonts.load('100px Yellowtail'),
];

const results = await Promise.allSettled(samples.map(async ([src, name]) => {
  const response = await fetch(`samples/${src}.jpg`);
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const mime = 'image/jpeg';
  return await decodePhotoBlob(bytes, mime, name);
}));

let missingSamples = 0;
results.forEach((result, i) => {
  if (result.status === 'fulfilled') {
    const index = photos.length;
    addPhoto(result.value);
    const state = historyStore.getState();
    if (i < state.crops.length) state.crops[i].photo = index;
  } else {
    missingSamples += 1;
    const state = historyStore.getState();
    if (i < state.crops.length) state.crops[i].photo = 0;
  }
});
await Promise.allSettled(fontLoads);
if (missingSamples) byId('status').textContent = 'Some sample photos could not open. Add your own to keep editing.';
ready = true;
refresh();
