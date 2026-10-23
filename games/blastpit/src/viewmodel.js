// First-person weapon models, drawn in their own little scene on top of the world (so they never clip
// into walls). Simple boxes and cylinders: pistol, shotgun, rocket launcher. Bob, recoil, switch, flash.
import * as THREE from 'three';

export function createViewmodel() {
  const scene = new THREE.Scene();
  scene.name = 'viewmodel';
  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.01, 10);
  scene.add(new THREE.HemisphereLight(0xb8c8ff, 0x2a1830, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-1, 2, 1.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff3caa, 1.4);
  rim.position.set(2, 0.5, -1);
  scene.add(rim);

  const M = {
    steel: new THREE.MeshStandardMaterial({ color: 0x5c6680, roughness: 0.38, metalness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x272b38, roughness: 0.55, metalness: 0.3 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x6a432a, roughness: 0.8, metalness: 0.05 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x5d6e4c, roughness: 0.55, metalness: 0.25 }),
    cyan: new THREE.MeshBasicMaterial({ color: 0x2de2e6 }),
    amber: new THREE.MeshBasicMaterial({ color: 0xffb020 }),
    magenta: new THREE.MeshBasicMaterial({ color: 0xff3caa }),
  };

  function box(g, w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  }
  function cyl(g, r, len, mat, x, y, z, seg = 14) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    g.add(m);
    return m;
  }

  // gun-local space: barrel along -z, the back of the gun near z = 0 (the rig sits ~0.4 m in front of the eye)
  const guns = {};
  {
    const g = new THREE.Group();
    box(g, 0.07, 0.075, 0.28, M.steel, 0, 0.03, -0.28);
    box(g, 0.062, 0.05, 0.24, M.dark, 0, -0.025, -0.26);
    const grip = box(g, 0.058, 0.16, 0.075, M.grip, 0, -0.1, -0.17);
    grip.rotation.x = -0.25;
    box(g, 0.072, 0.012, 0.2, M.cyan, 0, 0.035, -0.29).scale.x = 1.02;
    box(g, 0.012, 0.02, 0.02, M.cyan, 0, 0.078, -0.41);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.44);
    guns.pistol = g;
  }
  {
    const g = new THREE.Group();
    cyl(g, 0.024, 0.6, M.steel, -0.021, 0.02, -0.5);
    cyl(g, 0.024, 0.6, M.steel, 0.021, 0.02, -0.5);
    box(g, 0.09, 0.09, 0.22, M.dark, 0, -0.005, -0.13);
    box(g, 0.075, 0.055, 0.2, M.grip, 0, -0.045, -0.42);
    const stock = box(g, 0.065, 0.1, 0.2, M.grip, 0, -0.055, 0.06);
    stock.rotation.x = 0.18;
    box(g, 0.094, 0.014, 0.18, M.amber, 0, 0.045, -0.13);
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.81);
    guns.shotgun = g;
  }
  {
    const g = new THREE.Group();
    cyl(g, 0.058, 0.62, M.olive, 0.03, 0.0, -0.52, 18);
    cyl(g, 0.066, 0.045, M.magenta, 0.03, 0.0, -0.82, 18);
    cyl(g, 0.064, 0.03, M.magenta, 0.03, 0.0, -0.23, 18);
    box(g, 0.045, 0.12, 0.065, M.grip, 0.03, -0.11, -0.36);
    box(g, 0.045, 0.045, 0.14, M.dark, 0.03, 0.08, -0.44);
    box(g, 0.018, 0.018, 0.018, M.cyan, 0.03, 0.112, -0.38);
    g.userData.muzzle = new THREE.Vector3(0.03, 0.0, -0.86);
    guns.launcher = g;
  }

  const rig = new THREE.Group();
  scene.add(rig);
  for (const g of Object.values(guns)) {
    g.visible = false;
    g.scale.setScalar(0.85);
    g.rotation.y = 0.06; // toe in toward the crosshair
    g.userData.muzzle.multiplyScalar(0.85);
    rig.add(g);
  }
  const BASE = { x: 0.16, y: -0.16, z: -0.3 };

  // muzzle flash: an additive star on a plane
  const flashTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const grd = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,250,220,1)');
    grd.addColorStop(0.25, 'rgba(255,200,90,0.9)');
    grd.addColorStop(1, 'rgba(255,120,40,0)');
    x.fillStyle = grd;
    x.translate(64, 64);
    for (let i = 0; i < 6; i++) {
      x.rotate(Math.PI / 3);
      x.beginPath();
      x.moveTo(-9, 0);
      x.lineTo(0, -62);
      x.lineTo(9, 0);
      x.fill();
    }
    x.beginPath();
    x.arc(0, 0, 26, 0, Math.PI * 2);
    x.fill();
    return new THREE.CanvasTexture(c);
  })();
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.visible = false;
  rig.add(flash);

  let current = null;
  let kick = 0;
  let flashT = 0;
  let switchT = 0;
  let pending = null;
  let swayX = 0;
  let swayY = 0;

  function show(name) {
    for (const [k, g] of Object.entries(guns)) g.visible = k === name;
    current = name;
  }

  return {
    scene,
    camera,
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    /** Lower the current gun and raise `name` (takes `dur` seconds). */
    switchTo(name, dur = 0.32) {
      if (!current) {
        show(name);
        return;
      }
      pending = name;
      switchT = dur;
      this._dur = dur;
    },
    set(name) {
      pending = null;
      switchT = 0;
      show(name);
    },
    fire(strength = 1) {
      kick = Math.min(1.4, kick + strength);
      flashT = 0.05;
      const g = guns[current];
      if (g) {
        flash.position.copy(g.userData.muzzle).applyEuler(g.rotation);
        flash.rotation.z = Math.random() * Math.PI;
        flash.scale.setScalar(current === 'shotgun' ? 1.6 : current === 'launcher' ? 1.9 : 1);
      }
    },
    /** state = { bob, speed, yawRate, pitchRate, grounded } */
    update(dt, s) {
      kick *= Math.exp(-dt * 14);
      if (flashT > 0) flashT -= dt;
      flash.visible = flashT > 0;
      let lower = 0;
      if (switchT > 0) {
        switchT -= dt;
        const half = this._dur / 2;
        if (pending && switchT <= half) {
          show(pending);
          pending = null;
        }
        lower = switchT > half ? 1 - (switchT - half) / half : switchT / half;
      }
      swayX += (-s.yawRate * 0.012 - swayX) * Math.min(1, dt * 8);
      swayY += (s.pitchRate * 0.012 - swayY) * Math.min(1, dt * 8);
      const bobAmt = Math.min(1, s.speed / 6) * (s.grounded ? 1 : 0.3);
      rig.position.set(BASE.x + Math.sin(s.bob) * 0.012 * bobAmt + swayX, BASE.y - Math.abs(Math.cos(s.bob)) * 0.012 * bobAmt - lower * 0.3 + swayY, BASE.z + kick * 0.06);
      rig.rotation.set(kick * 0.16 + lower * -0.5, swayX * 2, 0);
    },
    /** Compile the gun shaders up front (the gun scene is only drawn during play). */
    warm(renderer) {
      const was = Object.fromEntries(Object.entries(guns).map(([k, g]) => [k, g.visible]));
      for (const g of Object.values(guns)) g.visible = true;
      flash.visible = true;
      renderer.compile(scene, camera);
      for (const [k, g] of Object.entries(guns)) g.visible = was[k];
      flash.visible = false;
    },
    get current() {
      return current;
    },
  };
}
