// Test helper (tests/test_remote.py): acts as remote.html with app/web/js/remote-core.js. Args: link fragment, scope wanted.
// Prints one JSON line: what it saw.
import { connect, newDevice, b64d } from '../../app/web/js/remote-core.js';
const frag = new URLSearchParams(process.argv[2]);
const out = { statuses: [] };
const dev = await newDevice();
const link = { relay: frag.get('r'), pair: frag.get('p'), pcPub: b64d(frag.get('k')), dev };
let welcomed, gotState;
const w = new Promise((r) => { welcomed = r; });
const s = new Promise((r) => { gotState = r; });
const c = connect(link, { status: (t) => out.statuses.push(t), welcome: (x) => welcomed(x), state: (st) => gotState(st), paired: () => {} });
c.start();
out.paired = await c.pair(b64d(frag.get('s')), 'Node browser');
out.welcome = await w;
const st = await c.req('GET', '/api/state');
out.state_status = st.status;
out.titles = (st.body.tasks || []).map((t) => t.title);
out.pushed = !!(await s).tasks;
out.approve = (await c.req('POST', '/api/approve', { task: 'q1' })).status;
out.config = (await c.req('GET', '/api/config')).status;
c.stop();
console.log(JSON.stringify(out));
process.exit(0);
