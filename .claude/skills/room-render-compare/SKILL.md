---
name: room-render-compare
description: Use to check any visual change to JoeyLibrary's 3D room (joeylibrary/sim): furniture, doors, materials, lights or camera views. Also use when asked for screenshots, "before/after" shots or a photo-versus-render comparison of the room. Runs a scratch test server on its own port, drives the page with Playwright to fixed cameras (Game.lookFrom), takes before shots by routing backup scripts, builds photo | before | after sheets, checks statics, triangles and page errors in every look, and cleans up afterwards.
---

# Render and compare the 3D room

A change to the room is done when a sheet shows **photo | before | after** from the same cameras, the counts are
unchanged or within budget, and the page has no errors. Look at the sheet yourself with the Read tool before
reporting. Then send the sheet path, not adjectives.

## 1. A test server of your own

Never use port 8000 or the user's open app, and never the user's real database: the server writes to the
database it is given.

```bash
S=.claude/skills/room-render-compare/scripts
bash $S/test_env.sh setup "$SCRATCH/ftest" "$SCRATCH/test.db" "<a settings.json to start from, optional>"
bash $S/test_env.sh start "$SCRATCH/ftest" 8812        # run this one in the background
```

`$SCRATCH/test.db` is a *copy* of a library database in the scratchpad. `setup` turns off backups-on-exit and
points the backup folder into the scratch dir. Before starting, check that `curl -s -o /dev/null -w "%{http_code}"
http://127.0.0.1:8812/` gives 200. Pair the background server with a recurring check (the user's rule): a live
process is not proof it is serving.

## 2. Shots from fixed cameras

Copy `scripts/shots.template.js` into **`C:\code\JoeyLibrary\.playwright-mcp\`**, because the Playwright tool only
loads files from inside the repo. Edit its CONFIG block and run it:

```
mcp__plugin_playwright_playwright__browser_run_code_unsafe { filename: "C:/code/JoeyLibrary/.playwright-mcp/<copy>.js" }
```

- The page must be `/sim-files/index.html?lib=1&view=vRoom`. Without `lib=1` it renders black ("Could not load
  the books").
- It waits for `Game.R.texLoaded() > 8` plus 2.5 s, then hides `#start`.
- Cameras are room mm `[eye x, y, height] -> [target x, y, height]`. The script turns them into
  `Game.lookFrom(x, y, h, yaw, pitch)` with `yaw = atan2(-dx, dy)` and `pitch = atan2(dz, hypot(dx, dy))`.
- It screenshots the canvas only, at a 1400 × 1000 viewport. Keep the same viewport for before and after.
- `LOOK` switches to 'Flat colours' or 'RobCo terminal' by clicking the button text.
- `ROUTES` serves a backup file in place of `js/room.js` or `js/furniture.js`. That is how **before** shots are
  taken from the identical cameras. Use the backup that matches what the user last saw.
- It returns `{ out, counts: { statics, parts, triangles, units, surfaces }, errs }`. Compare counts before and
  after.
- Delete your copies from `.playwright-mcp` when done.

Cameras that worked:

| view | eye | target |
|---|---|---|
| nook doors | 1900,1600,1500 | 3450,2530,1000 |
| nook door, front | 2300,2530,1150 | 3450,2530,1050 |
| nook door, close | 2650,2150,1150 | 3480,2250,1000 |
| kitchen door | 2350,2300,1500 | 2725,0,1000 |
| kitchen door head | 2650,900,1800 | 2900,0,2050 |
| box room door | 3050,6900,1500 | 2175,8333,1000 |
| chatol drawers | 2600,6000,900 | 2850,5990,830 |
| chatol handle, macro | 2730,5990,700 | 2850,5985,680 |
| chatol, photo angle | 2300,7100,1150 | 2860,6050,500 |

For a new piece, read its position from `Game.R.units` (`home: {cx, cy, z, rot}`, plus W, D and H). Its front faces
along (-sin rot, cos rot). Put the eye 0.5–2 m out along that direction.

## 3. Sheets

- `python -I scripts/sheet.py out.jpg <cols> files...` makes a plain contact sheet. Use it to survey photos or a
  set of shots.
- `python -I scripts/compare.py out.jpg --col <photo crops> --col <before shots> --col <after shots>` makes the
  labelled PHOTO | BEFORE | AFTER columns.
- Use the photo crop that shows the detail (`room-model-from-photos/scripts/crop.py`) at the same framing as the
  shot. Include one shot at a normal viewing distance as well as the close-up: details that only read in a macro
  shot aren't done.
- Look at every sheet with Read before sending it. Check proportions first, then colour, then detail.

## 4. Checks before reporting

- [ ] statics count unchanged (or changed on purpose, and said so)
- [ ] triangles within budget; give before and after numbers
- [ ] `errs` empty in the textured, flat and terminal looks
- [ ] the terminal look outlines new parts cleanly
- [ ] behaviour still works if the change touched furniture: books onto every surface, move, add, take out and
      put back
- [ ] counts that changed for reasons that aren't yours (another agent's work) are reported, not "fixed"

## 5. Clean up

```bash
bash $S/test_env.sh stop 8812
rm -rf "$SCRATCH/ftest"
rm C:/code/JoeyLibrary/.playwright-mcp/<your copies>.js
```

The background task will then report "failed": that is the kill, not a crash.

## 6. Report

Lead with what changed and what still looks different from the photo. Give each sheet's absolute path, the
numbers (measured or estimated, and from which photo), the counts before and after, the open questions (hinge
side, colours, anything seen but not drawn), and the files changed. Say plainly that nothing is committed.
