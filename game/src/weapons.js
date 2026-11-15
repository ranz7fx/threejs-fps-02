// weapons.js — weapon definitions, hitscan fire, recoil/spread, reload,
// and the two grenades (HE frag + smoke). Hit detection is ray vs the
// fighter's three body zones (head x4, torso x1, legs x0.75) — see state.js
// ZONES — checked against walls first so cover really protects.
import * as THREE from 'three';
import { ZONES } from './state.js';
import { rayVsAABB, rayVsWorld } from './world.js';

export const WEAPONS = {
  pistol: {
    name: 'Camar P9', kind: 'pistol', price: 0,
    damage: 26, headMult: 4, bodyMult: 1, legMult: 0.75,
    rpm: 360, auto: false, mag: 12, reserve: 36,
    reloadTime: 1.4, spread: 0.011, moveSpread: 0.02, bloom: 0.011,
    recoil: 0.011, range: 70, tracer: 0xffd27a,
  },
  smg: {
    name: 'Belibis SMG', kind: 'smg', price: 1500,
    damage: 22, headMult: 4, bodyMult: 1, legMult: 0.75,
    rpm: 720, auto: true, mag: 30, reserve: 90,
    reloadTime: 2.0, spread: 0.016, moveSpread: 0.028, bloom: 0.008,
    recoil: 0.008, range: 55, tracer: 0xffd27a,
  },
  rifle: {
    name: 'Kestrel AR', kind: 'rifle', price: 2700,
    damage: 33, headMult: 4, bodyMult: 1, legMult: 0.75,
    rpm: 600, auto: true, mag: 30, reserve: 90,
    reloadTime: 2.4, spread: 0.009, moveSpread: 0.026, bloom: 0.010,
    recoil: 0.014, range: 90, tracer: 0xffe9a8,
  },
};

export const GRENADE_PRICE = { he: 300, smoke: 300 };
export const ARMOR_PRICE = 650;
export const ARMOR_POINTS = 100;

// Current spread (radians) for a fighter: base + movement + bloom + crouch bonus.
export function currentSpread(f, def) {
  const speed = Math.hypot(f.vel.x, f.vel.z);
  const moving = Math.min(1, speed / 5);
  let s = def.spread + def.moveSpread * moving + f.spreadBloom;
  if (!f.onGround) s += 0.03;
  if (f.crouching) s *= 0.55;
  return s;
}

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();

// Ray vs one fighter's zones. Returns { t, zone } or null.
export function rayVsFighter(ox, oy, oz, dx, dy, dz, target, maxDist) {
  const crouch = target.crouching ? 0.72 : 1;
  const hw = 0.36;
  let best = null;
  for (const zoneName of ['head', 'torso', 'legs']) {
    const z = ZONES[zoneName];
    const y0 = target.pos.y + z.y0 * crouch;
    const y1 = target.pos.y + z.y1 * crouch;
    const t = rayVsAABB(ox, oy, oz, dx, dy, dz,
      target.pos.x - hw, y0, target.pos.z - hw,
      target.pos.x + hw, y1, target.pos.z + hw, maxDist);
    if (t >= 0 && (!best || t < best.t)) best = { t, zone: zoneName };
  }
  return best;
}

