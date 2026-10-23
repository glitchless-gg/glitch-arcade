// Skid marks: dark streaks behind the rear wheels whenever a car brakes hard, drifts or slides.
import * as THREE from 'three';
import { REAR_WHEELS } from './car.js';

const MARK_W = 0.34;
const MARK_EVERY = 0.6; // meters of travel per mark (short marks keep the curves smooth)
const FADE_S = 14;

export function createSkids(scene) {
  const marks = [];
  const trail = new Map(); // car id → last wheel points

  // GLITCHLESS-DEMO: skid-mark leak. Every mark is a brand-new Mesh with its own PlaneGeometry and
  // MeshBasicMaterial (no pooling, no merging, no cap), and it goes on the scene root instead of the
  // track group, so unloadTrack() (on restart and on the next race) never removes or disposes it.
  // Old marks only fade to opacity 0; they are still drawn. Draw calls and geometries climb race
  // after race (faster with restarts), and render time with them.
  function addSkidMark(x0, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.05) return null;
    const geo = new THREE.PlaneGeometry(MARK_W, len + 0.08);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0d0d10, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const mark = new THREE.Mesh(geo, mat);
    mark.position.set((x0 + x1) / 2, 0.06, (z0 + z1) / 2);
    mark.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    mark.name = 'skid_mark';
    mark.userData.age = 0;
    scene.add(mark);
    marks.push(mark);
    return mark;
  }

  function wheelPoints(car) {
    const c = Math.cos(car.h);
    const s = Math.sin(car.h);
    return REAR_WHEELS.map(([lx, lz]) => [car.x + lx * c + lz * s, car.z - lx * s + lz * c]);
  }

  return {
    get count() {
      return marks.length;
    },
    addSkidMark,
    /** called every fixed step for every car */
    step(car) {
      let t = trail.get(car.id);
      if (!car.skidding || car.wreckT > 0) {
        if (t) t.on = false;
        return;
      }
      const pts = wheelPoints(car);
      if (!t || !t.on) {
        trail.set(car.id, { on: true, pts, acc: 0 });
        return;
      }
      const moved = Math.hypot(pts[0][0] - t.pts[0][0], pts[0][1] - t.pts[0][1]);
      if (moved < MARK_EVERY) return;
      if (moved < 6) for (let k = 0; k < pts.length; k++) addSkidMark(t.pts[k][0], t.pts[k][1], pts[k][0], pts[k][1]);
      t.pts = pts;
    },
    /** a fresh start for every car (after a respawn, reset or new race) */
    cut(car) {
      trail.delete(car.id);
    },
    update(dt) {
      for (const m of marks) {
        const u = m.userData;
        if (u.age >= FADE_S) continue;
        u.age += dt;
        m.material.opacity = 0.55 * Math.max(0, 1 - u.age / FADE_S);
      }
    },
  };
}
