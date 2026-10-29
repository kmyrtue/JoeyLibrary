---
name: room-model-from-photos
description: Use when adding, reshaping or detailing anything in JoeyLibrary's 3D room (joeylibrary/sim/js/room.js, furniture.js), such as furniture, doors, casings, panels, handles, knobs, mouldings or textures, especially when the user supplies photos of the real piece and wants it to "look like the real one". Covers turning photos into dimensioned procedural three.js geometry, the room's coordinate and helper conventions, materials, and the budgets (statics, triangles) to stay within. Pair with room-render-compare to check the result.
---

# Modelling the room's pieces from photos

The 3D room is a static three.js r128 page (`joeylibrary/sim/`, no CDN, works offline). Everything is built in code:
`room.js` builds walls, doors and the BILLY bookcases, and `furniture.js` adds the other furniture as movable units. There
are no model files. A piece "looks right" when its proportions, its few telling details and its colour match the photo.
The geometry does not need to be exact.

## 1. Gather numbers before shapes

1. **Read the measured sizes first.** The `M` object at the top of `room.js` holds the room's measurements. The
   furniture comments mark which sizes were *measured*. Never change a measured outer size to make a detail fit.
   Fit the detail inside it.
2. **List the photos of the piece** and make a contact sheet of all of them (`room-render-compare/scripts/sheet.py`).
   Pick the photo that shows the piece most squarely and the one that shows the detail closest. Crop close-ups with
   `scripts/crop.py src out x0 y0 x1 y1 scale`. A 4x crop of a small region shows what a detail really is.
   Example: the chatol's "drop handles" turned out to be two small leaf plates with a swan-neck bail between them,
   not one big plate. That only showed at 4x.
3. **Estimate sizes from known references in the same photo.** Measure in pixels along the same plane and at the
   same depth:
   - a measured width or height of the same piece or opening (the door openings, the nook widths, the drawer pitch)
   - standard parts: a door leaf is 40 mm thick, a lever handle about 1020 mm up, a 50 mm rosette, brick courses
     about 65 + 10 mm, hinges 250 mm in from the top and bottom
   - perspective: only compare lengths that lie on the same face. A row of handles seen at an angle is
     foreshortened sideways but not in height, so take heights from it and estimate widths.
4. **Write the numbers down as fractions and mm.** Examples: rails at 0.335 and 0.53 of the leaf height; plates
   0.4 of a drawer tall. Fractions survive when a measured size changes.
5. **Ask the user rather than guess** when a photo cannot settle it and the choice is visible: which side the
   hinges and handle are on, whether a door opens in or out, the colour of something in a dim photo, or whether a
   part seen at an edge is a hinge or a catch. If you must go on, pick the usual answer and **mark it as estimated**
   in the code comment and in your report.

## 2. Settle shapes in FreeCAD first (for anything curved or rounded)

FreeCAD 1.1 can run headless-ish from a job script. `scripts/fc_run.py` opens the GUI minimized, runs a job, and
quits without ever showing a dialog:

```bash
FC_JOB=/abs/path/my_job.py "<FreeCAD>/bin/freecad.exe" scripts/fc_run.py   # log: my_job.py.log
```

The job defines `after_gui(shot, log)`. It builds the parts with `Part` and real fillets, checks
`o.Shape.isValid()`, saves `.FCStd` and renders views with `v.saveImage(...)`. See `scripts/door_job_example.py`,
which built the nook and kitchen doors. Keep every number in a block at the top of the job and mirror the same names
in the JS comment. Compare the FreeCAD render with the photo before writing any three.js. It is much quicker to fix
proportions there. If FreeCAD isn't installed, use a portable build in the scratchpad (download it into its own empty
folder). Its `bin/python.exe` runs with `-I`.

## 3. Conventions in the code

- **Units and axes.** Room (x, y, height) in mm maps to three (X = x, Y = height, Z = -y) in metres; use
  `mm(v)`. Without the minus the room comes out mirrored. Room x runs from the window wall towards the nooks; y
  runs from the kitchen wall to the back wall.
- **`box(x0,x1,y0,y1,z0,z1,color,kind,opts,tex)`** draws a box *and* pushes a static collision box. Use it only
  for things you walk into or books fall onto.
- **`trim(...)` (`room.js`)** is a look-only box with optional rounded edges r, made from an ExtrudeGeometry with a
  bevel. It keeps the plain box in `geometry.userData.outline`, so the terminal (CRT) look outlines it as a clean
  box. Use it for all detail.
- **`solidBox(...)`** is a static with nothing drawn. A detailed door is many `trim`s plus one `solidBox`, so the
  physics never sees the detail.
- **`doorKit(across, face, out)`** builds a door in its own frame: u across the opening, v out of the leaf face
  towards the room, z up. It has `box`, `lever(u, s)`, `hinges(u, z0, z1)` and `pine(u0, u1, z0, z1)` for the
  panelled leaf. Add new door kinds as methods here instead of copying room coordinates around.
- **`lever(x, y, z, nx, ny, ax, ay)`** draws a handle group: rosette, key plate with keyhole, neck, bar and ends.
  `hinge(x, y, z)` draws a lift-off hinge.