// Fire one hitscan shot from `shooter` along `yaw/pitch` (plus spread).
// Returns the hit record or null. Applies damage, emits events for the
// caller (audio, tracers, hitmarkers) via state.events.
export function fireShot(state, shooter, yaw, pitch, colliders, rng) {
  const def = WEAPONS[shooter.weapon];
  if (!def) return null;
  if (shooter.mag[shooter.weapon] <= 0) return { dry: true };
  shooter.mag[shooter.weapon] -= 1;
  shooter.lastShotAt = state.time;
  shooter.fireCooldown = 60 / def.rpm;

  // spread is measured before this shot's bloom is added: the first shot
  // from a cold barrel is the accurate one, follow-ups walk upward.
  const spread = currentSpread(shooter, def);
  shooter.spreadBloom = Math.min(0.06, shooter.spreadBloom + def.bloom);
  shooter.recoilPitch += def.recoil;
  const aYaw = yaw + (rng() * 2 - 1) * spread;
  const aPitch = pitch + (rng() * 2 - 1) * spread;
  const eyeY = shooter.pos.y + shooter.eyeHeight;
  _origin.set(shooter.pos.x, eyeY, shooter.pos.z);
  _dir.set(-Math.sin(aYaw) * Math.cos(aPitch), Math.sin(aPitch), -Math.cos(aYaw) * Math.cos(aPitch));

  const wallT = rayVsWorld(_origin.x, _origin.y, _origin.z, _dir.x, _dir.y, _dir.z, def.range, colliders);
  let bestT = wallT >= 0 ? wallT : def.range;
  let hit = null;
  for (const f of state.fighters) {
    if (f === shooter || !f.alive) continue;
    if (f.team === shooter.team) continue;
    const r = rayVsFighter(_origin.x, _origin.y, _origin.z, _dir.x, _dir.y, _dir.z, f, bestT);
    if (r && r.t < bestT) {
      bestT = r.t;
      hit = { fighter: f, zone: r.zone, t: r.t };
    }
  }
  const endX = _origin.x + _dir.x * bestT;
  const endY = _origin.y + _dir.y * bestT;
  const endZ = _origin.z + _dir.z * bestT;

  state.events.push({
    type: 'shot', shooterId: shooter.id, weapon: shooter.weapon,
    from: { x: _origin.x, y: _origin.y, z: _origin.z },
    to: { x: endX, y: endY, z: endZ }, tracer: def.tracer,
  });
  state.noise.push({ pos: shooter.pos.clone(), radius: 42, time: state.time, team: shooter.team });

  if (hit) {
    const zone = ZONES[hit.zone];
    const mult = hit.zone === 'head' ? def.headMult : hit.zone === 'legs' ? def.legMult : def.bodyMult;
    const dmg = Math.round(def.damage * mult);
    const killed = damageFighter(state, hit.fighter, dmg, shooter, hit.zone === 'head');
    state.events.push({
      type: 'hit', shooterId: shooter.id, victimId: hit.fighter.id,
      headshot: hit.zone === 'head', killed,
      at: { x: endX, y: endY, z: endZ },
    });
    return { hit, killed, end: { x: endX, y: endY, z: endZ } };
  }
  // wall impact spark
  if (wallT >= 0) {
    state.events.push({ type: 'impact', at: { x: endX, y: endY, z: endZ } });
  }
  return { end: { x: endX, y: endY, z: endZ } };
}

// Armor absorbs half of incoming damage until it runs out.
export function damageFighter(state, victim, dmg, attacker, headshot) {
  let remaining = dmg;
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, Math.ceil(dmg / 2));
    victim.armor -= absorbed;
    remaining = dmg - absorbed;
  }
  victim.hp -= remaining;
  if (attacker) {
    victim.lastDamageFrom = attacker.yaw;
    victim.lastDamageAt = state.time;
  }
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths += 1;
    if (attacker) {
      attacker.kills += 1;
      attacker.money += 300;
      if (attacker.isPlayer) state.events.push({ type: 'kill', victimId: victim.id, headshot });
    }
    state.killfeed.unshift({
      killer: attacker ? attacker.name : '—', victim: victim.name,
      killerTeam: attacker ? attacker.team : null, victimTeam: victim.team,
      headshot, time: state.time,
    });
    if (state.killfeed.length > 6) state.killfeed.pop();
    state.events.push({ type: 'death', victimId: victim.id });
    return true;
  }
  return false;
}

export function startReload(state, f) {
  const def = WEAPONS[f.weapon];
  if (!def || f.reloading) return;
  if (f.mag[f.weapon] >= def.mag) return;
  if ((f.reserve[f.weapon] || 0) <= 0) return;
  f.reloading = true;
  f.reloadEndsAt = state.time + def.reloadTime;
  state.events.push({ type: 'reloadStart', fighterId: f.id });
}

