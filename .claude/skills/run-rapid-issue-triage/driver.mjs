#!/usr/bin/env node
// Driver for rapid-issue-triage: builds nothing, but launches the binary,
// seeds an offline workspace, and drives the embedded SPA with Playwright.
//
//   node .claude/skills/run-rapid-issue-triage/driver.mjs smoke
//   node .claude/skills/run-rapid-issue-triage/driver.mjs repl   (stdin commands)
//
// Everything lives under a sandbox dir (default .run-sandbox/) so the real
// ~/.rapid-triage/triage.db is never touched.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { seed } from './fixture.mjs';

// playwright is installed globally in this image, not in web/node_modules, so
// a bare `import 'playwright'` does not resolve from the repo.
const PW = process.env.PLAYWRIGHT_ENTRY || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

const REPO = path.resolve(import.meta.dirname, '../../..');
const SANDBOX = path.resolve(process.env.RT_SANDBOX || path.join(REPO, '.run-sandbox'));
const SHOTS = path.join(SANDBOX, 'shots');
const DB = path.join(SANDBOX, 'triage.db');
const CONFIG = path.join(SANDBOX, 'rapid-triage.yaml');
const LOG = path.join(SANDBOX, 'server.log');
const PIDFILE = path.join(SANDBOX, 'server.pid');
const PORT = Number(process.env.RT_PORT || 7333);
const BASE = `http://127.0.0.1:${PORT}`;

const log = (...a) => console.log('[driver]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portOpen() {
  return new Promise((res) => {
    const s = net.connect(PORT, '127.0.0.1');
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
  });
}

async function waitFor(fn, what, ms = 20000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}

// --- server lifecycle -------------------------------------------------------

function writeConfig() {
  fs.mkdirSync(SANDBOX, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(CONFIG, [
    `addr: 127.0.0.1:${PORT}`,
    `db_path: ${DB}`,
    'sync:',
    // Long interval: every sync attempt fails offline and just spams the log.
    '  interval: 24h',
    'ai:',
    '  enabled: true',
    '  command: claude',
    '  prefetch: 0',
    '',
  ].join('\n'));
}

async function startServer() {
  if (await portOpen()) { log(`server already up on ${BASE}`); return null; }
  writeConfig();
  const bin = path.join(REPO, 'triage');
  if (!fs.existsSync(bin)) throw new Error(`${bin} not built — run \`make build\` first`);
  const out = fs.openSync(LOG, 'a');
  const p = spawn(bin, ['-no-open', '-config', CONFIG], {
    cwd: REPO,
    stdio: ['ignore', out, out],
    // A fake key is enough to get past the startup check. The sync then fails
    // auth and the UI degrades to "stale", which is the designed behaviour.
    env: { ...process.env, LINEAR_API_KEY: process.env.LINEAR_API_KEY || 'lin_api_offline_fixture' },
    detached: true,
  });
  p.unref();
  fs.writeFileSync(PIDFILE, String(p.pid));
  await waitFor(portOpen, `${BASE} to accept connections`);
  log(`server up on ${BASE} (pid ${p.pid}, log ${LOG})`);
  return p.pid;
}

// Kill by recorded pid, plus any orphan that is still running this repo's
// binary. Never `pkill -f triage`: that pattern also matches the shell command
// that invoked this driver, so pkill kills its own caller.
function stopServer() {
  const pids = new Set();
  if (fs.existsSync(PIDFILE)) {
    pids.add(Number(fs.readFileSync(PIDFILE, 'utf8').trim()));
    fs.rmSync(PIDFILE, { force: true });
  }
  // A server started by an earlier driver run (or by hand) leaves no usable
  // pidfile once the sandbox is wiped, so match on the exe symlink instead.
  const bin = path.join(REPO, 'triage');
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try { if (fs.readlinkSync(`/proc/${d}/exe`) === bin) pids.add(Number(d)); } catch { /* gone or not ours */ }
  }
  if (!pids.size) { log('no triage process running'); return; }
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); log('stopped pid', pid); }
    catch (e) { log(`pid ${pid} not running (${e.code})`); }
  }
}

