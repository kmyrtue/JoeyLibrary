---
name: procedural-cat-threejs
description: Use when modelling, posing or animating a cat (or another furry four-legged animal) in three.js entirely in code - lofted body along a spine curve, shell fur, painted coat textures, two-bone IK legs, a resting-pose table blended by restW, curl/donut on an arc, a follow-the-leader tail, a behaviour loop - or when changing joeylibrary/sim/js/cat.js (Kali, Cisco, Lucifer), its spike page, or judging how a cat looks or behaves against real cats.
---

# Procedural cats in three.js

The cats in the bookshelf room (`joeylibrary/sim/js/cat.js`, exported as `window.CatKit`) are built and moved
entirely in code: no model files and no animation files. This skill describes how that works, how to change it
without breaking it, and how to check a change. The background knowledge (real-cat anatomy and gait, the three cats,
the research on existing work) is in `joeylibrary/sim/CATS.md`. Read it before you change a pose or a coat.

Three.js is **r128** (vendored). Use `outputEncoding`/`sRGBEncoding`, `mapTexelToLinear` and `convertSRGBToLinear`.
Do not use the r152+ colour-management names.

## When to build it this way

Build in code rather than load a rigged glTF from Sketchfab when the animal must be **steered** around a room:
walk to points, climb onto furniture and rest in poses chosen at run time. A canned walk cycle cannot do that.
A rigged model can still be dropped in later, but it will need this kind of gait code to drive it.

## The model, part by part

Everything lives in `make(opts)`. Units are metres. The cat works in its own frame: `root` (scaled by `coat.scale`)
holds `inner` (lifted by `C.lift` for hops). y = 0 is the floor under it, and +z is forward at heading 0.
`frameOf(h)` gives `f` (forward) and `r` (right).

1. **Spine:** a `CatmullRomCurve3` of 7 points. In order they are: behind the hips, the hips, the mid back, the
   chest, the base of the neck, the mid neck and the back of the head. Standing, `spineFrom()` builds the points
   from the hips, chest and head. Resting, they are lerped to the pose's points. Curled up, each point sits on a
   circle (see 5).
2. **Body loft:** `loftGeometry(40 rings, 28 segments)`. Each ring is an ellipse across the spine tangent, and its
   size comes from `KEYS` (u along the spine: half width, half height and centre drop). The whole cat is one surface
   from the rump to inside the head, so there is no seam at the neck. `plump`, `slim`, `wS` and `hS` scale it, and
   the belly sags a little on plump coats. Recompute the normals every frame (`computeVertexNormals`). The fur
   shells share them.
3. **Legs:** each leg is one lofted tube through 5 points (inside the body, shoulder/hip, elbow/knee, wrist/hock,
   paw), with `radii` per point. The joints come from `ik(a, target, l1, l2, pole)`, a two-bone IK solved with the
   law of cosines:
   - The front pole points **back**, so the elbow points back.
   - The hind pole points **forward**, so the knee points forward and the hock back.
   - The hind haunch radius is large (0.043). Without it the hind legs read as bent tubes.
   - A loft ring frame must start perpendicular to the leg, otherwise the tube collapses flat.
4. **Head:** a group of spheres scaled into ovals: the cranium, muzzle, chin, nose, eyes with slit pupils, open cone
   ears with an inner cone, and line-segment whiskers. Coat painting covers the cranium. The muzzle, chin and nose
   are flat colours.
5. **Curl and donut:** the spine points go on an arc `arc(th, y, r)` round the cat's spot. The arc radius is
   `SEGSUM / span`, so the segments keep their standing lengths and the body does not stretch.
   - `CURL.span` is 5.0 rad, for the bed.
   - `RING.span` is 5.45 rad, for the donut: nearly a full circle, with the nose at the tail root.
   - Each pose's `roll` turns every body ring about the spine tangent, which lays the cat on its side.
   - The legs are rebuilt in the rolled frame: `r2` runs across, `u2` points out of the back and `dn` points to the
     belly. In the donut they tuck into the middle of the ring. Lying flat they lie out loose, and the upper legs
     sag onto the lower ones.
6. **Tail:** a 15-link follow-the-leader chain (`TL` 2 cm), lofted with `tailR(k)`.
   - Each link's target direction is a pitch/yaw recipe: raised with a hooked tip when walking, low with the tip up
     when standing, flat and curling round when resting.
   - Each link eases towards its target and is then re-stretched to its link length, with a y floor of 1.2 cm.
   - Rest overrides: in the donut the tail lerps onto a smaller arc inside the ring, over the paws. With `PZ.hug`
     (loaf, sit) it goes round the haunch on a quarter ellipse and then forward along the flank.
