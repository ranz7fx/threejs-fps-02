// rounds.js — round flow, economy, buy menu logic, bomb carrier, and the
// player's own plant / defuse. One round: 15 s buy phase, 100 s live,
// then a 4 s banner. First to 8 rounds wins (max 15, + overtime on a tie);
// sides swap after round 7.
import * as THREE from 'three';
import {
  TEAM_ATK, TEAM_DEF, BUY_TIME, ROUND_TIME, BOMB_TIME, PLANT_TIME, DEFUSE_TIME,
  WIN_ROUNDS, MAX_ROUNDS, START_MONEY, WIN_REWARD, LOSS_REWARD,
  LOSS_STREAK_BONUS, MAX_LOSS_REWARD, makeFighter,
} from './state.js';
import { WEAPONS, GRENADE_PRICE, ARMOR_PRICE, ARMOR_POINTS } from './weapons.js';
import { SPAWNS, SITES, findPath } from './world.js';
import { makeBotBrain } from './bots.js';

const ATK_NAMES = ['Rani', 'Bimo', 'Sari', 'Dedi'];
const DEF_NAMES = ['Wulan', 'Agus', 'Tari', 'Joko', 'Lestari'];
const ROUND_END_PAUSE = 4;

export function createFighters(state) {
  // 5v5: the player + 4 allies vs 5 opponents. Rosters are fixed per side
  // so the killfeed stays readable; sides swap at half-time.
  state.fighters = [];
  state.nextFighterId = 1;
  const player = makeFighter(state.nextFighterId++, 'You', state.playerTeam, true);
  state.fighters.push(player);
  const allyTeam = state.playerTeam;
  const foeTeam = allyTeam === TEAM_ATK ? TEAM_DEF : TEAM_ATK;
  const allyNames = allyTeam === TEAM_ATK ? ATK_NAMES : DEF_NAMES;
  const foeNames = foeTeam === TEAM_ATK ? ATK_NAMES : DEF_NAMES;
  for (let i = 0; i < 4; i++) {
    state.fighters.push(makeFighter(state.nextFighterId++, allyNames[i], allyTeam, false));
  }
  for (let i = 0; i < 5; i++) {
    state.fighters.push(makeFighter(state.nextFighterId++, foeNames[i], foeTeam, false));
  }
  return state.fighters;
}

function botLoadout(round, rng) {
  if (round <= 1) return 'pistol';
  if (round === 2) return rng() < 0.6 ? 'smg' : 'pistol';
  return rng() < 0.7 ? 'rifle' : 'smg';
}

function giveWeapon(f, id) {
  const def = WEAPONS[id];
  f.owned[id] = true;
  f.weapon = id;
  f.mag[id] = def.mag;
  f.reserve[id] = def.reserve;
}

// (Re)spawn everyone for a round. Survivors keep their guns; the dead
// rebuy from scratch with a pistol.
export function setupRound(state, rng) {
  const player = state.fighters[0];
  const survived = player.alive;
  for (const f of state.fighters) {
    f.alive = true;
    f.hp = 100;
    f.vel.set(0, 0, 0);
    f.reloading = false;
    f.spreadBloom = 0;
    f.recoilPitch = 0;
    f.fireCooldown = 0;
    f.lastDamageFrom = null;
    const spawnList = SPAWNS[f.team];
    const spot = spawnList[(f.id - 1) % spawnList.length];
    f.pos.set(spot[0], 0, spot[1]);
    f.yaw = f.team === TEAM_ATK ? -Math.PI / 2 : Math.PI / 2;
    f.pitch = 0;
    f.crouching = false;
    f.height = 1.7;
    f.eyeHeight = 1.62;
    if (f.isPlayer) {
      if (!survived || state.round === 1) {
        f.owned = { pistol: true };
        f.mag = {}; f.reserve = {};
        f.grenades = { he: 0, smoke: 0 };
        f.armor = 0;
        giveWeapon(f, 'pistol');
      }
    } else {
      const loadout = botLoadout(state.round, rng);
      f.owned = { pistol: true };
      f.mag = {}; f.reserve = {};
      f.grenades = { he: 0, smoke: 0 };
      f.armor = 0;
      giveWeapon(f, loadout);
      // bot brains: bots split across the two sites
      const site = f.id % 2 === 0 ? 'A' : 'B';
      f.bot = makeBotBrain(f.team, site);
      f.bot.mode = 'move';
      const fromNode = f.team === TEAM_ATK ? 0 : 16;
      const toNode = site === 'A' ? 13 : 18;
      f.bot.path = findPath(fromNode, toNode);
      f.bot.pathIdx = 0;
    }
  }
  // bomb carrier: usually a bot, sometimes the player
  const attackers = state.fighters.filter((f) => f.team === TEAM_ATK && f.alive);
  const carrier = rng() < 0.3 ? player : attackers[Math.floor(rng() * attackers.length)];
  state.bomb = {
    state: 'carried', carrierId: carrier ? carrier.id : null, site: null,
    pos: carrier ? carrier.pos.clone() : new THREE.Vector3(),
    timer: 0, plantProgress: 0, planterId: null, defuseProgress: 0, defuserId: null,
  };
  state.phase = 'buy';
  state.phaseTime = 0;
  state.roundWinner = null;
  state.roundReason = '';
  state.events.push({ type: 'roundSetup', round: state.round, carrierId: state.bomb.carrierId });
}

