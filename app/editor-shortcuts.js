/**
 * Reusable keyboard shortcut router, normalization, and editable control detection.
 */

export function isEditable(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName ? target.tagName.toLowerCase() : '';
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (target.getAttribute('type') || 'text').toLowerCase();
    const textTypes = ['text', 'search', 'url', 'tel', 'password', 'email', 'number', 'date', 'datetime-local', 'month', 'week', 'time'];
    return textTypes.includes(type);
  }
  return false;
}

export function normalizeKey(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  const key = event.key;
  if (key) {
    const lower = key.toLowerCase();
    if (['control', 'shift', 'alt', 'meta'].includes(lower)) return '';
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(lower)) {
      parts.push(key);
    } else if (key.length === 1) {
      parts.push(key.toLowerCase());
    } else {
      parts.push(key);
    }
  }
  return parts.join('+');
}

export function createShortcutManager() {
  const registry = new Map();
  return {
    register(shortcut, handler) {
      registry.set(shortcut.toLowerCase(), handler);
    },
    unregister(shortcut) {
      registry.delete(shortcut.toLowerCase());
    },
    handle(event) {
      if (isEditable(event.target)) return false;
      const norm = normalizeKey(event);
      const handler = registry.get(norm.toLowerCase());
      if (handler) {
        if (typeof event.preventDefault === 'function') {
          event.preventDefault();
        }
        handler(event);
        return true;
      }
      return false;
    }
  };
}
