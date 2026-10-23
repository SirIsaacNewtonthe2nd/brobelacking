// Entry point: input, menus, settings UI and the fixed-tick game loop.
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Sound } from './audio.js';
import { Hud } from './hud.js';
import { loadSettings, saveSettings, DEFAULTS } from './settings.js';
import { DT, YAW_PER_COUNT } from './config.js';
import { WEAPONS } from './weapons.js';

const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);

const settings = loadSettings();
const game = new Game();
const canvas = $('view');
const renderer = new Renderer(canvas, game, settings);
const sound = new Sound();
sound.setVolume(settings.volume);
const hud = new Hud(game, renderer, settings);

let running = false;
let paused = true;
let locked = false;
let acc = 0;
let last = performance.now();
let walkToggled = false;
let crouchToggled = false;
let settingsReturn = 'menu';
const keys = new Set();
const mouse = [false, false, false];
const look = { dx: 0, dy: 0 };

const isPlayer = (who) => who === game.player;

// ---- sound hooks ----
game.on('shot', ({ who, gun }) => sound.gunshot(gun.def, isPlayer(who) ? null : who.eye()));
game.on('footstep', ({ who }) => sound.footstep(isPlayer(who) ? null : who.pos, isPlayer(who)));
game.on('land', ({ who }) => sound.land(isPlayer(who) ? null : who.pos, isPlayer(who)));
game.on('hit', ({ attacker, target, part, killed }) => {
  if (isPlayer(attacker) && !isPlayer(target)) sound.hitConfirm(part, killed);
  if (isPlayer(target)) sound.hurt(part === 'head');
});
game.on('reload', ({ who, gun }) => { if (isPlayer(who)) sound.reload(gun.def); });
game.on('dry', ({ who }) => { if (isPlayer(who)) sound.click(0, 0.3); });
game.on('equip', ({ who }) => { if (isPlayer(who)) sound.equip(); });
game.on('swing', ({ who, heavy }) => { if (isPlayer(who)) sound.swing(heavy); });
game.on('end', () => showEnd());

// ---- pointer lock ----
async function lock() {
  try {
    await canvas.requestPointerLock({ unadjustedMovement: true });
  } catch {
    try { await canvas.requestPointerLock(); } catch { $('pause-hint').textContent = 'Click Resume again to capture the mouse.'; }
  }
}

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) { $('pause-hint').textContent = ''; return; }
  if (running && !paused && game.state === 'playing') pause();
});
document.addEventListener('pointerlockerror', () => { $('pause-hint').textContent = 'Click Resume again to capture the mouse.'; });

function releaseInputs() {
  keys.clear();
  mouse.fill(false);
}

function pause() {
  paused = true;
  releaseInputs();
  if (hud.buyOpen) toggleBuy(false);
  $('scoreboard').hidden = true;
  show('pause');
}

function resume() {
  sound.init();
  show(null);
  paused = false;
  acc = 0;
  lock();
}

function show(id) {
  for (const o of ['menu', 'pause', 'settings', 'end']) $(o).hidden = o !== id;
  $('hud').hidden = !running;
}

// ---- input ----
const CROUCH_KEYS = ['ControlLeft', 'KeyC'];
const WALK_KEYS = ['ShiftLeft', 'ShiftRight'];
const GAME_KEYS = new Set(['Tab', 'Space', 'F3', 'Backquote', 'ControlLeft', 'KeyB', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

addEventListener('keydown', (e) => {
  if (!running || paused) return;
  if (GAME_KEYS.has(e.code) || e.ctrlKey) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  const p = game.player, inp = p.input;
  if (e.code === 'KeyB') { toggleBuy(); return; }
  if (e.code === 'Tab') { $('scoreboard').hidden = false; return; }
  if (e.code === 'F3' || e.code === 'Backquote') { settings.debug = !settings.debug; saveSettings(settings); return; }
  if (WALK_KEYS.includes(e.code) && settings.walkMode === 'toggle') walkToggled = !walkToggled;
  if (CROUCH_KEYS.includes(e.code) && settings.crouchMode === 'toggle') crouchToggled = !crouchToggled;
  if (!p.alive) return;
  if (e.code === 'Space') inp.jump = true;
  if (e.code === 'KeyR') inp.reload = true;
  if (e.code === 'Digit1') p.equip('primary', game.time);
  if (e.code === 'Digit2') p.equip('secondary', game.time);
  if (e.code === 'Digit3') p.equip('melee', game.time);
  if (e.code === 'KeyQ') p.equip(p.prevSlot, game.time);
});

addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Tab') $('scoreboard').hidden = true;
});

