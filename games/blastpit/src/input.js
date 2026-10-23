// Keyboard + mouse → the same input state the bot produces:
//   { move, strafe, yawDelta, pitchDelta, fire, jump, weapon }
// plus one-shot "pressed" edges for menu keys. Mouse look needs pointer lock (click the canvas).
const held = new Set();
const pressedQueue = new Set();
let mouseDown = false;
let lookX = 0;
let lookY = 0;
let wheel = 0;
let pick = null;

const SENS = 0.0022;

const MAP = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  KeyD: 'right',
  ArrowLeft: 'turnLeft',
  ArrowRight: 'turnRight',
  Space: 'jump',
  KeyF: 'fire',
  Digit1: 'w1',
  Digit2: 'w2',
  Digit3: 'w3',
  KeyR: 'restart',
  KeyQ: 'quit',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'mute',
  Enter: 'confirm',
};

window.addEventListener('keydown', (e) => {
  const action = MAP[e.code];
  if (!action) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!held.has(e.code)) {
    pressedQueue.add(action);
    if (action === 'w1') pick = 'pistol';
    if (action === 'w2') pick = 'shotgun';
    if (action === 'w3') pick = 'launcher';
  }
  held.add(e.code);
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => {
  held.clear();
  mouseDown = false;
});

export function bindMouse(canvas) {
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      mouseDown = true;
      pressedQueue.add('click');
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseDown = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    lookX += e.movementX || 0;
    lookY += e.movementY || 0;
  });
  window.addEventListener(
    'wheel',
    (e) => {
      if (document.pointerLockElement === canvas) e.preventDefault();
      wheel += Math.sign(e.deltaY);
    },
    { passive: false },
  );
}

function isHeld(action) {
  for (const code of held) if (MAP[code] === action) return true;
  return false;
}

export const keyboard = {
  /** The input for one fixed step. Mouse movement is handed out once (to the first step of a frame). */
  state(currentWeapon, order, dt) {
    const input = {
      move: (isHeld('forward') ? 1 : 0) - (isHeld('back') ? 1 : 0),
      strafe: (isHeld('right') ? 1 : 0) - (isHeld('left') ? 1 : 0),
      yawDelta: -lookX * SENS + ((isHeld('turnLeft') ? 1 : 0) - (isHeld('turnRight') ? 1 : 0)) * 2.6 * dt,
      pitchDelta: -lookY * SENS,
      fire: mouseDown || isHeld('fire'),
      jump: isHeld('jump'),
      weapon: pick,
    };
    if (!input.weapon && wheel !== 0) {
      const i = order.indexOf(currentWeapon);
      input.weapon = order[(i + (wheel > 0 ? 1 : -1) + order.length) % order.length];
    }
    lookX = 0;
    lookY = 0;
    wheel = 0;
    pick = null;
    return input;
  },
  /** consume a one-shot press (click/confirm/pause/restart/quit/mute/jump) */
  consume(action) {
    if (pressedQueue.has(action)) {
      pressedQueue.delete(action);
      return true;
    }
    return false;
  },
  clearPresses() {
    pressedQueue.clear();
    lookX = lookY = wheel = 0;
    pick = null;
  },
  releaseFire() {
    mouseDown = false;
  },
};
