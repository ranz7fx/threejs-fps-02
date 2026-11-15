// bots.js — the nine bot brains. One state machine per bot:
// move (follow a waypoint path) -> hold (watch a choke) -> combat (shoot a
// seen enemy) -> plant / defuse (the objective) -> investigate (a heard shot).
// Bots see through line of sight + distance + field of view, react after a
// human-like delay, and shoot in bursts with limited accuracy so fights
// stay fair. Attackers push a site and plant; defenders hold sites and
// rotate when the bomb goes down.
import * as THREE from 'three';
import { TEAM_ATK, TEAM_DEF, PLANT_TIME, DEFUSE_TIME } from './state.js';
import { WAYPOINTS, findPath, nearestWaypoint, segmentBlocked, moveBox } from './world.js';
import { WEAPONS, fireShot, startReload, finishReload } from './weapons.js';

const BOT_SPEED = 3.9;
const SIGHT_RANGE = 55;
const FOV_COS = Math.cos(1.05); // ~120 deg total field of view
const REACT_MIN = 0.35, REACT_MAX = 0.75;

export function makeBotBrain(role, site) {
  return {
    role, site,                       // 'A' or 'B'
    mode: 'move',                     // move | hold | combat | plant | defuse | investigate
    path: [], pathIdx: 0,
    holdUntil: 0,
    enemy: null, lastSeen: null,      // THREE.Vector3
    lastSeenAt: -10, reactAt: 0,
    aimErrYaw: 0, aimErrPitch: 0,
    burstLeft: 0, burstPauseUntil: 0,
    plantProgress: 0, defuseProgress: 0,
    investigatePos: null,
    strafeDir: 1, strafeUntil: 0,
    holdNode: -1,
  };
}

const _toEnemy = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _chest = new THREE.Vector3();

// Can `bot` see `foe` right now? Distance + FOV + clear line of sight.
export function canSee(bot, foe, colliders) {
  _toEnemy.set(foe.pos.x - bot.pos.x, (foe.pos.y + 1.1) - (bot.pos.y + bot.eyeHeight), foe.pos.z - bot.pos.z);
  const dist = _toEnemy.length();
  if (dist > SIGHT_RANGE) return false;
  _toEnemy.multiplyScalar(1 / dist);
  const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
  if (_toEnemy.x * fx + _toEnemy.z * fz < FOV_COS && dist > 4) return false;
  _eye.set(bot.pos.x, bot.pos.y + bot.eyeHeight, bot.pos.z);
  _chest.set(foe.pos.x, foe.pos.y + 1.1, foe.pos.z);
  return !segmentBlocked(_eye.x, _eye.y, _eye.z, _chest.x, _chest.y, _chest.z, colliders);
}

function nearestVisibleEnemy(state, bot, colliders) {
  let best = null, bestD = Infinity;
  for (const f of state.fighters) {
    if (!f.alive || f.team === bot.team) continue;
    const d = f.pos.distanceTo(bot.pos);
    if (d >= bestD) continue;
    if (canSee(bot, f, colliders)) { best = f; bestD = d; }
  }
  return best;
}

function setPath(bot, fromNode, toNode) {
  bot.path = findPath(fromNode, toNode);
  bot.pathIdx = 0;
}

function faceToward(bot, x, z, dt, rate) {
  const want = Math.atan2(-(x - bot.pos.x), -(z - bot.pos.z));
  let diff = want - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  bot.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
}

function walkToward(bot, tx, tz, dt, colliders, speed) {
  const dx = tx - bot.pos.x, dz = tz - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return true;
  const vx = (dx / d) * speed, vz = (dz / d) * speed;
  bot.vel.x += (vx - bot.vel.x) * Math.min(1, dt * 8);
  bot.vel.z += (vz - bot.vel.z) * Math.min(1, dt * 8);
  faceToward(bot, tx, tz, dt, 6);
  const res = moveBox(bot.pos, bot.vel.x * dt, 0, bot.vel.z * dt, 0.35, 1.7, colliders);
  if (res.hitX && res.hitZ) { bot.vel.x = 0; bot.vel.z = 0; }
  return d < 0.6;
}

