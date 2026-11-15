// player.js — first-person movement and camera for the human player.
// Acceleration / deceleration (never instant), crouch accuracy bonus,
// jump with gravity, AABB map collision. Camera is a pure function of the
// fighter: yaw/pitch + recoil kick + a small walk bob.
import { moveBox } from './world.js';
import { WEAPONS, currentSpread, fireShot, startReload, finishReload } from './weapons.js';

const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.6;
const GRAVITY = 22;
const JUMP_SPEED = 7.2;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.12;

export function stepPlayer(state, f, dt, colliders, input, rng) {
  // look
  f.yaw -= input.look.dx * 0.0021;
  f.pitch -= input.look.dy * 0.0021;
  f.pitch = Math.max(-1.5, Math.min(1.5, f.pitch));

  // crouch changes body height and eye height
  const wantCrouch = input.crouch && f.onGround;
  f.crouching = wantCrouch;
  const targetHeight = wantCrouch ? 1.22 : 1.7;
  f.height += (targetHeight - f.height) * Math.min(1, dt * 14);
  f.eyeHeight += ((wantCrouch ? EYE_CROUCH : EYE_STAND) - f.eyeHeight) * Math.min(1, dt * 14);

  // wish direction in world space (forward is -Z rotated by yaw)
  const sin = Math.sin(f.yaw), cos = Math.cos(f.yaw);
  const wishX = (-sin * -input.moveZ + cos * input.moveX);
  const wishZ = (-cos * -input.moveZ - sin * input.moveX);
  const maxSpeed = f.crouching ? CROUCH_SPEED : WALK_SPEED;
  const wishLen = Math.hypot(wishX, wishZ);
  const tx = wishLen > 0 ? (wishX / wishLen) * maxSpeed : 0;
  const tz = wishLen > 0 ? (wishZ / wishLen) * maxSpeed : 0;
  // accelerate toward the wish velocity; strong friction when no input
  const approach = wishLen > 0 ? 9 : 12;
  f.vel.x += (tx - f.vel.x) * Math.min(1, dt * approach);
  f.vel.z += (tz - f.vel.z) * Math.min(1, dt * approach);

  if (input.jump && f.onGround) {
    f.vel.y = JUMP_SPEED;
    f.onGround = false;
    state.events.push({ type: 'jump', fighterId: f.id });
  }
  f.vel.y -= GRAVITY * dt;

  const res = moveBox(f.pos, f.vel.x * dt, f.vel.y * dt, f.vel.z * dt, 0.35, f.height, colliders);
  if (res.onGround) { f.vel.y = 0; f.onGround = true; }
  else if (res.hitX || res.hitZ) { /* sliding handled by moveBox */ }
  if (f.pos.y <= 0) { f.pos.y = 0; f.vel.y = 0; f.onGround = true; }

  // recoil recovery + bloom decay
  f.recoilPitch *= Math.pow(0.0001, dt);
  f.spreadBloom = Math.max(0, f.spreadBloom - dt * 0.055);
  f.fireCooldown = Math.max(0, f.fireCooldown - dt);

  // reload timing
  if (f.reloading && state.time >= f.reloadEndsAt) finishReload(state, f);
  if (input.reload) startReload(state, f);

  // firing: automatics fire while held; semi-autos fire once per click edge
  const def = WEAPONS[f.weapon];
  const wantFire = def && (def.auto ? input.firing : input.fireEdge);
  if (def && wantFire && !f.reloading && f.fireCooldown <= 0) {
    if (f.mag[f.weapon] > 0) {
      fireShot(state, f, f.yaw + f.recoilPitch * 0.4, f.pitch + f.recoilPitch, colliders, rng);
    } else {
      state.events.push({ type: 'dryfire', fighterId: f.id });
      f.fireCooldown = 0.25;
      startReload(state, f);
    }
  }
  return currentSpread(f, def || WEAPONS.pistol);
}

// Apply the fighter state to the camera each rendered frame.
const _bob = { t: 0 };
export function updateCamera(camera, f, dt, spread) {
  const speed = Math.hypot(f.vel.x, f.vel.z);
  if (f.onGround && speed > 0.5) _bob.t += dt * speed * 1.6;
  const bobY = Math.sin(_bob.t * 2) * 0.028 * Math.min(1, speed / WALK_SPEED);
  const bobX = Math.cos(_bob.t) * 0.018 * Math.min(1, speed / WALK_SPEED);
  camera.position.set(
    f.pos.x + bobX * Math.cos(f.yaw),
    f.pos.y + f.eyeHeight + bobY,
    f.pos.z - bobX * Math.sin(f.yaw)
  );
  camera.rotation.order = 'YXZ';
  camera.rotation.y = f.yaw;
  camera.rotation.x = f.pitch + f.recoilPitch;
  camera.rotation.z = 0;
  return { spread, bobY };
}
