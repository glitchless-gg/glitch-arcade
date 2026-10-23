// Enemy health bars: a small canvas-drawn bar in a Sprite floating over each enemy. A new bar fills
// up from empty, and after a hit a white "recent damage" chunk drains down to the real value.
import * as THREE from 'three';

const SCALE = 2; // a 64x8 bar drawn at 2x so it stays crisp on retina screens
const W = 64 * SCALE;
const H = 8 * SCALE;
const DRAIN_PER_S = 0.3; // how fast the white damage chunk drains
const FILL_PER_S = 1.0; // a new bar fills up from empty when its enemy appears

const active = new Set();
export const healthBars = { live: 0, made: 0, redraws: 0 };

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// GLITCHLESS-DEMO: a health-bar texture per enemy. Every enemy gets its own canvas, its own
// CanvasTexture and its own SpriteMaterial, so a swarm that spawns at once means dozens of canvases,
// texture uploads and material setups in the same frame (wave 9: 120 swarmlings in about a second).
export function createHealthBar(width = 0.62) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, width / 8, 1);
  sprite.renderOrder = 5;
  const bar = { sprite, canvas, ctx, texture, material, frac: 1, ghost: 1, fill: 0 };
  redraw(bar);
  active.add(bar);
  healthBars.live++;
  healthBars.made++;
  return bar;
}

// GLITCHLESS-DEMO: a health-bar texture per enemy. Redraws the whole canvas and re-uploads the
// texture (needsUpdate) every time the enemy takes damage, and on every frame while a new bar fills up
// or a damage chunk drains: a swarm pouring out of the cave re-uploads a hundred textures per frame.
function redraw(bar) {
  const { ctx } = bar;
  ctx.clearRect(0, 0, W, H);
  // a soft shadow under the frame so the bar reads on grass and dirt alike
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 5 * SCALE;
  ctx.fillStyle = 'rgba(24, 18, 36, 0.85)';
  roundRect(ctx, SCALE, SCALE, W - 2 * SCALE, H - 2 * SCALE, 3 * SCALE);
  ctx.fill();
  ctx.shadowBlur = 0;
  const inner = W - 4 * SCALE;
  const ghost = Math.round(inner * Math.min(bar.ghost, bar.fill));
  const w = Math.round(inner * Math.min(bar.frac, bar.fill));
  if (ghost > w) {
    ctx.fillStyle = '#fff4e0';
    roundRect(ctx, 2 * SCALE, 2 * SCALE, ghost, H - 4 * SCALE, 2 * SCALE);
    ctx.fill();
  }
  if (w > 0) {
    ctx.fillStyle = bar.frac > 0.6 ? '#5fe07a' : bar.frac > 0.3 ? '#ffc83d' : '#ff5a4f';
    roundRect(ctx, 2 * SCALE, 2 * SCALE, w, H - 4 * SCALE, 2 * SCALE);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(3 * SCALE, 2 * SCALE, Math.max(0, w - 2 * SCALE), SCALE);
  }
  bar.texture.needsUpdate = true;
  healthBars.redraws++;
}

/** The enemy took damage: frac is its remaining health (0..1). */
export function drawHealthBar(bar, frac) {
  bar.frac = frac;
  redraw(bar);
}

/** Every frame: fill new bars and drain the damage chunks. */
export function updateHealthBars(dt) {
  for (const bar of active) {
    if (bar.fill < 1) bar.fill = Math.min(1, bar.fill + FILL_PER_S * dt);
    else if (bar.ghost > bar.frac) bar.ghost = Math.max(bar.frac, bar.ghost - DRAIN_PER_S * dt);
    else continue;
    redraw(bar);
  }
}

// GLITCHLESS-DEMO: a health-bar texture per enemy. When the enemy dies or leaks the sprite leaves
// the scene, but bar.texture.dispose() and bar.material.dispose() are never called: the GPU texture
// stays allocated, so renderer.info.memory.textures only ever goes up.
export function removeHealthBar(bar) {
  bar.sprite.removeFromParent();
  active.delete(bar);
  healthBars.live--;
}
