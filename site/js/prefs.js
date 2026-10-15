// Per-viewer settings (like a chart's selected range) kept in this browser only; never sent anywhere.
const PREFIX = 'xbtstats:';

export function loadPref(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback; // storage blocked or junk: use the default
  }
}

export function savePref(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage blocked (private mode, settings): the choice just won't be remembered
  }
}