export function roundTimeLeft(state) {
  if (state.phase === 'buy') return BUY_TIME - state.phaseTime;
  if (state.phase === 'live') return Math.max(0, ROUND_TIME - state.phaseTime);
  return 0;
}

function aliveCount(state, team) {
  return state.fighters.filter((f) => f.alive && f.team === team).length;
}

function endRound(state, winner, reason) {
  state.phase = 'roundEnd';
  state.phaseTime = 0;
  state.roundWinner = winner;
  state.roundReason = reason;
  state.score[winner] += 1;
  const loser = winner === TEAM_ATK ? TEAM_DEF : TEAM_ATK;
  state.lossStreak[loser] += 1;
  state.lossStreak[winner] = 0;
  const player = state.fighters[0];
  const playerWon = player.team === winner;
  const lossBonus = Math.min(
    MAX_LOSS_REWARD,
    LOSS_REWARD + LOSS_STREAK_BONUS * (state.lossStreak[player.team] - 1)
  );
  player.money += playerWon ? WIN_REWARD : lossBonus;
  state.events.push({ type: 'roundEnd', winner, reason });
  // bomb carrier drops the bomb when the round ends
  state.bomb.state = 'idle';
  state.bomb.carrierId = null;
}

function matchOver(state) {
  if (state.score.atk >= WIN_ROUNDS || state.score.def >= WIN_ROUNDS) return true;
  if (state.round >= MAX_ROUNDS && state.score.atk !== state.score.def) return true;
  return false;
}

export function stepRounds(state, dt, rng) {
  state.phaseTime += dt;
  const player = state.fighters[0];

  if (state.phase === 'buy') {
    if (state.phaseTime >= BUY_TIME) {
      state.phase = 'live';
      state.phaseTime = 0;
      state.events.push({ type: 'roundStart', round: state.round });
    }
    return;
  }

  if (state.phase === 'live') {
    // bomb carrier died: the bomb passes to a living attacker
    if (state.bomb.state === 'carried') {
      const carrier = state.fighters.find((f) => f.id === state.bomb.carrierId);
      if (!carrier || !carrier.alive) {
        const alive = state.fighters.filter((f) => f.alive && f.team === TEAM_ATK);
        if (alive.length) {
          state.bomb.carrierId = alive[Math.floor(rng() * alive.length)].id;
          state.events.push({ type: 'bombPickup', carrierId: state.bomb.carrierId });
        } else {
          state.bomb.state = 'idle';
          state.bomb.carrierId = null;
        }
      }
    }
    // planted bomb ticks down
    if (state.bomb.state === 'planted') {
      state.bomb.timer -= dt;
      if (state.bomb.timer <= 0) {
        state.bomb.state = 'exploded';
        state.events.push({ type: 'exploded', site: state.bomb.site });
        endRound(state, TEAM_ATK, 'Bomb detonated at site ' + state.bomb.site);
        return;
      }
    }
    if (state.bomb.state === 'defused') {
      endRound(state, TEAM_DEF, 'Bomb defused');
      return;
    }
    // elimination wins
    if (aliveCount(state, TEAM_ATK) === 0) { endRound(state, TEAM_DEF, 'Attackers eliminated'); return; }
    if (aliveCount(state, TEAM_DEF) === 0) { endRound(state, TEAM_ATK, 'Defenders eliminated'); return; }
    // time out: defenders win unless the bomb is planted
    if (state.phaseTime >= ROUND_TIME && state.bomb.state !== 'planted') {
      endRound(state, TEAM_DEF, 'Time expired — site held');
      return;
    }
    // the player's own plant / defuse (hold E)
    stepPlayerObjective(state, player, dt);
    return;
  }

  if (state.phase === 'roundEnd') {
    if (state.phaseTime >= ROUND_END_PAUSE) {
      if (matchOver(state)) {
        state.phase = 'matchEnd';
        state.phaseTime = 0;
        state.matchWinner = state.score.atk > state.score.def ? TEAM_ATK : TEAM_DEF;
        state.events.push({ type: 'matchEnd', winner: state.matchWinner });
      } else {
        state.round += 1;
        if (state.round === 8 && !state.halfSwapped) {
          state.halfSwapped = true;
          state.playerTeam = state.playerTeam === TEAM_ATK ? TEAM_DEF : TEAM_ATK;
          // rebuild rosters on the swapped side
          for (const f of state.fighters) {
            f.team = f.isPlayer ? state.playerTeam
              : (f.team === TEAM_ATK ? TEAM_DEF : TEAM_ATK);
          }
          state.events.push({ type: 'halfSwap', playerTeam: state.playerTeam });
        }
        setupRound(state, rng);
      }
    }
  }
}

