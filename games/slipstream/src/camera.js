// Chase camera (behind and above the car, looking ahead), plus an orbit for the title and results.
import * as THREE from 'three';

export function createCameraRig(camera) {
  const pos = new THREE.Vector3(0, 6, -12);
  const look = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let yaw = 0;
  let shake = 0;
  let fov = camera.fov;
  let orbitA = 0;

  return {
    shake(amount) {
      shake = Math.max(shake, amount);
    },
    snap(car) {
      yaw = car.h;
      pos.set(car.x - Math.sin(yaw) * 9, 3.6, car.z - Math.cos(yaw) * 9);
      look.set(car.x + Math.sin(yaw) * 6, 1.2, car.z + Math.cos(yaw) * 6);
    },
    /** mode: 'chase' | 'orbit' (slow circle around the car) | 'wreck' (hold still, watch the tumble at `at`) */
    update(dt, car, mode = 'chase', at = null) {
      const speed = Math.hypot(car.vx, car.vz);
      if (mode === 'wreck') {
        pos.y += (7 - pos.y) * Math.min(1, dt * 2.5);
        look.lerp(tmp.set(at.x, at.y + 0.8, at.z), 1 - Math.exp(-dt * 6));
        yaw = car.h;
      } else if (mode === 'orbit') {
        orbitA += dt * 0.25;
        tmp.set(car.x + Math.sin(orbitA) * 15, 5.5, car.z + Math.cos(orbitA) * 15);
        pos.lerp(tmp, 1 - Math.exp(-dt * 2));
        look.lerp(tmp.set(car.x, 1, car.z), 1 - Math.exp(-dt * 4));
        fov += (55 - fov) * Math.min(1, dt * 2);
      } else {
        // follow the heading, but lean toward the direction of travel in a slide
        let target = car.h;
        if (speed > 6) {
          const vh = Math.atan2(car.vx, car.vz);
          let d = vh - car.h;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          if (Math.abs(d) < 1.4) target = car.h + d * 0.45;
        }
        let dy = target - yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        yaw += dy * Math.min(1, dt * 6);
        const back = 8.6 + Math.min(speed, 70) * 0.035;
        const h = 3.3 + Math.min(speed, 70) * 0.012;
        tmp.set(car.x - Math.sin(yaw) * back, h, car.z - Math.cos(yaw) * back);
        pos.lerp(tmp, 1 - Math.exp(-dt * 10));
        tmp.set(car.x + Math.sin(yaw) * 7, 1.3, car.z + Math.cos(yaw) * 7);
        look.lerp(tmp, 1 - Math.exp(-dt * 14));
        const fovT = 60 + Math.min(speed, 75) * 0.16 + (car.boostT > 0 ? 6 : 0);
        fov += (fovT - fov) * Math.min(1, dt * 4);
      }
      camera.position.copy(pos);
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake * 0.6;
        shake = Math.max(0, shake - dt * 2.5);
      }
      camera.lookAt(look);
      if (Math.abs(camera.fov - fov) > 0.05) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    },
    /** slow orbit around a point (title screen) */
    title(dt, x, z, t) {
      const a = t * 0.12;
      camera.position.set(x + Math.sin(a) * 34, 12, z + Math.cos(a) * 34);
      camera.lookAt(x, 1, z);
      if (camera.fov !== 50) {
        camera.fov = 50;
        camera.updateProjectionMatrix();
      }
      pos.copy(camera.position);
      fov = 50;
    },
  };
}
