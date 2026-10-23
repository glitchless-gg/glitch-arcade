// Room camera: follows the knight but stays inside the current room's bounds; walking through a door
// pans to the new room (a short eased pan, like the classics). Screen shake on top.
import * as THREE from 'three';

const DIST = 19.5; // camera z (the play plane is z = 0)
const LIFT = 1.3; // look slightly down so platform tops read
const FOV = 40;

export function createCameraRig(camera) {
  camera.fov = FOV;
  camera.updateProjectionMatrix();
  const s = { x: 0, y: 0, ahead: 0, shake: 0, pan: null, titleT: 0 };
  const look = new THREE.Vector3();

  function half() {
    const h = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * DIST;
    return { w: h * camera.aspect - 0.1, h: h - 0.1 };
  }

  /** the camera centre for a target point, clamped so the view stays inside the room */
  function clamp(room, tx, ty) {
    const b = room.bounds;
    const { w, h } = half();
    const cx = b.x1 - b.x0 <= 2 * w ? (b.x0 + b.x1) / 2 : Math.min(b.x1 - w, Math.max(b.x0 + w, tx));
    const cy = b.y1 - b.y0 <= 2 * h ? (b.y0 + b.y1) / 2 : Math.min(b.y1 - h, Math.max(b.y0 + h, ty));
    return { x: cx, y: cy };
  }

  const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

  return {
    get x() {
      return s.x;
    },
    get y() {
      return s.y;
    },
    snap(room, tx, ty) {
      const c = clamp(room, tx, ty);
      s.x = c.x;
      s.y = c.y;
      s.pan = null;
    },
    /** start the room-transition pan */
    enter() {
      s.pan = { fromX: s.x, fromY: s.y, t: 0, dur: 0.42 };
    },
    shake(amount) {
      s.shake = Math.max(s.shake, amount);
    },
    /** target = { x, y, facing } (feet) */
    update(dt, room, target, mode = 'play') {
      s.ahead = damp(s.ahead, (target.facing || 0) * 1.6, 2.5, dt);
      const want = clamp(room, target.x + s.ahead, target.y + 1.8);
      if (s.pan) {
        s.pan.t += dt;
        const k = Math.min(1, s.pan.t / s.pan.dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        s.x = s.pan.fromX + (want.x - s.pan.fromX) * e;
        s.y = s.pan.fromY + (want.y - s.pan.fromY) * e;
        if (k >= 1) s.pan = null;
      } else {
        s.x = damp(s.x, want.x, 7, dt);
        s.y = damp(s.y, want.y, 5, dt);
      }
      let ox = 0;
      let oy = 0;
      if (s.shake > 0.001) {
        ox = (Math.random() - 0.5) * s.shake;
        oy = (Math.random() - 0.5) * s.shake;
        s.shake *= Math.exp(-8 * dt);
      }
      if (mode === 'title') {
        // a slow drift past the knight and the first save statue in the Gate
        s.titleT += dt;
        const sway = Math.sin(s.titleT * 0.22) * 1.4;
        camera.position.set(7.2 + sway, 3.6, 14.5);
        look.set(7.6 + sway * 0.5, 2.7, 0);
      } else {
        camera.position.set(s.x + ox, s.y + LIFT + oy, DIST);
        look.set(s.x + ox * 0.5, s.y + oy * 0.5, 0);
      }
      camera.lookAt(look);
      return { x: s.x, y: s.y };
    },
    get panning() {
      return !!s.pan;
    },
  };
}
