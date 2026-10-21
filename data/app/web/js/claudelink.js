// V-055 Connect Claude: one card that says which Claudes reach the inn and connects the missing ones with one click.
// Opened from Esc > Connect Claude, the welcome card and the empty-inn hint; also once by itself at start when no Claude is connected.
// Server side: vanilla_agents/app/claude_link.py (GET/POST /api/claude). Words: strings/ui.json claudelink.*.
import { clear, el } from './dom.js';

let open = null;          // the card while it is shown

const ago = (ctx, t) => {
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 90) return ctx.t('claudelink.now');
  if (s < 5400) return ctx.t('claudelink.min', { n: Math.round(s / 60) });
  if (s < 172800) return ctx.t('claudelink.hours', { n: Math.round(s / 3600) });
  return ctx.t('claudelink.days', { n: Math.round(s / 86400) });
};

// true when nothing at all connects a Claude here (used to open the card once by itself)
export async function nothingConnected(ctx) {
  try {
    const s = await ctx.net.get('/api/claude');
    return s.code.hooks === 'off' && s.desktop.tools === 'off' && !s.web.connectors;
  } catch (e) { return false; }
}

export function openClaudeLink(ctx) {
  if (open) { open.focus(); return; }
  const T = (k, v) => ctx.t('claudelink.' + k, v);
  const card = el('div', 'welcome claudelink', null, { role: 'dialog', 'aria-label': T('title'), tabindex: '-1' });
  const body = el('div');
  let st = null, msg = '', bad = false, busy = '';
  open = card;
  const close = () => { card.remove(); open = null; document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  async function load() {
    try { st = await ctx.net.get('/api/claude'); } catch (e) { msg = T('error', { error: e.message }); bad = true; }
    render();
  }
  async function act(body, way) {
    busy = way; msg = ''; bad = false; render();
    try {
      const r = await ctx.net.post('/api/claude', body);
      st = r.status || st;
      if (r.ok === false) { msg = r.error + (r.command ? '  ' + T('copy_cmd', { text: r.command }) : ''); bad = true; }
      else if (body.start) msg = T('started', { project: (ctx.last && ctx.last.project && ctx.last.project.name) || '' });
      else msg = (r.note ? r.note : T('done'));
    } catch (e) { msg = T('error', { error: e.message }); bad = true; }
    busy = ''; render();
  }
  const btn = (label, cls, fn, way) => {
    const b = el('button', 'btn ' + cls, busy && busy === way ? T('working') : label, { type: 'button' });
    if (busy) b.disabled = true;
    b.addEventListener('click', fn);
    return b;
  };
  const link = (label, href) => el('a', 'btn btn-grey claudelink-a', label, { href, target: '_blank', rel: 'noopener noreferrer' });

  function row(title, what, line, ok, buttons) {
    const r = el('div', 'claudelink-row');
    const dot = el('span', 'claudelink-dot ' + (ok === true ? 'on' : ok === 'warn' ? 'warn' : 'off'));
    const text = el('div', 'claudelink-text');
    text.append(el('div', 'gold', title), el('div', 'small grey', what), el('div', 'small ' + (ok === true ? 'green' : ok === 'warn' ? 'red' : 'grey'), line));
    const b = el('div', 'claudelink-btns');
    b.append(...buttons);
    r.append(dot, text, b);
    return r;
  }

  function render() {
    clear(body);
    body.append(el('h2', null, T('title')), el('div', 'vas-p', T('intro')));
    if (!st) { body.append(el('div', 'small grey', '...')); }
    else {
      // Claude Code
      const c = st.code;
      let line, ok, b = [];
      if (!c.installed && c.hooks === 'off') { line = T('code_missing'); ok = false; b = [link(T('get'), 'https://claude.com/claude-code')]; }
      else if (c.hooks === 'off') { line = T('off'); ok = false; b = [btn(T('connect'), 'btn-green', () => act({ connect: 'code' }, 'code'), 'code')]; }
      else if (c.hooks === 'elsewhere' || c.tools === 'elsewhere') { line = T('elsewhere'); ok = 'warn'; b = [btn(T('reconnect'), 'btn-green', () => act({ connect: 'code' }, 'code'), 'code')]; }
      else if (c.installed && c.tools === 'off') { line = T('partial'); ok = 'warn'; b = [btn(T('reconnect'), 'btn-green', () => act({ connect: 'code' }, 'code'), 'code')]; }
      else { line = c.sessions ? T('on_seen', { count: c.sessions, when: ago(ctx, c.last_seen) }) : T('on_none'); ok = true; }
      if (c.hooks !== 'off' && c.installed) b.push(btn(T('start'), 'btn-blue', () => act({ start: true }, 'start'), 'start'));
      if (c.hooks !== 'off') b.push(btn(T('disconnect'), 'btn-metal claudelink-small', () => act({ disconnect: 'code' }, 'code-off'), 'code-off'));
      body.append(row(T('code'), T('code_what'), line, ok, b));
      // the desktop app
      const d = st.desktop;
      if (d.tools === 'off' && !d.installed) body.append(row(T('desktop'), T('desktop_what'), T('desktop_missing'), false, [link(T('get'), 'https://claude.com/download')]));
      else if (d.tools === 'off') body.append(row(T('desktop'), T('desktop_what'), T('off'), false, [btn(T('connect'), 'btn-green', () => act({ connect: 'desktop' }, 'desktop'), 'desktop')]));
      else if (d.tools === 'elsewhere') body.append(row(T('desktop'), T('desktop_what'), T('elsewhere'), 'warn', [btn(T('reconnect'), 'btn-green', () => act({ connect: 'desktop' }, 'desktop'), 'desktop')]));
      else body.append(row(T('desktop'), T('desktop_what'), T('desktop_on'), true, [btn(T('disconnect'), 'btn-metal claudelink-small', () => act({ disconnect: 'desktop' }, 'desktop-off'), 'desktop-off')]));
      // the web
      const w = st.web;
      const setup = btn(T('setup_web'), 'btn-grey', () => { close(); const g = ctx.panels.game_settings; if (g && g.api.page) g.api.page(ctx.t('browserlink.title')); }, 'web');
      if (w.connectors) body.append(row(T('web'), T('web_what'), T('web_on', { count: w.connectors }), true, [setup]));
      else if (w.enabled && !w.online) body.append(row(T('web'), T('web_what'), T('web_offline'), 'warn', [setup]));
      else body.append(row(T('web'), T('web_what'), T('web_off'), false, [setup]));
    }
    if (msg) body.append(el('div', 'vas-p ' + (bad ? 'red' : 'green'), msg));
    const foot = el('div', 'welcome-row');
    const done = el('button', 'btn btn-grey', T('close'), { type: 'button' });
    done.addEventListener('click', close);
    foot.append(el('div', 'small grey claudelink-help', T('help')), done);
    body.append(foot);
  }
  card.append(body);
  document.body.append(card);
  render();
  load();
  card.focus();
}
