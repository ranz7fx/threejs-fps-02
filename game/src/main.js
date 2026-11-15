// main.js — boot + the fixed-step loop. Simulation ticks at 60 Hz, apart
// from rendering: input is consumed once per tick, bots and the player move,
// rounds advance, and the frame only draws the result. Nothing in the hot
// loop allocates per frame except the small event records the sim already
// made; tracers, sparks and smoke come from preallocated pools.
import * as THREE from 'three';
import { createState, TICK, TEAM_ATK, TEAM_DEF } from './state.js';
import { buildWorld, makeFighterMesh, makeViewmodel } from './world.js';
import { PALETTE } from './palette.js';
import { createInput } from './input.js';
import { stepPlayer, updateCamera } from './player.js';
import { stepBot, syncBotMesh } from './bots.js';
import { makeGrenade, stepGrenade } from './weapons.js';
import {
  createFighters, setupRound, stepRounds, buyWeapon, buyGrenade, buyArmor,
  resetMatch,
} from './rounds.js';
import { HUD } from './hud.js';
import { Synth } from './audio.js';
import { Effects } from './effects.js';

const state = createState();
const rng = Math.random;

// ---- renderer / scene ----
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 220);
scene.add(camera);
// small warm fill light on the camera so the viewmodel gun reads instead
// of sitting black in the spawn wall's shadow (range 2 m: it never
// reaches the map's walls from the lanes).
const vmLight = new THREE.PointLight(0xffe2b0, 0.4, 2, 2);
vmLight.position.set(0.25, 0.35, 0.1);
camera.add(vmLight);
const world = buildWorld(scene);
const effects = new Effects(scene);
const synth = new Synth();

// first-person viewmodel
const viewmodel = makeViewmodel();
camera.add(viewmodel);

// grenade meshes (small pool, reused)
const grenadeMeshes = [];
for (let i = 0; i < 6; i++) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.5, metalness: 0.4 })
  );
  m.visible = false;
  m.castShadow = true;
  scene.add(m);
  grenadeMeshes.push(m);
}
const grenades = []; // live grenade sim objects, parallel to grenadeMeshes

// ---- input / HUD ----
let prevFiring = false;
let buyOpen = false;
const inputApi = createInput(state, renderer.domElement, (locked) => {
  // pointer lock lost mid-match: pause unless the buy menu is open
  if (!locked && (state.phase === 'live' || state.phase === 'buy') && !buyOpen) {
    hud.showMenu('Paused', 'Pointer lock was lost. Click to jump back into the round.', 'Click to resume');
  }
});

const hud = new HUD({
  onPlay: () => {
    synth.ensure();
    if (state.phase === 'menu') {
      createFighters(state);
      for (const f of state.fighters) {
        if (f.isPlayer) continue;
        f.mesh = makeFighterMesh(f.team);
        scene.add(f.mesh);
      }
      setupRound(state, rng);
      hud.showBanner('Round 1 — Salt Terminal', 'Attackers plant at A or B. First to 8 rounds.', 4);
    }
    hud.hideMenu();
    hud.hideMatchEnd();
    inputApi.lock();
  },
  onAgain: () => {
    synth.ensure();
    resetMatch(state, rng);
    recolorBotMeshes();
    hud.hideMatchEnd();
    hud.showBanner('Round 1 — Salt Terminal', 'Fresh match. First to 8 rounds.', 4);
    inputApi.lock();
  },
  onBuy: (kind) => {
    let ok = false;
    if (kind === 'rifle' || kind === 'smg') ok = buyWeapon(state, kind);
    else if (kind === 'he' || kind === 'smoke') ok = buyGrenade(state, kind);
    else if (kind === 'armor') ok = buyArmor(state);
    if (ok) synth.buy();
  },
  onBuyClose: () => { setBuyOpen(false); inputApi.lock(); },
});

function recolorBotMeshes() {
  for (const f of state.fighters) {
    if (!f.mesh) continue;
    const suit = f.mesh.userData.suitMat;
    if (suit) suit.color.setHex(f.team === TEAM_ATK ? PALETTE.teamAtk : PALETTE.teamDef);
  }
}

function setBuyOpen(open) {
  buyOpen = open;
  hud.showBuy(open);
  if (open) inputApi.unlock();
}

// weapon slot keys 1-3; G throws a grenade (HE first, then smoke)
function switchWeapon(slot) {
  const player = state.fighters[0];
  if (!player || !player.alive) return;
  const order = ['pistol', 'smg', 'rifle'];
  const id = order[slot - 1];
  if (id && player.owned[id] && player.weapon !== id) {
    player.weapon = id;
    player.reloading = false;
  }
}

function throwGrenade() {
  const player = state.fighters[0];
  if (!player || !player.alive || state.phase !== 'live') return;
  const kind = player.grenades.he > 0 ? 'he' : player.grenades.smoke > 0 ? 'smoke' : null;
  if (!kind) return;
  player.grenades[kind] -= 1;
  const g = makeGrenade(state, player, kind, player.yaw, player.pitch);
  const mesh = grenadeMeshes.find((m) => !m.visible);
  if (mesh) {
    g.mesh = mesh;
    mesh.visible = true;
    mesh.position.copy(g.pos);
  }
  grenades.push(g);
  state.events.push({ type: 'throw', fighterId: player.id, kind });
}

