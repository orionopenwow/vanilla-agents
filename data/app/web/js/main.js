// Boot: load settings, apply the theme, build every panel, then follow the server's snapshot + event stream.
import { loadConfig, makeText } from './cfg.js';
import { applyTheme } from './theme.js';
import { createPanel } from './panel.js';
import { initTooltips } from './tooltip.js';
import { initHotkeys } from './hotkeys.js';
import { connect } from './net.js';
import { toastForEvents } from './toast.js';
import { initSound } from './sound.js';
import { build as soundMenu } from './panels/soundmenu.js';
import { build as gameSettings } from './panels/gamesettings.js';
import { initWorkshop } from './workshop.js';
import { build as unitFrames } from './panels/unitframes.js';
import { build as questLog } from './panels/questlog.js';
import { build as charSheet } from './panels/charsheet.js';
import { build as chat } from './panels/chat.js';
import { build as actionBar } from './panels/actionbar.js';
import { build as castBar } from './panels/castbar.js';
import { build as escMenu } from './panels/escmenu.js';
import { build as spellbook } from './panels/spellbook.js';
import { build as backpack } from './panels/backpack.js';
import { build as worldMap } from './panels/worldmap.js';
import { build as raidFrames } from './panels/raidframes.js';
import { build as ideaPanel } from './panels/idea.js';
import { build as monitor } from './panels/monitor.js';
import { build as gossip } from './panels/gossip.js';
import { build as inspect } from './panels/inspect.js';
import { build as replay } from './panels/replay.js';
import { build as talents } from './panels/talents.js';
import { build as flightMap } from './panels/flightmap.js';
import { build as auction } from './panels/auction.js';
import { build as mailbox } from './panels/mailbox.js';
import { build as achievements } from './panels/achievements.js';
import { build as meters } from './panels/meters.js';
import { build as party } from './panels/party.js';
import { build as help, reportErrors } from './panels/help.js';
import { build as zones } from './panels/zones.js';
import { build as guide } from './panels/guide.js';
import { build as contest } from './panels/contest.js';
import { build as addonsPanel } from './panels/addons.js';
import { loadRoster, noteActivity, nameFor } from './workers.js';
import { loading } from './loading.js';

const BUILDERS = { unit_frames: unitFrames, quest_log: questLog, character_sheet: charSheet, chat, action_bar: actionBar, cast_bar: castBar, esc_menu: escMenu, sound_menu: soundMenu, game_settings: gameSettings, spellbook, backpack, world_map: worldMap, raid_frames: raidFrames, idea: ideaPanel, monitor, gossip, inspect, replay, talents, flight_map: flightMap, auction, mailbox, achievements, meters, party, help, zones, guide , contest, addons: addonsPanel };

