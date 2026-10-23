// Track math, no rendering: centerline samples every ~1 m, tangents, normals, curvature, sections,
// boost pads and a racing line. Used by the physics, the AI drivers, the minimap and the mesh builder.
import { CatmullRomCurve3, Vector3 } from 'three';

export const ROAD = {
  HW: 7.5, // road half-width
  SHOULDER: 1.3, // curb/shoulder between the road edge and the barrier
  WALL_T: 0.45,
  WALL_H: 0.9,
  CAR_HALF: 1.0, // half the car's width, for the barrier test
  CAR_HALF_LEN: 2.0, // half its length (a car sideways to the track reaches this far)
};
export const WALL_IN = ROAD.HW + ROAD.SHOULDER; // lateral offset of the barrier's inner face

const PAD_LEN = 7;
const PAD_HALF_W = 2.4;

export function buildTrackGeom(def) {
  const sc = def.scale || 1;
  const curve = new CatmullRomCurve3(
    def.points.map(([x, z]) => new Vector3(x * sc, 0, z * sc)),
    true,
    'centripetal',
  );
  curve.arcLengthDivisions = 6000;
  const length = curve.getLength();
  const N = Math.round(length);
  const ds = length / N;
  const pts = curve.getSpacedPoints(N);

  const x = new Float64Array(N);
  const z = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    x[i] = pts[i].x;
    z[i] = pts[i].z;
  }
  const wrap = (i) => ((i % N) + N) % N;

  // unit tangent t, left normal n (n = t rotated +90° in the heading convention: heading θ points
  // along (sin θ, cos θ), so "left" is θ + π/2)
  const tx = new Float64Array(N);
  const tz = new Float64Array(N);
  const nx = new Float64Array(N);
  const nz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = wrap(i - 1);
    const b = wrap(i + 1);
    let dx = x[b] - x[a];
    let dz = z[b] - z[a];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    tx[i] = dx;
    tz[i] = dz;
    nx[i] = dz;
    nz[i] = -dx;
  }

  const geom = { def, id: def.id, curve, length, N, ds, x, z, tx, tz, nx, nz, wrap };

  // centerline curvature (signed, + = turning left), lightly smoothed
  geom.kCenter = smooth(curvatureOf(x, z, N, 4), N, 3);

  // racing line: lateral offsets relaxed toward minimum curvature, clamped inside the road
  geom.line = racingLine(geom);
  const lx = new Float64Array(N);
  const lz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    lx[i] = x[i] + nx[i] * geom.line[i];
    lz[i] = z[i] + nz[i] * geom.line[i];
  }
  geom.lx = lx;
  geom.lz = lz;
  geom.kLine = smooth(curvatureOf(lx, lz, N, 5), N, 4);

  // control point → sample index
  geom.cpIndex = def.points.map(([px, pz]) => nearestGlobal(geom, px * sc, pz * sc));

  // sections (sorted by position along the loop; the one holding sample 0 wraps)
  const secs = def.sections.map((s) => ({ id: s.id, start: geom.cpIndex[s.from] })).sort((a, b) => a.start - b.start);
  geom.sections = secs;
  const sectionOf = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let k = secs.length - 1;
    for (let j = 0; j < secs.length; j++) if (secs[j].start <= i) k = j;
    sectionOf[i] = k;
  }
  geom.sectionOf = sectionOf;

  // boost pads: [startIndex, endIndex) along the loop plus a lateral window
  geom.pads = (def.pads || []).map((p, k) => {
    const center = wrap(geom.cpIndex[p.cp] + Math.round(p.ds / ds));
    const half = Math.round(PAD_LEN / 2 / ds);
    const lat = p.lat === 'line' ? Math.round(geom.line[center] * 10) / 10 : p.lat;
    return { id: k, center, start: wrap(center - half), end: wrap(center + half), lat, halfW: PAD_HALF_W, len: PAD_LEN };
  });

  geom.tunnel = def.tunnel ? { start: geom.cpIndex[def.tunnel.from], end: geom.cpIndex[def.tunnel.to] } : null;

  // xz extent of everything that is part of the track (barriers included)
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    for (const side of [-1, 1]) {
      const px = x[i] + nx[i] * side * (WALL_IN + 1);
      const pz = z[i] + nz[i] * side * (WALL_IN + 1);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minZ = Math.min(minZ, pz);
      maxZ = Math.max(maxZ, pz);
    }
  }
  geom.extent = { minX, maxX, minZ, maxZ };
  return geom;
}

