// world.js — the SALTLINE map, collision, line of sight and waypoints.
// The map is an original salt-terminal yard: three west-east lanes (north,
// mid, south), site A in the north-east corner, site B in the south-east,
// attacker spawn west, defender spawn east. Everything is three.js geometry
// with the palette from palette.js; no external assets.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Map bounds (metres). Playable floor: x in [-32, 32], z in [-22, 22].
export const MAP = { minX: -32, maxX: 32, minZ: -22, maxZ: 22 };

// [cx, cz, w, d, h, material] — every solid box in the map.
const BOXES = [
  // perimeter (h 5, thick enough to read as terminal walls)
  [0, -22.8, 67, 1.6, 5, 'concrete'],
  [0, 22.8, 67, 1.6, 5, 'concrete'],
  [-32.8, 0, 1.6, 47, 5, 'concrete'],
  [32.8, 0, 1.6, 47, 5, 'concrete'],
  // mid divider: two blocks leave a 16 m choke at z -8..8 (mid lane)
  [0, -15, 1.4, 14, 4, 'sand'],
  [0, 15, 1.4, 14, 4, 'sand'],
  // north lane divider (z -11), gaps at x -6..6 and near the ends
  [-15, -11, 18, 1.2, 3, 'concrete'],
  [15, -11, 18, 1.2, 3, 'concrete'],
  // south lane divider (z +11), same gaps
  [-15, 11, 18, 1.2, 3, 'concrete'],
  [15, 11, 18, 1.2, 3, 'concrete'],
  // salt silos — tall cylinders read as boxes for collision, round in view
  [-29.5, -17, 5, 5, 7, 'salt'],
  [-29.5, 17, 5, 5, 7, 'salt'],
  // site A structures: rusted gantry strip + crates (lane at z -16 kept clear)
  [22, -19.5, 6, 1.4, 3.2, 'rust'],
  [27, -18, 2, 2, 1.2, 'sand'],
  [19, -14, 3, 3, 1.4, 'sand'],
  // site B structures: teal container strip + crates (lane at z 16 kept clear)
  [22, 19.5, 6, 1.4, 3.2, 'teal'],
  [27, 18, 2, 2, 1.2, 'sand'],
  [19, 14, 3, 3, 1.4, 'sand'],
  // mid-lane cover crates
  [-8, -6.5, 2.4, 2.4, 1.6, 'sand'],
  [-8, 3.5, 2.4, 2.4, 1.1, 'sandDark'],
  [8, 2.5, 2.4, 2.4, 1.6, 'sand'],
  [8, -3.5, 2.4, 2.4, 1.1, 'sandDark'],
  [3, 3.5, 1.6, 1.6, 1.2, 'rust'],
  // north lane cover (kept off the z -16 lane line)
  [-14, -19, 3, 1.6, 1.5, 'sand'],
  [4, -18.5, 2.4, 2.4, 1.4, 'sandDark'],
  [12, -7, 2, 2, 1.3, 'sand'],
  // south lane cover (kept off the z 16 lane line)
  [-14, 19, 3, 1.6, 1.5, 'sand'],
  [4, 18.5, 2.4, 2.4, 1.4, 'sandDark'],
  [12, 7, 2, 2, 1.3, 'sand'],
  // spawn cover
  [-30, -6, 2, 2, 1.4, 'sand'],
  [-30, 6, 2, 2, 1.4, 'sand'],
  [30, -6, 2, 2, 1.4, 'teal'],
  [30, 6, 2, 2, 1.4, 'teal'],
  // long sightline blocker mid-east
  [16, 0, 1.4, 6, 2.8, 'concrete'],
];

const MATERIALS = {
  salt: () => new THREE.MeshStandardMaterial({ color: PALETTE.salt, roughness: 0.95 }),
  sand: () => new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 0.85 }),
  sandDark: () => new THREE.MeshStandardMaterial({ color: PALETTE.sandDark, roughness: 0.9 }),
  concrete: () => new THREE.MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.95 }),
  rust: () => new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.7, metalness: 0.35 }),
  teal: () => new THREE.MeshStandardMaterial({ color: PALETTE.teal, roughness: 0.6, metalness: 0.3 }),
  tealDark: () => new THREE.MeshStandardMaterial({ color: PALETTE.tealDark, roughness: 0.6, metalness: 0.3 }),
  ink: () => new THREE.MeshStandardMaterial({ color: PALETTE.ink, roughness: 0.5, metalness: 0.5 }),
};

