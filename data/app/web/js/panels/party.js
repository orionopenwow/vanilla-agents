// Party (G): play together. Host a party on this PC or join a friend's with their invite link; everyone's helpers share the inn.
// The shared plan: propose items, everyone agrees to the same version, then it is split fairly and your part appears in your quest log
// (you still approve it). The server does the talking (POST /api/party, vanilla_agents/party); this window only shows s.party.
import { clear, el, icon } from '../dom.js';

export function build(ctx, panel) {
  const c = panel.cfg, t = (k, v) => ctx.t(c.text[k], v), tip = (node, k) => { node.dataset.tip = c.tips[k]; return node; };
  const view = el('div', 'pt');
  panel.body.append(view);
  let last = null, msg = '', busy = false, draft = { title: '', why: '', size: 'medium' };
  const remember = (k, v) => { try { localStorage.setItem('party.' + k, v); } catch (e) { /* storage off */ } };
  const recall = (k, d = '') => { try { return localStorage.getItem('party.' + k) || d; } catch (e) { return d; } };

  async function send(body) {
    if (busy) return;
    busy = true; msg = '';
    try { const s = await ctx.net.post('/api/party', body); if (s && s.agents) ctx.render(s); } catch (e) { msg = e.message; if (last) draw(last); }
    busy = false;
  }
  const input = (cls, ph, val, max = 160) => { const i = el('input', 'esc-input pt-in ' + cls, null, { type: 'text', maxlength: String(max), placeholder: ph }); i.value = val || ''; return i; };
  const button = (cls, text, fn) => { const b = el('button', 'btn ' + cls, text, { type: 'button' }); b.addEventListener('click', fn); return b; };
  const select = (pairs, val, label) => { const sl = el('select', 'chat-filter pt-sel', null, { 'aria-label': label }); for (const [v, txt] of pairs) { const o = el('option', null, txt, { value: v }); if (v === val) o.selected = true; sl.append(o); } return sl; };
  const labelled = (text, ctl) => { const l = el('label', 'pt-opt'); l.append(el('span', 'small grey', text), ctl); return l; };
  const left = (ts) => { const s = Math.max(0, ts - Date.now() / 1000); return s >= 3600 ? t('hours', { n: Math.round(s / 3600) }) : t('minutes', { n: Math.max(1, Math.round(s / 60)) }); };
  let sure = '';                       // member id whose Remove button was pressed once (press again to confirm)

  function outside() {                 // not in a party: host or join
    const box = el('div', 'pt-two');
    const host = el('div', 'pt-card'), join = el('div', 'pt-card');
    const pname = input('', t('party_name'), recall('pname', 'Raid night'), 60), hname = input('', t('your_name'), recall('name', (last && last.party && last.party.default_name) || ''), 32);
    pname.setAttribute('aria-label', t('party_name')); hname.setAttribute('aria-label', t('your_name'));
    // who can reach the hub (this PC only = 127.0.0.1, my network = every address) and how long the invite link works
    const reach = select([['local', t('reach_local')], ['network', t('reach_network')]], recall('reach', 'network'), t('reach'));
    const hours = select([1, 8, 24, 72].concat([c.options.invite_hours]).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b)
      .map((h) => [String(h), t('hours', { n: h })]), recall('hours', String(c.options.invite_hours)), t('expires_label'));
    const opts = el('div', 'pt-opts');
    opts.append(tip(labelled(t('reach'), reach), 'reach'), labelled(t('expires_label'), hours));
    host.append(el('div', 'gold shadow pt-h', t('host_title')), el('div', 'small grey', t('host_hint')), pname, hname, opts,
      tip(button('btn-green', t('host'), () => { if (!hname.value.trim()) { msg = t('need_name'); return draw(last); } remember('name', hname.value.trim()); remember('pname', pname.value.trim());
        remember('reach', reach.value); remember('hours', hours.value);
        send({ action: 'host', party: pname.value.trim(), name: hname.value.trim(), port: c.options.port, network: reach.value === 'network', hours: +hours.value }); }), 'host'));
    const link = input('', t('invite'), '', 300), jname = input('', t('your_name'), recall('name', (last && last.party && last.party.default_name) || ''), 32);
    link.setAttribute('aria-label', t('invite')); jname.setAttribute('aria-label', t('your_name'));
    join.append(el('div', 'gold shadow pt-h', t('join_title')), el('div', 'small grey', t('join_hint')), link, jname,
      tip(button('btn-blue', t('join'), () => { if (!link.value.trim()) { msg = t('need_link'); return draw(last); } if (!jname.value.trim()) { msg = t('need_name'); return draw(last); }
        remember('name', jname.value.trim()); send({ action: 'join', invite: link.value.trim(), name: jname.value.trim() }); }), 'join'));
    box.append(host, join);
    const p = (last && last.party) || {};
    if (p.pending) {                   // a friend's invite page handed its link over (GET /join): one click, nothing joined without it
      const card = el('div', 'pt-card pt-invited'), nm = input('', t('your_name'), recall('name', p.default_name || ''), 32);
      nm.setAttribute('aria-label', t('your_name'));
      const yes = button('btn-green', t('join'), () => { if (!nm.value.trim()) { msg = t('need_name'); return draw(last); }
        remember('name', nm.value.trim()); send({ action: 'join', invite: p.pending.invite, name: nm.value.trim() }); });
      const no = button('btn-grey', t('not_now'), () => send({ action: 'dismiss' }));
      const row = el('div', 'pt-prow'); row.append(el('span', 'small grey', t('join_as')), nm, yes, no);
      card.append(el('div', 'gold shadow pt-h', p.pending.party ? t('invited', { name: p.pending.party }) : t('invited_unknown')), row);
      const wrapAll = el('div'); wrapAll.append(card, box); return wrapAll;
    }
    return box;
  }

  function inside(p) {
    const st = p.state || { members: [], items: [], log: [], version: 0 };
    const me = st.me, names = Object.fromEntries(st.members.map((m) => [m.id, m.name]));
    const wrap = el('div', 'pt-in-party');
    // header: party name, invite link to share, leave
    const head = el('div', 'pt-head');
    head.append(icon(c.icons.crown, 'pt-crown'), el('div', 'gold shadow pt-name', st.party || ''));
    if (p.host && p.invite) {           // only the host shares the link, renews it and removes members (the hub checks it too)
      const links = (p.invites && p.invites.length) ? p.invites : [{ kind: 'lan', url: p.invite }];
      const box = el('div', 'pt-links');
      for (const l of links) {         // one row per way in: the same Wi-Fi, and Tailscale when this PC has it (friends anywhere)
        const inv = input('pt-invite', '', l.url, 300); inv.readOnly = true; inv.setAttribute('aria-label', t('invite') + ' (' + t('link_' + l.kind) + ')');
        const cp = button('btn-grey pt-copy', t('copy'), async () => { try { await navigator.clipboard.writeText(l.url); cp.textContent = t('copied'); } catch (e) { inv.select(); } });
        const row = el('div', 'pt-linkrow'); row.append(el('span', 'small gold pt-linkkind', t('link_' + l.kind)), inv, cp); box.append(row);
      }
      box.append(el('div', 'small grey', t('share_hint')));
      head.append(box);
    }
    head.append(button('btn-red pt-leave', t('leave'), () => send({ action: 'leave' })));
    let hostRow = null;
    if (p.host) {
      hostRow = el('div', 'pt-hostrow');
      const expired = p.invite_expires && p.invite_expires < Date.now() / 1000;
      hostRow.append(el('span', 'small ' + (expired ? 'red' : 'grey'), expired ? t('expired') : p.invite_expires ? t('expires_in', { when: left(p.invite_expires) }) : ''),
        tip(button('btn-grey pt-renew', t('renew'), () => send({ action: 'renew', hours: +recall('hours', String(c.options.invite_hours)) })), 'renew'));
      hostRow.append(el('div', 'small pt-warn', p.local ? t('local_note') : t('warn_http')));
    }
    // members
    const mem = el('div', 'pt-members');
    mem.append(el('div', 'small gold shadow', t('members')));
    for (const m of st.members) {
      const chip = el('div', 'pt-member' + (m.active ? '' : ' pt-away') + (m.id === me ? ' pt-me' : ''));
      chip.append(icon(c.icons.member, 'pt-micon'), el('span', 'pt-mname', m.name), el('span', 'small grey', t('helpers', { count: m.agents.length })));
      if (m.host) chip.append(el('span', 'small gold', t('host_badge')));
      if (m.agrees) chip.append(el('span', 'small green', '✓ ' + t('agrees')));
      else if (!m.active) chip.append(el('span', 'small grey', t('away')));
      if (p.host && m.id !== me) {
        const k = tip(button('btn-red pt-kick', sure === m.id ? t('kick_sure') : t('kick'), () => {
          if (sure !== m.id) { sure = m.id; return draw(last); }
          sure = ''; send({ action: 'kick', member: m.id });
        }), 'kick');
        k.setAttribute('aria-label', t('kick') + ' ' + m.name);
        chip.append(k);
      }
      mem.append(chip);
    }
    // plan
    const plan = el('div', 'pt-plan');
    plan.append(el('div', 'gold shadow pt-h', t('plan', { n: st.version })));
    const list = el('div', 'pt-items');
    if (!st.items.length) list.append(el('div', 'small grey pt-empty', t('plan_empty')));
    for (const it of st.items) {
      const row = tip(el('div', 'pt-item pt-size-' + it.size + (it.owner === me ? ' pt-ours' : '')), 'item');
      const main = el('div', 'pt-imain');
      main.append(el('div', 'pt-ititle', it.title));
      const who = names[it.by] || it.by_name || '?', proposer = it.by_agent ? who + ' / ' + it.by_agent : who;
      const sub = [t('size_' + it.size), t('by', { name: proposer })];
      if (it.why) sub.push(it.why);
      main.append(el('div', 'small grey pt-isub', sub.join(' · ')));
      const side = el('div', 'pt-iside');
      if (st.locked) {
        side.append(el('div', 'small ' + (it.owner === me ? 'gold' : 'white'), it.owner === me ? t('mine') : it.owner ? t('owner', { name: names[it.owner] || '?' }) : t('nobody')));
        side.append(el('div', 'small pt-st-' + it.status, t('status_' + it.status)));
        if (it.owner !== me && ['open', 'quest'].includes(it.status)) side.append(tip(button('btn-grey pt-take', t('take'), () => send({ action: 'take', item: it.id })), 'take'));
      } else { const x = button('btn-grey pt-x', '×', () => send({ action: 'remove', item: it.id })); x.setAttribute('aria-label', t('remove') + ': ' + it.title); side.append(x); }
      row.append(main, side);
      list.append(row);
    }
    plan.append(list);
    // propose / agree
    const foot = el('div', 'pt-foot');
    if (!st.locked) {
      const ti = input('pt-title', t('item_title'), draft.title), wy = input('pt-why', t('item_why'), draft.why, 400);
      const sz = el('select', 'chat-filter pt-sel');
      for (const k of ['small', 'medium', 'big']) { const o = el('option', null, t('size_' + k), { value: k }); if (k === draft.size) o.selected = true; sz.append(o); }
      ti.addEventListener('input', () => { draft.title = ti.value; }); wy.addEventListener('input', () => { draft.why = wy.value; }); sz.addEventListener('change', () => { draft.size = sz.value; });
      const go = () => { if (!ti.value.trim()) { msg = t('need_title'); return draw(last); } const b = { action: 'propose', title: ti.value.trim(), why: wy.value.trim(), size: sz.value }; draft = { title: '', why: '', size: sz.value }; send(b); };
      ti.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      const row = el('div', 'pt-prow'); row.append(ti, wy, sz, button('btn-green', t('propose'), go));
      foot.append(el('div', 'small gold shadow', t('propose_title')), row);
      const mine = st.members.find((m) => m.id === me);
      if (mine && mine.agrees) foot.append(el('div', 'small gold pt-wait', t('agreed', { names: st.members.filter((m) => m.active && !m.agrees).map((m) => m.name).join(', ') })));
      else if (st.items.length) foot.append(tip(button('btn-green pt-agree', t('agree'), () => send({ action: 'agree', version: st.version })), 'agree'));
    } else {
      foot.append(el('div', 'small green pt-wait', t('locked', { count: st.items.filter((i) => i.owner === me).length })));
      foot.append(button('btn-grey pt-unlock', t('unlock'), () => send({ action: 'unlock' })));
    }
    // log
    const log = el('div', 'pt-log');
    log.append(el('div', 'small gold shadow', t('log')));
    for (const l of (st.log || []).slice(-c.options.log_lines)) log.append(el('div', 'small grey', l.who + ' ' + l.text));
    wrap.append(head);
    if (hostRow) wrap.append(hostRow);
    wrap.append(mem, plan, foot, log);
    return wrap;
  }

  function draw(s) {
    last = s;
    if (!panel.isOpen()) return;
    const active = document.activeElement, keep = active && view.contains(active) && active.tagName === 'INPUT' ? active.className : null;
    if (keep) return;                  // never redraw under the cursor while typing; the next update after you finish will
    clear(view);
    const p = s.party || {};
    view.append(p.joined ? inside(p) : outside());
    const err = msg || p.error;
    if (err) view.append(el('div', 'small red pt-err', t('error', { error: err })));
  }
  let offered = null;
  const update = (s) => {              // an invite handed over from the browser opens this window once, so the question is seen
    const pend = s && s.party && s.party.pending;
    if (pend && pend.at !== offered) { offered = pend.at; if (!panel.isOpen()) panel.toggle(); }
    draw(s);
  };
  const toggle = panel.toggle;
  panel.toggle = () => { toggle(); if (panel.isOpen() && last) draw(last); };
  return { update };
}