function curvatureOf(x, z, N, w) {
  const k = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - w + N) % N;
    const b = (i + w) % N;
    const ax = x[i] - x[a];
    const az = z[i] - z[a];
    const bx = x[b] - x[i];
    const bz = z[b] - z[i];
    const cx = x[b] - x[a];
    const cz = z[b] - z[a];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    const lc = Math.hypot(cx, cz);
    const cross = ax * bz - az * bx; // < 0 when the path turns left (heading angle increasing)
    k[i] = la && lb && lc ? (-2 * cross) / (la * lb * lc) : 0; // + = turning left
  }
  return k;
}

function smooth(arr, N, w) {
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let j = -w; j <= w; j++) s += arr[(i + j + N) % N];
    out[i] = s / (2 * w + 1);
  }
  return out;
}

// Minimum-curvature racing line: relax the lateral offsets so the line's second difference
// (curvature) gets small, coarse scale first, clamped inside the road. Outside-inside-outside falls
// out of it.
function racingLine(g) {
  const { N, x, z, nx, nz } = g;
  const max = ROAD.HW - 2.0;
  const o = new Float64Array(N);
  const qx = new Float64Array(N);
  const qz = new Float64Array(N);
  for (const [k, iters] of [
    [14, 900],
    [8, 900],
    [4, 700],
  ]) {
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N; i++) {
        qx[i] = x[i] + nx[i] * o[i];
        qz[i] = z[i] + nz[i] * o[i];
      }
      for (let i = 0; i < N; i++) {
        const a = (i - k + N) % N;
        const b = (i + k) % N;
        const a2 = (i - 2 * k + N * 2) % N;
        const b2 = (i + 2 * k) % N;
        const tx = (4 * (qx[a] + qx[b]) - (qx[a2] + qx[b2])) / 6;
        const tz = (4 * (qz[a] + qz[b]) - (qz[a2] + qz[b2])) / 6;
        const target = (tx - x[i]) * nx[i] + (tz - z[i]) * nz[i];
        o[i] = Math.max(-max, Math.min(max, o[i] + (target - o[i]) * 0.5));
      }
    }
  }
  return o;
}

/** nearest centerline sample to (px, pz), searching the whole loop */
export function nearestGlobal(g, px, pz) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < g.N; i++) {
    const d = (g.x[i] - px) ** 2 + (g.z[i] - pz) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** nearest centerline sample, searching ±span samples around a previous guess */
export function nearestLocal(g, px, pz, guess, span = 30) {
  let best = guess;
  let bd = Infinity;
  for (let j = -span; j <= span; j++) {
    const i = (guess + j + g.N) % g.N;
    const d = (g.x[i] - px) ** 2 + (g.z[i] - pz) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** signed lateral offset of (px, pz) from the centerline at sample i (+ = left) */
export function lateralOffset(g, i, px, pz) {
  return (px - g.x[i]) * g.nx[i] + (pz - g.z[i]) * g.nz[i];
}

/** wrap a sample-index difference into (-N/2, N/2] */
export function wrapDelta(g, d) {
  const N = g.N;
  d = ((d % N) + N) % N;
  return d > N / 2 ? d - N : d;
}

/** is sample i inside [start, end) on the loop? */
export function inSpan(g, i, start, end) {
  return start <= end ? i >= start && i < end : i >= start || i < end;
}

export function heading(tx, tz) {
  return Math.atan2(tx, tz);
}
