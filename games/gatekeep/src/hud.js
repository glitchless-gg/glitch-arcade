// DOM HUD and screens. Only touches the DOM when a value actually changes.
import { TOWERS, TOWER_TYPES, upgradeCost, sellValue, towerStats } from './rules.js';

const $ = (id) => document.getElementById(id);

export const ICONS = {
  arrow: `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 4 31 15H9Z" fill="#c8463d" stroke="#7a2019" stroke-width="1.5" stroke-linejoin="round"/><rect x="13" y="15" width="14" height="17" rx="2" fill="#8b5a2b" stroke="#4d2f12" stroke-width="1.5"/><rect x="10" y="31" width="20" height="5" rx="2" fill="#b8b0a3" stroke="#6d675e" stroke-width="1.5"/><path d="M15 22h10" stroke="#f3e2c3" stroke-width="2" stroke-linecap="round"/></svg>`,
  cannon: `<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="9" y="22" width="22" height="13" rx="3" fill="#9aa0a6" stroke="#5a6068" stroke-width="1.5"/><circle cx="20" cy="21" r="7" fill="#2b2f3a"/><path d="M19 18 31 8" stroke="#2b2f3a" stroke-width="7" stroke-linecap="round"/><circle cx="31.5" cy="7.5" r="2.4" fill="#6b7280"/></svg>`,
  frost: `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 28 15 20 27 12 15Z" fill="#8fe3ff" stroke="#2a8fc0" stroke-width="1.5" stroke-linejoin="round"/><path d="M20 3v24M12 15h16" stroke="#e6f9ff" stroke-width="1" opacity=".8"/><path d="M14 30h12l3 6H11Z" fill="#dbe7f2" stroke="#8aa0b5" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
};

const cache = {};
function set(id, value) {
  if (cache[id] === value) return false;
  cache[id] = value;
  $(id).textContent = value;
  return true;
}
function bump(el, cls = 'bump') {
  el.classList.remove('bump', 'hurt');
  void el.offsetWidth;
  el.classList.add(cls);
}

let toastTimer = 0;
let bannerTimer = 0;
const SCREENS = ['title', 'pause', 'over', 'halted'];
const handlers = {};
const on = (name) => (...a) => handlers[name]?.(...a);

export const hud = {
  on(name, fn) {
    handlers[name] = fn;
  },
  init() {
    const pal = $('palette');
    pal.innerHTML = TOWER_TYPES.map(
      (t) => `<button class="card" data-type="${t}" title="${TOWERS[t].blurb}"><kbd>${TOWERS[t].key}</kbd>${ICONS[t]}<div class="name">${TOWERS[t].name}</div><div class="cost">${TOWERS[t].cost}g</div></button>`,
    ).join('');
    pal.querySelectorAll('.card').forEach((el) => el.addEventListener('click', () => on('palette')(el.dataset.type)));
    const menu = $('build-menu');
    menu.innerHTML = TOWER_TYPES.map((t) => `<button data-type="${t}" title="${TOWERS[t].name}: ${TOWERS[t].blurb}"><kbd>${TOWERS[t].key}</kbd>${ICONS[t]}<span class="cost">${TOWERS[t].cost}g</span></button>`).join('');
    menu.querySelectorAll('button').forEach((el) => {
      el.addEventListener('click', () => on('menu')(el.dataset.type));
      el.addEventListener('pointerenter', () => on('menuHover')(el.dataset.type));
      el.addEventListener('pointerleave', () => on('menuHover')(null));
    });
    $('next-wave').addEventListener('click', on('next'));
    $('btn-speed').addEventListener('click', on('speed'));
    $('btn-pause').addEventListener('click', on('pause'));
    $('tp-upgrade').addEventListener('click', on('upgrade'));
    $('tp-sell').addEventListener('click', on('sell'));
    $('title').addEventListener('click', on('start'));
    $('over').addEventListener('click', on('again'));
    $('pause').addEventListener('click', on('pause'));
  },
  initTitle(footer) {
    const logo = $('logo');
    logo.innerHTML = [...logo.textContent].map((ch, i) => `<span style="animation-delay:${i * 0.07}s">${ch}</span>`).join('');
    $('footer').textContent = footer;
  },
  show(visible) {
    $('hud').classList.toggle('hidden', !visible);
  },
  screen(name) {
    for (const s of SCREENS) $(s).classList.toggle('on', s === name);
  },
  wave(n, total) {
    set('hud-wave', String(n));
    set('hud-waves', String(total));
  },
  lives(n) {
    const prev = cache['hud-lives'];
    if (set('hud-lives', String(n)) && prev !== undefined && Number(prev) > n) bump($('hud-lives-chip'), 'hurt');
  },
  gold(n) {
    const prev = cache['hud-gold'];
    if (set('hud-gold', String(n)) && prev !== undefined && Number(prev) < n) bump($('hud-gold-chip'));
    const key = TOWER_TYPES.map((t) => (n >= TOWERS[t].cost ? 1 : 0)).join('');
    if (cache.afford !== key) {
      cache.afford = key;
      document.querySelectorAll('#palette .card').forEach((el) => el.classList.toggle('poor', n < TOWERS[el.dataset.type].cost));
      document.querySelectorAll('#build-menu button').forEach((el) => (el.disabled = n < TOWERS[el.dataset.type].cost));
    }
  },
  /** the top-center button: a countdown you can cut short during build, a counter during a wave */
  nextWave({ phase, wave, left, bonus, enemies }) {
    const btn = $('next-wave');
    const fighting = phase !== 'build';
    if (cache.fighting !== fighting) {
      cache.fighting = fighting;
      btn.classList.toggle('fighting', fighting);
    }
    if (phase === 'build') {
      set('nw-text', `Wave ${wave} in ${Math.ceil(left)}s · call now`);
      set('nw-bonus', `+${bonus}g`);
    } else if (phase === 'wave') set('nw-text', `Wave ${wave} · ${enemies} ${enemies === 1 ? 'enemy' : 'enemies'} left`);
    else set('nw-text', phase === 'won' ? 'All waves cleared' : 'The gate has fallen');
  },
  speed(fast) {
    if (cache.fast === fast) return;
    cache.fast = fast;
    $('btn-speed').classList.toggle('on', fast);
    $('speed-label').textContent = fast ? '2x' : '1x';
  },
  armed(type) {
    if (cache.armed === type) return;
    cache.armed = type;
    document.querySelectorAll('#palette .card').forEach((el) => el.classList.toggle('armed', el.dataset.type === type));
  },
  towerPanel(tower, gold) {
    const el = $('tower-panel');
    if (!tower) {
      if (cache.tp !== null) {
        cache.tp = null;
        el.hidden = true;
      }
      return;
    }
    const st = towerStats(tower.type, tower.tier);
    const up = upgradeCost(tower);
    const key = `${tower.id}|${tower.tier}|${tower.kills}|${gold >= (up ?? Infinity)}`;
    if (cache.tp === key) return;
    cache.tp = key;
    el.hidden = false;
    $('tp-icon').innerHTML = ICONS[tower.type];
    $('tp-name').textContent = `${TOWERS[tower.type].name} tower`;
    $('tp-tier').innerHTML = [1, 2, 3].map((i) => `<span class="${i <= tower.tier ? '' : 'off'}">★</span>`).join('');
    const dps = tower.type === 'frost' ? `${Math.round((1 - st.slow) * 100)}%` : (1 / st.rate).toFixed(1);
    $('tp-dmg').textContent = String(st.dmg);
    $('tp-rate').textContent = dps;
    $('tp-rate').nextElementSibling.textContent = tower.type === 'frost' ? 'SLOW' : 'PER SEC';
    $('tp-range').textContent = st.range.toFixed(1);
    $('tp-kills').textContent = String(tower.kills);
    const upBtn = $('tp-upgrade');
    upBtn.disabled = up === null || gold < up;
    $('tp-up-text').textContent = up === null ? 'Max tier' : `Upgrade ${up}g`;
    $('tp-sell-text').textContent = `Sell +${sellValue(tower)}g`;
  },
  buildMenu(open, x = 0, y = 0) {
    const el = $('build-menu');
    if (!open) {
      if (!el.hidden) el.hidden = true;
      return;
    }
    el.hidden = false;
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  },
  toast(text, kind = '', ms = 1300) {
    const el = $('toast');
    el.textContent = text;
    el.className = `on ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = kind), ms);
  },
  banner(title, sub = '', ms = 1500) {
    $('banner-title').textContent = title;
    const s = $('banner-sub');
    s.textContent = sub;
    s.hidden = !sub;
    const el = $('banner');
    el.classList.add('on');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('on'), ms);
  },
  hint(visible) {
    $('hint').classList.toggle('gone', !visible);
  },
  bot(text) {
    const el = $('hud-bot');
    el.hidden = !text;
    el.innerHTML = text || '';
  },
  over(win, stats) {
    $('over-ribbon').textContent = win ? 'VICTORY' : 'DEFEAT';
    $('over-ribbon').classList.toggle('bad', !win);
    $('over-title').textContent = win ? 'The gate holds!' : 'The gate has fallen';
    $('over-title').classList.toggle('bad', !win);
    $('o-wave').textContent = `${stats.wave}/10`;
    $('o-lives').textContent = String(stats.lives);
    $('o-kills').textContent = String(stats.kills);
    $('o-towers').textContent = String(stats.towers);
    $('over-why').textContent = stats.why || '';
  },
  halted(ribbon, title, text) {
    $('halted-ribbon').textContent = ribbon;
    $('halted-title').textContent = title;
    $('halted-text').textContent = text;
  },
};