addEventListener('blur', releaseInputs);

document.addEventListener('mousedown', (e) => {
  if (!locked || paused) return;
  if (hud.buyOpen) { if (e.button === 0) clickBuy(); return; }
  mouse[e.button] = true;
  const p = game.player;
  if (!p.alive) return;
  if (e.button === 0) p.input.firePressed = true;
  if (e.button === 2) p.input.altPressed = true;
});
document.addEventListener('mouseup', (e) => { mouse[e.button] = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('mousemove', (e) => {
  if (!locked || paused) return;
  if (hud.buyOpen) {
    hud.cursor.x = Math.min(innerWidth - 2, Math.max(0, hud.cursor.x + e.movementX));
    hud.cursor.y = Math.min(innerHeight - 2, Math.max(0, hud.cursor.y + e.movementY));
    return;
  }
  const p = game.player;
  if (!p || !p.alive) return;
  const gun = p.gun;
  const zoom = gun.adsT > 0.5 ? gun.targetZoom() : 1;
  // Same scale as Valorant: 0.07 degrees per count times sensitivity; zoomed views scale by 1/zoom.
  let deg = YAW_PER_COUNT * settings.sensitivity;
  if (zoom > 1) deg *= settings.zoomSensMult / zoom;
  p.yaw -= e.movementX * deg * DEG;
  p.pitch -= e.movementY * deg * DEG * (settings.invertY ? -1 : 1);
  p.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, p.pitch));
  look.dx += e.movementX;
  look.dy += e.movementY;
});

addEventListener('wheel', (e) => {
  if (!locked || paused || hud.buyOpen) return;
  const p = game.player;
  if (!p.alive) return;
  if (settings.wheel === 'jump') { p.input.jump = true; return; }
  const order = ['primary', 'secondary', 'melee'].filter(s => p.inv[s]);
  const i = order.indexOf(p.slot);
  p.equip(order[(i + (e.deltaY > 0 ? 1 : -1) + order.length) % order.length], game.time);
}, { passive: true });

function playerInput() {
  const p = game.player, i = p.input;
  const k = (c) => keys.has(c);
  if (!p.alive) { i.fwd = i.side = 0; i.fire = i.alt = false; return; }
  i.fwd = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
  i.side = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
  i.walk = settings.walkMode === 'toggle' ? walkToggled : WALK_KEYS.some(k);
  i.crouch = settings.crouchMode === 'toggle' ? crouchToggled : CROUCH_KEYS.some(k);
  i.fire = mouse[0] && !hud.buyOpen;
  i.alt = mouse[2] && !hud.buyOpen;
}

// ---- buy menu (virtual cursor so the mouse stays captured) ----
function toggleBuy(open = !hud.buyOpen) {
  hud.buyOpen = open;
  $('buy').hidden = !open;
  $('cursor').hidden = !open;
  hud.cursor = { x: innerWidth / 2, y: innerHeight / 2 };
  hud.markLoadout(settings.loadout);
  mouse.fill(false);
}

function clickBuy() {
  const el = document.elementFromPoint(hud.cursor.x, hud.cursor.y)?.closest('.card, #buy-close');
  if (!el) return;
  if (el.id === 'buy-close') { toggleBuy(false); return; }
  const w = WEAPONS[el.dataset.id];
  settings.loadout[w.slot] = w.id;
  saveSettings(settings);
  const p = game.player;
  p.loadout = { ...settings.loadout };
  if (p.alive) {
    p.give(w.id);
    p.equip(w.slot, game.time, true);
  }
  hud.markLoadout(settings.loadout);
}

// ---- match flow ----
function startMatch() {
  sound.init();
  game.start({
    botCount: settings.botCount,
    difficulty: settings.difficulty,
    botMode: settings.botMode,
    botWeapons: settings.botWeapons,
    killLimit: settings.killLimit,
    timeLimit: settings.timeMinutes * 60,
    loadout: { ...settings.loadout },
  });
  game.player.adsHold = settings.adsMode === 'hold';
  renderer.clearDecals();
  $('killfeed').innerHTML = '';
  $('death').hidden = true;
  walkToggled = crouchToggled = false;
  running = true;
  resume();
}

