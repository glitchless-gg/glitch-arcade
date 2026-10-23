// Glitchless wiring. The game only talks to `gd` (exported below); it is a no-op stub until the SDK
// loads, and stays a stub with ?nogd=1 or if the SDK can't be loaded. Telemetry must never break
// the game, so every call is wrapped.
import { params } from './params.js';
import { GAME_VERSION } from './version.js';

export const SERVICE = 'flapjack';

const METHODS = ['levelStart', 'levelComplete', 'levelFail', 'death', 'track', 'setPosition', 'setContext', 'captureMap', 'error', 'flush', 'registerTool'];

let real = null;
const warned = new Set();

/** Game-facing facade. Safe to call before/without the SDK. */
export const gd = { enabled: false };
for (const m of METHODS) {
  gd[m] = (...args) => {
    if (!real || typeof real[m] !== 'function') return undefined;
    try {
      return real[m](...args);
    } catch (err) {
      if (!warned.has(m)) {
        warned.add(m);
        console.warn(`[${SERVICE}] Glitchless.${m} threw — ignoring`, err);
      }
      return undefined;
    }
  };
}

/**
 * Load + init the SDK and instrument the Three.js renderer. Resolves once telemetry is ready (or
 * definitely unavailable). Never rejects.
 */
export async function initTelemetry({ renderer, scene, camera, THREE }) {
  if (params.nogd) {
    console.info(`[${SERVICE}] Glitchless disabled (?nogd=1)`);
    return gd;
  }
  try {
    const sdk = await Promise.race([
      import('./glitchless-sdk.js'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Glitchless SDK load timed out')), 4000)),
    ]);
    const { Glitchless, instrumentThree } = sdk;
    real = Glitchless.init({
      service: SERVICE,
      version: GAME_VERSION,
      env: params.env,
      intake: params.intake,
      clientToken: params.token,
      overlay: true,
      privacy: 'full', // a demo game: it shows heatmaps, replays and player counts, which need positions and a player ID
      sessionType: params.autoplay ? 'synthetic' : 'user',
      dashboardUrl: params.dashboard || 'http://localhost:7777',
    });
    instrumentThree(real, { renderer, scene, camera, THREE });
    gd.enabled = true;
    window.gd = real; // handy for poking at it from the console
  } catch (err) {
    real = null;
    console.warn(`[${SERVICE}] Glitchless SDK unavailable — running without telemetry.`, err);
  }
  return gd;
}

/** End the session the way closing the tab would (the SDK sends session_end on pagehide). */
export function endSession() {
  window.dispatchEvent(new Event('pagehide'));
}