function inSite(pos, siteKey) {
  const s = SITES[siteKey];
  return pos.x >= s.cx - s.w / 2 && pos.x <= s.cx + s.w / 2 &&
    pos.z >= s.cz - s.d / 2 && pos.z <= s.cz + s.d / 2;
}

function stepPlayerObjective(state, player, dt) {
  const b = state.bomb;
  if (!player.alive) { b.plantProgress = 0; b.defuseProgress = 0; return; }
  const holdingE = state.input.useHeld;
  // plant: player carries the bomb and stands in a site
  if (b.state === 'carried' && b.carrierId === player.id && player.team === TEAM_ATK) {
    const site = inSite(player.pos, 'A') ? 'A' : inSite(player.pos, 'B') ? 'B' : null;
    if (site && holdingE) {
      b.plantProgress += dt / PLANT_TIME;
      b.planterId = player.id;
      if (b.plantProgress >= 1) {
        b.state = 'planted';
        b.site = site;
        b.timer = BOMB_TIME;
        b.pos.set(player.pos.x, 0.1, player.pos.z);
        b.plantProgress = 0;
        state.events.push({ type: 'planted', site, byId: player.id });
      }
      return;
    }
    b.plantProgress = 0;
    return;
  }
  // defuse: bomb planted, player defends, stands by the bomb
  if (b.state === 'planted' && player.team === TEAM_DEF) {
    const d = Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z);
    if (d < 2.2 && holdingE) {
      b.defuseProgress += dt / DEFUSE_TIME;
      b.defuserId = player.id;
      if (b.defuseProgress >= 1) {
        b.state = 'defused';
        b.defuseProgress = 0;
        state.events.push({ type: 'defused', byId: player.id });
      }
      return;
    }
    b.defuseProgress = 0;
  }
}

// ---- buy menu: only during the buy phase, only with cash on hand ----
export function buyWeapon(state, id) {
  const player = state.fighters[0];
  const def = WEAPONS[id];
  if (!def || state.phase !== 'buy') return false;
  if (player.owned[id] || player.money < def.price) return false;
  player.money -= def.price;
  giveWeapon(player, id);
  state.events.push({ type: 'buy', item: def.name });
  return true;
}

export function buyGrenade(state, kind) {
  const player = state.fighters[0];
  if (state.phase !== 'buy') return false;
  if (player.money < GRENADE_PRICE[kind]) return false;
  if (player.grenades[kind] >= 2) return false;
  player.money -= GRENADE_PRICE[kind];
  player.grenades[kind] += 1;
  state.events.push({ type: 'buy', item: kind === 'he' ? 'HE grenade' : 'Smoke grenade' });
  return true;
}

export function buyArmor(state) {
  const player = state.fighters[0];
  if (state.phase !== 'buy') return false;
  if (player.money < ARMOR_PRICE || player.armor >= ARMOR_POINTS) return false;
  player.money -= ARMOR_PRICE;
  player.armor = ARMOR_POINTS;
  state.events.push({ type: 'buy', item: 'Kevlar vest' });
  return true;
}

export function resetMatch(state, rng) {
  state.round = 1;
  state.score = { atk: 0, def: 0 };
  state.lossStreak = { atk: 0, def: 0 };
  state.playerTeam = TEAM_ATK;
  state.halfSwapped = false;
  state.matchWinner = null;
  state.killfeed = [];
  for (const f of state.fighters) {
    f.money = START_MONEY;
    f.kills = 0; f.deaths = 0;
  }
  setupRound(state, rng);
}