function showEnd() {
  paused = true;
  releaseInputs();
  if (document.pointerLockElement) document.exitPointerLock();
  const p = game.player, st = p.stats;
  const hits = st.head + st.body + st.legs;
  const pct = (n) => (hits ? Math.round(n / hits * 100) : 0) + '%';
  const winner = [...game.combatants].sort((a, b) => b.stats.kills - a.stats.kills)[0];
  $('end-title').textContent = winner === p ? 'You win' : `${winner.name} wins`;
  $('end-stats').innerHTML = `
    <div><b>${st.kills}</b><span>Kills</span></div><div><b>${st.deaths}</b><span>Deaths</span></div>
    <div><b>${st.shots ? Math.round(st.hits / st.shots * 100) : 0}%</b><span>Accuracy</span></div>
    <div><b>${pct(st.head)}</b><span>Head</span></div><div><b>${pct(st.body)}</b><span>Body</span></div><div><b>${pct(st.legs)}</b><span>Legs</span></div>`;
  hud.renderScoreboard($('end-table'));
  show('end');
}

// ---- settings UI ----
const SCHEMA = [
  ['Mouse', [
    ['sensitivity', 'Sensitivity (Valorant scale)', 'number', { min: 0.01, max: 10, step: 0.001 }],
    ['zoomSensMult', 'Scoped / ADS sensitivity multiplier', 'number', { min: 0.1, max: 3, step: 0.01 }],
    ['invertY', 'Invert Y', 'checkbox'],
  ]],
  ['Controls', [
    ['adsMode', 'Aim down sights', 'select', { hold: 'Hold', toggle: 'Toggle' }],
    ['walkMode', 'Walk', 'select', { hold: 'Hold', toggle: 'Toggle' }],
    ['crouchMode', 'Crouch', 'select', { hold: 'Hold', toggle: 'Toggle' }],
    ['wheel', 'Mouse wheel', 'select', { weapons: 'Switch weapon', jump: 'Jump' }],
  ]],
  ['Crosshair', [
    ['chColor', 'Color', 'color'],
    ['chOutline', 'Outline', 'checkbox'],
    ['chDot', 'Center dot', 'checkbox'],
    ['chLength', 'Line length', 'range', { min: 0, max: 20, step: 1 }],
    ['chThickness', 'Line thickness', 'range', { min: 1, max: 6, step: 1 }],
    ['chGap', 'Gap', 'range', { min: 0, max: 20, step: 1 }],
    ['chError', 'Show spread', 'select', { off: 'Off', firing: 'Movement + firing error' }],
  ]],
  ['Match (applies next match)', [
    ['botCount', 'Bots', 'range', { min: 1, max: 10, step: 1 }],
    ['difficulty', 'Bot difficulty', 'select', { easy: 'Easy', normal: 'Normal', hard: 'Hard', pro: 'Pro' }],
    ['botMode', 'Bot behaviour', 'select', { fight: 'Fight back', passive: 'Move, never shoot', static: 'Stand still' }],
    ['botWeapons', 'Bot weapons', 'select', { rifles: 'Vandal / Phantom', match: 'Same as mine', random: 'Random' }],
    ['killLimit', 'Kill limit', 'number', { min: 1, max: 200, step: 1 }],
    ['timeMinutes', 'Time limit (minutes)', 'number', { min: 1, max: 60, step: 1 }],
  ]],
  ['Video & audio', [
    ['volume', 'Volume', 'range', { min: 0, max: 1, step: 0.05 }],
    ['shadows', 'Shadows', 'checkbox'],
    ['renderScale', 'Render scale', 'select', { 0.5: '50%', 0.75: '75%', 1: '100%' }],
    ['showImpacts', 'Bullet holes', 'checkbox'],
    ['impactSeconds', 'Bullet holes last (s)', 'range', { min: 1, max: 30, step: 1 }],
    ['damageNumbers', 'Damage numbers', 'checkbox'],
    ['debug', 'Debug readout (F3 or `)', 'checkbox'],
  ]],
];

