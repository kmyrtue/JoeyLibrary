// Runs two hours of the room cat's behaviour in one go (120 * 3600 updates of 1/60 s) and prints how much of it she
// spent lying (side, loaf, donut, curl), which rests she took and how many walks; then reloads and checks that her
// saved spot came back. It WRITES her spot to the room's store (Store.saveCase('cats')), so run it against a test
// library, not the user's. SIM_URL overrides the page.
const pw = require(process.env.APPDATA + '/npm/node_modules/playwright');
(async () => {
  const b = await pw.chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  const find = () => p.evaluate(() => { for (const k of Object.keys(window)) { try { const o = window[k]; if (o && o.R && o.R.cat) return k + '.R'; if (o && o.cat && o.cat.where) return k; } catch (e) { } } return null; });
  await p.goto(process.env.SIM_URL || 'http://127.0.0.1:8000/sim-files/index.html?lib=1'); await p.waitForTimeout(6000);
  const g = await find(); console.log('global', g);
  const st = () => p.evaluate(g => { const c = eval('window.' + g).cat, C = c.C; return { state: C.state, kind: C.restKind, restT: +C.restT.toFixed(0), at: c.where ? null : null, saved: (Store.cases.get('cats') || {}).lucifer }; }, g);
  console.log('start', JSON.stringify(await st()));
  // simulate: wake her and run 20 minutes of behaviour quickly, counting lying time
  const r = await p.evaluate(g => {
    const c = eval('window.' + g).cat, C = c.C, LONG = new Set(['side', 'loaf', 'donut', 'curl']);
    let lying = 0, total = 0, kinds = {}, walks = 0, prev = '';
    for (let i = 0; i < 60 * 60 * 120; i++) { c.update(1 / 60); total++; if (C.state === 'rest' && LONG.has(C.restKind)) lying++; const s = C.state + ':' + C.restKind; if (s !== prev) { if (C.state === 'go') walks++; if (C.state === 'rest') kinds[C.restKind] = (kinds[C.restKind] || 0) + 1; prev = s; } }
    return { lyingPct: +(100 * lying / total).toFixed(1), kinds, walks };
  }, g);
  console.log('2 h sim', JSON.stringify(r));
  await p.waitForTimeout(3000);
  console.log('after', JSON.stringify(await st()));
  const api = await p.evaluate(() => fetch('/api/sim/state').then(r => r.json()).then(s => s.cases.cats));
  console.log('server', JSON.stringify(api));
  await p.reload(); await p.waitForTimeout(6000);
  const g2 = await find();
  console.log('reloaded', JSON.stringify(await p.evaluate(g => { const c = eval('window.' + g).cat, C = c.C, w = c.worldPos(); return { state: C.state, kind: C.restKind, heading: +C.heading.toFixed(3), x: Math.round(w.x * 1000), y: Math.round(-w.z * 1000) }; }, g2)));
  await b.close();
})();
