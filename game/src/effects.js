// effects.js — tracers, muzzle flashes, impact sparks, explosions and
// smoke. All pools are preallocated and reused: nothing is allocated in
// the hot loop except tiny plain event objects the sim already made.
import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_SPARKS = 8;
const MAX_SMOKE = 6;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerIdx = 0;

    // muzzle flash: one additive sprite reused for every shot
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffc46b, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), flashMat);
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashLife = 0;

    // impact sparks: small point clouds, reused
    this.sparks = [];
    for (let i = 0; i < MAX_SPARKS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30), 3));
      const mat = new THREE.PointsMaterial({ color: 0xffd27a, size: 0.14, transparent: true, opacity: 0 });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.visible = false;
      scene.add(pts);
      this.sparks.push({ pts, life: 0, vel: new Float32Array(30) });
    }
    this.sparkIdx = 0;

    // smoke puffs: soft sprites from a generated radial texture
    this.smokeTex = makeSmokeTexture();
    this.smokes = [];
    for (let i = 0; i < MAX_SMOKE; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.smokeTex, color: 0xcfc8b8, transparent: true, opacity: 0, depthWrite: false });
      const spr = new THREE.Sprite(mat);
      spr.scale.set(7, 7, 1);
      spr.visible = false;
      scene.add(spr);
      this.smokes.push({ spr, life: 0 });
    }
    this.smokeIdx = 0;

    // bomb beacon: pulsing amber light + marker over the planted bomb
    this.beacon = new THREE.PointLight(0xf0a830, 0, 14, 1.5);
    scene.add(this.beacon);
    this.beaconMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.3, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x22201c, emissive: 0xf0a830, emissiveIntensity: 1.2 })
    );
    this.beaconMesh.visible = false;
    scene.add(this.beaconMesh);
  }

  tracer(from, to, color) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % MAX_TRACERS;
    const p = t.line.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x; p[4] = to.y; p[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color || 0xffe9a8);
    t.line.material.opacity = 0.9;
    t.line.visible = true;
    t.life = 0.07;
  }

  muzzle(at, yaw, pitch) {
    const dx = -Math.sin(yaw) * Math.cos(pitch);
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * Math.cos(pitch);
    this.flash.position.set(at.x + dx * 0.7, at.y + dy * 0.7 - 0.05, at.z + dz * 0.7);
    this.flash.lookAt(at.x + dx * 3, at.y + dy * 3, at.z + dz * 3);
    this.flash.material.opacity = 0.95;
    this.flash.visible = true;
    this.flashLife = 0.05;
  }

  impact(at) {
    const s = this.sparks[this.sparkIdx];
    this.sparkIdx = (this.sparkIdx + 1) % MAX_SPARKS;
    const p = s.pts.geometry.attributes.position.array;
    for (let i = 0; i < 10; i++) {
      p[i * 3] = at.x; p[i * 3 + 1] = at.y; p[i * 3 + 2] = at.z;
      s.vel[i * 3] = (Math.random() - 0.5) * 4;
      s.vel[i * 3 + 1] = Math.random() * 3;
      s.vel[i * 3 + 2] = (Math.random() - 0.5) * 4;
    }
    s.pts.geometry.attributes.position.needsUpdate = true;
    s.pts.material.opacity = 1;
    s.pts.visible = true;
    s.life = 0.35;
  }

  explosion(at) {
    this.impact(at);
    const s = this.sparks[this.sparkIdx];
    this.sparkIdx = (this.sparkIdx + 1) % MAX_SPARKS;
    const p = s.pts.geometry.attributes.position.array;
    for (let i = 0; i < 10; i++) {
      p[i * 3] = at.x; p[i * 3 + 1] = at.y + 0.3; p[i * 3 + 2] = at.z;
      s.vel[i * 3] = (Math.random() - 0.5) * 9;
      s.vel[i * 3 + 1] = Math.random() * 7;
      s.vel[i * 3 + 2] = (Math.random() - 0.5) * 9;
    }
    s.pts.geometry.attributes.position.needsUpdate = true;
    s.pts.material.opacity = 1;
    s.pts.visible = true;
    s.life = 0.7;
    this.flash.position.set(at.x, at.y + 0.5, at.z);
    this.flash.scale.set(4, 4, 1);
    this.flash.material.opacity = 1;
    this.flash.visible = true;
    this.flashLife = 0.18;
  }

  smoke(at) {
    const s = this.smokes[this.smokeIdx];
    this.smokeIdx = (this.smokeIdx + 1) % MAX_SMOKE;
    s.spr.position.set(at.x, at.y + 0.6, at.z);
    s.spr.material.opacity = 0.85;
    s.spr.visible = true;
    s.life = 12;
  }

  setBombBeacon(pos, visible, pulse) {
    this.beaconMesh.visible = visible;
    if (!visible) { this.beacon.intensity = 0; return; }
    this.beaconMesh.position.set(pos.x, pos.y + 0.2, pos.z);
    this.beacon.position.set(pos.x, pos.y + 1, pos.z);
    this.beacon.intensity = 2 + Math.sin(pulse * 6) * 1.2;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flash.material.opacity = Math.max(0, this.flashLife / 0.18);
      if (this.flashLife <= 0) { this.flash.visible = false; this.flash.scale.set(1, 1, 1); }
    }
    for (const s of this.sparks) {
      if (s.life > 0) {
        s.life -= dt;
        const p = s.pts.geometry.attributes.position.array;
        for (let i = 0; i < 10; i++) {
          p[i * 3] += s.vel[i * 3] * dt;
          p[i * 3 + 1] += s.vel[i * 3 + 1] * dt;
          p[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
          s.vel[i * 3 + 1] -= 9 * dt;
        }
        s.pts.geometry.attributes.position.needsUpdate = true;
        s.pts.material.opacity = Math.max(0, s.life / 0.7);
        if (s.life <= 0) s.pts.visible = false;
      }
    }
    for (const s of this.smokes) {
      if (s.life > 0) {
        s.life -= dt;
        s.spr.material.opacity = Math.max(0, Math.min(0.85, s.life / 3));
        const sc = 7 + (12 - s.life) * 0.35;
        s.spr.scale.set(sc, sc, 1);
        if (s.life <= 0) s.spr.visible = false;
      }
    }
  }
}

function makeSmokeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}
