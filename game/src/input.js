// input.js — keyboard + mouse + pointer lock. Keeps one input snapshot on
// state.input that the fixed-step sim reads; the render loop never reads keys.
export function createInput(state, canvas, onLockChange) {
  const keys = new Set();
  const input = state.input;
  let locked = false;

  function updateMove() {
    let x = 0, z = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    const len = Math.hypot(x, z) || 1;
    input.moveX = x / len;
    input.moveZ = z / len;
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') { input.jump = true; e.preventDefault(); }
    if (e.code === 'KeyR') input.reload = true;
    if (e.code === 'KeyE') input.use = true;
    if (e.code === 'KeyG') input.grenade = true;
    if (e.code === 'KeyB') input.buy = true;
    if (e.code === 'Digit1') input.slot = 1;
    if (e.code === 'Digit2') input.slot = 2;
    if (e.code === 'Digit3') input.slot = 3;
    if (e.code === 'Digit4') input.slot = 4;
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') input.crouch = true;
    updateMove();
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') input.crouch = false;
    updateMove();
  });
  window.addEventListener('blur', () => { keys.clear(); updateMove(); input.firing = false; });

  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    input.lookDX += e.movementX || 0;
    input.lookDY += e.movementY || 0;
  });
  document.addEventListener('mousedown', (e) => {
    if (locked && e.button === 0) input.firing = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (onLockChange) onLockChange(locked);
  });

  return {
    get locked() { return locked; },
    lock() { canvas.requestPointerLock(); },
    unlock() { if (document.pointerLockElement) document.exitPointerLock(); },
    // one-shot flags consumed by the sim each tick
    consume() {
      const c = {
        reload: input.reload, jump: input.jump, use: input.use,
        grenade: input.grenade, buy: input.buy, slot: input.slot,
        useHeld: keys.has('KeyE'),
      };
      input.reload = false; input.jump = false; input.use = false;
      input.grenade = false; input.buy = false; input.slot = 0;
      const look = { dx: input.lookDX, dy: input.lookDY };
      input.lookDX = 0; input.lookDY = 0;
      return { ...c, look };
    },
  };
}
