import { validateMagicBytes } from './project-bundle.js';

export const MAX_DIMENSION = 8192;
export const MAX_PIXELS = 32 * 1024 * 1024; // 32 MP
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

const activeResources = new Set();
let unloadRegistered = false;

function ensureUnloadListener() {
  if (unloadRegistered || typeof window === 'undefined') return;
  unloadRegistered = true;
  window.addEventListener('pagehide', () => {
    disposeAllPhotoResources();
  });
}

export function registerPhotoResource(resource) {
  if (resource && typeof resource.dispose === 'function') {
    activeResources.add(resource);
    ensureUnloadListener();
  }
  return resource;
}

export function disposePhotoResource(resource) {
  if (resource && typeof resource.dispose === 'function') {
    activeResources.delete(resource);
    resource.dispose();
  }
}

export function disposeAllPhotoResources() {
  for (const resource of activeResources) {
    try {
      resource.dispose();
    } catch (e) {}
  }
  activeResources.clear();
}

export function validateDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return { valid: false, error: 'Dimensions must be positive finite integers' };
  }
  if (width <= 0 || height <= 0) {
    return { valid: false, error: 'Dimensions must be greater than zero' };
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return { valid: false, error: `Image dimensions exceed maximum allowed limit (${MAX_DIMENSION}px)` };
  }
  if ((width * height) > MAX_PIXELS) {
    return { valid: false, error: `Image total pixels exceed maximum allowed limit (32 MP)` };
  }
  return { valid: true };
}

export async function decodePhotoBlob(bytes, mime, name) {
  if (!bytes || bytes.length === 0) {
    throw new Error('Empty photo bytes');
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new Error('Photo exceeds maximum size limit (10 MB)');
  }
  const magic = validateMagicBytes(bytes, mime);
  if (!magic.valid) {
    throw new Error(`Asset magic validation failed: ${magic.error}`);
  }

  const blob = new Blob([bytes], { type: magic.mime });
  const objectUrl = URL.createObjectURL(blob);
  let revoked = false;

  const revokeOnce = () => {
    if (!revoked) {
      revoked = true;
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (e) {}
    }
  };

  const image = new Image();
  let timerId = null;

  try {
    await new Promise((resolve, reject) => {
      timerId = setTimeout(() => {
        reject(new Error('Image decode timed out'));
      }, 10000);

      image.onload = () => {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        resolve();
      };
      image.onerror = () => {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        reject(new Error('Failed to decode image asset'));
      };
      image.src = objectUrl;
    });
  } catch (err) {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    revokeOnce();
    throw err;
  }

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const dimVal = validateDimensions(width, height);
  if (!dimVal.valid) {
    revokeOnce();
    throw new Error(dimVal.error);
  }

  const resource = {
    image,
    name: String(name || 'Photo').slice(0, 80),
    bytes,
    mime: magic.mime,
    objectUrl,
    disposed: false,
    dispose() {
      if (resource.disposed) return;
      resource.disposed = true;
      activeResources.delete(resource);
      revokeOnce();
    }
  };

  registerPhotoResource(resource);
  return resource;
}