// --- browser ----------------------------------------------------------------

let browser, page;
const consoleErrors = [];

async function openBrowser() {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  return page;
}

async function goto(hash = '') {
  await page.goto(BASE + (hash ? `/#/${hash.replace(/^#?\/?/, '')}` : '/'),
    { waitUntil: 'networkidle' });
}

async function shot(name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: f, fullPage: false });
  log('shot', f);
  return f;
}

// Keyboard shortcuts are bound on window, so focus must not sit in an input.
async function key(k) {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press(k);
  await sleep(400);
}

const cardTitle = () =>
  page.evaluate(() => document.querySelector('h1, h2, [class*="title"]')?.textContent?.trim() ?? '');

const bodyText = () => page.evaluate(() => document.body.innerText);

// --- commands ---------------------------------------------------------------

async function cmdSeed() {
  writeConfig();
  const running = await portOpen();
  // store.Open runs its DDL at startup; seeding a path that has never been
  // opened would hit "no such table". Boot once to create the schema.
  if (!running) { await startServer(); await sleep(300); }
  const n = seed(DB);
  log(`seeded ${n.issues} issues, ${n.macros} macros into ${DB}`);
}

async function cmdSmoke() {
  writeConfig(); // also creates the sandbox dirs when adopting a running server
  const started = await startServer();
  seed(DB);
  // startServer adopts anything already listening on the port. If that process
  // is a different triage instance it is reading a different database, so the
  // seed lands somewhere the UI never looks and every step fails obscurely.
  const q = await (await fetch(`${BASE}/api/queue?limit=1`)).json();
  if (!q.issues?.length) {
    throw new Error(started === null
      ? `something else is already serving ${BASE} against another database. ` +
        `Stop it, or re-run with RT_PORT=7334.`
      : 'seeded the database but /api/queue is empty');
  }
  await openBrowser();

  const steps = [];
  const step = async (name, fn) => {
    const r = await fn();
    steps.push(`${name}: ${r}`);
    log(`✓ ${name} — ${r}`);
  };

  await goto();
  await step('deck loads', async () => {
    await page.waitForSelector('text=ENG-', { timeout: 15000 });
    await shot('01-card');
    const t = await bodyText();
    const m = t.match(/ENG-\d+/);
    return `first card ${m?.[0]}`;
  });

  await step('failed sync degrades, does not break the UI', async () => {
    const s = await (await fetch(`${BASE}/api/sync/status`)).json();
    // The fake key makes every sync fail. The invariant is that the UI keeps
    // serving from sqlite anyway: state=error but issueCount still > 0.
    if (s.state !== 'error') throw new Error(`expected state=error, got ${s.state}`);
    if (!s.issueCount) throw new Error('queue empty — seeding did not take');
    return `state=${s.state} issueCount=${s.issueCount}`;
  });

  await step('sqlite-backed endpoints work; Linear passthroughs 502', async () => {
    // The load-bearing split: everything the triage loop needs is served from
    // sqlite and works offline. Exactly two routes still call Linear live, so
    // they 502 with a fake key. If one of the "local" routes starts failing
    // here, something moved off the local index.
    const code = async (p) => (await fetch(BASE + p)).status;
    const local = ['/api/meta', '/api/queue', '/api/report', '/api/macros',
      '/api/filter', '/api/enrich/settings', '/api/issues/iss-1'];
    const live = ['/api/views', '/api/issues/iss-1/context'];
    for (const p of local) {
      const c = await code(p);
      if (c !== 200) throw new Error(`${p} expected 200, got ${c}`);
    }
    for (const p of live) {
      const c = await code(p);
      if (c !== 502) throw new Error(`${p} expected 502 offline, got ${c}`);
    }
    return `${local.length} local 200, ${live.length} live 502`;
  });

  await step('space expands the description', async () => {
    await key('Space');
    await shot('02-expanded');
    return 'expanded';
  });

  await step('skip (S) advances the deck', async () => {
    const before = await bodyText();
    const id = before.match(/ENG-\d+/)[0];
    await key('Space'); // collapse first
    await key('s');
    await page.waitForFunction(
      (prev) => !document.body.innerText.includes(prev), id, { timeout: 10000 });
    await shot('03-after-skip');
    const now = (await bodyText()).match(/ENG-\d+/)[0];
    return `${id} → ${now}`;
  });

  await step('? opens the help overlay', async () => {
    await key('?');
    // 'Skip'/'Snooze' also appear on the card itself, so anchor on the
    // dialog's own <h2> instead of loose body text.
    await page.waitForSelector('h2:text-is("Keyboard shortcuts")', { timeout: 5000 });
    await shot('04-help');
    await key('Escape');
    return 'overlay shown';
  });

  await step('reports route renders', async () => {
    // The route is 'reports'; anything unrecognised silently falls back to
    // the triage page, so a typo here looks like a passing test.
    await goto('reports');
    await page.waitForSelector('h1:text-is("Reports")', { timeout: 10000 });
    await shot('05-report');
    return 'report page';
  });

  await step('settings route renders', async () => {
    await goto('settings');
    await page.waitForSelector('h1:text-is("Enrichment settings")', { timeout: 10000 });
    await shot('06-settings');
    return 'settings page';
  });

  await step('macros route renders', async () => {
    await goto('macros');
    await page.waitForSelector('h1:text-is("Macros")', { timeout: 10000 });
    await shot('07-macros');
    return 'macros page';
  });

  await browser.close();
  console.log('\n--- smoke summary ---');
  steps.forEach((s) => console.log('  ✓', s));
  // The SPA logs a fetch error for the failing sync; that one is expected.
  // Expected offline noise: the failing sync, and the 502s from the two
  // routes that proxy to Linear (/api/views, /api/issues/{id}/context).
  const unexpected = consoleErrors.filter(
    (e) => !/sync|Authentication|Failed to fetch|502|Bad Gateway/i.test(e));
  if (unexpected.length) {
    console.log('\nunexpected console errors:');
    unexpected.forEach((e) => console.log('  !', e));
    process.exitCode = 1;
  }
  console.log(`\nscreenshots: ${SHOTS}`);
}

