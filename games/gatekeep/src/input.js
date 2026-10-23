// Keyboard presses and mouse position/clicks over the canvas, read once per frame by main.js.
const pressed = new Set();
const clicks = [];

const KEYS = {
  Digit1: 'build1',
  Numpad1: 'build1',
  Digit2: 'build2',
  Numpad2: 'build2',
  Digit3: 'build3',
  Numpad3: 'build3',
  KeyU: 'upgrade',
  KeyS: 'sell',
  Space: 'call',
  KeyF: 'speed',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'mute',
  Enter: 'confirm',
};

window.addEventListener('keydown', (e) => {
  const action = KEYS[e.code];
  if (!action) return;
  if (e.code === 'Space') e.preventDefault();
  if (!e.repeat) pressed.add(action);
});

export const mouse = { x: 0, y: 0, inside: false, moved: false };

export function attachMouse(canvas) {
  canvas.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.inside = true;
    mouse.moved = true;
  });
  canvas.addEventListener('pointerleave', () => (mouse.inside = false));
  canvas.addEventListener('pointerdown', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.inside = true;
    clicks.push({ button: e.button, x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

export const input = {
  /** one-shot press: true once per key press */
  consume(action) {
    if (!pressed.has(action)) return false;
    pressed.delete(action);
    return true;
  },
  nextClick() {
    return clicks.shift() || null;
  },
  clear() {
    pressed.clear();
    clicks.length = 0;
  },
};
