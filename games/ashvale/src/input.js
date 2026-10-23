// Keyboard + mouse → the same input the bot produces:
//   { mx, mz (movement keys, -1/0/1 on the floor's axes), aimX, aimZ (the mouse on the floor), attack, dodge, nova, potion }
// The aim point is worked out in main.js (it needs the camera); this module keeps the mouse's screen position.
// One-shot presses (roll, nova, potion, menu keys) wait until a fixed step uses them.
const held = new Set();
const presses = new Set();
let mouseDown = false;
export const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, moved: false };

const MAP = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'dodge',
  ShiftLeft: 'dodge',
  KeyQ: 'nova',
  KeyE: 'potion',
  KeyF: 'attack',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'mute',
  Enter: 'confirm',
};

window.addEventListener('keydown', (e) => {
  const action = MAP[e.code];
  if (!action) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!held.has(e.code)) presses.add(action);
  held.add(e.code);
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => {
  held.clear();
  mouseDown = false;
});

export function bindMouse(canvas) {
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    mouseDown = true;
    presses.add('click');
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseDown = false;
  });
  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.moved = true;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function isHeld(action) {
  for (const code of held) if (MAP[code] === action) return true;
  return false;
}

export const keyboard = {
  /** The input for one fixed step (aim is filled in by the caller). Edge presses are handed out once. */
  state(aim) {
    const input = {
      mx: (isHeld('right') ? 1 : 0) - (isHeld('left') ? 1 : 0),
      mz: (isHeld('down') ? 1 : 0) - (isHeld('up') ? 1 : 0),
      aimX: aim.x,
      aimZ: aim.z,
      attack: mouseDown || isHeld('attack'),
      dodge: presses.delete('dodge'),
      nova: presses.delete('nova'),
      potion: presses.delete('potion'),
    };
    return input;
  },
  /** consume a one-shot press (click / confirm / pause / mute / nova-as-Q in menus) */
  consume(action) {
    return presses.delete(action);
  },
  clearPresses() {
    presses.clear();
  },
  release() {
    mouseDown = false;
  },
};
