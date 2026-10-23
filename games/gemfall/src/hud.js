// DOM HUD + screens. Only touches the DOM when a value changes.
import { gemIconSvg, stoneIconSvg, crownIconSvg, starIconSvg, GEM_CSS } from './gems.js';
import { KIND_PLURALS } from './levels.js';

const $ = (id) => document.getElementById(id);
const cache = {};
function set(id, value) {
  if (cache[id] === value) return false;
  cache[id] = value;
  $(id).textContent = value;
  return true;
}

const SCREENS = ['title', 'pause', 'result', 'failed', 'win', 'gameover', 'halted'];
let calloutTimer = 0;
let toastTimer = 0;
let bannerTimer = 0;
let livePopups = 0;
const handlers = {};

export const fmt = (n) => Math.round(n).toLocaleString('en-US');

export function formatTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s - m * 60)).padStart(2, '0')}`;
}

function goalIcon(goal, size) {
  if (goal.type === 'collect') return gemIconSvg(goal.kind, size);
  if (goal.type === 'stone') return stoneIconSvg(size);
  if (goal.type === 'crown') return crownIconSvg(size);
  return starIconSvg(size);
}

export function goalText(def, need) {
  const g = def.goal;
  if (g.type === 'score') return `Score ${fmt(g.target)} points`;
  if (g.type === 'collect') return `Collect ${g.count} ${KIND_PLURALS[g.kind]}`;
  if (g.type === 'stone') return `Break ${need} stone tiles`;
  return `Bring ${g.count} crowns down`;
}

function goalLabel(def) {
  const g = def.goal;
  if (g.type === 'score') return 'Score';
  if (g.type === 'collect') return KIND_PLURALS[g.kind];
  if (g.type === 'stone') return 'Stones';
  return 'Crowns';
}

function starsHtml(n, max = 3, size = 30) {
  return Array.from({ length: max }, (_, i) => `<span class="star ${i < n ? 'on' : ''}" style="--i:${i}">${starIconSvg(size)}</span>`).join('');
}

export const hud = {
  on(name, fn) {
    handlers[name] = fn;
  },
  bind() {
    $('bst-hammer').addEventListener('click', () => handlers.booster?.('hammer'));
    $('bst-shuffle').addEventListener('click', () => handlers.booster?.('shuffle'));
    $('press').addEventListener('click', () => handlers.start?.());
    for (const id of ['result', 'failed', 'win', 'gameover']) $(id).addEventListener('click', () => handlers.next?.());
    $('pause').addEventListener('click', () => handlers.resume?.());
  },
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
  level(num, def, need) {
    set('hud-level-num', String(num));
    set('hud-level-name', def.name);
    if (cache.goalDef !== def) {
      cache.goalDef = def;
      $('hud-goal-icon').innerHTML = goalIcon(def.goal, 34);
      $('hud-goal-label').textContent = goalLabel(def);
      $('hud-goal-text').textContent = goalText(def, need);
      const [, two, three] = def.stars;
      cache.starMax = three;
      const marks = [def.goal.type === 'score' ? def.stars[0] : three * 0.32, two, three];
      $('hud-starmarks').innerHTML = marks.map((v, i) => `<span class="mark" style="left:${Math.min(97, (v / three) * 100)}%">${starIconSvg(i === 2 ? 22 : 18)}</span>`).join('');
      cache.marks = marks;
    }
  },
  goal(have, need) {
    if (!set('hud-goal-count', `${Math.min(have, need)} / ${need}`)) return;
    $('hud-goal-bar').style.transform = `scaleX(${Math.min(1, have / need).toFixed(3)})`;
    $('hud-goal').classList.toggle('done', have >= need);
  },
  moves(n) {
    if (!set('hud-moves', String(n))) return;
    $('hud-moves-card').classList.toggle('low', n <= 3);
    const el = $('hud-moves');
    el.classList.remove('tick');
    void el.offsetWidth;
    el.classList.add('tick');
  },
  tries(left, max) {
    const key = `${left}/${max}`;
    if (cache.tries === key) return;
    cache.tries = key;
    $('hud-tries').innerHTML = `<span class="lbl">Tries</span>` + Array.from({ length: max }, (_, i) => `<i class="${i < left ? '' : 'lost'}"></i>`).join('');
  },
  score(n, starsEarned) {
    set('hud-score', fmt(n));
    const pct = Math.min(1, n / (cache.starMax || 1));
    const v = pct.toFixed(3);
    if (cache.starFill !== v) {
      cache.starFill = v;
      $('hud-starfill').style.transform = `scaleX(${v})`;
    }
    const lit = String(starsEarned);
    if (cache.lit !== lit) {
      cache.lit = lit;
      [...$('hud-starmarks').children].forEach((m, i) => m.classList.toggle('on', i < starsEarned));
    }
  },
  boosters(b, armed) {
    const key = `${b.hammer}/${b.shuffle}/${armed}`;
    if (cache.boosters === key) return;
    cache.boosters = key;
    $('bst-hammer-n').textContent = String(b.hammer);
    $('bst-shuffle-n').textContent = String(b.shuffle);
    $('bst-hammer').classList.toggle('empty', b.hammer <= 0);
    $('bst-shuffle').classList.toggle('empty', b.shuffle <= 0);
    $('bst-hammer').classList.toggle('armed', !!armed);
    document.body.classList.toggle('hammer-armed', !!armed);
  },
  callout(text, kind = '', ms = 900) {
    const el = $('callout');
    el.textContent = text;
    el.className = '';
    void el.offsetWidth;
    el.className = `on ${kind}`;
    clearTimeout(calloutTimer);
    calloutTimer = setTimeout(() => (el.className = kind), ms);
  },
  toast(text, ms = 1500) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), ms);
  },
  /** a floating "+120" at a screen position */
  popup(x, y, text, color = '#fff', big = false) {
    const el = document.createElement('div');
    el.className = `popup${big ? ' big' : ''}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.color = color;
    $('popups').appendChild(el);
    livePopups++;
    setTimeout(() => {
      el.remove();
      livePopups--;
    }, 900);
  },
  get popups() {
    return livePopups;
  },
  banner(num, def, need, tries, max) {
    $('banner-num').textContent = `Level ${num}`;
    $('banner-name').textContent = def.name;
    $('banner-goal').innerHTML = `${goalIcon(def.goal, 28)}<span>${goalText(def, need)} in <b>${def.moves}</b> moves</span>`;
    $('banner-try').textContent = tries < max ? `Try ${max - tries + 1} of ${max}` : '';
    const el = $('banner');
    el.classList.add('on');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('on'), 1250);
  },
  hideBanner() {
    $('banner').classList.remove('on');
  },
  result(num, def, info) {
    $('r-ribbon').textContent = `LEVEL ${num} COMPLETE`;
    $('r-name').textContent = def.name;
    $('r-stars').innerHTML = starsHtml(info.stars, 3, 56);
    $('r-score').textContent = fmt(info.score);
    $('r-moves').textContent = String(info.movesLeft);
    $('r-bonus').textContent = info.bonus ? `+${fmt(info.bonus)}` : '0';
    $('r-next').innerHTML = info.next ? `Next: <b>Level ${num + 1} · ${info.next.name}</b>` : 'That was the last one';
  },
  failed(num, def, info) {
    $('f-title').textContent = info.cause === 'restart' ? 'Restarting' : 'Out of moves';
    $('f-name').textContent = `Level ${num} · ${def.name}`;
    $('f-goal').innerHTML = `${goalIcon(def.goal, 26)}<span>${Math.min(info.have, info.need)} / ${info.need}</span>`;
    $('f-next').textContent = info.cause === 'restart' ? 'A restart doesn\'t cost a try' : info.triesLeft > 0 ? `${info.triesLeft} ${info.triesLeft === 1 ? 'try' : 'tries'} left` : 'No tries left';
  },
  win(totals) {
    $('w-score').textContent = fmt(totals.score);
    $('w-stars').innerHTML = `${starIconSvg(26)}<b>${totals.stars}</b><span>/ 24</span>`;
    $('w-time').textContent = formatTime(totals.time);
    $('w-fails').textContent = String(totals.fails);
  },
  gameover(num, def, totals) {
    $('g-title').textContent = `Stuck on ${def.name}`;
    $('g-level').textContent = String(num);
    $('g-score').textContent = fmt(totals.score);
    $('g-stars').textContent = String(totals.stars);
    $('g-time').textContent = formatTime(totals.time);
  },
  halted(ribbon, title, text, red = false) {
    $('halted-ribbon').textContent = ribbon;
    $('halted-ribbon').classList.toggle('red', red);
    $('halted-title').textContent = title;
    $('halted-text').textContent = text;
  },
  hint(visible) {
    $('hint').classList.toggle('gone', !visible);
  },
  titleGems() {
    $('title-gems').innerHTML = [0, 1, 2, 3, 4, 5].map((k) => gemIconSvg(k, 34)).join('');
  },
  colors: GEM_CSS,
};