export function finishReload(state, f) {
  const def = WEAPONS[f.weapon];
  if (!def) return;
  const need = def.mag - f.mag[f.weapon];
  const take = Math.min(need, f.reserve[f.weapon] || 0);
  f.mag[f.weapon] += take;
  f.reserve[f.weapon] -= take;
  f.reloading = false;
  state.events.push({ type: 'reloadDone', fighterId: f.id });
}

// ---- grenades: simple ballistic projectiles, bounced off colliders ----
export function makeGrenade(state, thrower, kind, yaw, pitch) {
  const eyeY = thrower.pos.y + thrower.eyeHeight;
  const dir = new THREE.Vector3(
    -Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch) + 0.35, -Math.cos(yaw) * Math.cos(pitch)
  ).normalize();
  return {
    kind, ownerId: thrower.id,
    pos: new THREE.Vector3(thrower.pos.x, eyeY - 0.15, thrower.pos.z),
    vel: dir.multiplyScalar(13).add(new THREE.Vector3(thrower.vel.x * 0.6, 0, thrower.vel.z * 0.6)),
    fuse: kind === 'he' ? 1.6 : 1.2,
    bounces: 0,
    alive: true,
  };
}

export function stepGrenade(g, dt, colliders, state) {
  if (!g.alive) return;
  g.fuse -= dt;
  g.vel.y -= 14 * dt;
  const before = g.pos.clone();
  g.pos.addScaledVector(g.vel, dt);
  // floor bounce
  if (g.pos.y < 0.12) { g.pos.y = 0.12; g.vel.y = Math.abs(g.vel.y) * 0.45; g.vel.x *= 0.7; g.vel.z *= 0.7; g.bounces++; }
  // wall bounce (cheap: clamp against colliders, flip the velocity component)
  for (const c of colliders) {
    if (g.pos.x > c.min.x - 0.1 && g.pos.x < c.max.x + 0.1 &&
        g.pos.y > c.min.y && g.pos.y < c.max.y &&
        g.pos.z > c.min.z - 0.1 && g.pos.z < c.max.z + 0.1) {
      const dxMin = Math.abs(g.pos.x - c.min.x), dxMax = Math.abs(g.pos.x - c.max.x);
      const dzMin = Math.abs(g.pos.z - c.min.z), dzMax = Math.abs(g.pos.z - c.max.z);
      const m = Math.min(dxMin, dxMax, dzMin, dzMax);
      if (m === dxMin || m === dxMax) g.vel.x *= -0.45;
      else g.vel.z *= -0.45;
      g.pos.copy(before);
      g.bounces++;
      break;
    }
  }
  if (g.fuse <= 0) {
    g.alive = false;
    if (g.kind === 'he') explodeHE(state, g, colliders);
    else state.events.push({ type: 'smoke', at: { x: g.pos.x, y: g.pos.y + 0.4, z: g.pos.z } });
  }
}

function explodeHE(state, g, colliders) {
  const owner = state.fighters.find((f) => f.id === g.ownerId) || null;
  state.events.push({ type: 'explosion', at: { x: g.pos.x, y: g.pos.y, z: g.pos.z } });
  state.noise.push({ pos: g.pos.clone(), radius: 55, time: state.time, team: owner ? owner.team : null });
  for (const f of state.fighters) {
    if (!f.alive) continue;
    const d = f.pos.distanceTo(g.pos);
    if (d > 9) continue;
    // cover blocks the blast
    const blocked = rayVsWorld(g.pos.x, g.pos.y + 0.3, g.pos.z,
      (f.pos.x - g.pos.x) / (d || 1), ((f.pos.y + 1) - (g.pos.y + 0.3)) / (d || 1),
      (f.pos.z - g.pos.z) / (d || 1), d, colliders) >= 0;
    if (blocked) continue;
    const dmg = Math.round(95 * (1 - d / 10));
    if (dmg > 0) damageFighter(state, f, dmg, owner, false);
  }
}