- **Furniture (`furniture.js`)** is built per unit in a frame: a across, d out from the back, z up, in mm, parented
  to `u.frame`. The helpers are:
  - `slabGeo(sx, sy, sz, r)`: a rounded board
  - `extrude(shape, t, r, seg, curve)` plus `smooth(geo)`: cast or cut flat shapes
  - `cut(u, plane, pts, at, t, look, r, holes)`: a profile cut out of a board
  - `turned(u, prof, ...)`: lathe parts such as knobs and feet
  - `sweep`: mouldings along a path
  - `deco(u, geo, look, a, d, z, parent)`: places any mesh, with position (a, z, -d)
  - `glass`
  - `holes`: shelf-pin rows

  New pieces are a `def(type, name, build)` in `types`, so they can be added, moved and taken out from the
  menu. Books stand on `u.surface(...)` boards. Keep those plain.
- **Things that follow a curved front** (handles on a serpentine drawer): put each part in its own small group at
  its own `a`, with `position = front(a)` and `rotation.y = atan(slope(a))`. Build connecting wires (bails) as a
  `TubeGeometry` on a `CatmullRomCurve3` whose points use `front(a)` at each a.
- **ExtrudeGeometry winding (r128).** Give the outer contour anticlockwise and holes clockwise. A shape mirrored
  with `x -> -x` flips its winding, so reverse its points. Otherwise the hole is not cut.

## 4. Materials and colour

- Textures are a few CC0 scans in `sim/tex/` (oak_veneer, walnut_veneer, plaster, brick, planks, floor). New woods
  are **the oak veneer tinted**. Examples: `TEX.doorpine = { file: 'oak_veneer', size: 1.8, tint: 0xc88a50 }`,
  `TEX.pine`, `TEX.kallax`, `TEX.palewood`. Each mesh has a flat colour too, which the "Flat colours" look shows.
  Pass both as a `[color, texName]` pair. Keep the flat colour close to the tinted texture.
- Put colours in tokens (`COL`, `C`, `DOOR`), not inline, and name them after the real thing (`door`, `groove`,
  `shade`, `steel`).
- Pick tints from the photo under its own light: sample a mid-tone patch, not a highlight. Warm indoor photos run
  orange, so step towards neutral. A weathered pale casing read as 0xc4b49c, not the yellow first guess.
- Room meshes on `scene` get world-space UVs (`worldUV`, scale `size` metres per image). Parts parented to a group
  (`own`) keep their geometry UVs, and furniture boards call `boardUV` so the grain runs along the board.
- **Relief under about 10 mm doesn't show.** The shadow map is about 7 mm per texel and there is no AO. Proud rails,
  grooves and panel edges vanished until they got help:
  - grooves drawn as thin dark strips 0.6 mm proud (`DOOR.groove`)
  - dark shade strips along the stile edges and under each proud rail (`DOOR.shade`)
  - a slightly lighter tint on surfaces that catch the light (`TEX.doorrail`)

  Say so in a comment: they are a drawing trick, not geometry.

## 5. Budgets

- **Statics.** Count `Game.R.statics.length` before and after. Detail work must not change it. A door or a
  handle adds 0 or 1 static, never one per part.
- **Triangles.** Sum the index count of `Game.R.parts` divided by 3; the snippet is in room-render-compare. The
  whole room with furniture was about 45k after detailing, and 8 chatol pulls cost about 6k. Keep curve segments
  low (`bevelSegments` 1–2, `curveSegments` 1–6, outline shapes of 32–48 points) and round only what the eye sees.
- **Behaviour must not change.** Check these:
  - book surfaces still take books
  - pieces still move, add, take out and put back
  - the terminal look outlines new parts (`userData.outline` for rounded boxes)
  - no new page errors

## 6. Backups and edits

- Before editing, copy `room.js` and `furniture.js` to the scratchpad (`room.orig.js`, then one copy per stage,
  such as `room.pre_doors.js`). The compare shots use them for "before" by routing the script (see
  room-render-compare).
- `room.js` may be CRLF or LF. Script edits must read with `newline=''`, keep whichever ending is there, and assert
  each replaced snippet occurs exactly once. Bash heredocs mangle `\r\n`, so write edit scripts with the Write tool.
- Other agents may be editing `room.js` at the same time (lights, couch). Keep your edits to your own blocks,
  prefer small unique `Edit`s, and re-read before each edit.
- Syntax-check after each edit:
  `node -e "new Function(require('fs').readFileSync('joeylibrary/sim/js/room.js','utf8'))"`.
- Don't commit unless asked.

## 7. Comment what is estimated

Every block gets a comment that names:
- the source photo (for example `photo 214036`)
- which numbers are **measured** and which are **estimated**, with how they were estimated (for example "0.4 of a
  drawer tall; spacing estimated, the photo is at an angle")
- deliberate departures (for example "shown closed though it stands open in the photo: the kitchen is not built")
- anything seen but not drawn (for example "a white fitting on the frame: a second hinge or a catch, not drawn")

Report the same list to the user, with the open questions first.

## Mistakes that cost a round trip

- **Modelling the first impression of a detail.** One "blobby" plate instead of the real two-plate pull. Zoom in
  4x on the photo before modelling any small part.
- **Taking the "before" from the wrong baseline.** For a follow-up request, before is what the user last saw, not
  the original file. Keep a backup per stage.
- **A camera that sees nothing.** Without `?lib=1` the page looks for `data/books.json` and renders black. Load
  `/sim-files/index.html?lib=1&view=vRoom`.
- **Details too fine to see.** See the relief note in section 4. Check at a normal viewing distance, not only in a
  macro shot.
- **Colours tuned under the textured look only.** Always look at Flat colours and the terminal look too.
