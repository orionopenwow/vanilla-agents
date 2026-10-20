// The Goldshire Inn as the workshop: the game's own inn building (baked by vanilla_agents/assets/wmo.py -> models/inn.glb + inn.spots.json) with up to 15 agents.
// Idle agents hang around (sit at the tables, chat, stand by the fire); an agent with a job walks to its desk against a wall and works. You walk the hero with
// WASD, look with the RIGHT mouse button, zoom with the wheel (all the way in = first person). Numbers live in INN below; the inn file is in yards, K turns it into metres.
import * as THREE from 'three';
import { loadModel, preloadModel, bounds } from './models.js';
import { mergeGeometries } from '/vendor/BufferGeometryUtils.js';
import { loading } from '../js/loading.js';
import { TUNE } from './tune.js';
import { makeJukebox } from './jukebox.js';
import { makeJukeAudio } from './jukeaudio.js';
import { showToast } from '../js/toast.js';
import { makeTyping } from './typing.js';
import { makeMonitor } from './monitor.js';
import * as ws from '../js/wsettings.js';
import { makeKeyboard } from './props.js';
import { checkRevived, justRevived } from '../js/resurrect.js';
import { makeTaskKind, namePattern, questChecks } from './innwork.js';
import { makeInnLights } from './innlights.js';
import { gameTimes, blendAt } from './innsky.js';
import { loadProp } from './carry.js';
import { boneByKey } from './typing.js';

const K = 0.9144;
const INN = {
  max_agents: 15, cell: 0.5, clear: 0.28, hero_speed: 4.2, hero_run: 7.5, walk_speed: 2.5 * K, fire_fov: 65,
  stay_s: [18, 50], desks_max: 10, desk_gap: 2.2, hero_scale: 1, cam_min: 0.35, cam_max: 14,
  block_names: /table|bench|chair|barrel|keg|crate|bookshelf|wardrobe|bed|rack|sack|stack|shelf|stool|anvil|cart|trunk|chest/i,
};
const HISTORY = 8;
const activityLine = (act) => { const m = /^Bash\s+(.*)$/.exec(act); return m ? '$ ' + m[1] : '> ' + act; };
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h; };
const rng = (seed) => { let x = (seed * 2654435761 + 1) >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };
const place = (obj, p, rotDeg = 0, scale = 1) => { obj.position.set(...p); obj.rotation.y = THREE.MathUtils.degToRad(rotDeg); obj.scale.setScalar(scale); };

