import { validateState } from './project-state.js';
import { decodePhotoBlob, validateDimensions, disposePhotoResource } from './photo-resources.js';

export const PROJECT_VERSION = 2;
export const MAX_PROJECT_BYTES = 40 * 1024 * 1024; // 40 MB
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB per photo
export const MAX_PHOTOS = 36;
export const MAX_DIMENSION = 8192;
export const MAX_PIXELS = 32 * 1024 * 1024; // 32 MP

/**
 * Computes SHA-256 hash of Uint8Array bytes using Web Crypto API.
 */
export async function computeSha256(bytes) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Encodes Uint8Array to base64 string safely.
 */
export function uint8ArrayToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  const chunk = 0x8000;
  for (let i = 0; i < len; i += chunk) {
    const subarray = bytes.subarray(i, Math.min(i + chunk, len));
    binary += String.fromCharCode.apply(null, subarray);
  }
  return btoa(binary);
}

/**
 * Decodes base64 string to Uint8Array safely.
 */
export function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Validates magic bytes for PNG, JPEG, and WebP formats.
 */
export function validateMagicBytes(bytes, mime) {
  if (!bytes || bytes.length < 12) {
    return { valid: false, error: 'Asset byte length too short for magic validation' };
  }
  const lowerMime = (mime || '').toLowerCase();

  if (lowerMime === 'image/jpeg') {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      return { valid: false, error: 'Invalid JPEG magic bytes' };
    }
  } else if (lowerMime === 'image/png') {
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47 ||
        bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a) {
      return { valid: false, error: 'Invalid PNG magic bytes' };
    }
  } else if (lowerMime === 'image/webp') {
    if (bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46 ||
        bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50) {
      return { valid: false, error: 'Invalid WebP magic bytes' };
    }
  } else {
    return { valid: false, error: `Unsupported MIME type: ${mime}` };
  }
  return { valid: true, mime: lowerMime };
}

/**
 * Validates a data URL for allowed image types, magic bytes, canonical base64, and size caps.
 */
export function validateDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return { valid: false, error: 'Not a string' };
  const match = dataUrl.match(/^data:(image\/(jpeg|png|webp));base64,(.+)$/i);
  if (!match) return { valid: false, error: 'Invalid data URL format or unsupported MIME type' };
  const mime = match[1].toLowerCase();
  if (mime.includes('svg') || mime === 'image/svg+xml') {
    return { valid: false, error: 'SVG references are forbidden' };
  }
  const base64Data = match[3];

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data)) {
    return { valid: false, error: 'Invalid base64 characters' };
  }
  if (base64Data.length % 4 !== 0) {
    return { valid: false, error: 'Invalid base64 padding or length' };
  }
  const maxBase64Len = Math.ceil(MAX_PHOTO_BYTES / 3) * 4;
  if (base64Data.length > maxBase64Len) {
    return { valid: false, error: 'Base64 data exceeds maximum size limit' };
  }

  let bytes;
  try {
    bytes = base64ToUint8Array(base64Data);
  } catch (e) {
    return { valid: false, error: 'Failed to decode base64 data' };
  }

  if (bytes.length > MAX_PHOTO_BYTES) {
    return { valid: false, error: 'Photo exceeds maximum size limit (10 MB)' };
  }

  return validateMagicBytes(bytes, mime);
}

/**
 * Sanitizes and formats a safe download filename, handling Unicode, path traversal, and punctuation safely.
 */
export function sanitizeFilename(name, prefix = 'coastline-project') {
  const safeName = String(name || '')
    .replace(/^[\/\\]+/, '')
    .replace(/[^a-zA-Z0-9_\-\u0080-\uffff]/g, '_')
    .slice(0, 60);
  const timestamp = Date.now();
  return safeName ? `${prefix}-${safeName}-${timestamp}.json` : `${prefix}-${timestamp}.json`;
}

