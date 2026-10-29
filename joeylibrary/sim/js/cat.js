// Procedural cats: a lofted body, lofted legs on two-bone IK, a follow-the-leader tail, shell fur, and a small mind
// that walks between resting places. Shared by the room (the black cat on the box room, roomCat) and the cat gait
// spike page. No model or animation files: every vertex is placed here, every frame.
// Joey's cats (Kali, Cisco, Lucifer), the real-cat anatomy, gait and behaviour this follows, the research behind it
// and the user's corrections are in ../CATS.md; how to change and check it is in the project skill
// .claude/skills/procedural-cat-threejs/SKILL.md.
// How it is built, in the order of the code below:
//   coats     COATS: colours plus three functions that paint the body, head and tail textures
//   poses     POSES: one row per resting pose; C.restW (0 standing .. 1 settled) blends everything towards it
//   fur       furPatch: shell fur, SHELLS instanced copies of each part pushed out along the normals
//   body      one loft (rings of ellipses, sized by KEYS) along a 7-point spine curve, rump to inside the head
//   legs      a loft each through shoulder/hip, elbow/knee, wrist/hock and paw; joints by ik(), paws by the gait
//   tail      a 15-link follow-the-leader chain, lofted
//   update    behaviour (go, idle, circle, rest), gait, spine, head, body, legs, tail, hops, once per frame
// Units are metres. Three.js r128 (sRGBEncoding, mapTexelToLinear). Sign conventions: heading 0 faces +z, frameOf(h)
// gives f (forward) and r (the cat's right); a pose's pitch > 0 is nose down; roll > 0 turns the back away from the
// paws, so in a donut the belly is on the inside of the ring and the head must roll the same way (see update).
// CatKit.make(opts) builds one cat; the caller says where it lives through opts.world:
//   pick(cat)            choose where to go next (cat.goTo), when the cat has nothing to do
//   groundAt(x, z)       the height of what the cat stands on at world (x, z), or undefined for the root's own floor
//   command(cat, what)   optional: a button; return true when handled
// A cat works in its own frame (root, scaled by its coat): y = 0 is its floor. goTo and the world take world points.
(function (g) {
  'use strict';
  const T = g.THREE, V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z), UP = V(0, 1, 0);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mod = (a, n) => ((a % n) + n) % n, wrap = a => mod(a + Math.PI, 2 * Math.PI) - Math.PI;
  const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  function vnoise(x, y) {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, y) => vnoise(x, y) * .62 + vnoise(x * 2.1 + 5.3, y * 2.1 + 1.7) * .28 + vnoise(x * 4.3 + 9.1, y * 4.3 + 3.9) * .10;

  // paint a texture: fn(x, y) in 0..1 gives a colour
  function paint(w, h, fn, blur, srgb) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const gc = c.getContext('2d'), img = gc.createImageData(w, h), k = new T.Color();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      k.set(fn((x + 0.5) / w, (y + 0.5) / h)); const i = (y * w + x) * 4;
      img.data[i] = k.r * 255; img.data[i + 1] = k.g * 255; img.data[i + 2] = k.b * 255; img.data[i + 3] = 255;
    }
    gc.putImageData(img, 0, 0);
    if (blur) {  // soften the patch edges; the edges wrap, so blur a 3 x 3 tiling and keep the middle
      const t = document.createElement('canvas'); t.width = w * 3; t.height = h * 3; const tg = t.getContext('2d');
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tg.drawImage(c, i * w, j * h);
      const b = document.createElement('canvas'); b.width = w * 3; b.height = h * 3; const bg = b.getContext('2d');
      bg.filter = `blur(${blur}px)`; bg.drawImage(t, 0, 0); gc.clearRect(0, 0, w, h); gc.drawImage(b, -w, -h);
    }
    const tex = new T.CanvasTexture(c); if (srgb) tex.encoding = T.sRGBEncoding; tex.anisotropy = 4;
    return tex;
  }

  // ---------- coats: the three cats ----------
  // scale: size against the calico; ears, slim, furK (fur length), rough (a sleek coat shines a little), pupil (width)
  // plump widens the middle of the body and lets the belly hang a little. The painting functions return a colour:
  //   body(u, ca, sa)  u 0 at the rump .. 1 at the head, (ca, sa) = cos, sin of the angle round the ring: sa > 0 is the
  //                    back, sa < 0 the belly, ca the sides
  //   head(x, y, z)    a point on the unit sphere of the cranium: z forward (the face), y up, x across
  //   tail(k)          k 0 at the root .. 1 at the tip
  // legs: LF, RF, LH, RH, the colour of each upper leg (the paws take `white`). Colours are sRGB hex.
  const COATS = {
    calico: {  // Kali: white, with black and ginger patches on the back and head, a ringed ginger tail with a black tip
      name: 'Kali', white: '#f2eee7', black: '#1e1b19', ginger: '#cf7a37', eye: '#b8c14c', inner: '#d9a1a0', nose: '#d58c8c', plump: 1.1,
      body(u, ca, sa) {
        const region = smooth(0.03, 0.08, u) * (1 - smooth(0.56, 0.62, u)) * smooth(-0.1, 0.3, sa + (fbm(u * 4.2 + ca * 1.2 + 3, sa * 1.3 + 7) - 0.5) * 1.1);
        if (region < 0.5) return this.white;
        return fbm(u * 6.5 + 11 + ca * 1.4, sa * 1.6 + ca * 0.8 + 2) > 0.5 ? this.black : this.ginger;
      },
      tail(k) { if (k > 0.86) return this.black; if (k < 0.08) return this.white; return Math.sin(k * 30) > 0.25 ? this.black : this.ginger; },
      head(x, y, z) {
        if (z > 0.5 && Math.abs(x) < 0.28 + (0.9 - y) * 0.15 && y < 0.55) return this.white;  // the white blaze and muzzle
        if (y < -0.25 + z * 0.2) return this.white;  // chin and throat
        if (x > 0.15 && y > 0.25 && z < 0.6) return this.ginger;  // the ginger patch over one ear
        return this.black;
      },
      ear: '#1e1b19', legs: ['#f2eee7', '#f2eee7', '#f2eee7', '#f2eee7'],
    },
    ginger: {  // Cisco: orange tabby back and head, white chest, belly, legs and muzzle
      white: '#f6f0e5', ginger: '#d98b40', stripe: '#b2652a', eye: '#d6b23a', inner: '#e0a49a', nose: '#d98a80', plump: 1.0,
      body(u, ca, sa) {
        const n = fbm(u * 4 + ca + 1, sa * 1.4 + 5);
        const top = sa > -0.3 + (n - 0.5) * 0.6 && !(u > 0.6 && sa < 0.55);
        if (!top) return this.white;
        return Math.sin(u * 52 + n * 5 + Math.abs(ca) * 2) > 0.45 ? this.stripe : this.ginger;
      },
      tail(k) { if (k > 0.9) return this.stripe; return Math.sin(k * 34) > 0.35 ? this.stripe : this.ginger; },
      head(x, y, z) {
        if (z > 0.55 && Math.abs(x) < 0.3 + (0.6 - y) * 0.25 && y < 0.2) return this.white;
        if (y < -0.2 + z * 0.2) return this.white;
        if (y > 0.45 && Math.sin(x * 26) > 0.55) return this.stripe;
        return this.ginger;
      },
      ear: '#d98b40', legs: ['#f6f0e5', '#f6f0e5', '#d98b40', '#f6f0e5'],
    },
    black: {  // Lucifer, the third cat: a little smaller and slim, short sleek black fur with a brown cast in the light, big ears
      name: 'Lucifer', white: '#1a1716', black: '#110f0e', sheen: '#2c2521', eye: '#c6c23c', inner: '#4d3433', nose: '#2b2224', plump: 0.94,
      scale: 0.9, ears: 1.22, slim: 0.94, furK: 0.72, rough: 0.74, pupil: 0.5,
      body(u, ca, sa) { const n = fbm(u * 9 + ca * 2 + 4, sa * 3 + 1); return n > 0.63 ? this.sheen : n > 0.4 ? this.white : this.black; },
      tail(k) { return Math.sin(k * 23) > 0.7 ? this.sheen : this.white; },
      head(x, y, z) { return fbm(x * 4 + 2, z * 4 + y * 3) > 0.6 ? this.sheen : this.white; },
      ear: '#151211', legs: ['#171413', '#171413', '#171413', '#171413'],
    },
  };

  // ---------- resting poses ----------
  // Where the hips, chest and head go (forward, up from the cat's spot, in m), the head's pitch, how much it looks
  // about, how open the eyes are, how wide and tall the body is, where the paws go from the shoulder or hip (forward,
  // out; null keeps the paw where it stands), the wrist and hock angles, and how far the tail curls round (rad).
  // roll: the body turned onto its side (rad), the back away from the paws; ring: the spine bent round into a donut.
  // rise: seconds to settle into it (and to get up); dur: [min, max] seconds it lasts (world.restFor can override);
  // a, b: how far the wrist and hock fold (rad; walking they swing from about 0 and 0.38); tail: how far it curls
  // round the body, to the side C.tailSide; hug: instead, the tail lies round the haunch and along the flank this far
  // out (m). curl and donut have no hips/chest/head: the spine goes on an arc (CURL, RING) instead. Real cats sit
  // with the hind paws right under the haunch and rest with the tail against the body, never sticking out (CATS.md).
  const POSES = {
    sit: { label: 'sitting', rise: 0.9, dur: [8, 18], hips: [-0.1, 0.075], chest: [0.085, 0.215], head: [0.15, 0.305], pitch: -0.05, look: 1, eyes: 0.95,
      wS: 1.04, hS: 1, feet: [null, null, [0.072, 0.04], [0.072, 0.04]], a: 0, b: 1.5, tail: 3.0, hug: 0.085 },
    loaf: { label: 'loafing', rise: 1.5, dur: [14, 30], hips: [-0.115, 0.07], chest: [0.115, 0.08], head: [0.215, 0.145], pitch: 0.12, look: 0.45, eyes: 0.35,
      wS: 1.13, hS: 0.92, feet: [[-0.03, 0.03], [-0.03, 0.03], [0.08, 0.055], [0.08, 0.055]], a: 1.6, b: 1.4, tail: 2.6, hug: 0.092 },
    curl: { label: 'asleep in the bed', rise: 1.8, dur: [25, 45], pitch: 0.2, look: 0, eyes: 0,
      wS: 1.1, hS: 0.85, feet: [[0.04, 0.025], [0.04, 0.025], [0.07, 0.04], [0.07, 0.04]], a: 1.6, b: 1.3, tail: 2.4 },
    donut: { label: 'curled up in a donut', rise: 2.0, dur: [30, 60], pitch: 0.55, look: 0, eyes: 0, roll: 1.3, ring: true,
      wS: 1.06, hS: 0.92, feet: [null, null, null, null], a: 1.5, b: 1.5, tail: 3.4 },
    side: { label: 'lying flat on her side', rise: 1.7, dur: [25, 55], hips: [-0.122, 0.062], chest: [0.122, 0.064], head: [0.25, 0.062], pitch: 0.05, look: 0.2, eyes: 0.15,
      roll: 1.42, wS: 1.08, hS: 0.94, feet: [null, null, null, null], a: 0.3, b: 0.5, tail: 0.9 },
    peer: { label: 'looking over the edge', rise: 1.1, dur: [5, 12], hips: [-0.105, 0.085], chest: [0.105, 0.098], head: [0.235, 0.1], pitch: 0.95, look: 0.6, eyes: 1,
      wS: 1.08, hS: 0.95, feet: [[0.035, 0.032], [0.035, 0.032], [0.08, 0.055], [0.08, 0.055]], a: 1.45, b: 1.4, tail: 2.2 },
    eat: { label: 'eating', rise: 0.6, dur: [6, 10], hips: [-0.125, 0.178], chest: [0.11, 0.172], head: [0.245, 0.075], pitch: 0.95, look: 0, eyes: 0.7,
      wS: 1, hS: 1, feet: [null, null, null, null], a: 0.15, b: 0.6, tail: 0 },
  };
  // curled up: the spine on a circle round the cat's spot, the segments as long as when standing
  // SEG: the standing lengths (m) between the 7 spine points (behind the hips, hips, mid back, chest, neck base, mid
  // neck, back of the head). span: how much of the circle they cover (rad; 2*pi would close it: the donut's 5.45
  // brings the nose to the tail root); y: the height of each point on the circle. r follows, so nothing stretches.
  const SEG = [0.075, 0.122, 0.122, 0.068, 0.045, 0.045], SEGSUM = SEG.reduce((a, b) => a + b);
  const CURL = { span: 5.0, y: [0.035, 0.06, 0.065, 0.06, 0.055, 0.05, 0.045] }, RING = { span: 5.45, y: [0.05, 0.056, 0.058, 0.058, 0.057, 0.055, 0.052] };
  CURL.r = SEGSUM / CURL.span; RING.r = SEGSUM / RING.span;
  const frameOf = h => ({ f: V(Math.sin(h), 0, Math.cos(h)), r: V(-Math.cos(h), 0, Math.sin(h)) });

  // ---------- fur: shells ----------
  // Each furry part is drawn `shells` more times, every copy pushed a little further out along the normals and bent
  // down and back with gravity and the lie of the coat. The fragment shader keeps only the pixels inside a strand, a
  // cone that narrows with height and stops at its own length, so together the copies make hairs. The roots are
  // darker, as under a real coat, and each hair picks its colour a little off its root, so patch edges are soft.
  const furGravity = { value: V(0, -0.38, 0) };
  function furPatch(sh) {
    Object.assign(sh.uniforms, this.userData.fur);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute float shellK, furShort; attribute vec3 furComb;
      uniform float furLen, furSign; uniform vec3 furGravity; uniform vec4 furHole0, furHole1;
      varying float vFurK; varying vec2 vFurUv;`).replace('#include <begin_vertex>', `
      vec3 transformed = vec3( position );
      float furL = furLen * ( 1.0 - furShort );
      if ( furHole0.w > 0.0 ) furL *= smoothstep( furHole0.w, furHole0.w * 1.8, distance( position, furHole0.xyz ) );
      if ( furHole1.w > 0.0 ) furL *= smoothstep( furHole1.w, furHole1.w * 1.8, distance( position, furHole1.xyz ) );
      vec3 furG = ( vec4( furGravity, 0.0 ) * modelMatrix ).xyz + furComb;
      transformed += normalize( objectNormal ) * furSign * furL * shellK + furG * furL * shellK * shellK;
      vFurK = shellK; vFurUv = uv;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec2 furDensity; uniform float furJitter;
      varying float vFurK; varying vec2 vFurUv;
      float furHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      vec2 furSt = vFurUv * furDensity, furCell = floor( furSt );
      vec2 furJit = vec2( furHash( furCell ), furHash( furCell + 17.3 ) ) - 0.5;
      float furTop = 0.45 + 0.55 * furHash( furCell + 5.1 );
      vec2 furLean = vec2( furHash( furCell + 31.7 ), furHash( furCell + 47.3 ) ) - 0.5;
      float furR = length( fract( furSt ) - 0.5 - furJit * 0.3 - furLean * 0.6 * vFurK );
      if ( vFurK > furTop || furR > 0.66 * ( 1.0 - vFurK / furTop ) ) discard;`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        // in the room (lamp.js) LIN_IN says the colours are sRGB and must be made linear here, as its map_fragment does
        #ifdef LIN_IN
          diffuseColor *= sRGBToLinear( texture2D( map, vUv + furJit * furJitter ) );
        #else
          diffuseColor *= mapTexelToLinear( texture2D( map, vUv + furJit * furJitter ) );
        #endif
      #endif
      diffuseColor.rgb *= mix( 0.62, 1.08, vFurK ) * ( 0.86 + 0.28 * furHash( furCell + 9.7 ) );`);
  }

  // a tube of `rings` rings with `segs` + 1 vertices each (the last repeats the first, for the texture seam)
  function loftGeometry(rings, segs) {
    const gm = new T.BufferGeometry(), idx = [], n = segs + 1, uv = new Float32Array(rings * n * 2);
    for (let r = 0; r < rings - 1; r++) for (let s = 0; s < segs; s++) {
      const a = r * n + s, b = a + 1, c = a + n, d = b + n;
      idx.push(a, c, b, b, c, d);
    }
    for (let r = 0; r < rings; r++) for (let s = 0; s <= segs; s++) { uv[(r * n + s) * 2] = r / (rings - 1); uv[(r * n + s) * 2 + 1] = s / segs; }
    gm.setIndex(idx);
    gm.setAttribute('position', new T.BufferAttribute(new Float32Array(rings * n * 3), 3));
    gm.setAttribute('uv', new T.BufferAttribute(uv, 2));
    gm.setAttribute('furComb', new T.BufferAttribute(new Float32Array(rings * n * 3), 3));  // which way the hair lies
    return gm;
  }
  // the body's cross-section along the spine: narrow at the rump end, widest at the ribcage (u 0.33), slimmer to the
  // shoulders, then the neck into the back of the head (u 1, inside the cranium, so no seam shows)
  const KEYS = [  // u along the spine curve: half width, half height, centre drop (m)
    [0, .012, .012, 0], [.035, .036, .042, 0], [.16, .056, .062, -.004], [.33, .064, .078, -.014], [.5, .054, .072, -.01],
    [.66, .042, .054, .004], [.83, .037, .042, .004], [1, .028, .03, 0]];
  function profile(u) {
    let i = 0; while (i < KEYS.length - 2 && u > KEYS[i + 1][0]) i++;
    const a = KEYS[i], b = KEYS[i + 1], t = smooth(0, 1, (u - a[0]) / (b[0] - a[0]));
    return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
  }
  // two-bone IK: from joint a towards target t with bone lengths l1, l2, the middle joint bent towards `pole` (law of
  // cosines). Returns the middle joint; the reach is clamped so a too-far target straightens the leg, not breaks it.
  function ik(a, t, l1, l2, pole) {
    const d = t.clone().sub(a); let len = d.length(); const dir = d.divideScalar(len || 1);
    len = clamp(len, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
    const ca = (l1 * l1 + len * len - l2 * l2) / (2 * l1 * len), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
    const n = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    return a.clone().addScaledVector(dir, ca * l1).addScaledVector(n, sa * l1);
  }

  // opts: parent (scene or group), coat (a COATS key or object), world, UI {speed, wander}, srgb (the renderer writes
  // sRGB: colours are converted to linear), shells (fur layers, 18)
  function make(opts) {
    const world = opts.world, UI = opts.UI || { speed: 0.55, wander: true }, SHELLS = opts.shells || 18, srgb = opts.srgb !== false;
    const lin = hex => srgb ? new T.Color(hex).convertSRGBToLinear() : new T.Color(hex);
    const root = new T.Group(), inner = new T.Group(); root.add(inner); (opts.parent).add(root);
    const furred = [];
    function addFur(mesh, o) {
      const src = mesh.geometry, gm = new T.BufferGeometry();
      gm.setIndex(src.index);
      for (const k of ['position', 'normal', 'uv', 'furComb', 'furShort']) if (src.attributes[k]) gm.setAttribute(k, src.attributes[k]);
      gm.setAttribute('shellK', new T.InstancedBufferAttribute(Float32Array.from({ length: SHELLS }, (_, i) => (i + 1) / SHELLS), 1));
      const m = new T.MeshStandardMaterial({ roughness: 1, metalness: 0, side: T.DoubleSide });
      // furHole (x, y, z, radius in the part's own frame): no fur over the eyes and the nose
      const hole = h => ({ value: h ? new T.Vector4(...h) : new T.Vector4() });
      m.userData.fur = { furLen: { value: o.len }, furSign: { value: o.sign || 1 }, furGravity, furHole0: hole(o.holes && o.holes[0]),
        furHole1: hole(o.holes && o.holes[1]), furDensity: { value: new T.Vector2(...o.density) }, furJitter: { value: 2.5 / o.density[0] } };
      m.onBeforeCompile = furPatch;
      const fur = new T.InstancedMesh(gm, m, SHELLS), id = new T.Matrix4();
      for (let i = 0; i < SHELLS; i++) fur.setMatrixAt(i, id);
      fur.frustumCulled = false; fur.receiveShadow = true; fur.castShadow = false;
      mesh.add(fur); furred.push(mesh); mesh.userData.fur = fur; mesh.userData.furLen = o.len;
    }

    // ---------- the cat's parts ----------
    const furMat = () => new T.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: T.DoubleSide });
    const solid = hex => new T.MeshStandardMaterial({ color: lin(hex), roughness: 0.88, metalness: 0 });
    const cast = m => { m.castShadow = true; m.receiveShadow = true; inner.add(m); return m; };
    // body: one lofted surface from the rump to inside the head, rings of ellipses along a bending spine curve
    const BR = 40, BS = 28, bodyGeo = loftGeometry(BR, BS), body = cast(new T.Mesh(bodyGeo, furMat()));
    body.frustumCulled = false;
    {
      const sh = new Float32Array(BR * (BS + 1));
      for (let k = 0; k < BR; k++) { const u = k / (BR - 1); sh.fill(Math.max(smooth(0.9, 0.99, u), 0.8 * (1 - smooth(0, 0.06, u))), k * (BS + 1), (k + 1) * (BS + 1)); }
      bodyGeo.setAttribute('furShort', new T.BufferAttribute(sh, 1));
    }
    const spine = new T.CatmullRomCurve3([V(), V(), V(), V(), V(), V(), V()], false, 'centripetal');
    const TN = 15, TL = 0.02, TS = 12, tailGeo = loftGeometry(TN + 1, TS), tail = cast(new T.Mesh(tailGeo, furMat()));
    tail.frustumCulled = false;
    const tailR = k => k > 0.97 ? 0.004 : lerp(0.019, 0.012, smooth(0, 0.5, k)) + smooth(0.7, 0.92, k) * 0.002;

    // head
    const head = new T.Group(); inner.add(head);
    const craniumGeo = new T.SphereGeometry(0.05, 28, 20); craniumGeo.scale(1.06, 0.9, 0.95);
    const cranium = new T.Mesh(craniumGeo, furMat()); cranium.castShadow = true; head.add(cranium);
    const muzzleGeo = new T.SphereGeometry(0.026, 20, 14); muzzleGeo.scale(1.3, 0.78, 0.9);
    const muzzle = new T.Mesh(muzzleGeo, solid('#f2eee7')); muzzle.position.set(0, -0.02, 0.04); head.add(muzzle);
    const chinGeo = new T.SphereGeometry(0.016, 14, 10); chinGeo.scale(1.2, 0.7, 1);
    const chin = new T.Mesh(chinGeo, solid('#f2eee7')); chin.position.set(0, -0.036, 0.035); head.add(chin);
    const nose = new T.Mesh(new T.SphereGeometry(0.0075, 12, 8), solid('#d58c8c')); nose.scale.set(1.3, 0.75, 0.8); nose.position.set(0, -0.006, 0.066); head.add(nose);
    const ears = [], eyes = [];
    for (const sx of [-1, 1]) {
      const earGeo = new T.ConeGeometry(0.027, 0.036, 4, 1, true); earGeo.rotateY(Math.PI / 4); earGeo.scale(1, 1, 0.32); earGeo.translate(0, 0.018, 0);
      const ear = new T.Mesh(earGeo, solid('#1e1b19')); ear.material.side = T.DoubleSide;
      ear.position.set(sx * 0.03, 0.032, -0.004); ear.rotation.set(-0.12, sx * -0.25, sx * -0.38);
      const innerGeo = new T.ConeGeometry(0.016, 0.03, 3, 1, true); innerGeo.scale(1, 1, 0.3);
      const earIn = new T.Mesh(innerGeo, solid('#d9a1a0')); earIn.material.side = T.DoubleSide; earIn.position.set(0, 0.014, 0.006); ear.add(earIn);
      ear.castShadow = true; head.add(ear); ears.push(ear);
      const eye = new T.Mesh(new T.SphereGeometry(0.0115, 16, 12), new T.MeshStandardMaterial({ color: lin('#b8c14c'), roughness: 0.15, metalness: 0 }));
      eye.position.set(sx * 0.021, 0.007, 0.041); eye.scale.set(1, 0.9, 0.7);
      const pupil = new T.Mesh(new T.SphereGeometry(0.0115, 12, 10), new T.MeshStandardMaterial({ color: 0x050505, roughness: 0.1 }));
      pupil.scale.set(0.28, 0.95, 0.35); pupil.position.set(0, 0, 0.0085); eye.add(pupil);
      head.add(eye); eyes.push(eye);
    }
    {  // whiskers: five a side from the whisker pads, fanning out and curving down a little
      const wp = [];
      for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) {
        const y0 = -0.016 - i * 0.0024, a = (i - 1.5) * 0.13, len = 0.07 - Math.abs(i - 2) * 0.006;
        wp.push(sx * 0.019, y0, 0.057, sx * (0.019 + len * Math.cos(a)), y0 + len * Math.sin(a) - 0.008, 0.044);
      }
      const wg = new T.BufferGeometry(); wg.setAttribute('position', new T.Float32BufferAttribute(wp, 3));
      head.add(new T.LineSegments(wg, new T.LineBasicMaterial({ color: 0xf6f1e8, transparent: true, opacity: 0.7 })));
    }

    // legs: a lofted tube through shoulder or hip, elbow or knee, wrist or hock, and an oval paw
    // walk / trot: each leg's phase offset in the stride. Walk: a lateral sequence, LH 0, LF 0.25, RH 0.5, RF 0.75
    // (a quarter cycle apart, each front paw following the hind paw on its side); trot: diagonal pairs together (RF
    // with LH, LF with RH). side -1 is the cat's left.
    const LEGS = [
      { name: 'LF', front: true, side: -1, walk: 0.25, trot: 0.5 },
      { name: 'RF', front: true, side: 1, walk: 0.75, trot: 1.0 },
      { name: 'LH', front: false, side: -1, walk: 0, trot: 0 },
      { name: 'RH', front: false, side: 1, walk: 0.5, trot: 0.5 },
    ];
    const LR = 20, LS = 12;
    LEGS.forEach((L, i) => {
      const mat = solid('#f2eee7'); L.mat = mat; L.matUpper = solid('#f2eee7'); L.matUpper.side = T.DoubleSide;
      L.geo = loftGeometry(LR, LS); L.leg = cast(new T.Mesh(L.geo, L.matUpper)); L.leg.frustumCulled = false;
      L.curve = new T.CatmullRomCurve3([V(), V(), V(), V(), V()], false, 'centripetal');
      // radius at: inside the body, shoulder or hip, elbow or knee, wrist or hock, paw
      // the hind leg's big haunch (0.043) is what makes it read as a cat's thigh and not a bent tube
      L.radii = L.front ? [0.006, 0.027, 0.017, 0.0125, 0.0115] : [0.01, 0.043, 0.022, 0.0115, 0.0105];
      const pawGeo = new T.SphereGeometry(1, 16, 10); pawGeo.scale(0.019, 0.011, 0.025);
      L.paw = cast(new T.Mesh(pawGeo, mat));
      L.foot = V(); L.swing = false; L.s = 0; L.dur = 0.3; L.start = V(); L.lastLP = 0; L.idx = i;
    });
    // a leg's loft through its five points; `side` points out from the body, to start the rings' frame
    function legLoft(L, pts, side) {
      L.curve.points.forEach((q, i) => q.copy(pts[i]));
      const P = L.geo.attributes.position, CB = L.geo.attributes.furComb, c = V(), t = V(), n0 = side.clone(), b2 = V();
      for (let k = 0; k < LR; k++) {
        const u = k / (LR - 1); L.curve.getPoint(u, c); L.curve.getTangent(u, t);
        n0.addScaledVector(t, -n0.dot(t)).normalize(); b2.crossVectors(t, n0);
        const f = u * 4, i0 = Math.min(3, Math.floor(f)), rr = lerp(L.radii[i0], L.radii[i0 + 1], smooth(0, 1, f - i0));
        for (let s = 0; s <= LS; s++) {
          const a = s / LS * Math.PI * 2, x = Math.cos(a) * rr, y = Math.sin(a) * rr, j = k * (LS + 1) + s;
          P.setXYZ(j, c.x + n0.x * x + b2.x * y, c.y + n0.y * x + b2.y * y, c.z + n0.z * x + b2.z * y);
          CB.setXYZ(j, t.x * 0.5, t.y * 0.5, t.z * 0.5);  // the hair lies down the leg
        }
      }
      P.needsUpdate = CB.needsUpdate = true; L.geo.computeVertexNormals();
    }

    let coat = null;
    function applyCoat(c) {
      c = typeof c === 'string' ? COATS[c] : c; coat = c;
      root.scale.setScalar(c.scale || 1);
      // canvas x runs along the body (rump to head), y round it; the texture's v is the ring angle
      const swap = (m, t) => { if (m.map) m.map.dispose(); m.map = t; m.color.setRGB(1, 1, 1); m.needsUpdate = true; };
      swap(body.material, paint(1024, 512, (x, y) => { const a = (1 - y) * Math.PI * 2; return c.body(x, Math.cos(a), Math.sin(a)); }, 4, srgb));
      swap(tail.material, paint(256, 4, x => c.tail(x), 0, srgb));
      // sphere UVs: u = longitude from -x towards +z, v = 0 at the top
      swap(cranium.material, paint(512, 256, (x, y) => {
        const phi = x * Math.PI * 2, th = y * Math.PI;
        return c.head(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
      }, 2.5, srgb));
      muzzle.material.color.copy(lin(c.white)); chin.material.color.copy(lin(c.white)); nose.material.color.copy(lin(c.nose));
      ears.forEach(e => { e.material.color.copy(lin(c.ear)); e.children[0].material.color.copy(lin(c.inner)); e.scale.setScalar(c.ears || 1); });
      eyes.forEach(e => { e.material.color.copy(lin(c.eye)); e.children[0].scale.x = c.pupil || 0.28; });
      LEGS.forEach((L, i) => { L.mat.color.copy(lin(c.white)); L.matUpper.color.copy(lin(c.legs[i])); });
      // the shells take the coat's colour; the surface under them is darker, the shade between the hairs. That surface
      // must be fully matt: any highlight on it shows through and over the shells and wipes out the hair (worst on the
      // black coat seen from above), so a sleek coat gets its shine from the shells' rough instead
      const under = new Set(), rough = c.rough || 1;
      for (const b of furred) {
        const f = b.userData.fur.material;
        f.map = b.material.map || null; f.color.copy(b.material.map ? new T.Color(1, 1, 1) : b.material.color); f.roughness = rough; f.needsUpdate = true;
        f.userData.fur.furLen.value = b.userData.furLen * (c.furK || 1);
        under.add(b.material);
      }
      under.forEach(m => { m.color.multiplyScalar(0.72); m.roughness = 1; });
    }

    // ---------- the cat's state ----------
    // the cat's state. state: go (walking to target), idle (standing; starts C.next or lets the world pick), circle
    // (turning round before curling up), rest (in POSES[restKind] for restT s). restW 0..1 is how far into the rest it
    // has settled; lift / liftTo / hop: how high its floor is (a seat) and a hop under way; duty, freq: the gait's.
    const C = {
      pos: V(0, 0, 0), heading: 0.6, speed: 0, turnRate: 0, phase: 0, gait: 0, bend: 0, move: 0,
      target: V(), state: 'idle', idle: 0.8, look: 0, lookTo: 0, lookT: 0, headUp: 1, t: 0,
      duty: 0.64, freq: 1, goal: {}, next: null, restKind: 'loaf', restW: 0, restT: 0, tailSide: 1, lift: 0, liftTo: 0, hop: null, blink: 3,
    };
    const cat = { C, UI, LEGS, POSES, root, inner, head, bonePts: [], applyCoat, update, goTo, startRest, command, setFur, worldPos, toLocal };
    function toLocal(p) { root.updateMatrixWorld(); return inner.worldToLocal(p.clone()); }
    function worldPos(out = V()) { root.updateMatrixWorld(); return out.copy(C.pos).setY(0).applyMatrix4(inner.matrixWorld); }
    // where to go and what to do there (o): then = the rest to take (or a function choosing it), circle = turn round
    // first (as in a bed), face = a world point to look at while there, wait = seconds before resting, after = a
    // function called on arrival instead (the next leg of a route)
    function goTo(p, o = {}) {
      C.goal = o; C.next = null; C.state = 'go';
      C.target.copy(toLocal(p)).setY(0);
      o.faceL = o.face ? toLocal(o.face).setY(0) : null;
    }
    function arrive() {
      C.state = 'idle'; const gl = C.goal;
      if (gl.after) { const f = gl.after; gl.after = null; f(cat); return; }
      const then = typeof gl.then === 'function' ? gl.then(cat) : gl.then;
      if (gl.circle) { C.state = 'circle'; C.idle = 2.6; C.next = then || 'curl'; return; }
      if (then) { C.idle = gl.wait == null ? 0.6 : gl.wait; C.next = then; return; }
      const r = Math.random(); C.next = r < 0.45 ? 'sit' : r < 0.8 ? 'loaf' : null; C.idle = C.next ? 0.6 + Math.random() * 0.6 : 2 + Math.random() * 2;
    }
    function startRest(kind) {
      const d = (world.restFor && world.restFor(kind)) || POSES[kind].dur;
      C.state = 'rest'; C.restKind = kind; C.next = null; C.restT = d[0] + Math.random() * (d[1] - d[0]);
      C.tailSide = kind === 'curl' || kind === 'donut' ? 1 : Math.random() < 0.5 ? -1 : 1;
    }
    // a button: the world's (walk, bed, bowl...), or rest right here (the cat gets up first if it rests some other way)
    function command(what) {
      if (world.command && world.command(cat, what)) return;
      if (!POSES[what]) return;
      if (C.state === 'rest' && C.restKind === what) return;
      C.state = 'idle'; C.idle = 0; C.next = what; C.goal = {};
    }
    function setFur(on) { furred.forEach(m => { m.userData.fur.visible = on; }); }
    const face = p => wrap(Math.atan2(p.x - C.pos.x, p.z - C.pos.z) - C.heading);
    function startSwing(L, dur) { L.swing = true; L.s = 0; L.dur = dur; L.start.copy(L.foot); }
    function neutral(L, pos, h) {
      const { f, r } = frameOf(h);
      return pos.clone().addScaledVector(f, L.front ? 0.125 : -0.125).addScaledVector(r, (L.front ? 0.033 : 0.04) * L.side).setY(0);
    }
    function place(p, heading) {  // put the cat down somewhere (world point), standing
      C.pos.copy(toLocal(p)).setY(0); if (heading != null) C.heading = heading;
      LEGS.forEach(L => L.foot.copy(neutral(L, C.pos, C.heading))); tailInit.done = false;
    }
    cat.place = place;
    LEGS.forEach(L => L.foot.copy(neutral(L, C.pos, C.heading)));
    const tailP = Array.from({ length: TN + 1 }, () => V()), tailInit = { done: false }, bonePts = cat.bonePts;
    cat.tailP = tailP;
    const rot = (r, u, rho) => [r.clone().multiplyScalar(Math.cos(rho)).addScaledVector(u, Math.sin(rho)), u.clone().multiplyScalar(Math.cos(rho)).addScaledVector(r, -Math.sin(rho))];

    function update(dt) {
      C.t += dt;
      // behaviour: walk to a target; there, rest (turning round first in a bed), then let the world choose again
      const toT = C.target.clone().sub(C.pos).setY(0), dist = toT.length(), gl = C.goal;
      let want = 0, dTurn = 0;
      if (C.state === 'go') {
        if (C.restW > 0.02) { /* getting up first */ }
        else if (dist < 0.06 || (dist < 0.16 && !gl.then && !gl.circle && !gl.after && !gl.exact)) arrive();
        else {
          want = UI.speed * clamp(dist / 0.5, 0.25, 1);
          dTurn = wrap(Math.atan2(toT.x, toT.z) - C.heading);
          if (Math.abs(dTurn) > 0.9) want *= 0.3;
          if (UI.speed < 0.02) want = 0;
        }
      } else if (C.state === 'idle') {
        C.idle -= dt;
        if (gl.faceL) dTurn = face(gl.faceL);
        if (C.idle <= 0 && C.restW < 0.02 && (!gl.faceL || Math.abs(dTurn) < 0.15)) { if (C.next) startRest(C.next); else if (UI.wander && UI.speed > 0.02) world.pick(cat); }
      } else if (C.state === 'circle') {
        C.idle -= dt; dTurn = 2.5;
        if (C.idle <= 0) startRest(C.next || 'curl');
      } else if (C.state === 'rest') {
        if (UI.wander) C.restT -= dt;
        if (gl.faceL && !POSES[C.restKind].ring) dTurn = face(gl.faceL);
        // the world can keep it lying as it is for another while (world.stay), or it gets up and the world chooses again
        if (C.restT <= 0) { if (world.stay && world.stay(cat)) startRest(C.restKind); else { C.state = 'idle'; C.idle = 0.5 + Math.random(); C.goal = {}; } }
      }
      const PZ = POSES[C.restKind];
      C.restW = clamp(C.restW + (C.state === 'rest' ? 1 : -1) * dt / PZ.rise, 0, 1);
      const w = smooth(0, 1, C.restW);
      const maxTurn = 1.1 + C.speed * 1.8;
      C.turnRate += (clamp(dTurn * 3.2, -maxTurn, maxTurn) - C.turnRate) * Math.min(1, dt * 6);
      C.heading = wrap(C.heading + C.turnRate * dt);
      C.speed += clamp(want - C.speed, -1.6 * dt, 1.1 * dt);
      const { f } = frameOf(C.heading), vel = f.clone().multiplyScalar(C.speed);
      C.pos.addScaledVector(vel, dt);
      C.bend += (clamp(C.turnRate * 0.13, -0.28, 0.28) - C.bend) * Math.min(1, dt * 5);

      // gait: a lateral-sequence walk (LH LF RH RF) blending into a trot (diagonal pairs) with speed
      // duty: the share of the stride a paw is down, 0.64 walking (two or three paws always down) to 0.42 trotting;
      // freq: strides per second, rising with speed (m/s). The trot comes in between 0.75 and 1.15 m/s.
      C.gait += (smooth(0.75, 1.15, C.speed) - C.gait) * Math.min(1, dt * 3);
      const duty = C.duty = lerp(0.64, 0.42, C.gait), freq = C.freq = 0.8 + 1.0 * C.speed;
      const moving = C.speed > 0.04 || Math.abs(C.turnRate) > 0.4;
      C.move += ((moving ? 1 : 0) - C.move) * Math.min(1, dt * 2.5);
      const hF = C.heading + C.bend, hH = C.heading - C.bend * 0.5;
      if (moving) {
        C.phase = mod(C.phase + freq * dt, 1);
        for (const L of LEGS) {
          const lp = mod(C.phase - lerp(L.walk, L.trot, C.gait), 1);
          if (!L.swing && L.lastLP < duty && lp >= duty) startSwing(L, (1 - duty) / freq);
          L.lastLP = lp;
        }
      } else {
        // standing: put down one paw at a time where it belongs
        if (!LEGS.some(L => L.swing)) {
          let worst = null, wd = 0.022;
          for (const L of LEGS) { const d = L.foot.distanceTo(neutral(L, C.pos, L.front ? hF : hH)); if (d > wd) { wd = d; worst = L; } }
          if (worst) startSwing(worst, 0.22);
        }
        for (const L of LEGS) L.lastLP = mod(C.phase - lerp(L.walk, L.trot, C.gait), 1);
      }
      for (const L of LEGS) if (L.swing) {
        L.s = Math.min(1, L.s + dt / L.dur);
        const remain = (1 - L.s) * L.dur, h = (L.front ? hF : hH) + C.turnRate * remain;
        const tgt = neutral(L, C.pos.clone().addScaledVector(vel, remain), h).addScaledVector(vel, moving ? duty / freq * 0.5 : 0);
        const e = L.s * L.s * (3 - 2 * L.s);
        L.foot.lerpVectors(L.start, tgt, e);
        // the paw lifts 4.5 cm (front) or 3.8 cm (hind) at the top of its swing, about half that stepping in place
        L.foot.y = Math.sin(Math.PI * L.s) * (L.front ? 0.045 : 0.038) * (moving ? 1 : 0.55);
        if (L.s >= 1) { L.swing = false; L.foot.y = 0; }
      }

      // spine standing: hips and shoulders, the chest turned into the bend, a small bob twice a stride
      const bob = Math.cos(C.phase * 4 * Math.PI) * 0.004 * C.move * (1 + C.gait) * (1 - w);
      const fF = frameOf(hF), fH = frameOf(hH), base = frameOf(C.heading);
      const loc = (fw, up, sd = 0) => C.pos.clone().addScaledVector(base.f, fw).addScaledVector(base.r, sd).setY(up);
      const K = C.restKind, curl = K === 'curl', ring = PZ.ring, RG = ring ? RING : CURL, thEnd = -Math.PI + RG.span;
      const arc = (th, y, rad = RG.r) => C.pos.clone().addScaledVector(base.f, Math.cos(th) * rad).addScaledVector(base.r, Math.sin(th) * rad).setY(y);
      const chestS = C.pos.clone().addScaledVector(fF.f, 0.12).setY(0.2 + bob * 0.6);
      const hipsS = C.pos.clone().addScaledVector(fH.f, -0.125).setY(0.195 + bob - C.gait * 0.01);

      // head standing: looks along the way, looks about when standing still
      const looking = (C.state === 'idle' && !gl.faceL) || (C.state === 'rest' && PZ.look > 0);
      C.headUp += ((C.state !== 'go' && C.state !== 'circle' ? 1 : 0) - C.headUp) * Math.min(1, dt * 2);
      if (looking) { C.lookT -= dt; if (C.lookT <= 0) { C.lookTo = (Math.random() - 0.5) * 1.6; C.lookT = 0.8 + Math.random() * 2.5; } }
      else C.lookTo = C.state === 'rest' ? 0 : clamp(dTurn * 0.6, -0.6, 0.6);
      C.look += (C.lookTo - C.look) * Math.min(1, dt * (C.state === 'rest' ? 1.5 : 3));
      const hy = hF + C.look, fHd = frameOf(hy).f;
      const neckBase = chestS.clone().addScaledVector(fF.f, 0.065).add(V(0, 0.03, 0));
      const headS = neckBase.clone().addScaledVector(fHd, 0.055 + 0.01 * C.headUp).add(V(0, 0.04 + 0.022 * C.headUp, 0));
      const pitchS = lerp(0.22, -0.04, C.headUp), rollS = Math.sin(C.t * 0.7) * 0.04 * C.headUp;

      // the resting pose, blended in by w. On its side the head rolls with the body (rollP is the body roll with its
      // sign turned: in head.rotation's terms that is the same way round): rolled against it, the cat looks as if its spine were bent
      // backwards. That, not the ring, was what read as "bent round the back" (CATS.md).
      let headP, pitchP = PZ.pitch, yawP = C.heading + C.look * PZ.look, rollP = 0, chestP = chestS, hipsP = hipsS;
      if (curl || ring) {
        // curled: the head at the end of the circle; in the donut it lies on its side, the nose in by the tail root
        const th = thEnd + (ring ? 0.34 : 0.38), tv = base.f.clone().multiplyScalar(-Math.sin(th)).addScaledVector(base.r, Math.cos(th));
        headP = ring ? arc(th, 0.05, RG.r * 0.92) : arc(th, 0.058); rollP = ring ? -1.15 : 0.45;
        yawP = Math.atan2(tv.x, tv.z);
      } else {
        headP = loc(PZ.head[0], PZ.head[1]); chestP = loc(PZ.chest[0], PZ.chest[1]); hipsP = loc(PZ.hips[0], PZ.hips[1]);
        if (K === 'eat') { pitchP += Math.sin(C.t * 8) * 0.06; headP.y += Math.sin(C.t * 8) * 0.003; }
        if (PZ.roll) rollP = -PZ.roll * 0.82;
      }
      const headPos = headS.clone().lerp(headP, w);
      head.position.copy(headPos);
      head.rotation.set(lerp(pitchS, pitchP, w), hy + wrap(yawP - hy) * w, lerp(rollS, rollP, w), 'YXZ');
      const headBack = V(0, -0.006, -0.02).applyEuler(head.rotation).add(headPos);
      // eyes: open, half shut when loafing, shut asleep, and a blink now and then
      C.blink -= dt; if (C.blink < 0) C.blink = 2.5 + Math.random() * 4;
      const open = lerp(1, PZ.eyes, w) * (C.blink < 0.13 ? 0.1 : 1);
      eyes.forEach(e => { e.scale.y = 0.9 * Math.max(0.06, open); });

      // the spine through hips, chest and the back of the head; curled up, on a circle
      function spineFrom(out, hips, chest, hb) {
        const fwd = chest.clone().sub(hips).normalize(), toHead = hb.clone().sub(chest).normalize();
        out[1].copy(hips); out[3].copy(chest);
        out[0].copy(hips).addScaledVector(fwd, -0.075).add(V(0, 0.006, 0));
        out[2].lerpVectors(hips, chest, 0.5);
        out[4].copy(chest).addScaledVector(fwd.add(toHead).normalize(), 0.066);
        out[6].copy(hb);
        out[5].lerpVectors(out[4], hb, 0.5).add(V(0, 0.008, 0));
      }
      const pts = spine.points;
      if (curl || ring) {
        spineFrom(pts, hipsS, chestS, headBack);
        let th = -Math.PI;
        for (let i = 0; i < 7; i++) { pts[i].lerp(arc(th, RG.y[i]), w); th += SEG[i] / RG.r || 0; }
        pts[6].copy(headBack);
      } else spineFrom(pts, hipsS.clone().lerp(hipsP, w), chestS.clone().lerp(chestP, w), headBack);
      const hips = pts[1], chest = pts[3];

      // body loft; resting, the body spreads a little and breathes; on its side, every ring turns round the spine
      const P = bodyGeo.attributes.position, CB = bodyGeo.attributes.furComb, c = V(), tg = V(), side = V(), upv = V(), plump = coat.plump, slim = coat.slim || 1;
      const wS = lerp(1, PZ.wS, w), hS = lerp(1, PZ.hS, w), breath = Math.sin(C.t * 2.3) * 0.03 * w, rho = (PZ.roll || 0) * w;
      const cr = Math.cos(rho), sr = Math.sin(rho);
      for (let r = 0; r < BR; r++) {
        const u = r / (BR - 1), [wd, ht, drop] = profile(u);
        spine.getPoint(u, c); spine.getTangent(u, tg);
        side.crossVectors(tg, UP); if (side.lengthSq() < 1e-6) side.copy(fF.r); side.normalize(); upv.crossVectors(side, tg).normalize();
        if (rho) { const sx = side.x, sy = side.y, sz = side.z; side.multiplyScalar(cr).addScaledVector(upv, sr); upv.multiplyScalar(cr).add(V(sx, sy, sz).multiplyScalar(-sr)); }
        const chestRise = 1 + breath * Math.sin(Math.PI * clamp((u - 0.15) / 0.45, 0, 1));
        const ww = wd * (u > 0.1 && u < 0.6 ? plump : 1) * wS * chestRise * slim, h = ht * hS * chestRise;
        for (let s = 0; s <= BS; s++) {
          const a = s / BS * Math.PI * 2, x = Math.cos(a), y = Math.sin(a), i = r * (BS + 1) + s;
          const belly = y < 0 ? 1 + 0.06 * (plump - 1) * 10 * Math.sin(Math.PI * clamp((u - 0.15) / 0.45, 0, 1)) : 1;
          P.setXYZ(i, c.x + side.x * ww * x + upv.x * (h * y * belly + drop), c.y + side.y * ww * x + upv.y * (h * y * belly + drop), c.z + side.z * ww * x + upv.z * (h * y * belly + drop));
          CB.setXYZ(i, -tg.x * 0.65, -tg.y * 0.65, -tg.z * 0.65);  // the hair lies back, towards the tail
        }
      }
      P.needsUpdate = CB.needsUpdate = true; bodyGeo.computeVertexNormals(); bodyGeo.computeBoundingSphere();

      // the legs hang from the spine: resting, their frames follow it round
      const hdg = v => Math.atan2(v.x, v.z);
      const fFb = frameOf(hF + wrap(hdg(pts[4].clone().sub(pts[2])) - hF) * w), fHb = frameOf(hH + wrap(hdg(pts[2].clone().sub(pts[0])) - hH) * w);

      // legs: shoulder/hip to wrist/hock by two-bone IK; elbows point back, knees forward. On its side the legs come
      // out of the turned body: tucked in towards the middle of the donut, or lying out loose when stretched flat
      bonePts.length = 0;
      const lerpAll = (a, b, t) => a.forEach((p, i) => p.lerp(b[i], t));
      for (const L of LEGS) {
        const fr = L.front ? fFb : fHb, flex = L.swing ? Math.sin(Math.PI * L.s) : 0, pf = PZ.feet[L.idx];
        const foot = pf ? L.foot.clone().lerp((L.front ? chest : hips).clone().addScaledVector(fr.f, pf[0]).addScaledVector(fr.r, pf[1] * L.side).setY(0), w) : L.foot.clone();
        let pts5, J, paw, pawRot;
        if (L.front) {
          const S = chest.clone().addScaledVector(fr.r, 0.031 * L.side).add(V(0, -0.035, 0)).addScaledVector(fr.f, -0.005);
          const a = lerp(flex * 1.25, PZ.a, w), W = foot.clone().addScaledVector(UP, 0.03 * Math.cos(a) + 0.002).addScaledVector(fr.f, 0.03 * Math.sin(a) - 0.004);
          const E = ik(S, W, 0.088, 0.092, fr.f.clone().negate().addScaledVector(fr.r, 0.15 * L.side));
          paw = W.clone().lerp(foot, 0.55).addScaledVector(fr.f, 0.012 * Math.cos(a)).add(V(0, 0.006, 0));
          pts5 = [S.clone().add(V(0, 0.03, 0)), S, E, W, paw.clone().add(V(0, 0.004, 0))]; J = [S, E, W, foot];
          pawRot = [a * 0.9, hdg(fr.f), 0];
        } else {
          const Hj = hips.clone().addScaledVector(fr.r, 0.04 * L.side).add(V(0, -0.02, 0)).addScaledVector(fr.f, 0.01);
          const b = lerp(0.38 - flex * 0.75, PZ.b, w), lm = 0.066;
          const Hk = foot.clone().addScaledVector(UP, lm * Math.cos(b) + 0.006).addScaledVector(fr.f, -lm * Math.sin(b));
          const Kn = ik(Hj, Hk, 0.092, 0.098, fr.f.clone().addScaledVector(fr.r, 0.12 * L.side).addScaledVector(UP, 0.3 * w));
          paw = foot.clone().addScaledVector(fr.f, 0.012).add(V(0, 0.009, 0));
          pts5 = [Hj.clone().add(V(0, 0.035, 0)).addScaledVector(fr.f, 0.01), Hj, Kn, Hk, foot.clone().add(V(0, 0.01, 0))]; J = [Hj, Kn, Hk, foot];
          pawRot = [-flex * 0.6, hdg(fr.f), 0];
        }
        if (PZ.roll && w > 0) {
          // the body's frame turned onto its side: r2 across, u2 out of the back, dn towards the belly and the paws
          const [r2, u2] = rot(fr.r, UP, PZ.roll), dn = u2.clone().negate(), F = fr.f, lo = v => { v.y = Math.max(v.y, 0.012); return v; };
          let R5, RJ, rPaw;
          if (L.front) {
            const S = chest.clone().addScaledVector(r2, 0.031 * L.side).addScaledVector(dn, 0.035).addScaledVector(F, -0.005);
            const W = lo(ring ? S.clone().addScaledVector(dn, 0.07).addScaledVector(F, 0.05) : S.clone().addScaledVector(dn, 0.1).addScaledVector(F, 0.07).addScaledVector(r2, 0.012 * L.side));
            const ft = lo(W.clone().addScaledVector(F, ring ? 0.02 : 0.03).addScaledVector(dn, ring ? -0.01 : 0.012));
            // stretched out flat, the upper legs sag onto the lower ones
            if (!ring) { W.y = Math.min(W.y, L.side > 0 ? 0.05 : 0.02); ft.y = Math.min(ft.y, L.side > 0 ? 0.042 : 0.014); }
            const E = ik(S, W, 0.088, 0.092, F.clone().negate().addScaledVector(dn, 0.15));
            rPaw = W.clone().lerp(ft, 0.6);
            R5 = [S.clone().addScaledVector(u2, 0.03), S, E, W, rPaw.clone()]; RJ = [S, E, W, ft];
          } else {
            const Hj = hips.clone().addScaledVector(r2, 0.04 * L.side).addScaledVector(dn, 0.02).addScaledVector(F, 0.01);
            const Hk = lo(ring ? Hj.clone().addScaledVector(dn, 0.06).addScaledVector(F, 0.015) : Hj.clone().addScaledVector(dn, 0.11).addScaledVector(F, 0.02).addScaledVector(r2, 0.015 * L.side));
            const ft = lo(ring ? Hk.clone().addScaledVector(F, 0.05).addScaledVector(dn, 0.015) : Hk.clone().addScaledVector(F, 0.045).addScaledVector(dn, 0.035));
            if (!ring) { Hk.y = Math.min(Hk.y, L.side > 0 ? 0.05 : 0.02); ft.y = Math.min(ft.y, L.side > 0 ? 0.042 : 0.014); }
            const Kn = ik(Hj, Hk, 0.092, 0.098, F.clone().addScaledVector(dn, ring ? 0.3 : 0));
            rPaw = ft.clone().addScaledVector(F, 0.01);
            R5 = [Hj.clone().addScaledVector(u2, 0.035), Hj, Kn, Hk, ft.clone()]; RJ = [Hj, Kn, Hk, ft];
          }
          lerpAll(pts5, R5, w); lerpAll(J, RJ, w); paw.lerp(rPaw, w);
          pawRot[0] = lerp(pawRot[0], ring ? 0.9 : 0.3, w); pawRot[2] = PZ.roll * w * 0.9;
        }
        // the rings' frame starts square to the leg: across the body standing, along it on the side (the legs then run across)
        legLoft(L, pts5, fr.r.clone().multiplyScalar(L.side).lerp(fr.f, PZ.roll ? w : 0).normalize());
        L.paw.position.copy(paw); L.paw.rotation.set(pawRot[0], pawRot[1], pawRot[2], 'YXZ');
        bonePts.push(J[0], J[1], J[1], J[2], J[2], J[3]);
      }

      // tail: a follow-the-leader chain; held up with a hooked tip when walking, low with the tip up when standing;
      // resting, it lies on the floor and curls round the body, the tip still twitching
      // Each link gets a direction from pitch (up from the tail's base direction bdir) and yaw (to the side, rdir),
      // eases towards prev + dir * TL (faster near the root), and is then pulled back to TL from the link before, so
      // the tail never stretches; no link goes below 1.2 cm, off the floor.
      const root0 = pts[0].clone().lerp(pts[1], 0.3).add(V(0, lerp(0.03, PZ.roll ? 0 : 0.02, w), 0)), tw = PZ.tail ? w : 0;
      const bdir = fH.f.clone().negate().lerp(pts[0].clone().sub(pts[1]).setY(0).normalize(), tw).normalize(), rdir = bdir.clone().applyAxisAngle(UP, Math.PI / 2);
      if (!tailInit.done) { tailP.forEach((p, i) => p.copy(root0).addScaledVector(bdir, i * TL)); tailInit.done = true; }
      const swish = lerp(0.3, 0.12, C.move), wf = lerp(0.55, 1.4, C.move);
      let prev = root0.clone(); tailP[0].copy(root0);
      for (let i = 1; i <= TN; i++) {
        const k = i / TN;
        const pWalk = lerp(0.5, 1.35, smooth(0, 0.45, k)) - smooth(0.62, 1, k) * 1.9;
        const pRest = lerp(-0.15, -0.85, smooth(0, 0.5, k)) + smooth(0.6, 1, k) * 1.25;
        const pLie = lerp(-0.8, -0.05, smooth(0, 0.25, k)), yLie = C.tailSide * PZ.tail * k + Math.sin(C.t * 1.3) * 0.18 * smooth(0.7, 1, k);
        const pitch = lerp(lerp(pRest, pWalk, C.move), pLie, tw), yaw = lerp(Math.sin(C.t * wf * 6.283 - k * 2.6) * swish * k, yLie, tw);
        const dir = bdir.clone().multiplyScalar(Math.cos(pitch) * Math.cos(yaw)).addScaledVector(UP, Math.sin(pitch)).addScaledVector(rdir, Math.cos(pitch) * Math.sin(yaw));
        const target = prev.addScaledVector(dir, TL).clone();
        // in the donut the tail comes round the outside, over the paws and in front of the nose
        if (ring) target.lerp(arc(-Math.PI - 0.15 - k * 2.3, 0.045 + 0.01 * (1 - k), lerp(RG.r, 0.045, smooth(0, 0.7, k))), tw);
        else if (PZ.hug) {  // round the haunch on a quarter ellipse, then forward along the flank
          const d = k * TN * TL, q = 0.12, sd = C.tailSide * PZ.hug;
          target.lerp(d < q ? loc(-0.115 - 0.055 * Math.cos(d / q * Math.PI / 2), 0.016, sd * Math.sin(d / q * Math.PI / 2))
            : loc(-0.115 + (d - q), 0.016 + 0.004 * (1 - k), sd), tw);
        }
        tailP[i].lerp(target, 1 - Math.exp(-dt * (30 - 20 * k)));
      }
      for (let i = 1; i <= TN; i++) {
        const d = tailP[i].clone().sub(tailP[i - 1]); tailP[i].copy(tailP[i - 1]).addScaledVector(d.normalize(), TL);
        if (tailP[i].y < 0.012) tailP[i].y = 0.012;
      }
      const TP = tailGeo.attributes.position, TC = tailGeo.attributes.furComb, n0 = fH.r.clone();
      for (let i = 0; i <= TN; i++) {
        const t = (i < TN ? tailP[i + 1].clone().sub(tailP[i]) : tailP[i].clone().sub(tailP[i - 1])).normalize();
        n0.addScaledVector(t, -n0.dot(t)).normalize(); const b2 = V().crossVectors(t, n0);
        const rr = tailR(i / TN);
        for (let s = 0; s <= TS; s++) {
          const a = s / TS * Math.PI * 2, x = Math.cos(a) * rr, y = Math.sin(a) * rr;
          TP.setXYZ(i * (TS + 1) + s, tailP[i].x + n0.x * x + b2.x * y, tailP[i].y + n0.y * x + b2.y * y, tailP[i].z + n0.z * x + b2.z * y);
          TC.setXYZ(i * (TS + 1) + s, t.x * 0.6, t.y * 0.6, t.z * 0.6);  // the hair lies towards the tip
        }
      }
      TP.needsUpdate = TC.needsUpdate = true; tailGeo.computeVertexNormals(); tailGeo.computeBoundingSphere();
      for (let i = 0; i < TN; i++) bonePts.push(tailP[i], tailP[i + 1]);
      for (let i = 0; i < 6; i++) bonePts.push(spine.points[i], spine.points[i + 1]);

      // what it stands on: a step up or down of more than a few cm (4, in the cat's own scale) is a hop, a 0.34 s arc
      // 7 cm high; smaller changes are eased into
      root.updateMatrixWorld();
      const wp = C.pos.clone().applyMatrix4(inner.matrixWorld), gy = world.groundAt ? world.groundAt(wp.x, wp.z) : undefined;
      const to = gy == null ? 0 : (gy - root.position.y) / root.scale.y;
      if (Math.abs(to - C.liftTo) > 0.04 && !C.hop) C.hop = { a: C.lift, b: to, t: 0 };
      C.liftTo = to;
      if (C.hop) {
        C.hop.b = to; C.hop.t = Math.min(1, C.hop.t + dt / 0.34);
        C.lift = lerp(C.hop.a, C.hop.b, smooth(0, 1, C.hop.t)) + Math.sin(Math.PI * C.hop.t) * 0.07;
        if (C.hop.t >= 1) C.hop = null;
      } else C.lift += (to - C.lift) * Math.min(1, dt * 5);
      inner.position.y = C.lift;
    }

    applyCoat(opts.coat || 'calico');
    update(1 / 60);  // the lofts get their normals here, which the fur shares
    // fur length (m, before the coat's furK) and strand density (cells along u, v of each part's texture); the tail
    // and legs are lofts whose normals point in, hence sign -1
    addFur(body, { len: 0.012, density: [420, 320] });
    addFur(tail, { len: 0.013, density: [200, 64], sign: -1 });
    addFur(cranium, { len: 0.0045, density: [200, 100], holes: [[-0.021, 0.007, 0.041, 0.012], [0.021, 0.007, 0.041, 0.012]] });
    addFur(muzzle, { len: 0.003, density: [110, 55], holes: [[0, 0.014, 0.026, 0.008]] });
    addFur(chin, { len: 0.003, density: [70, 35] });
    ears.forEach(e => addFur(e, { len: 0.0025, density: [90, 40] }));
    for (const L of LEGS) { addFur(L.leg, { len: 0.008, density: [180, 72], sign: -1 }); addFur(L.paw, { len: 0.004, density: [90, 45] }); }
    applyCoat(coat);
    return cat;
  }

  // ---------- Lucifer, the black cat on top of the box room ----------
  // r comes from buildRoom, in room mm (room (x, y, height) is three (x, height, -y) in m). She is lying down nearly
  // all the time, mostly on the couch, flat on her side, as a loaf or curled into a donut, for two to five minutes at a
  // time, and often she only turns over and lies down again. Now and then she gets up, walks about on the rug or goes
  // to the edge and looks over it, then lies down somewhere else. She never walks off: every place she goes is on the
  // top, and the walk there goes round the couch, not through it. Where she lies is kept with the room (as 'cats'), so
  // she is lying there again when the room is opened.
  function roomCat(scene, r) {
    const { mm, roof, rug, couch: K, bw, bf, back } = r, ft = roof + rug.t;
    const W = (x, y, z = ft) => V(mm(x), mm(z), -mm(y)), roomOf = p => [p.x * 1000, -p.z * 1000];
    const inRect = (x, y, q, m = 0) => x > q.x0 - m && x < q.x1 + m && y > q.y0 - m && y < q.y1 + m;
    const seat = { x0: K.x0 + K.bt, x1: K.x1, y0: K.y0 + K.aw, y1: K.y1 - K.aw }, seatTop = ft + K.seat;
    const sy = (seat.y0 + seat.y1) / 2, seatC = [(seat.x0 + seat.x1) / 2 + 10, sy], front = [K.x1 + 260, sy];
    const keepOut = { x0: K.x0 - 200, x1: K.x1 + 200, y0: K.y0 - 200, y1: K.y1 + 200 };
    const area = { x0: 760, x1: bw - 230, y0: bf + 260, y1: back - 330 };  // out of the low corner under the slope
    // lying, she reaches up to about 40 cm from where she stands (legs, head, the tail laid round), so a place to lie
    // on the rug is that far and a little more from the couch; nearer, her body went into its arm
    const clear = p => inRect(...p, area) && !inRect(...p, K, 480);
    const UI = { speed: 0.42, wander: true }, LONG = new Set(['side', 'loaf', 'donut', 'curl']);
    const world = {
      groundAt(x, z) {
        const [rx, ry] = roomOf({ x, z });
        if (inRect(rx, ry, seat, 20)) return mm(seatTop);
        return mm(inRect(rx, ry, rug) ? ft : roof);
      },
      pick,
      // the user's wish: lying down 98-99% of the time, getting up only after 2 to 5 minutes; with stay, the 85%
      // resettling in pick and the short roams, two simulated hours came to 98.3% (CATS.md, lying-sim.js in the skill)
      restFor: kind => LONG.has(kind) ? [120, 300] : null,
      stay: () => LONG.has(cat.C.restKind) && Math.random() < 0.5,  // half the time she just lies on
    };
    const cat = make({ parent: scene, coat: 'black', world, UI, srgb: false, shells: 12 });
    cat.root.position.y = mm(ft);
    const here = () => roomOf(cat.worldPos()), onCouch = () => inRect(...here(), seat, 40);
    const rnd = (a, b) => a + Math.random() * (b - a);
    // a walk that does not cross the couch: straight, or by one or two corners of the ground round it
    const crosses = (a, b) => { for (let t = 0; t <= 1; t += 0.04) if (inRect(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, keepOut, -20)) return true; return false; };
    const corners = [[keepOut.x0, keepOut.y0], [keepOut.x0, keepOut.y1], [keepOut.x1, keepOut.y0], [keepOut.x1, keepOut.y1]];
    function route(a, b) {
      if (!crosses(a, b)) return [];
      const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
      let best = null, bl = Infinity;
      for (const c of corners) if (!crosses(a, c) && !crosses(c, b) && d(a, c) + d(c, b) < bl) { best = [c]; bl = d(a, c) + d(c, b); }
      if (best) return best;
      for (const c of corners) for (const e of corners) if (c !== e && !crosses(a, c) && !crosses(c, e) && !crosses(e, b) && d(a, c) + d(c, e) + d(e, b) < bl) { best = [c, e]; bl = d(a, c) + d(c, e) + d(e, b); }
      return best || [];
    }
    function walk(to, o) {  // go to room point `to` by way of the corners the route needs, then do o
      const legs = [...route(here(), to), to];
      const next = () => { const p = legs.shift(); if (legs.length) cat.goTo(W(...p), { after: next }); else cat.goTo(W(...p), o); };
      next();
    }
    // lying down at room point p: flat on her side (most often), curled into a donut, or a loaf; on the seat along it
    function lieAt(p, along) {
      const q = Math.random(), a = Math.random() < 0.5 ? 1 : -1, face = along ? W(p[0], p[1] + a * 1500) : null;
      if (q < 0.3) cat.goTo(W(...p), { circle: true, then: 'donut' });
      else cat.goTo(W(...p), { then: q < 0.8 ? 'side' : 'loaf', face, wait: 0.3 });
    }
    const lie = () => lieAt(seatC, true);
    function spot() {  // somewhere on the rug, away from the couch and from where she is
      const at = here(); let p = at;
      for (let n = 0; n < 40; n++) {
        p = [rnd(area.x0, area.x1), rnd(area.y0, area.y1)];
        if (clear(p) && Math.hypot(p[0] - at[0], p[1] - at[1]) > 450) break;
      }
      return p;
    }
    const toCouch = () => walk(front, { after: lie });
    function toEdge() {
      if (Math.random() < 0.6) { const y = rnd(bf + 420, back - 450); walk([bw - 150, y], { then: 'peer', face: W(bw + 800, y), wait: 0.4 }); }
      else { const x = rnd(1000, bw - 320); walk([x, bf + 150], { then: 'peer', face: W(x, bf - 800), wait: 0.4 }); }
    }
    // up and about: one or two walks (to a spot, now and then sitting there a little, or to the edge to look over it),
    // then she lies down again, on the couch or on the rug
    let roam = -1;
    function pick() {
      if (roam > 0) {
        roam--;
        if (Math.random() < 0.35) return toEdge();
        return walk(spot(), Math.random() < 0.25 ? { then: 'sit' } : { after: pick });
      }
      if (roam === 0) {
        roam = -1;
        if (Math.random() < 0.6) return toCouch();
        const p = spot(); return walk(p, { after: () => lieAt(p) });
      }
      // she has lain here for a few minutes and got up: mostly she just turns round and settles again
      if (Math.random() < 0.85) { if (onCouch()) return lie(); if (clear(here())) return lieAt(here()); const p = spot(); return walk(p, { after: () => lieAt(p) }); }
      roam = 1 + (Math.random() < 0.3 ? 1 : 0);
      if (onCouch()) return cat.goTo(W(...front), { after: pick });
      pick();
    }
    // lying somewhere (a room point, her heading, the pose) for a few minutes; she starts out on the couch
    function settle(at, heading, kind) {
      cat.place(W(...at), heading); cat.goTo(W(...at), {});
      // and still: speed or a turn left over from walking would carry her on lying down, some 12 cm a time, and the
      // place kept each time she was opened again crept until she lay inside the couch's arm
      cat.startRest(kind); cat.C.restW = 1; cat.C.heading = heading; cat.C.speed = 0; cat.C.turnRate = 0;
      cat.update(1 / 60); cat.C.hop = null; cat.C.lift = cat.C.liftTo; cat.inner.position.y = cat.C.lift;
    }
    settle(seatC, Math.PI, Math.random() < 0.6 ? 'side' : 'loaf');
    // or where she lay when the room was last open
    const S = g.Store;
    let restored = false, kept = '';
    function restore() {
      const d = S.cases.get('cats'), at = d && d.lucifer;
      if (restored || !at) return;
      restored = true;
      // on the seat, or somewhere on the rug clear of the couch (a place kept before that rule is not used)
      if (Array.isArray(at.at) && LONG.has(at.kind) && (inRect(...at.at, seat, 40) || clear(at.at))) settle(at.at, +at.heading || 0, at.kind);
    }
    function keep() {  // whenever she has lain down somewhere new or another way
      const C = cat.C;
      if (C.state !== 'rest' || !LONG.has(C.restKind) || C.restW < 0.9) return;
      const d = { at: here().map(Math.round), heading: +C.heading.toFixed(3), kind: C.restKind }, key = JSON.stringify(d);
      if (key === kept) return;
      kept = key; restored = true;
      S.saveCase('cats', Object.assign({}, S.cases.get('cats') || {}, { lucifer: d }));
    }
    if (S && S.saveCase) {
      restore(); S.on((kind, id) => { if (kind === 'case' && id === 'cats') restore(); });
      setInterval(() => { if (S.live) keep(); }, 2000);
    }

    // she moves on her own clock while the room is shown; in the terminal look she is a dark shape without fur
    const stage = document.getElementById('stage'), vRoom = document.getElementById('vRoom');
    const crtMat = new T.MeshBasicMaterial({ color: 0x06200f }), saved = new Map();
    let last = performance.now(), crt = false;
    function setCrt(on) {
      crt = on; cat.setFur(!on);
      cat.root.traverse(o => { if (!o.isMesh || o.isInstancedMesh) return; if (on) { saved.set(o, o.material); o.material = crtMat; } else if (saved.has(o)) o.material = saved.get(o); });
    }
    function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!vRoom || !vRoom.hidden) {
        const c = !!stage && stage.classList.contains('crt'); if (c !== crt) setCrt(c);
        cat.update(dt);
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    cat.where = { seatC, front, area, toCouch, toEdge, spot, lie, lieAt, settle, keep };
    return cat;
  }

  g.CatKit = { make, roomCat, COATS, POSES, frameOf, smooth, clamp, lerp, wrap, hash, fbm, paint };
})(window);
