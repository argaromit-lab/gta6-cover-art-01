import { sizes, clamp, cropBounds, panelBox, panelPath, panelShapes, paintPoster } from './poster.js';

const byId = id => document.getElementById(id);
const canvas = byId('cover');
const ctx = canvas.getContext('2d', { alpha: false });
const photos = [];
const undo = [];
const redo = [];
const fields = ['caption', 'subtitle', 'type', 'typeScale', 'layout', 'intensity'];
const samples = [
  ['boulevard', 'Boulevard'],
  ['sunset', 'Last light'],
  ['neon', 'Ocean Drive'],
  ['wake', 'Open water'],
  ['pier', 'The pier'],
  ['skyline', 'Skyline'],
];

const freshCrop = (photo, label = '') => ({ photo, x: 0, y: 0, z: 1, label });
let editing = null;
let selected = 0;
let pointerDrag;
let frame = 0;
let ready = false;
let exporting = false;
let uploads = Promise.resolve();
let state = {
  size: 'landscape', layout: 'coast', grade: 'sunset', intensity: 74,
  caption: 'Salt & Static', subtitle: 'The coast after dark',
  type: 'marquee', typeScale: 100,
  showLabels: false,
  crops: Array.from({ length: 6 }, (_, i) => freshCrop(i, samples[i]?.[1] || `Panel ${i + 1}`)),
};

function checkpoint(snapshot = structuredClone(state)) {
  undo.push(snapshot);
  if (undo.length > 60) undo.shift();
  redo.length = 0;
}

function applyChange(update) {
  editing = null;
  const before = structuredClone(state);
  update();
  if (JSON.stringify(before) !== JSON.stringify(state)) checkpoint(before);
  refresh();
}

function travel(from, to) {
  if (!from.length) return;
  editing = null;
  to.push(state);
  state = from.pop();
  refresh();
}

function queueRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    paintPoster(canvas, state, photos);
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
    button.textContent = `Panel ${i + 1}`;
    button.addEventListener('click', () => selectPanel(i));
    row.append(button);
  }
}

function refresh() {
  const points = panelShapes(state);
  const [width, height] = sizes[state.size];
  selected = Math.min(selected, points.length - 1);
  const crop = state.crops[selected];
  setPanelCount(points.length);

  for (const id of fields) {
    if (byId(id).value !== String(state[id])) byId(id).value = state[id];
  }
  byId('zoom').value = crop.z;
  byId('zoom-value').textContent = `${crop.z.toFixed(2)}×`;
  byId('intensity-value').textContent = `${state.intensity}%`;
  byId('typeScale-value').textContent = `${state.typeScale}%`;
  byId('sceneLabel').value = crop.label ?? '';
  byId('showLabels').checked = !!state.showLabels;
  byId('undo').disabled = !undo.length;
  byId('redo').disabled = !redo.length;
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

async function readPhoto(src, name) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return { image, name };
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
    applyChange(() => { state.crops[selected] = freshCrop(index, photo.name.replace(/\.[^.]+$/, '') || 'Photo'); });
  });
  byId('photos').append(button);
  photos.push({ ...photo, button });
}

