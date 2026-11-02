/* scene3d.js — three.js (r128, global THREE) world for the research-plan animation.
   Z-up metric world. RoboCasa-style kitchen counter (procedural, schematic) with a Franka Panda
   (meshes from mujoco_menagerie, Apache-2.0) on a mobile base. Theme "night lab": dark set, image-based
   lighting, the counter is the lit stage. Every visible state is a pure function of the timeline time t,
   so the browser player and the headless renderer agree. */
(function (root) {
  'use strict';
  const core = root.MGCore;
  const { clamp, lerp, ramp, sramp, easeIO, easeOut, fade, WORLD, FX0, FX1, FZ0, FZ1 } = core.util;
  const LC = core.C; // overlay label colours

  // ---- world constants ----
  const COUNTER_Z = 0.92;          // counter top height
  const X_OFF = -0.25;             // field x = world x - X_OFF
  const Y_TASK = 0.22;             // object plane (y) on the counter
  const Y_FIELD_PLANE = Y_TASK + 0.11; // vertical slice plane sits just behind the objects
  const GHOST = 0.22;              // robot opacity while a field slice is being read
  const MOUNT_X = 0.02;            // robot column x (left of the barrier so the arm does not hide it)
  const BG = 0x0b0f15;             // = core.C.paper
  const fieldToWorld = (fx, fz) => new THREE.Vector3(fx + X_OFF, Y_TASK, fz + COUNTER_Z);
  const TOP_Y_CROP = 0.10;         // top-view field rows with fy < 0.10 lie in front of the counter
  const topFieldToWorld = (fx, fy) => new THREE.Vector3(fx + X_OFF, fy - 0.10, COUNTER_Z + 0.17);

  const COL = {
    counter: 0xd9d4cb, cabinet: 0x232a33, door: 0x2b333e, toe: 0x14181d, wall: 0x161b22,
    upper: 0x232a33, steel: 0xa3abb5, black: 0x0e1013, hood: 0x59616b, rangeBody: 0x2a2f37,
    barrier: 0x56657a, bowl: 0x6b7f99, bowl2: 0x2f6fe0, cup: 0xe2ddd3,
    base: 0x1d2228, baseLight: 0x2c333c, wheel: 0x0f1114,
    blue: 0x6ea8ff, orange: 0xffa24c, teal: 0x2dd4bf, red: 0xff6b6b, ink: 0xeef2f7, violet: 0xb49bff, grey: 0x8d98a8
  };

  // ---- minimal GLB loader (positions + indices + node tree, as exported by trimesh) ----
  function parseGLB(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a glb');
    const len = dv.getUint32(8, true);
    let off = 12, json = null, bin = null;
    while (off < len) {
      const clen = dv.getUint32(off, true), ctype = dv.getUint32(off + 4, true); off += 8;
      if (ctype === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off, clen)));
      else if (ctype === 0x004E4942) bin = buf.slice(off, off + clen);
      off += clen;
    }
    const acc = (i) => {
      const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
      const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
      const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
      const T = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
      return { array: new T(bin, start, a.count * n), n };
    };
    const meshes = json.meshes.map(m => {
      const p = m.primitives[0], pos = acc(p.attributes.POSITION), g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos.array, 3));
      if (p.attributes.TEXCOORD_0 != null) g.setAttribute('uv', new THREE.BufferAttribute(acc(p.attributes.TEXCOORD_0).array, 2));
      if (p.indices != null) { const idx = acc(p.indices); g.setIndex(new THREE.BufferAttribute(idx.array, 1)); }
      if (p.attributes.NORMAL != null) g.setAttribute('normal', new THREE.BufferAttribute(acc(p.attributes.NORMAL).array, 3));
      else g.computeVertexNormals();
      return g;
    });
    // embedded images (bufferView + mimeType) as Blobs
    const images = (json.images || []).map(im => { const bv = json.bufferViews[im.bufferView]; return new Blob([new Uint8Array(bin, bv.byteOffset || 0, bv.byteLength)], { type: im.mimeType }); });
    return { json, meshes, images };
  }

  // ---- robot ----
  class Panda {
    constructor(glb, kin) {
      this.root = new THREE.Group(); this.root.name = 'panda';
      this.links = {}; this.kin = kin; this.materials = [];
      const matFor = {};
      for (const [name, rgba] of Object.entries(kin.materials)) {
        const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(rgba[0], rgba[1], rgba[2]), roughness: name === 'black' ? 0.55 : 0.35, metalness: name === 'black' ? 0.3 : 0.05, transparent: true, opacity: 1 });
        matFor[name] = m; this.materials.push(m);
      }
      // node tree from glb: link nodes contain mesh nodes named link__material
      const nodes = glb.json.nodes;
      const meshNodesByLink = {};
      nodes.forEach((n, i) => { if (n.children) meshNodesByLink[n.name] = n.children.map(c => nodes[c]); });
      // build kinematic hierarchy from JSON
      for (const L of kin.links) {
        const o = new THREE.Group(); o.name = L.name;
        o.userData.pos = new THREE.Vector3(...L.pos);
        const q = new THREE.Quaternion(L.quat[1], L.quat[2], L.quat[3], L.quat[0]).normalize();
        o.userData.quat = q; o.userData.joint = L.joint; o.userData.q = 0;
        o.position.copy(o.userData.pos); o.quaternion.copy(q);
        const mn = meshNodesByLink[L.name] || [];
        for (const m of mn) {
          const mat = matFor[m.name.split('__')[1]] || matFor.white;
          const mesh = new THREE.Mesh(glb.meshes[m.mesh], mat); mesh.castShadow = true; mesh.receiveShadow = false;
          o.add(mesh);
        }
        this.links[L.name] = o;
        (L.parent ? this.links[L.parent] : this.root).add(o);
      }
      this.chain = ['link1', 'link2', 'link3', 'link4', 'link5', 'link6', 'link7'];
      this.q = [0, -0.4, 0, -2.2, 0, 1.9, 0.8];
      this.fingers = 0.04;
      // TCP: in the hand frame, fingertips are ~0.1034 along +z
      this.tcpOffset = new THREE.Vector3(0, 0, 0.1034);
      this.apply();
    }
    setOpacity(a) { for (const m of this.materials) { m.opacity = a; m.transparent = true; m.depthWrite = a > 0.99; } }
    apply() {
      this.chain.forEach((n, i) => {
        const o = this.links[n], ax = o.userData.joint.axis;
        const qj = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(ax[0], ax[1], ax[2]), this.q[i]);
        o.quaternion.copy(o.userData.quat).multiply(qj);
      });
      const lf = this.links.left_finger, rf = this.links.right_finger;
      // MuJoCo slide joints move along the axis in the body's own frame; the right finger frame is
      // rotated 180° about z (quat 0 0 0 1), so its +y is the parent's −y.
      lf.position.copy(lf.userData.pos).add(new THREE.Vector3(0, this.fingers, 0).applyQuaternion(lf.userData.quat));
      rf.position.copy(rf.userData.pos).add(new THREE.Vector3(0, this.fingers, 0).applyQuaternion(rf.userData.quat));
      this.root.updateMatrixWorld(true);
    }
    // FK of the tcp for a joint vector, in the robot root frame
    fk(q) {
      let M = new THREE.Matrix4();
      const tmp = new THREE.Matrix4(), qq = new THREE.Quaternion();
      const order = ['link1', 'link2', 'link3', 'link4', 'link5', 'link6', 'link7', 'hand'];
      order.forEach((n, i) => {
        const o = this.links[n];
        qq.copy(o.userData.quat);
        if (i < 7) { const ax = o.userData.joint.axis; qq.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(ax[0], ax[1], ax[2]), q[i])); }
        tmp.compose(o.userData.pos, qq, new THREE.Vector3(1, 1, 1));
        M.multiply(tmp);
      });
      tmp.makeTranslation(this.tcpOffset.x, this.tcpOffset.y, this.tcpOffset.z);
      M.multiply(tmp);
      return M;
    }
    // damped least squares IK toward a target tcp pose (position p, rotation R as Matrix4) in root frame
    ik(q0, target, iters, wRot) {
      iters = iters || 40; wRot = wRot == null ? 0.35 : wRot;
      const q = q0.slice(), lim = this.chain.map(n => this.links[n].userData.joint.range);
      const tp = new THREE.Vector3().setFromMatrixPosition(target), tq = new THREE.Quaternion().setFromRotationMatrix(target);
      const err = (qq) => {
        const M = this.fk(qq), p = new THREE.Vector3().setFromMatrixPosition(M), r = new THREE.Quaternion().setFromRotationMatrix(M);
        const dq = tq.clone().multiply(r.clone().invert()); // rotation taking r → tq
        if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
        const ang = 2 * Math.acos(clamp(dq.w, -1, 1)), s = Math.sqrt(Math.max(1 - dq.w * dq.w, 1e-12));
        const ax = ang > 1e-6 ? [dq.x / s * ang, dq.y / s * ang, dq.z / s * ang] : [0, 0, 0];
        return [tp.x - p.x, tp.y - p.y, tp.z - p.z, ax[0] * wRot, ax[1] * wRot, ax[2] * wRot];
      };
      for (let it = 0; it < iters; it++) {
        const e = err(q); const en = Math.hypot(...e); if (en < 1e-4) break;
        // numeric Jacobian 6×7
        const J = [], h = 1e-4;
        for (let j = 0; j < 7; j++) { const qp = q.slice(); qp[j] += h; const ep = err(qp); J.push(e.map((v, k) => (v - ep[k]) / h)); } // d(residual)/dq
        // solve (J Jᵀ + λI) y = e ; dq = Jᵀ y   (J stored column-wise: J[j][k])
        const lam = 0.02;
        const A = Array.from({ length: 6 }, () => new Array(6).fill(0));
        for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) { let s = 0; for (let j = 0; j < 7; j++) s += J[j][a] * J[j][b]; A[a][b] = s + (a === b ? lam : 0); }
        const y = solve6(A, e);
        for (let j = 0; j < 7; j++) { let s = 0; for (let k = 0; k < 6; k++) s += J[j][k] * y[k]; q[j] = clamp(q[j] + 0.6 * s, lim[j][0] + 0.02, lim[j][1] - 0.02); }
      }
      return q;
    }
  }
  function solve6(A, b) { // Gaussian elimination
    const n = 6, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c] || 1e-12;
      for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / d; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / (r[i] || 1e-12));
  }


  // r128 treats hex colours as linear while the output is sRGB: convert authored colours once.
  function linMat(m) {
    if (!m || m.userData.lin) return; m.userData.lin = true;
    if (m.color) m.color.convertSRGBToLinear();
    if (m.emissive) m.emissive.convertSRGBToLinear();
    if (m.map) m.map.encoding = THREE.sRGBEncoding;
  }
  function linObject(o) { o.traverse(c => { if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(linMat); }); }

  // ---- image-based lighting: a small procedural "studio" baked into a PMREM ----
  function makeEnvironment(renderer) {
    const pm = new THREE.PMREMGenerator(renderer);
    const s = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(14, 14, 9), new THREE.MeshBasicMaterial({ color: 0x07090c, side: THREE.BackSide }));
    room.position.set(0, 0, 3); s.add(room);
    const panel = (w, h, col, k, pos) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(pos[0], pos[1], pos[2]); m.lookAt(0.3, 0.2, 1.0); s.add(m);
    };
    panel(5, 3, 0xffffff, 2.2, [0.2, -1.2, 6]);     // overhead softbox
    panel(3, 2.4, 0xffe7c9, 2.6, [-4.5, -3.5, 3]);  // warm key, front-left
    panel(2.2, 3, 0xbfd4ff, 1.4, [4.5, 3.5, 2.5]);  // cool rim, back-right
    panel(6, 1, 0xffffff, 0.35, [0, -6, 0.6]);      // low front bounce
    const tex = pm.fromScene(s, 0.035).texture; pm.dispose();
    return tex;
  }

  // ---- geometry helpers ----
  function std(color, o) { o = o || {}; return new THREE.MeshStandardMaterial({ color, roughness: o.rough == null ? 0.6 : o.rough, metalness: o.metal || 0, emissive: o.emissive || 0x000000, emissiveIntensity: o.ei == null ? 1 : o.ei, transparent: !!o.transparent, opacity: o.opacity == null ? 1 : o.opacity }); }
  function box(w, d, h, color, o) {
    o = o || {};
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), std(color, o));
    m.castShadow = o.shadow !== false; m.receiveShadow = true; return m;
  }
  function canvasTex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); return t; }
  const makeTileTexture = () => canvasTex(512, 256, g => {
    g.fillStyle = '#1e252e'; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = '#11161c'; g.lineWidth = 4;
    for (let r = 0; r < 4; r++) { const y = r * 64; g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); const off = r % 2 ? 64 : 0; for (let x = off; x < 512; x += 128) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke(); } }
  }, [4, 2]);
  const makeFloorTexture = () => canvasTex(512, 512, g => {
    g.fillStyle = '#1b1714'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#1f1a16' : '#181411'; g.fillRect(0, i * 64, 512, 64); g.strokeStyle = '#0f0c0a'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, i * 64); g.lineTo(512, i * 64); g.stroke(); }
  }, [6, 6]);
  const makeCounterTexture = () => canvasTex(256, 256, g => {
    g.fillStyle = '#d9d4cb'; g.fillRect(0, 0, 256, 256);
    let s = 12345; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 1600; i++) { g.fillStyle = rnd() < 0.5 ? '#cbc4b8' : '#e6e1d8'; g.fillRect(rnd() * 256, rnd() * 256, 2, 2); }
  }, [6, 2]);
  function glowMat(color, o) { o = o || {}; return std(color, { rough: 0.45, emissive: color, ei: o.ei == null ? 0.65 : o.ei, transparent: true }); }
  function makeArrow(color, radius) {
    const g = new THREE.Group(), mat = glowMat(color, { ei: 0.55 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 12), mat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.6, radius * 6, 16), mat);
    shaft.name = 'shaft'; head.name = 'head'; g.add(shaft); g.add(head); g.userData.mat = mat; g.userData.radius = radius; g.visible = false;
    return g;
  }
  function setArrow(a, from, dir, len, opacity) {
    const d = dir.clone(); if (d.lengthSq() < 1e-12 || len < 1e-4) { a.visible = false; return; }
    d.normalize(); a.visible = true; a.userData.mat.opacity = opacity == null ? 1 : opacity;
    const headLen = Math.min(a.userData.radius * 6, len * 0.45), shaftLen = Math.max(len - headLen, 1e-4);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    const shaft = a.getObjectByName('shaft'), head = a.getObjectByName('head');
    shaft.scale.set(1, shaftLen, 1); shaft.position.copy(from).add(d.clone().multiplyScalar(shaftLen / 2)); shaft.quaternion.copy(q);
    head.position.copy(from).add(d.clone().multiplyScalar(shaftLen + headLen / 2)); head.quaternion.copy(q);
  }
  function tubeFromPoints(pts, radius, color, segs, o) {
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, segs || 48, radius, 8, false);
    const mesh = new THREE.Mesh(geo, glowMat(color, o));
    linMat(mesh.material); mesh.castShadow = false; return mesh;
  }
  function setTubeProgress(mesh, prog) {
    const idx = mesh.geometry.index.count; mesh.geometry.setDrawRange(0, Math.floor(idx * clamp(prog, 0, 1) / 3) * 3);
    mesh.visible = prog > 0.001;
  }
  // Banana: YCB Object and Model Set scan (011_banana, Google 16k), CC BY 4.0 — see scripts/convert_banana.py.
  // Pivot = fruit midline at mid-length; long axis +x, thickness ±0.019 m in z.
  let BANANA = null; // { geometry, texture }
  const BANANA_HALF_H = 0.019;
  function makeBanana() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ map: BANANA.texture, roughness: 0.55, metalness: 0, transparent: true });
    mat.userData.lin = true; // the texture is already sRGB-tagged; the white base colour needs no conversion
    const body = new THREE.Mesh(BANANA.geometry, mat); body.castShadow = true; body.receiveShadow = true; g.add(body);
    g.userData.mats = [mat];
    return g;
  }
  function makeBowl(color) {
    const prof = []; const R = WORLD.bowlR, Hb = WORLD.bowlH;
    for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(R * (0.45 + 0.55 * Math.sin(t * Math.PI / 2)), Hb * t)); }
    prof.push(new THREE.Vector2(R * 0.97, Hb * 0.98)); prof.push(new THREE.Vector2(R * 0.5, Hb * 0.25)); prof.push(new THREE.Vector2(0, Hb * 0.2));
    prof.unshift(new THREE.Vector2(0, 0));
    const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), new THREE.MeshStandardMaterial({ color, roughness: 0.32, side: THREE.DoubleSide, transparent: true }));
    m.rotation.x = Math.PI / 2; // lathe axis y → z-up
    m.castShadow = true; m.receiveShadow = true; return m;
  }
  // deterministic gaussian from the shared rng
  function gauss(rnd) { const a = Math.max(rnd(), 1e-9), b = rnd(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); }

  // ---- the world ----
  class World {
    constructor(renderer, glb, kin) {
      THREE.Object3D.DefaultUp.set(0, 0, 1);
      this.renderer = renderer;
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(BG);
      this.scene.fog = new THREE.Fog(BG, 3.3, 7.8); // fog is applied after encoding in r128 → hex matches the background
      this.scene.environment = makeEnvironment(renderer);
      this.camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.05, 40); this.camera.up.set(0, 0, 1);
      this.camera2 = new THREE.PerspectiveCamera(36, 8 / 9, 0.05, 40); this.camera2.up.set(0, 0, 1);
      this.buildLights(); this.buildKitchen(); this.buildRobot(glb, kin); this.buildTask(); this.buildOverlays3d();
      this.precompute();
      this.buildCem();
      linObject(this.scene);
      for (const p of [this.plane, this.topPlane]) { p.material.toneMapped = false; p.material.map.encoding = THREE.sRGBEncoding; p.material.fog = false; }
      for (const m of [this.ring.material, this.halo.material]) { m.toneMapped = false; m.fog = false; }
      // "new kitchen" look: per-mesh colour swaps (linear), light and background changes, clutter
      this.looks = []; this.scene.traverse(o => { if (o.isMesh && o.userData.look != null) this.looks.push({ m: o.material, base: o.material.color.clone(), real: new THREE.Color(o.userData.look).convertSRGBToLinear() }); });
      this.lookState = 0;
      // geometry layer: a world-anchored overlay pass (height tint + metric grid in the robot/world frame),
      // identical whatever the textures, lights or camera placement
      this.geo = 0;
      this.geoMat = new THREE.ShaderMaterial({
        uniforms: { opacity: { value: 0 } },
        vertexShader: 'varying vec3 vW; void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition; }', // same depth as three.js materials
        fragmentShader: [
          'uniform float opacity; varying vec3 vW;',
          'float gl1(float v, float s) { float f = v / s; float d = abs(fract(f - 0.5) - 0.5); float w = fwidth(f); return (1.0 - smoothstep(0.0, w * 1.5, d)) * (1.0 - smoothstep(0.08, 0.25, w)); }',
          'void main() {',
          '  float h = smoothstep(0.0, 1.5, vW.z);',
          '  vec3 c = mix(vec3(0.015, 0.05, 0.07), vec3(0.06, 0.36, 0.40), h);',
          '  float g = max(gl1(vW.x, 0.20), gl1(vW.y, 0.20));',
          '  float iz = vW.z > 0.85 ? gl1(vW.z - 0.92, 0.08) : 0.0;',
          '  c += vec3(0.16, 0.83, 0.75) * (0.22 * g + 0.45 * iz);',
          '  gl_FragColor = vec4(c, opacity);',
          '}'].join('\n'),
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, extensions: { derivatives: true }
      });
      this.camera3 = new THREE.PerspectiveCamera(36, 8 / 9, 0.05, 40); this.camera3.up.set(0, 0, 1);
    }
    setLook(r) {
      if (this.lookState === r) return; this.lookState = r;
      for (const L of this.looks) L.m.color.copy(r ? L.real : L.base);
      this.keyLight.color.setHex(r ? 0xffdcae : 0xfff1e0); this.keyLight.intensity = r ? 2.0 : 1.7;
      this.hemi.intensity = r ? 0.45 : 0.18; this.rimLight.intensity = r ? 0.45 : 0.7;
      this.scene.background.setHex(r ? 0x2b2722 : BG); this.scene.fog.color.setHex(r ? 0x2b2722 : BG);
      this.clutter.visible = !!r;
    }
    renderGeo(cam) {
      if (!(this.geo > 0.001)) return;
      const r = this.renderer, S = this.scene, ov = this.ov.visible, pv = this.plane.visible, tv = this.topPlane.visible, bg = S.background;
      this.ov.visible = false; this.plane.visible = false; this.topPlane.visible = false; S.background = null;
      S.overrideMaterial = this.geoMat; this.geoMat.uniforms.opacity.value = this.geo;
      const au = r.autoClear, su = r.shadowMap.autoUpdate; r.autoClear = false; r.shadowMap.autoUpdate = false;
      r.render(S, cam);
      r.autoClear = au; r.shadowMap.autoUpdate = su; S.overrideMaterial = null; S.background = bg;
      this.ov.visible = ov; this.plane.visible = pv; this.topPlane.visible = tv;
    }
    buildLights() {
      this.hemi = new THREE.HemisphereLight(0xc8d6ea, 0x1a1612, 0.18); this.scene.add(this.hemi);
      const key = new THREE.DirectionalLight(0xfff1e0, 1.7); key.position.set(-1.0, -2.0, 3.2); key.castShadow = true;
      const sm = ((typeof window !== 'undefined' && window.MG_RENDER_OPTS) || {}).shadow || 2048; key.shadow.mapSize.set(sm, sm); key.shadow.camera.near = 0.5; key.shadow.camera.far = 9; // capture may use a 1024 map
      key.shadow.camera.left = -2.0; key.shadow.camera.right = 2.0; key.shadow.camera.top = 2.0; key.shadow.camera.bottom = -2.0; key.shadow.bias = -0.0008;
      key.target.position.set(0.3, 0.2, 0.9);
      this.scene.add(key); this.scene.add(key.target); this.keyLight = key;
      const rim = new THREE.DirectionalLight(0xbcd2ff, 0.7); rim.position.set(1.6, 2.6, 2.6); this.scene.add(rim); this.rimLight = rim;
    }
    buildKitchen() {
      const K = new THREE.Group(); K.name = 'kitchen'; this.scene.add(K);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.7 })); floor.receiveShadow = true; floor.userData.look = 0x9a8a78; K.add(floor);
      const wall = box(6.0, 0.08, 2.7, COL.wall, { shadow: false, rough: 0.9 }); wall.position.set(0.5, 0.64, 1.35); wall.userData.look = 0x9c9384; K.add(wall);
      const tiles = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.56), new THREE.MeshStandardMaterial({ map: makeTileTexture(), roughness: 0.3 }));
      tiles.rotation.x = Math.PI / 2; tiles.position.set(0.5, 0.598, COUNTER_Z + 0.30); tiles.userData.look = 0xe2d4bf; K.add(tiles);
      const cab = box(4.6, 0.58, 0.78, COL.cabinet, { rough: 0.6 }); cab.position.set(0.5, 0.31, 0.49); cab.userData.look = 0x6a5240; K.add(cab);
      const toe = box(4.6, 0.52, 0.10, COL.toe, { shadow: false }); toe.position.set(0.5, 0.34, 0.05); toe.userData.look = 0x3a2e24; K.add(toe);
      for (let i = 0; i < 7; i++) {
        const x = -1.6 + 0.3 + i * 0.6; if (x > 0.85 && x < 1.75) continue;
        const door = box(0.57, 0.02, 0.68, COL.door, { rough: 0.45 }); door.position.set(x, 0.01, 0.46); door.userData.look = 0x7a5e48; K.add(door);
        const handle = box(0.18, 0.018, 0.018, COL.steel, { metal: 0.9, rough: 0.25 }); handle.position.set(x, -0.012, 0.74); K.add(handle);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(4.64, 0.62, 0.04), new THREE.MeshStandardMaterial({ map: makeCounterTexture(), roughness: 0.32 })); top.position.set(0.5, 0.31, COUNTER_Z - 0.02); top.userData.look = 0xb08a62; top.receiveShadow = true; top.castShadow = true; K.add(top);
      const upper = box(4.6, 0.34, 0.72, COL.upper, { rough: 0.6 }); upper.position.set(0.5, 0.47, 1.86); upper.userData.look = 0x6a5240; K.add(upper);
      for (let i = 0; i < 7; i++) { const x = -1.6 + 0.3 + i * 0.6; if (x > 0.85 && x < 1.75) continue; const d = box(0.57, 0.02, 0.64, COL.door, { rough: 0.45 }); d.position.set(x, 0.295, 1.86); d.userData.look = 0x7a5e48; K.add(d); const h = box(0.018, 0.018, 0.16, COL.steel, { metal: 0.9, rough: 0.25 }); h.position.set(x + 0.2, 0.28, 1.61); K.add(h); }
      // warm under-cabinet light strip (emissive) — the counter reads as a lit stage
      const strip = box(4.4, 0.03, 0.012, 0xffd9a8, { emissive: 0xffd9a8, ei: 2.2, shadow: false }); strip.position.set(0.5, 0.42, 1.495); K.add(strip);
      const range = box(0.76, 0.60, 0.84, COL.rangeBody, { rough: 0.35, metal: 0.6 }); range.position.set(1.3, 0.30, 0.42); K.add(range);
      const cook = box(0.74, 0.56, 0.03, COL.black, { rough: 0.12, metal: 0.2 }); cook.position.set(1.3, 0.30, COUNTER_Z + 0.005); K.add(cook);
      for (const [dx, dy] of [[-0.18, -0.12], [0.18, -0.12], [-0.18, 0.14], [0.18, 0.14]]) { const burner = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.006, 8, 40), std(0x3a3f46, { rough: 0.4 })); burner.position.set(1.3 + dx, 0.30 + dy, COUNTER_Z + 0.022); K.add(burner); }
      const hood = box(0.8, 0.5, 0.12, COL.hood, { metal: 0.85, rough: 0.3 }); hood.position.set(1.3, 0.37, 1.56); K.add(hood);
      const basin = box(0.56, 0.40, 0.012, COL.steel, { metal: 0.9, rough: 0.3, shadow: false }); basin.position.set(-0.8, 0.30, COUNTER_Z + 0.001); K.add(basin);
      const faucet = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 12), std(COL.steel, { metal: 0.95, rough: 0.2 })); faucet.rotation.x = Math.PI / 2; faucet.position.set(-0.8, 0.54, COUNTER_Z + 0.14); K.add(faucet);
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 12), std(COL.steel, { metal: 0.95, rough: 0.2 })); spout.position.set(-0.8, 0.43, COUNTER_Z + 0.27); spout.rotation.set(Math.PI / 2, 0, Math.PI / 2); K.add(spout);
      // night window above the sink
      const win = box(0.9, 0.02, 0.7, 0x1b2c46, { shadow: false, rough: 0.15, emissive: 0x1b2f4f, ei: 0.9 }); win.position.set(-0.8, 0.60, 1.75); K.add(win);
      const frame = box(0.96, 0.03, 0.03, 0x2c333c, { shadow: false }); frame.position.set(-0.8, 0.595, 2.115); K.add(frame);
      const frame2 = frame.clone(); frame2.position.z = 1.385; K.add(frame2);
      // mobile base for the robot (Omron-like)
      const B = new THREE.Group(); B.name = 'mobileBase'; K.add(B);
      B.position.set(MOUNT_X, -0.44, 0);
      const chassis = box(0.52, 0.70, 0.26, COL.base, { rough: 0.4, metal: 0.3 }); chassis.position.set(0, 0, 0.21); B.add(chassis);
      const topPlate = box(0.56, 0.74, 0.03, COL.baseLight, { rough: 0.35, metal: 0.5 }); topPlate.position.set(0, 0, 0.355); B.add(topPlate);
      for (const [dx, dy] of [[-0.2, -0.25], [0.2, -0.25], [-0.2, 0.25], [0.2, 0.25]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 20), std(COL.wheel)); w.rotation.z = Math.PI / 2; w.position.set(dx, dy, 0.08); B.add(w); }
      const column = box(0.28, 0.28, 0.34, COL.baseLight, { rough: 0.4, metal: 0.4 }); column.position.set(0, 0.22, 0.54); B.add(column);
      const armPlate = box(0.26, 0.26, 0.02, COL.base, { rough: 0.5 }); armPlate.position.set(0, 0.22, 0.72); B.add(armPlate);
      this.robotMount = new THREE.Vector3(MOUNT_X, -0.22, 0.73);
      // everyday clutter, shown only in the "new kitchen" (sim-to-real chapter); kept behind the work area
      const CL = new THREE.Group(); CL.name = 'clutter'; CL.visible = false; K.add(CL); this.clutter = CL;
      const put = (m, x, y, z) => { m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; CL.add(m); return m; };
      put(box(0.19, 0.07, 0.27, 0xc8412f, { rough: 0.6 }), -0.42, 0.50, COUNTER_Z + 0.135);
      put(box(0.19, 0.072, 0.07, 0xf2c14e, { rough: 0.6 }), -0.42, 0.464, COUNTER_Z + 0.20);
      put(box(0.36, 0.24, 0.02, 0x9b6b3f, { rough: 0.7 }), -0.10, 0.47, COUNTER_Z + 0.01);
      { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 20), std(0xb9c2cc, { metal: 0.3, rough: 0.35 })); c.rotation.x = Math.PI / 2; put(c, 0.12, 0.50, COUNTER_Z + 0.06); }
      { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 20), std(0xd2443a, { rough: 0.4 })); c.rotation.x = Math.PI / 2; put(c, 0.20, 0.53, COUNTER_Z + 0.06); }
      { const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.05, 0.11, 20), std(0xb4643c, { rough: 0.8 })); pot.rotation.x = Math.PI / 2; put(pot, 0.98, 0.50, COUNTER_Z + 0.055);
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.10, 20, 14), std(0x3f8a4a, { rough: 0.8 })); leaf.scale.set(1, 1, 0.8); put(leaf, 0.98, 0.50, COUNTER_Z + 0.17); }
      { const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.09, 20), std(0xf0ece4, { rough: 0.4 })); mug.rotation.x = Math.PI / 2; put(mug, 0.80, 0.47, COUNTER_Z + 0.045); }
      { const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.26, 16), std(0x2f6b4f, { rough: 0.2 })); bottle.rotation.x = Math.PI / 2; put(bottle, -0.62, 0.52, COUNTER_Z + 0.13); }
      // performance: large matte backdrop surfaces use Lambert shading (per-vertex lighting, still shadowed and fogged);
      // metal parts keep PBR + environment reflections. In software WebGL this halves the frame cost.
      K.traverse(o => {
        if (!o.isMesh || !o.material.isMeshStandardMaterial || o.material.metalness >= 0.5) return;
        const m = o.material; o.material = new THREE.MeshLambertMaterial({ color: m.color, map: m.map, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity });
      });
    }
    buildRobot(glb, kin) {
      this.panda = new Panda(glb, kin);
      this.panda.root.position.copy(this.robotMount);
      this.panda.root.rotation.set(0, 0, Math.PI / 2); // Panda base +x faces the counter (+y)
      this.scene.add(this.panda.root);
      this.panda.root.updateMatrixWorld(true);
    }
    buildTask() {
      const T = new THREE.Group(); T.name = 'task'; this.scene.add(T); this.task = T;
      this.barrier = box(WORLD.barrierX1 - WORLD.barrierX0, 0.45, WORLD.barrierH, COL.barrier, { rough: 0.5 });
      T.add(this.barrier);
      this.roof = box(0.40, 0.50, 0.03, 0x9fb4cc, { rough: 0.2, transparent: true, opacity: 0.3, shadow: false }); this.roof.material.depthWrite = false;
      this.roof.position.set((WORLD.barrierX0 + WORLD.barrierX1) / 2 + X_OFF, 0.15, COUNTER_Z + WORLD.barrierH + 0.015); this.roof.visible = false; T.add(this.roof);
      // low ceiling shelf (scene "skills, not the combination")
      this.ceiling = box(0.80, 0.46, 0.02, 0x9fb4cc, { rough: 0.2, transparent: true, opacity: 0.32, shadow: false }); this.ceiling.material.depthWrite = false;
      this.ceiling.position.set(0.58 + X_OFF, 0.23, COUNTER_Z + 0.47); this.ceiling.visible = false; T.add(this.ceiling);
      this.bowl = makeBowl(COL.bowl); this.bowl.position.set(WORLD.bowlX + X_OFF, Y_TASK, COUNTER_Z); T.add(this.bowl);
      this.bowl2 = makeBowl(COL.bowl2); this.bowl2.position.set(WORLD.bowl2X + X_OFF, Y_TASK, COUNTER_Z); this.bowl2.visible = false; T.add(this.bowl2);
      const CU = WORLD.cup;
      this.cup = new THREE.Mesh(new THREE.CylinderGeometry((CU.x1 - CU.x0) / 2, (CU.x1 - CU.x0) / 2 * 0.9, CU.h, 24), std(COL.cup, { rough: 0.35 }));
      this.cup.rotation.x = Math.PI / 2; this.cup.position.set((CU.x0 + CU.x1) / 2 + X_OFF, Y_TASK, COUNTER_Z + CU.h / 2); this.cup.castShadow = true; this.cup.visible = false; T.add(this.cup);
      this.banana = makeBanana(); T.add(this.banana);
      this.bananaB = makeBanana(); this.bananaB.visible = false; T.add(this.bananaB); // the "dropped" banana
      // field slice planes
      this.planeTexCanvas = document.createElement('canvas'); this.planeTexCanvas.width = 1200; this.planeTexCanvas.height = 640;
      this.planeTex = new THREE.CanvasTexture(this.planeTexCanvas); this.planeTex.minFilter = THREE.LinearFilter;
      this.plane = new THREE.Mesh(new THREE.PlaneGeometry(FX1 - FX0, FZ1 - FZ0), new THREE.MeshBasicMaterial({ map: this.planeTex, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
      this.plane.rotation.x = Math.PI / 2;
      this.plane.position.set((FX0 + FX1) / 2 + X_OFF, Y_FIELD_PLANE, COUNTER_Z + (FZ0 + FZ1) / 2); T.add(this.plane);
      this.topTexCanvas = document.createElement('canvas'); this.topTexCanvas.width = 1200; this.topTexCanvas.height = 640;
      this.topTex = new THREE.CanvasTexture(this.topTexCanvas); this.topTex.minFilter = THREE.LinearFilter;
      const cropF = TOP_Y_CROP / (FZ1 - FZ0);
      this.topTex.repeat.set(1, 1 - cropF); this.topTex.offset.set(0, cropF); // plane v ∈ [0,1] ↔ texture v ∈ [crop, 1]
      this.topPlane = new THREE.Mesh(new THREE.PlaneGeometry(FX1 - FX0, FZ1 - FZ0 - TOP_Y_CROP), new THREE.MeshBasicMaterial({ map: this.topTex, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
      this.topPlane.position.set((FX0 + FX1) / 2 + X_OFF, (FZ1 - FZ0 + TOP_Y_CROP) / 2 - 0.10, COUNTER_Z + 0.135); T.add(this.topPlane); // just below the carried banana (centre at +0.17)
    }
    buildOverlays3d() {
      const O = new THREE.Group(); O.name = 'overlays'; this.scene.add(O); this.ov = O;
      this.arrows = { attract: makeArrow(COL.blue, 0.009), repel: makeArrow(COL.red, 0.009), net: makeArrow(COL.ink, 0.011), grad: makeArrow(COL.orange, 0.012), keep: makeArrow(COL.blue, 0.009), guide: [] };
      for (const k of ['attract', 'repel', 'net', 'grad', 'keep']) O.add(this.arrows[k]);
      for (let i = 0; i < 10; i++) { const a = makeArrow(COL.orange, 0.006); O.add(a); this.arrows.guide.push(a); }
      this.probeMarker = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), glowMat(COL.ink, { ei: 0.8 })); this.probeMarker.visible = false; O.add(this.probeMarker);
      const contact = core.util.contactPoint();
      const wp = core.util.arcPath(contact.x, contact.z, WORLD.bowlX - 0.02, 0.14, 0.40, 24).map(p => fieldToWorld(p[0], p[1]));
      this.wpPts = wp;
      this.straightTube = tubeFromPoints([fieldToWorld(WORLD.start.x, WORLD.start.z), fieldToWorld(WORLD.bowlX - 0.04, WORLD.start.z)], 0.004, COL.blue, 16); this.straightTube.visible = false; O.add(this.straightTube);
      this.chunkDots = []; for (let i = 0; i < 10; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.012, 14, 10), glowMat(COL.blue, { ei: 0.8 })); s.visible = false; O.add(s); this.chunkDots.push(s); }
      this.chunkTube = null; this.cleanTube = null;
      const arcPts = core.util.arcPath(WORLD.start.x + 0.03, WORLD.start.z, WORLD.bowlX, 0.13, 0.40, 60).map(p => fieldToWorld(p[0], p[1]).add(new THREE.Vector3(0, 0, 0.012)));
      this.arcTube = tubeFromPoints(arcPts, 0.003, COL.blue, 96); this.arcTube.visible = false; O.add(this.arcTube);
      this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 8, 40), new THREE.MeshBasicMaterial({ color: COL.red, transparent: true, opacity: 0 })); this.ring.visible = false; O.add(this.ring);
      // imagined end states of the world-model planner (ghost bananas)
      this.ghosts = []; for (let k = 0; k < 10; k++) { const g = makeBanana(); g.children.forEach(c => { c.material = glowMat(COL.violet, { ei: 0.9 }); c.material.opacity = 0.4; c.material.depthWrite = false; c.castShadow = false; }); g.visible = false; O.add(g); this.ghosts.push(g); }
      // "teacher attention" halo around the grasped banana (scene: deployment states)
      this.halo = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.004, 8, 64), new THREE.MeshBasicMaterial({ color: COL.orange, transparent: true, opacity: 0 })); this.halo.visible = false; O.add(this.halo);
    }
    // ---- precomputed IK trajectories ----
    precompute() {
      const P = this.panda;
      const R = new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
      P.root.updateMatrixWorld(true);
      const rootInv = new THREE.Matrix4().copy(P.root.matrixWorld).invert();
      this.poseFor = (fx, fz) => {
        const w = fieldToWorld(fx, fz); w.z -= 0.004; // fingertips slightly below the banana's centre: pads wrap the fruit
        const M = new THREE.Matrix4().copy(R); M.setPosition(w); return new THREE.Matrix4().multiplyMatrices(rootInv, M);
      };
      // adaptive IK: keep the hand top-down where the target is reachable that way; near the edge of the workspace,
      // relax the orientation weight step by step so the fingertips still reach the target (the hand tilts a little)
      this.qRefInv = new THREE.Quaternion().setFromRotationMatrix(R).invert();
      this.ikA = (q0, T, it) => {
        const tp = new THREE.Vector3().setFromMatrixPosition(T);
        let q = P.ik(q0, T, it || 60);
        for (const wr of [0.1, 0.03, 0.01]) { if (new THREE.Vector3().setFromMatrixPosition(P.fk(q)).distanceTo(tp) < 0.0015) break; q = P.ik(q, T, 150, wr); }
        return q;
      };
      // a whole path: top-down first; if some targets need a relaxed orientation weight, spread that relaxation smoothly
      // over the neighbouring samples (min-filter + moving average of the weight) so the hand never snaps
      this.solveSeq = (Ts, q0) => {
        const LAD = [0.35, 0.1, 0.03, 0.01], err = (q, T) => new THREE.Vector3().setFromMatrixPosition(P.fk(q)).distanceTo(new THREE.Vector3().setFromMatrixPosition(T));
        let q = q0.slice(); const lvl = [];
        for (const T of Ts) { let k = 0; q = P.ik(q, T, 60, LAD[0]); while (k < LAD.length - 1 && err(q, T) > 0.0015) { k++; q = P.ik(q, T, 150, LAD[k]); } lvl.push(k); }
        if (!lvl.some(k => k > 0)) { q = q0.slice(); return Ts.map(T => (q = P.ik(q, T, 60)).slice()); }
        const n = Ts.length, R1 = 6, R2 = 4;
        const lw = lvl.map(k => Math.log(LAD[k]));
        const mn = lw.map((_, i) => { let m = Infinity; for (let j = Math.max(0, i - R1); j <= Math.min(n - 1, i + R1); j++) m = Math.min(m, lw[j]); return m; });
        const wt = mn.map((_, i) => { let s2 = 0, c = 0; for (let j = Math.max(0, i - R2); j <= Math.min(n - 1, i + R2); j++) { s2 += mn[j]; c++; } return Math.exp(s2 / c); });
        q = q0.slice(); let qs = Ts.map((T, i) => (q = P.ik(q, T, 150, wt[i])).slice());
        for (let pass = 0; pass < 3; pass++) qs = smoothQ(qs).map((qq, i) => P.ik(qq, Ts[i], 4, wt[i])); // smooth, then pull back onto the path
        return qs;
      };
      // light temporal smoothing of a joint sequence (symmetric 5-tap window, shrinking at the ends so endpoints are exact):
      // removes single-sample elbow jumps where IK meets a joint-limit clamp near full extension
      const smoothQ = (qs) => { const n = qs.length, K = [1, 2, 3, 2, 1]; return qs.map((q, i) => { const r = Math.min(2, i, n - 1 - i); return q.map((_, j) => { let s2 = 0, c = 0; for (let d = -r; d <= r; d++) { s2 += qs[i + d][j] * K[d + 2]; c += K[d + 2]; } return s2 / c; }); }); };
      this.solvePath = (pts, q0) => this.solveSeq(pts.map(p => this.poseFor(p[0], p[1])), (q0 || P.q).slice());
      const contact = core.util.contactPoint();
      this.trajStraight = []; for (let i = 0; i <= 40; i++) this.trajStraight.push([lerp(WORLD.start.x, contact.x, i / 40), WORLD.start.z]);
      this.qStraight = this.solvePath(this.trajStraight);
      this.trajArc = core.util.arcPath(WORLD.start.x + 0.03, WORLD.start.z, WORLD.bowlX, 0.13, 0.40, 60);
      this.qArc = this.solvePath(this.trajArc);
      const pr = core.F.pStar; this.qProbe = this.ikA(this.qStraight[this.qStraight.length - 1], this.poseFor(pr.x, pr.z), 80);
      this.probeProg = (pr.x - WORLD.start.x) / (contact.x - WORLD.start.x); // the stall point lies on the straight approach
      this.poseAtW = (w) => { const v = w.clone(); v.z -= 0.004; const M = new THREE.Matrix4().copy(R); M.setPosition(v); return new THREE.Matrix4().multiplyMatrices(rootInv, M); };
      this.solvePathW = (ws, q0) => this.solveSeq(ws.map(w => this.poseAtW(w)), q0.slice());
      this.buildStreams();
      this.qHome = [0, -0.5, 0, -2.3, 0, 1.9, 0.78];
      // open layout (no barrier): approach, grasp from the counter, lift, carry low, place in the bowl
      const S = WORLD.start, seg = (a, b, n) => { const o = []; for (let i = 1; i <= n; i++) o.push([lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)]); return o; };
      const pick = [S.x, BANANA_HALF_H + 0.002], lift = [S.x, S.z], place = [WORLD.bowlX, 0.15], down = [WORLD.bowlX, 0.08];
      this.trajOpen = [[S.x, 0.13]].concat(seg([S.x, 0.13], pick, 10), seg(pick, lift, 10), core.util.arcPath(lift[0], lift[1], place[0], place[1], 0.24, 30).slice(1), seg(place, down, 10));
      this.qOpen = this.solvePath(this.trajOpen, this.qStraight[0]);
      this.trajArcHi = core.util.arcPath(WORLD.start.x + 0.03, WORLD.start.z, WORLD.bowlX, 0.13, 0.48, 60); // held-out higher barrier
      this.qArcHi = this.solvePath(this.trajArcHi, this.qStraight[0]);
      // sim-to-real chapter: the VLA's grasp lands 6 cm off in the new kitchen (hover → down → back up, empty),
      // then the corrected chunk moves over to the banana, grasps it and places it
      const MISS = S.x - 0.06, hoverM = [MISS, 0.13];
      this.trajMiss = [hoverM].concat(seg(hoverM, [MISS, BANANA_HALF_H + 0.002], 10), seg([MISS, BANANA_HALF_H + 0.002], hoverM, 10));
      this.qMiss = this.solvePath(this.trajMiss, this.qStraight[0]);
      this.trajFix = [hoverM].concat(seg(hoverM, [S.x, 0.13], 6), this.trajOpen.slice(1));
      this.qFix = this.solvePath(this.trajFix, this.qMiss[this.qMiss.length - 1]);
      const res = (traj, qs) => Math.max(...qs.map((q, k) => { const M = P.fk(q), p = new THREE.Vector3().setFromMatrixPosition(M).applyMatrix4(P.root.matrixWorld); const w = fieldToWorld(traj[k][0], traj[k][1]); w.z -= 0.004; return p.distanceTo(w); }));
      this.ikResidual = Object.assign(this.ikResidual || {}, { straight: res(this.trajStraight, this.qStraight), arc: res(this.trajArc, this.qArc), open: res(this.trajOpen, this.qOpen) });
    }
    // ---- world-model planner, schematic: CEM over short imagined rollouts scored by distance to the goal ----
    buildCem() {
      const rnd = core.util.rng(11), Lh = 0.24, goal = [WORLD.bowlX, 0.065];
      const blocked = (x, z) => x + WORLD.bananaHalf + 0.01 >= WORLD.barrierX0 && x - WORLD.bananaHalf <= WORLD.barrierX1 && z - 0.03 < WORLD.barrierH;
      const predict = (p, ang) => { let x = p[0], z = p[1]; for (let k = 0; k < 24; k++) { const nx = x + Math.cos(ang) * Lh / 24, nz = Math.max(0.06, z + Math.sin(ang) * Lh / 24); if (blocked(nx, nz)) break; x = nx; z = nz; } return [x, z]; };
      const cycle = (p, iters) => {
        let mu = 0.25, sig = 1.1; const out = [];
        for (let it = 0; it < iters; it++) {
          const cand = []; for (let k = 0; k < 10; k++) { const ang = clamp(mu + sig * gauss(rnd), -1.3, 1.45), end = predict(p, ang); cand.push({ ang, end, score: Math.hypot(end[0] - goal[0], end[1] - goal[1]) }); }
          const order = cand.map((c, k) => k).sort((a, b) => cand[a].score - cand[b].score);
          out.push({ cand, best: order[0] });
          const el = order.slice(0, 3); mu = el.reduce((s, k) => s + cand[k].ang, 0) / 3; sig *= 0.5;
        }
        return out;
      };
      const p0 = [WORLD.start.x, WORLD.start.z];
      const c1 = cycle(p0, 3), e1 = c1[2].cand[c1[2].best].end, p1 = [lerp(p0[0], e1[0], 0.6), lerp(p0[1], e1[1], 0.6)];
      const c2 = cycle(p1, 2), e2 = c2[1].cand[c2[1].best].end, p2 = [lerp(p1[0], e2[0], 0.6), lerp(p1[1], e2[1], 0.6)];
      const mkTubes = (p, its) => its.map(it => it.cand.map((c, k) => {
        // drawn from the banana's leading tip, slightly in front of it, so the imagined futures are not hidden
        const tip = WORLD.bananaHalf + 0.01, a = fieldToWorld(p[0] + tip, p[1]), b = fieldToWorld(c.end[0] + tip, c.end[1]), m = a.clone().lerp(b, 0.5); m.z += 0.015;
        for (const v of [a, m, b]) v.y += -0.06 + (k - 4.5) * 0.006;
        const tube = tubeFromPoints([a, m, b], 0.0045, COL.violet, 16, { ei: 1.1 }); tube.visible = false; this.ov.add(tube); return tube;
      }));
      this.cem = { cycles: [{ p: p0, its: c1, tubes: mkTubes(p0, c1) }, { p: p1, its: c2, tubes: mkTubes(p1, c2) }], p0, p1, p2 };
      const path = []; for (let i = 0; i <= 12; i++) path.push([lerp(p0[0], p1[0], i / 12), lerp(p0[1], p1[1], i / 12)]); for (let i = 1; i <= 12; i++) path.push([lerp(p1[0], p2[0], i / 12), lerp(p1[1], p2[1], i / 12)]);
      this.trajCem = path; this.qCem = this.solvePath(path, this.qStraight[0]);
    }
    // Streamlines of −∇T (banana centre), as the arm would follow them. Where the banana's full length would clip an
    // obstacle (the field inflates only by gripper + banana thickness), the path is lifted with a smooth envelope.
    buildStreams() {
      const half = WORLD.bananaHalf, hh = BANANA_HALF_H, B = { x0: WORLD.barrierX0, x1: WORLD.barrierX1 };
      const trace = (F, from, maxN) => {
        const pts = [from.slice()]; let p = from.slice();
        for (let k = 0; k < 900; k++) {
          const g = F.gradAt(p[0], p[1]), L = Math.hypot(g[0], g[1]); if (L < 1e-6) break;
          p = [p[0] - g[0] / L * 0.004, p[1] - g[1] / L * 0.004];
          const c = F.cell(p[0], p[1]); if (F.goal[c[1] * F.nx + c[0]]) { pts.push(p.slice()); break; }
          if (k % 3 === 2) pts.push(p.slice());
        }
        if (pts.length > maxN) { const o = []; for (let i = 0; i < maxN; i++) o.push(pts[Math.round(i * (pts.length - 1) / (maxN - 1))]); return o; }
        return pts;
      };
      const lift = (pts, obs) => {
        const req = pts.map(q => { let r = -1; for (const o of obs) if (q[0] + half > o.x0 && q[0] - half < o.x1) r = Math.max(r, o.h + hh + 0.015); return r; });
        const n = req.length, mx = req.map((_, i) => { let m = -1; for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) m = Math.max(m, req[j]); return m; });
        const av = mx.map((_, i) => { let s2 = 0, c = 0; for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) { s2 += mx[j]; c++; } return s2 / c; });
        return pts.map((q, i) => [q[0], Math.max(q[1], av[i])]);
      };
      const pr = core.F.pStar, probe = [pr.x, pr.z], W2 = WORLD, cup = W2.cup;
      const bar = h => [{ x0: B.x0, x1: B.x1, h }];
      // resample to uniform arc length (the lift envelope bunches points), so the arm moves at an even speed
      const even = (pts) => {
        const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const n = pts.length, tot = L[n - 1], o = []; let j = 0;
        for (let i = 0; i < n; i++) { const s2 = tot * i / (n - 1); while (j < n - 2 && L[j + 1] < s2) j++; const f = (s2 - L[j]) / Math.max(L[j + 1] - L[j], 1e-9); o.push([lerp(pts[j][0], pts[j + 1][0], f), lerp(pts[j][1], pts[j + 1][1], f)]); }
        return o;
      };
      const side = (key, obs) => { const pts = even(lift(trace(core.F[key], probe, 70), obs)); return { pts, q: this.solvePath(pts, this.qProbe) }; };
      this.streams = {
        L0: side('L0', bar(W2.barrierH)),
        L1: side('L1', []),
        L3: side('L3', bar(W2.tallH)),
        L4: side('L4', bar(W2.barrierH).concat([{ x0: cup.x0, x1: cup.x1, h: cup.h }]))
      };
      // top view (L2): the banana moves in x–y at fixed height, around the side opening
      const top = even(trace(core.F.L2, [0.30, 0.32], 70)), ws = top.map(p => topFieldToWorld(p[0], p[1]));
      const qTop = this.solvePathW(ws, this.qStraight[0]);
      const P = this.panda, res = Math.max(...qTop.map((q, k) => new THREE.Vector3().setFromMatrixPosition(P.fk(q)).applyMatrix4(P.root.matrixWorld).distanceTo(ws[k].clone().setZ(ws[k].z - 0.004))));
      this.streams.L2 = { pts: top, ws, q: qTop, ok: res < 0.01 };
      this.ikResidual = Object.assign(this.ikResidual || {}, { top: res });
    }
    // follow a precomputed stream: 0..1 progress, returns {q, p, world?}
    streamAt(st, k) { const q = this.sampleQ(st.q, k), p = this.sampleP(st.pts, k); return { q, p, world: st.ws ? (() => { const n = st.ws.length - 1, f = clamp(k, 0, 1) * n, i = Math.min(Math.floor(f), n - 1); return st.ws[i].clone().lerp(st.ws[i + 1], f - i); })() : null }; }
    qMix(a, b, k) { return a.map((v, i) => lerp(v, b[i], k)); }
    proposalAndCorrection(p, goal, st, u, tProp, tCorr, top) {
      if (u < tProp) return;
      const prop = []; for (let k = 0; k < 10; k++) { const x = lerp(p[0], goal[0], k / 9), y = lerp(p[1], goal[1], k / 9); prop.push(top ? topFieldToWorld(x, y).setZ(COUNTER_Z + 0.175) : fieldToWorld(x, y)); }
      const ap = ramp(u, tProp, tProp + 0.6); this.showProp(prop, 0.85 * ap);
      this.label(prop[6].clone().add(new THREE.Vector3(0, 0, top ? 0.02 : -0.05)), 'VLA proposal', LC.blueDeep, { size: 22, align: 'center', alpha: ap });
      if (u < tCorr) return;
      const P3 = st.ws ? st.ws.map(w => w.clone().setZ(w.z + 0.006)) : st.pts.map(q => fieldToWorld(q[0], q[1])), ac = ramp(u, tCorr, tCorr + 0.6);
      this.showChunkW(P3, ac, 1);
      const apex = P3.reduce((a, b) => (top ? b.y > a.y : b.z > a.z) ? b : a, P3[0]);
      this.label(apex.clone().add(new THREE.Vector3(top ? 0.10 : 0.09, 0, 0.04)), 'corrected chunk', LC.orangeDeep, { size: 22, alpha: ac });
    }
    arcAt(k, qs, traj) { // transport along a guided arc, starting from the start pose
      qs = qs || this.qArc; traj = traj || this.trajArc;
      const q = this.sampleQ(qs, k), p = this.sampleP(traj, k), b = clamp(k / 0.08, 0, 1);
      if (b >= 1) return { q, p };
      return { q: this.qMix(this.qStraight[0], q, b), p: [lerp(WORLD.start.x, p[0], b), lerp(WORLD.start.z, p[1], b)] };
    }
    // loop: execute the arc, hold, rewind to the start (schematic "next episode")
    arcLoop(u, period, t0) {
      const w = ((u - t0) % period + period) % period; if (u < t0) return this.arcAt(0);
      if (w < period * 0.58) return this.arcAt(sramp(w, 0, period * 0.58));
      if (w < period * 0.76) return this.arcAt(1);
      const r = sramp(w, period * 0.76, period), e = this.arcAt(1);
      return { q: this.qMix(e.q, this.qStraight[0], r), p: [lerp(e.p[0], WORLD.start.x, r), lerp(e.p[1], WORLD.start.z, r)] };
    }
    // follow a stream, then retract to qBack between [t0,t1] / [t1, t2]
    followAndBack(st, u, t0, t1, t2, qBack, pBack) {
      if (u < t1) { const a = this.streamAt(st, sramp(u, t0, t1)); a.mv = ramp(u, t0, t0 + 0.4); return a; }
      const e = this.streamAt(st, 1), r = sramp(u, t1 + 0.1, t2);
      return { q: this.qMix(e.q, qBack, r), p: [lerp(e.p[0], pBack[0], r), lerp(e.p[1], pBack[1], r)], world: e.world && pBack.world ? e.world.clone().lerp(pBack.world, r) : null, mv: 1 - r };
    }
    sampleQ(traj, prog) {
      const n = traj.length - 1, f = clamp(prog, 0, 1) * n, i = Math.min(Math.floor(f), n - 1), fr = f - i;
      return traj[i].map((v, k) => lerp(v, traj[i + 1][k], fr));
    }
    sampleP(traj, prog) {
      const n = traj.length - 1, f = clamp(prog, 0, 1) * n, i = Math.min(Math.floor(f), n - 1), fr = f - i;
      return [lerp(traj[i][0], traj[i + 1][0], fr), lerp(traj[i][1], traj[i + 1][1], fr)];
    }
    setRobot(q, fingers, bananaField, o) {
      o = o || {};
      this.panda.q = q; this.panda.fingers = fingers == null ? 0.018 : fingers; this.panda.apply();
      if (bananaField) {
        // a held banana rides on the gripper's actual pose (forward kinematics), never on the target path,
        // so the two cannot drift apart where IK or a joint-space blend departs from the target
        const Mw = new THREE.Matrix4().multiplyMatrices(this.panda.root.matrixWorld, this.panda.fk(q));
        const rel = new THREE.Quaternion().setFromRotationMatrix(Mw).multiply(this.qRefInv); // hand rotation relative to top-down
        const off = new THREE.Vector3(o.dx || 0, 0, 0.004 + (o.dz || 0)).applyQuaternion(rel);
        this.banana.position.setFromMatrixPosition(Mw).add(off);
        this.banana.quaternion.copy(rel).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, o.pitch || 0, 0))); this.banana.visible = true;
      } else this.banana.visible = false;
    }
    setOpacity(a) { this.panda.setOpacity(a); for (const m of this.banana.userData.mats) { m.opacity = a; m.depthWrite = a > 0.99; } }
    lookFrom(px, py, pz, tx, ty, tz, fov) { this.camera.position.set(px, py, pz); this.camera.lookAt(tx, ty, tz); if (fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); } }
    blendCam(A, B, k) { const e = easeIO(clamp(k, 0, 1)); const v = A.map((a, i) => lerp(a, B[i], e)); this.lookFrom(...v); }
    texKey(mode, cut, opts) {
      const f = core.F[opts.field || 'L0'], c = cut == null ? 'all' : Math.round(clamp(cut / f.tmax, 0, 1.0001) * 200);
      return [mode, opts.field || 'L0', c, Math.round((opts.quiver || 0) * 50), opts.contoursOnly ? 1 : 0].join('|');
    }
    paintPlane(mode, cut, opts) {
      opts = opts || {}; const k = this.texKey(mode, cut, opts);
      if (k === this.planeKey) return; this.planeKey = k;
      core.paintFieldTexture(this.planeTexCanvas, mode, cut, opts); this.planeTex.needsUpdate = true;
    }
    paintTop(fieldKey, cut) {
      const opts = { field: fieldKey, top: true }, k = this.texKey('T', cut, opts);
      if (k === this.topKey) return; this.topKey = k;
      core.paintFieldTexture(this.topTexCanvas, 'T', cut, opts); this.topTex.needsUpdate = true;
    }
    project(v, cam, x0, w) { // world → overlay px (optionally inside a viewport [x0, x0+w])
      cam = cam || this.camera; x0 = x0 || 0; w = w || core.W;
      cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      const p = v.clone().project(cam); if (p.z > 1) return null;
      return [x0 + (p.x + 1) / 2 * w, (1 - p.y) / 2 * core.H];
    }
    frameInfo() { return { labels: this.labelsOut || [], anchors: this.anchorsOut || {} }; }
    hideAll() {
      const A = this.arrows; for (const k of ['attract', 'repel', 'net', 'grad', 'keep']) A[k].visible = false; A.guide.forEach(a => a.visible = false);
      this.probeMarker.visible = false; this.straightTube.visible = false; this.arcTube.visible = false;
      this.chunkDots.forEach(d => d.visible = false); if (this.chunkTube) this.chunkTube.visible = false; if (this.cleanTube) this.cleanTube.visible = false; if (this.propTube) this.propTube.visible = false;
      this.hideCem();
      this.ring.visible = false; this.halo.visible = false; this.plane.material.opacity = 0; this.topPlane.material.opacity = 0;
      this.roof.visible = false; this.ceiling.visible = false; this.bananaB.visible = false; this.bowl2.visible = false; this.cup.visible = false;
      this.bowl.material.opacity = 1; this.bowl.visible = true; this.bowl.scale.setScalar(1);
      this.barrier.visible = true; this.barrier.scale.set(1, 1, 1); this.barrier.position.set((WORLD.barrierX0 + WORLD.barrierX1) / 2 + X_OFF, 0.225, COUNTER_Z + WORLD.barrierH / 2);
      this.setOpacity(1); this.split = false; this.halves = null; this.geo = 0; this.setLook(0);
    }
    label(pos, text, color, o) { this.labels.push(Object.assign({ pos, text, color }, o || {})); }
    flash(p, u0, u) { // collision ring at the barrier, for field position p
      const f = u > u0 ? fade(u, u0, u0 + 0.15, u0 + 1.6, u0 + 3) : 0; if (f <= 0) return 0;
      const c = fieldToWorld(WORLD.barrierX0, p[1] - 0.01); c.y = Y_TASK - 0.09;
      this.ring.visible = true; this.ring.position.copy(c); this.ring.rotation.set(Math.PI / 2, 0, 0); const sc = 1 + (u - u0) * 0.7; this.ring.scale.set(sc, sc, sc); this.ring.material.opacity = f;
      this.ringLabelPos = c.clone().add(new THREE.Vector3(-0.07, 0, 0.09));
      return f;
    }
    // chunk dots + tube through field points
    // action chunk: mix 0 = blue (VLA proposal) … 1 = orange (corrected chunk)
    showChunk(pts, opacity, mix) { return this.showChunkW(pts.map(p => fieldToWorld(p[0], p[1])), opacity, mix); }
    showChunkW(P3, opacity, mix) {
      const col = new THREE.Color(COL.blue).lerp(new THREE.Color(COL.orange), clamp(mix || 0, 0, 1)), lin = col.clone().convertSRGBToLinear();
      const n = this.chunkDots.length;
      for (let k = 0; k < n; k++) { const d = this.chunkDots[k], p = P3[Math.round(k * (P3.length - 1) / (n - 1))]; d.visible = true; d.position.copy(p); d.material.color.copy(lin); d.material.emissive.copy(lin); d.material.opacity = opacity == null ? 1 : opacity; d.material.transparent = true; }
      if (this.chunkTube) { this.ov.remove(this.chunkTube); this.chunkTube.geometry.dispose(); }
      this.chunkTube = tubeFromPoints(P3, 0.005, col.getHex(), 60); this.chunkTube.material.opacity = opacity == null ? 1 : opacity; this.ov.add(this.chunkTube);
      return P3;
    }
    // the VLA's original proposal, as a thin blue line
    showProp(P3, opacity) {
      if (this.propTube) { this.ov.remove(this.propTube); this.propTube.geometry.dispose(); }
      this.propTube = tubeFromPoints(P3, 0.003, COL.blue, 40, { ei: 0.9 }); this.propTube.material.opacity = opacity; this.ov.add(this.propTube);
    }
    orbit(u, dur) {
      const k = u / dur, ang = -1.2 + k * 0.5;
      this.lookFrom(0.3 + 2.4 * Math.cos(ang), 0.2 + 2.4 * Math.sin(ang), 1.9, 0.3, 0.25, 1.0, 36);
      const m = 0.5 + 0.5 * Math.sin(u * 0.25);
      this.setRobot(this.sampleQ(this.qArc, m), 0.018, this.sampleP(this.trajArc, m));
    }
    gradAt(field, p, u, t0, base) {
      const gq = sramp(u, t0, t0 + 0.8); if (gq <= 0) return;
      const g = field.gradAt(p[0], p[1]), L = Math.hypot(g[0], g[1]) || 1, b = base || fieldToWorld(p[0], p[1]);
      if (!base) b.y = Y_FIELD_PLANE - 0.01;
      const dir = new THREE.Vector3(-g[0] / L, 0, -g[1] / L);
      this.probeMarker.visible = true; this.probeMarker.position.copy(b);
      setArrow(this.arrows.grad, b, dir, 0.22 * gq);
      this.label(b.clone().add(dir.clone().multiplyScalar(0.22 * gq)), '−∇T', LC.orangeDeep, { size: 36, weight: 700, dx: 18, dy: -6, alpha: gq });
    }

    // ================= per-scene state =================
    update(t) {
      this.hideAll();
      const i = core.sceneIndexAt(t), s = core.SCENES[i], u = t - s.start, TL = core.util.TL;
      this.labels = []; this.anchors = {};
      const CAM_MAIN = [0.95, -1.75, 1.95, 0.25, 0.22, 1.08, 34];
      const CAM_SIDE = [0.66, -1.80, 1.42, 0.66, 0.33, 1.20, 32];
      const CAM_GUIDE = [0.95, -1.62, 1.72, 0.58, 0.22, 1.16, 34];
      const CAM_TOP = [0.62, -1.05, 2.35, 0.62, 0.22, 1.02, 36];
      const CAM_TITLE = [0.35, -2.75, 1.95, -0.72, 0.20, 1.12, 40], CAM_TITLE_END = [0.20, -2.55, 1.95, -0.72, 0.20, 1.12, 40];
      const CAM_SPLIT = [0.42, -1.95, 1.62, 0.36, 0.22, 1.13, 34];
      const W2 = core.W / 2, start = [WORLD.start.x, WORLD.start.z], pr = core.F.pStar, probe = [pr.x, pr.z];
      const splitCam = () => { this.lookFrom(...CAM_SPLIT); this.camera2.position.copy(this.camera.position); this.camera2.lookAt(CAM_SPLIT[3], CAM_SPLIT[4], CAM_SPLIT[5]); this.camera2.fov = CAM_SPLIT[6]; this.camera2.updateProjectionMatrix(); };
      const proj2 = (v, half) => this.project(v, this.camera2, half * W2, W2);
      switch (s.id) {
        case 'title': {
          const k = u / s.dur; this.lookFrom(lerp(CAM_TITLE[0], CAM_TITLE_END[0], k), lerp(CAM_TITLE[1], CAM_TITLE_END[1], k), CAM_TITLE[2], CAM_TITLE[3], CAM_TITLE[4], CAM_TITLE[5], CAM_TITLE[6]);
          this.setRobot(this.qHome.map((v, j) => v + (j === 0 ? 0.22 * Math.sin(u * 0.45) : j === 1 ? 0.10 * Math.sin(u * 0.6 + 1) : j === 3 ? 0.14 * Math.sin(u * 0.5 + 2) : j === 5 ? 0.10 * Math.sin(u * 0.55) : 0)), 0.04, null);
          this.paintPlane('T', core.F.L0.tmax * sramp(u, 0.2, 5.5), { contoursOnly: true });
          this.plane.material.opacity = 0.9 * ramp(u, 0.2, 1.5);
          break;
        }
        case 'gap': {
          const G = TL.gap;
          this.blendCam(CAM_TITLE_END, CAM_GUIDE, u / 2.5);
          if (u < G.combo) {
            // open layout: the skills the VLA already has
            this.barrier.visible = false;
            const keys = [[1.5, 0], [3, 11], [3.4, 11], [4.8, 21], [10, 50], [12, 60], [G.combo, 60]];
            let idx = 0; for (let k = 0; k < keys.length - 1; k++) { const [a, ia] = keys[k], [b, ib] = keys[k + 1]; if (u >= a && u <= b) idx = lerp(ia, ib, easeIO((u - a) / (b - a || 1))); else if (u > b) idx = ib; }
            const n = this.trajOpen.length - 1, prog = idx / n;
            const q = this.sampleQ(this.qOpen, prog), p = this.sampleP(this.trajOpen, prog);
            const fingers = u < 3 ? 0.04 : u < 3.4 ? lerp(0.04, 0.018, (u - 3) / 0.4) : u < 12 ? 0.018 : u < 12.5 ? lerp(0.018, 0.04, (u - 12) / 0.5) : 0.04;
            const held = u >= 3.2 && u < 12.2;
            this.setRobot(q, fingers, held ? p : null);
            if (!held) { this.banana.visible = u < G.combo - 0.6; this.banana.position.copy(fieldToWorld(u < 3.2 ? WORLD.start.x : WORLD.bowlX, u < 3.2 ? BANANA_HALF_H + 0.002 : 0.066)); this.banana.rotation.set(0, 0, 0); }
          } else {
            // the new combination: barrier rises, a low ceiling, grip near one end; then the familiar straight move fails
            const contact = core.util.contactPoint(), off = 0.055, pEnd = (contact.x - off - WORLD.start.x) / (contact.x - WORLD.start.x);
            const m = sramp(u, G.fail[0], G.fail[1]) * pEnd;
            const q = this.sampleQ(this.qStraight, m), p = this.sampleP(this.trajStraight, m);
            this.setRobot(q, 0.018, p, { dx: off });
            for (const mm of this.banana.userData.mats) mm.opacity = ramp(u, G.combo, G.combo + 0.6);
            const rise = sramp(u, G.combo + 0.3, G.combo + 1.8); this.barrier.scale.set(1, 1, Math.max(rise, 0.01)); this.barrier.position.z = COUNTER_Z + WORLD.barrierH * rise / 2;
            const lift = sramp(u, G.lift, G.lift + 2.5);
            this.ceiling.visible = u > G.comboChips[1] && lift < 0.999; this.ceiling.material.opacity = 0.32 * ramp(u, G.comboChips[1], G.comboChips[1] + 0.8) * (1 - lift);
            this.ceiling.position.z = COUNTER_Z + 0.47 + 0.35 * lift;
            if (u > G.lift) this.label(fieldToWorld(0.62, 0.40 + 0.06 * lift), 'ceiling removed from here on', LC.mute, { size: 22, align: 'center', alpha: fade(u, G.lift, G.lift + 0.6, G.lift + 4.5, G.lift + 5.5) });
            const f = this.flash([p[0] + off, p[1]], G.fail[1], u);
            if (f > 0) this.label(this.ringLabelPos, 'collision', LC.red, { size: 28, weight: 700, align: 'right', alpha: f });
          }
          break;
        }
        case 'tools': {
          const T = TL.tools;
          if (u < T.table) {
            splitCam(); this.split = true;
            // left: single VLA — acts at once, straight into the barrier
            const m = sramp(u, T.vla[0], T.vla[1]), qL = this.sampleQ(this.qStraight, m), pL = this.sampleP(this.trajStraight, m);
            const fL = u > T.vla[1] ? fade(u, T.vla[1], T.vla[1] + 0.15, T.vla[1] + 1.6, T.vla[1] + 3) : 0;
            const ringPos = fieldToWorld(WORLD.barrierX0, pL[1] - 0.01); ringPos.y = Y_TASK - 0.09;
            if (fL > 0) { const px = proj2(ringPos.clone().add(new THREE.Vector3(-0.07, 0, 0.09)), 0); if (px) this.label(null, 'collision', LC.red, { px, size: 28, weight: 700, align: 'right', alpha: fL }); }
            // right: world model — imagine, score, take one step; repeat
            const C = this.cem, iterWin = [[0, 0, T.cem[0]], [0, 1, T.cem[1]], [0, 2, T.cem[2]], [1, 0, T.cem2[0]], [1, 1, T.cem2[1]]];
            let show = null; for (const [c, k, w] of iterWin) if (u >= w[0] && u < w[1]) show = { c, k, w };
            const prog = u < T.step1[0] ? 0 : u < T.step1[1] ? 0.5 * sramp(u, T.step1[0], T.step1[1]) : u < T.step2[0] ? 0.5 : 0.5 + 0.5 * sramp(u, T.step2[0], T.step2[1]);
            const qR = this.sampleQ(this.qCem, prog), pR = this.sampleP(this.trajCem, prog);
            if (show) {
              const it = C.cycles[show.c].its[show.k], last = show.k === C.cycles[show.c].its.length - 1;
              const lab = fieldToWorld(C.cycles[show.c].p[0] + 0.05, C.cycles[show.c].p[1] + 0.13);
              const dots = '.'.repeat(1 + Math.floor((u * 3) % 3));
              const px = proj2(lab, 1); if (px) this.label(null, 'imagining' + dots, LC.violet, { px, size: 26, weight: 700, alpha: ramp(u, show.w[0], show.w[0] + 0.3) });
              if (last && u > show.w[1] - 1.2) { const b = it.cand[it.best].end, pxb = proj2(fieldToWorld(b[0] + WORLD.bananaHalf + 0.06, b[1] + 0.02), 1); if (pxb) this.label(null, 'best score', LC.orangeDeep, { px: pxb, size: 24, weight: 700, alpha: ramp(u, show.w[1] - 1.2, show.w[1] - 0.9) }); }
            }
            if (u > T.step2[1] + 0.5) { const px = proj2(fieldToWorld(WORLD.barrierX1 + 0.06, WORLD.barrierH + 0.10), 1); if (px) this.label(null, 'stalls at the barrier', LC.violet, { px, size: 26, weight: 700, align: 'center', alpha: ramp(u, T.step2[1] + 0.5, T.step2[1] + 1.2) }); }
            this.halves = [
              { apply: () => { this.setRobot(qL, 0.018, pL); this.hideCem(); this.ring.visible = fL > 0; if (fL > 0) { this.ring.position.copy(ringPos); this.ring.rotation.set(Math.PI / 2, 0, 0); const sc = 1 + (u - T.vla[1]) * 0.7; this.ring.scale.set(sc, sc, sc); this.ring.material.opacity = fL; } } },
              { apply: () => { this.setRobot(qR, 0.018, pR); this.ring.visible = false; this.hideCem(); if (show) { const it = C.cycles[show.c].its[show.k], last = show.k === C.cycles[show.c].its.length - 1; C.cycles[show.c].tubes[show.k].forEach((tb, k) => { const best = last && k === it.best && u > show.w[1] - 1.2; setTubeProgress(tb, ramp(u, show.w[0] + k * 0.06, show.w[0] + 0.9 + k * 0.06)); tb.material.opacity = best ? 1 : (last && u > show.w[1] - 1.2 ? 0.25 : 0.75); tb.material.emissive.setHex(best ? COL.orange : COL.violet).convertSRGBToLinear(); tb.material.color.copy(tb.material.emissive);
                const gh = this.ghosts[k], e = it.cand[k].end, ga = ramp(u, show.w[0] + 0.5 + k * 0.06, show.w[0] + 1.1 + k * 0.06);
                gh.visible = ga > 0; gh.position.copy(fieldToWorld(e[0], e[1])); gh.position.y += -0.04 + (k - 4.5) * 0.006; gh.rotation.set(0, 0, 0);
                gh.children.forEach(c => { c.material.opacity = ga * (best ? 0.85 : (last && u > show.w[1] - 1.2 ? 0.12 : 0.38)); c.material.emissive.setHex(best ? COL.orange : COL.violet).convertSRGBToLinear(); c.material.color.copy(c.material.emissive); });
              }); } } }
            ];
          } else this.orbit(u, s.dur);
          break;
        }
        case 'guide': {
          this.blendCam(CAM_MAIN, CAM_GUIDE, u / 2.0);
          const tau = core.util.guideTau(u), inWin = tau >= 0.3 && tau <= 0.8, g = sramp(tau, 0.3, 0.8);
          const Hn = 10, rnd = core.util.rng(3), noise = []; for (let k = 0; k < Hn; k++) noise.push([(rnd() - 0.5) * 0.22, (rnd() - 0.5) * 0.22]);
          const arc = core.util.arcPath(WORLD.start.x + 0.03, WORLD.start.z, WORLD.bowlX, 0.13, 0.40, Hn - 1);
          const pts = [], clean = [];
          for (let k = 0; k < Hn; k++) {
            const sx = lerp(WORLD.start.x + 0.03, WORLD.bowlX, k / (Hn - 1)), sz = lerp(WORLD.start.z, 0.13, k / (Hn - 1));
            const cx = lerp(sx, arc[k][0], g), cz = lerp(sz, arc[k][1], g); clean.push([cx, cz]);
            pts.push([lerp(noise[k][0] + 0.6, cx, tau), lerp(noise[k][1] + 0.28, cz, tau)]);
          }
          const P3 = this.showChunk(pts, 0.35 + 0.65 * tau, g);
          // the VLA's own (unguided) proposal stays visible as a thin blue line
          const prop = []; for (let k = 0; k < Hn; k++) prop.push(fieldToWorld(lerp(WORLD.start.x + 0.03, WORLD.bowlX, k / (Hn - 1)), lerp(WORLD.start.z, 0.13, k / (Hn - 1))));
          this.showProp(prop, 0.7 * ramp(u, 1, 2));
          this.label(prop[7].clone().add(new THREE.Vector3(0, 0, -0.05)), 'VLA proposal', LC.blueDeep, { size: 22, align: 'center', alpha: ramp(u, 1, 2) });
          if (tau > 0.8) this.label(P3[5].clone().add(new THREE.Vector3(0, 0, 0.07)), 'corrected chunk', LC.orangeDeep, { size: 24, align: 'center', alpha: ramp(tau, 0.8, 0.9) });
          if (inWin) {
            const strength = Math.sin((tau - 0.3) / 0.5 * Math.PI);
            for (let k = 2; k <= 7; k++) setArrow(this.arrows.guide[k], P3[k], new THREE.Vector3(0.25, 0, 1), 0.14 * strength * (1 - Math.abs(k - 4.5) / 4));
            this.label(P3[4].clone().add(new THREE.Vector3(0, 0, 0.2)), 'guidance update', LC.orangeDeep, { size: 24, weight: 700, align: 'center' });
          }
          // after each denoising pass the arm executes the finished chunk, then resets for the next pass
          const uu = u % 12; let ex = { q: this.qStraight[0], p: start };
          if (uu >= 8.6 && uu < 11.3) ex = this.arcAt(sramp(uu, 8.6, 11.0));
          else if (uu >= 11.3) { const e = this.arcAt(1), r = sramp(uu, 11.3, 12); ex = { q: this.qMix(e.q, this.qStraight[0], r), p: [lerp(e.p[0], start[0], r), lerp(e.p[1], start[1], r)] }; }
          this.setRobot(ex.q, 0.018, ex.p);
          break;
        }
        case 'geom': {
          const G = TL.geom;
          this.blendCam(CAM_MAIN, CAM_SIDE, u / 2.5);
          if (u < G.exec[0]) {
            // creep along the straight approach to the stall point, then stay pinned there (small jitter, no escape)
            const k = sramp(u, 0.3, 3.0) * this.probeProg + (u > 3 && u < G.T ? 0.06 * Math.sin((u - 3) * 4.2) * (1 - ramp(u, G.T - 1.5, G.T - 0.5)) : 0);
            this.setRobot(this.sampleQ(this.qStraight, k), 0.018, this.sampleP(this.trajStraight, k));
            this.setOpacity(lerp(1, GHOST, sramp(u, G.ghost[0], G.ghost[1])));
          } else {
            // the arm executes the corrected chunk (its shape comes from −∇T): up and over into the bowl
            const a = this.streamAt(this.streams.L0, sramp(u, G.exec[0], G.exec[1]));
            this.setRobot(a.q, 0.018, a.p); this.setOpacity(lerp(GHOST, 0.9, sramp(u, G.exec[0], G.exec[0] + 1)));
          }
          const base = fieldToWorld(pr.x, pr.z); base.y = Y_FIELD_PLANE - 0.01;
          if (u < G.T) {
            this.paintPlane('E', null, {}); this.plane.material.opacity = 0.9 * ramp(u, 0, 2) * (1 - ramp(u, G.T - 0.6, G.T));
            const parts = core.F.Eloc_parts(pr.x, pr.z), sc = 0.03, fo = 1 - ramp(u, G.T - 0.6, G.T);
            const a1 = sramp(u, G.a1[0], G.a1[1]), a2 = sramp(u, G.a2[0], G.a2[1]), a3 = sramp(u, G.a3[0], G.a3[1]);
            if (u > G.ghost[1]) {
              this.probeMarker.visible = true; this.probeMarker.position.copy(base);
              const att = new THREE.Vector3(-parts.attract[0], 0, -parts.attract[1]), rep = new THREE.Vector3(-parts.repel[0], 0, -parts.repel[1]);
              if (a1 > 0) { setArrow(this.arrows.attract, base, att, att.length() * sc * a1, fo); this.label(base.clone().add(att.clone().normalize().multiplyScalar(att.length() * sc * a1 + 0.04)), 'attract', LC.blue, { size: 28, alpha: a1 * fo }); }
              if (a2 > 0) { setArrow(this.arrows.repel, base, rep, rep.length() * sc * a2, fo); this.label(base.clone().add(rep.clone().normalize().multiplyScalar(rep.length() * sc * a2 + 0.05)), 'repel', LC.red, { size: 28, alpha: a2 * fo, align: 'right' }); }
              if (a3 > 0) { const net = att.clone().add(rep), nl = net.length() * sc * 3 * a3; setArrow(this.arrows.net, base, net, nl, fo); this.label(base.clone().add(net.clone().normalize().multiplyScalar(nl)), 'net', LC.ink, { size: 28, weight: 700, dx: 16, dy: 26, alpha: a3 * fo }); }
            }
          } else {
            this.paintPlane('T', core.F.L0.tmax * sramp(u, G.cut[0], G.cut[1]), { quiver: ramp(u, G.quiver[0], G.quiver[1]) }); this.plane.material.opacity = 0.92;
            this.gradAt(core.F.L0, probe, u, G.grad[0]);
            this.proposalAndCorrection(probe, [WORLD.bowlX - 0.04, 0.13], this.streams.L0, u, G.prop, G.corr);
          }
          if (u > G.check + 0.6) this.labels = []; // the numerical-check panel covers the scene
          break;
        }
        case 'direct': {
          const D = TL.direct;
          this.lookFrom(...CAM_GUIDE);
          { const ex = this.arcAt(sramp(u, D.bend[1] + 1, D.bend[1] + 6.5)); this.setRobot(ex.q, 0.018, ex.p); } // the corrected chunk is executed
          const Hn = 10, arc = core.util.arcPath(WORLD.start.x + 0.03, WORLD.start.z, WORLD.bowlX, 0.13, 0.40, Hn - 1), bend = sramp(u, D.bend[0], D.bend[1]);
          const pts = []; for (let k = 0; k < Hn; k++) { const sx = lerp(WORLD.start.x + 0.03, WORLD.bowlX, k / (Hn - 1)), sz = lerp(WORLD.start.z, 0.13, k / (Hn - 1)); pts.push([lerp(sx, arc[k][0], bend), lerp(sz, arc[k][1], bend)]); }
          const P3 = this.showChunk(pts, ramp(u, 0.5, 1.2), bend);
          if (bend > 0) { const prop = []; for (let k = 0; k < Hn; k++) prop.push(fieldToWorld(lerp(WORLD.start.x + 0.03, WORLD.bowlX, k / (Hn - 1)), lerp(WORLD.start.z, 0.13, k / (Hn - 1)))); this.showProp(prop, 0.7 * bend); }
          const fo = 1 - ramp(u, D.bend[0], D.bend[0] + 1);
          const kA = sramp(u, D.keep, D.keep + 0.8), lA = sramp(u, D.lift, D.lift + 0.8), eA = sramp(u, D.ease, D.ease + 0.8);
          if (kA > 0 && fo > 0) { setArrow(this.arrows.keep, P3[1].clone().add(new THREE.Vector3(0, 0, 0.05)), new THREE.Vector3(1, 0, 0), 0.12 * kA, fo); this.label(P3[1].clone().add(new THREE.Vector3(0.02, 0, -0.07)), 'keep progress', LC.blueDeep, { size: 24, alpha: kA * fo }); }
          if (lA > 0 && fo > 0) { for (let k = 3; k <= 6; k++) setArrow(this.arrows.guide[k], P3[k], new THREE.Vector3(0, 0, 1), 0.15 * lA * (1 - Math.abs(k - 4.5) / 4), fo); this.label(P3[4].clone().add(new THREE.Vector3(0, 0, 0.19)), 'more clearance', LC.orangeDeep, { size: 24, align: 'center', alpha: lA * fo }); }
          if (eA > 0 && fo > 0) { for (let k = 7; k <= 9; k++) setArrow(this.arrows.guide[k], P3[k], new THREE.Vector3(-1, 0, 0.15), 0.06 * eA, fo); this.label(P3[8].clone().add(new THREE.Vector3(0, 0, -0.07)), 'ease the acceleration', LC.orangeDeep, { size: 24, align: 'center', alpha: eA * fo }); }
          if (u > D.bend[1]) this.label(P3[5].clone().add(new THREE.Vector3(0, 0, 0.07)), 'corrected chunk', LC.orangeDeep, { size: 24, align: 'center', alpha: ramp(u, D.bend[1], D.bend[1] + 0.8) });
          break;
        }
        case 'slip': {
          const S = core.util.SLIP;
          splitCam(); this.split = true; this.arcTube.visible = true; this.arcTube.material.opacity = 0.55 * ramp(u, 0.3, 1.2);
          this.halves = S.dur.map((d, pi) => {
            let sIn = ((u - S.t0) % S.period + S.period) % S.period; if (u < S.t0) sIn = 0;
            const prog = clamp(sIn / d, 0, 1), slipped = pi === 1 && sIn > d * 0.5 && sIn < S.period - 0.1;
            const st = { q: this.sampleQ(this.qArc, prog), p: this.sampleP(this.trajArc, prog), dx: 0, pitch: 0, drop: null };
            if (pi === 1 && !slipped) { const lag = clamp((1 / d) * 0.4 * Math.sin(Math.PI * prog), 0, 0.08); st.dx = -lag; st.pitch = lag * 4; }
            if (slipped) {
              const tf = sIn - d * 0.5, apex = this.sampleP(this.trajArc, 0.5), g = 3.0, rest = BANANA_HALF_H + 0.002;
              const z0 = apex[1] - 0.01, tLand = Math.sqrt(2 * (z0 - rest) / g), te = Math.min(tf, tLand);
              const vx = (WORLD.bowlX - WORLD.start.x) / d * 0.9, fx = apex[0] - 0.05 + vx * te + 0.03 * Math.max(0, Math.min(tf - tLand, 0.3));
              st.drop = { pos: fieldToWorld(fx, z0 - 0.5 * g * te * te), rot: -Math.PI * te / tLand };
              const px = proj2(st.drop.pos.clone().add(new THREE.Vector3(0.05, 0, 0.06)), 1);
              if (px) this.label(null, 'slip', LC.red, { px, size: 30, weight: 700, alpha: fade(sIn, d * 0.5, d * 0.5 + 0.3, S.period - 1, S.period - 0.2) });
            }
            return { apply: () => { this.setRobot(st.q, st.drop ? 0.04 : 0.018, st.drop ? null : st.p, { dx: st.dx, pitch: st.pitch }); this.bananaB.visible = !!st.drop; if (st.drop) { this.bananaB.position.copy(st.drop.pos); this.bananaB.rotation.set(0, st.drop.rot, 0); } } };
          });
          break;
        }
        case 'intervene': {
          const I = TL.intervene, PH = I.phase;
          this.setOpacity(GHOST);
          if (u < PH[0]) {
            this.blendCam(CAM_MAIN, CAM_SIDE, u / 2.5); this.setRobot(this.qProbe, 0.018, probe); this.setOpacity(GHOST);
            this.paintPlane('T', null, { quiver: 1 }); this.plane.material.opacity = 0.92 * ramp(u, 0.5, 2);
            this.gradAt(core.F.L0, probe, u, 2.5);
          } else if (u < I.goal) {
            const phase = u < PH[1] ? 0 : u < PH[2] ? 1 : 2, u0 = PH[phase], k = sramp(u, u0, u0 + 1.2);
            const fb = (st, qB, pB) => this.followAndBack(st, u, u0 + 4.9, u0 + 7.1, u0 + 7.9, qB, pB);
            const pc = (st, goal, from, top) => this.proposalAndCorrection(from || probe, goal, st, u, u0 + 3.9, u0 + 4.4, top);
            let mvI = 0;
            if (phase === 0) {
              this.lookFrom(...CAM_SIDE); { const a = fb(this.streams.L1, this.qProbe, probe); this.setRobot(a.q, 0.018, a.p); mvI = a.mv; }
              pc(this.streams.L1, [WORLD.bowlX - 0.04, 0.10]);
              this.barrier.scale.set(1, 1, Math.max(1 - k, 0.01)); this.barrier.position.z = COUNTER_Z + WORLD.barrierH * (1 - k) / 2; this.barrier.visible = k < 0.99;
              this.paintPlane('T', core.F.L1.tmax * sramp(u, u0 + 0.8, u0 + 3.5), { field: 'L1', quiver: ramp(u, u0 + 3.2, u0 + 4) }); this.plane.material.opacity = 0.92;
              this.gradAt(core.F.L1, probe, u, u0 + 3.6);
            } else if (phase === 1) {
              this.blendCam(CAM_SIDE, CAM_TOP, k);
              if (this.streams.L2.ok) { const pB = start.slice(); pB.world = fieldToWorld(start[0], start[1]); const a = fb(this.streams.L2, this.qStraight[0], pB); this.setRobot(a.q, 0.018, start, { world: a.world || pB.world }); mvI = a.mv; }
              else this.setRobot(this.qStraight[0], 0.018, start);
              pc(this.streams.L2, [0.80, 0.32], [0.30, 0.32], true);
              this.label(topFieldToWorld(0.40, 0.60), 'side opening', LC.tealDeep, { size: 24, weight: 700, align: 'right', alpha: ramp(u, u0 + 1.2, u0 + 2) });
              const wy1 = WORLD.top.wallY1 - 0.10; this.barrier.scale.set(1, wy1 / 0.45, 1); this.barrier.position.y = wy1 / 2;
              this.roof.visible = true; this.roof.scale.set(1, wy1 / 0.50, 1); this.roof.position.y = wy1 / 2;
              this.paintTop('L2', core.F.L2.tmax * sramp(u, u0 + 0.8, u0 + 3.5)); this.topPlane.material.opacity = 0.9 * ramp(u, u0 + 0.5, u0 + 1.2);
              const fp = [0.30, 0.32], base = topFieldToWorld(fp[0], fp[1]); base.z += 0.005;
              const g = core.F.L2.gradAt(fp[0], fp[1]), L = Math.hypot(g[0], g[1]) || 1, gq = sramp(u, u0 + 3.6, u0 + 4.4);
              if (gq > 0) { const dir = new THREE.Vector3(-g[0] / L, -g[1] / L, 0); this.probeMarker.visible = true; this.probeMarker.position.copy(base); setArrow(this.arrows.grad, base, dir, 0.22 * gq); this.label(base.clone().add(dir.multiplyScalar(0.22 * gq)), '−∇T', LC.orangeDeep, { size: 36, weight: 700, dx: 18, dy: -6, alpha: gq }); }
            } else {
              this.lookFrom(...CAM_SIDE); { const a = fb(this.streams.L3, this.qProbe, probe); this.setRobot(a.q, 0.018, a.p); mvI = a.mv; }
              pc(this.streams.L3, [WORLD.bowlX - 0.04, 0.13]);
              const hs = lerp(1, WORLD.tallH / WORLD.barrierH, k); this.barrier.scale.set(1, 1, hs); this.barrier.position.z = COUNTER_Z + WORLD.barrierH * hs / 2;
              this.paintPlane('T', core.F.L3.tmax * sramp(u, u0 + 0.8, u0 + 3.5), { field: 'L3', quiver: ramp(u, u0 + 3.2, u0 + 4) }); this.plane.material.opacity = 0.92;
              this.gradAt(core.F.L3, probe, u, u0 + 3.6);
            }
            this.setOpacity(lerp(GHOST, 0.75, mvI));
          } else {
            // new instruction: the blue bowl is the goal; the cup must not be touched
            this.lookFrom(...CAM_SIDE);
            { const a = this.streamAt(this.streams.L4, sramp(u, I.goalCut[1] + 1.6, I.goalCut[1] + 5.6)); this.setRobot(a.q, 0.018, a.p); this.setOpacity(lerp(GHOST, 0.75, ramp(u, I.goalCut[1] + 1.6, I.goalCut[1] + 2.2))); }
            const back = sramp(u, I.goal, I.goal + 1); const hs = lerp(WORLD.tallH / WORLD.barrierH, 1, back); this.barrier.scale.set(1, 1, hs); this.barrier.position.z = COUNTER_Z + WORLD.barrierH * hs / 2;
            const pop = sramp(u, I.goal, I.goal + 1);
            // the goal changes: the old bowl is cleared away, the blue bowl and the cup appear
            const out = sramp(u, I.goal, I.goal + 0.6), inn = sramp(u, I.goal + 0.4, I.goal + 1.2);
            this.bowl.scale.setScalar(Math.max(1 - out, 0.01)); this.bowl.visible = out < 0.99;
            this.bowl2.visible = true; this.bowl2.scale.setScalar(Math.max(inn, 0.01)); this.cup.visible = true; this.cup.scale.setScalar(Math.max(inn, 0.01));
            this.paintPlane('T', core.F.L4.tmax * sramp(u, I.goalCut[0], I.goalCut[1]), { field: 'L4', quiver: ramp(u, I.goalCut[1], I.goalCut[1] + 1) }); this.plane.material.opacity = 0.92;
            this.gradAt(core.F.L4, probe, u, I.goalCut[1] + 0.5);
            this.proposalAndCorrection(probe, [WORLD.bowl2X - 0.04, 0.12], this.streams.L4, u, I.goalCut[1] + 0.7, I.goalCut[1] + 1.2);
            this.label(fieldToWorld(WORLD.bowl2X + WORLD.bowlR + 0.01, 0.05), 'new goal', LC.blueDeep, { size: 24, dx: 8, alpha: ramp(u, I.goal + 0.5, I.goal + 1.2) });
            this.label(fieldToWorld((WORLD.cup.x0 + WORLD.cup.x1) / 2, WORLD.cup.h + 0.06), 'do not touch', LC.red, { size: 24, align: 'center', alpha: ramp(u, I.goal + 1, I.goal + 1.7) });
          }
          break;
        }
        case 'invest': {
          const V = TL.invest;
          this.lookFrom(...CAM_SIDE);
          const solo = sramp(u, V.C, V.C + 2);
          const ex = this.arcLoop(u, 6.5, 1.0); this.setRobot(ex.q, 0.018, ex.p); this.setOpacity(lerp(0.35, 1, solo));
          this.paintPlane('T', null, { quiver: 1 }); this.plane.material.opacity = 0.92 * ramp(u, 0, 1.5) * (1 - solo);
          if (solo < 1) { const base = fieldToWorld(start[0], start[1]); base.y = Y_FIELD_PLANE - 0.01; const g = core.F.L0.gradAt(start[0], start[1]), L = Math.hypot(g[0], g[1]) || 1; setArrow(this.arrows.grad, base, new THREE.Vector3(-g[0] / L, 0, -g[1] / L), 0.2, 1 - solo); }
          // consequence-teacher halo: large in A (full JEPA), small in B (light module), gone in C
          const hA = u < V.B ? ramp(u, V.A - 1, V.A) : u < V.C ? 1 : 1 - ramp(u, V.C, V.C + 1);
          if (hA > 0) {
            const r = u < V.B ? 1 : lerp(1, 0.55, sramp(u, V.B, V.B + 1));
            this.halo.visible = true; this.halo.position.copy(fieldToWorld(ex.p[0], ex.p[1])); this.halo.position.y = Y_TASK; this.halo.rotation.set(Math.PI / 2, 0, 0); this.halo.scale.setScalar(r * (1 + 0.04 * Math.sin(u * 3)));
            this.halo.material.opacity = 0.9 * hA;
            this.label(fieldToWorld(ex.p[0], ex.p[1] + 0.14 * r), u < V.B ? 'JEPA predictor' : 'light module', LC.orangeDeep, { size: 24, align: 'center', alpha: hA });
          }
          break;
        }
        case 'policy': {
          const P = TL.policy;
          if (u >= P.split - 0.5 && u < P.line + 0.5) {
            splitCam(); this.split = true;
            const c2 = u >= P.c2, t0 = c2 ? P.c2m : P.c1, hb = c2 ? WORLD.barrierH : 0.30, off = c2 ? 0.05 : 0;
            const hs = hb / WORLD.barrierH; this.barrier.scale.set(1, 1, hs); this.barrier.position.z = COUNTER_Z + hb / 2;
            // left: before adaptation, teacher off — the familiar straight move (illustrative failure)
            const contact = core.util.contactPoint(), pEnd = (contact.x - off - WORLD.start.x) / (contact.x - WORLD.start.x);
            const mL = sramp(u, t0[0], t0[1]) * pEnd, qL = this.sampleQ(this.qStraight, mL), pL = this.sampleP(this.trajStraight, mL);
            const fL = u > t0[1] ? fade(u, t0[1], t0[1] + 0.15, t0[1] + 1.6, t0[1] + 3) : 0;
            const ringPos = fieldToWorld(WORLD.barrierX0, pL[1] - 0.01); ringPos.y = Y_TASK - 0.09;
            if (fL > 0) { const px = proj2(ringPos.clone().add(new THREE.Vector3(-0.07, 0, 0.09)), 0); if (px) this.label(null, 'collision', LC.red, { px, size: 28, weight: 700, align: 'right', alpha: fL }); }
            // right: after adaptation, teacher off — the target behaviour
            const ex = c2 ? this.arcAt(sramp(u, t0[0], t0[2])) : this.arcAt(sramp(u, t0[0], t0[2]), this.qArcHi, this.trajArcHi);
            this.halves = [
              { apply: () => { this.setRobot(qL, 0.018, pL, { dx: off }); this.ring.visible = fL > 0; if (fL > 0) { this.ring.position.copy(ringPos); this.ring.rotation.set(Math.PI / 2, 0, 0); const sc = 1 + (u - t0[1]) * 0.7; this.ring.scale.set(sc, sc, sc); this.ring.material.opacity = fL; } } },
              { apply: () => { this.setRobot(ex.q, 0.018, ex.p, { dx: off }); this.ring.visible = false; } }
            ];
          } else this.orbit(u, s.dur);
          break;
        }
        case 'sim2real': {
          const S = TL.sim2real;
          this.barrier.visible = false;
          const restP = fieldToWorld(WORLD.start.x, BANANA_HALF_H + 0.002), bowlP = fieldToWorld(WORLD.bowlX, 0.066);
          const rest = (pt) => { this.banana.visible = true; this.banana.position.copy(pt); this.banana.rotation.set(0, 0, 0); };
          // key-framed playback of a precomputed joint path: keys = [[time, sample index], …]
          const play = (qs, traj, keys, t) => {
            let idx = 0; for (let k = 0; k < keys.length - 1; k++) { const [a, ia] = keys[k], [b, ib] = keys[k + 1]; if (t >= a && t <= b) idx = lerp(ia, ib, easeIO((t - a) / (b - a || 1))); else if (t > b) idx = ib; }
            const pr = idx / (traj.length - 1); return { q: this.sampleQ(qs, pr), p: this.sampleP(traj, pr) };
          };
          if (u < S.fix) {
            splitCam(); this.split = true;
            const CR = [0.62, -1.80, 1.48, 0.40, 0.22, 1.10, 36]; // the new kitchen's camera sits elsewhere
            this.camera3.position.set(CR[0], CR[1], CR[2]); this.camera3.lookAt(CR[3], CR[4], CR[5]); this.camera3.fov = CR[6]; this.camera3.updateProjectionMatrix();
            const t = u - S.miss;
            // left, simulation: the familiar skill — grasp, lift, carry, place
            const L = play(this.qOpen, this.trajOpen, [[1.5, 0], [3, 11], [3.4, 11], [4.8, 21], [10, 50], [12, 60]], t);
            const fL = t < 3 ? 0.04 : t < 3.4 ? lerp(0.04, 0.018, (t - 3) / 0.4) : t < 12 ? 0.018 : t < 12.5 ? lerp(0.018, 0.04, (t - 12) / 0.5) : 0.04, heldL = t >= 3.2 && t < 12.2;
            // right, new kitchen: the same VLA closes 6 cm beside the banana and lifts nothing
            const R = play(this.qMiss, this.trajMiss, [[1.5, 0], [3, 10], [3.6, 10], [5, 20]], t);
            const fR = t < 3 ? 0.04 : t < 3.6 ? lerp(0.04, 0.001, (t - 3) / 0.6) : 0.001;
            this.geo = 0.85 * sramp(u, S.geo, S.geo + 2);
            const proj3 = v => this.project(v, this.camera3, W2, W2);
            if (t > 3.8 && u < S.geo) { const px = proj3(fieldToWorld(WORLD.start.x - 0.06, 0.22)); if (px) this.label(null, 'misses the grasp', LC.red, { px, size: 26, weight: 700, align: 'center', alpha: ramp(t, 3.8, 4.4) * (1 - ramp(u, S.geo - 0.6, S.geo)) }); }
            this.halves = [
              { cam: this.camera2, apply: () => { this.setLook(0); this.setRobot(L.q, fL, heldL ? L.p : null); if (!heldL) rest(t < 3.2 ? restP : bowlP); } },
              { cam: this.camera3, apply: () => { this.setLook(1); this.setRobot(R.q, fR, null); rest(restP); } }
            ];
          } else {
            // full frame, the new kitchen with the geometry layer: the VLA's proposal (blue) → correction (orange) → execution
            this.lookFrom(0.78, -1.62, 1.55, 0.42, 0.22, 1.08, 32);
            this.setLook(1); this.geo = lerp(0.85, 0.42, sramp(u, S.fix, S.fix + 1.5));
            const t = u - S.exec;
            const F = play(this.qFix, this.trajFix, [[0, 0], [1.2, 6], [2.4, 16], [2.8, 16], [4.0, 26], [8.5, 56], [10, 66]], t);
            const ff = t < 2.4 ? 0.04 : t < 2.8 ? lerp(0.04, 0.018, (t - 2.4) / 0.4) : t < 10 ? 0.018 : t < 10.5 ? lerp(0.018, 0.04, (t - 10) / 0.5) : 0.04, held = t >= 2.6 && t < 10.2;
            this.setRobot(F.q, ff, held ? F.p : null); if (!held) rest(t < 2.6 ? restP : bowlP);
            const MISS = WORLD.start.x - 0.06, gone = 1 - ramp(t, 9, 10);
            const pa = ramp(u, S.fix + 1, S.fix + 1.8) * gone;
            if (pa > 0) { this.showProp([fieldToWorld(MISS, 0.13), fieldToWorld(MISS, 0.07), fieldToWorld(MISS, BANANA_HALF_H + 0.01)], pa); this.label(fieldToWorld(MISS - 0.02, 0.05), 'VLA proposal', LC.blueDeep, { size: 22, align: 'right', alpha: pa }); }
            const ca = ramp(u, S.fix + 2.5, S.fix + 3.3) * gone;
            if (ca > 0) { this.showChunk(this.trajFix.slice(0, 17), ca, sramp(u, S.fix + 2.5, S.fix + 4)); this.label(fieldToWorld(WORLD.start.x + 0.05, 0.17), 'corrected chunk', LC.orangeDeep, { size: 22, alpha: ca }); }
            if (u > S.fix + 0.5) this.label(fieldToWorld(0.66, 0.34), 'geometry layer on — the teacher’s view', LC.tealDeep, { size: 22, align: 'center', alpha: ramp(u, S.fix + 0.5, S.fix + 1.3) * (1 - ramp(u, S.cards - 1, S.cards)) });
          }
          break;
        }
        default: this.orbit(u, s.dur); // thesis, teach, levels, notclaims, end, appendix: diagrams over a slow orbit
      }
      this.labelsOut = this.labels.map(l => Object.assign({}, l, { px: l.px || (l.pos ? this.project(l.pos) : null) }));
      this.anchorsOut = {};
      for (const [k, v] of Object.entries(this.anchors)) this.anchorsOut[k] = Array.isArray(v) ? v : this.project(v);
    }
    hideCem() { this.cem.cycles.forEach(c => c.tubes.forEach(g => g.forEach(t => { t.visible = false; }))); this.ghosts.forEach(g => { g.visible = false; }); }
    render() {
      const r = this.renderer, W = core.W, H = core.H;
      r.setScissorTest(false);
      if (!this.split) { r.setViewport(0, 0, W, H); r.render(this.scene, this.camera); this.renderGeo(this.camera); return; }
      r.setScissorTest(true);
      this.halves.forEach((h, k) => {
        h.apply(); this.scene.updateMatrixWorld(true);
        const x0 = k * W / 2; r.setViewport(x0, 0, W / 2, H); r.setScissor(x0, 0, W / 2, H);
        const cam = h.cam || this.camera2; r.render(this.scene, cam); this.renderGeo(cam);
      });
      r.setScissorTest(false);
    }
  }

  // ---- boot ----
  async function createWorld(canvas, assetBase) {
    // capture options (headless): ?aa=0 disables MSAA, ?scale=0.75 renders the 3D layer at a lower internal resolution
    const ro = (typeof window !== 'undefined' && window.MG_RENDER_OPTS) || {};
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: ro.aa !== false, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(ro.scale || 1); renderer.setSize(core.W, core.H, false);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
    const [glbBuf, kin, banBuf] = await Promise.all([fetch(assetBase + 'panda.glb').then(r => r.arrayBuffer()), fetch(assetBase + 'panda_kin.json').then(r => r.json()), fetch(assetBase + 'banana.glb').then(r => r.arrayBuffer())]);
    const glb = parseGLB(glbBuf), ban = parseGLB(banBuf);
    const img = new Image(); const url = URL.createObjectURL(ban.images[0]); img.src = url; await img.decode(); URL.revokeObjectURL(url);
    const tex = new THREE.Texture(img); tex.flipY = false; tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4; tex.needsUpdate = true; // glTF UV convention
    BANANA = { geometry: ban.meshes[0], texture: tex };
    return new World(renderer, glb, kin);
  }
  root.MGScene = { createWorld, fieldToWorld, X_OFF, Y_TASK, COUNTER_Z };
})(typeof self !== 'undefined' ? self : this);