function stopBot(bot, dt) {
  bot.vel.x += (0 - bot.vel.x) * Math.min(1, dt * 10);
  bot.vel.z += (0 - bot.vel.z) * Math.min(1, dt * 10);
}

function aimAt(bot, target, rng) {
  const dx = target.pos.x - bot.pos.x;
  const dy = (target.pos.y + 1.15) - (bot.pos.y + bot.eyeHeight);
  const dz = target.pos.z - bot.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  const errScale = 0.02 + dist * 0.0011; // worse with distance
  const yaw = Math.atan2(-dx, -dz) + (rng() * 2 - 1) * errScale + bot.bot.aimErrYaw;
  const pitch = Math.atan2(dy, Math.hypot(dx, dz)) + (rng() * 2 - 1) * errScale * 0.7 + bot.bot.aimErrPitch;
  return { yaw, pitch };
}

function tryShoot(state, bot, dt, colliders, rng) {
  const def = WEAPONS[bot.weapon];
  if (!def) return;
  bot.fireCooldown = Math.max(0, bot.fireCooldown - dt);
  if (bot.reloading) {
    if (state.time >= bot.reloadEndsAt) finishReload(state, bot);
    return;
  }
  if (bot.mag[bot.weapon] <= 0) { startReload(state, bot); return; }
  if (state.time < bot.bot.burstPauseUntil) return;
  if (bot.bot.burstLeft <= 0) {
    bot.bot.burstLeft = 3 + Math.floor(rng() * 3);
    bot.bot.burstPauseUntil = state.time + 0.45 + rng() * 0.5;
    return;
  }
  if (bot.fireCooldown > 0) return;
  const aim = aimAt(bot, bot.bot.enemy, rng);
  const before = bot.mag[bot.weapon];
  fireShot(state, bot, aim.yaw, aim.pitch, colliders, rng);
  if (bot.mag[bot.weapon] < before) bot.bot.burstLeft -= 1;
}

