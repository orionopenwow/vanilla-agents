// Esc menu: Connect Claude (V-055), Options, Zones, Guide (V-037), AddOns (V-051), Log Out = Choose Project (project picker), Exit Game, Return to Game. Starts hidden.
import { clear, el } from '../dom.js';
import { openClaudeLink } from '../claudelink.js';

export function build(ctx, panel) {
  const c = panel.cfg;
  const t = (k, v) => ctx.t(c.text[k], v);
  const view = el('div', 'esc');
  panel.body.append(view);

  const button = (label, fn) => {
    const b = el('button', 'wow-btn', label, { type: 'button' });
    b.addEventListener('click', fn);
    return b;
  };

  const gap = () => el('div', 'esc-gap');
  const off = (label) => { const b = button(label, () => {}); b.disabled = true; b.dataset.tip = 'esc_unavailable'; return b; };
  const guide = () => { const b = button(t('guide'), () => { panel.toggle(); ctx.panels.guide.api.open(); }); b.dataset.tip = c.tips.guide; return b; };   // V-037
  function menu() {   // the game's Game Menu: Options / Support, Macros / Log Out, Exit Game / Return to Game
    clear(view);
    const claude = button(t('claude'), () => { panel.toggle(); openClaudeLink(ctx); }); claude.classList.add('esc-claude');      // V-055
    view.append(claude, gap(), button(t('options'), () => { panel.toggle(); ctx.panels.game_settings.api.show(); ctx.panels.game_settings.toggle(); }),
      button(t('zones'), () => { panel.toggle(); ctx.panels.zones.toggle(); }), guide(), button(t('addons'), () => { panel.toggle(); if (!ctx.panels.addons.isOpen()) ctx.panels.addons.toggle(); }), gap(),
      off(t('support')), off(t('macros')), gap(),
      button(t('logout'), picker), button(t('quit'), () => { window.close(); note.hidden = false; }), gap(),
      button(t('resume'), () => panel.toggle()));
    const note = el('div', 'small grey esc-note', t('quit_hint'));
    note.hidden = true;
    view.append(note);
  }

  async function characters() {   // inn renderer: pick which baked worker you play as (window.innPickHero is set by workshop3d/inn.js)
    clear(view);
    view.append(el('div', 'gold shadow', t('character_title')));
    let list = [];
    try { list = await fetch('/assets/models/workers/manifest.json').then((r) => r.json()); } catch (e) { view.append(el('div', 'small red', e.message)); }
    const box = el('div', 'esc-chars'); box.style.cssText = 'max-height:55vh;overflow:auto;display:flex;flex-direction:column;gap:1px;text-align:left';
    const cur = window.__heroPick !== undefined ? window.__heroPick : (() => { try { return +(localStorage.getItem('innHero') ?? -1); } catch (e) { return -1; } })();
    const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
    const races = [...new Set(list.map((w) => w.race))].sort();
    for (const race of races) {   // grouped by race, then class and level; one short line per character
      box.append(el('div', 'small gold shadow', cap(race)));
      list.map((w, i) => [w, i]).filter(([w]) => w.race === race).sort((x, y) => x[0].class.localeCompare(y[0].class) || (x[0].level || 0) - (y[0].level || 0)).forEach(([w, i]) => {
        const b = button(`${w.name}  -  ${cap(w.class)} ${w.sex === 'f' ? '♀' : '♂'}  Lv ${w.level || '?'}`, () => { if (window.innPickHero) window.innPickHero(i); panel.toggle(); });
        b.style.cssText = 'font-size:12px;padding:1px 8px;min-height:0;height:20px;line-height:18px;white-space:nowrap;text-align:left;' + (i === cur ? 'outline:1px solid #ffd100' : '');
        box.append(b);
      });
    }
    view.append(box, button(t('back'), menu));
  }

  async function open(path, err) {
    try {
      await ctx.net.openProject(path);
      panel.toggle();
    } catch (e) { err.textContent = t('project_error', { error: e.message }); }
  }

  async function add(path, err, btn) {      // D-334: onboard a folder (detect type, trusted folder, registry), then open it
    err.className = 'small red';
    err.textContent = t('project_adding');
    btn.disabled = true;
    try {
      const r = await ctx.net.post('/api/onboard', { path });
      err.className = 'small green';
      err.textContent = t('project_added', { title: r.onboarded.name, checks: r.onboarded.checks.join(', ') || '-' });
      setTimeout(() => panel.isOpen() && panel.toggle(), 1800);
    } catch (e) { err.textContent = t('project_add_error', { error: e.message }); }
    btn.disabled = false;
  }

  async function picker() {
    clear(view);
    view.append(el('div', 'gold shadow', t('project_title')));
    const err = el('div', 'small red');
    let list = [];
    try { list = (await ctx.net.projects()).projects; } catch (e) { err.textContent = e.message; }
    if (!list.length) view.append(el('div', 'small grey', t('project_empty')));
    list.forEach((p) => view.append(button(p.name, () => open(p.path, err))));
    const input = el('input', 'esc-input', null, { type: 'text', spellcheck: 'false' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(input.value.trim(), err); });
    const addBtn = button(t('project_add'), () => add(input.value.trim(), err, addBtn));
    addBtn.dataset.tip = c.tips.project_add;
    view.append(el('div', 'small grey', t('project_path')), input, button(t('project_open'), () => open(input.value.trim(), err)), addBtn, err, button(t('back'), menu));
  }

  menu();
  return { update() {}, reset: menu, characters, picker };
}