function buildSettings() {
  const root = $('settings-form');
  root.innerHTML = '';
  for (const [title, fields] of SCHEMA) {
    const sec = document.createElement('section');
    sec.innerHTML = `<h3>${title}</h3>`;
    for (const [key, label, type, opt] of fields) {
      const row = document.createElement('label');
      row.className = 'row';
      row.innerHTML = `<span>${label}</span>`;
      let input;
      if (type === 'select') {
        input = document.createElement('select');
        for (const [v, t] of Object.entries(opt)) input.add(new Option(t, v));
        input.value = String(settings[key]);
      } else {
        input = document.createElement('input');
        input.type = type;
        if (opt) Object.assign(input, opt);
        if (type === 'checkbox') input.checked = !!settings[key];
        else input.value = settings[key];
      }
      const out = document.createElement('output');
      const showVal = () => { out.textContent = type === 'range' ? input.value : ''; };
      showVal();
      input.addEventListener('input', () => {
        let v = type === 'checkbox' ? input.checked : input.value;
        if (type === 'number' || type === 'range') { v = parseFloat(v); if (!Number.isFinite(v)) return; }
        if (key === 'renderScale') v = parseFloat(v);
        settings[key] = v;
        showVal();
        applySettings(key);
        saveSettings(settings);
      });
      row.append(input, out);
      sec.appendChild(row);
    }
    root.appendChild(sec);
  }
}

function applySettings(key) {
  if (key === 'volume') sound.setVolume(settings.volume);
  if (key === 'shadows') renderer.setShadows(settings.shadows);
  if (key === 'renderScale') renderer.resize();
  if (key === 'adsMode' && game.player) game.player.adsHold = settings.adsMode === 'hold';
  if (key === 'showImpacts' && !settings.showImpacts) renderer.clearDecals();
}

function openSettings(from) {
  settingsReturn = from;
  buildSettings();
  show('settings');
}

function updateMenuLoadout() {
  const l = settings.loadout;
  $('menu-loadout').textContent = `${WEAPONS[l.primary]?.name || 'No primary'} + ${WEAPONS[l.secondary]?.name}`;
}

$('play').onclick = startMatch;
$('menu-settings').onclick = () => openSettings('menu');
$('resume').onclick = resume;
$('pause-settings').onclick = () => openSettings('pause');
$('restart').onclick = startMatch;
$('quit').onclick = () => { running = false; game.state = 'idle'; updateMenuLoadout(); show('menu'); };
$('settings-back').onclick = () => show(settingsReturn);
$('settings-reset').onclick = () => {
  const loadout = settings.loadout;
  Object.assign(settings, DEFAULTS, { loadout });
  saveSettings(settings);
  for (const k of Object.keys(DEFAULTS)) applySettings(k);
  hud.chKey = '';
  buildSettings();
};
$('again').onclick = startMatch;
$('end-menu').onclick = () => { running = false; game.state = 'idle'; updateMenuLoadout(); show('menu'); };
updateMenuLoadout();
if (!matchMedia('(any-pointer: fine)').matches) $('touch-note').hidden = false;

addEventListener('beforeunload', (e) => {
  if (running && game.state === 'playing') { e.preventDefault(); e.returnValue = ''; }
});

// ---- loop: simulation at a fixed 128 Hz, rendering interpolated between ticks ----
function frame(t) {
  requestAnimationFrame(frame);
  let dt = (t - last) / 1000;
  last = t;
  if (dt > 0.25) dt = 0.25;
  if (running && !paused && !hooks.frozen) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 64) {
      playerInput();
      game.tick();
      acc -= DT;
      n++;
    }
    if (n >= 64) acc = 0;
  }
  if (running) {
    renderer.render(Math.min(1, acc / DT), dt, look);
    hud.update(dt, look);
    sound.setListener(game.player.eye(), game.player.yaw);
  } else {
    renderer.renderIdle(t / 1000);
  }
  look.dx = look.dy = 0;
}
requestAnimationFrame(frame);

// Exposed for automated checks in a headless browser; `frozen` stops the loop from ticking.
const hooks = { game, renderer, settings, startMatch, playerInput, frozen: false };
window.__game = hooks;