export function stepBot(state, bot, dt, colliders, rng) {
  const brain = bot.bot;
  if (!bot.alive) return;
  bot.spreadBloom = Math.max(0, bot.spreadBloom - dt * 0.05);
  bot.recoilPitch *= Math.pow(0.001, dt);

  // ---- perception ----
  const seen = nearestVisibleEnemy(state, bot, colliders);
  if (seen) {
    if (brain.enemy !== seen) {
      brain.enemy = seen;
      brain.reactAt = state.time + REACT_MIN + rng() * (REACT_MAX - REACT_MIN);
      brain.aimErrYaw = (rng() * 2 - 1) * 0.03;
      brain.aimErrPitch = (rng() * 2 - 1) * 0.02;
    }
    brain.lastSeen = seen.pos.clone();
    brain.lastSeenAt = state.time;
  } else if (brain.enemy && state.time - brain.lastSeenAt > 2.5) {
    brain.enemy = null;
  }

  // ---- hearing: a recent enemy gunshot nearby pulls bots to look ----
  if (!brain.enemy && brain.mode !== 'plant' && brain.mode !== 'defuse') {
    for (let i = state.noise.length - 1; i >= 0; i--) {
      const n = state.noise[i];
      if (state.time - n.time > 0.6) continue;
      if (n.team === bot.team) continue;
      if (n.pos.distanceTo(bot.pos) > n.radius) continue;
      if (brain.mode !== 'investigate' || !brain.investigatePos ||
          brain.investigatePos.distanceTo(n.pos) > 6) {
        brain.mode = 'investigate';
        brain.investigatePos = n.pos.clone();
        setPath(bot, nearestWaypoint(bot.pos.x, bot.pos.z), nearestWaypoint(n.pos.x, n.pos.z));
      }
      break;
    }
  }

  // ---- combat overrides movement ----
  if (brain.enemy && state.time >= brain.reactAt) {
    const foe = brain.enemy;
    if (brain.mode === 'move' || brain.mode === 'hold' || brain.mode === 'investigate') {
      brain.mode = 'combat';
    }
    if (brain.mode === 'combat') {
      // strafe a little while shooting so the bot is not a statue
      if (state.time > brain.strafeUntil) {
        brain.strafeDir = rng() < 0.5 ? -1 : 1;
        brain.strafeUntil = state.time + 0.7 + rng() * 0.8;
      }
      const side = brain.strafeDir;
      const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
      const px = -fz * side, pz = fx * side;
      const dist = foe.pos.distanceTo(bot.pos);
      if (dist > 14) {
        walkToward(bot, foe.pos.x, foe.pos.z, dt, colliders, BOT_SPEED * 0.85);
      } else {
        walkToward(bot, bot.pos.x + px * 2, bot.pos.z + pz * 2, dt, colliders, BOT_SPEED * 0.5);
      }
      faceToward(bot, foe.pos.x, foe.pos.z, dt, 9);
      tryShoot(state, bot, dt, colliders, rng);
      return;
    }
  }

  // ---- objective modes ----
  if (brain.mode === 'plant') {
    stopBot(bot, dt);
    brain.plantProgress += dt;
    state.bomb.plantProgress = Math.min(1, brain.plantProgress / PLANT_TIME);
    state.bomb.planterId = bot.id;
    if (brain.plantProgress >= PLANT_TIME) {
      state.bomb.state = 'planted';
      state.bomb.site = brain.site;
      state.bomb.timer = 45;
      state.bomb.pos.set(bot.pos.x, 0.1, bot.pos.z);
      state.bomb.plantProgress = 0;
      state.events.push({ type: 'planted', site: brain.site, byId: bot.id });
      brain.mode = 'hold';
      brain.holdUntil = state.time + 999;
    }
    return;
  }
  if (brain.mode === 'defuse') {
    stopBot(bot, dt);
    brain.defuseProgress += dt;
    state.bomb.defuseProgress = Math.min(1, brain.defuseProgress / DEFUSE_TIME);
    state.bomb.defuserId = bot.id;
    if (brain.defuseProgress >= DEFUSE_TIME) {
      state.bomb.state = 'defused';
      state.events.push({ type: 'defused', byId: bot.id });
    }
    return;
  }

  // ---- bomb planted: defenders converge, attackers guard the site ----
  if (state.bomb.state === 'planted') {
    if (bot.team === TEAM_DEF) {
      const b = state.bomb.pos;
      const d = Math.hypot(b.x - bot.pos.x, b.z - bot.pos.z);
      if (d > 1.6) {
        if (brain.mode !== 'move' || brain.holdNode !== -1) {
          setPath(bot, nearestWaypoint(bot.pos.x, bot.pos.z), nearestWaypoint(b.x, b.z));
          brain.mode = 'move';
          brain.holdNode = -1;
        }
      } else {
        // nearest defender defuses, the rest hold angles
        const others = state.fighters.filter((f) => f.alive && f.team === TEAM_DEF && f.bot && f !== bot &&
          Math.hypot(f.pos.x - b.x, f.pos.z - b.z) < d);
        if (others.length === 0 && !state.bomb.defuserId) {
          brain.mode = 'defuse';
          brain.defuseProgress = 0;
        } else {
          brain.mode = 'hold';
          brain.holdUntil = state.time + 4;
          faceToward(bot, bot.pos.x - Math.sin(bot.yaw) * 5, bot.pos.z - Math.cos(bot.yaw) * 5, dt, 4);
        }
      }
    } else {
      // attackers: fall back to a hold near the planted site
      const siteNode = brain.site === 'A' ? 13 : 18;
      if (brain.holdNode !== siteNode) {
        setPath(bot, nearestWaypoint(bot.pos.x, bot.pos.z), siteNode);
        brain.mode = 'move';
        brain.holdNode = siteNode;
      }
    }
  }

  // ---- movement / holding ----
  if (brain.mode === 'move') {
    if (brain.pathIdx >= brain.path.length) {
      // arrived
      if (bot.team === TEAM_ATK && state.bomb.carrierId === bot.id &&
          state.bomb.state === 'carried' && onSite(bot, brain.site)) {
        brain.mode = 'plant';
        brain.plantProgress = 0;
        state.events.push({ type: 'plantStart', byId: bot.id });
      } else if (bot.team === TEAM_ATK && state.bomb.state === 'carried' && state.bomb.carrierId === bot.id) {
        // carrier reached the wrong end: re-path to its site
        setPath(bot, nearestWaypoint(bot.pos.x, bot.pos.z), brain.site === 'A' ? 13 : 18);
      } else {
        brain.mode = 'hold';
        brain.holdUntil = state.time + (bot.team === TEAM_DEF ? 999 : 6 + rng() * 4);
        brain.holdNode = brain.path.length ? brain.path[brain.path.length - 1] : -1;
      }
      stopBot(bot, dt);
      return;
    }
    const node = WAYPOINTS[brain.path[brain.pathIdx]];
    if (walkToward(bot, node.x, node.z, dt, colliders, BOT_SPEED)) brain.pathIdx += 1;
    return;
  }
  if (brain.mode === 'hold') {
    stopBot(bot, dt);
    // look down the lane: face the map centre / the enemy approach
    const lookX = bot.team === TEAM_DEF ? bot.pos.x - 10 : bot.pos.x + 10;
    faceToward(bot, lookX, bot.pos.z, dt, 2.5);
    if (state.time > brain.holdUntil && bot.team === TEAM_ATK && state.bomb.state === 'carried') {
      // attackers who waited too long push on
      setPath(bot, nearestWaypoint(bot.pos.x, bot.pos.z), brain.site === 'A' ? 13 : 18);
      brain.mode = 'move';
    }
    return;
  }
  if (brain.mode === 'investigate') {
    if (brain.pathIdx >= brain.path.length) {
      brain.mode = 'hold';
      brain.holdUntil = state.time + 3;
      return;
    }
    const node = WAYPOINTS[brain.path[brain.pathIdx]];
    if (walkToward(bot, node.x, node.z, dt, colliders, BOT_SPEED)) brain.pathIdx += 1;
  }
}

function onSite(bot, site) {
  const s = site === 'A'
    ? { x0: 18, x1: 30, z0: -20, z1: -12 }
    : { x0: 18, x1: 30, z0: 12, z1: 20 };
  return bot.pos.x >= s.x0 && bot.pos.x <= s.x1 && bot.pos.z >= s.z0 && bot.pos.z <= s.z1;
}

export { onSite };

// Sync a bot's 3D mesh with its simulated body (called from main render).
export function syncBotMesh(bot, dt) {
  if (!bot.mesh) return;
  bot.mesh.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
  bot.mesh.rotation.y = bot.yaw;
  bot.mesh.visible = bot.alive;
  const parts = bot.mesh.userData.parts;
  if (!parts) return;
  // simple walk swing on the legs
  const speed = Math.hypot(bot.vel.x, bot.vel.z);
  const swing = Math.sin(bot.pos.x * 0.4 + bot.pos.z * 0.4 + performance.now() * 0.001 * speed);
  const amp = Math.min(0.5, speed * 0.12);
  parts.legL.rotation.x = swing * amp;
  parts.legR.rotation.x = -swing * amp;
  // crouch pose
  const crouchK = bot.crouching ? 0.78 : 1;
  bot.mesh.scale.y = crouchK;
}
