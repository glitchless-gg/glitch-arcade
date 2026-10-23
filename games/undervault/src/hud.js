// DOM HUD + screens + the room map. Only touches the DOM when a value actually changes.
import { ROOMS, AREAS, MAP_BOUNDS } from './rooms.js';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';

const HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#e5484d" stroke="#3a0d12" stroke-width="1.4" d="M12 20.5s-7.6-4.6-9.5-9.3C1 7.8 3 4.3 6.6 4.3c2.2 0 3.7 1.2 4.4 2.6.7-1.4 2.2-2.6 4.4-2.6 3.6 0 5.6 3.5 4.1 6.9-1.9 4.7-7.5 9.3-7.5 9.3z"/><path fill="#ff9a9a" opacity=".55" d="M6.3 6.6c-1.4.3-2.3 1.6-2 3 .5-1 1.4-1.8 2.6-2.1z"/></svg>`;

const cache = {};
function set(id, value) {
  if (cache[id] === value) return false;
  cache[id] = value;
  $(id).textContent = value;
  return true;
}

export function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
}

let toastTimer = 0;
const SCREENS = ['title', 'pause', 'win', 'halted'];

// ── the room map (top-right) ─────────────────────────────────────────────────────────────────────
const map = { rects: new Map(), dot: null, built: false };
function buildMap() {
  const svg = $('hud-map');
  const [x0, y0] = MAP_BOUNDS.min;
  const [x1, y1] = MAP_BOUNDS.max;
  svg.setAttribute('viewBox', `${x0 - 1} ${-y1 - 1} ${x1 - x0 + 2} ${y1 - y0 + 2}`);
  for (const r of ROOMS) {
    const b = r.bounds;
    const rect = document.createElementNS(SVG, 'rect');
    rect.setAttribute('x', b.x0 + 0.7);
    rect.setAttribute('y', -b.y1 + 0.7);
    rect.setAttribute('width', b.x1 - b.x0 - 1.4);
    rect.setAttribute('height', b.y1 - b.y0 - 1.4);
    rect.setAttribute('rx', 1.2);
    rect.setAttribute('fill', AREAS[r.area].accent);
    rect.setAttribute('fill-opacity', '0');
    rect.setAttribute('stroke', 'rgba(239,234,246,0.22)');
    rect.setAttribute('stroke-width', '0.8');
    rect.setAttribute('stroke-dasharray', '2 1.6');
    svg.appendChild(rect);
    map.rects.set(r.id, rect);
    if (r.save) {
      const d = document.createElementNS(SVG, 'circle');
      d.setAttribute('cx', r.save.x);
      d.setAttribute('cy', -r.save.y - 2.2);
      d.setAttribute('r', 1.3);
      d.setAttribute('fill', '#6fd6ff');
      d.setAttribute('opacity', '0');
      svg.appendChild(d);
      map.rects.get(r.id).save = d;
    }
    if (r.boss) {
      const d = document.createElementNS(SVG, 'circle');
      d.setAttribute('cx', r.boss.x);
      d.setAttribute('cy', -r.boss.y - 4);
      d.setAttribute('r', 2);
      d.setAttribute('fill', '#ff5a4a');
      d.setAttribute('opacity', '0');
      svg.appendChild(d);
      map.rects.get(r.id).boss = d;
    }
  }
  map.dot = document.createElementNS(SVG, 'circle');
  map.dot.setAttribute('r', 1.9);
  map.dot.setAttribute('fill', '#fff');
  map.dot.setAttribute('stroke', '#0c0b12');
  map.dot.setAttribute('stroke-width', '0.8');
  svg.appendChild(map.dot);
  map.built = true;
}

export const hud = {
  show(visible) {
    $('hud').classList.toggle('hidden', !visible);
  },
  screen(name) {
    for (const s of SCREENS) $(s).classList.toggle('on', s === name);
  },
  initTitle(footer) {
    $('footer').textContent = footer;
  },
  hearts(n, max) {
    const key = `${n}/${max}`;
    if (cache.hearts === key) return;
    const prev = cache.heartsN;
    cache.hearts = key;
    cache.heartsN = n;
    const el = $('hud-hearts');
    el.innerHTML = Array.from({ length: max }, (_, i) => HEART.replace('<svg', `<svg class="${i < n ? '' : 'lost'}"`)).join('');
    if (prev !== undefined && n < prev) {
      el.classList.remove('hurt');
      void el.offsetWidth;
      el.classList.add('hurt');
    }
  },
  room(room) {
    const a = AREAS[room.area];
    set('hud-area', a.name.toUpperCase());
    set('hud-room', room.name);
    document.documentElement.style.setProperty('--area', a.accent);
  },
  relics(ab) {
    $('relic-dash').classList.toggle('on', !!ab.dash);
    $('relic-boots').classList.toggle('on', !!ab.doubleJump);
  },
  timer(s) {
    set('hud-timer', formatTime(s));
  },
  deaths(n) {
    set('hud-deaths', String(n));
  },
  /** visited: Set of room ids; current: room id; player: {x, y} */
  map(visited, current, player) {
    if (!map.built) buildMap();
    const key = `${[...visited].join(',')}|${current}`;
    if (cache.map !== key) {
      cache.map = key;
      for (const [id, rect] of map.rects) {
        const seen = visited.has(id);
        const here = id === current;
        rect.setAttribute('fill-opacity', here ? '0.85' : seen ? '0.42' : '0');
        rect.setAttribute('stroke', here ? '#fff' : seen ? 'rgba(239,234,246,0.45)' : 'rgba(239,234,246,0.2)');
        rect.setAttribute('stroke-dasharray', seen ? '' : '2 1.6');
        if (rect.save) rect.save.setAttribute('opacity', seen ? '1' : '0');
        if (rect.boss) rect.boss.setAttribute('opacity', seen ? '1' : '0');
      }
      set('hud-map-count', `${visited.size} / ${ROOMS.length} ROOMS`);
    }
    if (player) {
      map.dot.setAttribute('cx', player.x.toFixed(1));
      map.dot.setAttribute('cy', (-player.y - 0.8).toFixed(1));
    }
  },
  boss(visible, frac = 1, enraged = false) {
    const el = $('hud-boss');
    if (cache.bossOn !== visible) {
      cache.bossOn = visible;
      el.classList.toggle('on', visible);
    }
    if (cache.bossRage !== enraged) {
      cache.bossRage = enraged;
      el.classList.toggle('enraged', enraged);
    }
    const f = frac.toFixed(3);
    if (cache.bossFrac !== f) {
      cache.bossFrac = f;
      $('hud-boss-fill').style.transform = `scaleX(${f})`;
    }
  },
  bot(text) {
    const el = $('hud-bot');
    el.hidden = !text;
    el.innerHTML = text || '';
  },
  toast(title, sub = '', kind = '', ms = 1800) {
    const el = $('toast');
    $('toast-title').textContent = title;
    $('toast-sub').textContent = sub;
    el.className = `on ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = kind), ms);
  },
  fade(on) {
    $('fade').classList.toggle('on', on);
  },
  hint(visible) {
    $('hint').classList.toggle('gone', !visible);
  },
  win(stats) {
    $('w-time').textContent = formatTime(stats.time);
    $('w-deaths').textContent = String(stats.deaths);
    $('w-kills').textContent = String(stats.kills);
    $('w-score').textContent = String(stats.score);
  },
  halted(ribbon, title, text, red = false) {
    $('halted-ribbon').textContent = ribbon;
    $('halted-ribbon').classList.toggle('red', red);
    $('halted-title').textContent = title;
    $('halted-text').textContent = text;
  },
};
