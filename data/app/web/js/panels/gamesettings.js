// Options window built from the game's own options frames (assets/ui/wow_settings.json, baked by vanilla_agents/assets/settings.py from FrameXML Lua):
// categories in three groups on the left, the real labels / tooltips / choices on the right, a search box, Defaults and Close.
// Values are saved in this browser (localStorage); a few are wired to Vanilla Agents itself (sound volume / mute).
import { clear, el } from '../dom.js';
import * as ws from '../wsettings.js';
import { phonePage, notifyPage, browserPage } from '../vasettings.js';
import { integrationsPage } from '../integrations.js';
import { chatRepliesPage } from '../chatreplies.js';

const KEY = 'vanilla.wowsettings';
const GROUP_ORDER = ['Gameplay', 'Accessibility', 'System'];

export function build(ctx, panel) {
  const view = el('div', 'ws');
  panel.body.append(view);
  let data = null, saved = {}, current = null, query = '', houses = [];
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* storage off: values last until the page closes */ } };
  const ui = (k) => (data && data.ui[k]) || k;

  const first = (list) => (Array.isArray(list) && list.length ? list[0].value : '');
  const defaultOf = (it) => {
    if (it.default !== undefined && it.default !== null) return it.default;
    if (it.kind === 'checkbox') return false;
    if (it.kind === 'slider') return Number(it.min) || 0;
    if (it.kind === 'dropdown') return first(it.options);
    return null;
  };
  const get = (it, def) => (it.var && it.var.startsWith('VA_') && !Object.prototype.hasOwnProperty.call(saved, it.var) ? (it.var === 'VA_ReducedMotion' ? ws.reducedMotion() : ws.DEFAULTS[it.var]) : (it.var && Object.prototype.hasOwnProperty.call(saved, it.var) ? saved[it.var] : def));
  const set = (it, v) => {
    if (!it.var) return;
    saved[it.var] = v; persist();
    if (it.var.startsWith('VA_')) ws.changed(it.var, v);
    if (it.var === 'Sound_MasterVolume' || it.var === 'MasterVolume') ctx.sound.save({ master: { volume: v } }).catch(() => {});
    if (it.var === 'Sound_EnableAllSound' || it.var === 'MasterSoundEffects') ctx.sound.save({ master: { mute: !v } }).catch(() => {});
  };
  // V-037: every option explains itself. Our own (VA_*, sid) use strings/tooltips.json#setting_<id>; a game option without its own text
  // says it is kept for the look; the game's sound options that are wired to the window say so in the green line.
  const TIPS = ctx.cfg.strings.tooltips, WIRED = new Set(['MasterVolume', 'MasterSoundEffects', 'Sound_MasterVolume', 'Sound_EnableAllSound']);
  const ownTip = (id) => (id && TIPS['setting_' + id] ? 'setting_' + id : null);
  const tip = (node, title, body, v) => {
    if (ownTip(v)) { node.dataset.tip = ownTip(v); return node; }
    node.tipData = { title, body: body || TIPS.setting_game.body, use: WIRED.has(v) ? TIPS.setting_game_sound.body : undefined };
    node.dataset.liveTip = '1'; return node;
  };

  function checkbox(it, label, onChange) {
    const row = el('label', 'ws-row ws-check');
    const box = el('input', 'ws-box', null, { type: 'checkbox' });
    box.checked = !!get(it, defaultOf(it));
    box.addEventListener('change', () => { set(it, box.checked); if (onChange) onChange(box.checked); });
    row.append(box, el('span', 'ws-label', label || it.label));
    return tip(row, label || it.label, it.tip, it.var);
  }
  function slider(it, s, label) {
    const row = el('div', 'ws-row');
    const min = Number(s.min), max = Number(s.max), step = Number(s.step) || (max - min) / 100 || 1;
    const r = el('input', 'ws-range', null, { type: 'range', min: String(min), max: String(max), step: String(step) });
    const out = el('span', 'ws-value');
    const show = (v) => { out.textContent = Number.isInteger(step) || step >= 1 ? String(Math.round(v)) : (max <= 1 ? Math.round(v * 100) + '%' : Number(v).toFixed(2)); };
    r.value = get(s, defaultOf(s));
    show(Number(r.value));
    r.addEventListener('input', () => { show(Number(r.value)); set(s, Number(r.value)); });
    row.append(el('span', 'ws-label', label || s.label || it.label), r, out);
    return tip(row, label || s.label || it.label, s.tip || it.tip, s.var);
  }
  function dropdown(it, d, label) {
    const row = el('div', 'ws-row');
    const sel = el('select', 'ws-select');
    const opts = Array.isArray(d.options) ? d.options : [];
    opts.forEach((o, i) => sel.append(el('option', null, o.label || String(o.value), { value: String(i) })));
    const cur = get(d, defaultOf(d)), idx = Math.max(0, opts.findIndex((o) => o.value === cur));
    sel.value = String(idx);
    sel.addEventListener('change', () => set(d, opts[Number(sel.value)].value));
    row.append(el('span', 'ws-label', label || d.label || it.label), sel);
    return tip(row, label || d.label || it.label, d.tip || it.tip, d.var);
  }
  function button(it) {
    const b = el('button', 'wow-btn ws-btn', it.label || it.button, { type: 'button' });
    b.disabled = true;
    return tip(b, it.label || it.button, it.tip);
  }

  // our own options get a visible line under them: what it does (the tooltip adds when to change it)
  function control(it) {
    const n = control0(it), id = it.sid || it.var;
    if (!n || !ownTip(id)) return n;
    const box = el('div', 'ws-opt');
    box.dataset.sid = id;
    box.append(n, el('div', 'ws-desc', TIPS[ownTip(id)].body));
    return box;
  }
  function control0(it) {
    switch (it.kind) {
      case 'header': return el('div', 'ws-header gold shadow', it.label);
      case 'checkbox': return it.label ? checkbox(it) : null;
      case 'slider': return it.label ? slider(it, it) : null;
      case 'dropdown': return it.label ? dropdown(it, it) : null;
      case 'checkbox_slider': { const w = el('div', 'ws-pair'); w.append(checkbox(it), slider(it, it.slider, it.slider.label)); return w; }
      case 'checkbox_dropdown': { const w = el('div', 'ws-pair'); w.append(checkbox(it), dropdown(it, it.dropdown, it.dropdown.label)); return w; }
      case 'checkbox_button': { const w = el('div', 'ws-pair'); w.append(checkbox(it), button({ label: it.button, tip: it.tip })); return w; }
      case 'button': return button(it);
      case 'node': return it.make();       // V-040/V-041: a whole page of Vanilla Agents' own settings (vasettings.js)
      case 'fcbutton': { const b = el('button', 'wow-btn ws-btn', it.label, { type: 'button' }); b.addEventListener('click', it.run); if (ownTip(it.sid)) b.dataset.tip = ownTip(it.sid); return b; }
      default: return null;
    }
  }

  // Vanilla Agents' own choices, kept next to the game's Gameplay pages
  const own = () => {
    const via = (fn) => () => { panel.toggle(); const m = ctx.panels.esc_menu; if (!m.isOpen()) m.toggle(); fn(m.api); };
    return { own: true, name: ctx.t(ctx.cfg.panels.esc_menu.text.settings), group: 'Gameplay', items: [
      { kind: 'fcbutton', sid: 'character', label: ctx.t(ctx.cfg.panels.esc_menu.text.character), run: via((a) => a.characters()) },
      { kind: 'fcbutton', sid: 'sound', label: ctx.t(ctx.cfg.panels.esc_menu.text.sound), run: () => { panel.toggle(); ctx.panels.sound_menu.api.show(); ctx.panels.sound_menu.toggle(); } },
      { kind: 'fcbutton', sid: 'addons', label: ctx.t(ctx.cfg.panels.esc_menu.text.addons), run: () => { panel.toggle(); if (!ctx.panels.addons.isOpen()) ctx.panels.addons.toggle(); } },      // V-051
      ...workshopItems(),
    ] };
  };
  // the workshop: which building (and furniture set), time of day, graphics, how many helpers walk around, motion
  const T = (k) => ctx.t('ws.' + k);
  const workshopItems = () => [
    { kind: 'header', label: T('workshop') },
    { kind: 'dropdown', var: 'VA_Building', label: T('building'), tip: T('building_tip'), default: ws.DEFAULTS.VA_Building,
      options: (houses.length ? houses : [{ key: ws.DEFAULTS.VA_Building, label: 'Goldshire Inn' }]).map((b) => ({ value: b.key, label: b.label })) },
    { kind: 'fcbutton', label: T('zones_open'), run: () => { panel.toggle(); ctx.panels.zones.toggle(); } },
    { kind: 'dropdown', var: 'VA_TimeOfDay', label: T('time'), tip: T('time_tip'), default: 'auto', options: ['auto', 'day', 'dusk', 'night'].map((v) => ({ value: v, label: T('time_' + v) })) },
    { kind: 'checkbox', var: 'VA_Music', label: T('music'), tip: T('music_tip'), default: true },
    { kind: 'header', label: T('graphics') },
    { kind: 'dropdown', var: 'VA_Quality', label: T('quality'), tip: T('quality_tip'), default: 2, options: [0, 1, 2, 3].map((v) => ({ value: v, label: T('quality_' + v) })) },
    { kind: 'dropdown', var: 'VA_FpsCap', label: T('fps'), tip: T('fps_tip'), default: 60, options: [30, 60, 0].map((v) => ({ value: v, label: v ? String(v) : T('fps_none') })) },
    { kind: 'slider', var: 'VA_MaxHelpers', label: T('helpers'), tip: T('helpers_tip'), min: 1, max: 15, step: 1, default: 15 },
    { kind: 'checkbox', var: 'VA_ReducedMotion', label: T('motion'), tip: T('motion_tip'), default: ws.reducedMotion() },
  ];
  // Graphics > "Graphics Quality": the CVars the game's graphics page lists (mainline/graphicsoverrides.lua); choices are the game's quality names
  const quality = () => {
    const names = ['VIDEO_OPTIONS_LOW', 'VIDEO_OPTIONS_FAIR', 'VIDEO_OPTIONS_GOOD', 'VIDEO_OPTIONS_HIGH', 'VIDEO_OPTIONS_ULTRA', 'VIDEO_OPTIONS_ULTRA_HIGH'];
    const options = names.map((n, i) => ({ value: i, label: ui(n) !== n && ui(n) ? ui(n) : ['Low', 'Fair', 'Good', 'High', 'Ultra', 'Ultra High'][i] }));
    return [{ kind: 'header', label: ui('GRAPHICS_QUALITY') }, ...data.quality.map((q, i) => (i === 0
      ? { kind: 'slider', var: q.cvar, label: q.label, min: 1, max: 10, step: 1, default: 5, tip: '' }
      : { kind: 'dropdown', var: q.cvar, label: q.label, options, default: 3, tip: '' }))];
  };
  const withQuality = (c) => {
    if (c.name !== ui('GRAPHICS_LABEL') && c.key !== 'Graphics' && c.name !== 'Graphics') return c;
    const at = c.items.findIndex((i) => i.kind === 'header');
    const items = at < 0 ? [...c.items, ...quality()] : [...c.items.slice(0, at), ...quality(), ...c.items.slice(at)];
    return { ...c, items };
  };
  // V-040 / V-041 / V-044 / V-050: Phone access, Notifications, Chat replies and Integrations, saved by the server in your settings file
  const vaPages = () => [
    { own: true, name: ctx.t('notifyhub.title'), group: 'Gameplay', items: [{ kind: 'node', label: ctx.t('notifyhub.title'), tip: ctx.t('notifyhub.desc'), make: () => notifyPage(ctx) }] },
    { own: true, name: ctx.t('chatreply.title'), group: 'Gameplay', items: [{ kind: 'node', label: ctx.t('chatreply.title'), tip: ctx.t('chatreply.desc'), make: () => chatRepliesPage(ctx) }] },
    { own: true, name: ctx.t('integ.title'), group: 'Gameplay', items: [{ kind: 'node', label: ctx.t('integ.title'), tip: ctx.t('integ.desc'), make: () => integrationsPage(ctx) }] },
    { own: true, name: ctx.t('phonelink.title'), group: 'Gameplay', items: [{ kind: 'node', label: ctx.t('phonelink.title'), tip: ctx.t('phonelink.desc'), make: () => phonePage(ctx) }] },
    { own: true, name: ctx.t('browserlink.title'), group: 'Gameplay', items: [{ kind: 'node', label: ctx.t('browserlink.title'), tip: ctx.t('browserlink.desc'), make: () => browserPage(ctx) }] },     // V-054
  ];
  const cats = () => [...data.categories.filter((c) => c.items.some((i) => i.label || i.kind === 'button')).map(withQuality), own(), ...vaPages()];
  function render() {
    clear(view);
    if (!data) { view.append(el('div', 'small grey', '...')); return; }
    const left = el('div', 'ws-nav'), right = el('div', 'ws-main');
    const search = el('input', 'ws-search', null, { type: 'text', placeholder: ui('SEARCH'), spellcheck: 'false' });
    search.value = query;
    search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); renderList(); });
    left.append(search);
    for (const g of GROUP_ORDER) {
      const list = cats().filter((c) => c.group === g);
      if (!list.length) continue;
      left.append(el('div', 'ws-group gold shadow', ui('SETTING_GROUP_' + g.toUpperCase())));
      for (const c of list) {
        const b = el('button', 'ws-cat' + (current && current.name === c.name ? ' on' : ''), c.name, { type: 'button' });   // categories are rebuilt on each draw: match by name
        b.addEventListener('click', () => { current = c; query = ''; render(); });
        left.append(b);
      }
    }
    const list = el('div', 'ws-list');
    const help = el('button', 'wow-btn ws-help', ctx.t(panel.cfg.text.guide), { type: 'button', 'aria-label': TIPS[panel.cfg.tips.guide].title });   // V-037: the guide's Settings chapter
    help.dataset.tip = panel.cfg.tips.guide;
    help.addEventListener('click', () => ctx.panels.guide.api.open('settings'));
    right.append(el('div', 'ws-title gold shadow', current ? current.name : ''), help, list);
    const foot = el('div', 'ws-foot');
    const defaults = el('button', 'wow-btn', ui('SETTINGS_DEFAULTS'), { type: 'button' });
    defaults.addEventListener('click', () => { if (!current) return; for (const it of current.items) { for (const x of [it, it.slider, it.dropdown]) if (x && x.var) delete saved[x.var]; } persist(); render(); });
    const close = el('button', 'wow-btn', ui('SETTINGS_CLOSE'), { type: 'button' });
    close.addEventListener('click', () => panel.toggle());
    foot.append(defaults, close);
    right.append(foot);
    view.append(left, right);
    renderList();
  }
  function renderList() {
    const list = view.querySelector('.ws-list');
    if (!list) return;
    clear(list);
    const title = view.querySelector('.ws-title');
    if (query) {
      title.textContent = ui('SETTINGS_SEARCH_RESULTS');
      let n = 0;
      for (const c of cats()) {
        const hits = c.items.filter((i) => i.kind !== 'header' && [i.label, i.tip, i.slider && i.slider.label, i.dropdown && i.dropdown.label].some((s) => s && s.toLowerCase().includes(query)));
        if (!hits.length) continue;
        list.append(el('div', 'ws-header gold shadow', c.name));
        for (const it of hits) { const n2 = control(it); if (n2) { list.append(n2); n++; } }
      }
      if (!n) list.append(el('div', 'small grey', ui('SETTINGS_SEARCH_NOTHING_FOUND')));
      return;
    }
    title.textContent = current ? current.name : '';
    if (current && !current.own) list.append(el('div', 'ws-note', ctx.t(panel.cfg.text.game_note)));
    if (current) for (const it of current.items) { const n = control(it); if (n) list.append(n); }
  }

  let jump = null;      // show(id): open our own page at that option and mark it (the guide's "Show in Options")
  function focus() {
    if (!jump || !data) return;
    const id = jump; jump = null;
    current = cats().find((c) => c.own) || current; query = ''; render();
    const row = view.querySelector('.ws-opt[data-sid="' + id + '"]');
    if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('ws-flash'); setTimeout(() => row.classList.remove('ws-flash'), 2200); }
  }
  async function load() {
    if (data) return focus();
    houses = await ws.buildings();
    try { data = await fetch('/assets/ui/wow_settings.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }); } catch (e) { view.textContent = e.message; return; }
    current = cats()[0] || null;
    render();
    focus();
  }
  // open the window on one page (Help > Phone uses it): name = the page's title
  async function page(name) {
    if (!panel.isOpen()) panel.toggle();
    await load();
    const c = data && cats().find((x) => x.name === name);
    if (c) { current = c; query = ''; render(); }
  }
  return { update() {}, show(id) { jump = id || null; load(); }, page };
}