export function initInn(ctx) {
  const w = ctx.cfg.workshop, c = w.scene3d, canvas = document.getElementById('workshop');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: ws.get('VA_Quality') >= 3 });
  const ratio = (q) => [0.75, 1, Math.min(window.devicePixelRatio || 1, 1.5), window.devicePixelRatio || 1][q] || 1;
  renderer.setPixelRatio(ratio(ws.get('VA_Quality')));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9bb0c6');
  const sky = new THREE.HemisphereLight('#fff1dd', '#6b5a48', 1.9); scene.add(sky);
  const sun = new THREE.DirectionalLight('#ffe9c8', 0.6); sun.position.set(-8, 14, 6); scene.add(sun);
  // V-043: how helpers do their tasks (workshop.json inn.tasks) and the candle lights (inn.lights, innlights.js)
  const IW = w.inn || {}, TK = { hold_s: 20, back_s: 8, ask_every_s: 14, ...(IW.tasks || {}) }, taskKind = makeTaskKind(TK);
  const lights = makeInnLights(scene, IW.lights, { reduced: () => ws.reducedMotion(), quality: () => Number(ws.get('VA_Quality')) });
  // time of day: the light through the windows and the sky outside (auto = your clock)
  const TIMES = { day: ['#9bb0c6', '#fff1dd', '#6b5a48', 1.9, '#ffe9c8', 0.6], dusk: ['#c58a6a', '#ffd2a8', '#5a4038', 1.5, '#ff9e5e', 0.5], night: ['#141a2e', '#8a96c8', '#2a2430', 1.05, '#9fb0ff', 0.25] };
  function applyTime(v) {
    let e = TIMES[v];
    if (v === 'auto' || !e) { const d = new Date(), b = blendAt(TIMES, d.getHours() + d.getMinutes() / 60); v = b.name; e = b.entry; }   // V-046: auto blends smoothly by your clock
    const [bg, top, bottom, k, sc, sk, fog] = e; scene.background.set(bg); sky.color.set(top); sky.groundColor.set(bottom); sky.intensity = k; sun.color.set(sc); sun.intensity = sk;
    if (fog && scene.fog) scene.fog.color.set(fog);
    lights.setTime(v, sc);
  }
  // V-042: each zone has its own sky and light through the windows (places.json "light"); forest = the times above unchanged. V-046: only the fallback now, when the zone has no baked game light
  const PLACE_LIGHT = {
    plains: { day: ['#a9c3d8', '#fff4dc', '#7a6a4a', 2.0, '#fff0c8', 0.7] },
    mountain: { day: ['#8fa6c0', '#eef2ff', '#5e5a52', 1.8, '#f2f0ff', 0.6], dusk: ['#b07a68', '#ffcfb0', '#4a3a38', 1.4, '#ff9a6a', 0.45] },
    snow: { day: ['#c9d8e8', '#f2f8ff', '#8a98a8', 2.0, '#ffffff', 0.7], dusk: ['#8f8fb8', '#d8dcff', '#4a4a60', 1.4, '#c8c8ff', 0.4], night: ['#0e1830', '#9fb4e8', '#2a3040', 1.1, '#b8c8ff', 0.3], fog: '#c9d8e8' },
    gloom: { day: ['#4a5560', '#b8c0c8', '#3a3430', 1.35, '#a8b4c0', 0.3], dusk: ['#2e2a38', '#9a94b0', '#2a2228', 1.15, '#8a84a8', 0.22], night: ['#0a0c16', '#6a74a0', '#1a1820', 0.95, '#7080c0', 0.18], fog: '#2a3038' },
    plague: { day: ['#6a6a4a', '#d8d0a0', '#4a4030', 1.4, '#c8c080', 0.35], dusk: ['#5a4030', '#c8a080', '#3a2a20', 1.2, '#c08050', 0.3], night: ['#141410', '#8a8a60', '#201c14', 0.95, '#a0a070', 0.18], fog: '#4a4a34' },
    swamp: { day: ['#7a8a78', '#e0e8d0', '#4a5040', 1.6, '#d8e0c0', 0.45], fog: '#6a7868' },
    jungle: { day: ['#8ab89a', '#f0ffe0', '#3a5a30', 1.9, '#fff0b0', 0.65], dusk: ['#c88a58', '#ffd8a0', '#3a3020', 1.5, '#ff9a48', 0.5] },
    enchanted: { day: ['#8a9ad0', '#e8e0ff', '#4a4060', 1.7, '#d8c8ff', 0.5], dusk: ['#6a5a9a', '#d0b8ff', '#3a2a48', 1.4, '#b898ff', 0.4], night: ['#101030', '#a090e0', '#201a38', 1.15, '#a8a0ff', 0.3] },
    moonlit: { day: ['#5a6a98', '#c8d0f0', '#3a3a50', 1.45, '#b8c0f0', 0.35], dusk: ['#3a3a70', '#b0b0e8', '#2a2a40', 1.25, '#a0a8f0', 0.3], night: ['#0a0e24', '#8a98d8', '#1a1a30', 1.05, '#98a8f0', 0.25] },
    desert: { day: ['#e0b880', '#fff0d0', '#8a5a30', 2.0, '#ffe0a0', 0.75], dusk: ['#d07848', '#ffc890', '#5a3020', 1.6, '#ff8a40', 0.55], fog: '#d8b080' },
    savanna: { day: ['#d0c088', '#fff4d8', '#7a6038', 2.0, '#ffe8b0', 0.7], dusk: ['#c88050', '#ffd0a0', '#4a3020', 1.55, '#ff9050', 0.5] },
  };
  // V-046: a zone baked with the game's own light (places/index.json "lighting", innsky.js) uses that; the presets above are the fallback
  function zoneLight(id, lighting) {
    const G = gameTimes(lighting), L = G || PLACE_LIGHT[id]; if (!L) return;
    for (const k of ['day', 'dusk', 'night']) if (L[k]) TIMES[k] = L[k];
    if (G) scene.fog = new THREE.Fog(G.day[6], G.far * 0.35, G.far);
    else if (L.fog) scene.fog = new THREE.Fog(L.fog, 40, 140);          // far away only: inside the inn stays clear
    applyTime(ws.get('VA_TimeOfDay'));
  }
  applyTime(ws.get('VA_TimeOfDay')); setInterval(() => { if (ws.get('VA_TimeOfDay') === 'auto') applyTime('auto'); }, 60000);
  let house = null, frameGap = 0, sinceFrame = 0;
  const setCap = (v) => { frameGap = v ? 1 / v - 0.002 : 0; }; setCap(ws.get('VA_FpsCap'));
  const camera = new THREE.PerspectiveCamera(INN.fire_fov, 1, 0.05, 300);
  const clock = new THREE.Clock(), ray = new THREE.Raycaster(), tmp = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);
  let state = { agents: [] }, ready = false, walls = null, solid = null, inn = null, colMeshes = [];   // walls: the building (floors, camera); solid: + every doodad's own collision mesh (you bump into it)
  const hist = {};
  // the jukebox (J play/pause, K next, or click it): same lights and sound as the office one, standing against a wall near the start
  const juke = makeJukeAudio(TUNE.jukebox), jbPos = new THREE.Vector3();
  let jb = null, cur = null;
  ws.on((name, v) => {
    if (name === 'VA_Building' && house && v !== house.key) { showToast(ctx.t('ws.reloading', { name: '...' }), 'grey'); setTimeout(() => location.reload(), 600); }
    else if (name === 'VA_Quality') { renderer.setPixelRatio(ratio(v)); size(); lights.reset(); }
    else if (name === 'VA_TimeOfDay') applyTime(v);
    else if (name === 'VA_FpsCap') setCap(v);
    else if (name === 'VA_Music') juke.setWords(v && house ? house.music : []);
  });
  juke.onTrack = (t) => { cur = t; showToast(ctx.t('jukebox.now', { title: t.title }), 'gold'); };
  ctx.jukebox = { toggle: () => juke.toggle().then((on) => { if (!on) showToast(ctx.t(cur ? 'jukebox.paused' : 'jukebox.none'), 'grey'); }), next: () => juke.next(), get playing() { return juke.playing; } };

  // ---- speed: rays test a grid of small wall chunks (not every triangle of the building), furniture is drawn in a few batches ----
  function makeCollider(srcs, cellSize = 3) {
    const buckets = new Map(), v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (const src of [].concat(srcs)) { src.updateMatrixWorld(true); src.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < n; i += 3) {
        for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(o.matrixWorld);
        const key = Math.floor((v[0].x + v[1].x + v[2].x) / 3 / cellSize) + ',' + Math.floor((v[0].y + v[1].y + v[2].y) / 3 / cellSize) + ',' + Math.floor((v[0].z + v[1].z + v[2].z) / 3 / cellSize);
        let b = buckets.get(key); if (!b) buckets.set(key, (b = []));
        for (const p of v) b.push(p.x, p.y, p.z);
      }
    }); }
    const grp = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    for (const arr of buckets.values()) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeBoundingSphere(); g.computeBoundingBox();
      grp.add(new THREE.Mesh(g, mat));
    }
    grp.updateMatrixWorld(true);
    return grp;
  }
  function batchFurniture(root) {     // every doodad mesh sharing a texture becomes one mesh (hundreds of draw calls -> a few dozen)
    root.updateMatrixWorld(true);
    const groups = new Map();
    root.children.forEach((node, q) => {
      if (q === 0) return;
      node.traverse((o) => {
        if (!o.isMesh || o.isSkinnedMesh || /^col_/.test(o.name)) return;   // collision meshes stay hidden, out of the batches
        const m = o.material, key = [m.map ? m.map.uuid : m.color.getHexString(), m.transparent, m.alphaTest, m.blending].join('|');
        let gr = groups.get(key); if (!gr) groups.set(key, (gr = { mat: m, geos: [] }));
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (!g.attributes.normal) g.computeVertexNormals();
        gr.geos.push(g.index ? g : g);
      });
      node.visible = false;
    });
    const out = new THREE.Group(); out.name = 'furniture';
    for (const gr of groups.values()) {
      const indexed = gr.geos.filter((g) => g.index), plain = gr.geos.filter((g) => !g.index);
      for (const list of [indexed, plain]) { if (!list.length) continue; const merged = mergeGeometries(list, false); if (merged) { merged.computeBoundingSphere(); out.add(new THREE.Mesh(merged, gr.mat)); } }
    }
    scene.add(out);
    return out;
  }

  // ---- navigation graph: node = (cell, layer); a layer is one walkable surface in that column (ground, stairs, upper floor) ----
  const nav = { minX: 0, minZ: 0, W: 0, H: 0, N: 0, K: 4, ok: null, y: null };
  const cellOf = (x, z) => { const ix = Math.round((x - nav.minX) / INN.cell), iz = Math.round((z - nav.minZ) / INN.cell); return ix < 0 || iz < 0 || ix >= nav.W || iz >= nav.H ? -1 : iz * nav.W + ix; };
  const cellXZ = (i) => { const c = i % nav.N; return [nav.minX + (c % nav.W) * INN.cell, nav.minZ + Math.floor(c / nav.W) * INN.cell]; };
  const free = (i) => i >= 0 && nav.ok[i] === 1;
  // free node of column (x,z) whose surface is nearest to height y (within tol), or -1
  function nodeAt(x, z, y, tol = 0.6) {
    const c = cellOf(x, z); if (c < 0) return -1; let best = -1, bd = tol;
    for (let k = 0; k < nav.K; k++) { const n = k * nav.N + c; if (free(n) && Math.abs(nav.y[n] - y) < bd) { bd = Math.abs(nav.y[n] - y); best = n; } }
    return best;
  }
  function hit(o, d, far, obj) { ray.set(o, d); ray.far = far; const h = ray.intersectObject(obj || walls, true); return h.length ? h[0] : null; }
  async function buildNav(spots, progress = () => {}) {
    const wb = new THREE.Box3().setFromObject(walls);
    nav.minX = wb.min.x; nav.minZ = wb.min.z; nav.W = Math.ceil((wb.max.x - wb.min.x) / INN.cell) + 1; nav.H = Math.ceil((wb.max.z - wb.min.z) / INN.cell) + 1;
    nav.N = nav.W * nav.H; nav.ok = new Uint8Array(nav.N * nav.K); nav.y = new Float32Array(nav.N * nav.K).fill(NaN);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => new THREE.Vector3(x, 0, z));
    for (let c = 0; c < nav.N; c++) {
      const [x, z] = cellXZ(c); ray.set(tmp.set(x, wb.max.y + 1, z), DOWN); ray.far = wb.max.y - wb.min.y + 2;   // buildings do not all stand at y = 0
      const hs = []; for (const h of ray.intersectObject(walls, true)) if (!hs.length || hs[hs.length - 1].point.y - h.point.y > 0.1) hs.push(h);   // top-down, double hits merged
      let k = 0;
      for (let j = 0; j < hs.length && k < nav.K; j++) {
        const h = hs[j], y = h.point.y;
        if (h.face.normal.y <= 0.6 || y < wb.min.y - 0.25 || y > wb.min.y + 12) continue;
        if (j > 0 && hs[j - 1].point.y - y < 1.8) continue;   // no headroom
        const n = k * nav.N + c; nav.y[n] = y; k++;
        let clear = true; for (const d of dirs) if (hit(tmp.set(x, y + 0.9, z), d, INN.clear)) { clear = false; break; }
        nav.ok[n] = clear ? 1 : 0;
      }
      if (c % 120 === 0) { progress(c / nav.N); await new Promise((r) => setTimeout(r, 0)); }
    }
    // furniture: a prop blocks the nodes under it when it stands in the body's way (from shin to head height of that floor); flat rugs,
    // hanging lamps above the head and small clutter (bottles, plates) do not block. Grown a little so nobody brushes through an edge.
    inn.updateMatrixWorld(true);
    const size = new THREE.Vector3();
    // with the game's collision mesh: exactly the triangles in the body's way (shin to head) within a body radius of the cell
    const R = 0.3, A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    const seg = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz; const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0; return Math.hypot(px - ax - t * dx, pz - az - t * dz); };
    const near2d = (px, pz) => {
      const d1 = (B.x - A.x) * (pz - A.z) - (B.z - A.z) * (px - A.x), d2 = (C.x - B.x) * (pz - B.z) - (C.z - B.z) * (px - B.x), d3 = (A.x - C.x) * (pz - C.z) - (A.z - C.z) * (px - C.x);
      if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) return 0;
      return Math.min(seg(px, pz, A.x, A.z, B.x, B.z), seg(px, pz, B.x, B.z, C.x, C.z), seg(px, pz, C.x, C.z, A.x, A.z));
    };
    for (const m of colMeshes) {
      const pos = m.geometry.attributes.position, idx = m.geometry.index, n = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < n; i += 3) {
        A.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld); B.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(m.matrixWorld); C.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(m.matrixWorld);
        const y0 = Math.min(A.y, B.y, C.y), y1 = Math.max(A.y, B.y, C.y);
        for (let x = Math.min(A.x, B.x, C.x) - R; x <= Math.max(A.x, B.x, C.x) + R + 1e-6; x += INN.cell / 2) for (let z = Math.min(A.z, B.z, C.z) - R; z <= Math.max(A.z, B.z, C.z) + R + 1e-6; z += INN.cell / 2) {
          const c = cellOf(x, z); if (c < 0) continue; const [cx, cz] = cellXZ(c);
          for (let k = 0; k < nav.K; k++) { const nn = k * nav.N + c; if (nav.ok[nn] === 1 && y0 < nav.y[nn] + 1.8 && y1 > nav.y[nn] + 0.3 && near2d(cx, cz) <= R) nav.ok[nn] = 2; }
        }
      }
    }
    spots.forEach((s, q) => {
      const node = inn.children[1 + q]; if (!node) return;
      const b = new THREE.Box3().setFromObject(node); s.box = b.isEmpty() ? null : b;
      if (!s.box || node.userData.hasCol) return;      // has its own collision mesh: done above
      if (!INN.block_names.test(s.name || '')) return;   // no collision mesh and not furniture: walk-through, like in the game
      b.getSize(size);
      if (size.y < 0.12 || (size.x < 0.35 && size.z < 0.35)) return;
      const g = 0.2;
      for (let x = b.min.x - g; x <= b.max.x + g; x += INN.cell / 2) for (let z = b.min.z - g; z <= b.max.z + g; z += INN.cell / 2) {
        const c = cellOf(x, z); if (c < 0) continue;
        for (let k = 0; k < nav.K; k++) { const n = k * nav.N + c; if (nav.ok[n] === 1 && b.min.y < nav.y[n] + 1.7 && b.max.y > nav.y[n] + 0.25) nav.ok[n] = 2; }
      }
    });
    for (let i = 0; i < nav.ok.length; i++) if (nav.ok[i] === 2) nav.ok[i] = 0;
  }
  // height of the surface under (x,z) nearest to y (blocked cells count too); y itself if the column is empty
  const gy = (x, z, y = 0) => {
    const c = cellOf(x, z); if (c < 0) return y; let best = y, bd = 1.0;
    for (let k = 0; k < nav.K; k++) { const v = nav.y[k * nav.N + c]; if (v === v && Math.abs(v - y) < bd) { bd = Math.abs(v - y); best = v; } }
    return best;
  };
  function nearestFree(x, z, y = 0, maxR = 12) {
    const n0 = nodeAt(x, z, y, 1.0); if (n0 >= 0) return n0;
    const ix = Math.round((x - nav.minX) / INN.cell), iz = Math.round((z - nav.minZ) / INN.cell);
    for (let r = 1; r <= maxR; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const jx = ix + dx, jz = iz + dz; if (jx < 0 || jz < 0 || jx >= nav.W || jz >= nav.H) continue;
      const n = nodeAt(nav.minX + jx * INN.cell, nav.minZ + jz * INN.cell, y, 1.0); if (n >= 0) return n;
    }
    return -1;
  }
  // neighbours of node n: free nodes in the 8 surrounding columns within 0.5 m of height (stairs link floors), no corner cutting
  function eachNb(n, fn) {
    const c = n % nav.N, y = nav.y[n], cx = c % nav.W, cz = (c - cx) / nav.W;
    const near = (col, yy) => { for (let k = 0; k < nav.K; k++) { const m = k * nav.N + col; if (free(m) && Math.abs(nav.y[m] - yy) < 0.5) return m; } return -1; };
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= nav.W || nz >= nav.H) continue;
      if (dx && dz && (near(cz * nav.W + nx, y) < 0 || near(nz * nav.W + cx, y) < 0)) continue;
      const m = near(nz * nav.W + nx, y); if (m >= 0) fn(m, dx && dz ? 1.414 : 1);
    }
  }
  // keep only the nodes connected to the start (same moves as A*): isolated pockets (behind furniture, outside) are never goals
  function keepConnected(start) {
    if (start < 0) return;
    const seen = new Uint8Array(nav.ok.length), q = [start]; seen[start] = 1;
    for (let h = 0; h < q.length; h++) eachNb(q[h], (m) => { if (!seen[m]) { seen[m] = 1; q.push(m); } });
    for (let i = 0; i < nav.ok.length; i++) if (!seen[i]) nav.ok[i] = 0;
  }
  // A* on the graph; returns [{x,z,y}] or null
  function findPath(a, b) {
    const s = nearestFree(a.x, a.z, a.y || 0), g = nearestFree(b.x, b.z, b.y || 0); if (s < 0 || g < 0) return null;
    const gs = new Map([[s, 0]]), from = new Map(), open = [[0, s]], closed = new Set(), [gx, gz] = cellXZ(g), gyy = nav.y[g];
    const hh = (i) => { const [x, z] = cellXZ(i); return Math.hypot(x - gx, z - gz, nav.y[i] - gyy); };
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cur] = open.splice(bi, 1)[0];
      if (cur === g) { const out = []; for (let n = g; n !== undefined; n = from.get(n)) { const [x, z] = cellXZ(n); out.push({ x, z, y: nav.y[n] }); } return out.reverse(); }
      if (closed.has(cur)) continue; closed.add(cur);
      eachNb(cur, (n, cost) => {
        if (closed.has(n)) return;
        const ng = gs.get(cur) + cost;
        if (ng < (gs.has(n) ? gs.get(n) : 1e9)) { gs.set(n, ng); from.set(n, cur); open.push([ng + hh(n), n]); }
      });
    }
    return null;
  }

  // ---- places to sit / stand, from the game's own props ----
  const seats = [], tables = [], deskSpots = [];
  let fire = null, board = null;
  const props = { read: [], crate: [], anvil: [] };   // where errands go: bookshelves (reading code), crates (committing / packing up), an anvil or forge (tests and builds)
  function findSpots(spots) {
    const nm = (s) => (s.name || '').split('/').pop().toLowerCase();
    for (const s of spots) if (/table/.test(nm(s)) && !/rack|cloth|side/.test(nm(s)) && s.box) { const ctr = s.box.getCenter(new THREE.Vector3()); ctr.top = s.box.max.y; ctr.area = (s.box.max.x - s.box.min.x) * (s.box.max.z - s.box.min.z); tables.push(ctr); }
    // the nearest table on the same floor: its top must be at sitting height above this spot's floor (not a table upstairs or downstairs)
    const toward = (p, fy) => { let best = null, bd = 1e9; for (const t of tables) { const d = Math.hypot(t.x - p.x, t.z - p.z), up = (t.top ?? t.y) - (fy ?? gy(p.x, p.z, t.y)); if (d < bd && up > 0.35 && up < 1.35) { bd = d; best = t; } } return best; };
    spots.forEach((s, q) => {     // chimney smoke has no mesh (emitters are not baked) but still marks the fireplace
      if (!s.box && !fire && /housesmoke|blacksmith_smoke|fireplace/.test(nm(s)) && inn.children[1 + q]) { const p = inn.children[1 + q].getWorldPosition(new THREE.Vector3()); const n0 = nearestFree(p.x, p.z, gy(p.x, p.z, 0), 24); if (n0 >= 0) { const [x, z] = cellXZ(n0); fire = new THREE.Vector3(x, nav.y[n0], z); } }
    });
    // V-043: anvils / forges (also a smithy's smoke, which has no mesh) and the light sources, by name from workshop.json inn
    const anvilRe = namePattern(TK.anvil), lampRe = namePattern((IW.lights || {}).names), lamps = [];
    spots.forEach((s, q) => {
      const node = inn.children[1 + q]; if (!node) return;
      const n = nm(s), at = s.box ? s.box.getCenter(new THREE.Vector3()) : node.getWorldPosition(new THREE.Vector3());
      if (anvilRe && anvilRe.test(n)) props.anvil.push(at);
      if (lampRe && lampRe.test(n)) lamps.push(at);
    });
    lights.setSpots(lamps);
    const dropRe = namePattern(TK.drop) || /crate|barrel|keg|sack|chest|trunk/;
    for (const s of spots) {
      if (!s.box) continue; const n = nm(s), ctr = s.box.getCenter(new THREE.Vector3());
      if (/chair/.test(n) && !/rack/.test(n)) { const t = toward(ctr, gy(ctr.x, ctr.z, s.box.min.y + 0.2)); if (t && Math.hypot(t.x - ctr.x, t.z - ctr.z) < 2.6) seats.push({ x: ctr.x, z: ctr.z, y: gy(ctr.x, ctr.z, s.box.min.y + 0.2), yaw: Math.atan2(t.x - ctr.x, t.z - ctr.z), taken: null, table: t }); }
      else if (/innbench/.test(n)) {
        const sz = s.box.getSize(new THREE.Vector3()), along = sz.x > sz.z ? 'x' : 'z', len = Math.max(sz.x, sz.z);
        for (let q = -1; q <= 1; q++) { const p = ctr.clone(); p[along] += q * len / 3.2; const t = toward(p, gy(ctr.x, ctr.z, s.box.min.y + 0.2)); if (t) seats.push({ x: p.x, z: p.z, y: gy(ctr.x, ctr.z, s.box.min.y + 0.2), yaw: Math.atan2(t.x - p.x, t.z - p.z), taken: null, table: Math.hypot(t.x - p.x, t.z - p.z) < 2.2 ? t : null }); }
      } else if (/housesmoke|fireplace|hearth/.test(n) && !fire) fire = ctr;
      if (/bookshelf|bookcase|books/.test(n)) props.read.push(ctr);
      else if (dropRe.test(n)) props.crate.push(ctr);
      else if (/poster|notice|board/.test(n) && !board) board = { x: ctr.x, z: ctr.z, y: s.box.min.y };
    }
  }
  // desks stand against walls in the free ground-floor area: wall found by rays, rectangle must be free
  function findDesks(y0, y1) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]], cand = [];
    for (let i = 0; i < nav.ok.length; i++) {
      if (!free(i) || nav.y[i] < y0 || nav.y[i] > y1) continue; const [x, z] = cellXZ(i), fy = nav.y[i];
      for (const [dx, dz] of dirs) {
        const h = hit(tmp.set(x, fy + 0.9, z), new THREE.Vector3(dx, 0, dz), 1.4); if (!h || h.distance < 0.5) continue;
        // room direction n = away from the wall; group origin sits at the wall, its +z points into the room
        const n = { x: -dx, z: -dz }, ox = x + dx * (h.distance - 0.12), oz = z + dz * (h.distance - 0.12), px = -n.z, pz = n.x;
        let okk = true;
        for (let a = -0.9; a <= 0.9 && okk; a += 0.45) for (let d = 0.1; d <= 2.3 && okk; d += 0.4) okk = nodeAt(ox + n.x * d + px * a, oz + n.z * d + pz * a, fy, 0.3) >= 0;
        if (okk) cand.push({ x: ox, z: oz, y: fy, yaw: Math.atan2(n.x, n.z) });
      }
    }
    cand.sort((a, b) => b.z - a.z || a.x - b.x);
    for (const q of cand) { if (deskSpots.length >= INN.desks_max) break; if (deskSpots.every((d) => Math.hypot(d.x - q.x, d.z - q.z) >= INN.desk_gap)) deskSpots.push({ ...q, used: null }); }
  }

  // ---- characters ----
  let roster = null;
  async function workerFile(id) {
    if (roster === null) roster = await fetch('/assets/models/workers/manifest.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
    if (!roster.length) return { file: c.models.character, scale: 1 };
    if (id === 'hero') { let k = window.__heroPick; try { if (k === undefined) { const v = localStorage.getItem('innHero'); if (v !== null) k = +v; } } catch (e) { /* storage off */ } if (roster[k]) return roster[k]; }
    if (barmaid(id)) { const f = roster.filter((r) => r.sex === 'f'), h = f.filter((r) => r.race === 'human'), pool = h.length ? h : f.length ? f : roster; return pool[hash(id) % pool.length]; }
    const pool = roster; return pool[hash(id) % pool.length];
  }
  const villagers = new Map(), stations = new Map();
  // the demo (demo.cmd, server --demo): every helper sits at a laptop and stays there; one barmaid (role "barmaid") walks between the tables
  const roleOf = (id) => (((state && state.agents) || []).find((a) => a.id === id) || {}).role || '';
  const barmaid = (id) => /barmaid/i.test(roleOf(id));
  const atWork = (a) => !!a && (a.state === 'working' || (!!(state && state.demo) && !barmaid(a.id)));
  const onTable = (p) => !!(p && p.look && p.look.race === 'gnome');      // a gnome is too short for the chairs: he sits on the table at his laptop
  async function makePerson(id) {
    const look = await workerFile(id), gltf = await loadModel(look.file), g = new THREE.Group();
    gltf.scene.scale.setScalar(look.scale || 1); g.add(gltf.scene);
    const mixer = new THREE.AnimationMixer(gltf.scene), acts = {};
    for (const n of ['sit', 'stand', 'walk']) { const cl = gltf.animations.find((q) => q.name === c.clips[n]); if (cl) acts[n] = mixer.clipAction(cl); }
    const byId = {};   // the game's own animation sequences a<id>_<variation>, with the M2 blend-in / frequency of each
    for (const cl of gltf.animations) { const m = /^a(\d+)_(\d+)$/.exec(cl.name); if (m) (byId[+m[1]] = byId[+m[1]] || []).push({ act: mixer.clipAction(cl), var: +m[2], info: (look.seq || {})[cl.name] }); }
    for (const l of Object.values(byId)) l.sort((x, y) => x.var - y.var);
    const p = { id, look, g, model: gltf.scene, gltf, mixer, acts, byId, cur: null, curAct: null, level: look.level };
    const again = (e) => {
      if (e.action !== p.curAct) return;
      if (p.cur === 'stand') { p.cur = null; play(p, 'stand'); }           // stand: pick the next idle variation when one ends
      else if (e.type === 'finished' && p.after) { const n = p.after; p.after = null; play(p, n, 0.3); }      // a one-off emote: back to what it was doing
    };
    mixer.addEventListener('loop', again); mixer.addEventListener('finished', again);
    return p;
  }
  window.innPickHero = async (i) => {   // Esc > Settings > Choose Character
    window.__heroPick = i; try { localStorage.setItem('innHero', i); } catch (e) { /* storage off */ }
    const np = await makePerson('hero'), old = hero.p; scene.add(np.g); if (old) scene.remove(old.g); hero.p = np; play(np, 'stand');
  };
  const dur = (p, name) => { const l = p.byId[ANIM[name]]; return l && l[0].info ? l[0].info.dur / 1000 : 0.4; };
  // WoW animation ids: 0 Stand, 4 Walk, 5 Run, 11/12 ShuffleLeft/Right, 13 Walkbackwards, 37 JumpStart, 38 Jump, 39 JumpEnd, 40 Fall, 97 SitGround, 103 SitChairMed
  // (AnimationData.dbc ids; the bake keeps every unarmed one, see vanilla_agents/assets/bake.py ANIM_IDS)
  const ANIM = { stand: 0, death: 1, stop: 3, walk: 4, run: 5, wound: 8, left: 11, right: 12, back: 13, stun: 14, ready: 25, jumpstart: 37, jump: 38, jumpend: 39, fall: 40,
    loot: 50, castready: 51, cast: 54, castdir: 53, roar: 74, battleroar: 55, talk: 60, eat: 61, work: 62, use: 63, exclaim: 64, question: 65, bow: 66, wave: 67, cheer: 68,
    dance: 69, laugh: 70, rude: 73, kneel: 75, kiss: 76, cry: 77, chicken: 78, beg: 79, applaud: 80, shout: 81, flex: 82, shy: 83, point: 84,
    sitdown: 96, sitground: 97, standup: 98, sleepdown: 99, sleep: 100, sleepup: 101, sit: 103, salute: 113, kneelstart: 114, kneelloop: 115, kneelend: 116,
    sneak: 120, readstart: 128, read: 123, readend: 129, channel: 125, sprint: 143, yes: 185, no: 186, landrun: 187, train: 195 };
  // one-off animations (then back to what it was doing); everything else loops. LOOP = emotes that keep going until you move.
  const ONCE = new Set(['jumpstart', 'jumpend', 'landrun', 'sitdown', 'standup', 'sleepdown', 'sleepup', 'kneelstart', 'kneelend', 'readstart', 'readend', 'stop',
    'bow', 'wave', 'cheer', 'laugh', 'point', 'yes', 'no', 'exclaim', 'question', 'rude', 'roar', 'battleroar', 'kiss', 'cry', 'chicken', 'beg', 'applaud', 'shout',
    'flex', 'shy', 'salute', 'eat', 'loot', 'castdir', 'cast', 'death']);
  const LOOP = new Set(['dance', 'train', 'sleep', 'sitground', 'kneel', 'kneelloop', 'read', 'talk', 'work', 'channel', 'sneak', 'use']);
  ctx.emoteNames = [...Object.keys(ANIM)].filter((n) => ONCE.has(n) || LOOP.has(n)).filter((n) => !/^(jump|land|stand|stop|sitdown|sleepdown|sleepup|kneelstart|kneelend|readstart|readend|death|castdir|cast)/.test(n)).concat(['sit']);
  function pickStand(list) {   // variations of Stand are chosen by their frequency, like the game
    const w = list.map((e) => Math.max(0, (e.info && e.info.freq) || 0)), tot = w.reduce((a, b) => a + b, 0);
    if (!tot) return list[0]; let r = Math.random() * tot; for (let i = 0; i < list.length; i++) { r -= w[i]; if (r < 0) return list[i]; } return list[0];
  }
  function play(p, name, fade = 0.25) {
    if (p.cur === name) return;
    const list = p.byId && p.byId[ANIM[name]]; let pick = null;
    if (list && list.length) pick = name === 'stand' ? pickStand(list) : list[0]; else if (p.acts[name]) pick = { act: p.acts[name] };
    if (!pick) return;
    const next = pick.act;
    if (next === p.curAct && next.isRunning()) { p.cur = name; return; }
    if (next === p.curAct) {      // the same one-off Stand variation picked again after it ended: restart it (else the hero stands frozen on its last frame)
      next.reset(); next.setLoop(ONCE.has(name) || (name === 'stand' && pick.var > 0) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); next.clampWhenFinished = ONCE.has(name); next.play();
      p.cur = name; return;
    }
    next.reset(); next.setLoop(ONCE.has(name) || (name === 'stand' && pick.var > 0) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); next.clampWhenFinished = ONCE.has(name); next.play();
    const f = pick.info && pick.info.blend != null ? pick.info.blend / 1000 : fade;   // M2 blendTimeIn of the sequence we fade into
    if (p.curAct) p.curAct.crossFadeTo(next, f, false);
    p.cur = name; p.curAct = next;
  }
  function emote(p, name, back, force) {
    if (!p || (!force && ws.reducedMotion()) || !p.byId[ANIM[name]]) return false;
    p.after = LOOP.has(name) ? null : back || (p.cur && !ONCE.has(p.cur) ? p.cur : 'stand'); p.cur = null; play(p, name, 0.2); return true;
  }
  // model forward is -z in the baked files; yaw = heading (atan2(dx, dz)) so add PI
  const face = (p, yaw) => { p.g.rotation.y = yaw + Math.PI; };

  const statics = new Map();      // desk and chair: parsed once, cloned per desk (no hitch when someone sits down)
  async function staticModel(path) { if (!statics.has(path)) statics.set(path, loadModel(path).then((gl) => gl.scene)); return (await statics.get(path)).clone(); }
  async function makeStation(spot, agentId, i) {
    const g = new THREE.Group(); place(g, [spot.x, spot.y, spot.z], THREE.MathUtils.radToDeg(spot.yaw));
    const parts = {}, own = spot.screens && spot.screens.length;      // V-047: your office's own PC here: only the chair, the page goes on its screen(s)
    for (const name of own ? ['chair'] : ['desk', 'chair']) { const m = await staticModel(c.models[name]); place(m, c.layout[name].pos, c.layout[name].rot, c.layout[name].scale || 1); g.add(m); }
    let mon;
    if (own) mon = { paint: (h, l, cur) => { for (const sc of spot.screens) sc.paint(h, l, cur); } };
    else {
      mon = makeMonitor({ ...c.monitor, text: c.monitor.bezel }); place(mon.group, c.layout.monitor.pos, c.layout.monitor.rot); g.add(mon.group);
      const kb = makeKeyboard([0.5, 0.03, 0.18]); place(kb, [0, 0.93, 1.02], 0); g.add(kb);
    }
    scene.add(g);
    return { id: agentId, group: g, mon, spot, parts, shown: 0, sig: '', amount: 0 };
  }

  // ---- laptops at the tables: a working helper takes a seat at a table, opens a laptop and types; the screen is a white page that
  // fills with what it is doing. (No laptop model in the game: built here from boxes; the page is a canvas like the desk monitors.)
  const LAP = { w: 0.34, d: 0.24, base_h: 0.018, lid_h: 0.22, open: 1.83, reach: 0.46 };
  const lapMat = new THREE.MeshLambertMaterial({ color: '#2b2b30' }), lapKeys = new THREE.MeshLambertMaterial({ color: '#141416' });
  function pagePainter(canvas) {
    const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    return (head, lines, cursor) => {
      g.fillStyle = '#f6f3ea'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#d9d3c4'; g.fillRect(0, 0, W, 22);
      g.fillStyle = '#5a5246'; g.font = '800 14px Nunito, Arial, sans-serif'; g.textBaseline = 'middle'; g.fillText(head.slice(0, 40), 10, 11);
      g.font = '800 19px Nunito, Arial, sans-serif'; g.textBaseline = 'alphabetic';
      let y = 50;
      for (const l of lines.slice(-7)) { g.fillStyle = l.dim ? '#8a8478' : '#1d1b18'; const txt = l.text.replace(/^[$>] /, ''); g.fillText(txt.length > 30 ? txt.slice(0, 29) + '…' : txt, 12, y); y += 24; }
      if (cursor) { g.fillStyle = '#1d1b18'; const last = lines.length ? lines[lines.length - 1].text.replace(/^[$>] /, '') : ''; g.fillRect(12 + Math.min(g.measureText(last.slice(0, 30)).width + 3, W - 24), y - 40, 10, 3); }
    };
  }
  function makeLaptop(seat, agentId, sitOnTable) {
    const t = seat.table, g = new THREE.Group(); g.position.set(seat.x, seat.y, seat.z); g.rotation.y = seat.yaw;      // +z points at the table
    const reach = Math.hypot(t.x - seat.x, t.z - seat.z), dist = Math.min(LAP.reach, reach * 0.62), top = (t.top || seat.y + 0.75) - seat.y;
    const lapZ = sitOnTable ? Math.min(dist + 0.42, reach + 0.25) : dist;     // a gnome sits where the laptop would be; it goes further in, facing him
    const lap = new THREE.Group(); lap.position.set(0, top + 0.004, lapZ); g.add(lap);
    const base = new THREE.Mesh(new THREE.BoxGeometry(LAP.w, LAP.base_h, LAP.d), lapMat); base.position.y = LAP.base_h / 2; lap.add(base);
    const keys = new THREE.Mesh(new THREE.PlaneGeometry(LAP.w * 0.86, LAP.d * 0.5), lapKeys); keys.rotation.x = -Math.PI / 2; keys.position.set(0, LAP.base_h + 0.001, -LAP.d * 0.12); lap.add(keys);
    const hinge = new THREE.Group(); hinge.position.set(0, LAP.base_h, LAP.d / 2); lap.add(hinge);       // at the far edge; the lid swings up toward the helper
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 208;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(LAP.w * 0.92, LAP.lid_h * 0.9), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
    screen.rotation.x = Math.PI / 2; screen.rotation.z = Math.PI; screen.position.set(0, -0.003, -LAP.lid_h / 2); hinge.add(screen);         // faces down onto the keys when shut
    const shell = new THREE.Mesh(new THREE.BoxGeometry(LAP.w, 0.006, LAP.lid_h), lapMat); shell.position.set(0, 0.001, -LAP.lid_h / 2); hinge.add(shell);
    scene.add(g);
    const paint = pagePainter(canvas);
    return { id: agentId, group: g, laptop: true, hinge, lid: 0, spot: seat, shown: 0, sig: '', amount: 0,
      char: sitOnTable ? { pos: [0, top + 0.006, Math.max(0.12, dist - 0.08)], rot: 180, onTable: true } : { pos: [0, 0.02, 0], rot: 180 }, mon: { paint: (h, l, c2) => { paint(h, l, c2); tex.needsUpdate = true; } } };
  }
  const shutting = new Set();
  function dropLaptop(st) {
    if (!st || !st.laptop) return;
    st.closing = true; st.spot.taken = null; shutting.add(st);
    setTimeout(() => { shutting.delete(st); scene.remove(st.group); st.group.traverse((o) => { if (o.material && o.material.map) o.material.map.dispose(); }); }, 900);
  }

  // ---- agents ----
  function screenText(s, a) {
    const h = hist[s.id] || [], working = a && a.state === 'working';
    return { head: ((a && a.role) || s.id) + (s.level ? ' (Lv ' + s.level + ')' : '') + (working ? ' - working' : ' - waiting'),
      lines: h.length ? h.map((t, i) => ({ text: t, dim: i < h.length - 1 })) : [{ text: '-- waiting for a job --', dim: true }], cursor: working };
  }
  const R = rng(7);
  function pickIdle(v, a) {
    const r = R();
    if (barmaid(v.id)) {
      const busy = [...villagers.values()].filter((o) => o !== v && o.p && o.st && o.st.laptop && o.stage === 'work' && o !== v.served);
      const o = busy.length ? busy[Math.floor(R() * busy.length)] : null;
      if (o) {
        const sp = o.st.spot, side = R() < 0.5 ? 1 : -1, x = sp.x + Math.cos(sp.yaw) * 0.75 * side, z = sp.z - Math.sin(sp.yaw) * 0.75 * side;
        const n = nearestFree(x, z, sp.y, 8);
        if (n >= 0) { const [gx, gz] = cellXZ(n); v.served = o; v.goal = { x: gx, z: gz, y: nav.y[n], kind: 'chat', with: o, serve: true }; v.path = findPath(v.p.g.position, v.goal); v.stage = v.path ? 'go' : 'wait'; v.timer = 4 + R() * 4; return; }
      }
    }
    v.activity = null; v.anvilSlot = null;
    if (v.checking && !ws.reducedMotion()) {   // V-043: the checker is testing its quest: hammer at the anvil (none here: right where it stands)
      const at = nearProp(props.anvil, v.p.g.position), n = at ? anvilSpot(v, at, gy(at.x, at.z, v.p.g.position.y)) : -1;
      if (n >= 0) { const [x, z] = cellXZ(n); v.goal = { x, z, y: nav.y[n], kind: 'anvil', at }; v.path = findPath(v.p.g.position, v.goal); v.stage = v.path ? 'go' : 'arrive'; }
      else { v.goal = { x: v.p.g.position.x, z: v.p.g.position.z, y: v.p.g.position.y, kind: 'anvil', at: null }; v.path = null; v.stage = 'arrive'; }
      v.timer = 1e9; return;
    }
    if (waitingFor(v, a) && board) {   // handed in or asking you something: wait at the quest board until you answer
      const n = nearestFree(board.x + Math.sin(board.yaw || 0) * 1.4 + (R() - 0.5), board.z + Math.cos(board.yaw || 0) * 1.4 + (R() - 0.5), board.y, 6);
      if (n >= 0) { const [x, z] = cellXZ(n); v.goal = { x, z, y: nav.y[n], kind: 'board' }; v.path = findPath(v.p.g.position, v.goal); v.stage = v.path ? 'go' : 'wait'; v.timer = v.path ? 1e9 : 30; return; }
    }
    if (v.contestQ && !outranks(v, a)) {     // V-047: competing on a quest: to the contest table, laptop open, until the owner picks or stops
      const s = contestSeat(v);
      if (s) { s.taken = v.id; v.st = makeLaptop(s, v.id, onTable(v.p)); v.st.contest = v.contestQ; v.wantDesk = true; v.goal = { x: s.x, z: s.z, y: s.y, kind: 'contest' }; v.path = findPath(v.p.g.position, v.goal); v.stage = v.path ? 'togo' : 'arrive'; v.timer = 1e9; return; }
    }
    const seat = seats.filter((s) => !s.taken);
    if (r < 0.5 && seat.length && !barmaid(v.id)) { const s = seat[Math.floor(R() * seat.length)]; s.taken = v.id; v.seat = s; v.goal = { x: s.x, z: s.z, kind: 'sit', y: s.y }; }
    else if (r < 0.62 && fire) v.goal = { x: fire.x + (R() - 0.5) * 2, z: fire.z + (R() - 0.5) * 2, y: 0, kind: 'stand' };
    else {
      const others = [...villagers.values()].filter((o) => o !== v && o.p);
      if (r < 0.85 && others.length) { const o = others[Math.floor(R() * others.length)]; v.goal = { x: o.p.g.position.x + (R() - 0.5) * 2.2, z: o.p.g.position.z + (R() - 0.5) * 2.2, y: o.p.g.position.y, kind: 'chat', with: o }; }
      else { const i = Math.floor(R() * nav.ok.length); if (free(i)) { const [x, z] = cellXZ(i); v.goal = { x, z, y: nav.y[i], kind: 'stand' }; } else v.goal = { x: v.p.g.position.x, z: v.p.g.position.z, y: v.p.g.position.y, kind: 'stand' }; }
    }
    v.path = v.goal ? findPath(v.p.g.position, v.goal) : null; v.stage = v.path ? 'go' : 'wait'; v.timer = INN.stay_s[0] + R() * (INN.stay_s[1] - INN.stay_s[0]);
  }
  function leaveSeat(v) { if (v.seat) { v.seat.taken = null; v.seat = null; } }
  function toStation(v, st) { // reparent into the desk group at the character's layout spot (a laptop seat: in the chair, facing the table)
    const L = st.char || c.layout.character; st.group.add(v.p.g); v.p.g.position.set(...L.pos); v.p.g.rotation.set(0, THREE.MathUtils.degToRad(L.rot), 0); v.station = st; v.stage = 'work';
    v.p.cur = null; play(v.p, L.onTable ? 'sitground' : 'sit', 0.2); v.typing = makeTyping(v.p.model, c.typing, hash(v.id) % 97 + 1);
  }
  function fromStation(v) {
    const wp = v.p.g.getWorldPosition(new THREE.Vector3()); scene.add(v.p.g); v.p.g.position.copy(wp); v.p.g.rotation.set(0, 0, 0);
    if (v.station && !v.station.laptop) { v.station.spot.used = null; v.station.agent = null; }
    putSack(v); dropLaptop(v.st || v.station); v.station = null; v.typing = null; v.st = null; v.wantDesk = false; v.stage = 'wait'; v.timer = 0;
  }
  async function sync(now) {
    const ids = new Set(now.map((a) => a.id));
    for (const a of now) {
      let v = villagers.get(a.id);
      if (!v) {
        v = { id: a.id, p: null, stage: 'loading', timer: 0, path: null, instant: !ready }; villagers.set(a.id, v);
        makePerson(a.id).then((p) => {
          v.p = p; scene.add(p.g); const spawn = doorSpot();
          p.g.position.set(spawn.x, spawn.y, spawn.z); play(p, 'stand'); v.stage = 'wait'; v.timer = 0;
        }).catch((e) => console.warn('inn person', e));
      }
    }
    for (const [id, v] of villagers) if (!ids.has(id)) { if (v.mark) scene.remove(v.mark); putSack(v); leaveSeat(v); if (v.station || v.st) fromStation(v); if (v.p) scene.remove(v.p.g); villagers.delete(id); }
  }
  const doorSpot = () => {        // a few metres from you, never on top of you (ponytail: the real door is not located yet)
    for (let k = 0; k < 12; k++) { const a = R() * 6.283, d = 2.5 + R() * 3.5, i = nearestFree(hero.x + Math.sin(a) * d, hero.z + Math.cos(a) * d, hero.y, 4); if (i >= 0) { const [x, z] = cellXZ(i); if (Math.hypot(x - hero.x, z - hero.z) > 1.8) return { x, z, y: nav.y[i] }; } }
    const i = nearestFree(hero.x + (R() - 0.5) * 6, hero.z + (R() - 0.5) * 6, hero.y, 30); const [x, z] = i >= 0 ? cellXZ(i) : [hero.x, hero.z]; return { x, z, y: i >= 0 ? nav.y[i] : hero.y }; };   // ponytail: real door not located yet

  // ---- errands: what a working helper does tells it where to go for a moment (reading -> a bookshelf, committing -> the crates,
  // thinking a long while -> the fire), then it walks back to its desk. Waiting for you (quest handed in) -> it stands at the quest board.
  // V-043: tests and builds (and the checker testing its quest) -> it hammers at the anvil, as long as test commands keep coming (TK.hold_s);
  // committing / pushing / packaging -> it carries a sack to the crates; asking you something -> it waits at the quest board.
  const ERRAND = { read: /^(Read|Grep|Glob|LS|WebFetch|WebSearch)\b/ };
  const waitingFor = (v, a) => !!(a && (a.waiting || a.needs)) || (v.force && v.force.kind === 'wait');
  const testing = (v, t) => v.checking || t - (v.testAt ?? -1e9) < TK.hold_s;
  // every frame: what its latest step was (a new tool call = new actions count), whether the checker is testing its quest, a passed check = a cheer
  function noteTask(v, a, t) {
    if (!a) return;
    const f = v.force && t < v.force.until ? v.force : (v.force = null);
    const sig = a.actions + '|' + a.activity;
    if (sig !== v.taskSig) {
      v.taskSig = sig; const k = taskKind(a.activity);
      if (k) { v.kindNow = k; v.kindAt = t; if (k === 'test') v.testAt = t; } else if (!/^using Bash\b/.test(a.activity || '')) v.kindNow = null;
    }
    if (v.kindNow === 'test' && /^using Bash\b/.test(a.activity || '')) v.testAt = t;     // the next command is still running: stay at the anvil
    if (f && f.kind === 'test') v.testAt = t;
    if (f && f.kind === 'ship' && !f.done) { f.done = true; v.kindNow = 'ship'; v.kindAt = t; v.errandAt = -99; }
    const q = questChecks(state.tasks, a.id);
    if (q.running) { if (!v.checkSince) v.checkSince = t; } else v.checkSince = 0;
    v.checking = (q.running && t - v.checkSince < 900) || !!(f && f.kind === 'check');       // a check that never finished stops counting after 15 min
    if (v.passSeen !== undefined && q.passed > v.passSeen) cheer(v, t);
    v.passSeen = q.passed;
  }
  function cheer(v, t) {        // once per success, even when the quest and its checks report it in the same moment
    if (!v.p || t - (v.cheerAt ?? -99) < 5 || v.stage === 'work') return;
    if (emote(v.p, 'cheer')) v.cheerAt = t;
  }
  function errandFor(v, a, t) {
    if (!a) return null;
    if (a.activity !== v.lastAct) { v.lastAct = a.activity; v.actAt = t; }
    if (testing(v, t) && t - (v.backAt ?? -99) > TK.back_s) return 'anvil';
    if (!a.activity || t - (v.errandAt || -99) < 40) return null;                 // not every tool call: at most one errand every 40 s
    if (v.kindNow === 'ship' && v.shipSeen !== v.kindAt && props.crate.length) { v.shipSeen = v.kindAt; return 'crate'; }
    if (ERRAND.read.test(a.activity) && props.read.length) return 'read';
    // thinking it over by the fire: quiet for 45 s between tool calls (never while a command runs: "using Bash" = a build or test going), once per 5 min
    if (fire && t - v.actAt > 45 && !/^using /.test(a.activity) && t - (v.fireAt ?? -999) > 300) { v.fireAt = t; return 'fire'; }
    return null;
  }
  // a place at the anvil's edge (a forge hearth can be metres wide): the first helper stands at the nearest free spot, the next ones beside it
  function anvilSpot(v, at, y) {
    const n0 = nearestFree(at.x, at.z, y, 14); if (n0 < 0) return -1;
    const [x0, z0] = cellXZ(n0), r = Math.hypot(x0 - at.x, z0 - at.z) + 0.25, base = Math.atan2(x0 - at.x, z0 - at.z), step = Math.max(0.5, 1.1 / Math.max(r, 0.5));
    const used = new Set([...villagers.values()].filter((o) => o !== v && o.anvilSlot != null).map((o) => o.anvilSlot));
    let slot = 0; while (used.has(slot)) slot++; v.anvilSlot = slot;
    const ang = base + (slot % 2 ? 1 : -1) * Math.ceil(slot / 2) * step;          // 0, then one side, then the other
    const n = slot ? nearestFree(at.x + Math.sin(ang) * r, at.z + Math.cos(ang) * r, y, 6) : n0;
    return n >= 0 ? n : n0;
  }
  // ---- V-047: competing fixes (V-045): every helper competing on one quest sits at one shared table (the largest with enough free seats),
  // laptops open, facing each other, until the owner picks a winner (it cheers, the others applaud) or stops the competition.
  // Priority: the checker at the anvil and "needs you" at the quest board come first; contest seating beats idle wandering.
  const contestTables = new Map();      // quest id -> table
  const outranks = (v, a) => (v.checking && !ws.reducedMotion()) || (waitingFor(v, a) && !!board);
  const seatsAt = (t) => seats.filter((q) => q.table === t);
  const idleSitter = (q) => { const o = q.taken && villagers.get(q.taken); return o && o.seat === q && !o.contestQ ? o : null; };   // just sitting there: makes room
  function pickContestTable(need) {
    const used = new Set(contestTables.values());
    const c = tables.filter((t) => !used.has(t)).map((t) => { const at = seatsAt(t); return { t, n: at.length, free: at.filter((q) => !q.taken || idleSitter(q)).length }; }).filter((x) => x.n >= 2 && x.free >= 2);
    const fits = (x) => (x.free >= need ? 1 : 0);        // seats for every competitor first; among those the largest table, else the most free seats
    c.sort((x, y) => fits(y) - fits(x) || (fits(x) ? (y.t.area || 0) - (x.t.area || 0) : y.free - x.free) || (y.t.area || 0) - (x.t.area || 0));
    return c.length ? c[0].t : null;
  }
  function stepContests(list) {
    const want = new Map();
    for (const a of list) if (a.contest && !a.remote) want.set(a.contest, (want.get(a.contest) || 0) + 1);
    for (const q of [...contestTables.keys()]) if (!want.has(q)) contestTables.delete(q);
    for (const [q, n] of want) if (!contestTables.has(q)) {
      const task = (state.tasks || []).find((t) => t.id === q), tries = (task && task.contest && task.contest.tries) || 2;
      const t = pickContestTable(Math.max(n, Number(tries) || 2)); if (t) contestTables.set(q, t);
    }
  }
  function contestSeat(v, peek) {        // its seat at the contest table (nearest free one; an idle sitter makes room), or null
    const t = v.contestQ && contestTables.get(v.contestQ); if (!t || !v.p) return null;
    const at = seatsAt(t), mine = at.find((q) => q.taken === v.id); if (mine) return mine;
    const pos = v.p.g.position, near = (l) => l.sort((x, y) => Math.hypot(x.x - pos.x, x.z - pos.z) - Math.hypot(y.x - pos.x, y.z - pos.z))[0];
    const free = near(at.filter((q) => !q.taken)); if (free) return free;
    const q = near(at.filter(idleSitter)); if (!q || peek) return q || null;
    const o = idleSitter(q); leaveSeat(o); o.timer = 0; return q;
  }
  function contestOver(v, q) {          // the competition closed: stand up; the winner cheers, the others applaud
    const task = (state.tasks || []).find((x) => x.id === q), winner = task && task.contest && task.contest.winner;
    if (v.st && v.st.contest) fromStation(v);
    const name = winner ? (winner === v.id ? 'cheer' : 'applaud') : null;
    if (name && v.p && emote(v.p, name, 'stand')) { const d = dur(v.p, name); v.waitT = d; v.timer = Math.max(v.timer || 0, d); if (name === 'cheer') v.cheerAt = clock.elapsedTime; }
  }
  function nearProp(list, from) { let best = null, bd = 1e9; for (const q of list) { const d = Math.hypot(q.x - from.x, q.z - from.z); if (d < bd) { bd = d; best = q; } } return best; }
  // the sack (the game's sack doodad, TUNE.bag) in the right hand while it walks to the crates; put down there, gone a little later
  let sackProto = null;
  // the right hand: down the arm from key bone 1 (ArmR) to the bone the fingers hang from (or the end of the arm). Skeletons differ per race, so
  // the sack is not parented to the bone (its axes differ too) but hangs below the hand's world position every frame.
  function handBone(model) {
    let node = boneByKey(model, TUNE.bag.bone.key, 0);
    for (let d = 0; node; d++) { const kids = node.children.filter((c) => c.isBone); if ((d >= 1 && kids.length >= 3) || !kids.length) return node; node = kids[0]; }
    return null;
  }
  function holdSack(v) {
    if (!sackProto || !v.p || v.sack) return;
    const hand = handBone(v.p.model); if (!hand) return;
    v.sack = sackProto.clone(); v.sackHand = hand; scene.add(v.sack); stepSack(v);
  }
  function stepSack(v) {
    if (!v.sack || !v.sackHand) return;
    const w = v.sackHand.getWorldPosition(v.sack.position); w.y -= TUNE.bag.h * 0.8; v.sack.rotation.set(0, v.p.g.rotation.y, 0);
  }
  function putSack(v, keepS) {
    const bag = v.sack; if (!bag) return; v.sack = null; v.sackHand = null;
    if (!keepS || !v.p) { bag.removeFromParent(); return; }
    const p = v.p.g.position, fwd = v.p.g.getWorldDirection(new THREE.Vector3()).multiplyScalar(-0.45);       // model forward is -z
    bag.rotation.set(0, R() * 6.28, 0); bag.position.set(p.x + fwd.x, p.y + 0.01, p.z + fwd.z);
    setTimeout(() => bag.removeFromParent(), keepS * 1000);
  }
  function startErrand(v, kind, t) {
    const p = v.p, wp = p.g.getWorldPosition(new THREE.Vector3());
    let at = kind === 'fire' ? fire : nearProp(props[kind], wp), stand = null;
    if (kind === 'anvil' && !at) {         // no anvil in this building: stand up by its laptop or desk and work there
      const sp = v.st && v.st.spot; if (!sp) return;
      if (v.st.laptop) { const t2 = sp.table || { x: sp.x + Math.sin(sp.yaw), z: sp.z + Math.cos(sp.yaw) }, d = Math.hypot(t2.x - sp.x, t2.z - sp.z) || 1; at = { x: t2.x, z: t2.z }; stand = { x: sp.x - (t2.x - sp.x) / d * 0.5, z: sp.z - (t2.z - sp.z) / d * 0.5 }; }
      else { at = { x: sp.x, z: sp.z }; stand = { x: sp.x + Math.sin(sp.yaw) * 1.2, z: sp.z + Math.cos(sp.yaw) * 1.2 }; }
    }
    if (!at) return;
    scene.add(p.g); p.g.position.copy(wp); p.g.rotation.set(0, 0, 0); v.typing = null;
    const n = kind === 'anvil' && !stand ? anvilSpot(v, at, gy(at.x, at.z, wp.y)) : nearestFree(stand ? stand.x : at.x, stand ? stand.z : at.z, wp.y, stand ? 12 : 6);
    if (n < 0 && stand) { v.errand = { kind, x: at.x, z: at.z }; v.errandAt = t; v.path = null; v.stage = 'arrive'; v.goal = { kind: 'errand' }; return; }   // boxed in by furniture: work right where it stood up
    if (n < 0) { v.backAt = t; toStation(v, v.st); return; }
    const [x, z] = cellXZ(n); v.errand = { kind, x: at.x, z: at.z }; v.errandAt = t;
    v.path = findPath(p.g.position, { x, z, y: nav.y[n] }); v.stage = v.path ? 'go' : 'arrive'; v.goal = { kind: 'errand' };
    if (kind === 'crate') holdSack(v);
  }
  function backToDesk(v) {
    const spot = v.st && v.st.spot, was = v.errand && v.errand.kind; v.errand = null;
    if (was === 'crate') putSack(v, 12);
    if (was === 'anvil') { v.backAt = clock.elapsedTime; v.anvilSlot = null; }
    if (v.p) { v.p.after = null; v.p.cur = null; play(v.p, was === 'fire' ? 'standup' : was === 'read' ? 'readend' : 'stand'); v.waitT = was === 'fire' ? dur(v.p, 'standup') : was === 'read' ? dur(v.p, 'readend') : 0; }
    if (!spot) { v.wantDesk = false; v.stage = 'wait'; v.timer = 0; return; }
    const [tx, tz] = v.st.laptop ? [spot.x, spot.z] : [spot.x + Math.sin(spot.yaw) * 1.7, spot.z + Math.cos(spot.yaw) * 1.7]; v.path = findPath(v.p.g.position, { x: tx, z: tz, y: spot.y }); v.stage = v.path ? 'togo' : 'arrive';
  }
  // helpers quiet for a long time fade to ghosts (they come back when they do something)
  const GHOST_S = 15 * 60;
  function setGhost(v, on) {
    if (v.ghost === on || !v.p) return; v.ghost = on;
    v.p.g.traverse((o) => {
      if (!o.isMesh) return;
      if (on) { o.userData.solid = o.material; o.material = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => { const g = m.clone(); g.transparent = true; g.opacity = 0.4; g.color && g.color.lerp(new THREE.Color('#9fd8ff'), 0.5); g.depthWrite = false; return g; }); if (o.material.length === 1) o.material = o.material[0]; }
      else if (o.userData.solid) { o.material = o.userData.solid; delete o.userData.solid; }
    });
  }

  // V-039: a resurrected helper's session came back: a column of golden light rises around it, it stops being a ghost and cheers
  const revives = [], revSeen = new Set();
  const glowTex = (w, h, paint) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; paint(cv.getContext('2d'), w, h); const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; return tx; };
  let REV_TEX = null;
  function revTextures() {
    if (!REV_TEX) REV_TEX = {
      column: glowTex(4, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }),
      spark: glowTex(32, 32, (g) => { const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,240,190,0.8)'); gr.addColorStop(1, 'rgba(255,220,140,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); }),
    };
    return REV_TEX;
  }
  function startRevive(v) {
    if (!v.p) return;
    setGhost(v, false);
    const tex = revTextures(), g = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 3.2, 28, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffe3a0', map: tex.column, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    col.position.y = 1.6; g.add(col);
    const n = 48, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 * 3, r = 0.45 + (i % 3) * 0.1; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = (i / n) * 1.6; pos[i * 3 + 2] = Math.sin(a) * r; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sparks = new THREE.Points(pg, new THREE.PointsMaterial({ color: '#fff4c8', map: tex.spark, size: 0.12, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    g.add(sparks);
    scene.add(g);
    revives.push({ v, g, col, sparks, age: 0 });
    if (!ws.reducedMotion()) emote(v.p, 'cheer', v.p.cur || 'stand', true);
  }
  function stepRevives(dt) {         // frame time (capped), so a slow PC still shows the whole effect
    for (let i = revives.length - 1; i >= 0; i--) {
      const r = revives[i], life = 2.4, age = (r.age += dt);
      if (age > life || !r.v.p) { scene.remove(r.g); r.col.geometry.dispose(); r.col.material.dispose(); r.sparks.geometry.dispose(); r.sparks.material.dispose(); revives.splice(i, 1); continue; }
      const k = Math.sin(Math.PI * age / life);
      r.g.position.copy(r.v.p.g.getWorldPosition(tmp));
      r.col.material.opacity = 0.5 * k; r.col.scale.set(1 - 0.3 * age / life, 0.3 + 0.7 * Math.min(1, age * 1.5), 1 - 0.3 * age / life);
      r.sparks.material.opacity = k; r.sparks.position.y = age * 1.4; r.sparks.rotation.y = age * 2.5;
    }
  }

  // V-026: a "!" over a helper that needs you (permission, a question, waiting for your input), a grey "..." over one the service stopped
  const MARKS = {};
  function markTexture(kind) {
    if (MARKS[kind]) return MARKS[kind];
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
    g.font = '900 104px Nunito, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = '#000'; const ch = kind === 'needs' ? '!' : '…';
    g.strokeText(ch, 64, 68); g.fillStyle = kind === 'needs' ? '#ffd100' : '#a8a8b0'; g.fillText(ch, 64, 68);
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; return (MARKS[kind] = tx);
  }
  function setMark(v, kind, t) {
    if (!v.p) return;
    if (!kind) { if (v.mark) v.mark.visible = false; return; }
    if (!v.mark) { v.mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: markTexture(kind), depthTest: false, transparent: true })); v.mark.scale.set(0.45, 0.45, 1); v.mark.renderOrder = 10; scene.add(v.mark); }
    if (v.mark.material.map !== markTexture(kind)) { v.mark.material.map = markTexture(kind); v.mark.material.needsUpdate = true; }
    const head = v.p.g.getWorldPosition(tmp); v.mark.position.set(head.x, head.y + 2.35 + Math.sin(t * 3) * 0.06, head.z); v.mark.visible = true;
  }

  function stepVillager(v, a, dt, t) {
    const p = v.p; if (!p || !ready) return;
    // V-028: "Follow me" (talk window): an idle helper walks after you until you say stop or it gets work
    if (v.follow && a && a.state !== 'working' && !v.errand && v.stage !== 'work') {
      const d = Math.hypot(hero.x - p.g.position.x, hero.z - p.g.position.z);
      if (d > 2.2 && (!v.path || !v.path.length || t - (v.followAt || 0) > 1.5)) { leaveSeat(v); v.followAt = t; v.goal = { x: hero.x, z: hero.z, y: hero.y, kind: 'follow' }; v.path = findPath(p.g.position, v.goal); v.stage = v.path ? 'go' : 'wait'; }
      else if (d <= 2.2 && v.stage !== 'stay') { v.path = null; v.stage = 'stay'; v.timer = 1; play(p, 'stand'); face(p, Math.atan2(hero.x - p.g.position.x, hero.z - p.g.position.z)); }
      if (v.stage === 'stay') v.timer = 1;
    }
    noteTask(v, a, t);
    const cq = (a && !a.remote && a.contest) || null;          // V-047: competing on a quest (snapshot agent.contest)
    if (cq !== (v.contestQ || null)) { const was = v.contestQ; v.contestQ = cq; if (was) contestOver(v, was); }
    setMark(v, a && a.needs ? 'needs' : a && a.stunned ? 'stunned' : null, t);
    if (a && a.stunned && v.stage !== 'work' && p.cur !== 'stun' && v.stage !== 'go' && v.stage !== 'togo') { p.cur = null; p.after = null; play(p, 'stun'); }
    const working = atWork(a);
    if (a) setGhost(v, !working && !v.checking && !!a.seen && (Date.now() / 1000 - (typeof a.seen === 'number' ? a.seen : Date.parse(a.seen) / 1000)) > GHOST_S);
    if (!working && v.errand) { fromStation(v); v.errand = null; }
    if (working && v.stage === 'work' && v.st && !ws.reducedMotion() && !state.demo) { const k = errandFor(v, a, t); if (k) startErrand(v, k, t); }
    if (working && v.errand && v.stage === 'stay' && a.activity !== v.errandAct && v.errand.kind === 'fire') backToDesk(v);   // got going again
    if (working && v.errand && v.stage === 'stay' && v.errand.kind === 'anvil' && !testing(v, t) && !(p.cur === 'cheer' && p.after)) backToDesk(v);   // no test command for a while: back to the laptop
    else if (working && v.errand && v.stage === 'stay' && v.errand.kind !== 'anvil' && v.st && testing(v, t) && t - (v.backAt ?? -99) > TK.back_s && !ws.reducedMotion()) {   // tests started while reading / thinking: straight to the anvil
      const was = v.errand.kind; putSack(v, 12); v.errand = null; startErrand(v, 'anvil', t);
      if (was === 'fire' || was === 'read') { p.cur = null; play(p, was === 'fire' ? 'standup' : 'readend'); v.waitT = dur(p, was === 'fire' ? 'standup' : 'readend'); }
    }
    if (v.contestQ && v.st && !v.st.contest && !v.errand && (v.stage === 'work' || v.stage === 'togo')) {     // V-047: already at a laptop / desk when the competition opened
      if (v.st.spot.table && v.st.spot.table === contestTables.get(v.contestQ)) v.st.contest = v.contestQ;   // already at that table: stays
      else if (contestSeat(v, true)) fromStation(v);                                                          // else moves over to it
    }
    if (working && !v.wantDesk && v.stage !== 'work') {   // go to work: a laptop at a table if a seat is free, else a desk against a wall
      leaveSeat(v);
      const cs = v.contestQ ? contestSeat(v) : null;        // V-047: competing: a seat at the contest table first
      const seat = cs || seats.filter((q) => !q.taken && q.table).sort((x, y) => Math.hypot(x.x - p.g.position.x, x.z - p.g.position.z) - Math.hypot(y.x - p.g.position.x, y.z - p.g.position.z))[0];
      let spot = seat ? null : deskSpots.find((d) => !d.used);
      if (seat) {
        seat.taken = v.id; v.st = makeLaptop(seat, v.id, onTable(p)); if (cs) v.st.contest = v.contestQ;
        v.path = findPath(p.g.position, { x: seat.x, z: seat.z, y: seat.y }); v.stage = v.path ? 'togo' : 'arrive'; v.wantDesk = true;
      } else if (spot) {
        spot.used = v.id; if (!stations.has(spot)) stations.set(spot, null);
        makeStation(spot, v.id, deskSpots.indexOf(spot)).then((st) => { v.st = st; spot.station = st; }).catch((e) => { console.error('inn station', e && e.message, e && e.stack); spot.used = null; v.wantDesk = false; });
        const [tx, tz] = [spot.x + Math.sin(spot.yaw) * 1.7, spot.z + Math.cos(spot.yaw) * 1.7]; v.path = findPath(p.g.position, { x: tx, z: tz, y: spot.y }); v.stage = v.path ? 'togo' : 'wait'; v.wantDesk = true;
      }
    }
    if (!working && v.stage === 'work' && !(v.contestQ && v.st && v.st.contest && !outranks(v, a))) { fromStation(v); }      // V-047: a competitor stays at the contest table while idle
    const idleNow = (v.stage === 'stay' || v.stage === 'wait') && !v.errand && !working && !v.follow;
    if (idleNow && v.checking && !ws.reducedMotion() && (!v.goal || v.goal.kind !== 'anvil')) v.timer = 0;            // the checker started on its quest: off to the anvil
    else if (idleNow && waitingFor(v, a) && !(v.checking && !ws.reducedMotion()) && (!v.goal || v.goal.kind !== 'board') && board) v.timer = 0;   // just handed in / asking: off to the board
    else if (idleNow && v.contestQ && !outranks(v, a) && !v.st && contestSeat(v, true)) v.timer = 0;                  // V-047: the competition opened: off to its table
    if (v.stage === 'stay' && v.goal && v.goal.kind === 'anvil' && !v.errand && !v.checking) v.timer = 0;            // checks done: back to hanging around
    if (v.stage === 'stay' && v.goal && v.goal.kind === 'board' && !v.errand) {
      if (!waitingFor(v, a) || (v.checking && !ws.reducedMotion())) v.timer = 0;                                  // you answered (or the checker took over): go back
      else if (t - (v.askAt ?? 0) > TK.ask_every_s) { v.askAt = t; emote(p, 'question', 'stand'); }               // still waiting: asks again now and then
    }
    if (v.sackT > 0 && (v.sackT -= dt) <= 0) putSack(v, 14);       // at the crates: the sack goes down while it bends over
    if (v.stage === 'work') { v.typing.undo && v.typing.undo(); p.mixer.update(dt); v.typing.apply(t, v.st ? v.st.amount : 0); return; }
    if (v.instant && (v.stage === 'go' || v.stage === 'togo') && v.path && v.path.length) {      // here before the inn opened: already in place, no walk from your feet
      const e = v.path[v.path.length - 1]; p.g.position.set(e.x, e.y, e.z); v.path = []; v.waitT = 0; v.instant = false;
    } else if (v.instant && (v.stage === 'work' || v.stage === 'stay')) v.instant = false;
    if ((v.stage === 'go' || v.stage === 'togo') && v.waitT > 0) { v.waitT -= dt; p.mixer.update(dt); return; }   // finish standing up / closing the book first
    if (v.stage === 'go' || v.stage === 'togo') {
      p.after = null; play(p, 'walk');
      const pt = v.path && v.path[0];
      if (!pt) { v.stage = v.stage === 'togo' ? 'arrive' : 'arrive'; }
      else {
        const dx = pt.x - p.g.position.x, dz = pt.z - p.g.position.z, d = Math.hypot(dx, dz), step = INN.walk_speed * dt;
        if (d <= step) { p.g.position.set(pt.x, pt.y, pt.z); v.path.shift(); } else { p.g.position.x += dx / d * step; p.g.position.z += dz / d * step; p.g.position.y = gy(p.g.position.x, p.g.position.z, p.g.position.y); face(p, Math.atan2(dx, dz)); }
      }
    }
    if (v.stage === 'arrive') {
      if (v.errand) {      // reading: open a book at the shelf; committing: rummage in the crates; thinking: sit down by the fire
        face(p, Math.atan2(v.errand.x - p.g.position.x, v.errand.z - p.g.position.z)); v.stage = 'stay'; v.timer = v.errand.kind === 'fire' ? 60 : v.errand.kind === 'anvil' ? 1e9 : 6 + R() * 4; v.errandAct = a && a.activity;
        p.cur = null;
        if (v.errand.kind === 'read') { p.after = 'read'; play(p, 'readstart'); }
        else if (v.errand.kind === 'anvil') { p.after = null; play(p, 'work'); }       // hammering (the game's EmoteWork) until the tests stop
        else if (v.errand.kind === 'crate') { p.after = 'use'; play(p, 'loot'); v.sackT = Math.max(0.2, dur(p, 'loot') * 0.45); }
        else { p.after = 'sitground'; play(p, 'sitdown'); }
      }
      else if (v.goal && v.goal.kind === 'board') { face(p, board.yaw !== undefined ? board.yaw + Math.PI : Math.atan2(board.x - p.g.position.x, board.z - p.g.position.z)); v.stage = 'stay'; p.cur = null; p.after = 'stand'; play(p, 'question'); v.askAt = t; }
      else if (v.goal && v.goal.kind === 'anvil') { const at = v.goal.at; if (at) face(p, Math.atan2(at.x - p.g.position.x, at.z - p.g.position.z)); v.stage = 'stay'; p.cur = null; p.after = null; play(p, 'work'); }
      else if (v.wantDesk) { if (v.st) toStation(v, v.st); }   // else the desk is still being built: wait here
      else if (v.goal && v.goal.kind === 'sit' && v.seat) { p.g.position.set(v.seat.x, v.seat.y + 0.02, v.seat.z); face(p, v.seat.yaw); play(p, 'sit'); v.stage = 'stay'; }
      else if (v.goal && v.goal.kind === 'chat' && v.goal.with && v.goal.with.p) { const o = v.goal.with.p.g.position; face(p, Math.atan2(o.x - p.g.position.x, o.z - p.g.position.z)); play(p, p.byId[ANIM.talk] ? 'talk' : 'stand'); v.stage = 'stay'; v.chatting = true; if (v.goal.serve) { v.timer = 3 + R() * 3; emote(p, R() < 0.5 ? 'bow' : 'question', 'talk'); } }
      else { play(p, 'stand'); v.stage = 'stay'; }
    }
    if (v.stage === 'stay' && v.chatting && R() < dt * 0.12) emote(p, ['laugh', 'yes', 'no', 'point', 'exclaim', 'question', 'shy', 'applaud'][Math.floor(R() * 8)], 'talk');      // a chat is not a statue
    if (v.stage === 'stay' && !v.seat && !v.chatting && !v.errand && juke.playing && p.cur === 'stand' && R() < dt * 0.08) { p.cur = null; p.after = null; play(p, 'dance'); }   // music on: idle helpers dance
    if (v.stage === 'stay' && p.cur === 'dance' && !juke.playing) play(p, 'stand');
    if (a && v.failed !== undefined && a.failed > v.failed && v.stage !== 'work' && !ws.reducedMotion()) { p.cur = null; p.after = 'kneelloop'; play(p, 'kneelstart'); v.kneelT = 4; }   // its quest failed the checker: down on one knee for a moment
    if (v.kneelT > 0 && (v.kneelT -= dt) <= 0) { p.cur = null; p.after = 'stand'; play(p, 'kneelend'); }
    if (a && a.failed_step && a.failed_step !== v.failedStep) { if (v.failedStep !== undefined && v.stage !== 'work') emote(p, 'no'); v.failedStep = a.failed_step; }   // a tool step failed: a shake of the head
    if (a) v.failed = a.failed;
    if (a && a.mana === 100 && v.mana !== undefined && v.mana < 100 && v.stage !== 'work') emote(p, 'eat');      // memory tidied: a drink
    if (a) v.mana = a.mana;
    if (v.stage === 'stay' && v.seat && R() < dt * 0.05) emote(p, 'eat', 'sit');
    if (a && v.passed !== undefined && a.passed > v.passed) cheer(v, t);      // its quest just passed the checker (once, see cheer())
    if (a) v.passed = a.passed;
    if ((v.stage === 'stay' || v.stage === 'wait') && !((p.cur === 'cheer' || p.cur === 'applaud') && p.after)) { v.timer -= dt; if (v.timer <= 0) { if (v.errand) backToDesk(v); else { leaveSeat(v); v.chatting = false; p.g.position.y = gy(p.g.position.x, p.g.position.z, p.g.position.y); pickIdle(v, a); } } }
    p.mixer.update(dt);
    stepSack(v);
  }

  // ---- the hero you steer ----
  // WoW controls (the client's movement speeds, yards -> metres with K): run 7 yd/s, back 4.5, walk (Shift) 2.5, keyboard turn 2.5 rad/s, jump 7.955 yd/s up, gravity 19.29 yd/s2
  const WOW = { run: 7 * K, back: 4.5 * K, walk: 2.5 * K, turn: 2.5, jump: 7.955 * K, grav: 19.29 * K };
  const hero = { p: null, x: 0, y: 0, z: 0, gnd: 0, h: 0, vy: 0, vx: 0, vz: 0, air: false, airT: 0, landT: 0, auto: false, yaw: 0, orbit: 0, camYaw: Math.PI, camPitch: 0.3, dist: 3.5 };
  const keys = {};
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test((e.target || {}).tagName) || (e.target && e.target.isContentEditable);
  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'NumLock') hero.auto = !hero.auto; else if (e.code === 'KeyW' || e.code === 'KeyS') hero.auto = false;
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat && hero.p && ready && !hero.air) keys.jumpReq = true; }
    keys[e.code] = true;
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  let drag = null, moved = 0; const btn = { l: false, r: false };
  canvas.addEventListener('mousedown', (e) => { moved = 0; if (e.button === 0) btn.l = true; if (e.button === 2) btn.r = true; if (e.button === 2 || e.button === 0) drag = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) btn.l = false; if (e.button === 2) btn.r = false; if (!btn.l && !btn.r) drag = null; });
  window.addEventListener('mousemove', (e) => {   // right drag turns the character, left drag only orbits the camera
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    if (btn.r) { hero.yaw -= dx * 0.005; hero.orbit = 0; } else hero.orbit -= dx * 0.005;
    hero.camPitch = Math.max(-1.2, Math.min(1.45, hero.camPitch + dy * 0.005));
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); hero.dist = Math.max(0, Math.min(INN.cam_max, hero.dist * (e.deltaY > 0 ? 1.12 : 0.89))); if (hero.dist < INN.cam_min) hero.dist = e.deltaY < 0 ? 0 : INN.cam_min; if (hero.dist === 0 && e.deltaY > 0) hero.dist = INN.cam_min; }, { passive: false });
  // collision like the game: you bump into the building and every doodad's own collision mesh (rays at knee, waist and head height,
  // three across your width), slide along what you hit, step up onto anything up to STEP high, fall off ledges, and can jump onto tables.
  const BODY_R = 0.32, STEP = 0.55, UP = new THREE.Vector3(0, 1, 0), dirV = new THREE.Vector3(), orig = new THREE.Vector3();
  function groundAt(x, z, y) {       // highest walkable surface at (x, z) no higher than y + STEP; null when there is none within 6 m below
    ray.set(orig.set(x, y + STEP, z), DOWN); ray.far = STEP + 6;
    for (const h of ray.intersectObject(solid || walls, true)) if (h.face && Math.abs(h.face.normal.clone().transformDirection(h.object.matrixWorld).y) > 0.5) return h.point.y;
    return null;
  }
  function wallHit(x, y, z, dx, dz, dist) {   // nearest blocking hit along (dx, dz) for a body at (x, y, z); {d, nx, nz} or null
    let best = null; const px = -dz, pz = dx;
    for (const hgt of [STEP + 0.05, 1.0, 1.65]) for (const off of [-BODY_R * 0.8, 0, BODY_R * 0.8]) {
      ray.set(orig.set(x + px * off, y + hgt, z + pz * off), dirV.set(dx, 0, dz)); ray.far = dist + BODY_R;
      const h = ray.intersectObject(solid || walls, true)[0];
      if (!h || !h.face) continue;
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      if (Math.abs(n.y) > 0.7) continue;           // floors and table tops are stood on, not bumped into
      if (!best || h.distance < best.d) { const l = Math.hypot(n.x, n.z) || 1; best = { d: h.distance, nx: n.x / l, nz: n.z / l }; }
    }
    return best;
  }
  function moveBody(sx, sz) {          // move by (sx, sz) with collision and one slide along the wall
    for (let pass = 0; pass < 2 && (sx || sz); pass++) {
      const d = Math.hypot(sx, sz); if (d < 1e-5) return;
      const dx = sx / d, dz = sz / d, h = wallHit(hero.x, hero.y, hero.z, dx, dz, d);
      const go = h ? Math.max(0, Math.min(d, h.d - BODY_R)) : d;
      hero.x += dx * go; hero.z += dz * go;
      if (!h) return;
      let rx = sx - dx * go, rz = sz - dz * go; const dot = rx * h.nx + rz * h.nz;     // what is left, along the wall
      if (dot < 0) { rx -= h.nx * dot; rz -= h.nz * dot; }
      sx = rx; sz = rz;
    }
  }
  function stepHero(dt) {
    if (!hero.p || !ready) return;
    const turn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
    hero.yaw += turn * WOW.turn * dt;
    const f = ((keys.KeyW || hero.auto || (btn.l && btn.r)) ? 1 : 0) - (keys.KeyS ? 1 : 0), sd = (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0);
    if ((f || sd || keys.jumpReq) && hero.sitting) { hero.sitting = false; hero.p.after = 'stand'; hero.p.cur = null; play(hero.p, 'standup', 0.15); hero.busyT = dur(hero.p, 'standup'); }
    if (keys.jumpReq && !hero.air) { hero.air = true; hero.airT = 0; hero.vy = WOW.jump; const m = hero.moving; hero.vx = m ? m.x : 0; hero.vz = m ? m.z : 0; hero.jumped = true; }
    keys.jumpReq = false;
    let vx = 0, vz = 0;
    if (hero.air) { vx = hero.vx; vz = hero.vz; }
    else if (f || sd) {
      const fx = Math.sin(hero.yaw), fz = Math.cos(hero.yaw), rx = -Math.cos(hero.yaw), rz = Math.sin(hero.yaw);
      let dx = fx * f + rx * sd, dz = fz * f + rz * sd; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
      const sp = f < 0 ? WOW.back : (keys.ShiftLeft || keys.ShiftRight ? WOW.walk : WOW.run);
      vx = dx * sp; vz = dz * sp;
    }
    hero.moving = vx || vz ? { x: vx, z: vz } : null;
    if (vx || vz) moveBody(vx * dt, vz * dt);
    const g = groundAt(hero.x, hero.z, hero.y);
    if (hero.air) {
      hero.airT += dt; hero.vy -= WOW.grav * dt; const ny = hero.y + hero.vy * dt;
      if (hero.vy > 0) { ray.set(orig.set(hero.x, hero.y + 1.8, hero.z), UP); ray.far = hero.vy * dt + 0.05; if (ray.intersectObject(solid || walls, true).length) hero.vy = 0; }   // head hits the ceiling
      if (g !== null && ny <= g) { hero.y = g; hero.air = false; hero.vy = 0; hero.landT = hero.moving ? dur(hero.p, 'landrun') : dur(hero.p, 'jumpend'); hero.landMoving = !!hero.moving; hero.jumped = false; }
      else hero.y = ny;
    } else if (g === null || g < hero.y - STEP) { hero.air = true; hero.airT = 0; hero.vy = 0; hero.vx = vx; hero.vz = vz; hero.jumped = false; }   // walked off an edge
    else hero.y += (g - hero.y) * Math.min(1, dt * 20);          // steps and slopes: follow the floor smoothly
    if (hero.y < (nav.minY ?? -50) - 20) { const st = nearestFree(hero.x, hero.z, 0, 40); if (st >= 0) { [hero.x, hero.z] = cellXZ(st); hero.y = nav.y[st]; hero.air = false; } }   // fell out of the world: back inside
    hero.gnd = hero.y;
    if (hero.moving || btn.r) hero.orbit *= Math.exp(-dt * 8);   // the camera swings back behind a moving character
    hero.camYaw = hero.yaw + Math.PI + hero.orbit;
    // body: strafing turns the body toward the way you go (run), backing up diagonally turns it the other way (walk backwards)
    let body = hero.yaw;
    if (!hero.air && (f || sd)) { const a = Math.atan2(-sd, f); body = f < 0 ? hero.yaw + a - Math.PI : hero.yaw + a; }   // a = where you go, left of forward
    hero.body = hero.body === undefined ? body : hero.body + Math.atan2(Math.sin(body - hero.body), Math.cos(body - hero.body)) * Math.min(1, dt * 12);
    face(hero.p, hero.body);
    let an = hero.sitting ? 'sitground' : 'stand';
    if (hero.busyT > 0) { hero.busyT -= dt; hero.p.mixer.update(dt); hero.p.g.position.set(hero.x, hero.y, hero.z); return; }
    if (hero.air) an = hero.jumped ? (hero.airT < dur(hero.p, 'jumpstart') ? 'jumpstart' : 'jump') : (hero.airT > 0.25 ? 'fall' : 'stand');
    else if (hero.landT > 0 && (!hero.moving || hero.landMoving)) { hero.landT -= dt; an = hero.landMoving ? 'landrun' : 'jumpend'; }
    else if (hero.moving) an = f < 0 ? 'back' : (keys.ShiftLeft || keys.ShiftRight) ? 'walk' : 'run';
    else if (turn && !hero.sitting) an = turn > 0 ? 'left' : 'right';        // turning on the spot: the shuffle
    if (hero.moving || hero.air || turn) { hero.emoting = null; hero.p.after = null; }
    if (!hero.emoting && !hero.p.after) play(hero.p, an, 0.15);
    hero.p.g.position.set(hero.x, hero.y, hero.z); hero.p.mixer.update(dt);
  }
  // X sits down on the floor / stands up (like the game); chat emotes play on you (/dance, /wave ...)
  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey || e.code !== 'KeyX' || !hero.p || hero.air) return;
    hero.sitting = !hero.sitting; hero.p.cur = null; hero.p.after = hero.sitting ? 'sitground' : 'stand';
    play(hero.p, hero.sitting ? 'sitdown' : 'standup', 0.15); hero.busyT = dur(hero.p, hero.sitting ? 'sitdown' : 'standup');
  });
  // talk window extras (V-028): follow me / take a break
  ctx.follow = (id, on) => { const v = villagers.get(id); if (!v) return false; v.follow = on === undefined ? !v.follow : on; if (!v.follow) { v.stage = 'wait'; v.timer = 0; } return v.follow; };
  ctx.following = (id) => !!(villagers.get(id) || {}).follow;
  ctx.takeBreak = (id) => {
    const v = villagers.get(id), a = agentsNow().find((x) => x.id === id); if (!v || !v.p || (a && a.state === 'working')) return false;
    v.follow = false; leaveSeat(v); const seat = seats.filter((q) => !q.taken).sort((x, y) => Math.hypot(x.x - v.p.g.position.x, x.z - v.p.g.position.z) - Math.hypot(y.x - v.p.g.position.x, y.z - v.p.g.position.z))[0];
    if (seat) { seat.taken = v.id; v.seat = seat; v.goal = { x: seat.x, z: seat.z, y: seat.y, kind: 'sit' }; } else if (fire) v.goal = { x: fire.x, z: fire.z, y: fire.y, kind: 'stand' };
    v.path = v.goal ? findPath(v.p.g.position, v.goal) : null; v.stage = v.path ? 'go' : 'wait'; v.timer = 90; return true;
  };
  ctx.heroEmote = (name) => {
    if (!hero.p || hero.air || hero.moving) return false;
    if (name === 'sit') { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX' })); return true; }
    if (name === 'sleep') { hero.sitting = false; hero.p.cur = null; hero.emoting = 'sleep'; hero.p.after = 'sleep'; play(hero.p, 'sleepdown', 0.2); return true; }
    if (name === 'kneel') { hero.sitting = false; hero.p.cur = null; hero.emoting = 'kneel'; hero.p.after = 'kneelloop'; play(hero.p, 'kneelstart', 0.2); return true; }
    if (!ANIM[name] || !hero.p.byId[ANIM[name]]) return false;
    hero.sitting = false; hero.emoting = LOOP.has(name) ? name : null;
    return emote(hero.p, name, 'stand', true);
  };
  const camGoal = new THREE.Vector3(), camLook = new THREE.Vector3(), cam = { pos: new THREE.Vector3(0, 5, 5), look: new THREE.Vector3() };
  let photo = null;          // photo mode (showcase pictures, window.__inn.photo): a fixed camera, you hidden
  function placeCamera(dt) {
    if (photo) { camera.position.set(...photo.pos); camera.lookAt(...photo.look); if (hero.p) hero.p.g.visible = !photo.hide; return; }
    const sel = ctx.selected && villagers.get(ctx.selected);
    if (sel && sel.p) {   // selected agent: glide to a close view of its screen (working) or of the character
      const g = sel.p.g, head = g.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.1, 0));
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(g.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
      if (sel.stage === 'work' && sel.st && sel.st.laptop) {      // laptop: over the right shoulder, looking down at the page
        const right = new THREE.Vector3(fwd.z, 0, -fwd.x), scr = sel.st.hinge.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, -0.1).add(new THREE.Vector3(0, 0.1, 0));
        camGoal.copy(head).addScaledVector(fwd, -0.55).addScaledVector(right, -0.42).add(new THREE.Vector3(0, 0.45, 0)); camLook.copy(scr);
      } else if (sel.stage === 'work') { camGoal.copy(head).addScaledVector(fwd, -1.2).add(new THREE.Vector3(0, 1.05, 0)); camLook.copy(head).addScaledVector(fwd, 0.9).add(new THREE.Vector3(0, -0.1, 0)); }   // over the shoulder, at the screen
      else { camGoal.copy(head).addScaledVector(fwd, 2.2).add(new THREE.Vector3(0, 0.5, 0)); camLook.copy(head); }
      { const d = camGoal.clone().sub(camLook), len = d.length(); const h = len > 0.01 && hit(camLook, d.normalize(), len + 0.25); if (h) camGoal.copy(camLook).addScaledVector(d, Math.max(0.35, h.distance - 0.25)); }   // never behind a wall
      const k = 1 - Math.exp(-dt * 4); cam.pos.lerp(camGoal, k); cam.look.lerp(camLook, k); camera.position.copy(cam.pos); camera.lookAt(cam.look); return;
    }
    const head = tmp.set(hero.x, hero.y + 1.7, hero.z).clone(), dir = new THREE.Vector3(Math.sin(hero.camYaw) * Math.cos(hero.camPitch), Math.sin(hero.camPitch), Math.cos(hero.camYaw) * Math.cos(hero.camPitch));
    if (hero.p) hero.p.g.visible = hero.dist > 0;
    let pos;
    if (hero.dist === 0) { pos = head; camGoal.copy(head).sub(dir); }
    else { let d = hero.dist; if (ready && !window.__innDebug) { const h = hit(head, dir, d + 0.2); if (h) d = Math.max(0.3, h.distance - 0.2); } pos = head.clone().addScaledVector(dir, d); camGoal.copy(head); }
    const k = ctx.selected ? 1 - Math.exp(-dt * 4) : 1;
    cam.pos.lerp(pos, k); cam.look.lerp(camGoal, k); camera.position.copy(cam.pos); camera.lookAt(cam.look);
  }

  async function placeJuke() {
    const gl = await loadModel(TUNE.room.models.jukebox), grp = new THREE.Group(), g = gl.scene; grp.add(g); grp.updateMatrixWorld(true);
    const b = bounds(grp), k = 1.5 / (b.getSize(new THREE.Vector3()).y || 1);
    g.scale.setScalar(k); g.position.set(-(b.min.x + b.max.x) / 2 * k, -b.min.y * k, -(b.min.z + b.max.z) / 2 * k); grp.updateMatrixWorld(true);
    jb = makeJukebox(grp, bounds(grp).getSize(new THREE.Vector3()), TUNE.jukebox);
    const cells = []; for (let i = 0; i < nav.ok.length; i++) if (free(i) && nav.y[i] < 1.1) { const [x, z] = cellXZ(i), d = Math.hypot(x - hero.x, z - hero.z); if (d > 2.5 && d < 9) cells.push([d, i, x, z]); }
    cells.sort((a, c2) => a[0] - c2[0]);
    for (const [, i, x, z] of cells) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const h = hit(tmp.set(x, nav.y[i] + 0.9, z), new THREE.Vector3(dx, 0, dz), 0.9);
      if (h) { grp.position.set(x + dx * (h.distance - 0.35), nav.y[i], z + dz * (h.distance - 0.35)); grp.rotation.y = Math.atan2(-dx, -dz); scene.add(grp); return; }
    }
    grp.position.set(hero.x + 2, 0, hero.z); scene.add(grp);
  }

  // the quest board (the game's Help Wanted poster) on a wall near the start, unless the building has its own board; click it for the quest log
  let boardObj = null;
  async function placeBoard() {
    if (board || !TUNE.room.models.questboard) return;
    const gl = await loadModel(TUNE.room.models.questboard), grp = new THREE.Group(), g = gl.scene; grp.add(g); grp.updateMatrixWorld(true);
    const b = bounds(grp), k = 1.6 / (b.getSize(new THREE.Vector3()).y || 1);
    g.scale.setScalar(k); g.position.set(-(b.min.x + b.max.x) / 2 * k, 0.6 - b.min.y * k, -(b.min.z + b.max.z) / 2 * k);
    const cells = []; for (let i = 0; i < nav.ok.length; i++) if (free(i) && Math.abs(nav.y[i] - hero.y) < 0.5) { const [x, z] = cellXZ(i), d = Math.hypot(x - hero.x, z - hero.z); if (d > 2 && d < 10 && (!jb || jb.group.position.distanceTo(tmp.set(x, nav.y[i], z)) > 3)) cells.push([d, i, x, z]); }
    cells.sort((a, c2) => a[0] - c2[0]);
    for (const [, i, x, z] of cells) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const h = hit(tmp.set(x, nav.y[i] + 1.2, z), new THREE.Vector3(dx, 0, dz), 0.8);
      if (h && Math.abs(h.face.normal.y) < 0.3) {
        grp.position.set(x + dx * (h.distance - 0.06), nav.y[i], z + dz * (h.distance - 0.06)); grp.rotation.y = Math.atan2(-dx, -dz); scene.add(grp); boardObj = grp;
        board = { x: grp.position.x, z: grp.position.z, y: nav.y[i], yaw: grp.rotation.y }; return;
      }
    }
  }

  // ---- which building: the Options window's choice (models/buildings/index.json, or your own GLB from /api/office), else the classic inn ----
  async function pickHouse() {
    const list = await ws.buildings(), want = ws.get('VA_Building');
    const b = list.find((x) => x.key === want) || list.find((x) => x.key === ws.DEFAULTS.VA_Building) || list[0];
    if (!b) return { key: 'inn', label: 'Goldshire Inn', glb: 'models/inn.glb', spots: 'models/inn.spots.json', start: [-3, 8 * K], desk_y: [5, 8.5], music: ['TavernAlliance', 'Forest'] };
    return { music: [], ...b, glb: b.glb || 'models/buildings/' + b.key + '.glb', spots: b.custom ? null : (b.spots || 'models/buildings/' + b.key + '.spots.json') };
  }
  // no start given: the biggest walkable area on the lowest floor, from its middle
  // V-042: only floor with a roof over it counts (a ray up hits the building), so you never start on a roof or an outside ledge
  const roofMemo = new Map();
  const covered = (i) => {
    if (roofMemo.has(i)) return roofMemo.get(i);
    const [x, z] = cellXZ(i); ray.set(tmp.set(x, nav.y[i] + 0.6, z), UP); ray.far = 30;
    const v = !walls || ray.intersectObject(walls, true).length > 0; ray.far = Infinity; roofMemo.set(i, v); return v;
  };
  function largestGround() {
    let lo = Infinity; for (let i = 0; i < nav.ok.length; i++) if (free(i) && nav.y[i] < lo && covered(i)) lo = nav.y[i];
    if (lo === Infinity) for (let i = 0; i < nav.ok.length; i++) if (free(i) && nav.y[i] < lo) lo = nav.y[i];     // nothing covered: as before
    const seen = new Uint8Array(nav.ok.length); let best = [];
    for (let i = 0; i < nav.ok.length; i++) {
      if (!free(i) || seen[i] || nav.y[i] > lo + 1.5 || !covered(i)) continue;
      const q = [i]; seen[i] = 1; for (let h = 0; h < q.length; h++) eachNb(q[h], (m) => { if (!seen[m] && covered(m)) { seen[m] = 1; q.push(m); } });
      if (q.length > best.length) best = q;
    }
    if (!best.length) return -1;
    let mx = 0, mz = 0; for (const n of best) { const [x, z] = cellXZ(n); mx += x; mz += z; } mx /= best.length; mz /= best.length;
    // the roomiest spot near the middle: most free ground on the same level within ~1.5 m (not a stair, a corner or behind a barrel)
    const inBest = new Set(best); let pick = best[0], bs = -Infinity;
    for (const n of best) {
      const [x, z] = cellXZ(n); let room = 0;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) { const m = nodeAt(x + dx * INN.cell, z + dz * INN.cell, nav.y[n], 0.25); if (m >= 0 && inBest.has(m)) room++; }
      const sc = room - Math.hypot(x - mx, z - mz) * 0.6; if (sc > bs) { bs = sc; pick = n; }
    }
    return pick;
  }
  // your own office GLB (docs/OFFICE.md): empties named desk_* (origin at the wall, +z into the room) and seat_* (+z = facing), meshes named fire* / board*
  // (desk_<n> / seat_<n> only: Blender's desk_1.001 arrives as desk_1001; a mesh or a name like desk_1_top is not a place)
  function customSpots(root) {
    root.updateMatrixWorld(true);
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), f = new THREE.Vector3();
    root.traverse((o) => {
      const n = (o.name || '').toLowerCase(); if (!/^(desk|seat|fire|board)/.test(n)) return;
      if (/^(desk|seat)/.test(n) && (o.isMesh || !/^(desk|seat)([_ .-]?\d+)*$/.test(n))) return;      // V-047: desk_1 / seat_2 are empties; a mesh called desk_1_top is furniture
      o.getWorldPosition(p); o.getWorldQuaternion(q); f.set(0, 0, 1).applyQuaternion(q); const yaw = Math.atan2(f.x, f.z);
      if (n.startsWith('desk') && deskSpots.length < INN.desks_max) deskSpots.push({ x: p.x, z: p.z, y: p.y, yaw, used: null, own: true });
      else if (n.startsWith('seat')) seats.push({ x: p.x, z: p.z, y: p.y, yaw, taken: null });
      else if (n.startsWith('fire') && !fire) fire = p.clone();
      else if (n.startsWith('board') && !board) board = { x: p.x, z: p.z, y: p.y, yaw };
    });
  }

  // V-047: your office's own PC screens: every mesh with a material named "Screen" (Screen.001 ... too, any case) gets a live canvas: the laptop
  // page of the helper at the nearest desk (within 2.5 m), a dim screensaver while that desk is free. The glTF's own UVs place the page
  // (glTF textures are not flipped); a screen without UVs gets a flat one across its two widest sides.
  const SCREEN_RE = /^screen([._ -]?\d+)?$/i, officeScreens = [];
  function findScreens(root) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || /^col_/.test(o.name)) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      if (!list.some((m) => m && SCREEN_RE.test(m.name || ''))) return;
      const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 240;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 4;
      const lit = new THREE.MeshBasicMaterial({ map: tex, fog: false }); lit.name = 'Screen (live)';
      o.material = Array.isArray(o.material) ? o.material.map((m) => (m && SCREEN_RE.test(m.name || '') ? lit : m)) : lit;
      if (!o.geometry.attributes.uv) flatUV(o.geometry);
      const page = pagePainter(canvas), at = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      officeScreens.push({ mesh: o, tex, canvas, at, desk: null, saverAt: -9, live: false,
        paint(h, l, cur) { page(h, l, cur); tex.needsUpdate = true; this.live = true; } });
    });
  }
  function flatUV(geo) {
    geo.computeBoundingBox(); const b = geo.boundingBox, sz = b.getSize(new THREE.Vector3()), pos = geo.attributes.position, uv = new Float32Array(pos.count * 2);
    const ax = ['x', 'y', 'z'].sort((p, q) => sz[q] - sz[p]), [u, v] = ax[0] === 'y' || ax[1] === 'y' ? [ax[0] === 'y' ? ax[1] : ax[0], 'y'] : [ax[0], ax[1]];
    for (let i = 0; i < pos.count; i++) { const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) }; uv[i * 2] = (p[u] - b.min[u]) / (sz[u] || 1); uv[i * 2 + 1] = (b.max[v] - p[v]) / (sz[v] || 1); }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  function bindScreens() {        // each screen belongs to the nearest desk on its floor (several screens may share one desk)
    for (const sc of officeScreens) {
      let best = null, bd = 2.5;
      for (const d of deskSpots) { const h = Math.hypot(d.x - sc.at.x, d.z - sc.at.z), up = sc.at.y - d.y; if (h < bd && up > -0.5 && up < 2.5) { bd = h; best = d; } }
      sc.desk = best; if (best) (best.screens = best.screens || []).push(sc);
    }
  }
  function paintSaver(sc, t) {     // no helper at this desk: a dark screen with a slow, dim drifting glow
    const g = sc.canvas.getContext('2d'), W = sc.canvas.width, H = sc.canvas.height;
    g.fillStyle = '#06080c'; g.fillRect(0, 0, W, H);
    const k = (hash(sc.mesh.uuid) % 100) / 100, x = W * (0.5 + 0.36 * Math.sin(t * 0.13 + k * 6)), y = H * (0.5 + 0.3 * Math.sin(t * 0.21 + k * 3));
    const r = g.createRadialGradient(x, y, 0, x, y, H * 0.35); r.addColorStop(0, 'rgba(78,150,208,0.28)'); r.addColorStop(1, 'rgba(78,150,208,0)');
    g.fillStyle = r; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(140,170,210,0.18)'; for (let i = 0; i < 14; i++) { const q = rng(i + 1 + Math.floor(k * 50)), sx = (q() * W + t * 6 * (0.3 + q())) % W; g.fillRect(sx, q() * H, 2, 2); }
    sc.tex.needsUpdate = true; sc.live = false;
  }
  function stepScreens(t) {
    for (const sc of officeScreens) {
      const busy = sc.desk && sc.desk.used && sc.desk.station && sc.desk.station.id === sc.desk.used;     // its helper's desk is built: the page is painted by the tick
      if (!busy && t - sc.saverAt >= (sc.live ? 0 : 0.5)) { sc.saverAt = t; paintSaver(sc, t); }
    }
  }

  // ---- load everything, then run ----
  (async () => {
    house = await pickHouse();
    juke.setWords(ws.get('VA_Music') ? house.music : []);
    const place = await ws.places(), zone = place.zones.find((z) => z.id === house.zone) || null;
    if (zone) {                // V-042: the zone's loading screen, name and light
      zoneLight(zone.light, zone.lighting);
      const art = document.querySelector('#loading .loading-art'), shot = place.loading && place.loading[zone.continent];
      if (art && shot) art.style.backgroundImage = 'url("/assets/' + shot + '")';
      const box = document.getElementById('loading');
      if (box) { const z = document.createElement('div'); z.className = 'loading-zone'; const n = document.createElement('div'); n.className = 'loading-zone-name'; n.textContent = zone.name; const i = document.createElement('div'); i.className = 'loading-zone-inn'; i.textContent = house.label; z.append(n, i); box.append(z); }
    }
    const hasPhoto = !!(place.buildings.find((b) => b.key === house.key) || {}).photo;
    loading.step('Opening the ' + house.label, 0.12, 0.21);
    const [gltf, spots] = await Promise.all([loadModel(house.glb), house.spots ? fetch('/assets/' + house.spots).then((r) => r.json()) : Promise.resolve([])]);
    inn = gltf.scene; inn.scale.setScalar(house.custom ? 1 : K); scene.add(inn); inn.traverse((o) => { o.frustumCulled = true; });   // your own GLB is in metres already
    inn.updateMatrixWorld(true);
    inn.traverse((o) => { if (o.isMesh && /^col_/.test(o.name)) { o.visible = false; colMeshes.push(o); if (o.parent) o.parent.userData.hasCol = true; } });
    walls = makeCollider(house.custom ? inn : inn.children[0]); solid = makeCollider([house.custom ? inn : inn.children[0], ...colMeshes]);
    loading.step('Finding the way around', 0.22, 0.62);
    await buildNav(spots, (f) => loading.step('Finding the way around', 0.22 + 0.4 * f));
    const start = house.start ? nearestFree(house.start[0], house.start[1], 0) : largestGround();
    keepConnected(start); findSpots(spots); if (house.custom) { customSpots(inn); findScreens(inn); }
    const gy0 = start >= 0 ? nav.y[start] : 0;
    if (!deskSpots.length && house.desk_y) findDesks(...house.desk_y);
    if (!deskSpots.length) findDesks(gy0 - 0.3, gy0 + 1.1);
    bindScreens();
    if (!house.custom) batchFurniture(inn);
    loading.step('Heroes are on their way', 0.65, 0.8);
    // only the heroes in use now (you + the helpers already here); others load when they walk in
    for (let k = 0; k < 30 && !(state.agents || []).length; k++) await new Promise((r) => setTimeout(r, 50));
    const files = [...new Set(await Promise.all(['hero', ...agentsNow().map((a) => a.id)].map(async (id) => (await workerFile(id)).file)))];
    let got = 0; await Promise.all(files.map((f) => preloadModel(f).catch(() => {}).then(() => loading.step('Heroes are on their way', 0.65 + 0.15 * (++got / Math.max(1, files.length))))));
    await Promise.all([staticModel(c.models.desk), staticModel(c.models.chair)]);
    const hp = await makePerson('hero'); hero.p = hp; scene.add(hp.g); play(hp, 'stand');
    const st = start; const [sx, sz] = st >= 0 ? cellXZ(st) : [0, 0]; hero.x = sx; hero.z = sz; hero.y = hero.gnd = st >= 0 ? nav.y[st] : 0; hp.g.position.set(sx, hero.y, sz);
    { // first look: toward the tables on your floor (where the helpers sit), else toward the open middle of the room
      const near = seats.filter((q) => q.table && Math.abs(q.y - hero.y) < 1.5), list = near.length ? near : seats;
      if (list.length) { let cx = 0, cz = 0; for (const q of list) { cx += q.x; cz += q.z; } cx /= list.length; cz /= list.length; if (Math.hypot(cx - sx, cz - sz) > 0.5) { hero.yaw = Math.atan2(cx - sx, cz - sz); hero.body = hero.yaw; } }
    }
    await placeJuke().catch((e) => console.warn('inn jukebox', e));
    await placeBoard().catch((e) => console.warn('inn quest board', e));
    loadProp(TUNE.bag.model, TUNE.bag.h).then((g) => { sackProto = g; }).catch(() => {});      // V-043: the sack helpers carry to the crates (none baked: just the loot emote)
    loading.step('Greeting the helpers', 0.85, 0.93); { const n = agentsNow().length; if (n) loading.note(ctx.t('load.helpers', { count: n })); }
    sync(agentsNow()); for (let k = 0; k < 100 && [...villagers.values()].some((v) => v.stage === 'loading'); k++) await new Promise((r) => setTimeout(r, 50));
    loading.step('Lighting the candles', 0.94, 0.99);
    placeCamera(0); renderer.compile(scene, camera); renderer.render(scene, camera);      // shaders and textures go to the GPU now, not mid-game
    // nobody here yet: say how to bring helpers in (gone as soon as one walks in)
    const hint = document.createElement('div'); hint.className = 'empty-hint'; hint.textContent = ctx.t('ws.empty_inn'); hint.hidden = true; document.body.append(hint);
    setInterval(() => { hint.hidden = agentsNow().length > 0 || !!(state.party && state.party.joined && state.party.state && state.party.state.members.length > 1); }, 1000);
    ready = true; loading.done();
    let tour = null; try { tour = JSON.parse(sessionStorage.getItem('vanilla.photoTour') || 'null'); } catch (e) { tour = null; }
    if (tour && Array.isArray(tour.queue)) {             // V-042 picture tour (Zones window): photograph this inn, then the next one, then go back
      const q = tour.queue.filter((k) => k !== house.key);
      showToast(ctx.t('zones.touring', { n: tour.total - q.length, total: tour.total }), 'grey', 2500);
      setTimeout(async () => {
        await takeInnPhoto();
        try { sessionStorage.setItem('vanilla.photoTour', JSON.stringify({ ...tour, queue: q })); if (!q.length) sessionStorage.removeItem('vanilla.photoTour'); } catch (e) { /* storage off: the tour stops here */ }
        if (q.length) ws.set('VA_Building', q[0]);
        else { showToast(ctx.t('zones.tour_done'), 'gold'); if (tour.back && tour.back !== house.key) setTimeout(() => ws.set('VA_Building', tour.back), 1500); }
      }, 3000);
    } else if (!hasPhoto) setTimeout(takeInnPhoto, 6000);       // V-042: the Zones window's picture of this inn, once
    window.__inn = { get jb() { return jb; }, get revives() { return revives; }, select: (id) => ctx.select(id), hit, nav, seats, tables, deskSpots, fire, hero, villagers, stations, get board() { return board; }, props, colMeshes, get solid() { return solid; }, ANIM, play, emote, groundAt, wallHit,
      get selected() { return ctx.selected; },
      officeScreens,      // V-047: your office's live PC screens {mesh, desk, live}
      photo(o) { photo = o; if (!o && hero.p) hero.p.g.visible = true; },
      takeInnPhoto,
      lights, TK, taskKind,
      // V-043 testing: make a helper do a task without real events for `s` seconds: 'test' (anvil), 'check' (the checker on its quest), 'ship' (sack to the crates), 'wait' (quest board)
      force(id, kind, s = 120) { const v = villagers.get(id); if (!v) return false; v.force = kind ? { kind, until: clock.elapsedTime + s } : null; if (kind === 'ship') v.errandAt = -99; return true; },
      doing(id) { const v = villagers.get(id); return v ? { stage: v.stage, errand: v.errand && v.errand.kind, goal: v.goal && v.goal.kind, anim: v.p && v.p.cur, sack: !!v.sack, checking: !!v.checking, testing: testing(v, clock.elapsedTime), pos: v.p && v.p.g.getWorldPosition(new THREE.Vector3()).toArray(),
        contest: v.contestQ || null, atContestTable: !!(v.st && v.st.contest), seat: v.st && v.st.spot ? [v.st.spot.x, v.st.spot.z] : null } : null; },
      contestTables,      // V-047: quest id -> the table its competitors share
      teleport(x, z, faceX, faceZ) { const n = nearestFree(x, z, hero.y, 20); if (n < 0) return false; [hero.x, hero.z] = cellXZ(n); hero.y = nav.y[n]; if (faceX !== undefined) { hero.yaw = Math.atan2(faceX - hero.x, faceZ - hero.z); hero.body = hero.yaw; } return true; } };
  })().catch((e) => { console.error('inn load', e); loading.fail('The inn could not load: ' + (e && e.message)); });

  // V-042: a 480x270 JPEG of what you see now (WebGL canvas only, no windows), saved as this inn's picture in the Zones window
  async function takeInnPhoto() {
    if (!house || !ready || document.hidden) return false;
    try {
      const hide = [hero.p && hero.p.g, ...[...villagers.values()].map((v) => v.p && v.p.g)]       // the room, not your back or a helper's face up close
        .filter((g) => g && g.visible && (g === (hero.p && hero.p.g) || g.position.distanceTo(camera.position) < 3));
      hide.forEach((g) => { g.visible = false; });
      renderer.render(scene, camera);
      hide.forEach((g) => { g.visible = true; });
      const src = renderer.domElement, out = document.createElement('canvas'); out.width = 480; out.height = 270;
      const r = Math.max(480 / src.width, 270 / src.height), w = src.width * r, h = src.height * r;
      out.getContext('2d').drawImage(src, (480 - w) / 2, (270 - h) / 2, w, h);
      await ctx.net.post('/api/inn_photo', { key: house.key, jpeg: out.toDataURL('image/jpeg', 0.82) });
      ws.places(true);
      return true;
    } catch (e) { console.warn('inn photo', e); return false; }
  }

  // ours first, then the helpers of the other people in our party (Party window): they walk around here too, tagged with whose they are
  function agentsNow() {
    const ps = state.party && state.party.joined && state.party.state, me = ps && ps.me;
    const guests = ps ? ps.members.filter((m) => m.id !== me && m.active).flatMap((m) => m.agents.map((a) => ({ ...a, id: m.id + ':' + a.id, role: m.name + "'s " + (a.role || 'helper'), remote: true, passed: 0, failed: 0 }))) : [];
    return [...(state.agents || []), ...guests].slice(0, Math.min(INN.max_agents, Number(ws.get('VA_MaxHelpers')) || INN.max_agents));
  }
  const ndc = new THREE.Vector2();
  canvas.addEventListener('click', (e) => {
    if (moved > 6) return;
    ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); ray.far = 100;
    if (jb && ray.intersectObject(jb.group, true).some((h) => h.object.isMesh)) return ctx.jukebox.toggle();
    if (boardObj && ray.intersectObject(boardObj, true).some((h) => h.object.isMesh)) { const q = ctx.panels && ctx.panels.quest_log; if (q && !q.isOpen()) q.toggle(); return; }
    for (const [id, v] of villagers) if (v.p && ray.intersectObject(v.p.g, true).length) {   // click a helper: the camera goes to it and its talk window opens
      const on = id !== ctx.selected, guest = id.includes(':'); if (!guest) ctx.select(on ? id : null);
      if (guest) { showToast((agentsNow().find((a) => a.id === id) || {}).role || id, 'grey'); return; }      // a party member's helper: just who it is
      if (on && ctx.talk) { ctx.talk(id); if (!ws.reducedMotion()) emote(v.p, 'wave', v.p.cur || 'stand'); }
      return;
    }
    ctx.select(null);
  });
  window.addEventListener('keydown', (e) => {     // Esc: stop looking at a helper; with a pop-up window open, that window closes too (main.js ctx.escape)
    if (e.key !== 'Escape' || !ctx.selected) return;
    ctx.select(null);
    if (!Object.values(ctx.panels).some((p) => p.isOpen() && !p.cfg.visible)) e.stopImmediatePropagation();
  }, true);
  function size() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
  addEventListener('resize', size); size();

  // ---- minimap (top right): this floor seen from above, you as the arrow, helpers as dots (gold = working, grey = waiting, blue = ghost) ----
  const mm = document.createElement('canvas'); mm.className = 'minimap'; mm.width = mm.height = 150; (document.getElementById('ui') || document.body).prepend(mm);   // first in the UI layer: every window draws over it
  const mg = mm.getContext('2d'); let mmFloor = null, mmBase = null, mmAt = 0;
  function drawMinimap(t) {
    if (!ready || t - mmAt < 0.2) return; mmAt = t;
    const S = mm.width, R2 = 14, px = S / (2 * R2), floor = Math.round(hero.y);   // 14 m around you
    if (mmFloor !== floor) {        // the walkable cells of this floor, drawn once per floor
      mmFloor = floor; mmBase = document.createElement('canvas'); mmBase.width = nav.W; mmBase.height = nav.H;
      const g = mmBase.getContext('2d'), img = g.createImageData(nav.W, nav.H);
      for (let i = 0; i < nav.ok.length; i++) if (free(i) && Math.abs(nav.y[i] - hero.y) < 1.2) { const c = i % nav.N, o = c * 4; img.data[o] = 150; img.data[o + 1] = 120; img.data[o + 2] = 80; img.data[o + 3] = 255; }
      g.putImageData(img, 0, 0);
    }
    mg.clearRect(0, 0, S, S); mg.save(); mg.beginPath(); mg.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); mg.clip();
    mg.fillStyle = 'rgba(10,8,6,0.85)'; mg.fillRect(0, 0, S, S);
    mg.translate(S / 2, S / 2); mg.rotate(hero.camYaw + Math.PI); mg.scale(-px, px);        // turns with the camera, like the game's minimap
    mg.imageSmoothingEnabled = false; mg.drawImage(mmBase, nav.minX - hero.x - INN.cell / 2, nav.minZ - hero.z - INN.cell / 2, nav.W * INN.cell, nav.H * INN.cell);
    const dot = (x, z, col, r) => { mg.fillStyle = col; mg.beginPath(); mg.arc(x - hero.x, z - hero.z, r / px, 0, Math.PI * 2); mg.fill(); };
    for (const d of deskSpots) dot(d.x, d.z, 'rgba(120,90,50,0.9)', 2.5);
    if (board) dot(board.x, board.z, '#ffd100', 3.5);
    const list = agentsNow();
    for (const [id, v] of villagers) if (v.p) { const a = list.find((x) => x.id === id), p = v.p.g.getWorldPosition(tmp); dot(p.x, p.z, v.ghost ? '#7fc8ff' : a && a.state === 'working' ? '#ffd100' : '#c0c0c0', id === ctx.selected ? 4.5 : 3); }
    mg.restore();
    mg.save(); mg.translate(S / 2, S / 2); mg.rotate(-(hero.yaw - hero.camYaw)); mg.fillStyle = '#fff'; mg.beginPath(); mg.moveTo(0, -7); mg.lineTo(5, 5); mg.lineTo(0, 2); mg.lineTo(-5, 5); mg.closePath(); mg.fill(); mg.restore();
    mg.strokeStyle = '#8a7a5a'; mg.lineWidth = 3; mg.beginPath(); mg.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); mg.stroke();
  }

  // too slow for this PC (under 22 fps for 8 s while the window is in front): one step down in render quality, said once
  let slowT = 0, fpsAvg = 60; const heroAt = new THREE.Vector3();
  function watchSpeed(step) {
    if (!ready || document.hidden || step <= 0 || step > 1 || window.__innKeepQuality) return;     // __innKeepQuality: test pages (slow software GL) keep their lights and quality
    fpsAvg += (1 / step - fpsAvg) * 0.05;
    slowT = fpsAvg < 22 ? slowT + step : 0;
    const q = Number(ws.get('VA_Quality'));
    if (slowT > 8 && lights.shed()) { slowT = -15; return; }     // V-043: the candle lights go first (half, then none), quietly
    if (slowT > 8 && q > 0) {
      slowT = -30;                       // give the new setting time before judging again
      ws.set('VA_Quality', q - 1);
      showToast(ctx.t('help.low_quality', { word: ctx.t('ws.quality_' + (q - 1)) }), 'grey');
    }
  }
  function tick() {
    requestAnimationFrame(tick);
    const step = clock.getDelta();
    watchSpeed(step);
    if (frameGap) { sinceFrame += step; if (sinceFrame < frameGap) return; }   // frame rate cap (Options > Workshop graphics)
    const dt = Math.min(frameGap ? sinceFrame : step, 0.1), t = clock.elapsedTime, now = agentsNow(); sinceFrame = 0;
    if (ready) { sync(now); stepContests(now); stepHero(dt); }
    for (const a of now) { const v = villagers.get(a.id); if (v) { stepVillager(v, a, dt, t); if (v.p && ready && justRevived(ctx, a.id, revSeen, 45000)) startRevive(v); } }
    stepRevives(dt);
    if (ready) stepScreens(t);
    if (ready) lights.update(t, dt, heroAt.set(hero.x, hero.y + 1.2, hero.z));
    for (const [, v] of villagers) if (v.st) {
      const a = now.find((x) => x.id === v.id), working = atWork(a);
      v.st.amount += ((working && v.stage === 'work' ? 1 : 0) - v.st.amount) * Math.min(1, dt * 8);
      if (v.st.laptop) { const want = v.stage === 'work' ? LAP.open : 0; v.st.lid += (want - v.st.lid) * Math.min(1, dt * 4); v.st.hinge.rotation.x = v.st.lid; }   // opens when seated, shuts on an errand
      if (t - v.st.shown >= 0.33) { v.st.shown = t; const x = screenText({ id: v.id, level: v.p && v.p.level }, a), blink = x.cursor && Math.floor(t * 2) % 2 === 0, sig = x.head + x.lines.map((l) => l.text).join('|') + blink; if (sig !== v.st.sig) { v.st.sig = sig; v.st.mon.paint(x.head, x.lines, blink); } }
    }
    for (const st of shutting) { st.lid += (0 - st.lid) * Math.min(1, dt * 6); st.hinge.rotation.x = st.lid; }
    placeCamera(dt);
    if (jb) jb.update(t, dt, juke.update(t, camera, jb.worldPos(jbPos)));
    renderer.render(scene, camera);
    drawMinimap(t);
  }
  tick();
  ctx.workshop3d = window.vanilla3d = { scene, camera, renderer, hero, stats: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles }) };
  return {
    update(s) {
      state = s;
      checkRevived(ctx, s);
      for (const a of s.agents) { const h = hist[a.id] || (hist[a.id] = []); if (a.activity && a.state === 'working') { const l = activityLine(a.activity); if (h[h.length - 1] !== l) { h.push(l); if (h.length > HISTORY) h.shift(); } } }
    },
    redraw() {},
  };
}