export const SITES = {
  A: { name: 'A', cx: 24, cz: -16, w: 12, d: 8, color: PALETTE.amber },
  B: { name: 'B', cx: 24, cz: 16, w: 12, d: 8, color: PALETTE.teal },
};

export const SPAWNS = {
  atk: [
    [-28, -4], [-28, 0], [-28, 4], [-24, -6], [-24, 6],
  ],
  def: [
    [28, -4], [28, 0], [28, 4], [24, -6], [24, 6],
  ],
};

// Waypoint graph for bot routes. Nodes are (x, z); edges are neighbour ids.
// Every edge was checked against the wall/crate boxes above: no edge crosses
// a solid box, and no node sits inside one. Lane crossings use the gaps:
// z -11 / z 11 dividers gap at x -6..6 (west) and x 24..32 (east); the mid
// divider gaps at z -8..8; the mid-east blocker at x 16 is bypassed via
// nodes 20/21 at z -6 / 6.
export const WAYPOINTS = [
  { x: -28, z: 0, e: [1, 2, 3] },        // 0 atk spawn
  { x: -25, z: -16, e: [0, 4] },         // 1 north west
  { x: -22, z: 0, e: [0, 5] },           // 2 mid west
  { x: -25, z: 16, e: [0, 6] },          // 3 south west
  { x: -10, z: -16, e: [1, 7] },         // 4 north mid-west
  { x: -10, z: 0, e: [2, 8, 9] },        // 5 mid west
  { x: -10, z: 16, e: [3, 11] },         // 6 south mid-west
  { x: -3, z: -16, e: [4, 8] },          // 7 north gap west
  { x: -3, z: -8, e: [7, 5, 9] },        // 8 mid north-west
  { x: 0, z: 0, e: [8, 5, 15, 10] },      // 9 mid choke
  { x: -3, z: 8, e: [11, 9] },           // 10 mid south-west
  { x: -3, z: 16, e: [6, 10] },          // 11 south gap west
  { x: 10, z: -16, e: [13] },            // 12 north mid-east
  { x: 24, z: -16, e: [12, 14] },        // 13 site A
  { x: 28, z: -8, e: [13, 22, 16] },     // 14 east gap north
  { x: 10, z: 0, e: [9, 20, 21] },       // 15 mid east
  { x: 28, z: 0, e: [14, 19, 22] },      // 16 def spawn
  { x: 10, z: 16, e: [18] },             // 17 south mid-east
  { x: 24, z: 16, e: [17, 19] },         // 18 site B
  { x: 28, z: 8, e: [18, 16, 22] },      // 19 east gap south
  { x: 16, z: -6, e: [15, 22] },         // 20 mid-east north bypass
  { x: 16, z: 6, e: [15, 22] },          // 21 mid-east south bypass
  { x: 20, z: 0, e: [20, 21, 14, 19, 16] }, // 22 mid far east
];

// Breadth-first shortest path over the waypoint graph. Returns node ids.
export function findPath(from, to) {
  if (from === to) return [from];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of WAYPOINTS[cur].e) {
      if (prev[nb] === -1) {
        prev[nb] = cur;
        if (nb === to) {
          const path = [to];
          let n = to;
          while (n !== from) { n = prev[n]; path.unshift(n); }
          return path;
        }
        queue.push(nb);
      }
    }
  }
  return [from, to];
}

