// DOM HUD + screens. Only touches the DOM when a value actually changes.
import { BIOME_NAMES } from './course.js';

const $ = (id) => document.getElementById(id);
const cache = {};
function set(id, value) {
  if (cache[id] === value) return false;
  cache[id] = value;
  $(id).textContent = value;
  return true;
}

const SCREENS = ['title', 'pause', 'gameover', 'halted'];
const SWATCH = { meadow: '#6cc650', canyon: '#e98a4c', city: '#ff3caa' };
const CAUSE = {
  pipe: (n) => `Bonked pipe ${n}`,
  ground: () => 'Belly-flopped onto the ground',
  ceiling: () => 'Flew off the top of the sky',
};
let toastTimer = 0;

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
  score(n, bump = false) {
    if (!set('score', String(n))) return;
    if (bump) {
      const el = $('score');
      el.classList.remove('bump');
      void el.offsetWidth; // restart the animation
      el.classList.add('bump');
    }
  },
  best(n) {
    set('hud-best', String(n));
  },
  biome(name) {
    if (!set('hud-biome', BIOME_NAMES[name] || name)) return;
    $('hud-swatch').style.background = SWATCH[name] || '#fff';
  },
  toast(text, sub = '', color = '#ffd84a', ms = 1500) {
    const el = $('toast');
    el.innerHTML = '';
    el.append(text);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      el.append(s);
    }
    el.style.background = color;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), ms);
  },
  hint(visible) {
    $('hint').classList.toggle('gone', !visible);
  },
  flash(strength = 0.8, ms = 260) {
    const el = $('flash');
    el.style.transition = 'none';
    el.style.opacity = String(strength);
    void el.offsetWidth;
    el.style.transition = `opacity ${ms}ms ease-out`;
    el.style.opacity = '0';
  },
  gameover({ score, best, newBest, medal, cause, pipe, biome }) {
    $('go-cause').textContent = (CAUSE[cause] || (() => 'Ouch'))(pipe);
    $('go-score').textContent = String(score);
    $('go-best').textContent = String(best);
    $('go-new').hidden = !newBest;
    const m = $('go-medal');
    m.className = `medal ${medal || 'none'}`;
    $('go-mlabel').textContent = medal ? medal.toUpperCase() : 'NO MEDAL';
    $('go-biome').textContent = score >= 10 ? `Made it to the ${BIOME_NAMES[biome]}` : `${10 - score} more for a bronze medal`;
    hud.retryReady(false);
  },
  retryReady(on) {
    $('go-retry').classList.toggle('on', on);
  },
  halted(ribbon, title, text) {
    $('halted-ribbon').textContent = ribbon;
    $('halted-title').textContent = title;
    $('halted-text').textContent = text;
  },
};
