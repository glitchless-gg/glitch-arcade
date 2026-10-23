// Pointer events on the canvas (click a gem then a neighbour, or drag) and key presses, queued for main.js
// to read once per frame. The bot dispatches real PointerEvents on the same canvas, so it goes through here.
const pointerQueue = [];
const pressed = [];

const KEYS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'select',
  Enter: 'confirm',
  KeyH: 'hammer',
  KeyS: 'shuffle',
  Escape: 'escape',
  KeyP: 'pause',
  KeyR: 'restart',
  KeyQ: 'quit',
  KeyM: 'mute',
};

window.addEventListener('keydown', (e) => {
  const action = KEYS[e.code];
  if (!action) return;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (!e.repeat || ['up', 'down', 'left', 'right'].includes(action)) pressed.push(action);
});

export function bindPointer(canvas) {
  const push = (type) => (e) => {
    if (type === 'pointerdown' && e.button !== 0) return;
    pointerQueue.push({ type, x: e.clientX, y: e.clientY });
    if (type === 'pointerdown') {
      try {
        canvas.setPointerCapture?.(e.pointerId);
      } catch {
        /* synthetic events have no capturable pointer */
      }
    }
  };
  canvas.addEventListener('pointerdown', push('pointerdown'));
  canvas.addEventListener('pointermove', push('pointermove'));
  canvas.addEventListener('pointerup', push('pointerup'));
  canvas.addEventListener('pointercancel', push('pointerup'));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

export const input = {
  /** pointer events since the last frame, oldest first */
  pointers() {
    return pointerQueue.splice(0, pointerQueue.length);
  },
  /** key actions since the last frame, oldest first */
  keys() {
    return pressed.splice(0, pressed.length);
  },
  clear() {
    pointerQueue.length = 0;
    pressed.length = 0;
  },
};