7. **Fur:** shell fur. `addFur(mesh)` adds an `InstancedMesh` of `SHELLS` copies (18 in the spike, 12 in the room)
   sharing the source geometry, plus a `shellK` instance attribute (0..1).
   - `furPatch` (`onBeforeCompile`) pushes each shell out along the normal by `furLen*shellK`, then bends it with
     gravity and with `furComb`, the way the hair lies (back along the body, down the legs, out along the tail).
   - The fragment shader keeps a cone per hash cell that narrows with height and stops at its own random length.
     The roots are darker, and each hair samples its colour a little off its root, so patch edges are soft.
   - `furShort` shortens fur near the nose and the rump end. `furHole` keeps fur off the eyes and nose.
   - `furSign: -1` is for lofts whose winding points their normals inwards (the tail and legs).
8. **Coat painting:** `paint(w, h, fn, blur, srgb)` fills a canvas pixel by pixel from a coat function, then blurs it
   on a 3×3 tiling so the blur wraps round the seam.
   - The body canvas x runs rump to head and y runs round the ring, so `body(u, cos a, sin a)` gets the position
     along the body and the ring angle (`sa > 0` is the back).
   - The head is painted in sphere UV, giving `head(x, y, z)` on a unit sphere with z = forward.
   - The tail is a 1-D strip, giving the rings.
   - Patches are thresholded fbm. The calico picks black or ginger by a second fbm inside a region mask.
9. **Gait:** a phase oscillator with per-leg offsets (`LEGS[].walk` / `.trot`). `duty` goes from 0.64 (walk) to 0.42
   (trot), blended by `C.gait = smooth(0.75, 1.15, speed)`. A leg swings when its phase passes `duty`.
   - The landing target is predicted from the velocity and the turn rate over the remaining swing time.
   - The swing arc is a sine lift of 4.5 cm at the front and 3.8 cm at the back.
   - Standing still, the paw furthest from its neutral spot steps, one at a time.
   - The spine bends into turns (`C.bend`), and the back bobs twice per stride.
10. **Resting poses:** `POSES` is a table (see below). `C.restW` ramps 0→1 over `rise` seconds in `rest` and back
    down otherwise. Every pose quantity is `lerp(standing, pose, smooth(restW))`. Adding a pose usually means
    adding a row, not new code.
11. **Behaviour:** the states are `go → idle → (circle) → rest → idle`. `goTo(worldPoint, {then, circle, face, wait,
    after, exact})`. The world object decides everything about the place:
    - `pick(cat)` chooses the next goal
    - `groundAt(x, z)` gives the surface height; a step of more than 4 cm becomes a 0.34 s hop
    - `restFor(kind)` overrides how long a rest lasts
    - `stay(cat)` keeps it lying for another round
    - `command(cat, what)` handles the spike's buttons

    `roomCat()` is Lucifer's world on top of the box room:
    - a keep-out rectangle with corner routing round the couch, so she walks round it and never through it
    - edge peering
    - CRT-look material swap
    - her spot saved through `Store.saveCase('cats', …)`

### POSES row fields

`rise` (s to settle), `dur` [min, max] s, `hips`/`chest`/`head` [forward, up] m from the spot, `pitch` (+ = nose
down), `look` (how much it looks about), `eyes` (open 0..1), `wS`/`hS` (body width and height scale), `feet` per leg
LF RF LH RH [forward, out] from the shoulder or hip (`null` keeps the paw where it stands), `a` (wrist fold), `b`
(hock fold), `tail` (rad of curl round the body), `hug` (tail along the flank at this distance), `roll` (rad onto
the side), `ring` (donut spine).

## Conventions and pitfalls (each one cost a round of user feedback)

- **Positive roll puts the back away from the paws**, so the belly faces the inside of the ring. If a donut "bends
  the wrong way", **do not flip the ring or the roll**: that puts the legs outside the ring. Check the **head roll**
  first. The head must roll **with** the body (`rollP = -PZ.roll*0.82` lying flat, `-1.15` in the donut). With the
  opposite sign the head twists against the body, and the cat looks as if its spine is bent backwards.
- **Sheen over fur:** the skin loft under the shells must be fully matt (`roughness 1`) and darker (×0.72). A
  specular highlight on the skin shows through and over the shells and erases the hair, worst on a black coat seen
  from above. Give a sleek coat its shine through the shells' `rough` instead (0.74 for Lucifer, not lower).
- **Tail tucked, never sticking out:** resting cats hold the tail against the body (round the haunch in a loaf or
  sit, inside the ring over the paws in a donut). A little clipping into the body is fine. A tail sticking out
  sideways is not.
