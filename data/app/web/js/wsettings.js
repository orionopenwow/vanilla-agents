// Workshop settings (building, time of day, graphics, helpers, motion): kept in this browser with the game's options (same localStorage
// key as the Options window, vars prefixed VA_) so the Options window shows and edits them. Anything else reads them through get() and
// hears changes through on(). Changing the building reloads the page (a different building needs a fresh nav grid and loading screen).

const KEY = 'vanilla.wowsettings';
export const DEFAULTS = {
  VA_Building: 'goldshire_c',   // a key from /assets/models/buildings/index.json (or custom:<file> for your own GLB)
  VA_TimeOfDay: 'auto',         // auto (your clock) | day | dusk | night
  VA_Quality: 2,                // 0 low (pixel ratio 0.75, no antialias) | 1 fair (1) | 2 good (up to 1.5) | 3 high (device ratio)
  VA_FpsCap: 60,                // 30 | 60 | 0 (no cap)
  VA_MaxHelpers: 15,            // people drawn in the workshop (the rest still show in the raid frames)
  VA_ReducedMotion: false,      // no emotes, no camera sway, no sparks
  VA_Music: true,               // the building's own music on the jukebox (off: every baked track)
  VA_Bubbles: true,             // V-056: speech bubbles over working helpers (their quest, and "..." while they work)
};

const listeners = new Set();
function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
export function get(name) { const s = read(); return Object.prototype.hasOwnProperty.call(s, name) ? s[name] : DEFAULTS[name]; }
export function all() { const out = {}; for (const k of Object.keys(DEFAULTS)) out[k] = get(k); return out; }
export function set(name, value) {
  const s = read(); s[name] = value;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage off: the change lasts until reload */ }
  changed(name, value);
}
// the Options window saves through its own store; it calls changed() so the workshop hears it
export function changed(name, value) { for (const fn of listeners) { try { fn(name, value); } catch (e) { console.error('settings listener', e); } } }
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let index = null;
export async function buildings() {
  if (!index) index = fetch('/assets/models/buildings/index.json').then((r) => (r.ok ? r.json() : [])).catch(() => [])
    .then(async (list) => {
      const custom = await fetch('/api/office').then((r) => (r.ok ? r.json() : { buildings: [] })).catch(() => ({ buildings: [] }));
      return [...list, ...(custom.buildings || [])];
    });
  return index;
}
// V-042: zones, buildings by zone and inn pictures (GET /api/places); empty lists when the server cannot say
let placesP = null;
export function places(force) {
  if (!placesP || force) placesP = fetch('/api/places').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => d || { zones: [], buildings: [], loading: {} });
  return placesP;
}
// your saved choice wins; until you pick one, the system's "reduce motion" setting decides
export const reducedMotion = () => (Object.prototype.hasOwnProperty.call(read(), 'VA_ReducedMotion') ? !!read().VA_ReducedMotion : !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches));