/**
 * Serializes project state and photos into a schema-v2 portable JSON bundle string.
 */
export async function serializeProject(state, photos) {
  if (!Array.isArray(photos) || photos.length === 0 || photos.length > MAX_PHOTOS) {
    throw new Error('Invalid photos array count (max 36)');
  }
  const validatedState = validateState(state, photos.length);
  const assetMap = new Map();
  const photoEntries = [];

  for (const p of photos) {
    let bytes, mime;
    if (p.bytes && p.mime) {
      bytes = p.bytes;
      mime = p.mime;
      if (bytes.length > MAX_PHOTO_BYTES) throw new Error('Photo exceeds maximum size limit (10 MB)');
      const val = validateMagicBytes(bytes, mime);
      if (!val.valid) throw new Error(`Asset magic validation failed: ${val.error}`);
      const tempRes = await decodePhotoBlob(bytes, mime, p.name);
      tempRes.dispose();
    } else if (p.image) {
      const width = p.image.naturalWidth || p.image.width || 0;
      const height = p.image.naturalHeight || p.image.height || 0;
      const dimVal = validateDimensions(width, height);
      if (!dimVal.valid) {
        throw new Error(dimVal.error);
      }
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      c.getContext('2d').drawImage(p.image, 0, 0);
      const dataUrl = c.toDataURL('image/png');
      const val = validateDataUrl(dataUrl);
      if (!val.valid) throw new Error(`Data URL validation failed: ${val.error}`);
      mime = val.mime;
      bytes = base64ToUint8Array(dataUrl.split(',')[1]);
    } else {
      throw new Error('Invalid photo object');
    }

    const hash = await computeSha256(bytes);
    const name = String(p.name || 'Photo').slice(0, 80);

    if (!assetMap.has(hash)) {
      assetMap.set(hash, {
        hash,
        mime,
        data: uint8ArrayToBase64(bytes)
      });
    }

    photoEntries.push({
      name,
      hash
    });
  }

  if (assetMap.size > MAX_PHOTOS || photoEntries.length > MAX_PHOTOS) {
    throw new Error('Too many assets or photos (max 36)');
  }

  const bundle = {
    version: 2,
    type: 'coastline-project-bundle',
    timestamp: Date.now(),
    state: validatedState,
    photos: photoEntries,
    assets: Array.from(assetMap.values())
  };

  const json = JSON.stringify(bundle);
  const byteLength = new TextEncoder().encode(json).length;
  if (byteLength > MAX_PROJECT_BYTES) {
    throw new Error('Project bundle exceeds maximum size limit (40 MB)');
  }
  return json;
}

/**
 * Asynchronously imports, validates, and decodes a project JSON bundle (schema v1 or v2).
 */
