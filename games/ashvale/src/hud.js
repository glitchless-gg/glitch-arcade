// DOM HUD + screens. Only touches the DOM when a value actually changes.
import { RARITY_COLOR, statsOf, describe } from './gear.js';

const $ = (id) => document.getElementById(id);

const cache = {};
function set(id, value) {
  if (cache[id] === value) return false;
  cache[id] = value;
  $(id).textContent = value;
  return true;
}
function style(id, prop, value) {
  const key = `${id}.${prop}`;
  if (cache[key] === value) return;
  cache[key] = value;
  $(id).style[prop] = value;
}

export function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s - m * 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

let toastTimer = 0;
let lootTimer = 0;
let hurt = 0;
let flash = 0;
const SCREENS = ['title', 'pause', 'intermission', 'dead', 'win', 'gameover', 'halted'];
const SLOT_LABEL = { weapon: 'Weapon', armor: 'Armor', ring: 'Ring' };
const CAUSE = { skeleton: 'Cut down by a skeleton', slime: 'Swallowed by a slime', archer: 'Feathered by archers', ash_lord: 'Burned by the Ash Lord' };

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
  bot(text) {
    const el = $('hud-bot');
    el.hidden = !text;
    el.innerHTML = text || '';
  },
  floor(num, name) {
    set('hud-floor-num', String(num));
    set('hud-floor-name', name);
  },
  rooms(cleared, total) {
    set('hud-rooms', `${cleared}/${total}`);
  },
  stairs(open) {
    if (set('hud-stairs-v', open ? 'open' : 'sealed')) $('hud-stairs').classList.toggle('open', open);
  },
  lives(left, max) {
    const key = `${left}/${max}`;
    if (cache.lives === key) return;
    cache.lives = key;
    $('hud-lives').innerHTML = `<span class="lbl">Lives</span>` + Array.from({ length: max }, (_, i) => `<i class="${i < left ? '' : 'lost'}"></i>`).join('');
  },
  gold(n) {
    set('hud-gold', String(n));
  },
  kills(n) {
    set('hud-kills', String(n));
  },
  timer(s) {
    set('hud-timer', formatTime(s));
  },
  vitals(hr) {
    const hp = Math.max(0, Math.ceil(hr.hp));
    set('hp-val', String(hp));
    style('hp-fill', 'transform', `translateY(${(100 - (hp / hr.maxHp) * 100).toFixed(1)}%)`);
    $('orb-hp').classList.toggle('low', hp / hr.maxHp < 0.35);
    const mp = Math.floor(hr.mana);
    set('mp-val', String(mp));
    style('mp-fill', 'transform', `translateY(${(100 - (hr.mana / hr.maxMana) * 100).toFixed(1)}%)`);
  },
  xp(level, frac) {
    set('hud-level', String(level));
    style('xp-bar', 'transform', `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(3)})`);
  },
  /** cooldowns as 0..1 remaining */
  skills({ swing, dodge, nova, potion, potions, noMana }) {
    style('cd-swing', 'transform', `scaleY(${swing.toFixed(2)})`);
    style('cd-dodge', 'transform', `scaleY(${dodge.toFixed(2)})`);
    style('cd-nova', 'transform', `scaleY(${nova.toFixed(2)})`);
    style('cd-potion', 'transform', `scaleY(${potion.toFixed(2)})`);
    set('sk-potion-n', String(potions));
    const key = `${noMana}|${potions === 0}`;
    if (cache.skillState !== key) {
      cache.skillState = key;
      $('sk-nova').classList.toggle('off', noMana);
      $('sk-potion').classList.toggle('off', potions === 0);
    }
  },
  gear(gear) {
    for (const slot of ['weapon', 'armor', 'ring']) {
      const it = gear[slot];
      const key = it ? `${it.id}` : 'none';
      if (cache[`gear-${slot}`] === key) continue;
      cache[`gear-${slot}`] = key;
      const el = $(`gear-${slot}`);
      el.style.setProperty('--r', it ? RARITY_COLOR[it.rarity] : 'rgba(255,255,255,0.15)');
      el.classList.toggle('empty', !it);
      el.classList.remove('pop');
      void el.offsetWidth; // restart the pop animation
      if (it) el.classList.add('pop');
      $(`gear-${slot}-n`).textContent = it ? it.name : `No ${SLOT_LABEL[slot].toLowerCase()}`;
      $(`gear-${slot}-s`).textContent = it ? describe(statsOf(it)) : '—';
    }
  },
  boss(visible, frac = 1, enraged = false) {
    const el = $('boss');
    if (el.hidden === !visible && cache.bossFrac === frac && cache.bossRage === enraged) return;
    el.hidden = !visible;
    cache.bossFrac = frac;
    cache.bossRage = enraged;
    $('boss-bar').style.transform = `scaleX(${Math.max(0, frac).toFixed(3)})`;
    el.classList.toggle('enraged', enraged);
  },
  toast(text, kind = '', ms = 1500) {
    const el = $('toast');
    el.textContent = text;
    el.className = `on ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = kind), ms);
  },
  /** The compare toast when gear is walked over. */
  lootToast(item, verdict, equipped, gold = 0) {
    const el = $('loot-toast');
    const color = RARITY_COLOR[item.rarity];
    const stats = describe(verdict.stats);
    const was = verdict.was ? describe(verdict.was) : 'nothing';
    const pct = Math.round(verdict.gain * 100);
    el.style.setProperty('--r', color);
    el.innerHTML = equipped
      ? `<small>${item.rarity} ${item.slot} · equipped</small><b>${item.name}</b><span>${stats} <em class="up">▲ ${verdict.was ? `+${pct}%` : 'new'}</em> <i>was ${was}</i></span>`
      : `<small>${item.rarity} ${item.slot} · salvaged +${gold} gold</small><b>${item.name}</b><span>${stats} <em class="down">▼ ${Math.abs(pct)}%</em> <i>yours: ${was}</i></span>`;
    el.className = 'on';
    clearTimeout(lootTimer);
    lootTimer = setTimeout(() => (el.className = ''), 2400);
  },
  hint(visible) {
    $('hint').classList.toggle('gone', !visible);
  },
  hurt(amount, max) {
    hurt = Math.min(1, hurt + 0.3 + (amount / max) * 2);
  },
  levelFlash() {
    flash = 1;
  },
  update(dt) {
    if (hurt > 0 || cache.hurtOn) {
      hurt = Math.max(0, hurt - dt * 2.2);
      cache.hurtOn = hurt > 0;
      $('vignette').style.opacity = hurt.toFixed(2);
    }
    if (flash > 0 || cache.flashOn) {
      flash = Math.max(0, flash - dt * 1.6);
      cache.flashOn = flash > 0;
      $('flash').style.opacity = (flash * 0.55).toFixed(2);
    }
  },
  clearFx() {
    hurt = 0;
    flash = 0;
    $('vignette').style.opacity = '0';
    $('flash').style.opacity = '0';
  },
  intermission(floor, stats, next) {
    $('i-ribbon').textContent = `FLOOR ${floor.num} CLEARED`;
    $('i-name').textContent = floor.name;
    $('i-kills').textContent = String(stats.kills);
    $('i-time').textContent = formatTime(stats.time);
    $('i-level').textContent = String(stats.level);
    $('i-gold').textContent = String(stats.gold);
    $('i-next').innerHTML = `Next: <b>Floor ${next.num} · ${next.name}</b> — ${next.blurb}`;
  },
  dead(cause, livesLeft) {
    $('d-cause').textContent = CAUSE[cause] || 'You died';
    $('d-next').textContent = livesLeft > 0 ? `Back to the start of the floor · ${livesLeft} ${livesLeft === 1 ? 'life' : 'lives'} left` : 'No lives left on this floor';
  },
  win(t) {
    $('w-kills').textContent = String(t.kills);
    $('w-time').textContent = formatTime(t.time);
    $('w-level').textContent = String(t.level);
    $('w-deaths').textContent = String(t.deaths);
  },
  gameover(t, floor) {
    $('g-title').textContent = `Fell on ${floor.name}`;
    $('g-kills').textContent = String(t.kills);
    $('g-time').textContent = formatTime(t.time);
    $('g-level').textContent = String(t.level);
    $('g-floor').textContent = String(floor.num);
  },
  halted(ribbon, title, text, red = false) {
    $('halted-ribbon').textContent = ribbon;
    $('halted-ribbon').classList.toggle('red', red);
    $('halted-title').textContent = title;
    $('halted-text').textContent = text;
  },
};
