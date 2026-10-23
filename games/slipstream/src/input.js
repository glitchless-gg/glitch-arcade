// Keyboard → driving input { throttle, brake, steer, handbrake } + one-shot presses for menu keys.
const held = new Set();
const pressedQueue = new Set();

const MAP = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'handbrake',
  KeyR: 'reset',
  Escape: 'pause',
  KeyP: 'pause',
  KeyQ: 'quit',
  KeyM: 'mute',
  Enter: 'confirm',
};

window.addEventListener('keydown', (e) => {
  const action = MAP[e.code];
  if (!action) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!held.has(e.code)) {
    pressedQueue.add(action);
    if (action === 'handbrake') pressedQueue.add('confirm'); // Space also confirms on menus
  }
  held.add(e.code);
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

function isHeld(action) {
  for (const code of held) if (MAP[code] === action) return true;
  return false;
}

const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };

export const keyboard = {
  state() {
    input.throttle = isHeld('up') ? 1 : 0;
    input.brake = isHeld('down') ? 1 : 0;
    input.steer = (isHeld('right') ? 1 : 0) - (isHeld('left') ? 1 : 0);
    input.handbrake = isHeld('handbrake');
    return input;
  },
  /** consume a one-shot press */
  consume(action) {
    if (pressedQueue.has(action)) {
      pressedQueue.delete(action);
      return true;
    }
    return false;
  },
  clearPresses() {
    pressedQueue.clear();
  },
};