- **Sitting:** the hind paws come right in under the haunch (`feet` [0.072, 0.04] from the hip, `b` 1.5). The whole
  hind leg folds flat against the body. Paws placed forward of that look wrong at once.
- **Eating:** lower the chest as well (`chest` y 0.172 against 0.2 standing). The neck curves down and the mouth
  reaches the bowl. A stiff chest with the neck dropping straight down looked "really weird".
- **Mostly resting:** real house cats rest most of the time. The user wants Lucifer lying down **98–99%** of the
  time: rests of 2–5 min, half of them continued in place (`stay`), 85% of the rest resettling where she is, and
  otherwise one or two walks before lying down somewhere else. Measure it (`lying-sim.js`). Do not guess.
- **Start lying and remember where:** she starts out already lying (`settle()`), at the spot, heading and pose saved
  last time.
- **Colour space:** the spike renders sRGB with ACES tone mapping, and `srgb: true` converts the coat colours to
  linear in `cat.js`. The room (since `js/lamp.js`) also outputs sRGB with ACES, but it converts every material's
  colour, emissive and map to linear in the shader itself (a `LIN_IN` define). So the room cat must keep
  `srgb: false`: `true` would convert the colours twice and the coat would come out too dark. The room's main light
  is now the lamp on the brick wall, so Lucifer is lit dimly from the side. Any shader patch that replaces
  `#include <map_fragment>` (the fur shells' `furPatch` does) must honour `LIN_IN` itself (`sRGBToLinear` on the
  texel under `#ifdef LIN_IN`, else `mapTexelToLinear`), or that layer comes out too light: the fur went grey over a
  black skin until it did. Don't touch the flag.
- **Patch edges:** hard thresholds make stair-stepped patches. Blur the canvas (`paint` blur 4) and let the shells
  jitter their colour lookup (`furJitter`).
- **Ear scale:** translate the ear geometry so its base is at the origin before scaling, otherwise bigger ears float
  off the head.
- **Shadow cost:** the fur shells receive shadows but do not cast them. Only the lofts cast.
- **CSS `hidden`:** the spike's panel uses `display: grid`, which overrides `[hidden]`. Give `[hidden]` its own `display: none` rule so it wins.

## Performance budget (measured)

- One cat with fur: 97k triangles at 12 shells (room, measured). Without fur it is 8.7k, so each shell adds about
  7.4k, which makes about 141k at 18 shells (spike, computed).
- Both hold 60 fps in headless Chromium with ANGLE/D3D11.
- Per frame the CPU work is the body loft (40×29 vertices), 4 leg lofts (20×13) and the tail (16×13), plus their
  normals. Keep the ring counts at about these sizes.
- Each further shell costs one instanced draw of every furred part. Cut shells before you cut rings.
- In the room, `update` runs only while `#vRoom` is shown. The terminal (CRT) look turns the fur off.

## Verification loop (always look, never assume)

Scripts are in `scripts/`. They use the global Playwright (`%APPDATA%/npm/node_modules/playwright`), and Chromium
runs with `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist` so WebGL is hardware-accelerated.

- `dbg.js <out.png> <coat> <pose|none> <az> <pol> <r> [fur 0/1] [bones 0/1] [js]`: one shot of the spike
  (`SPIKE=path/to/cat-gait.html`, which loads `cat.js` from beside it). With `fur 0` you see the loft. With
  `bones 1` you see the IK skeleton.
- `shots.js <outdir> <poses...>`: every coat in each pose, a 3/4 view and a top view, plus fps and page errors.
- `room.js <outdir> <name> <x> <y> <h mm> <yaw> <pitch> [js] [wait ms]`: a shot of the real room with
  `Game.lookFrom`, plus statics count, cat state, room position, triangles and fps. Hide the start card with js
  `document.getElementById('start').style.display='none'`. Trigger behaviour with `Game.R.cat.where.toEdge()`,
  `.lie()` and so on. Pin `Math.random` around the call for a repeatable choice.
- `lying-sim.js`: two simulated hours of behaviour, giving the lying percentage, the rests taken and the walks; then
  a reload to check the saved spot. **It writes to the store, so run it against a test library.**

The loop for any change:

1. Back up `cat.js`.
2. Patch with an assert-count-1 replace script.
3. Run `node --check`.
4. Copy `cat.js` next to the spike.
5. Shoot each affected pose for at least two coats, from the side **and** from above. Also shoot with `fur 0` when
   the shape changed.
6. Look at every image yourself before you report.
7. Send the user the images (they follow from another device).

Sim files only need a page reload. Do not restart the app.

Before you call a pose done, run it past the anatomy and behaviour checklist in `CATS.md`.
