// The loading screen: the game's own Eastern Kingdoms loading art, its loading bar and a game tip, shown until the inn is ready,
// so nothing has to load (models, paths, heroes, shaders) once you are playing. Steps report a label and 0..1 progress.
// The bar never stands still while a long step runs: it creeps toward the next step (never past it), and after a while a line
// under the bar says why the first start is slow. texts({ slow }) sets that line (config strings, after the settings load).
const box = () => document.getElementById('loading');
let tipsTimer = null, shown = 0, target = 0, ceil = 0, raf = 0, began = 0, slowTimer = null, text = { slow: '' };
const doneFns = [];
const CREEP = 0.0025;              // per frame, a share of the way left to the soft ceiling: slow enough that a step never looks finished

function animate() {
  if (target < ceil) target += (ceil - target) * CREEP;       // a long step: keep moving, ever slower, never reaching the next step
  shown += (target - shown) * 0.12;
  const fill = document.getElementById('loading-fill');
  if (fill) fill.style.width = (shown * 100).toFixed(1) + '%';
  raf = box() ? requestAnimationFrame(animate) : 0;
}

export const loading = {
  texts(t) { text = { ...text, ...t }; },
  step(label, pct, next) {
    if (!began) {
      began = performance.now();
      slowTimer = setTimeout(() => { const s = document.getElementById('loading-slow'); if (s && text.slow) { s.textContent = text.slow; s.hidden = false; } }, 9000);
    }
    const l = document.getElementById('loading-label');
    if (l && label) l.textContent = label;
    target = Math.max(target, Math.min(1, pct));
    ceil = Math.max(target, Math.min(0.98, next !== undefined ? next : pct + 0.08));
    if (!raf) raf = requestAnimationFrame(animate);
  },
  note(line) { const n = document.getElementById('loading-note'); if (n) n.textContent = line || ''; },
  async tips() {
    const t = document.getElementById('loading-tip');
    let list = [];
    try { list = await fetch('/assets/ui/tips.json').then((r) => (r.ok ? r.json() : [])); } catch (e) { list = []; }
    if (!t || !list.length) return;
    const show = () => { t.innerHTML = ''; const s = list[Math.floor(Math.random() * list.length)]; const g = document.createElement('span'); g.className = 'gold'; g.textContent = 'Tip: '; t.append(g, document.createTextNode(s)); };
    show(); tipsTimer = setInterval(show, 7000);
  },
  onDone(fn) { doneFns.push(fn); },
  done() {
    target = ceil = 1;
    clearTimeout(slowTimer);
    const b = box();
    if (!b) return;
    setTimeout(() => {
      b.classList.add('loading-out'); clearInterval(tipsTimer);
      setTimeout(() => { b.remove(); for (const fn of doneFns.splice(0)) { try { fn(); } catch (e) { console.warn('after loading', e); } } }, 700);
    }, 350);
  },
  fail(msg) { const l = document.getElementById('loading-label'); if (l) { l.textContent = msg; l.classList.add('red'); } clearTimeout(slowTimer); },
};
