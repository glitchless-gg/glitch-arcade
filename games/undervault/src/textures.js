// Procedural canvas textures: stone bricks per area, lava, a soft glow. No asset files.
import * as THREE from 'three';
import { createRng } from './rng.js';

export function canvasTexture(w, h, draw, { repeat = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function hex(c, shade = 0) {
  const col = new THREE.Color(c);
  const hsl = {};
  col.getHSL(hsl);
  col.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + shade)));
  return `#${col.getHexString()}`;
}

/** running-bond stone bricks: base colour, mortar colour, per-brick shade jitter, a few cracks */
export function brickTexture(base, mortar, { rows = 4, cols = 2, seed = 1, jitter = 0.07, moss = null } = {}) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const rng = createRng(seed);
    ctx.fillStyle = hex(mortar);
    ctx.fillRect(0, 0, w, h);
    const bh = h / rows;
    const bw = w / cols;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let c = -1; c < cols + 1; c++) {
        const x = c * bw + off;
        const y = r * bh;
        ctx.fillStyle = hex(base, rng.range(-jitter, jitter));
        ctx.fillRect(x + 3, y + 3, bw - 6, bh - 6);
        // bevel: light top edge, dark bottom edge
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(x + 3, y + 3, bw - 6, 4);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x + 3, y + bh - 8, bw - 6, 5);
        // speckle
        for (let i = 0; i < 26; i++) {
          ctx.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.05)';
          ctx.fillRect(x + 4 + rng.range(0, bw - 10), y + 4 + rng.range(0, bh - 10), rng.range(2, 5), rng.range(2, 4));
        }
        if (rng.chance(0.18)) {
          ctx.strokeStyle = 'rgba(0,0,0,0.28)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          let cx = x + rng.range(10, bw - 10);
          let cy = y + 5;
          ctx.moveTo(cx, cy);
          for (let k = 0; k < 4; k++) {
            cx += rng.range(-8, 8);
            cy += bh / 5;
            ctx.lineTo(cx, cy);
          }
          ctx.stroke();
        }
        if (moss && rng.chance(0.25)) {
          ctx.fillStyle = moss;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(x + 3, y + 3, bw - 6, rng.range(3, 9));
          ctx.globalAlpha = 1;
        }
      }
    }
  });
}

/** a flat-ish slab top: big flagstones */
export function flagstoneTexture(base, mortar, seed = 3) {
  return brickTexture(base, mortar, { rows: 2, cols: 2, seed, jitter: 0.05 });
}

export function lavaTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const rng = createRng(11);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#ff9a2e');
    g.addColorStop(1, '#ff4d12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = rng.range(0, w);
      const y = rng.range(0, h);
      const r = rng.range(6, 18);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      const hot = rng.chance(0.5);
      rg.addColorStop(0, hot ? 'rgba(255,236,140,0.9)' : 'rgba(120,20,0,0.55)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      // draw wrapped so it tiles
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) ctx.fillRect(x - r + dx, y - r + dy, r * 2, r * 2);
    }
  });
}

/** soft round glow for additive sprites */
let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  glowTex = canvasTexture(
    128,
    128,
    (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    { repeat: false },
  );
  return glowTex;
}

export function glowSprite(color, size, opacity = 0.8) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(size, size, 1);
  return s;
}
