// Procedural canvas textures (no image files): asphalt, curbs, walls, ground, pads, banners, windows.
import * as THREE from 'three';
import { createRng } from './rng.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function speckle(g, w, h, n, colors, rng, size = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(rng.next() * colors.length)];
    g.fillRect(rng.next() * w, rng.next() * h, size, size);
  }
}

/** road: u across the road (0..1), v along it (one repeat = 16 m) */
export function asphaltTexture(base, { neon = false } = {}) {
  const [c, g] = canvas(256, 512);
  const rng = createRng(11);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 512);
  speckle(g, 256, 512, 4200, ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.12)', 'rgba(255,255,255,0.03)'], rng, 2);
  // edge lines
  g.fillStyle = neon ? 'rgba(34,227,255,0.85)' : 'rgba(255,255,255,0.9)';
  g.fillRect(8, 0, 5, 512);
  g.fillRect(243, 0, 5, 512);
  // dashed center line (8 m dash, 8 m gap)
  g.fillStyle = neon ? 'rgba(255,61,187,0.8)' : 'rgba(255,214,90,0.9)';
  g.fillRect(126, 0, 4, 256);
  return tex(c);
}

export function curbTexture() {
  const [c, g] = canvas(32, 64);
  g.fillStyle = '#e8edf2';
  g.fillRect(0, 0, 32, 64);
  g.fillStyle = '#d63031';
  g.fillRect(0, 0, 32, 32);
  return tex(c, { aniso: 4 });
}

export function wallTexture(base, stripe) {
  const [c, g] = canvas(64, 128);
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = stripe;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(0,0,0,0.08)';
  g.fillRect(0, 60, 64, 4);
  return tex(c, { aniso: 4 });
}

export function groundTexture(a, b, { grid = null } = {}) {
  const [c, g] = canvas(256, 256);
  const rng = createRng(3);
  g.fillStyle = a;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = b;
    g.globalAlpha = 0.35 + rng.next() * 0.4;
    const r = 8 + rng.next() * 28;
    g.beginPath();
    g.ellipse(rng.next() * 256, rng.next() * 256, r, r * (0.5 + rng.next() * 0.5), rng.next() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  speckle(g, 256, 256, 1500, ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.06)'], rng, 2);
  if (grid) {
    g.strokeStyle = grid;
    g.lineWidth = 2;
    g.globalAlpha = 0.55;
    for (let i = 0; i <= 256; i += 64) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 256);
      g.moveTo(0, i);
      g.lineTo(256, i);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  return tex(c);
}

export function padTexture() {
  const [c, g] = canvas(128, 256);
  g.clearRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(10, 30, 60, 0.55)';
  g.fillRect(0, 0, 128, 256);
  g.lineWidth = 16;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let k = 0; k < 2; k++) {
    const y = 40 + k * 128;
    const grad = g.createLinearGradient(0, y, 0, y + 70);
    grad.addColorStop(0, '#7ff6ff');
    grad.addColorStop(1, '#ffe14d');
    g.strokeStyle = grad;
    g.beginPath();
    g.moveTo(18, y + 60);
    g.lineTo(64, y + 10);
    g.lineTo(110, y + 60);
    g.stroke();
  }
  g.strokeStyle = 'rgba(127,246,255,0.9)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 250);
  const t = tex(c, { aniso: 4 });
  return t;
}

export function checkerTexture(cells = 8, rows = 2) {
  const [c, g] = canvas(cells * 16, rows * 16);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cells; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  const t = tex(c, { repeat: false, aniso: 4 });
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function bannerTexture(text, { bg = '#14151c', fg = '#ffffff', accent = '#ff5a36' } = {}) {
  const [c, g] = canvas(1024, 128);
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 128);
  for (let x = 0; x < 1024; x += 32) {
    g.fillStyle = (x / 32) % 2 ? '#f4f4f4' : '#111';
    g.fillRect(x, 0, 32, 16);
    g.fillStyle = (x / 32) % 2 ? '#111' : '#f4f4f4';
    g.fillRect(x, 112, 32, 16);
  }
  g.font = 'italic 700 64px "Russo One", "Chakra Petch", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = accent;
  g.fillText(text, 516, 68);
  g.fillStyle = fg;
  g.fillText(text, 512, 64);
  return tex(c, { repeat: false, aniso: 4 });
}

export function windowsTexture(colors, seed = 5) {
  const [c, g] = canvas(128, 256);
  const rng = createRng(seed);
  g.fillStyle = '#0b0a18';
  g.fillRect(0, 0, 128, 256);
  for (let y = 8; y < 256; y += 16)
    for (let x = 8; x < 128; x += 16) {
      if (rng.next() < 0.45) continue;
      g.fillStyle = colors[Math.floor(rng.next() * colors.length)];
      g.globalAlpha = 0.5 + rng.next() * 0.5;
      g.fillRect(x, y, 9, 7);
    }
  g.globalAlpha = 1;
  return tex(c, { aniso: 4 });
}

export function waterTexture() {
  const [c, g] = canvas(256, 256);
  const rng = createRng(9);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(30,90,160,0.18)';
  g.lineWidth = 3;
  for (let i = 0; i < 40; i++) {
    const x = rng.next() * 256;
    const y = rng.next() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + 10, y - 4, x + 22, y);
    g.stroke();
  }
  return tex(c);
}
