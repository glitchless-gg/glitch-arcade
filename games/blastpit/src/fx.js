// World effects, all pooled: bullet tracers, spark bursts (one Points object), explosions and one flash
// light for muzzle flashes and blasts (always in the scene; only its intensity changes).
import * as THREE from 'three';

const MAX_SPARKS = 600;
const TRACERS = 40;
const BLASTS = 6;

export function createFx(scene) {
  // ── tracers: thin additive boxes stretched from the muzzle to the hit point
  const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  tracerGeo.translate(0, 0, 0.5);
  const tracers = [];
  for (let i = 0; i < TRACERS; i++) {
    const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.visible = false;
    m.name = 'tracer';
    m.frustumCulled = false;
    scene.add(m);
    tracers.push({ m, t: 0, life: 0.08 });
  }
  let tracerIdx = 0;

  // ── sparks: one Points buffer, CPU-simulated
  const sparkPos = new Float32Array(MAX_SPARKS * 3);
  const sparkCol = new Float32Array(MAX_SPARKS * 3);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparkTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 0.16, map: sparkTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sparks.frustumCulled = false;
  sparks.name = 'sparks';
  scene.add(sparks);
  const sp = Array.from({ length: MAX_SPARKS }, () => ({ x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 1, g: 1, b: 1, grav: 1 }));
  let sparkIdx = 0;
  let liveSparks = 0;

  // ── explosions: an additive fireball + a floor shockwave ring
  const blastGeo = new THREE.SphereGeometry(1, 20, 14);
  const ringGeo = new THREE.RingGeometry(0.8, 1, 40);
  const blasts = [];
  for (let i = 0; i < BLASTS; i++) {
    const ball = new THREE.Mesh(blastGeo, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const core = new THREE.Mesh(blastGeo, new THREE.MeshBasicMaterial({ color: 0xfff4c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff3caa, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    for (const m of [ball, core, ring]) {
      m.visible = false;
      m.name = 'blast';
      scene.add(m);
    }
    blasts.push({ ball, core, ring, t: 0, life: 0.55, r: 3.5 });
  }
  let blastIdx = 0;

  // ── one shared flash light (muzzle flashes, explosions)
  const flash = new THREE.PointLight(0xffc070, 0, 14, 1.5);
  flash.name = 'flash-light';
  scene.add(flash);
  let flashI = 0;

  function burst(x, y, z, color, n = 10, speed = 4, life = 0.4, grav = 1) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const s = sp[sparkIdx];
      sparkIdx = (sparkIdx + 1) % MAX_SPARKS;
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const v = speed * (0.35 + Math.random() * 0.65);
      Object.assign(s, { x, y, z, vx: r * Math.cos(a) * v, vy: Math.abs(u) * v * 0.9 + 1, vz: r * Math.sin(a) * v, life: life * (0.6 + Math.random() * 0.4), r: c.r, g: c.g, b: c.b, grav });
      s.max = s.life;
    }
  }

  return {
    tracer(from, to, color = 0xfff0b0, width = 0.022) {
      const t = tracers[tracerIdx];
      tracerIdx = (tracerIdx + 1) % TRACERS;
      const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      t.m.position.set(from.x, from.y, from.z);
      t.m.lookAt(to.x, to.y, to.z);
      t.m.scale.set(width, width, len);
      t.m.material.color.setHex(color);
      t.m.material.opacity = 0.9;
      t.m.visible = true;
      t.t = t.life;
    },
    sparks: burst,
    muzzle(x, y, z, strength = 1) {
      flash.position.set(x, y, z);
      flashI = Math.max(flashI, 26 * strength);
    },
    explosion(x, y, z, radius) {
      const b = blasts[blastIdx];
      blastIdx = (blastIdx + 1) % BLASTS;
      b.t = b.life;
      b.r = radius;
      b.ball.position.set(x, y, z);
      b.core.position.set(x, y, z);
      b.ring.position.set(x, 0.05, z);
      for (const m of [b.ball, b.core, b.ring]) m.visible = true;
      burst(x, y, z, 0xffb040, 40, 9, 0.7, 1);
      burst(x, y, z, 0xff3caa, 18, 6, 0.6, 0.5);
      flash.position.set(x, y + 0.6, z);
      flashI = 140;
    },
    update(dt) {
      for (const t of tracers) {
        if (t.t <= 0) continue;
        t.t -= dt;
        t.m.material.opacity = Math.max(0, t.t / t.life) * 0.9;
        if (t.t <= 0) t.m.visible = false;
      }
      liveSparks = 0;
      for (let i = 0; i < MAX_SPARKS; i++) {
        const s = sp[i];
        if (s.life > 0) {
          s.life -= dt;
          s.vy -= 14 * s.grav * dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          s.z += s.vz * dt;
          if (s.y < 0.02) {
            s.y = 0.02;
            s.vy *= -0.35;
            s.vx *= 0.6;
            s.vz *= 0.6;
          }
          const k = Math.max(0, s.life / s.max);
          sparkCol[i * 3] = s.r * k;
          sparkCol[i * 3 + 1] = s.g * k;
          sparkCol[i * 3 + 2] = s.b * k;
          liveSparks++;
        } else {
          s.y = -100;
          sparkCol[i * 3] = sparkCol[i * 3 + 1] = sparkCol[i * 3 + 2] = 0;
        }
        sparkPos[i * 3] = s.x;
        sparkPos[i * 3 + 1] = s.y;
        sparkPos[i * 3 + 2] = s.z;
      }
      sparkGeo.attributes.position.needsUpdate = true;
      sparkGeo.attributes.color.needsUpdate = true;
      for (const b of blasts) {
        if (b.t <= 0) continue;
        b.t -= dt;
        const k = 1 - Math.max(0, b.t) / b.life;
        const ease = 1 - (1 - k) * (1 - k);
        b.ball.scale.setScalar(0.4 + ease * b.r * 0.75);
        b.ball.material.opacity = (1 - k) * 0.75;
        b.core.scale.setScalar(0.3 + ease * b.r * 0.4);
        b.core.material.opacity = Math.max(0, 1 - k * 1.8);
        b.ring.scale.setScalar(0.5 + ease * b.r * 1.15);
        b.ring.material.opacity = (1 - k) * 0.8;
        if (b.t <= 0) for (const m of [b.ball, b.core, b.ring]) m.visible = false;
      }
      flash.intensity = flashI;
      flashI *= Math.exp(-dt * 22);
      if (flashI < 0.05) flashI = 0;
    },
    reset() {
      for (const t of tracers) {
        t.t = 0;
        t.m.visible = false;
      }
      for (const s of sp) s.life = 0;
      for (const b of blasts) {
        b.t = 0;
        for (const m of [b.ball, b.core, b.ring]) m.visible = false;
      }
      flashI = 0;
    },
    get liveSparks() {
      return liveSparks;
    },
    flash,
  };
}
