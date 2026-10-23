// DOM HUD: crosshair, vitals, ammo, kill feed, damage feedback, scoreboard, death report, buy menu.
import { WEAPONS, BUY_GROUPS } from './weapons.js';
import { PLAYER, TICK_RATE } from './config.js';

const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
  constructor(game, renderer, settings) {
    this.game = game;
    this.renderer = renderer;
    this.settings = settings;
    this.cache = {};
    this.ch = $('crosshair');
    this.chCtx = this.ch.getContext('2d');
    this.chKey = '';
    this.feed = [];
    this.dirs = [];
    this.nums = [];
    this.centerUntil = 0;
    this.fps = 0;
    this.buyOpen = false;
    this.cursor = { x: innerWidth / 2, y: innerHeight / 2 };
    this.buildBuyMenu();
    this.hookEvents();
  }

  set(id, value) {
    if (this.cache[id] === value) return;
    this.cache[id] = value;
    $(id).textContent = value;
  }

  hookEvents() {
    const g = this.game;
    g.on('kill', ({ killer, victim, def, headshot, wallbang }) => {
      this.addFeed(killer, victim, def, headshot, wallbang);
      if (killer === g.player && victim !== g.player) {
        this.center(`<b>ELIMINATED</b> ${esc(victim.name)}${headshot ? '<small>HEADSHOT</small>' : ''}`);
      }
      if (victim === g.player) this.showDeath();
    });
    g.on('hit', ({ attacker, target, part, amount, point, wallbang }) => {
      if (target === g.player) {
        this.flashDamage(attacker);
      } else if (attacker === g.player && this.settings.damageNumbers) {
        const el = document.createElement('div');
        el.className = 'dmgnum' + (part === 'head' ? ' head' : '') + (wallbang ? ' wall' : '');
        el.textContent = amount;
        $('dmgnums').appendChild(el);
        this.nums.push({ el, point: [...point], t: performance.now() });
      }
    });
    g.on('respawn', ({ who }) => { if (who === g.player) $('death').hidden = true; });
  }

  center(html) {
    const el = $('center-msg');
    el.innerHTML = html;
    el.style.opacity = 1;
    this.centerUntil = performance.now() + 1600;
  }

  addFeed(killer, victim, def, headshot, wallbang) {
    const p = this.game.player;
    const el = document.createElement('div');
    el.className = 'feed' + (killer === p || victim === p ? ' me' : '');
    el.innerHTML = `<span class="k">${esc(killer.name)}</span><span class="w">${esc(def.name)}${wallbang ? ' ⟂' : ''}${headshot ? ' ◎' : ''}</span><span class="v">${esc(victim.name)}</span>`;
    $('killfeed').prepend(el);
    this.feed.push({ el, t: performance.now() });
    while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
  }

  flashDamage(attacker) {
    const p = this.game.player;
    const v = $('vignette');
    v.style.opacity = 0.55;
    if (!attacker || attacker === p) return;
    const el = document.createElement('div');
    el.className = 'dmgdir';
    $('dmgdirs').appendChild(el);
    this.dirs.push({ el, from: [...attacker.pos], t: performance.now() });
  }

  showDeath() {
    const p = this.game.player;
    const kb = p.killedBy || {};
    const rows = [...p.report.entries()].map(([o, r]) =>
      `<tr><td>${esc(o.name)}</td><td>${r.dealt} <small>(${r.dealtHits})</small></td><td>${r.taken} <small>(${r.takenHits})</small></td></tr>`).join('');
    $('death-title').innerHTML = kb.killer && kb.killer !== p
      ? `Killed by <b>${esc(kb.killer.name)}</b> · ${esc(kb.def.name)}${kb.headshot ? ' · headshot' : ''}${kb.wallbang ? ' · wallbang' : ''}`
      : 'You died';
    $('death-report').innerHTML = rows ? `<table><tr><th></th><th>Dealt (hits)</th><th>Taken (hits)</th></tr>${rows}</table>` : '';
    $('death').hidden = false;
  }

  update(dt, view) {
    const g = this.game, p = g.player, s = this.settings, now = performance.now();
    if (!p) return;
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
    const gun = p.gun, def = gun.def;

    this.set('hp', Math.max(0, Math.ceil(p.hp)));
    this.set('armor', Math.max(0, Math.ceil(p.armor)));
    $('hpbar').style.width = `${Math.max(0, p.hp) / PLAYER.hp * 100}%`;
    $('armorbar').style.width = `${Math.max(0, p.armor) / PLAYER.armor * 100}%`;
    if (def.melee) { this.set('mag', '—'); this.set('reserve', ''); }
    else { this.set('mag', gun.mag); this.set('reserve', ` / ${gun.reserve}`); }
    this.set('wname', def.name);
    let mode = '';
    if (gun.reloading) mode = 'RELOADING';
    else if (g.time < gun.equipEnd) mode = 'EQUIPPING';
    else if (def.alt?.type === 'scope' && gun.zoomLevel) mode = `SCOPE ${gun.targetZoom()}x`;
    else if (def.alt?.type === 'zoomBurst' && gun.adsT > 0.5) mode = `ADS ${def.alt.zoom}x · ${def.alt.count}-BURST`;
    else if (def.alt?.type === 'zoom' && gun.adsT > 0.5) mode = `ADS ${def.alt.zoom}x`;
    else if (def.spin && gun.spinT > 0) mode = `SPIN ${gun.rate().toFixed(1)}/s`;
    this.set('wmode', mode);
    $('mag').classList.toggle('low', !def.melee && gun.mag <= Math.ceil(def.mag * 0.25));

    const left = Math.max(0, g.timeLimit - g.time);
    this.set('timer', `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
    const leader = [...g.combatants].sort((a, b) => b.stats.kills - a.stats.kills)[0];
    this.set('score', `You ${p.stats.kills} · ${leader === p ? 'leading' : `${leader.name} ${leader.stats.kills}`} · first to ${g.killLimit}`);

    // Crosshair and scope
    const scoped = gun.scoped();
    $('scope').hidden = !scoped || !p.alive;
    this.ch.style.display = scoped || !p.alive ? 'none' : '';
    let errPx = 0;
    if (s.chError === 'firing' && !def.melee) {
      errPx = Math.tan(gun.lastSpread * DEG) / Math.tan(this.renderer.vfov() / 2) * (innerHeight / 2);
    }
    this.drawCrosshair(Math.round(errPx));

    // Respawn countdown
    if (!p.alive) this.set('respawn', g.state === 'playing' ? `Respawning in ${Math.max(0, p.respawnAt - g.time).toFixed(1)}` : '');

    // Fades
    const v = $('vignette');
    v.style.opacity = Math.max(0, parseFloat(v.style.opacity || 0) - dt * 1.5);
    if (now > this.centerUntil) $('center-msg').style.opacity = Math.max(0, parseFloat($('center-msg').style.opacity || 0) - dt * 3);
    this.feed = this.feed.filter(f => { if (now - f.t > 6000) { f.el.remove(); return false; } return true; });
    this.dirs = this.dirs.filter(d => {
      const age = (now - d.t) / 1000;
      if (age > 1.4) { d.el.remove(); return false; }
      const dx = d.from[0] - p.pos[0], dz = d.from[2] - p.pos[2];
      const f = [-Math.sin(p.yaw), -Math.cos(p.yaw)], r = [Math.cos(p.yaw), -Math.sin(p.yaw)];
      const ang = Math.atan2(dx * r[0] + dz * r[1], dx * f[0] + dz * f[1]);
      d.el.style.transform = `translate(-50%, -50%) rotate(${ang}rad)`;
      d.el.style.opacity = 1 - age / 1.4;
      return true;
    });
    this.nums = this.nums.filter(n => {
      const age = (now - n.t) / 1000;
      if (age > 0.9) { n.el.remove(); return false; }
      const sp = this.renderer.project([n.point[0], n.point[1] + age * 0.6, n.point[2]]);
      if (!sp) { n.el.style.opacity = 0; return true; }
      n.el.style.transform = `translate(${sp.x}px, ${sp.y}px) translate(-50%, -100%)`;
      n.el.style.opacity = 1 - age / 0.9;
      return true;
    });

    if (!$('scoreboard').hidden) this.renderScoreboard($('scoreboard-body'));

    $('debug').hidden = !s.debug;
    if (s.debug) {
      const sp = p.horizSpeed();
      const rate = def.melee ? 0 : gun.rate();
      $('debug').textContent =
        `fps ${this.fps.toFixed(0)} · tick ${TICK_RATE} Hz\n` +
        `speed ${sp.toFixed(2)} / ${p.maxSpeed(g.time).toFixed(2)} m/s  (${(sp / def.move * 100).toFixed(0)}% of run)\n` +
        `${p.grounded ? 'ground' : 'air'}${p.crouched ? ' · crouch' : ''}${p.input.walk ? ' · walk' : ''} · tag ${(p.tagAmount(g.time) * 100).toFixed(0)}%\n` +
        (def.melee ? '' :
          `spread ${gun.lastSpread.toFixed(3)}° · heat ${gun.heat.toFixed(2)} · ads ${gun.adsT.toFixed(2)}\n` +
          `recoil ${(gun.offP / DEG).toFixed(2)}° up ${(gun.offY / DEG).toFixed(2)}° side · ${rate.toFixed(2)} rps`);
    }

    if (this.buyOpen) {
      const c = $('cursor');
      c.style.transform = `translate(${this.cursor.x}px, ${this.cursor.y}px)`;
    }
  }

  drawCrosshair(err) {
    const s = this.settings;
    const key = [s.chColor, s.chOutline, s.chDot, s.chLength, s.chThickness, s.chGap, err, devicePixelRatio].join('|');
    if (key === this.chKey) return;
    this.chKey = key;
    const dpr = devicePixelRatio || 1;
    const size = 240;
    this.ch.width = this.ch.height = size * dpr;
    this.ch.style.width = this.ch.style.height = `${size}px`;
    const c = this.chCtx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size, size);
    const mid = size / 2, t = s.chThickness, L = s.chLength, gap = s.chGap + err;
    const rects = [];
    if (L > 0) {
      rects.push([mid - t / 2, mid - gap - L, t, L]); // up
      rects.push([mid - t / 2, mid + gap, t, L]); // down
      rects.push([mid - gap - L, mid - t / 2, L, t]); // left
      rects.push([mid + gap, mid - t / 2, L, t]); // right
    }
    if (s.chDot) rects.push([mid - t / 2, mid - t / 2, t, t]);
    if (s.chOutline) {
      c.fillStyle = 'rgba(0,0,0,0.85)';
      for (const [x, y, w, h] of rects) c.fillRect(x - 1, y - 1, w + 2, h + 2);
    }
    c.fillStyle = s.chColor;
    for (const [x, y, w, h] of rects) c.fillRect(x, y, w, h);
  }

  renderScoreboard(tbody) {
    const rows = [...this.game.combatants].sort((a, b) => b.stats.kills - a.stats.kills || a.stats.deaths - b.stats.deaths);
    tbody.innerHTML = rows.map(c => {
      const st = c.stats, hits = st.head + st.body + st.legs;
      const hs = hits ? Math.round(st.head / hits * 100) : 0;
      const acc = st.shots ? Math.round(st.hits / st.shots * 100) : 0;
      return `<tr class="${c === this.game.player ? 'me' : ''}"><td>${esc(c.name)}</td><td>${st.kills}</td><td>${st.deaths}</td><td>${hs}%</td><td>${acc}%</td><td>${st.damage}</td></tr>`;
    }).join('');
  }

  buildBuyMenu() {
    const root = $('buy-groups');
    root.innerHTML = BUY_GROUPS.map(([title, ids]) => `
      <section><h3>${title}</h3>${ids.map(id => {
        const w = WEAPONS[id];
        const b = w.dmg[0];
        const rate = w.spin ? `${w.rate}→${w.spin.to}` : w.rate;
        return `<button class="card" data-id="${id}"><span class="n">${w.name}</span><span class="c">¤${w.cost}</span>
          <span class="s">${b[1]} / ${b[2]} / ${b[3]}${w.pellets ? ` ×${w.pellets}` : ''} · ${rate}/s · ${w.mag} rds</span></button>`;
      }).join('')}</section>`).join('');
  }

  markLoadout(loadout) {
    for (const el of document.querySelectorAll('#buy .card')) {
      el.classList.toggle('sel', el.dataset.id === loadout.primary || el.dataset.id === loadout.secondary);
    }
  }
}