export function nearestWaypoint(x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i].x - x, dz = WAYPOINTS[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ---- collision: slab ray vs AABB, shared by shooting, sight and grenades ----
export function rayVsAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, maxDist) {
  let tmin = 0, tmax = maxDist;
  // X slab
  if (Math.abs(dx) < 1e-9) { if (ox < minX || ox > maxX) return -1; }
  else {
    let t1 = (minX - ox) / dx, t2 = (maxX - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < minY || oy > maxY) return -1; }
  else {
    let t1 = (minY - oy) / dy, t2 = (maxY - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < minZ || oz > maxZ) return -1; }
  else {
    let t1 = (minZ - oz) / dz, t2 = (maxZ - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// Nearest world hit distance along a ray, or -1. Colliders are {min,max} Vector3s.
export function rayVsWorld(ox, oy, oz, dx, dy, dz, maxDist, colliders) {
  let best = -1;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const t = rayVsAABB(ox, oy, oz, dx, dy, dz, c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z, maxDist);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

// True when the straight segment a->b is blocked by any collider.
const _segDir = new THREE.Vector3();
export function segmentBlocked(ax, ay, az, bx, by, bz, colliders) {
  _segDir.set(bx - ax, by - ay, bz - az);
  const len = _segDir.length();
  if (len < 1e-6) return false;
  _segDir.multiplyScalar(1 / len);
  const t = rayVsWorld(ax, ay, az, _segDir.x, _segDir.y, _segDir.z, len, colliders);
  return t >= 0 && t < len - 0.05;
}

// Move a feet-based AABB (halfW wide, height tall) by delta, axis by axis,
// sliding along walls. Mutates pos. Returns {hitX, hitZ, onGround}.
export function moveBox(pos, dx, dy, dz, halfW, height, colliders) {
  const res = { hitX: false, hitZ: false, onGround: false };
  // X axis
  pos.x += dx;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (overlaps(pos, halfW, height, c)) {
      if (dx > 0) pos.x = c.min.x - halfW - 0.001;
      else if (dx < 0) pos.x = c.max.x + halfW + 0.001;
      res.hitX = true;
    }
  }
  // Z axis
  pos.z += dz;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (overlaps(pos, halfW, height, c)) {
      if (dz > 0) pos.z = c.min.z - halfW - 0.001;
      else if (dz < 0) pos.z = c.max.z + halfW + 0.001;
      res.hitZ = true;
    }
  }
  // Y axis
  pos.y += dy;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (overlaps(pos, halfW, height, c)) {
      if (dy < 0) { pos.y = c.max.y; res.onGround = true; }
      else if (dy > 0) { pos.y = c.min.y - height - 0.001; }
    }
  }
  if (pos.y <= 0) { pos.y = 0; res.onGround = true; }
  // keep inside the yard
  if (pos.x < MAP.minX + halfW) { pos.x = MAP.minX + halfW; res.hitX = true; }
  if (pos.x > MAP.maxX - halfW) { pos.x = MAP.maxX - halfW; res.hitX = true; }
  if (pos.z < MAP.minZ + halfW) { pos.z = MAP.minZ + halfW; res.hitZ = true; }
  if (pos.z > MAP.maxZ - halfW) { pos.z = MAP.maxZ - halfW; res.hitZ = true; }
  return res;
}

function overlaps(pos, halfW, height, c) {
  return pos.x + halfW > c.min.x && pos.x - halfW < c.max.x &&
    pos.y + height > c.min.y && pos.y < c.max.y &&
    pos.z + halfW > c.min.z && pos.z - halfW < c.max.z;
}

function letterTexture(letter, bg) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#efe8d8';
  g.font = 'bold 84px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildWorld(scene) {
  const colliders = [];
  const mats = {};
  for (const key of Object.keys(MATERIALS)) mats[key] = MATERIALS[key]();

  // ground: pale salt flats with a subtle grid of darker salt pans
  const groundMat = new THREE.MeshStandardMaterial({ color: PALETTE.salt, roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 50), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // darker salt-pan strips for lane readability
  const panMat = new THREE.MeshStandardMaterial({ color: 0xcfc2a2, roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const pan = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 44), panMat);
    pan.rotation.x = -Math.PI / 2;
    pan.position.set(-26 + i * 13, 0.01, 0);
    pan.receiveShadow = true;
    scene.add(pan);
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const [cx, cz, w, d, h, key] of BOXES) {
    const mesh = new THREE.Mesh(boxGeo, mats[key]);
    mesh.scale.set(w, h, d);
    mesh.position.set(cx, h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push({
      min: new THREE.Vector3(cx - w / 2, 0, cz - d / 2),
      max: new THREE.Vector3(cx + w / 2, h, cz + d / 2),
    });
  }

  // salt silos: round towers on the west boxes (visual only, box covers collision)
  const siloMat = new THREE.MeshStandardMaterial({ color: 0xf2ecdd, roughness: 0.8, metalness: 0.15 });
  for (const [sx, sz] of [[-29.5, -17], [-29.5, 17]]) {
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 7, 20), siloMat);
    silo.position.set(sx, 3.5, sz);
    silo.castShadow = true;
    scene.add(silo);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.4, 20), mats.rust);
    cap.position.set(sx, 7.7, sz);
    cap.castShadow = true;
    scene.add(cap);
  }

  // site pads + floating letter signs
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(s.w, s.d),
      new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.9, transparent: true, opacity: 0.35 })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(s.cx, 0.02, s.cz);
    pad.receiveShadow = true;
    scene.add(pad);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3),
      new THREE.MeshBasicMaterial({ map: letterTexture(key, key === 'A' ? '#8a5a10' : '#123f3d'), transparent: true })
    );
    sign.position.set(s.cx, 4.6, s.cz);
    scene.add(sign);
    // amber lamp posts over each site
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.4, 8), mats.ink);
    pole.position.set(s.cx - s.w / 2 + 0.6, 2.2, s.cz - s.d / 2 + 0.6);
    scene.add(pole);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 10),
      new THREE.MeshBasicMaterial({ color: PALETTE.amber })
    );
    lamp.position.set(s.cx - s.w / 2 + 0.6, 4.5, s.cz - s.d / 2 + 0.6);
    scene.add(lamp);
  }

  // dawn sky dome: pale cream overhead, warm amber haze at the horizon.
  // A flat background colour left the top half of every frame empty; the
  // gradient gives the map a sky that reads at a glance from any lane.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 256;
  const sg = skyCanvas.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#f6e3bd');    // zenith: pale cream
  grad.addColorStop(0.38, '#f0c887'); // upper sky: dawn peach
  grad.addColorStop(0.5, '#e59a4e');  // at the horizon: amber glow
  grad.addColorStop(0.62, '#d9b57e'); // just below the horizon: warm haze
  grad.addColorStop(1, '#cbb489');    // below the horizon (hidden by ground)
  sg.fillStyle = grad; sg.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(180, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
  );
  scene.add(sky);

  // lighting: low dawn sun + sky bounce, thin haze fog. Fog starts past
  // the far wall's distance from most lanes so the map's far side still
  // reads instead of washing out into the haze.
  scene.fog = new THREE.Fog(PALETTE.fog, 70, 170);
  const hemi = new THREE.HemisphereLight(0xffe6b8, 0x9a8a6e, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc46b, 2.2);
  sun.position.set(-30, 28, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fd8d0, 0.5);
  fill.position.set(25, 18, 20);
  scene.add(fill);

  return { colliders, sites: SITES, spawns: SPAWNS };
}

