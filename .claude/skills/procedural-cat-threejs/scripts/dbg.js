// One close-up of the spike cat in one pose, from one camera. Set SPIKE to the spike page (default ./cat-gait.html).
// e.g. SPIKE=.../catspike/cat-gait.html node dbg.js out.png black donut 2.3 0.75 0.9 1 0
// az/pol/r: the orbit camera (rad, rad, m); fur 0 hides the shells (see the loft under them), bones 1 draws the skeleton.
// PRINT='JSON-able expression' prints it after the shot (e.g. PRINT='Cat.C').
// node dbg.js <out.png> <coat> <pose> <az> <pol> <r> [fur 0/1] [bones 0/1] [js to eval]
const pw = require(process.env.APPDATA + '/npm/node_modules/playwright');
const path = require('path');
const SPIKE = process.env.SPIKE || path.join(process.cwd(), 'cat-gait.html');  // the spike page (it loads cat.js from beside it)
(async () => {
  const [out, coat, pose, az, pol, r, fur = '1', bones = '0', js = ''] = process.argv.slice(2);
  const b = await pw.chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1000, height: 760 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + path.resolve(SPIKE).replace(/\\/g, '/'));
  await p.waitForFunction(() => window.Cat, null, { timeout: 20000 });
  await p.evaluate(([coat, pose, az, pol, r, fur, bones, js]) => {
    document.getElementById('fold').click(); document.querySelector('.hint').hidden = true; Cat.UI.wander = false;
    Cat.setCoat(coat); if (fur === '0') document.getElementById('fur').click(); if (bones === '1') document.getElementById('bones').click();
    if (pose !== 'none') { Cat.startRest(pose); Cat.C.restT = 999; }
    Object.assign(Cat.cam, { az: +az, pol: +pol, r: +r });
    if (js) eval(js);
  }, [coat, pose, az, pol, r, fur, bones, js]);
  await p.waitForTimeout(3800);
  await p.screenshot({ path: out });
  if (process.env.PRINT) console.log(await p.evaluate(e => JSON.stringify(eval(e)), process.env.PRINT));
  await b.close();
})();