export async function importProjectJson(jsonText) {
  const decodedPhotos = [];
  try {
    if (typeof jsonText !== 'string') {
      return { success: false, error: 'Project text must be a string' };
    }
    const byteLength = new TextEncoder().encode(jsonText).length;
    if (byteLength > MAX_PROJECT_BYTES) {
      return { success: false, error: 'Project file exceeds maximum size limit (40 MB)' };
    }

    let project;
    try {
      project = JSON.parse(jsonText);
    } catch (e) {
      return { success: false, error: 'Invalid JSON format' };
    }

    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      return { success: false, error: 'Project root must be an object' };
    }

    const version = project.version;
    if (typeof version !== 'number' || (version !== 1 && version !== 2)) {
      return { success: false, error: `Unsupported project version: ${version}` };
    }

    if (version === 2) {
      if (project.type !== 'coastline-project-bundle') {
        return { success: false, error: 'Invalid bundle type identifier' };
      }
      if (!Array.isArray(project.photos) || project.photos.length === 0 || project.photos.length > MAX_PHOTOS) {
        return { success: false, error: 'Invalid photo count in bundle' };
      }
      if (!Array.isArray(project.assets) || project.assets.length === 0 || project.assets.length > MAX_PHOTOS) {
        return { success: false, error: 'Missing or empty or oversized assets list in bundle' };
      }
      if (!project.state || typeof project.state !== 'object' || Array.isArray(project.state)) {
        return { success: false, error: 'Missing or invalid project state' };
      }

      // Validate state against photo count BEFORE decoding images
      const validatedState = validateState(project.state, project.photos.length);

      const assetMap = new Map();
      const seenAssetHashes = new Set();
      for (const asset of project.assets) {
        if (!asset || typeof asset.hash !== 'string' || typeof asset.data !== 'string' || typeof asset.mime !== 'string') {
          throw new Error('Malformed asset entry in bundle');
        }
        if (!/^[a-f0-9]{64}$/i.test(asset.hash)) {
          throw new Error('Invalid SHA256 hash format in asset');
        }
        if (seenAssetHashes.has(asset.hash)) {
          throw new Error('Duplicate asset hash in bundle');
        }
        seenAssetHashes.add(asset.hash);

        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data) || asset.data.length % 4 !== 0) {
          throw new Error('Invalid asset base64 encoding');
        }

        let bytes;
        try {
          bytes = base64ToUint8Array(asset.data);
        } catch (e) {
          throw new Error('Failed to decode asset base64 data');
        }
        if (bytes.length > MAX_PHOTO_BYTES) {
          throw new Error('Asset exceeds maximum size limit (10 MB)');
        }
        const val = validateMagicBytes(bytes, asset.mime);
        if (!val.valid) {
          throw new Error(`Asset magic validation failed: ${val.error}`);
        }
        const computedHash = await computeSha256(bytes);
        if (computedHash !== asset.hash) {
          throw new Error('Asset content hash mismatch');
        }
        assetMap.set(asset.hash, { bytes, mime: val.mime });
      }

      const referencedHashes = new Set();
      for (const p of project.photos) {
        if (!p || typeof p.name !== 'string' || typeof p.hash !== 'string') {
          throw new Error('Malformed photo entry in bundle');
        }
        if (!assetMap.has(p.hash)) {
          throw new Error('Photo references missing asset hash');
        }
        referencedHashes.add(p.hash);
      }

      for (const hash of assetMap.keys()) {
        if (!referencedHashes.has(hash)) {
          throw new Error('Unused asset found in bundle');
        }
      }

      for (const p of project.photos) {
        const asset = assetMap.get(p.hash);
        const resource = await decodePhotoBlob(asset.bytes, asset.mime, p.name);
        decodedPhotos.push(resource);
      }

      return { success: true, state: validatedState, photos: decodedPhotos };

    } else if (version === 1) {
      if (!Array.isArray(project.photos) || project.photos.length === 0 || project.photos.length > MAX_PHOTOS) {
        return { success: false, error: 'Invalid photo count in project' };
      }
      if (!project.state || typeof project.state !== 'object' || Array.isArray(project.state)) {
        return { success: false, error: 'Missing or invalid project state' };
      }

      const validatedState = validateState(project.state, project.photos.length);

      for (const p of project.photos) {
        if (!p || typeof p.dataUrl !== 'string') {
          throw new Error('Missing photo dataUrl');
        }
        const val = validateDataUrl(p.dataUrl);
        if (!val.valid) {
          throw new Error(`Photo validation failed: ${val.error}`);
        }

        const bytes = base64ToUint8Array(p.dataUrl.split(',')[1]);
        const resource = await decodePhotoBlob(bytes, val.mime, p.name || 'Photo');
        decodedPhotos.push(resource);
      }

      return { success: true, state: validatedState, photos: decodedPhotos };

    } else {
      return { success: false, error: `Unsupported project version: ${version}` };
    }

  } catch (err) {
    for (const p of decodedPhotos) {
      try { disposePhotoResource(p); } catch (e) {}
    }
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