// ---- fighter presentation: simple readable humanoid from boxes ----
const BOT_COLORS = { atk: PALETTE.teamAtk, def: PALETTE.teamDef };
export function makeFighterMesh(team) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: BOT_COLORS[team], roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: PALETTE.ink, roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: 0.9 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.78, 0.24), dark);
  legL.position.set(-0.14, 0.39, 0);
  const legR = legL.clone(); legR.position.x = 0.14;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.6, 0.34), suit);
  torso.position.set(0, 1.08, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), skin);
  head.position.set(0, 1.56, 0);
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.36), dark);
  helmet.position.set(0, 1.72, 0);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), dark);
  gun.position.set(0.2, 1.15, 0.42);
  for (const m of [legL, legR, torso, head, helmet, gun]) { m.castShadow = true; group.add(m); }
  group.userData.parts = { legL, legR, torso, head, helmet, gun };
  group.userData.suitMat = suit;
  return group;
}

// First-person viewmodel: a low-poly rifle held at the bottom-right of view.
export function makeViewmodel() {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x453f39, roughness: 0.45, metalness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ color: PALETTE.sandDark, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.62), metal);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), metal);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.44);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), wood);
  grip.position.set(0, -0.15, 0.12); grip.rotation.x = 0.35;
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.09), metal);
  mag.position.set(0, -0.16, -0.08); mag.rotation.x = 0.2;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.12), metal);
  sight.position.set(0, 0.1, -0.05);
  for (const m of [body, barrel, grip, mag, sight]) group.add(m);
  group.position.set(0.28, -0.26, -0.5);
  return group;
}