async function boot() {
  loading.step('Reading the settings', 0.03);
  const cfg = await loadConfig();
  await applyTheme(cfg.theme);
  loading.tips();
  loading.step('Drawing the interface', 0.08);
  const ctx = { cfg, t: makeText(cfg), ui: document.getElementById('ui'), panels: {}, selected: null, last: null };
  ctx.tip = initTooltips(cfg);
  ctx.sound = await initSound(cfg);
  const updaters = [];
  loading.texts({ slow: ctx.t('load.slow') });
  const names = Object.keys(BUILDERS);
  for (const [name, builder] of Object.entries(BUILDERS)) {
    const k = names.indexOf(name);
    if (k % 5 === 4) { loading.step('', 0.08 + 0.04 * k / names.length, 0.12); await new Promise((r) => requestAnimationFrame(r)); }   // let the bar move while the windows are built
    ctx.panels[name] = createPanel(ctx, name);
    const r = builder(ctx, ctx.panels[name]);
    ctx.panels[name].api = r;
    updaters.push(typeof r === 'function' ? r : r.update);
  }
  // 2d or 3d workshop: workshop.json "renderer", or ?renderer=2d|3d in the address for a side-by-side comparison
  let mode = new URLSearchParams(location.search).get('renderer') || cfg.workshop.renderer || '2d';
  const gl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })();
  if (mode !== '2d' && !gl) { mode = '2d'; setTimeout(() => import('./toast.js').then((t) => t.showToast(ctx.t('ws.no_webgl'), 'grey')), 1500); }   // no 3D on this PC: the drawn workshop instead of a black screen
  document.getElementById('workshop').addEventListener('webglcontextlost', (e) => { e.preventDefault(); import('./toast.js').then((t) => t.showToast(ctx.t('ws.gl_lost'), 'red')); setTimeout(() => location.reload(), 3000); });
  ctx.loading = loading; ctx.renderMode = mode;      // the workshop actually shown (the Zones window's picture tour needs the inn)
  const workshop = mode === 'inn' ? (await import('/workshop3d/inn.js')).initInn(ctx) : mode === '3d' ? (await import('/workshop3d/index.js')).initWorkshop3D(ctx) : initWorkshop(ctx);
  loadRoster();
  const render = (s) => { ctx.last = s; noteActivity(s.agents); updaters.forEach((u) => u(s)); workshop.update(s); attention(ctx, s); };
  ctx.onState = (fn) => updaters.push(fn);       // addons (and anything added later) hear every state snapshot
  ctx.render = render;
  ctx.select = (id) => { ctx.selected = id; if (ctx.last) render(ctx.last); };
  ctx.escape = () => {
    for (let i = ctx.opened.length - 1; i >= 0; i--) {         // the last pop-up window you opened closes first
      const p = ctx.panels[ctx.opened[i]];
      if (p && p.isOpen() && !p.cfg.visible && ctx.opened[i] !== 'esc_menu') { p.toggle(); return; }
    }
    for (const [n, p] of Object.entries(ctx.panels)) {             // a pop-up opened some other way (talk window, inspect from it, ...)
      if (n !== 'esc_menu' && p.isOpen() && !p.cfg.visible && n !== 'game_settings' && n !== 'sound_menu') { if (p.api && p.api.close) p.api.close(); else p.toggle(); return; }
    }
    const m = ctx.panels.esc_menu;
    if (ctx.panels.game_settings.isOpen()) { ctx.panels.game_settings.toggle(); return; }
    if (ctx.panels.sound_menu.isOpen()) { ctx.panels.sound_menu.toggle(); return; }
    if (m.isOpen()) m.api.reset();
    m.toggle();
  };
  initHotkeys(ctx);
  ctx.net = connect({
    onState: (s) => { ctx.live = s; if (ctx.replaying) return;      // replay (R) shows the past: the live snapshot waits in ctx.live
      const first = !ctx.last; render(s); if (first) ctx.sound.onUpdate(s, []); },
    onEvents: (evs) => { if (ctx.replaying) return; toastForEvents(ctx, evs); ctx.sound.onUpdate(ctx.last, evs); },
    onOnline: (v) => { ctx.panels.chat.api.setOnline(v); if (ctx.monitorOnline) ctx.monitorOnline(v); },
  });
  await ctx.net.start();
  reportErrors(ctx);
  if ((cfg.rebake || []).length) setTimeout(() => import('./toast.js').then((t) => t.showToast(ctx.t('ws.rebake', { text: cfg.rebake.join(' ') }), 'red', 9000)), 2500);   // V-029: short banner; Help (F1) shows the command
  loadAddons(ctx);
  loading.onDone(() => welcome(ctx));
  if (mode !== 'inn') loading.done();      // the inn closes the loading screen itself once everything is built
}