// ---- event drain: sim events -> sound + visuals, once per tick ----
function drainEvents() {
  const player = state.fighters[0];
  if (!player) { state.events.length = 0; return; }
  for (const ev of state.events) {
    switch (ev.type) {
      case 'shot': {
        effects.tracer(ev.from, ev.to, ev.tracer);
        const shooter = state.fighters.find((f) => f.id === ev.shooterId);
        const d = shooter && player ? shooter.pos.distanceTo(player.pos) : 0;
        synth.shot(ev.weapon, shooter === player ? 0 : d);
        if (shooter === player) effects.muzzle(ev.from, player.yaw, player.pitch);
        break;
      }
      case 'hit': {
        if (ev.shooterId === player.id) {
          hud.flashHitmarker(ev.headshot);
          synth.hit(ev.headshot);
        }
        if (ev.victimId === player.id) synth.hurt();
        break;
      }
      case 'kill': if (player) synth.kill(); break;
      case 'dryfire': if (ev.fighterId === player.id) synth.dryfire(); break;
      case 'reloadStart': if (ev.fighterId === player.id) synth.reload(); break;
      case 'impact': effects.impact(ev.at); break;
      case 'explosion': effects.explosion(ev.at); synth.explosion(); break;
      case 'smoke': effects.smoke(ev.at); break;
      case 'planted':
        synth.plantBeep();
        hud.showBanner('Bomb planted — Site ' + ev.site, player.team === TEAM_DEF ? 'Defuse it before it blows!' : 'Guard the bomb.', 4);
        break;
      case 'defused':
        synth.defuseBeep();
        hud.showBanner('Bomb defused', '', 3);
        break;
      case 'roundStart':
        hud.showBanner('Round ' + ev.round, state.phase === 'live' ? 'Fight!' : '', 2.5);
        break;
      case 'roundEnd': {
        const won = player.team === ev.winner;
        hud.showBanner(won ? 'Round won' : 'Round lost', ev.reason, 3.5);
        if (won) synth.roundWin(); else synth.roundLose();
        break;
      }
      case 'matchEnd': {
        const won = player.team === ev.winner;
        hud.showMatchEnd(won, 'Final score  ' + state.score.atk + ' – ' + state.score.def);
        inputApi.unlock();
        break;
      }
      case 'buy': synth.buy(); break;
      case 'halfSwap':
        hud.showBanner('Sides swapped', 'You are now ' + (ev.playerTeam === TEAM_ATK ? 'attacking' : 'defending') + '.', 4);
        recolorBotMeshes();
        break;
      default: break;
    }
  }
  state.events.length = 0;
  // prune old noise so bots stop investigating stale gunshots
  for (let i = state.noise.length - 1; i >= 0; i--) {
    if (state.time - state.noise[i].time > 1.2) state.noise.splice(i, 1);
  }
}

// ---- fixed-step simulation ----
let spread = 0.01;
function tick(dt) {
  state.time += dt;
  const consumed = inputApi.consume();
  state.input.useHeld = consumed.useHeld;
  const fireEdge = state.input.firing && !prevFiring;
  prevFiring = state.input.firing;

  if (consumed.buy && state.phase === 'buy') setBuyOpen(!buyOpen);
  if (consumed.slot) switchWeapon(consumed.slot);
  if (consumed.grenade) throwGrenade();

  stepRounds(state, dt, rng);

  const player = state.fighters[0];
  if (player && player.alive && (state.phase === 'buy' || state.phase === 'live')) {
    const simInput = {
      ...state.input,
      reload: consumed.reload, jump: consumed.jump, use: consumed.use,
      look: consumed.look, fireEdge,
    };
    spread = stepPlayer(state, player, dt, world.colliders, simInput, rng);
  }

  if (state.phase === 'live') {
    for (const f of state.fighters) {
      if (!f.isPlayer && f.bot) stepBot(state, f, dt, world.colliders, rng);
    }
  }

  // grenades fly in every phase (a throw mid-buy still lands)
  for (let i = grenades.length - 1; i >= 0; i--) {
    stepGrenade(grenades[i], dt, world.colliders, state);
    if (!grenades[i].alive) {
      if (grenades[i].mesh) grenades[i].mesh.visible = false;
      grenades.splice(i, 1);
    }
  }

  drainEvents();
}

// ---- render ----
let lastNow = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - lastNow);
  lastNow = now;
  acc += dtMs / 1000;
  let steps = 0;
  while (acc >= TICK && steps < 4) {
    tick(TICK);
    acc -= TICK;
    steps += 1;
  }
  if (steps === 4) acc = 0;

  const player = state.fighters[0];
  if (player) {
    updateCamera(camera, player, dtMs / 1000, spread);
    // viewmodel kick + bob follow the player's recoil and movement
    viewmodel.position.z = -0.5 + player.recoilPitch * 1.6;
    viewmodel.position.y = -0.26 + Math.sin(now * 0.012) * 0.004 * Math.min(1, Math.hypot(player.vel.x, player.vel.z) / 5);
    viewmodel.visible = player.alive && state.phase !== 'menu';
  }
  for (const f of state.fighters) {
    if (!f.isPlayer && f.mesh) syncBotMesh(f, dtMs / 1000);
  }
  for (let i = 0; i < grenades.length; i++) {
    if (grenades[i].mesh) grenades[i].mesh.position.copy(grenades[i].pos);
  }
  const b = state.bomb;
  effects.setBombBeacon(b.pos, b.state === 'planted', state.time);
  effects.update(dtMs / 1000);
  if (player) hud.update(state, player, spread, dtMs / 1000);
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

hud.showMenu(
  'SALTLINE',
  'A tactical FPS at a salt terminal at dawn. Five attackers, five defenders, one bomb. Plant it at site A or B — or eliminate the other team. First to 8 rounds takes the match.',
  'Click to play'
);
requestAnimationFrame(frame);
