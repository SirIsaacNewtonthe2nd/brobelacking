// Three.js scene: map, characters, first-person viewmodel and effects (tracers, impacts, flashes).
import * as THREE from '../vendor/three.module.min.js';
import { HFOV, VIEW_RECOIL, HITBOX, GUN_HEIGHT } from './config.js';

const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;

const MAT_COLORS = {
  floor: ['#7d838b', '#6c7279', '#757b83'],
  wall: ['#cfc6b6', '#b6ad9d', '#c3bba9'],
  crate: ['#a87a46', '#8a5f31', '#9a6c3b'],
  wood: ['#b88b55', '#946a3a', '#a77b48'],
  half: ['#7a8a99', '#65737f', '#6f7e8b'],
  stone: ['#a39b8d', '#8b8476', '#979082'],
};

function gridTexture(renderer, [base, major, minor], crate = false) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, s, s);
  // subtle noise so surfaces read as surfaces
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
  g.fillStyle = minor;
  g.fillRect(s / 2 - 1, 0, 2, s);
  g.fillRect(0, s / 2 - 1, s, 2);
  g.fillStyle = major;
  g.fillRect(0, 0, 4, s);
  g.fillRect(0, 0, s, 4);
  if (crate) {
    g.strokeStyle = major;
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(s, 0); g.lineTo(0, s);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// One merged geometry per material. UVs come from world position so the 1 m grid lines up everywhere.
function boxesGeometry(boxes, texMeters) {
  const pos = [], nor = [], uv = [], idx = [];
  const faces = [
    [0, 1, [2, 1]], [0, -1, [2, 1]], [1, 1, [0, 2]], [1, -1, [0, 2]], [2, 1, [0, 1]], [2, -1, [0, 1]],
  ];
  for (const b of boxes) {
    for (const [axis, sign, [ua, va]] of faces) {
      const base = pos.length / 3;
      const fixed = sign > 0 ? b.max[axis] : b.min[axis];
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const [cu, cv] of corners) {
        const p = [0, 0, 0];
        p[axis] = fixed;
        p[ua] = cu ? b.max[ua] : b.min[ua];
        p[va] = cv ? b.max[va] : b.min[va];
        pos.push(...p);
        const n = [0, 0, 0]; n[axis] = sign; nor.push(...n);
        uv.push(p[ua] / texMeters, p[va] / texMeters);
      }
      // Counter-clockwise seen from outside. (x,y) is a right-handed pair around z; (z,y) and (x,z) are not.
      const hand = axis === 2 ? 1 : -1;
      if (hand * sign > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

function labelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.font = 'bold 200px Inter, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,250,220,1)');
  gr.addColorStop(0.3, 'rgba(255,200,90,0.9)');
  gr.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// First-person gun models, built from boxes. The muzzle object marks where flashes and tracers start.
function gunModel(kind) {
  const g = new THREE.Group();
  const dark = 0x2b2f36, mid = 0x454c57, light = 0x6b7482;
  const muzzle = new THREE.Object3D();
  const add = (...a) => { const m = box(...a); g.add(m); return m; };
  switch (kind) {
    case 'knife':
      add(0.012, 0.035, 0.2, 0xc8ccd2, 0, 0, -0.14);
      add(0.026, 0.032, 0.1, dark, 0, -0.003, -0.0);
      muzzle.position.set(0, 0, -0.24);
      break;
    case 'pistol':
      add(0.034, 0.042, 0.19, mid, 0, 0.02, -0.08);
      add(0.03, 0.095, 0.045, dark, 0, -0.04, 0.0).rotation.x = -0.25;
      add(0.006, 0.012, 0.01, light, 0, 0.047, -0.165);
      muzzle.position.set(0, 0.02, -0.18);
      break;
    case 'revolver':
      add(0.028, 0.03, 0.22, mid, 0, 0.03, -0.12);
      add(0.05, 0.05, 0.065, dark, 0, 0.02, -0.01);
      add(0.032, 0.1, 0.045, dark, 0, -0.04, 0.04).rotation.x = -0.35;
      add(0.006, 0.014, 0.01, light, 0, 0.05, -0.22);
      muzzle.position.set(0, 0.03, -0.23);
      break;
    case 'smg':
      add(0.05, 0.07, 0.3, mid, 0, 0.0, -0.12);
      add(0.03, 0.12, 0.045, dark, 0, -0.08, -0.12);
      add(0.03, 0.09, 0.04, dark, 0, -0.06, 0.0).rotation.x = -0.2;
      add(0.024, 0.024, 0.1, dark, 0, 0.012, -0.32);
      add(0.008, 0.02, 0.06, light, 0, 0.045, -0.08);
      muzzle.position.set(0, 0.012, -0.38);
      break;
    case 'rifle':
      add(0.055, 0.08, 0.42, mid, 0, 0, -0.16);
      add(0.045, 0.07, 0.2, dark, 0, -0.01, 0.13);
      add(0.026, 0.026, 0.22, dark, 0, 0.012, -0.47);
      add(0.035, 0.13, 0.06, dark, 0, -0.1, -0.14).rotation.x = 0.25;
      add(0.03, 0.08, 0.04, dark, 0, -0.07, -0.01).rotation.x = -0.25;
      add(0.01, 0.03, 0.09, light, 0, 0.055, -0.1);
      muzzle.position.set(0, 0.012, -0.58);
      break;
    case 'dmr':
      add(0.055, 0.08, 0.46, mid, 0, 0, -0.18);
      add(0.045, 0.07, 0.2, dark, 0, -0.01, 0.13);
      add(0.026, 0.026, 0.24, dark, 0, 0.012, -0.52);
      add(0.035, 0.11, 0.06, dark, 0, -0.09, -0.15);
      add(0.03, 0.08, 0.04, dark, 0, -0.07, -0.01).rotation.x = -0.25;
      add(0.04, 0.04, 0.16, light, 0, 0.065, -0.12);
      muzzle.position.set(0, 0.012, -0.64);
      break;
    case 'sniper':
      add(0.055, 0.075, 0.6, mid, 0, 0, -0.22);
      add(0.05, 0.08, 0.22, dark, 0, -0.01, 0.17);
      add(0.026, 0.026, 0.32, dark, 0, 0.01, -0.68);
      add(0.05, 0.05, 0.26, light, 0, 0.07, -0.15);
      add(0.035, 0.09, 0.05, dark, 0, -0.08, -0.12);
      muzzle.position.set(0, 0.01, -0.85);
      break;
    case 'shotgun':
      add(0.06, 0.08, 0.42, mid, 0, 0, -0.14);
      add(0.05, 0.07, 0.2, dark, 0, -0.01, 0.15);
      add(0.04, 0.04, 0.3, dark, 0, 0.015, -0.46);
      add(0.055, 0.05, 0.14, light, 0, -0.035, -0.4);
      muzzle.position.set(0, 0.015, -0.62);
      break;
    case 'heavy':
      add(0.09, 0.12, 0.48, mid, 0, -0.01, -0.16);
      add(0.08, 0.1, 0.12, dark, 0, -0.12, -0.12);
      add(0.04, 0.04, 0.24, dark, 0, 0.01, -0.5);
      add(0.03, 0.09, 0.05, dark, 0, -0.08, 0.05).rotation.x = -0.25;
      add(0.012, 0.03, 0.1, light, 0, 0.065, -0.1);
      muzzle.position.set(0, 0.01, -0.64);
      break;
  }
  // sleeve/hand
  const arm = box(0.07, 0.07, 0.32, 0x30363f, 0.03, -0.075, 0.2);
  arm.rotation.x = 0.3;
  g.add(arm);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

const VM_SCALE = 0.8;
// Hip and aim-down-sights positions (camera space). ADS heights put the top of each sight on the crosshair.
const VM_POSE = {
  knife: { hip: [0.17, -0.17, -0.34], ads: [0.17, -0.17, -0.34] },
  pistol: { hip: [0.15, -0.14, -0.34], ads: [0, -0.047, -0.3] },
  revolver: { hip: [0.15, -0.14, -0.34], ads: [0, -0.05, -0.31] },
  smg: { hip: [0.16, -0.15, -0.34], ads: [0, -0.049, -0.32] },
  rifle: { hip: [0.16, -0.15, -0.34], ads: [0, -0.061, -0.33] },
  dmr: { hip: [0.16, -0.15, -0.34], ads: [0, -0.073, -0.33] },
  sniper: { hip: [0.16, -0.15, -0.34], ads: [0, -0.08, -0.24] },
  shotgun: { hip: [0.16, -0.15, -0.34], ads: [0.1, -0.13, -0.3] },
  heavy: { hip: [0.17, -0.14, -0.35], ads: [0, -0.069, -0.34] },
};

export class Renderer {
  constructor(canvas, game, settings) {
    this.game = game;
    this.settings = settings;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.autoClear = false;
    r.shadowMap.enabled = settings.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa9c2d8);
    this.scene.fog = new THREE.Fog(0xa9c2d8, 90, 220);
    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.04, 400);
    this.camera.rotation.order = 'YXZ';

    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 5);
    this.vmScene.add(new THREE.HemisphereLight(0xdfe8f2, 0x3a3530, 1.6));
    const vmSun = new THREE.DirectionalLight(0xffffff, 1.4);
    vmSun.position.set(0.5, 1, 0.3);
    this.vmScene.add(vmSun);

    this.buildWorld();
    this.characters = new Map();
    this.fx = { tracers: [], decals: [], flashes: [], particles: [], dmg: [] };
    this.buildFx();

    this.vm = { group: new THREE.Group(), model: null, kind: null, kick: 0, kickRot: 0, swayX: 0, swayY: 0, bob: 0, equipStart: -10, equipDur: 1, flashUntil: 0, swingStart: -10, swingHeavy: false };
    this.vmScene.add(this.vm.group);
    this.fovZoom = 1;
    this.deathCam = null;

    this.resize();
    addEventListener('resize', () => this.resize());
    this.hookEvents();
  }

  buildWorld() {
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
    sun.position.set(-30, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xdbe7f3, 0x5a554c, 1.3));

    const byMat = {};
    for (const b of this.game.map.boxes) (byMat[b.mat] ||= []).push(b);
    this.mapMaterials = [];
    for (const [mat, list] of Object.entries(byMat)) {
      const tex = gridTexture(this.renderer, MAT_COLORS[mat] || MAT_COLORS.wall, mat === 'crate');
      const material = new THREE.MeshLambertMaterial({ map: tex });
      const mesh = new THREE.Mesh(boxesGeometry(list, mat === 'crate' ? 1 : 2), material);
      mesh.castShadow = mat !== 'floor';
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.mapMaterials.push(material);
    }
    for (const l of this.game.map.labels) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ map: labelTexture(l.text), transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(l.x, 0.02, l.z);
      this.scene.add(m);
    }
  }

  buildFx() {
    // Tracers: one line-segment buffer with per-vertex alpha.
    const N = 96;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 8), 4).setUsage(THREE.DynamicDrawUsage));
    this.tracerLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    this.tracerLines.frustumCulled = false;
    this.scene.add(this.tracerLines);
    this.tracerSlots = Array.from({ length: N }, () => ({ t: -10, from: new THREE.Vector3(), to: new THREE.Vector3(), color: [1, 0.85, 0.5] }));
    this.tracerNext = 0;

    // Bullet holes
    const DN = 600;
    this.decalMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x15171a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), DN);
    this.decalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < DN; i++) this.decalMesh.setMatrixAt(i, zero);
    this.decalMesh.frustumCulled = false;
    this.scene.add(this.decalMesh);
    this.decalTimes = new Float32Array(DN).fill(-1);
    this.decalNext = 0;

    const ftex = flashTexture();
    this.flashMat = new THREE.SpriteMaterial({ map: ftex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.flashPool = Array.from({ length: 16 }, () => { const s = new THREE.Sprite(this.flashMat); s.visible = false; this.scene.add(s); return { s, until: 0 }; });
    this.vmFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: ftex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    this.vmFlash.visible = false;

    // Hit sparks
    const PN = 300;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PN * 3), 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PN * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.sparks = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.05, vertexColors: true }));
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);
    this.sparkData = Array.from({ length: PN }, () => ({ life: 0, p: [0, -100, 0], v: [0, 0, 0] }));
    this.sparkNext = 0;
  }

  hookEvents() {
    const g = this.game;
    g.on('tracer', ({ who, gun, from, to }) => {
      const own = who === g.player;
      if (gun.def.melee) return;
      if (!own && gun.def.suppressed) return; // suppressed guns hide tracers from others
      const slot = this.tracerSlots[this.tracerNext];
      this.tracerNext = (this.tracerNext + 1) % this.tracerSlots.length;
      slot.t = performance.now();
      if (own) {
        // Start at the viewmodel muzzle, converted to world space.
        slot.from.set(0.11, -0.1, -0.6).applyMatrix4(this.camera.matrixWorld);
      } else {
        slot.from.copy(this.characterMuzzle(who));
      }
      slot.to.set(to[0], to[1], to[2]);
      slot.color = own ? [1, 0.9, 0.6] : [1, 0.55, 0.4];
    });
    g.on('impact', ({ point, normal, melee }) => {
      if (!this.settings.showImpacts || melee) return;
      this.addDecal(point, normal);
      this.burst(point, normal, [0.35, 0.33, 0.3], 3, 1.5);
    });
    g.on('hit', ({ target, part, point, attacker }) => {
      const col = part === 'head' ? [1, 1, 1] : [0.85, 0.1, 0.15];
      this.burst(point, null, col, part === 'head' ? 10 : 6, 2.5);
      const ch = this.characters.get(target);
      if (ch) ch.flash = performance.now();
    });
    g.on('shot', ({ who, gun }) => {
      if (who === g.player) {
        this.vm.kick = Math.min(1.6, this.vm.kick + (gun.def.cat === 'Sniper' ? 1.4 : gun.def.cat === 'Shotgun' ? 1.1 : 0.5));
        this.vm.flashUntil = performance.now() + (gun.def.suppressed ? 25 : 40);
        this.vmFlashScale = gun.def.suppressed ? 0.06 : 0.12;
      } else if (!gun.def.suppressed) {
        const f = this.flashPool.find(x => x.until < performance.now()) || this.flashPool[0];
        f.s.position.copy(this.characterMuzzle(who));
        f.s.scale.setScalar(0.45);
        f.s.visible = true;
        f.until = performance.now() + 45;
      }
    });
    g.on('swing', ({ who, heavy }) => {
      if (who === g.player) { this.vm.swingStart = performance.now(); this.vm.swingHeavy = heavy; }
    });
    g.on('equip', ({ who, gun }) => {
      if (who === g.player) { this.vm.equipStart = performance.now(); this.vm.equipDur = gun.def.equip * 1000; }
    });
    g.on('kill', ({ victim, killer }) => {
      const ch = this.characters.get(victim);
      if (ch) ch.deathT = performance.now();
      if (victim === g.player) this.deathCam = { killer, yaw: g.player.yaw, pitch: g.player.pitch };
    });
    g.on('respawn', ({ who }) => {
      const ch = this.characters.get(who);
      if (ch) { ch.deathT = 0; ch.group.visible = true; ch.group.rotation.set(0, 0, 0); }
      if (who === g.player) this.deathCam = null;
    });
    g.on('start', () => this.syncCharacters());
  }

  setShadows(on) {
    this.renderer.shadowMap.enabled = on;
    for (const m of this.mapMaterials) m.needsUpdate = true;
    for (const ch of this.characters.values()) ch.group.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * (this.settings.renderScale || 1));
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.camera.aspect = this.vmCamera.aspect = this.aspect;
    this.vmCamera.updateProjectionMatrix();
  }

  // Vertical FOV from the fixed horizontal FOV and the current zoom.
  vfov(zoom = this.fovZoom) {
    return 2 * Math.atan(Math.tan((HFOV * DEG) / 2) / zoom / this.aspect);
  }

  syncCharacters() {
    for (const ch of this.characters.values()) this.scene.remove(ch.group);
    this.characters.clear();
    for (const c of this.game.combatants) {
      if (c === this.game.player) continue;
      this.characters.set(c, this.makeCharacter(c));
    }
  }

  makeCharacter(c) {
    const group = new THREE.Group();
    const col = new THREE.Color(c.color);
    const mk = (color) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color, emissive: 0x000000 }));
      m.castShadow = true;
      group.add(m);
      return m;
    };
    const legs = mk(col.clone().multiplyScalar(0.45));
    const body = mk(col);
    const head = mk(col.clone().lerp(new THREE.Color(0xffffff), 0.25));
    const gun = mk(0x24282e);
    const visor = mk(0x101318);
    this.scene.add(group);
    return { c, group, legs, body, head, gun, visor, flash: 0, deathT: 0 };
  }

  characterMuzzle(c) {
    const crouch = c.crouchAmount();
    const y = c.pos[1] + lerp(GUN_HEIGHT[0], GUN_HEIGHT[1], crouch);
    const f = [-Math.sin(c.yaw), -Math.cos(c.yaw)];
    const r = [Math.cos(c.yaw), -Math.sin(c.yaw)];
    return new THREE.Vector3(c.pos[0] + f[0] * 0.75 + r[0] * 0.18, y, c.pos[2] + f[1] * 0.75 + r[1] * 0.18);
  }

  addDecal(p, n) {
    const i = this.decalNext;
    this.decalNext = (i + 1) % this.decalTimes.length;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n[0], n[1], n[2]));
    const s = 0.055;
    m.compose(new THREE.Vector3(p[0] + n[0] * 0.004, p[1] + n[1] * 0.004, p[2] + n[2] * 0.004), q, new THREE.Vector3(s, s, s));
    this.decalMesh.setMatrixAt(i, m);
    this.decalMesh.instanceMatrix.needsUpdate = true;
    this.decalTimes[i] = performance.now();
  }

  clearDecals() {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.decalTimes.length; i++) { this.decalMesh.setMatrixAt(i, zero); this.decalTimes[i] = -1; }
    this.decalMesh.instanceMatrix.needsUpdate = true;
  }

  burst(p, n, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const s = this.sparkData[this.sparkNext];
      this.sparkNext = (this.sparkNext + 1) % this.sparkData.length;
      s.life = 0.25 + Math.random() * 0.2;
      s.p = [...p];
      const v = [Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5];
      if (n) { v[0] += n[0]; v[1] += n[1]; v[2] += n[2]; }
      s.v = v.map(x => x * speed);
      s.c = color;
    }
  }

  setViewmodel(kind) {
    if (this.vm.kind === kind) return;
    if (this.vm.model) this.vm.group.remove(this.vm.model);
    this.vm.model = gunModel(kind);
    this.vm.model.scale.setScalar(VM_SCALE);
    this.vm.model.userData.muzzle.add(this.vmFlash);
    this.vm.group.add(this.vm.model);
    this.vm.kind = kind;
  }

  render(alpha, dt, look) {
    const g = this.game, p = g.player;
    const now = performance.now();
    if (p) this.updateCamera(p, alpha, dt, look);
    this.updateCharacters(alpha, now);
    this.updateFx(dt, now);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (p && p.alive && this.vmVisible) {
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
    }
  }

  // Slow orbit over the map behind the main menu.
  renderIdle(t) {
    const cam = this.camera, a = t * 0.05;
    cam.position.set(Math.sin(a) * 34, 26, Math.cos(a) * 34);
    cam.lookAt(0, 0, 0);
    this.fovZoom = 1;
    cam.fov = this.vfov() / DEG;
    cam.updateProjectionMatrix();
    for (const ch of this.characters.values()) ch.group.visible = false;
    this.updateFx(0.016, performance.now());
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
  }

  updateCamera(p, alpha, dt, look) {
    const cam = this.camera;
    const gun = p.gun;
    const x = lerp(p.prevPos[0], p.pos[0], alpha);
    const z = lerp(p.prevPos[2], p.pos[2], alpha);
    const eyeY = lerp(p.prevEyeY, p.pos[1] + p.eyeOff + p.stepSmooth, alpha);
    cam.position.set(x, eyeY, z);
    if (!p.alive && this.deathCam) {
      // Death cam: turn to face whoever killed you.
      const k = this.deathCam.killer;
      if (k && k !== p) {
        const dx = k.pos[0] - x, dy = k.eye()[1] - eyeY, dz = k.pos[2] - z;
        const ty = Math.atan2(-dx, -dz), tp = Math.atan2(dy, Math.hypot(dx, dz));
        const f = 1 - Math.exp(-dt * 6);
        this.deathCam.yaw += Math.atan2(Math.sin(ty - this.deathCam.yaw), Math.cos(ty - this.deathCam.yaw)) * f;
        this.deathCam.pitch += (tp - this.deathCam.pitch) * f;
      }
      cam.rotation.set(this.deathCam.pitch, this.deathCam.yaw, 0);
      cam.position.y -= 0.6;
      this.fovZoom = 1;
    } else {
      cam.rotation.set(p.pitch + gun.offP * VIEW_RECOIL, p.yaw + gun.offY * VIEW_RECOIL, 0);
      const target = 1 + (gun.targetZoom() - 1) * gun.adsT;
      this.fovZoom += (target - this.fovZoom) * Math.min(1, dt * 30);
    }
    cam.fov = this.vfov() / DEG;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // Viewmodel
    const def = gun.def;
    const kind = def.model;
    this.setViewmodel(kind);
    const vm = this.vm;
    const scoped = gun.scoped();
    this.vmVisible = !scoped;
    const pose = VM_POSE[kind];
    const a = def.alt && (def.alt.type === 'zoom' || def.alt.type === 'zoomBurst' || def.alt.type === 'scope') ? gun.adsT : 0;
    let px = lerp(pose.hip[0], pose.ads[0], a), py = lerp(pose.hip[1], pose.ads[1], a), pz = lerp(pose.hip[2], pose.ads[2], a);
    let rx = 0, ry = 0, rz = 0;

    // Movement bob
    const sp = p.horizSpeed();
    if (p.grounded && sp > 0.3) vm.bob += dt * sp * 1.9;
    const bobAmt = Math.min(1, sp / 5.4) * (1 - a * 0.85);
    px += Math.cos(vm.bob) * 0.008 * bobAmt;
    py += Math.abs(Math.sin(vm.bob)) * 0.01 * bobAmt;
    if (!p.grounded) py += 0.015;

    // Sway against mouse movement
    vm.swayX = lerp(vm.swayX, -look.dx * 0.0006, Math.min(1, dt * 12));
    vm.swayY = lerp(vm.swayY, look.dy * 0.0006, Math.min(1, dt * 12));
    px += vm.swayX * (1 - a * 0.8);
    py += vm.swayY * (1 - a * 0.8);

    // Recoil kick
    vm.kick *= Math.exp(-dt * 14);
    pz += vm.kick * 0.035;
    rx += vm.kick * 0.06;

    // Equip / reload / knife swing
    const et = Math.min(1, (performance.now() - vm.equipStart) / Math.max(1, vm.equipDur));
    if (et < 1) { const e = 1 - Math.pow(1 - et, 3); py -= (1 - e) * 0.25; rx -= (1 - e) * 0.6; }
    if (gun.reloading) {
      const t = 1 - Math.max(0, gun.reloadEnd - this.game.time) / gun.reloadDur;
      const k = Math.sin(Math.min(1, t) * Math.PI);
      py -= k * 0.07; rz += k * 0.5; rx -= k * 0.25;
    }
    const st = (performance.now() - vm.swingStart) / (vm.swingHeavy ? 500 : 280);
    if (st >= 0 && st < 1) {
      const k = Math.sin(st * Math.PI);
      if (vm.swingHeavy) { px -= k * 0.14; rx += k * 0.4; ry += k * 0.9; }
      else { px -= k * 0.12; rz += k * 0.6; ry += k * 0.6; }
    }
    vm.group.position.set(px, py, pz);
    vm.group.rotation.set(rx, ry, rz);
    this.vmCamera.fov = 60;
    this.vmCamera.updateProjectionMatrix();

    const flashOn = performance.now() < vm.flashUntil;
    this.vmFlash.visible = flashOn;
    if (flashOn) { this.vmFlash.scale.setScalar(this.vmFlashScale * (0.8 + Math.random() * 0.4)); this.vmFlash.material.rotation = Math.random() * 6; }
  }

  updateCharacters(alpha, now) {
    for (const ch of this.characters.values()) {
      const c = ch.c;
      if (!c.alive) {
        if (ch.deathT) {
          const t = (now - ch.deathT) / 450;
          ch.group.rotation.x = -Math.min(1, t) * Math.PI / 2 * 0.9;
          if (t > 2.5) ch.group.visible = false;
        } else ch.group.visible = false;
        continue;
      }
      ch.group.visible = true;
      const x = lerp(c.prevPos[0], c.pos[0], alpha), y = lerp(c.prevPos[1], c.pos[1], alpha), z = lerp(c.prevPos[2], c.pos[2], alpha);
      ch.group.position.set(x, y, z);
      ch.group.rotation.set(0, c.yaw, 0);
      const cr = c.crouchAmount();
      const part = (mesh, name, shrink) => {
        const s = HITBOX.stand[name], k = HITBOX.crouch[name];
        const y0 = lerp(s[0], k[0], cr), y1 = lerp(s[1], k[1], cr), hw = lerp(s[2], k[2], cr) - shrink;
        mesh.position.set(0, (y0 + y1) / 2, 0);
        mesh.scale.set(hw * 2, (y1 - y0) - shrink, name === 'body' ? hw * 1.3 : hw * 2);
      };
      part(ch.legs, 'legs', 0.02);
      part(ch.body, 'body', 0.0);
      part(ch.head, 'head', 0.0);
      const hy = ch.head.position.y;
      ch.visor.position.set(0, hy + 0.02, -0.12);
      ch.visor.scale.set(0.2, 0.07, 0.04);
      ch.gun.position.set(0.17, lerp(GUN_HEIGHT[0], GUN_HEIGHT[1], cr), -0.35);
      ch.gun.scale.set(0.07, 0.1, 0.75);
      const hot = now - ch.flash < 80;
      for (const m of [ch.body, ch.head, ch.legs]) m.material.emissive.setHex(hot ? 0x553333 : 0x000000);
    }
  }

  updateFx(dt, now) {
    // tracers
    const pos = this.tracerLines.geometry.attributes.position, col = this.tracerLines.geometry.attributes.color;
    const life = 70;
    this.tracerSlots.forEach((s, i) => {
      const age = now - s.t;
      const a = age < life ? 1 - age / life : 0;
      if (a > 0) {
        // Draw a streak that travels along the path instead of a full-length beam.
        const t0 = Math.min(1, age / life * 1.4), t1 = Math.min(1, t0 + 0.35);
        const fx = lerp(s.from.x, s.to.x, t0 * 0.6), fy = lerp(s.from.y, s.to.y, t0 * 0.6), fz = lerp(s.from.z, s.to.z, t0 * 0.6);
        const tx = lerp(s.from.x, s.to.x, t1), ty = lerp(s.from.y, s.to.y, t1), tz = lerp(s.from.z, s.to.z, t1);
        pos.setXYZ(i * 2, fx, fy, fz);
        pos.setXYZ(i * 2 + 1, tx, ty, tz);
      } else {
        pos.setXYZ(i * 2, 0, -100, 0);
        pos.setXYZ(i * 2 + 1, 0, -100, 0);
      }
      col.setXYZW(i * 2, s.color[0], s.color[1], s.color[2], a * 0.15);
      col.setXYZW(i * 2 + 1, s.color[0], s.color[1], s.color[2], a * 0.9);
    });
    pos.needsUpdate = col.needsUpdate = true;

    // bullet holes fade out after the configured time
    const keep = (this.settings.impactSeconds || 6) * 1000;
    let dirty = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.decalTimes.length; i++) {
      if (this.decalTimes[i] > 0 && now - this.decalTimes[i] > keep) { this.decalMesh.setMatrixAt(i, zero); this.decalTimes[i] = -1; dirty = true; }
    }
    if (dirty) this.decalMesh.instanceMatrix.needsUpdate = true;

    for (const f of this.flashPool) if (f.s.visible && now > f.until) f.s.visible = false;

    const sp = this.sparks.geometry.attributes.position, sc = this.sparks.geometry.attributes.color;
    this.sparkData.forEach((s, i) => {
      if (s.life > 0) {
        s.life -= dt;
        s.v[1] -= 9 * dt;
        s.p[0] += s.v[0] * dt; s.p[1] += s.v[1] * dt; s.p[2] += s.v[2] * dt;
        sp.setXYZ(i, s.p[0], s.p[1], s.p[2]);
        sc.setXYZ(i, s.c[0], s.c[1], s.c[2]);
      } else sp.setXYZ(i, 0, -100, 0);
    });
    sp.needsUpdate = sc.needsUpdate = true;
  }

  // Screen position (CSS px) of a world point, or null when behind the camera.
  project(p) {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  }
}