// V-053: the first time the window opens, a short card says what this is and the three things to know; never again after "Let's go"
function welcome(ctx) {
  try { if (localStorage.getItem('va.welcomed')) return; } catch (e) { return; }      // storage off: no card rather than one every start
  const card = document.createElement('div'); card.className = 'welcome'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', ctx.t('welcome.title'));
  const h = document.createElement('h2'); h.textContent = ctx.t('welcome.title');
  const ul = document.createElement('ul');
  for (const k of ['welcome.helpers', 'welcome.move', 'welcome.quests', 'welcome.party']) { const li = document.createElement('li'); li.textContent = ctx.t(k); ul.append(li); }
  const row = document.createElement('div'); row.className = 'welcome-row';
  const close = () => { try { localStorage.setItem('va.welcomed', '1'); } catch (e) { /* storage off */ } card.remove(); };
  const guide = document.createElement('button'); guide.type = 'button'; guide.className = 'btn btn-grey'; guide.textContent = ctx.t('welcome.guide');
  guide.addEventListener('click', () => { close(); const g = ctx.panels.guide; if (g && !g.isOpen()) g.toggle(); });
  const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn btn-green'; ok.textContent = ctx.t('welcome.ok');
  ok.addEventListener('click', close);
  row.append(guide, ok); card.append(h, ul, row); document.body.append(card); ok.focus();
}

// V-026: helpers that need you show in the window title (taskbar) and, when the window is in the background, as a desktop notification
const told = new Set();
function attention(ctx, s) {
  const needs = (s.agents || []).filter((a) => a.needs);
  document.title = (needs.length ? '(' + needs.length + ') ' : '') + ctx.t('notify.title');
  for (const a of needs) {
    const key = a.id + ':' + (a.seen || '');
    if (told.has(key)) continue;
    told.add(key);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { const n = new Notification(ctx.t('notify.needs', { name: nameFor(a.id) }), { body: a.needs_note || '', tag: 'va-' + a.id, silent: false }); n.onclick = () => { window.focus(); ctx.select(a.id); n.close(); }; } catch (e) { /* not allowed here */ }
    }
  }
  for (const k of [...told]) if (!needs.some((a) => k.startsWith(a.id + ':'))) told.delete(k);
}
// ask once, on the first click (browsers only allow asking after a click)
document.addEventListener('click', () => { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); }, { once: true });

// Addons (docs/ADDONS.md, V-051): folders <assets>/addons/<id>/ (addon.json + main.js + optional main.css) and old single <name>.js files.
// onState(fn) also calls fn once at once with the current snapshot. Only the ones switched on in the AddOns window load (/api/addons "load"). Each exports default function (api) { ... };
// api = { ctx, onState, panel, toast, addon: {id, name, version, base}, asset(rel) }.
// They run with the window's full rights, like WoW addons: only enable addons you wrote or trust.
async function loadAddons(ctx) {
  const list = await fetch('/api/addons').then((r) => (r.ok ? r.json() : { load: [] })).catch(() => ({ load: [] }));
  for (const a of list.load || []) {
    try {
      if (a.style) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = a.style; l.dataset.addon = a.key; document.head.append(l); }
      const base = a.legacy ? '/addons/' : '/addons/' + a.id + '/';
      const m = await import(a.script);
      if (typeof m.default === 'function') await m.default({ ctx, onState: (fn) => { ctx.onState(fn); if (ctx.last) fn(ctx.last); }, toast: (text, color = 'gold') => import('./toast.js').then((t) => t.showToast(text, color)),
        addon: { id: a.id, name: a.name, version: a.version, base }, asset: (rel) => base + String(rel).replace(/^\/+/, ''),
        panel: (title) => { const box = document.createElement('div'); box.className = 'addon-panel wow-frame'; box.dataset.addon = a.key; box.innerHTML = '<div class="addon-title gold shadow"></div><div class="addon-body"></div>'; box.firstChild.textContent = title; document.getElementById('ui').append(box); return box.lastChild; } });
      console.info('addon loaded:', a.key);
    } catch (e) { console.error('addon ' + a.key + ' failed:', e); }
  }
}

boot().catch((e) => { loading.fail('The window could not start: ' + e.message); });
