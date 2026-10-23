// Keyboard → { left, right, jump, dash, attack } (held) + one-shot presses for menu keys.
const held = new Set();
const pressedQueue = new Set();
const tapped = new Set(); // pressed since the last state() read, so a quick tap still counts for a step

const MAP = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'jump',
  KeyW: 'jump',
  ArrowUp: 'jump',
  KeyJ: 'attack',
  KeyX: 'attack',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  KeyK: 'dash',
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
    tapped.add(action);
  }
  held.add(e.code);
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

function isHeld(action) {
  for (const code of held) if (MAP[code] === action) return true;
  return false;
}

export const keyboard = {
  state() {
    const on = (a) => isHeld(a) || tapped.has(a);
    const s = { left: on('left'), right: on('right'), jump: on('jump'), dash: on('dash'), attack: on('attack') };
    tapped.clear();
    return s;
  },
  /** consume a one-shot press (jump/confirm/pause/restart/quit/mute) */
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
