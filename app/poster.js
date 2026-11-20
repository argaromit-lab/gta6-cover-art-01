export const sizes = {
  landscape: [1920, 1080],
  portrait: [1080, 1350],
  square: [1080, 1080],
};

export const layouts = {
  coast: {
    landscape: [
      [[0,0],[.405,0],[.37,.74],[0,.74]],
      [[.415,0],[.70,0],[.70,.355],[.405,.355]],
      [[.71,0],[1,0],[1,.355],[.71,.355]],
      [[.405,.37],[.603,.37],[.57,.74],[.38,.74]],
      [[.612,.37],[.804,.37],[.80,.74],[.58,.74]],
      [[.813,.37],[1,.37],[1,.74],[.81,.74]],
    ],
    portrait: [
      [[0,0],[.63,0],[.60,.50],[0,.50]],
      [[.64,0],[1,0],[1,.50],[.64,.50]],
      [[0,.52],[.245,.52],[.24,.76],[0,.76]],
      [[.255,.52],[.50,.52],[.50,.76],[.25,.76]],
      [[.51,.52],[.755,.52],[.75,.76],[.505,.76]],
      [[.765,.52],[1,.52],[1,.76],[.76,.76]],
    ],
    square: [
      [[0,0],[.58,0],[.54,.74],[0,.74]],
      [[.59,0],[.795,0],[.795,.355],[.59,.355]],
      [[.805,0],[1,0],[1,.355],[.805,.355]],
      [[.56,.37],[.705,.37],[.70,.74],[.55,.74]],
      [[.715,.37],[.86,.37],[.86,.74],[.705,.74]],
      [[.87,.37],[1,.37],[1,.74],[.865,.74]],
    ],
  },
  boulevard: [
    [[0,0],[.32,0],[.23,1],[0,1]],
    [[.32,0],[.73,0],[.66,1],[.23,1]],
    [[.73,0],[1,0],[1,1],[.66,1]],
  ],
  tidal: [
    [[0,0],[.61,0],[.53,.50],[0,.59]],
    [[.61,0],[1,0],[1,.44],[.53,.50]],
    [[0,.59],[.53,.50],[.48,1],[0,1]],
    [[.53,.50],[1,.44],[1,1],[.48,1]],
  ],
};

const palettes = {
  sunset: { shadow: [33, 9, 36], light: [255, 184, 104], sat: 1.43, mix: .34, contrast: 1.22,
    ink: '#241122', paper: '#fff1d3', script: '#ff9aad', line: '#f2a078' },
  neon: { shadow: [18, 13, 58], light: [255, 131, 191], sat: 1.69, mix: .41, contrast: 1.27,
    ink: '#171029', paper: '#fff1ed', script: '#ff9cdd', line: '#a398fa' },
  ink: { shadow: [18, 34, 45], light: [255, 205, 119], sat: 1.3, mix: .48, contrast: 1.55,
    ink: '#121f28', paper: '#fff0ba', script: '#ffb183', line: '#dbad72' },
};

export const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

export function panelShapes(state) {
  return state.layout === 'coast' ? layouts.coast[state.size] : layouts[state.layout];
}

export function panelPath(points, w, h) {
  const path = new Path2D();
  points.forEach(([x, y], index) => {
    if (index === 0) path.moveTo(x * w, y * h);
    else path.lineTo(x * w, y * h);
  });
  path.closePath();
  return path;
}

export function panelBox(points, w, h) {
  const xs = points.map(([x]) => x * w);
  const ys = points.map(([, y]) => y * h);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function cropBounds(image, box, crop) {
  const scale = Math.max(box.width / image.width, box.height / image.height) * crop.z;
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    width, height,
    mx: (width - box.width) / (2 * box.width),
    my: (height - box.height) / (2 * box.height),
  };
}

const photoGrades = new WeakMap();