async function cmdRepl() {
  await startServer();
  await openBrowser();
  await goto();
  log('repl ready. commands: goto <hash> | shot <name> | key <K> | click <sel> | text | eval <js> | seed | quit');
  const rl = createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(' ');
    try {
      switch (cmd) {
        case '': break;
        case 'goto': await goto(arg); log('at', page.url()); break;
        case 'shot': await shot(arg || `shot-${Date.now()}`); break;
        case 'key': await key(arg); log('pressed', arg); break;
        case 'click': await page.click(arg); await sleep(300); log('clicked', arg); break;
        case 'text': console.log(await bodyText()); break;
        case 'title': console.log(await cardTitle()); break;
        case 'eval': console.log(JSON.stringify(await page.evaluate(`(()=>(${arg}))()`))); break;
        case 'seed': log(JSON.stringify(seed(DB))); await page.reload(); break;
        case 'errors': console.log(consoleErrors.join('\n') || '(none)'); break;
        case 'quit': await browser.close(); rl.close(); return;
        default: log('unknown command:', cmd);
      }
    } catch (e) {
      log('ERROR:', e.message);
    }
    console.log('[ready]');
  }
  await browser.close();
}

const [, , cmd = 'smoke'] = process.argv;
switch (cmd) {
  case 'start': await startServer(); break;
  case 'stop': await stopServer(); log('stopped'); break;
  case 'seed': await cmdSeed(); break;
  case 'smoke': await cmdSmoke(); break;
  case 'repl': await cmdRepl(); break;
  default:
    console.error('usage: driver.mjs [start|stop|seed|smoke|repl]');
    process.exit(2);
}
