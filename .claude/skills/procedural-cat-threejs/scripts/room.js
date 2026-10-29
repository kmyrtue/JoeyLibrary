// A shot of the real room with the cat in it: camera at room (x, y, h) in mm looking along yaw/pitch (Game.lookFrom).
// js runs first in the page (hide the start card: document.getElementById('start').style.display='none'; send her
// somewhere: Game.R.cat.where.toEdge()); wait is ms before the shot. Prints statics, cat state, her room position,
// lift, triangles and fps. SIM_URL overrides the page (default the app on port 8000).
// node room.js <outdir> <name> <x mm> <y mm> <h mm> <yaw> <pitch> [js run first] [wait ms]
const pw = require(process.env.APPDATA + '/npm/node_modules/playwright');
(async () => {
  const [out, name, x, y, h, yaw, pitch, js = '', wait = '4000'] = process.argv.slice(2);
  const b = await pw.chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(process.env.SIM_URL || 'http://127.0.0.1:8000/sim-files/index.html?lib=1&view=vRoom');
  await p.waitForFunction(() => window.Game && window.Game.R && window.Game.R.cat, null, { timeout: 30000 });
  await p.waitForTimeout(2500);
  await p.evaluate(([x, y, h, yaw, pitch, js]) => { Game.lookFrom(+x, +y, +h, +yaw, +pitch); if (js) eval(js); }, [x, y, h, yaw, pitch, js]);
  await p.waitForTimeout(+wait);
  await p.evaluate(([x, y, h, yaw, pitch]) => Game.lookFrom(+x, +y, +h, +yaw, +pitch), [x, y, h, yaw, pitch]);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/${name}.png` });
  const info = await p.evaluate(() => {
    const cat = Game.R.cat, C = cat.C; let tris = 0;
    cat.root.traverse(o => { if (o.isMesh && o.visible) { const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3; tris += n * (o.isInstancedMesh ? o.count : 1); } });
    const wp = cat.worldPos();
    return { statics: Game.R.statics.length, state: C.state, rest: C.restKind, restW: +C.restW.toFixed(2), room: [Math.round(wp.x * 1000), Math.round(-wp.z * 1000), Math.round(wp.y * 1000)], lift: +C.lift.toFixed(3), catTris: Math.round(tris) };
  });
  const fps = await p.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { if (++n < 90) requestAnimationFrame(f); else res(90000 / (performance.now() - t0)); }; requestAnimationFrame(f); }));
  console.log(JSON.stringify(info), 'fps', fps.toFixed(1), 'errors', JSON.stringify(errs.slice(0, 5)));
  await b.close();
})();
