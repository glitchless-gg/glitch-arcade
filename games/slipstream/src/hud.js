// DOM HUD, screens and the minimap. Only touches the DOM when a value changes.
const $ = (id) => document.getElementById(id);

const cache = {};
function set(id, value) {
  if (cache[id] === value) return false;
  cache[id] = value;
  $(id).textContent = value;
  return true;
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

export function formatTime(s, digits = 2) {
  if (!s && s !== 0) return '--';
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(digits).padStart(3 + digits, '0')}`;
}

export function ordinal(n) {
  return n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
}

const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

let toastTimer = 0;
const SCREENS = ['title', 'pause', 'results', 'champion', 'halted'];

// ── minimap: the track outline is drawn once per track, the dots every frame
const map = { canvas: null, ctx: null, bg: null, scale: 1, ox: 0, oz: 0 };

export const hud = {
  show(visible) {
    $('hud').classList.toggle('hidden', !visible);
  },
  screen(name) {
    for (const s of SCREENS) $(s).classList.toggle('on', s === name);
  },
  footer(text) {
    $('footer').textContent = text;
  },
  track(num, total, name, laps) {
    set('hud-track-num', `${num}/${total}`);
    set('hud-track-name', name);
    cache.laps = laps;
  },
  lap(n, laps) {
    if (set('hud-lap', String(Math.min(n, laps)))) bump($('hud-lap-chip'));
  },
  position(p) {
    if (set('hud-pos', String(p))) {
      set('hud-pos-suf', ordinal(p));
      bump($('hud-pos-chip'));
    }
  },
  times(current, best, last) {
    set('hud-time', formatTime(current));
    set('hud-best', best ? formatTime(best) : '--');
    set('hud-last', last ? formatTime(last) : '--');
  },
  speed(ms, boostFrac) {
    set('hud-speed', String(Math.round(ms * 3.6)));
    const b = boostFrac.toFixed(2);
    if (cache.boost !== b) {
      cache.boost = b;
      $('hud-boost').style.transform = `scaleX(${b})`;
    }
  },
  bot(text) {
    $('hud-bot').hidden = !text;
    $('hud-bot-text').innerHTML = text || '';
  },
  toast(text, kind = '', ms = 1200) {
    const el = $('toast');
    el.textContent = text;
    el.className = `on ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = kind), ms);
  },
  countdown(text) {
    const el = $('countdown');
    el.textContent = text;
    el.className = '';
    void el.offsetWidth;
    el.className = text === 'GO!' ? 'on go' : 'on';
  },
  hint(visible) {
    $('hint').classList.toggle('gone', !visible);
  },
  results({ raceNum, trackName, title, rows, next }) {
    $('results-ribbon').textContent = `RACE ${raceNum} · ${trackName.toUpperCase()}`;
    $('results-title').textContent = title;
    $('results-rows').innerHTML = rows
      .map(
        (r) =>
          `<tr class="${r.me ? 'me' : ''}"><td>${r.position}</td><td><span class="dot" style="background:${css(r.color)}"></span>${r.name}</td><td>${r.estimated ? '+' : ''}${formatTime(r.time)}</td><td>${r.bestLap ? formatTime(r.bestLap) : '--'}</td><td>${r.points}</td></tr>`,
      )
      .join('');
    $('results-next').innerHTML = next;
  },
  champion(title, rows) {
    $('champion-title').textContent = title;
    $('champion-rows').innerHTML = rows
      .map(
        (r, i) =>
          `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td><span class="dot" style="background:${css(r.color)}"></span>${r.name}</td>${r.perRace.map((p) => `<td>${p ?? '–'}</td>`).join('')}<td>${r.total}</td></tr>`,
      )
      .join('');
  },
  halted(ribbon, title, text) {
    $('halted-ribbon').textContent = ribbon;
    $('halted-title').textContent = title;
    $('halted-text').textContent = text;
  },

  mapTrack(g) {
    if (!map.canvas) {
      map.canvas = $('minimap');
      map.ctx = map.canvas.getContext('2d');
      map.bg = document.createElement('canvas');
      map.bg.width = map.canvas.width;
      map.bg.height = map.canvas.height;
    }
    const W = map.canvas.width;
    const pad = 34;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < g.N; i++) {
      minX = Math.min(minX, g.x[i]);
      maxX = Math.max(maxX, g.x[i]);
      minZ = Math.min(minZ, g.z[i]);
      maxZ = Math.max(maxZ, g.z[i]);
    }
    map.scale = (W - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    map.ox = W / 2 - ((minX + maxX) / 2) * map.scale;
    map.oz = W / 2 - ((minZ + maxZ) / 2) * map.scale;
    const c = map.bg.getContext('2d');
    c.clearRect(0, 0, W, W);
    const path = () => {
      c.beginPath();
      for (let i = 0; i <= g.N; i += 2) {
        const j = i % g.N;
        const px = map.ox + g.x[j] * map.scale;
        const pz = map.oz + g.z[j] * map.scale;
        i ? c.lineTo(px, pz) : c.moveTo(px, pz);
      }
      c.closePath();
    };
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 22;
    path();
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.92)';
    c.lineWidth = 12;
    path();
    c.stroke();
    // start line
    const sx = map.ox + g.x[0] * map.scale;
    const sz = map.oz + g.z[0] * map.scale;
    c.save();
    c.translate(sx, sz);
    c.rotate(Math.atan2(g.tz[0], g.tx[0]));
    c.fillStyle = '#ff5a36';
    c.fillRect(-3, -14, 6, 28);
    c.restore();
  },
  mapCars(cars, playerId) {
    if (!map.ctx) return;
    const c = map.ctx;
    const W = map.canvas.width;
    c.clearRect(0, 0, W, W);
    c.drawImage(map.bg, 0, 0);
    const ordered = [...cars].sort((a, b) => (a.id === playerId) - (b.id === playerId));
    for (const car of ordered) {
      const me = car.id === playerId;
      const px = map.ox + car.x * map.scale;
      const pz = map.oz + car.z * map.scale;
      c.beginPath();
      c.arc(px, pz, me ? 13 : 10, 0, Math.PI * 2);
      c.fillStyle = css(car.color);
      c.fill();
      c.lineWidth = me ? 5 : 3;
      c.strokeStyle = me ? '#ffffff' : 'rgba(0,0,0,0.6)';
      c.stroke();
    }
  },
};