// Split tone the luminance, preserve detail, and cache the latest grade per photo.
// Crop gestures reuse the graded pixels instead of reading from the canvas again.
function gradedPhoto(image, grade, strength) {
  if (!strength) return image;
  const key = `${grade}:${strength}`;
  const cached = photoGrades.get(image);
  if (cached?.key === key) return cached.surface;

  const surface = cached?.surface ?? document.createElement('canvas');
  const scale = Math.min(1, 1700 / Math.max(image.width, image.height));
  surface.width = Math.max(1, Math.round(image.width * scale));
  surface.height = Math.max(1, Math.round(image.height * scale));
  const ctx = surface.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, surface.width, surface.height);
  const pixels = ctx.getImageData(0, 0, surface.width, surface.height);
  const { shadow, light, sat, mix, contrast } = palettes[grade];
  const data = pixels.data;
  const amount = strength / 100;
  const clean = grade === 'ink' ? new Uint8ClampedArray(data) : null;
  const row = surface.width * 4;

  for (let i = 0; i < data.length; i += 4) {
    const luma = data[i] * .24 + data[i + 1] * .65 + data[i + 2] * .11;
    const tone = clamp((luma - 113) * contrast + 113, 0, 255);
    const inkLevel = grade === 'ink' ? tone * .55 + Math.round(tone / 26) * 26 * .45 : tone;
    const t = inkLevel / 255;
    const edge = clean && i >= row && i < data.length - row
      ? Math.max(0, Math.abs(clean[i - row + 1] - clean[i + row + 1]) - 24) * .41
      : 0;
    for (let c = 0; c < 3; c += 1) {
      const split = shadow[c] + (light[c] - shadow[c]) * t;
      const natural = tone + (data[i + c] - luma) * sat;
      data[i + c] += (natural * (1 - mix) + split * mix - edge - data[i + c]) * amount;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  photoGrades.set(image, { key, surface });
  return surface;
}

let grain;
function printGrain(ctx, w, h, amount) {
  if (!grain) {
    grain = document.createElement('canvas');
    grain.width = grain.height = 149;
    const g = grain.getContext('2d');
    const field = g.createImageData(149, 149);
    let seed = 92017;
    for (let i = 0; i < field.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const value = seed >>> 24;
      field.data.set([value, value, value, 255], i);
    }
    g.putImageData(field, 0, 0);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = amount;
  ctx.fillStyle = ctx.createPattern(grain, 'repeat');
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const letters = text => Array.from(graphemes.segment(text), part => part.segment);

function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/u)) {
    const joined = line ? `${line} ${word}` : word;
    if (ctx.measureText(joined).width <= maxWidth) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    for (const part of letters(word)) {
      if (line && ctx.measureText(line + part).width > maxWidth) {
        lines.push(line);
        line = '';
      }
      line += part;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitTitle(ctx, title, width, maxSize, lineLimit) {
  let size = Math.floor(maxSize);
  let lines;
  do {
    ctx.font = `italic 900 ${size}px "Barlow Condensed"`;
    ctx.letterSpacing = `${size * .005}px`;
    lines = wrap(ctx, title, width);
    if (lines.length <= lineLimit) break;
    size -= 2;
  } while (size >= 12);
  return { size, lines };
}

function drawSceneLabels(ctx, points, state, photos, w, h) {
  if (!state.showLabels) return;
  const paths = points.map(shape => panelPath(shape, w, h));
  const unit = Math.min(w, h);
  const fontSize = clamp(unit * .016, 12, 25);
  const height = fontSize * 1.85;
  const margin = unit * .026;
  const available = unit * .23;
  ctx.save();
  ctx.font = `700 ${fontSize}px "Public Sans"`;
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = `${fontSize * .045}px`;
  points.forEach((shape, index) => {
    const crop = state.crops[index];
    const photo = photos[crop?.photo];
    if (!photo) return;
    const box = panelBox(shape, w, h);
    const maxTextWidth = Math.max(fontSize * 3, Math.min(box.width - margin * 2, available));
    let label = (crop?.label || photo.name || '').trim().toLocaleUpperCase();
    let iterations = 0;
    while (label.length > 1 && ctx.measureText(label).width > maxTextWidth - fontSize * 1.5 && iterations < 50) {
      label = `${label.slice(0, -2).trimEnd()}…`;
      iterations++;
    }
    const labelWidth = Math.min(maxTextWidth, ctx.measureText(label).width + fontSize * 1.45);
    const x = box.x + margin;
    const y = box.y + margin;
    const radius = Math.min(fontSize * .22, 6);
    ctx.save();
    ctx.clip(paths[index]);
    ctx.fillStyle = 'rgba(22, 10, 27, .88)';
    ctx.beginPath();
    ctx.roundRect(x, y, labelWidth, height, radius);
    ctx.fill();
    ctx.fillStyle = '#ff7daf';
    ctx.fillRect(x, y, Math.max(3, fontSize * .22), height);
    ctx.fillStyle = '#fff5e9';
    ctx.fillText(label, x + fontSize * .62, y + height * .51, maxTextWidth - fontSize * .7);
    ctx.restore();
  });
  ctx.restore();
}

function drawSunEmblem(ctx, x, y, radius, palette) {
  ctx.save();
  ctx.lineWidth = Math.max(2, radius * .055);
  ctx.strokeStyle = palette.line;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y + radius * .07, radius * .39, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - radius * .56, y + radius * .18);
  ctx.lineTo(x + radius * .56, y + radius * .18);
  ctx.moveTo(x - radius * .48, y + radius * .36);
  ctx.lineTo(x + radius * .48, y + radius * .36);
  ctx.moveTo(x - radius * .34, y + radius * .54);
  ctx.lineTo(x + radius * .34, y + radius * .54);
  ctx.stroke();
  ctx.restore();
}

function drawHalftone(ctx, top, w, h, color) {
  ctx.save();
  ctx.fillStyle = color;
  for (let y = top + 10; y < h - 4; y += 18) {
    for (let x = 8; x < w - 4; x += 18) {
      const radius = ((x / 18 + y / 18) % 3 === 0) ? 1.5 : 1;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawType(ctx, w, h, state, palette) {
  const wide = state.size === 'landscape';
  const portrait = state.size === 'portrait';
  const title = state.caption.trim().toUpperCase();
  const subtitle = state.subtitle.trim();
  const minimal = state.type === 'minimal';
  const scale = state.typeScale / 100;
  if (!title && !subtitle) return;

  const top = h * (wide ? .74 : portrait ? .68 : .70);
  const band = h - top;
  ctx.save();
  const field = ctx.createLinearGradient(0, top, w, h);
  field.addColorStop(0, palette.ink);
  field.addColorStop(.48, state.grade === 'neon' ? '#3d173d' : '#4b1d35');
  field.addColorStop(1, state.grade === 'ink' ? '#243b3e' : '#9c3850');
  ctx.fillStyle = field;
  ctx.fillRect(0, top, w, band);
  drawHalftone(ctx, top, w, h, 'rgba(255, 229, 220, .16)');
  ctx.fillStyle = palette.line;
  ctx.fillRect(0, top, w, Math.max(3, h * .003));
  ctx.globalAlpha = .55;
  ctx.fillRect(0, top + h * .013, w, Math.max(1, h * .001));
  ctx.globalAlpha = 1;

  const badgeRadius = Math.min(band * .22, w * .042);
  const badgeX = w * .09;
  const centerY = top + band * .52;
  drawSunEmblem(ctx, badgeX, centerY, badgeRadius, palette);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = palette.paper;
  ctx.font = `700 ${Math.max(9, band * .055)}px "Public Sans"`;
  ctx.letterSpacing = `${Math.max(.5, band * .004)}px`;
  ctx.fillText('C  A', badgeX, centerY + badgeRadius * .77);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = palette.line;
  ctx.font = `700 ${Math.max(11, band * .09)}px "Public Sans"`;
  ctx.letterSpacing = `${band * .01}px`;
  ctx.fillText('COASTLINE', w * .15, top + band * .30, w * .18);
  ctx.fillStyle = '#fff0e6';
  ctx.font = `600 ${Math.max(9, band * .06)}px "Public Sans"`;
  ctx.letterSpacing = `${band * .008}px`;
  ctx.fillText('ATELIER', w * .15, top + band * .41, w * .16);

  const titleCx = w * .62;
  const maxTitleWidth = w * .56;
  ctx.translate(titleCx, 0);
  if (!minimal) ctx.rotate(-.018);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  let titleLines = 1;
  if (title) {
    const maxTitleSize = band * (minimal ? .42 : .55) * scale;
    let fitted = fitTitle(ctx, title, maxTitleWidth,
      maxTitleSize,
      wide && letters(title).length <= 22 ? 1 : 2);
    if (fitted.lines.length > 1 && fitted.size > band * .32) {
      fitted = fitTitle(ctx, title, maxTitleWidth, maxTitleSize * .75, 2);
    }
    const { size, lines } = fitted;
    titleLines = lines.length;
    const leading = size * .78;
    const titleY = top + band * (lines.length > 1 ? .32 : .42);
    lines.forEach((line, i) => {
      const y = titleY + (i - (lines.length - 1) / 2) * leading;
      ctx.letterSpacing = `${size * .01}px`;
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = size * .12;
      ctx.strokeText(line, 0, y + size * .05);
      ctx.fillStyle = palette.ink;
      ctx.fillText(line, size * .03, y + size * .05);
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = size * .022;
      ctx.strokeText(line, 0, y);
      const print = ctx.createLinearGradient(0, y - size * .5, 0, y + size * .42);
      print.addColorStop(0, palette.paper);
      print.addColorStop(.48, minimal ? palette.paper : '#ffd58c');
      print.addColorStop(1, state.grade === 'ink' ? '#f0a36d' : '#f26498');
      ctx.fillStyle = print;
      ctx.fillText(line, 0, y);
    });
  }

  if (subtitle) {
    let size = Math.min(band * .22, w * .065) * Math.min(1.05, Math.sqrt(scale));
    ctx.letterSpacing = '0px';
    const maxSubtitleWidth = maxTitleWidth;
    let iterations = 0;
    do {
      ctx.font = minimal ? `600 ${size * .62}px "Barlow Condensed"` : `${size}px Yellowtail`;
      if (ctx.measureText(subtitle).width <= maxSubtitleWidth || iterations > 20) break;
      size *= .94;
      iterations++;
    } while (size > 9);
    const y = top + band * (titleLines > 1 ? .80 : .82);
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = Math.max(2, size * .08);
    ctx.strokeText(subtitle, 0, y, maxSubtitleWidth);
    ctx.fillStyle = palette.script;
    ctx.fillText(subtitle, 0, y, maxSubtitleWidth);
  }
  ctx.restore();
}

export function paintPoster(canvas, state, photos) {
  const [w, h] = sizes[state.size];
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  const palette = palettes[state.grade];
  const points = panelShapes(state);
  const paths = points.map(polygon => panelPath(polygon, w, h));
  const unit = Math.min(w, h);
  ctx.fillStyle = palette.ink;
  ctx.fillRect(0, 0, w, h);

  paths.forEach((path, i) => {
    const crop = state.crops[i];
    const photo = photos[crop.photo];
    if (!photo) return;
    const box = panelBox(points[i], w, h);
    const fit = cropBounds(photo.image, box, crop);
    const dx = clamp(crop.x, -fit.mx, fit.mx) * box.width;
    const headroom = photo.name === 'Boulevard' && photo.image.src.endsWith('/samples/boulevard.jpg') ? fit.my * .82 : 0;
    const dy = clamp(crop.y + headroom, -fit.my, fit.my) * box.height;
    ctx.save();
    ctx.clip(path);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(gradedPhoto(photo.image, state.grade, state.intensity),
      box.x + (box.width - fit.width) / 2 + dx,
      box.y + (box.height - fit.height) / 2 + dy, fit.width, fit.height);
    ctx.restore();
  });

  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = unit * .014;
  paths.forEach(path => ctx.stroke(path));
  ctx.save();
  ctx.globalAlpha = .7;
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = unit * .0018;
  paths.forEach(path => ctx.stroke(path));
  ctx.restore();

  const shade = ctx.createLinearGradient(0, h * .53, 0, h);
  const shadeWeight = state.caption.trim() || state.subtitle.trim() ? 1 : .45;
  shade.addColorStop(0, palette.ink + '00');
  shade.addColorStop(.46, palette.ink + '54');
  shade.addColorStop(.82, palette.ink + 'd0');
  shade.addColorStop(1, palette.ink + 'ff');
  ctx.globalAlpha = shadeWeight;
  ctx.fillStyle = shade;
  ctx.fillRect(0, h * .53, w, h * .47);
  ctx.globalAlpha = 1;
  printGrain(ctx, w, h, .09 + state.intensity * .0005);
  drawSceneLabels(ctx, points, state, photos, w, h);

  const inset = unit * .023;
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = unit * .00145;
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  const footing = h - inset * 1.85;
  ctx.fillStyle = palette.line;
  ctx.fillRect(inset, footing, w - inset * 2, unit * .0016);
  ctx.fillRect(inset, footing + unit * .007, unit * .052, unit * .003);
  ctx.fillRect(w - inset - unit * .052, footing + unit * .007, unit * .052, unit * .003);
  drawType(ctx, w, h, state, palette);
}