async function addFiles(files) {
  const decoded = [];
  const startingPanel = selected;
  let skipped = 0;
  for (const file of files) {
    if ((file.type && !file.type.startsWith('image/')) || file.size > 30 * 1024 * 1024 || photos.length + decoded.length >= 36) {
      skipped += 1;
      continue;
    }
    const src = URL.createObjectURL(file);
    try {
      const name = file.name.replace(/\.[^.]+$/, '') || 'New photo';
      const p = await readPhoto(src, name);
      decoded.push(p);
    } catch {
      skipped += 1;
      URL.revokeObjectURL(src);
    }
  }
  if (decoded.length) {
    const start = photos.length;
    decoded.forEach(addPhoto);
    applyChange(() => {
      const count = panelShapes(state).length;
      const panel = Math.min(startingPanel, count - 1);
      decoded.forEach((p, i) => {
        state.crops[(panel + i) % count] = freshCrop(start + i, p.name.replace(/\.[^.]+$/, '') || 'Photo');
      });
    });
    decoded[0] && photos[start].button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const message = decoded.length ? `Added ${decoded.length} ${decoded.length === 1 ? 'photo' : 'photos'}.` : '';
  const failure = skipped ? ` ${skipped} skipped. Try a JPG, PNG or WebP under 30 MB. The shelf holds 36 photos.` : '';
  byId('status').textContent = (message + failure).trim();
}

byId('sceneLabel').addEventListener('input', () => {
  changeContinuous('sceneLabel', () => {
    state.crops[selected].label = byId('sceneLabel').value;
  });
});
byId('sceneLabel').addEventListener('blur', () => { editing = null; });

byId('showLabels').addEventListener('change', () => {
  applyChange(() => {
    state.showLabels = byId('showLabels').checked;
  });
});

byId('fill-all').addEventListener('click', () => {
  applyChange(() => {
    const activeCount = panelShapes(state).length;
    const source = state.crops[selected];
    for (let i = 0; i < activeCount; i++) {
      state.crops[i] = { ...source };
    }
  });
});

byId('clear-lettering').addEventListener('click', () => {
  applyChange(() => {
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

function changeContinuous(id, update) {
  if (editing !== id) {
    checkpoint();
    editing = id;
  }
  update();
  refresh();
}

fields.forEach(id => {
  const field = byId(id);
  const continuous = field.matches('[type="text"], [type="range"]');
  field.addEventListener(continuous ? 'input' : 'change', () => {
    const value = field.type === 'range' ? Number(field.value) : field.value;
    const write = () => { state[id] = value; };
    if (continuous) changeContinuous(id, write);
    else applyChange(write);
  });
  field.addEventListener('blur', () => { editing = null; });
  if (field.type === 'range') field.addEventListener('change', () => { editing = null; });
});

document.querySelectorAll('button[data-size], button[data-grade]').forEach(button => {
  button.addEventListener('click', () => {
    applyChange(() => { Object.assign(state, button.dataset); });
  });
});

function activeCropBounds() {
  const crop = state.crops[selected];
  const photo = photos[crop.photo];
  if (!photo) return null;
  const [width, height] = sizes[state.size];
  const box = panelBox(panelShapes(state)[selected], width, height);
  return { box, ...cropBounds(photo.image, box, crop) };
}

function setZoom(value) {
  const crop = state.crops[selected];
  crop.z = Math.round(clamp(value, 1, 3) * 100) / 100;
  const bounds = activeCropBounds();
  if (!bounds) return;
  crop.x = clamp(crop.x, -bounds.mx, bounds.mx);
  crop.y = clamp(crop.y, -bounds.my, bounds.my);
}

byId('zoom').addEventListener('input', () => changeContinuous('zoom', () => setZoom(Number(byId('zoom').value))));
byId('zoom').addEventListener('change', () => { editing = null; });
byId('zoom').addEventListener('blur', () => { editing = null; });
byId('reset').addEventListener('click', () => applyChange(() => {
  state.crops[selected] = freshCrop(state.crops[selected].photo);
}));
byId('undo').addEventListener('click', () => travel(undo, redo));
byId('redo').addEventListener('click', () => travel(redo, undo));
byId('add-photo').addEventListener('click', () => byId('upload').click());
byId('upload').addEventListener('change', event => {
  enqueueFiles(Array.from(event.target.files));
  event.target.value = '';
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
  const x = clamp(drag.cx + (event.clientX - drag.x) * drag.unitsX, -bounds.mx, bounds.mx);
  const y = clamp(drag.cy + (event.clientY - drag.y) * drag.unitsY, -bounds.my, bounds.my);
  const crop = state.crops[selected];
  if (x === crop.x && y === crop.y) return;
  if (!drag.moved) checkpoint();
  drag.moved = true;
  Object.assign(crop, { x, y });
  refresh();
});
canvas.addEventListener('lostpointercapture', () => { pointerDrag = null; });

let wheelTimer;
canvas.addEventListener('wheel', event => {
  if (!ready || event.ctrlKey) return;
  event.preventDefault();
  changeContinuous('wheel', () => setZoom(state.crops[selected].z - Math.sign(event.deltaY) * .06));
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => { if (editing === 'wheel') editing = null; }, 230);
}, { passive: false });

const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
canvas.addEventListener('keydown', event => {
  if (!ready || event.ctrlKey || event.metaKey) return;
  if (event.key === '+' || event.key === '-' || event.key === '=') {
    event.preventDefault();
    applyChange(() => setZoom(state.crops[selected].z + (event.key === '-' ? -.08 : .08)));
  }
  const direction = arrows[event.key];
  if (!direction) return;
  const bounds = activeCropBounds();
  if (!bounds) return;
  event.preventDefault();
  const [dx, dy] = direction;
  const step = event.shiftKey ? .06 : .015;
  applyChange(() => {
    const crop = state.crops[selected];
    crop.x = clamp(crop.x + dx * step, -bounds.mx, bounds.mx);
    crop.y = clamp(crop.y + dy * step, -bounds.my, bounds.my);
  });
});

document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || !['z', 'y'].includes(event.key.toLowerCase())) return;
  if (event.target.matches('input[type="text"], textarea, [contenteditable]')) return;
  event.preventDefault();
  (event.shiftKey || event.key.toLowerCase() === 'y') ? travel(redo, undo) : travel(undo, redo);
});

byId('export').addEventListener('click', () => {
  const output = document.createElement('canvas');
  paintPoster(output, state, photos);
  const { width, height } = output;
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
});

const fontLoads = [
  document.fonts.load('italic 900 100px "Barlow Condensed"'),
  document.fonts.load('600 100px "Barlow Condensed"'),
  document.fonts.load('100px Yellowtail'),
];

const results = await Promise.allSettled(samples.map(([src, name]) => readPhoto(`samples/${src}.jpg`, name)));
let missingSamples = 0;
results.forEach((result, i) => {
  if (result.status === 'fulfilled') {
    const index = photos.length;
    addPhoto(result.value);
    if (i < state.crops.length) state.crops[i].photo = index;
  } else {
    missingSamples += 1;
    if (i < state.crops.length) state.crops[i].photo = 0;
  }
});
await Promise.allSettled(fontLoads);
if (missingSamples) byId('status').textContent = 'Some sample photos could not open. Add your own to keep editing.';
ready = true;
refresh();
