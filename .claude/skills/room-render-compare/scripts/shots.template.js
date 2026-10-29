// Screenshots of the 3D room from fixed cameras. Copy this file to the scratchpad, edit the CONFIG block, and run it
// with the Playwright tool: browser_run_code_unsafe { filename: "<the copy>" }. It returns the counts to check.
//
// Cameras are in room millimetres: [eye x, eye y, eye height] looking at [x, y, height]. Room x runs from the window
// wall (0) towards the nooks, y from the kitchen wall (0) towards the back wall.
// ROUTES swaps a script for another file (e.g. a backup) to take the "before" shots from the same cameras.
async (page) => {
  // ---------------- CONFIG ----------------
  const PORT = 8812;  // your own test server, never 8000 (the user's app)
  const OUT = 'C:/path/to/scratchpad/shots/';  // must exist
  const PREFIX = 'after';
  const ROUTES = {};  // e.g. { 'room.js': 'C:/path/to/scratchpad/backup/room.orig.js' }
  const LOOK = null;  // null (textured), 'Flat colours' or 'RobCo terminal'
  const VIEWS = [
    ['nook', [1900, 1600, 1500], [3450, 2530, 1000]],
    ['kitchen', [2350, 2300, 1500], [2725, 0, 1000]],
  ];
  // -----------------------------------------
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.removeAllListeners('dialog'); page.on('dialog', d => d.accept().catch(() => {}));
  for (const [name, file] of Object.entries(ROUTES)) await page.route('**/js/' + name, r => r.fulfill({ path: file, contentType: 'application/javascript' }));
  await page.setViewportSize({ width: 1400, height: 1000 });
  // lib=1 loads the books from the app; without it the page wants data/books.json and stays black
  await page.goto(`http://127.0.0.1:${PORT}/sim-files/index.html?lib=1&view=vRoom`);
  await page.waitForFunction(() => window.Game && Game.R && Game.R.texLoaded() > 8, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: '#start{display:none!important}' });
  if (LOOK) { await page.getByText(LOOK, { exact: true }).click(); await page.waitForTimeout(400); }
  const out = [];
  for (const [name, c, t] of VIEWS) {
    await page.evaluate(([c, t]) => {
      const lx = t[0] - c[0], ly = t[1] - c[1];
      Game.lookFrom(c[0], c[1], c[2], Math.atan2(-lx, ly), Math.atan2(t[2] - c[2], Math.hypot(lx, ly)));
    }, [c, t]);
    await page.waitForTimeout(600);
    const f = OUT + `${PREFIX}_${name}.png`;
    await page.locator('canvas').first().screenshot({ path: f }); out.push(f);
  }
  const counts = await page.evaluate(() => {
    let tri = 0;
    Game.R.parts.forEach(p => { const g = p.mesh.geometry; tri += (g.index ? g.index.count : g.attributes.position.count) / 3; });
    return { statics: Game.R.statics.length, parts: Game.R.parts.length, triangles: Math.round(tri), units: Game.R.units.length, surfaces: Object.keys(Game.R.surfaces).length };
  });
  if (LOOK) await page.getByText('Textured', { exact: true }).click();
  for (const name of Object.keys(ROUTES)) await page.unroute('**/js/' + name);
  return JSON.stringify({ out, counts, errs });
}
