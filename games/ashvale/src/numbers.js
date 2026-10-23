// Floating damage numbers: DOM elements over the canvas, kept over the world point they belong to by projecting
// that point every frame. Each character is its own <span> so the digits pop in one after another.
import * as THREE from 'three';

const layer = document.getElementById('numbers');
const v = new THREE.Vector3();

// GLITCHLESS-DEMO: damage numbers that are never removed (a DOM leak the GPU never sees). `numbers` is every
// number ever shown: nothing is ever taken out of it, and nothing takes its element out of the DOM.
const numbers = [];
let nodes = 0;

/** Show `text` over the world point (x, y, z). kind: hit | crit | burn | hurt | heal | xp | gold | dodge | level */
export function spawnNumber(x, y, z, text, kind = 'hit') {
  const el = document.createElement('div');
  el.className = `num ${kind}`;
  for (let i = 0; i < text.length; i++) {
    const ch = document.createElement('span');
    ch.textContent = text[i] === ' ' ? '\u00a0' : text[i];
    ch.style.animationDelay = `${i * 24}ms`;
    el.appendChild(ch);
  }
  layer.appendChild(el);
  nodes += 1 + text.length;
  const n = { el, x, y, z, dx: (Math.random() - 0.5) * 30 };
  numbers.push(n);
  // GLITCHLESS-DEMO: when the float-up animation ends, the number is hidden. Only hidden: the element stays in the
  // DOM, and it stays in `numbers`, so updateNumbers() keeps placing it.
  el.addEventListener('animationend', (e) => {
    if (e.target === el) el.style.opacity = '0';
  });
  return n;
}

/** Called every frame: keep each number over its world point. */
export function updateNumbers(camera, width, height) {
  // GLITCHLESS-DEMO: this walks every number ever spawned, finished or not, every frame: it projects each one
  // and writes its transform. Reading offsetWidth (to centre it) right after the previous number's transform
  // was written makes the browser recalculate style and layout once per number. A few hundred hits in, that is
  // thousands of dead nodes and milliseconds of script, style and layout a frame; the GPU sees none of it.
  for (const n of numbers) {
    v.set(n.x, n.y, n.z).project(camera);
    const x = (v.x * 0.5 + 0.5) * width - n.el.offsetWidth / 2 + n.dx;
    const y = (-v.y * 0.5 + 0.5) * height;
    n.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
}

/** Every DOM node the numbers have created (the `damage_numbers` gauge), and how many are still animating. */
export function numberStats() {
  let live = 0;
  for (const n of numbers) if (n.el.style.opacity !== '0') live++;
  return { nodes, numbers: numbers.length, visible: live, in_dom: layer.getElementsByTagName('*').length };
}

export function numberNodes() {
  return nodes;
}
