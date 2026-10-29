// The room's light: the IKEA TIDIG spotlight with 5 spots on the brick wall, its glass shades turned up so the light
// washes up the wall and over the ceiling, and a little daylight from the window. Lit the physical way: colours
// worked in linear light, inverse-square falloff, filmic tone mapping, written out as sRGB. A dimmer in the room's
// row of buttons turns the lamp up and down (kept in localStorage).
(function (g) {
  const T = window.THREE;
  // Colours and pictures are given in sRGB. A material the room renderer draws gets LIN_IN, which turns its colour,
  // emissive colour and map linear in the shader, so colours set later (hover, outlines) are right too. The book
  // workshop's preview has its own renderer that writes linear, and its materials never get LIN_IN.
  if (T && !T.ShaderChunk.__linIn) {
    T.ShaderChunk.__linIn = true;
    const dif = 'vec4 diffuseColor = vec4( diffuse, opacity );', emi = 'vec3 totalEmissiveRadiance = emissive;';
    Object.values(T.ShaderLib).forEach(s => {
      if (!s.fragmentShader) return;
      s.fragmentShader = s.fragmentShader
        .replace(dif, '#ifdef LIN_IN\n\tvec4 diffuseColor = vec4( sRGBToLinear( vec4( diffuse, 1.0 ) ).rgb, opacity );\n#else\n\t' + dif + '\n#endif')
        .replace(emi, '#ifdef LIN_IN\n\tvec3 totalEmissiveRadiance = sRGBToLinear( vec4( emissive, 1.0 ) ).rgb;\n#else\n\t' + emi + '\n#endif');
    });
    T.ShaderChunk.map_fragment = T.ShaderChunk.map_fragment.replace('texelColor = mapTexelToLinear( texelColor );',
      '#ifdef LIN_IN\n\ttexelColor = sRGBToLinear( texelColor );\n#else\n\ttexelColor = mapTexelToLinear( texelColor );\n#endif');
  }

  // TIDIG (IKEA): a brushed steel bar 133 cm long, 5 spots with white glass shades 6 cm across. Here on the wall: a
  // round plate 10 cm across in the middle, the bar 1 cm thick at a slant with a short step near each end, five
  // short arms, a socket and a frosted cup on each, open end up, and a white cable along the wall to the right.
  const TIDIG = { len: 1330, slant: 18, step: 35, stepAt: 440, off: 45, plate: 50, rod: 5, arm: 70, armUp: 40, spots: [-600, -300, 0, 300, 600],
    cupH: 70, cupTop: 30, cupBot: 17, socket: 13 };
  const WARM = 0xffd2a0;  // the bulbs, about 2700 K

  g.RoomLights = function (THREE, scene, renderer, r) {
    const { mm, addMesh, w, slope } = r, P = (x, y, h) => new THREE.Vector3(mm(x), mm(h), -mm(y));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.physicallyCorrectLights = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.5;
    const seen = new WeakSet(), draw = renderer.renderBufferDirect;
    renderer.renderBufferDirect = function (camera, sc, geo, mat, obj, group) {
      if (!seen.has(mat)) {
        seen.add(mat);
        if (mat.color) {  // the shadow maps' depth materials have none
          mat.defines = Object.assign({}, mat.defines, { LIN_IN: '' });
          if (mat.isMeshBasicMaterial || mat.isLineBasicMaterial) mat.toneMapped = false;  // outlines and the terminal look keep their colours
          mat.needsUpdate = true;
        }
      }
      return draw.call(this, camera, sc, geo, mat, obj, group);
    };

    // ---------- the lamp ----------
    // On the brick wall above the first nook door (where is up to room.js); u runs along the wall
    // (room y), v up, and the bar stands `off` out from the wall.
    const L = TIDIG, uc = r.lampY, vc = r.lampH, a = L.slant * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const lamp = new THREE.Group(); scene.add(lamp);
    const steel = { metalness: 0.55, roughness: 0.35 }, STEEL = 0xc4c7ca;
    const part = (geo, color, opts) => { const me = addMesh(geo, color, 'room', opts, null, lamp); me.castShadow = false; return me; };
    // a point on the bar s along it, k across it (up the slant), out from the wall
    const onBar = (s, k, out) => P(w - out, uc + s * ca - k * sa, vc + s * sa + k * ca);
    const rodBetween = (p, q, rad, color = STEEL, opts = steel) => {
      const me = part(new THREE.CylinderGeometry(mm(rad), mm(rad), p.distanceTo(q), 8), color, opts);
      me.position.copy(p).add(q).multiplyScalar(0.5);
      me.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize());
      return me;
    };
    const kAt = s => s < -L.stepAt ? -L.step : s > L.stepAt ? L.step : 0;
    const bar = [[-L.len / 2, -L.step], [-L.stepAt, -L.step], [-L.stepAt, 0], [L.stepAt, 0], [L.stepAt, L.step], [L.len / 2, L.step]].map(([s, k]) => onBar(s, k, L.off));
    for (let i = 1; i < bar.length; i++) rodBetween(bar[i - 1], bar[i], L.rod);
    bar.forEach(p => { part(new THREE.SphereGeometry(mm(L.rod), 8, 6), STEEL, steel).position.copy(p); });
    const plate = part(new THREE.CylinderGeometry(mm(L.plate), mm(L.plate), mm(16), 28), STEEL, steel);
    plate.position.copy(P(w - 8, uc, vc)); plate.rotation.z = Math.PI / 2;
    rodBetween(P(w - 16, uc, vc), onBar(0, 0, L.off), 9);
    const glassMat = [], heads = [];
    L.spots.forEach(s => {
      const from = onBar(s, kAt(s), L.off), to = from.clone().add(new THREE.Vector3(-mm(L.arm), mm(L.armUp), 0));
      rodBetween(from, to, 4);
      const sk = part(new THREE.CylinderGeometry(mm(L.socket), mm(L.socket), mm(34), 14), STEEL, steel); sk.position.copy(to).add(new THREE.Vector3(0, mm(17), 0));
      const cup = part(new THREE.CylinderGeometry(mm(L.cupTop), mm(L.cupBot), mm(L.cupH), 20, 1, true), 0xf2efe8,
        { emissive: WARM, emissiveIntensity: 1, roughness: 0.55, side: THREE.DoubleSide });
      cup.position.copy(to).add(new THREE.Vector3(0, mm(34 + L.cupH / 2 - 6), 0)); glassMat.push(cup.material);
      const bulb = part(new THREE.SphereGeometry(mm(16), 12, 8), 0xffffff, { emissive: WARM, emissiveIntensity: 1 });
      bulb.position.copy(to).add(new THREE.Vector3(0, mm(34 + 26), 0)); glassMat.push(bulb.material);
      heads.push(to.clone().add(new THREE.Vector3(0, mm(34 + L.cupH - 10), 0)));
    });
    // the cable is not drawn: where it really runs is not known, and a guessed white line down the wall by the corner
    // read as a fault in the picture

    // ---------- the lights ----------
    const lights = [];
    // the five spots: up at the ceiling, a wide soft cone out of each glass cup
    heads.forEach(h => {
      const sp = new THREE.SpotLight(WARM, 1, 0, 0.82, 0.75, 2); sp.position.copy(h);
      sp.target.position.copy(h).add(new THREE.Vector3(-0.08, 1, 0)); scene.add(sp); scene.add(sp.target);
      lights.push([sp, 2.2]);
    });
    // the glow through the frosted glass, all round the lamp
    const glow = new THREE.PointLight(WARM, 1, 0, 2); glow.position.copy(onBar(0, 0, L.off + 120)); scene.add(glow); lights.push([glow, 0.35]);
    // what the lit ceiling throws back down: a broad soft light under the ceiling in front of the lamp, the one that
    // casts the shadows; it falls off as 1/d (a large source), not 1/d^2
    const bx = w - 1000, bounce = new THREE.SpotLight(0xffe1bd, 1, 0, 1.3, 0.6, 1);
    bounce.position.copy(P(bx, uc, slope(bx) - 200)); bounce.target.position.copy(P(1300, uc + 1800, 0));
    bounce.castShadow = true; bounce.shadow.mapSize.set(1024, 1024); bounce.shadow.radius = 5; bounce.shadow.bias = -0.0006; bounce.shadow.normalBias = 0.02;
    Object.assign(bounce.shadow.camera, { near: 0.2, far: 14 });
    scene.add(bounce); scene.add(bounce.target); lights.push([bounce, 10]);
    // and from the rest of the lit ceiling, without shadows: what gets into the bookcases from the front
    const fill = new THREE.PointLight(0xffe1bd, 1, 0, 1); fill.position.copy(P(1700, uc - 900, slope(1700) - 300)); scene.add(fill); lights.push([fill, 2.5]);
    // the rest of the bounce, everywhere: warm from above, darker from the floor
    const hemi = new THREE.HemisphereLight(0xffe6c8, 0x9a8670, 1); scene.add(hemi); lights.push([hemi, 1.3]);
    // daylight: only a little comes in; the view out of the window is the page background and stays as it was
    const day = new THREE.DirectionalLight(0xdfe8f2, 0.25); day.position.set(-6, 5, -3.5); day.target.position.set(1.5, 0, -3.5); scene.add(day); scene.add(day.target);
    const sky = new THREE.AmbientLight(0xdfe8f2, 0.06); scene.add(sky);

    // ---------- the dimmer ----------
    const KEY = 'joey.lampLevel', DEF = 70;
    let level = DEF;
    try { const v = parseFloat(localStorage.getItem(KEY)); if (v >= 0 && v <= 100) level = v; } catch (e) { /* no storage: the default */ }
    function setLevel(v, keep) {
      level = Math.max(0, Math.min(100, +v || 0));
      const f = Math.pow(level / DEF, 2);  // the slider by eye, the light by power
      lights.forEach(([l, k]) => { l.intensity = k * f; });
      glassMat.forEach(m => { m.emissiveIntensity = 0.15 + 2.2 * Math.pow(level / 100, 1.5); });
      if (keep) try { localStorage.setItem(KEY, String(level)); } catch (e) { /* not kept */ }
    }
    setLevel(level);
    const el = document.getElementById('mLamp');
    if (el) { el.value = level; el.oninput = () => setLevel(el.value, true); el.addEventListener('keydown', e => e.stopPropagation()); }
    return { lamp, setLevel, get level() { return level; }, lights, renderer };
  };
})(window);
