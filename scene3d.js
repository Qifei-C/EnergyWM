/* scene3d.js — three.js (r128, global THREE) world for the research-plan animation.
   Z-up metric world. RoboCasa-style kitchen counter (procedural, schematic) with a Franka Panda
   (meshes from mujoco_menagerie, Apache-2.0) on a mobile base. Every visible state is a pure
   function of the timeline time t, so the browser player and the headless renderer agree. */
(function (root) {
  'use strict';
  const core = root.MGCore;
  const { clamp, lerp, ramp, sramp, easeIO, easeOut, fade, WORLD, FX0, FX1, FZ0, FZ1 } = core.util;

  // ---- world constants ----
  const COUNTER_Z = 0.92;          // counter top height
  const X_OFF = -0.25;             // field x = world x - X_OFF
  const Y_TASK = 0.22;             // object plane (y) on the counter
  const Y_FIELD_PLANE = Y_TASK + 0.11; // vertical slice plane sits just behind the objects
  const GHOST = 0.22;                // robot opacity while a field slice is being read
  const MOUNT_X = 0.02;              // robot column x (left of the barrier so the arm does not hide it)
  const fieldToWorld = (fx, fz) => new THREE.Vector3(fx + X_OFF, Y_TASK, fz + COUNTER_Z);
  const TOP_Y_CROP = 0.10;           // top-view field rows with fy < 0.10 lie in front of the counter
  const topFieldToWorld = (fx, fy) => new THREE.Vector3(fx + X_OFF, fy - 0.10, COUNTER_Z + 0.17);

  const COL = {
    counter: 0xdcd6cb, cabinet: 0x52667a, cabinetDark: 0x5f7489, toe: 0x2a2f36, wall: 0xe6e3dc, tileLine: 0xc2c9d0,
    floor: 0xa88b66, upper: 0x52667a, steel: 0xb4bcc5, black: 0x202428, hood: 0xb9c1c9,
    barrier: 0x66768b, bowl: 0x5f86b8, banana: 0xe7b93a, bananaTip: 0x7a5a16,
    base: 0x3b4149, baseLight: 0x5e6670, wheel: 0x1b1e22,
    blue: 0x2f5bb7, orange: 0xd4702a, teal: 0x17907f, red: 0xc43d32, ink: 0x1c2533, grey: 0x98a3b3
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
      if (p.indices != null) { const idx = acc(p.indices); g.setIndex(new THREE.BufferAttribute(idx.array, 1)); }
      g.computeVertexNormals();
      return g;
    });
    return { json, meshes };
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

  // ---- geometry helpers ----
  function box(w, d, h, color, o) {
    o = o || {};
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), new THREE.MeshStandardMaterial({ color, roughness: o.rough == null ? 0.7 : o.rough, metalness: o.metal || 0 }));
    m.castShadow = o.shadow !== false; m.receiveShadow = true; return m;
  }
  function makeTileTexture() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#e4e7ea'; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = '#bcc4cc'; g.lineWidth = 3;
    for (let r = 0; r < 4; r++) { const y = r * 64; g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); const off = r % 2 ? 64 : 0; for (let x = off; x < 512; x += 128) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke(); } }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 2); return t;
  }
  function makeFloorTexture() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d');
    g.fillStyle = '#b89a74'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#b3946c' : '#bd9f7a'; g.fillRect(0, i * 64, 512, 64); g.strokeStyle = '#9a7d5a'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, i * 64); g.lineTo(512, i * 64); g.stroke(); g.beginPath(); g.moveTo((i * 170) % 512, i * 64); g.lineTo((i * 170) % 512, i * 64 + 64); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); return t;
  }
  function makeCounterTexture() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#dcd6cb'; g.fillRect(0, 0, 256, 256);
    let s = 12345; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 1800; i++) { g.fillStyle = rnd() < 0.5 ? '#cbc4b8' : '#e8e3da'; g.fillRect(rnd() * 256, rnd() * 256, 2, 2); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 2); return t;
  }
  function makeArrow(color, radius) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05, transparent: true });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 12), mat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.6, radius * 6, 16), mat);
    shaft.name = 'shaft'; head.name = 'head'; g.add(shaft); g.add(head); g.userData.mat = mat; g.userData.radius = radius; g.visible = false;
    return g;
  }
  function setArrow(a, from, dir, len) {
    const d = dir.clone(); if (d.lengthSq() < 1e-12 || len < 1e-4) { a.visible = false; return; }
    d.normalize(); a.visible = true;
    const headLen = Math.min(a.userData.radius * 6, len * 0.45), shaftLen = Math.max(len - headLen, 1e-4);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    const shaft = a.getObjectByName('shaft'), head = a.getObjectByName('head');
    shaft.scale.set(1, shaftLen, 1); shaft.position.copy(from).add(d.clone().multiplyScalar(shaftLen / 2)); shaft.quaternion.copy(q);
    head.position.copy(from).add(d.clone().multiplyScalar(shaftLen + headLen / 2)); head.quaternion.copy(q);
  }
  function tubeFromPoints(pts, radius, color, segs) {
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, segs || 48, radius, 8, false);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true }));
    linMat(mesh.material); mesh.castShadow = false; return mesh;
  }
  function setTubeProgress(mesh, prog) {
    const idx = mesh.geometry.index.count; mesh.geometry.setDrawRange(0, Math.floor(idx * clamp(prog, 0, 1) / 3) * 3);
    mesh.visible = prog > 0.001;
  }
  function makeBanana() {
    const g = new THREE.Group();
    const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8 - 0.5; pts.push(new THREE.Vector3(t * 0.17, 0, -0.035 * Math.cos(t * Math.PI) + 0.01)); }
    const curve = new THREE.CatmullRomCurve3(pts);
    const body = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.02, 12, false), new THREE.MeshStandardMaterial({ color: COL.banana, roughness: 0.55, transparent: true }));
    body.castShadow = true; g.add(body);
    for (const s of [-0.5, 0.5]) { const tip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), new THREE.MeshStandardMaterial({ color: COL.bananaTip, roughness: 0.7, transparent: true })); tip.position.copy(curve.getPoint(s + 0.5)); g.add(tip); }
    g.userData.mats = g.children.map(c => c.material);
    return g;
  }
  function makeBowl() {
    const prof = []; const R = WORLD.bowlR, Hb = WORLD.bowlH;
    const steps = 12;
    for (let i = 0; i <= steps; i++) { const t = i / steps; prof.push(new THREE.Vector2(R * (0.45 + 0.55 * Math.sin(t * Math.PI / 2)), Hb * t)); }
    prof.push(new THREE.Vector2(R * 0.97, Hb * 0.98)); prof.push(new THREE.Vector2(R * 0.5, Hb * 0.25)); prof.push(new THREE.Vector2(0, Hb * 0.2));
    // close bottom
    prof.unshift(new THREE.Vector2(0, 0));
    const geo = new THREE.LatheGeometry(prof, 48);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COL.bowl, roughness: 0.4, side: THREE.DoubleSide }));
    m.rotation.x = Math.PI / 2; // lathe axis y → z-up
    m.castShadow = true; m.receiveShadow = true; return m;
  }

  // ---- the world ----
  class World {
    constructor(renderer, glb, kin) {
      THREE.Object3D.DefaultUp.set(0, 0, 1);
      this.renderer = renderer;
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0xf6f7f9);
      this.camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.05, 40); this.camera.up.set(0, 0, 1);
      this.camera2 = new THREE.PerspectiveCamera(36, 8 / 9, 0.05, 40); this.camera2.up.set(0, 0, 1);
      this.buildLights(); this.buildKitchen(); this.buildRobot(glb, kin); this.buildTask(); this.buildOverlays3d();
      this.precompute();
      linObject(this.scene);
      // the field slices show the 2D palette exactly: no lighting, no tone mapping
      for (const p of [this.plane, this.topPlane]) { p.material.toneMapped = false; p.material.map.encoding = THREE.sRGBEncoding; }
      this.ring.material.toneMapped = false;
    }
    buildLights() {
      const hemi = new THREE.HemisphereLight(0xe4ecf5, 0x9a8a74, 0.55); this.scene.add(hemi);
      const key = new THREE.DirectionalLight(0xffffff, 1.05); key.position.set(-1.2, -2.2, 3.4); key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048); key.shadow.camera.near = 0.5; key.shadow.camera.far = 9;
      key.shadow.camera.left = -2.5; key.shadow.camera.right = 2.5; key.shadow.camera.top = 2.5; key.shadow.camera.bottom = -2.5; key.shadow.bias = -0.0008;
      this.scene.add(key); this.scene.add(key.target);
      const fill = new THREE.DirectionalLight(0xffffff, 0.28); fill.position.set(2.5, -1.5, 2.0); this.scene.add(fill);
    }
    buildKitchen() {
      const K = new THREE.Group(); K.name = 'kitchen'; this.scene.add(K);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.9 })); floor.receiveShadow = true; K.add(floor);
      // back wall + tiles
      const wall = box(6.0, 0.08, 2.7, COL.wall, { shadow: false }); wall.position.set(0.5, 0.64, 1.35); K.add(wall);
      const tiles = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.56), new THREE.MeshStandardMaterial({ map: makeTileTexture(), roughness: 0.6 }));
      tiles.rotation.x = Math.PI / 2; tiles.position.set(0.5, 0.598, COUNTER_Z + 0.30); K.add(tiles);
      // base cabinets
      const cab = box(4.6, 0.58, 0.78, COL.cabinet); cab.position.set(0.5, 0.31, 0.10 + 0.39); K.add(cab);
      const toe = box(4.6, 0.52, 0.10, COL.toe, { shadow: false }); toe.position.set(0.5, 0.34, 0.05); K.add(toe);
      for (let i = 0; i < 7; i++) {
        const x = -1.6 + 0.3 + i * 0.6; if (x > 0.85 && x < 1.75) continue; // leave room for the range
        const door = box(0.56, 0.02, 0.66, COL.cabinetDark); door.position.set(x, 0.01, 0.46); K.add(door);
        const handle = box(0.16, 0.02, 0.02, COL.steel, { metal: 0.6, rough: 0.3 }); handle.position.set(x, -0.012, 0.72); K.add(handle);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(4.64, 0.62, 0.04), new THREE.MeshStandardMaterial({ map: makeCounterTexture(), roughness: 0.45 })); top.position.set(0.5, 0.31, COUNTER_Z - 0.02); top.receiveShadow = true; top.castShadow = true; K.add(top);
      // upper cabinets
      const upper = box(4.6, 0.34, 0.72, COL.upper); upper.position.set(0.5, 0.47, 1.86); K.add(upper);
      for (let i = 0; i < 7; i++) { const x = -1.6 + 0.3 + i * 0.6; if (x > 0.85 && x < 1.75) continue; const d = box(0.56, 0.02, 0.62, COL.cabinetDark); d.position.set(x, 0.295, 1.86); K.add(d); const h = box(0.02, 0.02, 0.14, COL.steel, { metal: 0.6, rough: 0.3 }); h.position.set(x + 0.2, 0.28, 1.60); K.add(h); }
      // range (stove) to the right
      const range = box(0.76, 0.60, 0.84, 0xd8dbdf, { rough: 0.4, metal: 0.3 }); range.position.set(1.3, 0.30, 0.42); K.add(range);
      const cook = box(0.74, 0.56, 0.03, COL.black, { rough: 0.25, metal: 0.4 }); cook.position.set(1.3, 0.30, COUNTER_Z + 0.005); K.add(cook);
      for (const [dx, dy] of [[-0.18, -0.12], [0.18, -0.12], [-0.18, 0.14], [0.18, 0.14]]) { const burner = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.01, 8, 32), new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.5 })); burner.position.set(1.3 + dx, 0.30 + dy, COUNTER_Z + 0.022); K.add(burner); }
      for (let i = 0; i < 4; i++) { const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 16), new THREE.MeshStandardMaterial({ color: COL.black })); knob.rotation.x = Math.PI / 2; knob.position.set(1.05 + i * 0.16, -0.005, 0.80); K.add(knob); }
      const ovenHandle = box(0.6, 0.025, 0.025, COL.steel, { metal: 0.6, rough: 0.3 }); ovenHandle.position.set(1.3, -0.02, 0.62); K.add(ovenHandle);
      const hood = box(0.8, 0.5, 0.12, COL.hood, { metal: 0.4, rough: 0.35 }); hood.position.set(1.3, 0.37, 1.56); K.add(hood);
      // sink to the left
      const basin = box(0.56, 0.40, 0.03, COL.steel, { metal: 0.7, rough: 0.3, shadow: false }); basin.position.set(-0.8, 0.30, COUNTER_Z - 0.0);
      basin.scale.z = 1; basin.position.z = COUNTER_Z + 0.001; K.add(basin);
      const faucet = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 12), new THREE.MeshStandardMaterial({ color: COL.steel, metalness: 0.8, roughness: 0.25 })); faucet.rotation.x = Math.PI / 2; faucet.rotation.z = 0; faucet.position.set(-0.8, 0.54, COUNTER_Z + 0.14); K.add(faucet);
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 12), new THREE.MeshStandardMaterial({ color: COL.steel, metalness: 0.8, roughness: 0.25 })); spout.rotation.x = Math.PI / 2; spout.position.set(-0.8, 0.43, COUNTER_Z + 0.27); spout.rotation.set(Math.PI / 2, 0, Math.PI / 2); K.add(spout);
      // window above the sink
      const win = box(0.9, 0.02, 0.7, 0xdfe9f3, { shadow: false, rough: 0.2, metal: 0.1 }); win.position.set(-0.8, 0.60, 1.75); K.add(win);
      const frame = box(0.96, 0.03, 0.04, 0xffffff, { shadow: false }); frame.position.set(-0.8, 0.595, 2.12); K.add(frame);
      const frame2 = frame.clone(); frame2.position.z = 1.39; K.add(frame2);
      // mobile base for the robot (Omron-like)
      const B = new THREE.Group(); B.name = 'mobileBase'; this.baseGroup = B; K.add(B);
      B.position.set(MOUNT_X, -0.44, 0);
      const chassis = box(0.52, 0.70, 0.26, COL.base, { rough: 0.5, metal: 0.2 }); chassis.position.set(0, 0, 0.21); B.add(chassis);
      const topPlate = box(0.56, 0.74, 0.03, COL.baseLight, { rough: 0.4, metal: 0.3 }); topPlate.position.set(0, 0, 0.355); B.add(topPlate);
      for (const [dx, dy] of [[-0.2, -0.25], [0.2, -0.25], [-0.2, 0.25], [0.2, 0.25]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 20), new THREE.MeshStandardMaterial({ color: COL.wheel })); w.rotation.z = Math.PI / 2; w.position.set(dx, dy, 0.08); B.add(w); }
      const column = box(0.28, 0.28, 0.34, COL.baseLight, { rough: 0.5, metal: 0.2 }); column.position.set(0, 0.22, 0.54); B.add(column);
      const armPlate = box(0.26, 0.26, 0.02, COL.base, { rough: 0.5 }); armPlate.position.set(0, 0.22, 0.72); B.add(armPlate);
      this.robotMount = new THREE.Vector3(MOUNT_X, -0.22, 0.73);
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
      // barrier (a divider board standing on the counter)
      this.barrier = box(WORLD.barrierX1 - WORLD.barrierX0, 0.45, WORLD.barrierH, COL.barrier, { rough: 0.6 });
      this.barrier.position.set((WORLD.barrierX0 + WORLD.barrierX1) / 2 + X_OFF, 0.225, COUNTER_Z + WORLD.barrierH / 2); T.add(this.barrier);
      // roof shelf for the "top closed" intervention
      this.roof = box(0.40, 0.50, 0.03, COL.cabinetDark, { rough: 0.6 }); this.roof.position.set((WORLD.barrierX0 + WORLD.barrierX1) / 2 + X_OFF, 0.15, COUNTER_Z + WORLD.barrierH + 0.015); this.roof.material.transparent = true; this.roof.material.opacity = 0.28; this.roof.material.depthWrite = false; this.roof.castShadow = false;
      this.roof.visible = false; T.add(this.roof);
      this.bowl = makeBowl(); this.bowl.position.set(WORLD.bowlX + X_OFF, Y_TASK, COUNTER_Z); T.add(this.bowl);
      this.banana = makeBanana(); T.add(this.banana);
      this.bananaB = makeBanana(); this.bananaB.visible = false; T.add(this.bananaB); // the "dropped" banana
      // field slice planes
      this.planeTexCanvas = document.createElement('canvas'); this.planeTexCanvas.width = 1200; this.planeTexCanvas.height = 640;
      this.planeTex = new THREE.CanvasTexture(this.planeTexCanvas); this.planeTex.minFilter = THREE.LinearFilter;
      this.plane = new THREE.Mesh(new THREE.PlaneGeometry(FX1 - FX0, FZ1 - FZ0), new THREE.MeshBasicMaterial({ map: this.planeTex, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
      this.plane.rotation.x = Math.PI / 2; // PlaneGeometry is in x–y; rotate so it stands in x–z
      this.plane.position.set((FX0 + FX1) / 2 + X_OFF, Y_FIELD_PLANE, COUNTER_Z + (FZ0 + FZ1) / 2); T.add(this.plane);
      this.topTexCanvas = document.createElement('canvas'); this.topTexCanvas.width = 1200; this.topTexCanvas.height = 640;
      this.topTex = new THREE.CanvasTexture(this.topTexCanvas); this.topTex.minFilter = THREE.LinearFilter;
      // top-view slice: only the part over the counter (field y ≥ TOP_Y_CROP ↔ world y ≥ 0) is shown
      const cropF = TOP_Y_CROP / (FZ1 - FZ0);
      this.topTex.repeat.set(1, 1 - cropF); this.topTex.offset.set(0, cropF); // plane v ∈ [0,1] ↔ texture v ∈ [crop, 1] (flipY: v = fy / FZ1)
      this.topPlane = new THREE.Mesh(new THREE.PlaneGeometry(FX1 - FX0, FZ1 - FZ0 - TOP_Y_CROP), new THREE.MeshBasicMaterial({ map: this.topTex, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
      this.topPlane.position.set((FX0 + FX1) / 2 + X_OFF, (FZ1 - FZ0 + TOP_Y_CROP) / 2 - 0.10, COUNTER_Z + 0.17); T.add(this.topPlane);
    }
    buildOverlays3d() {
      const O = new THREE.Group(); O.name = 'overlays'; this.scene.add(O); this.ov = O;
      this.arrows = { attract: makeArrow(COL.blue, 0.009), repel: makeArrow(COL.red, 0.009), net: makeArrow(COL.ink, 0.011), grad: makeArrow(COL.orange, 0.012), guide: [] };
      for (const k of ['attract', 'repel', 'net', 'grad']) O.add(this.arrows[k]);
      for (let i = 0; i < 10; i++) { const a = makeArrow(COL.orange, 0.006); O.add(a); this.arrows.guide.push(a); }
      this.probeMarker = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), new THREE.MeshStandardMaterial({ color: COL.ink })); this.probeMarker.visible = false; O.add(this.probeMarker);
      // waypoint path & candidate fan (scene 2)
      const contact = core.util.contactPoint(); // field coords of the contact pose
      const wp = core.util.arcPath(contact.x, contact.z, WORLD.bowlX - 0.02, 0.14, 0.40, 24).map(p => fieldToWorld(p[0], p[1]));
      this.wpPts = wp;
      this.waypointTube = tubeFromPoints(wp, 0.007, COL.orange, 64); this.waypointTube.visible = false; O.add(this.waypointTube);
      this.waypointDots = []; for (let i = 1; i <= 5; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.016, 14, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: COL.orange, emissiveIntensity: 0.6 })); s.position.copy(wp[Math.round(i * 24 / 6)]); s.visible = false; O.add(s); this.waypointDots.push(s); }
      this.fan = []; const rnd = core.util.rng(7);
      for (let i = 0; i < 12; i++) {
        const apex = 0.17 + rnd() * 0.30, endx = 0.62 + rnd() * 0.28, endz = 0.06 + rnd() * 0.2;
        const pts = core.util.arcPath(contact.x, contact.z, endx, endz, apex, 24).map(p => fieldToWorld(p[0], p[1]));
        const tube = tubeFromPoints(pts, 0.0035, 0x8d98a8, 48); tube.visible = false; tube.userData.ok = apex > 0.30; tube.userData.score = (tube.userData.ok ? 0.55 + rnd() * 0.4 : rnd() * 0.4).toFixed(2); tube.userData.end = pts[pts.length - 1]; O.add(tube); this.fan.push(tube);
      }
      // straight proposal line (scene 2) and chunk (scene 3)
      this.straightTube = tubeFromPoints([fieldToWorld(WORLD.start.x, WORLD.start.z), fieldToWorld(WORLD.bowlX - 0.04, WORLD.start.z)], 0.004, COL.blue, 16); this.straightTube.visible = false; O.add(this.straightTube);
      this.chunkDots = []; for (let i = 0; i < 10; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.012, 14, 10), new THREE.MeshStandardMaterial({ color: COL.blue })); s.visible = false; O.add(s); this.chunkDots.push(s); }
      this.chunkTube = null; this.cleanTube = null;
      // the shared transport path of the fast/slow scene (thin, dashed look via low opacity)
      const arcPts = core.util.arcPath(WORLD.start.x + 0.03, WORLD.start.z, WORLD.bowlX, 0.13, 0.40, 60).map(p => fieldToWorld(p[0], p[1]).add(new THREE.Vector3(0, 0, 0.012)));
      this.arcTube = tubeFromPoints(arcPts, 0.003, COL.blue, 96); this.arcTube.visible = false; O.add(this.arcTube);
      // collision ring
      this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 8, 40), new THREE.MeshBasicMaterial({ color: COL.red, transparent: true, opacity: 0 })); this.ring.visible = false; O.add(this.ring);
      // second copy of task objects for the split screen (fast/slow)
      this.ghostBanana = makeBanana(); this.ghostBanana.visible = false; O.add(this.ghostBanana);
    }
    // ---- precomputed IK trajectories ----
    precompute() {
      const P = this.panda;
      // target pose builder: tcp at banana grasp point (field coords), gripper pointing down, fingers along y
      const R = new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
      P.root.updateMatrixWorld(true);
      const rootInv = new THREE.Matrix4().copy(P.root.matrixWorld).invert();
      this.poseFor = (fx, fz, fy) => {
        const w = fieldToWorld(fx, fz); if (fy != null) w.y = fy;
        w.z += 0.012; // tcp slightly above the banana centre
        const M = new THREE.Matrix4().copy(R); M.setPosition(w); return new THREE.Matrix4().multiplyMatrices(rootInv, M);
      };
      const solvePath = (pts) => { let q = P.q.slice(); const out = []; for (const p of pts) { q = P.ik(q, this.poseFor(p[0], p[1], p[2]), 60); out.push(q.slice()); } return out; };
      const contact = core.util.contactPoint();
      // scene 2: straight approach
      this.trajStraight = []; for (let i = 0; i <= 40; i++) this.trajStraight.push([lerp(WORLD.start.x, contact.x, i / 40), WORLD.start.z]);
      this.qStraight = solvePath(this.trajStraight);
      // arc over the barrier (scenes 3, 7)
      this.trajArc = core.util.arcPath(WORLD.start.x + 0.03, WORLD.start.z, WORLD.bowlX, 0.13, 0.40, 60);
      this.qArc = solvePath(this.trajArc);
      // probe pose (scenes 4, 5)
      const pr = core.F.pStar; this.qProbe = P.ik(this.qStraight[this.qStraight.length - 1], this.poseFor(pr.x, pr.z), 80);
      this.qHome = [0, -0.5, 0, -2.3, 0, 1.9, 0.78];
      // IK residuals (m) for the record / debugging
      const res = (traj, qs) => Math.max(...qs.map((q, k) => { const M = P.fk(q), p = new THREE.Vector3().setFromMatrixPosition(M).applyMatrix4(P.root.matrixWorld); const w = fieldToWorld(traj[k][0], traj[k][1]); w.z += 0.012; return p.distanceTo(w); }));
      this.ikResidual = { straight: res(this.trajStraight, this.qStraight), arc: res(this.trajArc, this.qArc) };
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
        const w = fieldToWorld(bananaField[0], bananaField[1]); w.x += o.dx || 0; w.z += o.dz || 0;
        this.banana.position.copy(w); this.banana.rotation.set(0, o.pitch || 0, 0); this.banana.visible = true;
      } else this.banana.visible = false;
    }
    setOpacity(a) { this.panda.setOpacity(a); for (const m of this.banana.userData.mats) { m.opacity = a; m.depthWrite = a > 0.99; } }
    // camera helpers
    lookFrom(px, py, pz, tx, ty, tz, fov) { this.camera.position.set(px, py, pz); this.camera.lookAt(tx, ty, tz); if (fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); } }
    blendCam(A, B, k) { // A,B = [px,py,pz,tx,ty,tz,fov]
      const e = easeIO(clamp(k, 0, 1)); const v = A.map((a, i) => lerp(a, B[i], e)); this.lookFrom(...v); }
    // field texture refresh (drawn by the 2D field code)
    // repaint only when the visible content changes (cut quantized to 1/200 of tmax)
    texKey(mode, cut, opts) {
      const f = core.F[opts.field || 'L0'], c = cut == null ? 'all' : Math.round(clamp(cut / f.tmax, 0, 1.0001) * 200);
      return [mode, opts.field || 'L0', c, Math.round((opts.quiver || 0) * 50), opts.contoursOnly ? 1 : 0].join('|');
    }
    paintPlane(mode, cut, opts) {
      opts = opts || {}; const k = this.texKey(mode, cut, opts);
      if (k === this.planeKey) return; this.planeKey = k;
      core.paintFieldTexture(this.planeTexCanvas, mode, cut, opts);
      this.planeTex.needsUpdate = true;
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
    // everything the 2D overlay needs from this frame, as plain data
    frameInfo() { return { labels: this.labelsOut || [], anchors: this.anchorsOut || {} }; }
    hideAll() {
      const A = this.arrows; for (const k of ['attract', 'repel', 'net', 'grad']) A[k].visible = false; A.guide.forEach(a => a.visible = false);
      this.probeMarker.visible = false; this.waypointTube.visible = false; this.waypointDots.forEach(d => d.visible = false); this.fan.forEach(f => f.visible = false);
      this.straightTube.visible = false; this.arcTube.visible = false; this.chunkDots.forEach(d => d.visible = false); if (this.chunkTube) this.chunkTube.visible = false; if (this.cleanTube) this.cleanTube.visible = false;
      this.ring.visible = false; this.plane.material.opacity = 0; this.topPlane.material.opacity = 0; this.roof.visible = false; this.bananaB.visible = false; this.ghostBanana.visible = false;
      this.barrier.visible = true; this.barrier.scale.set(1, 1, 1); this.barrier.position.set((WORLD.barrierX0 + WORLD.barrierX1) / 2 + X_OFF, 0.225, COUNTER_Z + WORLD.barrierH / 2);
      this.setOpacity(1); this.split = false;
    }

    // ================= per-scene state =================
    update(t) {
      this.hideAll();
      const i = core.sceneIndexAt(t), s = core.SCENES[i], u = t - s.start;
      this.labels = []; // 3D-anchored labels for the overlay: {pos:Vector3, text, color, size, dx, dy, alpha}
      this.anchors = {}; // named 3D points the overlay needs in screen space
      const CAM_MAIN = [0.95, -1.75, 1.95, 0.25, 0.22, 1.08, 34];   // front-right, RoboCasa agentview-like
      const CAM_SIDE = [0.66, -1.80, 1.42, 0.66, 0.33, 1.20, 32];   // frontal, slice plane on the left 2/3
      const CAM_GUIDE = [0.95, -1.62, 1.72, 0.58, 0.22, 1.16, 34];  // task on the left half, pipeline on the right
      const CAM_TOP = [0.62, -1.05, 2.35, 0.62, 0.22, 1.02, 36];    // looking down on the top-view slice
      const CAM_TITLE = [0.55, -2.75, 1.95, -0.40, 0.20, 1.12, 40];
      this.CAM_SPLIT = [0.42, -1.95, 1.62, 0.36, 0.22, 1.13, 34];
      switch (s.id) {
        case 'title': {
          const k = u / s.dur; this.lookFrom(lerp(CAM_TITLE[0], 0.40, k), lerp(CAM_TITLE[1], -2.55, k), CAM_TITLE[2], CAM_TITLE[3], CAM_TITLE[4], CAM_TITLE[5], CAM_TITLE[6]);
          this.setRobot(this.qHome, 0.04, null);
          this.paintPlane('T', core.F.L0.tmax * sramp(u, 0.2, 5.5), { contoursOnly: true });
          this.plane.material.opacity = 0.9 * ramp(u, 0.2, 1.5);
          break;
        }
        case 'task': {
          this.blendCam([0.40, -2.55].concat(CAM_TITLE.slice(2)), CAM_MAIN, u / 2.5); // continue from the title's end framing
          const TT = core.util.TL.task;
          const m = sramp(u, TT.move[0], TT.move[1]);
          const q = this.sampleQ(this.qStraight, m), p = this.sampleP(this.trajStraight, m);
          this.setRobot(q, 0.018, p);
          const ia = ramp(u, 0.6, 1.6) * (1 - ramp(u, TT.propEnd - 0.5, TT.propEnd + 0.2));
          this.labels.push({ pos: fieldToWorld(WORLD.barrierX1, WORLD.barrierH * 0.35).setY(0.0), text: 'barrier', color: '#4C5868', size: 24, weight: 600, dx: 12, alpha: ia });
          this.labels.push({ pos: fieldToWorld(WORLD.bowlX, 0).setY(Y_TASK - 0.10), text: 'bowl', color: '#4C5868', size: 24, weight: 600, align: 'center', dy: 34, alpha: ia });
          if (u > TT.move[0] && u < TT.propEnd) {
            const pa = fade(u, TT.move[0], TT.move[0] + 0.6, TT.propEnd - 1.5, TT.propEnd);
            this.straightTube.visible = true; this.straightTube.material.opacity = pa * 0.85;
            this.labels.push({ pos: fieldToWorld(WORLD.bowlX - 0.04, WORLD.start.z), text: 'VLA proposal', color: '#2F5BB7', size: 28, weight: 600, dx: 14, dy: 8, alpha: pa });
          }
          const fl = TT.flash, flash = u > fl ? fade(u, fl, fl + 0.15, fl + 1.6, fl + 3) : 0;
          if (flash > 0) {
            const c = fieldToWorld(WORLD.barrierX0, p[1] - 0.01); c.y = Y_TASK - 0.09;
            this.ring.visible = true; this.ring.position.copy(c); this.ring.rotation.set(Math.PI / 2, 0, 0); const sc = 1 + (u - fl) * 0.7; this.ring.scale.set(sc, sc, sc); this.ring.material.opacity = flash;
            this.labels.push({ pos: c.clone().add(new THREE.Vector3(-0.07, 0, 0.09)), text: 'collision', color: '#C43D32', size: 28, weight: 700, align: 'right', alpha: flash });
          }
          if (u > TT.wp[0] && u < TT.wp[1] + 0.5) {
            const al = fade(u, TT.wp[0], TT.wp[0] + 0.6, TT.wp[1] - 0.6, TT.wp[1] + 0.5), prog = sramp(u, TT.wpDraw[0], TT.wpDraw[1]);
            this.waypointTube.visible = true; setTubeProgress(this.waypointTube, prog); this.waypointTube.material.opacity = al;
            this.waypointDots.forEach((d, k) => { d.visible = prog * 6 > k + 1; });
            this.anchors.wpMid = this.wpPts[11].clone(); this.anchors.wpLink = this.wpPts[17].clone();
          }
          if (u > TT.fan[0] && u < TT.fan[1] + 0.5) {
            const al = fade(u, TT.fan[0], TT.fan[0] + 0.6, TT.fan[1] - 0.6, TT.fan[1] + 0.5), prog = sramp(u, TT.fanDraw[0], TT.fanDraw[1]);
            this.fan.forEach(f => { f.visible = true; setTubeProgress(f, prog); f.material.opacity = al * (f.userData.ok ? 0.9 : 0.55); });
            this.anchors.fanMid = fieldToWorld(0.60, 0.31);
          }
          if (u > TT.grad) {
            const al = ramp(u, TT.grad, TT.grad + 0.8), from = fieldToWorld(p[0], p[1]); from.y -= 0.12;
            setArrow(this.arrows.grad, from, new THREE.Vector3(0.25, 0, 1), 0.22 * al); this.arrows.grad.userData.mat.opacity = 1;
            this.labels.push({ pos: from.clone().add(new THREE.Vector3(0.07, 0, 0.24 * al)), text: '−∇E', color: '#D4702A', size: 36, math: true, alpha: al });
          }
          break;
        }
        case 'guide': {
          this.blendCam(CAM_MAIN, CAM_GUIDE, u / 2.0);
          const loopT = 12, uu = u % loopT, tau = clamp(uu / 8.5, 0, 1), inWin = tau >= 0.3 && tau <= 0.8, g = sramp(tau, 0.3, 0.8);
          const Hn = 10, rnd = core.util.rng(3), noise = []; for (let k = 0; k < Hn; k++) noise.push([(rnd() - 0.5) * 0.22, (rnd() - 0.5) * 0.22]);
          const arc = core.util.arcPath(WORLD.start.x + 0.03, WORLD.start.z, WORLD.bowlX, 0.13, 0.40, Hn - 1);
          const pts = [], clean = [];
          for (let k = 0; k < Hn; k++) {
            const sx = lerp(WORLD.start.x + 0.03, WORLD.bowlX, k / (Hn - 1)), sz = lerp(WORLD.start.z, 0.13, k / (Hn - 1));
            const cx = lerp(sx, arc[k][0], g), cz = lerp(sz, arc[k][1], g); clean.push([cx, cz]);
            pts.push([lerp(noise[k][0] + 0.6, cx, tau), lerp(noise[k][1] + 0.28, cz, tau)]);
          }
          const P3 = pts.map(p => fieldToWorld(p[0], p[1])), C3 = clean.map(p => fieldToWorld(p[0], p[1]));
          P3.forEach((p, k) => { const d = this.chunkDots[k]; d.visible = true; d.position.copy(p); });
          if (this.chunkTube) { this.ov.remove(this.chunkTube); this.chunkTube.geometry.dispose(); }
          this.chunkTube = tubeFromPoints(P3, 0.005, COL.blue, 60); this.chunkTube.material.opacity = 0.35 + 0.65 * tau; this.ov.add(this.chunkTube);
          if (this.cleanTube) { this.ov.remove(this.cleanTube); this.cleanTube.geometry.dispose(); this.cleanTube = null; }
          if (tau > 0.05 && tau < 0.98) { this.cleanTube = tubeFromPoints(C3, 0.0025, 0x1d3f86, 60); this.cleanTube.material.opacity = 0.45; this.ov.add(this.cleanTube); this.labels.push({ pos: C3[6].clone().add(new THREE.Vector3(0, 0, 0.05)), text: 'clean estimate', color: '#1D3F86', size: 24, weight: 600 }); }
          if (inWin) {
            const strength = Math.sin((tau - 0.3) / 0.5 * Math.PI);
            for (let k = 2; k <= 7; k++) { const len = 0.14 * strength * (1 - Math.abs(k - 4.5) / 4); setArrow(this.arrows.guide[k], P3[k], new THREE.Vector3(0.25, 0, 1), len); this.arrows.guide[k].userData.mat.opacity = 1; }
            this.labels.push({ pos: P3[4].clone().add(new THREE.Vector3(0, 0, 0.2)), text: '−λ∇E', color: '#D4702A', size: 34, math: true });
          }
          // robot holds at the start pose, banana in hand
          this.setRobot(this.qStraight[0], 0.018, [WORLD.start.x, WORLD.start.z]);
          this.tau = tau;
          break;
        }
        case 'stall': {
          this.blendCam(CAM_MAIN, CAM_SIDE, u / 2.5);
          const pr = core.F.pStar;
          this.setRobot(this.qProbe, 0.018, [pr.x, pr.z]); const TS = core.util.TL.stall; this.setOpacity(lerp(1, GHOST, sramp(u, TS.ghost[0], TS.ghost[1])));
          this.paintPlane('E', null, {}); this.plane.material.opacity = 0.92 * ramp(u, 0, 2.5);
          const parts = core.F.Eloc_parts(pr.x, pr.z), base = fieldToWorld(pr.x, pr.z); base.y = Y_FIELD_PLANE - 0.01;
          const sc = 0.03; const a1 = sramp(u, TS.a1[0], TS.a1[1]), a2 = sramp(u, TS.a2[0], TS.a2[1]), a3 = sramp(u, TS.a3[0], TS.a3[1]);
          if (u > TS.ghost[1]) {
            this.probeMarker.visible = true; this.probeMarker.position.copy(base);
            const att = new THREE.Vector3(-parts.attract[0], 0, -parts.attract[1]), rep = new THREE.Vector3(-parts.repel[0], 0, -parts.repel[1]);
            if (a1 > 0) { setArrow(this.arrows.attract, base, att, att.length() * sc * a1); this.labels.push({ pos: base.clone().add(att.clone().normalize().multiplyScalar(att.length() * sc * a1 + 0.04)), text: 'attract', color: '#2F5BB7', size: 28, weight: 600, alpha: a1 }); }
            if (a2 > 0) { setArrow(this.arrows.repel, base, rep, rep.length() * sc * a2); this.labels.push({ pos: base.clone().add(rep.clone().normalize().multiplyScalar(rep.length() * sc * a2 + 0.05)), text: 'repel', color: '#C43D32', size: 28, weight: 600, alpha: a2, align: 'right' }); }
            if (a3 > 0) { const net = att.clone().add(rep), nl = net.length() * sc * 3 * a3; setArrow(this.arrows.net, base, net, nl); this.labels.push({ pos: base.clone().add(net.clone().normalize().multiplyScalar(nl)), text: 'net', color: '#1C2533', size: 28, weight: 700, dx: 16, dy: 26, alpha: a3 }); }
          }
          break;
        }
        case 'geo': {
          const pr = core.F.pStar;
          const TG = core.util.TL.geo, PH = TG.phase;
          if (u < PH[0]) {
            this.lookFrom(...CAM_SIDE);
            this.setRobot(this.qProbe, 0.018, [pr.x, pr.z]); this.setOpacity(GHOST);
            const cut = core.F.L0.tmax * sramp(u, TG.cut[0], TG.cut[1]);
            this.paintPlane('T', cut, { quiver: ramp(u, TG.quiver[0], TG.quiver[1]) }); this.plane.material.opacity = 0.92;
            if (u > TG.grad[0]) {
              const gq = sramp(u, TG.grad[0], TG.grad[1]), g = core.F.L0.gradAt(pr.x, pr.z), L = Math.hypot(g[0], g[1]) || 1;
              const base = fieldToWorld(pr.x, pr.z); base.y = Y_FIELD_PLANE - 0.01; this.probeMarker.visible = true; this.probeMarker.position.copy(base);
              setArrow(this.arrows.grad, base, new THREE.Vector3(-g[0] / L, 0, -g[1] / L), 0.22 * gq); this.arrows.grad.userData.mat.opacity = 1;
              this.labels.push({ pos: base.clone().add(new THREE.Vector3(-g[0] / L, 0, -g[1] / L).multiplyScalar(0.22 * gq)), text: '−∇T', color: '#9E4F17', size: 36, weight: 700, dx: 18, dy: -6, alpha: gq });
            }
          } else if (u < TG.caveats) {
            // interventions, sequential: removed, top closed, taller (TL.geo.phase)
            const phase = u < PH[1] ? 0 : u < PH[2] ? 1 : 2, u0 = PH[phase], k = sramp(u, u0, u0 + 1.2);
            this.setOpacity(GHOST);
            if (phase === 0) {
              this.lookFrom(...CAM_SIDE); this.setRobot(this.qProbe, 0.018, [pr.x, pr.z]);
              this.barrier.scale.set(1, 1, 1 - k); this.barrier.position.z = COUNTER_Z + WORLD.barrierH * (1 - k) / 2; this.barrier.visible = k < 0.99;
              const cut = core.F.L1.tmax * sramp(u, u0 + 0.8, u0 + 3.5);
              this.paintPlane('T', cut, { field: 'L1', quiver: ramp(u, u0 + 3.2, u0 + 4) }); this.plane.material.opacity = 0.92;
              this.gradLabel(core.F.L1, pr, u, u0 + 3.6, 'no extra lift');
            } else if (phase === 1) {
              this.blendCam(CAM_SIDE, CAM_TOP, k);
              this.setRobot(this.qStraight[0], 0.018, [WORLD.start.x, WORLD.start.z]);
              // wall from the counter's front edge to world y = 0.40 (field y = wallY1); the field treats the
              // wall as extending past the front, i.e. the only way around is the opening at the back
              const wy1 = WORLD.top.wallY1 - 0.10; this.barrier.visible = true; this.barrier.scale.set(1, wy1 / 0.45, 1); this.barrier.position.y = wy1 / 2;
              this.roof.visible = true; this.roof.scale.set(1, wy1 / 0.50, 1); this.roof.position.y = wy1 / 2;
              const cut = core.F.L2.tmax * sramp(u, u0 + 0.8, u0 + 3.5);
              this.paintTop('L2', cut); this.topPlane.material.opacity = 0.9 * ramp(u, u0 + 0.5, u0 + 1.2);
              const fp = [0.30, 0.32]; const g = core.F.L2.gradAt(fp[0], fp[1]), L = Math.hypot(g[0], g[1]) || 1, gq = sramp(u, u0 + 3.6, u0 + 4.4);
              const base = topFieldToWorld(fp[0], fp[1]); base.z += 0.005; this.probeMarker.visible = true; this.probeMarker.position.copy(base);
              setArrow(this.arrows.grad, base, new THREE.Vector3(-g[0] / L, -g[1] / L, 0), 0.22 * gq); this.arrows.grad.userData.mat.opacity = 1;
              this.labels.push({ pos: base.clone().add(new THREE.Vector3(-g[0] / L, -g[1] / L, 0).multiplyScalar(0.22 * gq)), text: '−∇T', color: '#9E4F17', size: 36, weight: 700, dx: 18, dy: -6, alpha: gq });
            } else {
              this.lookFrom(...CAM_SIDE); this.setRobot(this.qProbe, 0.018, [pr.x, pr.z]);
              const hs = lerp(1, 0.42 / WORLD.barrierH, k); this.barrier.scale.set(1, 1, hs); this.barrier.position.z = COUNTER_Z + WORLD.barrierH * hs / 2; this.barrier.position.y = 0.225;
              const cut = core.F.L3.tmax * sramp(u, u0 + 0.8, u0 + 3.5);
              this.paintPlane('T', cut, { field: 'L3', quiver: ramp(u, u0 + 3.2, u0 + 4) }); this.plane.material.opacity = 0.92;
              this.gradLabel(core.F.L3, pr, u, u0 + 3.6, 'more clearance');
            }
          } else {
            // caveats / stages: calm wide shot, robot normal
            this.lookFrom(...CAM_MAIN); this.setRobot(this.qStraight[0], 0.018, [WORLD.start.x, WORLD.start.z]); this.setOpacity(1);
          }
          break;
        }
        case 'teach': case 'exp': case 'retire': {
          // slow orbit behind the diagrams
          const k = u / s.dur, ang = -1.2 + k * 0.5;
          this.lookFrom(0.3 + 2.4 * Math.cos(ang), 0.2 + 2.4 * Math.sin(ang), 1.9, 0.3, 0.25, 1.0, 36);
          const m = 0.5 + 0.5 * Math.sin(u * 0.25);
          this.setRobot(this.sampleQ(this.qArc, m), 0.018, this.sampleP(this.trajArc, m));
          break;
        }
        case 'slip': {
          this.split = true;
          const S = core.util.SLIP;
          // camera for both halves (same framing)
          const cam = this.CAM_SPLIT; this.lookFrom(...cam);
          this.arcTube.visible = true; this.arcTube.material.opacity = 0.55 * ramp(u, 0.3, 1.2);
          this.camera2.position.copy(this.camera.position); this.camera2.lookAt(cam[3], cam[4], cam[5]); this.camera2.fov = cam[6]; this.camera2.updateProjectionMatrix();
          this.splitState = S.dur.map((d, pi) => {
            let sIn = ((u - S.t0) % S.period + S.period) % S.period; if (u < S.t0) sIn = 0;
            const prog = clamp(sIn / d, 0, 1), slipped = pi === 1 && sIn > d * 0.5 && sIn < S.period - 0.1;
            const st = { prog, slipped, sIn, d, q: this.sampleQ(this.qArc, prog), p: this.sampleP(this.trajArc, prog), dx: 0, pitch: 0, drop: null };
            if (pi === 1 && !slipped) { const lag = clamp((1 / d) * 0.4 * Math.sin(Math.PI * prog), 0, 0.08); st.dx = -lag; st.pitch = lag * 4; }
            if (slipped) {
              // released at the apex with the path's horizontal speed, falls (slowed g for legibility) onto the counter
              const tf = sIn - d * 0.5, apex = this.sampleP(this.trajArc, 0.5), g = 3.0, rest = 0.03;
              const z0 = apex[1] - 0.01, tLand = Math.sqrt(2 * (z0 - rest) / g), te = Math.min(tf, tLand);
              const vx = (WORLD.bowlX - WORLD.start.x) / d * 0.9, fx = apex[0] - 0.05 + vx * te + 0.03 * Math.max(0, Math.min(tf - tLand, 0.3));
              const fz = z0 - 0.5 * g * te * te;
              st.drop = { pos: fieldToWorld(fx, fz), rot: -Math.PI * te / tLand }; // half a turn in the air, lands flat
              const la = fade(sIn, d * 0.5, d * 0.5 + 0.3, S.period - 1, S.period - 0.2);
              const px = this.project(st.drop.pos.clone().add(new THREE.Vector3(0.05, 0, 0.06)), this.camera2, core.W / 2, core.W / 2);
              if (px) this.labels.push({ px, text: 'slip', color: '#C43D32', size: 30, weight: 700, alpha: la });
            }
            return st;
          });
          break;
        }
      }
      this.labelsOut = this.labels.map(l => Object.assign({}, l, { px: l.px || this.project(l.pos) }));
      this.anchorsOut = {};
      for (const [k, v] of Object.entries(this.anchors)) this.anchorsOut[k] = Array.isArray(v) ? v : this.project(v);
    }
    gradLabel(field, pr, u, t0, text) {
      const gq = sramp(u, t0, t0 + 0.8); if (gq <= 0) return;
      const g = field.gradAt(pr.x, pr.z), L = Math.hypot(g[0], g[1]) || 1, base = fieldToWorld(pr.x, pr.z); base.y = Y_FIELD_PLANE - 0.01;
      this.probeMarker.visible = true; this.probeMarker.position.copy(base);
      setArrow(this.arrows.grad, base, new THREE.Vector3(-g[0] / L, 0, -g[1] / L), 0.22 * gq); this.arrows.grad.userData.mat.opacity = 1;
      this.labels.push({ pos: base.clone().add(new THREE.Vector3(-g[0] / L, 0, -g[1] / L).multiplyScalar(0.22 * gq)), text: '−∇T', color: '#9E4F17', size: 36, weight: 700, dx: 18, dy: -6, alpha: gq });
    }
    // render; handles the split screen of the slip scene
    render() {
      const r = this.renderer, W = core.W, H = core.H;
      r.setScissorTest(false);
      if (!this.split) { r.setViewport(0, 0, W, H); r.render(this.scene, this.camera); return; }
      r.setScissorTest(true);
      const halves = [[0, this.splitState[0]], [W / 2, this.splitState[1]]];
      halves.forEach(([x0, st]) => {
        // pose robot + banana for this half
        this.setRobot(st.q, st.slipped ? 0.04 : 0.018, st.slipped ? null : st.p, { dx: st.dx, pitch: st.pitch });
        this.bananaB.visible = !!st.drop;
        if (st.drop) { this.bananaB.position.copy(st.drop.pos); this.bananaB.rotation.set(0, st.drop.rot, 0); }
        this.scene.updateMatrixWorld(true);
        r.setViewport(x0, 0, W / 2, H); r.setScissor(x0, 0, W / 2, H);
        r.render(this.scene, this.camera2);
      });
      r.setScissorTest(false);
    }
  }

  // ---- boot ----
  async function createWorld(canvas, assetBase) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(core.W, core.H, false);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
    const [glbBuf, kin] = await Promise.all([fetch(assetBase + 'panda.glb').then(r => r.arrayBuffer()), fetch(assetBase + 'panda_kin.json').then(r => r.json())]);
    const glb = parseGLB(glbBuf);
    return new World(renderer, glb, kin);
  }
  root.MGScene = { createWorld, fieldToWorld, X_OFF, Y_TASK, COUNTER_Z };
})(typeof self !== 'undefined' ? self : this);
