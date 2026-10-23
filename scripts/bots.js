#!/usr/bin/env node
// Autoplay bots: real Chrome windows playing a game with ?autoplay=1, so the telemetry is genuine (the
// games tag it session_type "synthetic"). This is how each game's dashboard got its data.
//
//   npm run blastpit                                              # in one terminal
//   npm run bots -- --game http://localhost:5176/ --parallel 1    # 20 bots, skills 0.3 to 0.95
//   npm run bots -- --game http://localhost:5179/ --bots 6 --headed
//
// Each bot gets a seed (--seed, then +1 per bot) and a skill spread over 0.3–0.95, and plays until the
// game sets window.__GLITCHLESS_PLAYTEST_DONE__ (it won, lost for good, or rage quit) or --max seconds.
// Run few at once (--parallel): bots share your GPU, and a crowded GPU shows up as stutter in the data.

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
};
const GAME = flag('game', null);
if (!GAME) {
  console.error('usage: npm run bots -- --game http://localhost:5176/ [--bots 20] [--parallel 2] [--seed 5000] [--max 240] [--intake URL] [--token gl_pub_…] [--headed]');
  process.exit(1);
}
const N = Number(flag('bots', 20));
const SEED = Number(flag('seed', 5000));
const MAX_S = Number(flag('max', 240));
const LEVEL = flag('level', null);
const intake = flag('intake', null);
const token = flag('token', null);
const headed = !!flag('headed', false);

const browser = await chromium.launch({
  headless: !headed,
  channel: flag('channel', 'chrome'), // your installed Chrome = your real GPU; --channel chromium for Playwright's build
  args: [...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

async function bot(i) {
  const skill = (0.3 + ((i * 0.37) % 0.65)).toFixed(2);
  const qs = new URLSearchParams({ autoplay: '1', skill, seed: String(SEED + i), env: 'prod' });
  if (LEVEL) qs.set('level', LEVEL);
  if (intake) qs.set('intake', intake);
  if (token) qs.set('token', token);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const started = Date.now();
  await page.goto(`${GAME}?${qs}`);
  while (Date.now() - started < MAX_S * 1000) {
    await page.waitForTimeout(2000);
    if (await page.evaluate(() => window.__GLITCHLESS_PLAYTEST_DONE__).catch(() => true)) break;
  }
  const stats = await page.evaluate(() => ({ session: window.__GLITCHLESS__?.sessionId, level: window.__GLITCHLESS__?.level, deaths: window.__GLITCHLESS__?.stats.deaths, errors: window.__GLITCHLESS__?.stats.errors })).catch(() => ({}));
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))).catch(() => {});
  await page.waitForTimeout(500);
  await ctx.close();
  console.log(`bot ${i} skill=${skill} seed=${SEED + i} → ${JSON.stringify(stats)} in ${Math.round((Date.now() - started) / 1000)}s`);
}

const pool = Math.min(N, Number(flag('parallel', 2)));
let next = 0;
await Promise.all(
  Array.from({ length: pool }, async () => {
    while (next < N) await bot(next++);
  }),
);
// Chrome can hang on close after a long run: don't let that hold the shell.
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
process.exit(0);
