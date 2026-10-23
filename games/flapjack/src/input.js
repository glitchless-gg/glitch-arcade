// One button, three ways: Space (or W / ↑), a mouse click, a tap. Plus menu keys. Everything is a
// one-shot press the game consumes; a press during a fixed step counts once.
const pressed = new Set();

const KEYS = {
  Space: 'flap',
  KeyW: 'flap',
  ArrowUp: 'flap',
  Enter: 'confirm',
  Escape: 'pause',
  KeyP: 'pause',
  KeyM: 'mute',
};

window.addEventListener('keydown', (e) => {
  const action = KEYS[e.code];
  if (!action) return;
  if (e.code === 'Space' || e.code === 'ArrowUp') e.preventDefault();
  if (e.repeat) return; // holding the button is one flap
  pressed.add(action);
});

/** clicks and taps on the canvas and the game's own screens (not on the Glitchless overlay) */
export function bindPointer(canvas) {
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const t = e.target;
      if (t === canvas || t?.closest?.('.screen, #hud')) {
        pressed.add('flap');
        if (e.pointerType === 'touch') e.preventDefault();
      }
    },
    { passive: false },
  );
}

export const input = {
  /** consume a one-shot press: 'flap' | 'confirm' | 'pause' | 'mute' */
  consume(action) {
    if (!pressed.has(action)) return false;
    pressed.delete(action);
    return true;
  },
  clear() {
    pressed.clear();
  },
};
