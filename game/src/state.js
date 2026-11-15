// state.js — the single source of truth for the whole match.
// Every module reads and writes this one object; nothing else keeps
// match-level state. Fixed-step simulation ticks it at 60 Hz (see main.js).
import * as THREE from 'three';

export const TICK = 1 / 60;
export const ROUND_TIME = 100;      // seconds of live play per round
export const BUY_TIME = 15;         // seconds of buy phase before a round
export const BOMB_TIME = 45;        // seconds from plant to detonation
export const PLANT_TIME = 3;        // seconds to plant
export const DEFUSE_TIME = 5;       // seconds to defuse
export const WIN_ROUNDS = 8;        // first to 8 takes the match
export const MAX_ROUNDS = 15;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;
export const MAX_LOSS_REWARD = 3400;

export const TEAM_ATK = 'atk';
export const TEAM_DEF = 'def';

export function createState() {
  return {
    // match flow
    phase: 'menu',           // menu | buy | live | roundEnd | matchEnd
    phaseTime: 0,            // seconds spent in the current phase
    round: 1,
    score: { atk: 0, def: 0 },
    lossStreak: { atk: 0, def: 0 },
    playerTeam: TEAM_ATK,   // player starts as attacker; sides swap at half
    halfSwapped: false,
    roundWinner: null,       // 'atk' | 'def' | null
    roundReason: '',
    matchWinner: null,
    time: 0,                 // total simulated seconds

    // bomb objective
    bomb: {
      state: 'idle',         // idle | carried | planted | defused | exploded
      carrierId: null,       // combatant id holding the bomb
      site: null,            // 'A' | 'B'
      pos: new THREE.Vector3(),
      timer: 0,              // counts down once planted
      plantProgress: 0,      // 0..1 while someone plants
      planterId: null,
      defuseProgress: 0,
      defuserId: null,
    },

    // combatants: index 0 is always the player
    fighters: [],
    nextFighterId: 1,

    // transient per-tick events, consumed by main.js (audio + effects + HUD)
    events: [],              // { type, ... } — shot, hit, kill, reload, plant, ...
    noise: [],               // { pos: Vector3, radius, time } — gunshots bots can hear
    killfeed: [],            // { text, killerTeam, victimTeam, headshot, time }

    // per-frame input snapshot, filled by input.js
    input: {
      moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0,
      firing: false, reload: false, jump: false, crouch: false,
      use: false, grenade: false, buy: false,
      slot: 0,               // weapon slot key pressed (1..4)
    },
  };
}

export function makeFighter(id, name, team, isPlayer) {
  return {
    id, name, team, isPlayer,
    alive: true,
    hp: 100,
    armor: 0,
    pos: new THREE.Vector3(),   // feet
    vel: new THREE.Vector3(),
    yaw: 0,                     // facing, radians
    pitch: 0,
    onGround: true,
    crouching: false,
    height: 1.7,                // current body height (crouch shrinks it)
    eyeHeight: 1.62,
    money: START_MONEY,
    weapon: 'pistol',           // current weapon id
    owned: { pistol: true },    // weapon id -> true
    mag: {},                    // weapon id -> rounds in magazine
    reserve: {},                // weapon id -> reserve rounds
    grenades: { he: 0, smoke: 0 },
    kills: 0,
    deaths: 0,
    // gunplay state
    spreadBloom: 0,             // grows with consecutive shots, decays over time
    recoilPitch: 0,             // visual recoil accumulator
    lastShotAt: -10,
    reloading: false,
    reloadEndsAt: 0,
    fireCooldown: 0,
    // mesh handles (filled by world/bots presentation code)
    mesh: null,                 // THREE.Group or null
    bodyParts: null,            // { head, torso, legs } meshes for hit tinting
    // bot brain (null for the player)
    bot: null,
    // damage direction indicator for the player HUD
    lastDamageFrom: null,       // yaw of the attacker, or null
    lastDamageAt: -10,
    // spawn protection / respawn bookkeeping
    spawnYaw: 0,
  };
}

// Damage zones for ray hits against a fighter body.
export const ZONES = {
  head: { y0: 1.35, y1: 1.72, mult: 4.0 },
  torso: { y0: 0.78, y1: 1.35, mult: 1.0 },
  legs: { y0: 0.0, y1: 0.78, mult: 0.75 },
};
