// Effects: arrows and cannonballs in flight, explosions, frost pulses, death puffs, the range ring,
// the tile cursor and floating "+gold" labels. Everything is pooled and allocated once.
import * as THREE from 'three';

function pool(n, make) {
  const items = Array.from({ length: n }, make);
  let next = 0;
  return {
    items,
    take() {
      const it = items[next];
      next = (next + 1) % items.length;
      return it;
    },
  };
}

export function createFx(scene, camera, floatersEl) {
  // ── projectiles ──────────────────────────────────────────────────────────────────────────────
  const arrowGeo = new THREE.BoxGeometry(0.035, 0.035, 0.34);
  const arrowMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 });
  const tipGeo = new THREE.ConeGeometry(0.035, 0.08, 4).rotateX(Math.PI / 2).translate(0, 0, 0.2);
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0.6, roughness: 0.3 });
  const ballGeo = new THREE.SphereGeometry(0.1, 12, 8);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0x23252d, metalness: 0.4, roughness: 0.4 });
  const flying = new Map(); // projectile id -> mesh
  const spare = { arrow: [], ball: [] };

  function makeProjectile(kind) {
    if (spare[kind].length) return spare[kind].pop();
    if (kind === 'arrow') {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(arrowGeo, arrowMat), new THREE.Mesh(tipGeo, tipMat));
      return g;
    }
    const m = new THREE.Mesh(ballGeo, ballMat);
    m.castShadow = true;
    return m;
  }

  // ── explosions, pulses, puffs (each slot owns its material so it can fade on its own) ────────
  const ringGeo = new THREE.RingGeometry(0.86, 1, 48);
  const discGeo = new THREE.CircleGeometry(1, 48);
  const sphereGeo = new THREE.SphereGeometry(1, 14, 10);
  const puffGeo = new THREE.SphereGeometry(1, 8, 6);

  const booms = pool(14, () => {
    const flash = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, depthWrite: false }));
    const scorch = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0x3a2a1a, transparent: true, depthWrite: false }));
    scorch.rotation.x = -Math.PI / 2;
    flash.visible = scorch.visible = false;
    scene.add(flash, scorch);
    return { flash, scorch, t: 1, r: 1 };
  });
  const pulses = pool(12, () => {
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    const fill = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0xc8f2ff, transparent: true, depthWrite: false }));
    ring.rotation.x = fill.rotation.x = -Math.PI / 2;
    ring.visible = fill.visible = false;
    scene.add(ring, fill);
    return { ring, fill, t: 1, r: 1 };
  });
  const puffs = pool(24, () => {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    const g = new THREE.Group();
    const balls = Array.from({ length: 5 }, (_, i) => {
      const b = new THREE.Mesh(puffGeo, mat);
      const a = (i / 5) * Math.PI * 2;
      b.userData.dir = new THREE.Vector3(Math.cos(a), 0.6 + (i % 2) * 0.4, Math.sin(a));
      g.add(b);
      return b;
    });
    g.visible = false;
    scene.add(g);
    return { g, mat, balls, t: 1, size: 0.2 };
  });

  // ── range ring + tile cursor ─────────────────────────────────────────────────────────────────
  const rangeRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
  const rangeFill = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
  rangeRing.rotation.x = rangeFill.rotation.x = -Math.PI / 2;
  rangeRing.renderOrder = rangeFill.renderOrder = 2;
  rangeRing.visible = rangeFill.visible = false;
  scene.add(rangeFill, rangeRing);

  const cursor = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.69, 4, 1).rotateZ(Math.PI / 4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
  cursor.rotation.x = -Math.PI / 2;
  cursor.renderOrder = 3;
  cursor.visible = false;
  scene.add(cursor);

  // ── floating labels (DOM) ─────────────────────────────────────────────────────────────────────
  const floaters = pool(10, () => {
    const el = document.createElement('div');
    el.className = 'floater';
    floatersEl.appendChild(el);
    return { el, t: 1, pos: new THREE.Vector3() };
  });
  const v = new THREE.Vector3();

  return {
    // projectiles mirror the sim's list; the sim tells us when one starts and ends
    fire(pr) {
      const m = makeProjectile(pr.kind);
      m.userData.kind = pr.kind;
      flying.set(pr.id, m);
      scene.add(m);
    },
    endProjectile(pr) {
      const m = flying.get(pr.id);
      if (!m) return;
      flying.delete(pr.id);
      m.removeFromParent();
      spare[m.userData.kind].push(m);
    },
    clearProjectiles() {
      for (const [, m] of flying) {
        m.removeFromParent();
        spare[m.userData.kind].push(m);
      }
      flying.clear();
    },
    syncProjectiles(list) {
      for (const pr of list) {
        const m = flying.get(pr.id);
        if (!m) continue;
        m.position.set(pr.x, pr.y, pr.z);
        if (pr.kind === 'arrow' && pr.dx !== undefined) m.rotation.y = Math.atan2(pr.dx, pr.dz);
      }
    },
    explode(x, z, radius) {
      const b = booms.take();
      b.t = 0;
      b.r = radius;
      b.flash.position.set(x, 0.2, z);
      b.scorch.position.set(x, 0.005, z);
      b.flash.visible = b.scorch.visible = true;
    },
    pulse(x, z, range) {
      const p = pulses.take();
      p.t = 0;
      p.r = range;
      p.ring.position.set(x, 0.06, z);
      p.fill.position.set(x, 0.05, z);
      p.ring.visible = p.fill.visible = true;
    },
    puff(x, y, z, color = 0xffffff, size = 0.2) {
      const p = puffs.take();
      p.t = 0;
      p.size = size;
      p.mat.color.setHex(color);
      p.g.position.set(x, y, z);
      p.g.visible = true;
    },
    floater(text, x, y, z, kind = '') {
      const f = floaters.take();
      f.t = 0;
      f.pos.set(x, y, z);
      f.el.textContent = text;
      f.el.className = `floater on ${kind}`;
    },
    showRange(x, z, range, color = 0xffffff) {
      rangeRing.visible = rangeFill.visible = true;
      rangeRing.position.set(x, 0.04, z);
      rangeFill.position.set(x, 0.035, z);
      rangeRing.scale.setScalar(range);
      rangeFill.scale.setScalar(range);
      rangeRing.material.color.setHex(color);
      rangeFill.material.color.setHex(color);
    },
    hideRange() {
      rangeRing.visible = rangeFill.visible = false;
    },
    showCursor(x, z, ok) {
      cursor.visible = true;
      cursor.position.set(x, 0.03, z);
      cursor.material.color.setHex(ok ? 0xffffff : 0xff6b5e);
    },
    hideCursor() {
      cursor.visible = false;
    },
    get projectileMeshes() {
      return flying.size;
    },
    /** Everything that starts hidden, so the game can compile its shaders up front. */
    warmables() {
      return [...booms.items.flatMap((b) => [b.flash, b.scorch]), ...pulses.items.flatMap((p) => [p.ring, p.fill]), ...puffs.items.map((p) => p.g), rangeRing, rangeFill, cursor];
    },
    update(dt, t) {
      for (const b of booms.items) {
        if (b.t >= 1) continue;
        b.t = Math.min(1, b.t + dt * 2.6);
        const k = b.t;
        b.flash.scale.setScalar(b.r * (0.35 + k * 0.75));
        b.flash.material.opacity = (1 - k) * 0.9;
        b.flash.material.color.setHSL(0.08 - k * 0.05, 1, 0.6 - k * 0.25);
        b.scorch.scale.setScalar(b.r * 0.8);
        b.scorch.material.opacity = (1 - k) * 0.45;
        if (b.t >= 1) b.flash.visible = b.scorch.visible = false;
      }
      for (const p of pulses.items) {
        if (p.t >= 1) continue;
        p.t = Math.min(1, p.t + dt * 2.4);
        const k = 1 - Math.pow(1 - p.t, 2);
        p.ring.scale.setScalar(p.r * k);
        p.fill.scale.setScalar(p.r * k);
        p.ring.material.opacity = (1 - p.t) * 0.9;
        p.fill.material.opacity = (1 - p.t) * 0.25;
        if (p.t >= 1) p.ring.visible = p.fill.visible = false;
      }
      for (const p of puffs.items) {
        if (p.t >= 1) continue;
        p.t = Math.min(1, p.t + dt * 2.8);
        const k = p.t;
        for (const b of p.balls) {
          const d = b.userData.dir;
          b.position.set(d.x * k * p.size * 2.2, d.y * k * p.size * 2.2, d.z * k * p.size * 2.2);
          b.scale.setScalar(p.size * (0.6 + k * 0.6) * (1 - k * 0.5));
        }
        p.mat.opacity = 1 - k;
        if (p.t >= 1) p.g.visible = false;
      }
      for (const f of floaters.items) {
        if (f.t >= 1) continue;
        f.t = Math.min(1, f.t + dt * 1.1);
        v.copy(f.pos);
        v.y += f.t * 0.9;
        v.project(camera);
        const x = (v.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
        f.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
        f.el.style.opacity = String(f.t < 0.75 ? 1 : (1 - f.t) * 4);
        if (f.t >= 1) f.el.className = 'floater';
      }
      // a slow breathing range ring
      rangeRing.material.opacity = 0.7 + Math.sin(t * 4) * 0.15;
    },
  };
}
