// Every coat (COATS=calico,ginger,black) in every pose given, from a 3/4 view and from above, plus fps and page errors.
// e.g. SPIKE=.../cat-gait.html node shots.js outdir donut side loaf sit
// node shots.js <outdir> [poses...]: screenshots of the spike, each coat in each pose
const pw = require(process.env.APPDATA + '/npm/node_modules/playwright');
const path = require('path');
const SPIKE = process.env.SPIKE || path.join(process.cwd(), 'cat-gait.html');  // the spike page (it loads cat.js from beside it)
(async () => {
  const out = process.argv[2], poses = process.argv.slice(3).length ? process.argv.slice(3) : ['donut'];
  const b = await pw.chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file:///' + path.resolve(SPIKE).replace(/\\/g, '/'));
  await p.waitForFunction(() => window.Cat, null, { timeout: 20000 });
  await p.evaluate(() => { document.getElementById('fold').click(); document.querySelector('.hint').hidden = true; Cat.UI.wander = false; });
  for (const coat of (process.env.COATS || 'calico,ginger,black').split(',')) for (const pose of poses) {
    await p.evaluate(([coat, pose]) => { Cat.setCoat(coat); Cat.C.restW = 0; Cat.C.state = 'idle'; Cat.C.goal = {}; Cat.startRest(pose); Cat.C.restT = 999; }, [coat, pose]);
    await p.waitForTimeout(3200);
    for (const [az, pol, r, tag] of [[2.3, 0.75, 0.9, 'a'], [0.4, 0.35, 0.8, 'top']]) {
      await p.evaluate(([az, pol, r]) => Object.assign(Cat.cam, { az, pol, r }), [az, pol, r]);
      await p.waitForTimeout(600);
      await p.screenshot({ path: `${out}/spike_${coat}_${pose}_${tag}.png` });
    }
  }
  const fps = await p.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { if (++n < 60) requestAnimationFrame(f); else res(60000 / (performance.now() - t0)); }; requestAnimationFrame(f); }));
  console.log('fps', fps.toFixed(1), 'errors', JSON.stringify(errs));
  await b.close();
})();
