// localStorage wrapper: the game also works without storage.

const PREFIX = 'panelka:';
// Lost in Panelka used to be a map of Walk and Relax (keys lostcity:*). On the first launch the walk,
// the seed, the settings and the snowfall are carried over from there, if the browser has them.
const OLD_PREFIX = 'lostcity:';

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable */
  }
}

export const DEFAULT_SEED = 'fog';   // the same default as Walk and Relax: the same yards

export const DEFAULT_SETTINGS = {
  music: 0.6,
  sfx: 0.55,
  sens: 1.0,
  invertY: false,
  fov: 68,
  pixel: 2,          // size of one game pixel on screen
  view: 'normal',    // near | normal | far
  crt: false,
  grain: false,
  camera: 'third',   // third | first
  crouchToggle: true,
  headBob: true,
  fps: false,
  fpsCap: 60,        // 30 | 60 | 120 | 0 (no limit)
};

// Bump when a default changes and existing players should get it once
const SETTINGS_VERSION = 3;

export function loadSettings() {
  migrate();
  const saved = load('settings', {}) || {};
  return { ...DEFAULT_SETTINGS, ...saved, v: SETTINGS_VERSION };
}

// auto | snow | blizzard | clear, picked in the main menu
export const SNOW_MODES = ['auto', 'snow', 'blizzard', 'clear'];

export function loadSnowMode() {
  const m = load('snow', 'auto');
  return SNOW_MODES.includes(m) ? m : 'auto';
}

function migrate() {
  try {
    if (localStorage.getItem(PREFIX + 'migrated') != null) return;
    const old = (k) => JSON.parse(localStorage.getItem(OLD_PREFIX + k) ?? 'null');
    const walk = old('walk_panelka');
    if (walk) save('walk', walk);
    const seed = walk?.seed ?? old('seed');
    if (seed) save('seed', seed);
    const settings = old('settings');
    if (settings) { delete settings.weather; save('settings', settings); }
    const snow = old('weather')?.panelka;
    if (SNOW_MODES.includes(snow)) save('snow', snow);
    save('migrated', true);
  } catch {
    /* storage unavailable or broken old data: start fresh */
  }
}
