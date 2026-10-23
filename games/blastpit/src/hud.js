// DOM HUD + screens. Only touches the DOM when a value actually changes.
const $ = (id) => document.getElementById(id);

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

function pct(hits, shots) {
  return shots ? `${Math.round((hits / shots) * 100)}%` : '–';
}

let toastTimer = 0;
let hitTimer = 0;
let damage = 0;
const SCREENS = ['title', 'pause', 'intermission', 'dead', 'win', 'gameover', 'halted'];

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
  round(num, name) {
    set('hud-round-num', String(num));
    set('hud-round-name', name);
  },
  kills(n) {
    set('hud-kills', String(n));
  },
  hostiles(n) {
    set('hud-hostiles', String(n));
  },
  tries(left, max) {
    const key = `${left}/${max}`;
    if (cache.tries === key) return;
    cache.tries = key;
    $('hud-tries').innerHTML = `<span class="lbl">Tries</span>` + Array.from({ length: max }, (_, i) => `<i class="${i < left ? '' : 'lost'}"></i>`).join('');
  },
  timer(s) {
    set('hud-timer', formatTime(s));
  },
  health(hp) {
    const v = Math.max(0, Math.ceil(hp));
    if (!set('hud-hp', String(v))) return;
    const bar = $('hud-hp-bar');
    bar.style.transform = `scaleX(${(v / 100).toFixed(3)})`;
    const col = v > 60 ? '#4dff9a' : v > 30 ? '#ffb020' : '#ff4058';
    bar.style.background = col;
    bar.style.boxShadow = `0 0 10px ${col}`;
    $('hud-hp-chip').classList.toggle('low', v <= 30);
  },
  weapon(name, label, ammo, all) {
    set('hud-weapon', label);
    set('hud-ammo', ammo === null ? '∞' : String(ammo));
    $('hud-ammo').classList.toggle('inf', ammo === null);
    if (cache.weaponOn !== name) {
      cache.weaponOn = name;
      for (const w of ['pistol', 'shotgun', 'launcher']) $(`slot-${w}`).classList.toggle('on', w === name);
    }
    set('slot-shotgun-a', String(all.shells));
    set('slot-launcher-a', String(all.rockets));
    $('slot-shotgun').classList.toggle('empty', all.shells <= 0);
    $('slot-launcher').classList.toggle('empty', all.rockets <= 0);
  },
  hitmark(kill) {
    const el = $('hitmark');
    el.classList.toggle('kill', !!kill);
    el.classList.add('on');
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => el.classList.remove('on'), kill ? 220 : 110);
  },
  damage(amount) {
    damage = Math.min(1, damage + 0.25 + amount / 40);
  },
  updateDamage(dt) {
    if (damage <= 0 && cache.dmg === 0) return;
    damage = Math.max(0, damage - dt * 1.8);
    const v = Math.round(damage * 100) / 100;
    if (cache.dmg !== v) {
      cache.dmg = v;
      $('damage').style.opacity = String(v);
    }
  },
  clearDamage() {
    damage = 0;
    cache.dmg = 0;
    $('damage').style.opacity = '0';
  },
  bot(text) {
    const el = $('hud-bot');
    el.hidden = !text;
    el.innerHTML = text || '';
  },
  toast(text, kind = '', ms = 1300) {
    const el = $('toast');
    el.textContent = text;
    el.className = `on ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = kind), ms);
  },
  hint(visible) {
    $('hint').classList.toggle('gone', !visible);
  },
  intermission(round, stats, next) {
    $('i-ribbon').textContent = `ROUND ${round.num} CLEAR`;
    $('i-name').textContent = round.name;
    $('i-kills').textContent = String(stats.kills);
    $('i-time').textContent = formatTime(stats.time);
    $('i-acc').textContent = pct(stats.hits, stats.shots);
    $('i-hp').textContent = String(Math.max(0, Math.ceil(stats.hp)));
    $('i-next').innerHTML = next ? `Next: <b>Round ${next.num} · ${next.name}</b> — ${next.blurb}` : '';
  },
  dead(cause, triesLeft) {
    const who = { grunt: 'A grunt got you', gunner: 'Gunner orb to the face', swarmer: 'The swarm got you', own_rocket: 'Your own rocket' };
    $('d-cause').textContent = who[cause] || 'You died';
    $('d-next').textContent = triesLeft > 0 ? `Restarting the round · ${triesLeft} ${triesLeft === 1 ? 'try' : 'tries'} left` : 'No tries left';
  },
  win(stats) {
    $('w-kills').textContent = String(stats.kills);
    $('w-time').textContent = formatTime(stats.time);
    $('w-acc').textContent = pct(stats.hits, stats.shots);
    $('w-deaths').textContent = String(stats.deaths);
  },
  gameover(stats, round) {
    $('g-title').textContent = `Out of tries on ${round.name}`;
    $('g-kills').textContent = String(stats.kills);
    $('g-time').textContent = formatTime(stats.time);
    $('g-acc').textContent = pct(stats.hits, stats.shots);
    $('g-round').textContent = String(round.num);
  },
  halted(ribbon, title, text) {
    $('halted-ribbon').textContent = ribbon;
    $('halted-title').textContent = title;
    $('halted-text').textContent = text;
  },
};
