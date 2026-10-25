// Match simulation: combatants, hitscan with wall penetration, damage, kills and respawns (free-for-all).
import { DT, MATCH, PEN_DEPTH, MAX_RANGE, TAG, PLAYER } from './config.js';
import { buildMap } from './map.js';
import { World } from './world.js';
import { Combatant, dirFromAngles } from './entity.js';
import { damageAt, WEAPONS, BUY_GROUPS } from './weapons.js';
import { Bot, BOT_NAMES } from './bot.js';

const BOT_COLORS = [0xff4655, 0xffb547, 0xc86bff, 0x4fd1c5, 0xff7ab8, 0x9be15d, 0x6aa7ff, 0xf28c38, 0xe0e0e0, 0x8e7dff];

export class Game {
  constructor() {
    this.map = buildMap();
    this.world = new World(this.map.boxes);
    this.time = 0;
    this.listeners = {};
    this.combatants = [];
    this.bots = [];
    this.player = null;
    this.state = 'idle';
    this.on('footstep', ({ who }) => this.noise(who, 22));
    this.on('land', ({ who }) => this.noise(who, 18));
  }

  on(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, data) { for (const fn of this.listeners[type] || []) fn(data); }

  start(opts) {
    this.opts = opts;
    this.time = 0;
    this.killLimit = opts.killLimit;
    this.timeLimit = opts.timeLimit;
    this.combatants = [];
    this.bots = [];
    const player = new Combatant(this, { name: 'You' });
    player.loadout = { ...opts.loadout };
    player.shieldType = opts.shields || 'heavy';
    this.player = player;
    this.combatants.push(player);
    const primaries = BUY_GROUPS.filter(([g]) => g !== 'Sidearms').flatMap(([, ids]) => ids);
    for (let i = 0; i < opts.botCount; i++) {
      const c = new Combatant(this, { name: BOT_NAMES[i % BOT_NAMES.length], isBot: true, color: BOT_COLORS[i % BOT_COLORS.length] });
      let primary;
      if (opts.botWeapons === 'match') primary = opts.loadout.primary || 'vandal';
      else if (opts.botWeapons === 'random') primary = primaries[Math.floor(Math.random() * primaries.length)];
      else primary = Math.random() < 0.5 ? 'vandal' : 'phantom';
      c.loadout = { primary, secondary: 'classic' };
      c.shieldType = opts.shields || 'heavy';
      c.brain = new Bot(c, this, opts.difficulty, opts.botMode);
      this.combatants.push(c);
      this.bots.push(c);
    }
    this.state = 'playing';
    for (const c of this.combatants) this.respawn(c);
    this.emit('start', {});
  }

  tick() {
    const now = this.time;
    for (const c of this.combatants) {
      if (!c.alive && this.state === 'playing' && now >= c.respawnAt) this.respawn(c);
    }
    for (const b of this.bots) if (b.alive) b.brain.think(now, DT);
    for (const c of this.combatants) {
      if (!c.alive) continue;
      c.move(DT, now, this.world);
      c.gun.tick(c, now, DT);
    }
    for (const c of this.combatants) {
      const i = c.input;
      i.firePressed = i.altPressed = i.jump = i.reload = false;
    }
    this.time += DT;
    if (this.state === 'playing' && this.time >= this.timeLimit) this.end();
  }

  end() {
    if (this.state !== 'playing') return;
    this.state = 'ended';
    this.emit('end', {});
  }

  respawn(c) {
    c.spawnAt(this.pickSpawn(c), this.time);
    if (c.brain) c.brain.reset(this.time);
    this.emit('respawn', { who: c });
  }

  pickSpawn(c) {
    const enemies = this.combatants.filter(o => o !== c && o.alive);
    let best = null, bestScore = -Infinity;
    for (const sp of this.map.spawns) {
      let minD = 60, seen = false, crowded = false;
      for (const e of enemies) {
        const d = Math.hypot(e.pos[0] - sp.x, e.pos[2] - sp.z);
        minD = Math.min(minD, d);
        if (d < 2) crowded = true;
        if (!seen && d < 60 && this.world.lineOfSight(e.eye(), [sp.x, PLAYER.standEye, sp.z])) seen = true;
      }
      const score = (crowded ? -2000 : 0) + (seen ? 0 : 1000) + Math.min(minD, 40) + Math.random() * 8;
      if (score > bestScore) { bestScore = score; best = sp; }
    }
    return best;
  }

  // Hitscan along each direction. Penetrable boxes (crates, wooden panels) are crossed while the gun's
  // penetration budget lasts, at a damage cost. Shotgun pellets are summed per target before applying.
  fireBullets(shooter, gun, dirs) {
    const def = gun.def;
    const o = shooter.eye();
    const budget = PEN_DEPTH[def.pen] ?? 0;
    const perTarget = new Map();
    for (const d of dirs) {
      const res = this.trace(shooter, o, d, budget);
      const end = [o[0] + d[0] * res.endT, o[1] + d[1] * res.endT, o[2] + d[2] * res.endT];
      this.emit('tracer', { who: shooter, gun, from: o, to: end });
      for (const imp of res.impacts) {
        this.emit('impact', { who: shooter, point: [o[0] + d[0] * imp.t, o[1] + d[1] * imp.t, o[2] + d[2] * imp.t], normal: imp.n, box: imp.box });
      }
      if (!res.hit) continue;
      const { c, part, t } = res.hit;
      const b = damageAt(def, t);
      const dmg = (part === 'head' ? b[1] : part === 'body' ? b[2] : b[3]) * res.mult;
      let acc = perTarget.get(c);
      if (!acc) { acc = { dmg: 0, head: 0, body: 0, legs: 0, dist: t, point: end, wallbang: false }; perTarget.set(c, acc); }
      acc.dmg += dmg;
      acc[part]++;
      acc.dist = Math.min(acc.dist, t);
      acc.wallbang ||= res.mult < 1;
      if (part === 'head') acc.point = end;
    }
    for (const [target, acc] of perTarget) {
      const part = acc.head ? 'head' : acc.body ? 'body' : 'legs';
      this.damage(target, shooter, Math.round(acc.dmg), { part, def, dist: acc.dist, point: acc.point, wallbang: acc.wallbang });
    }
    this.noise(shooter, def.suppressed ? 25 : 60);
  }

  trace(shooter, o, d, budget) {
    const walls = this.world.raycastAll(o, d, MAX_RANGE);
    let stopT = MAX_RANGE, used = 0;
    const crossed = [];
    const impacts = [];
    for (const h of walls) {
      if (h.tIn > stopT) break;
      const thick = h.tOut - h.tIn;
      if (!h.box.pen || used + thick > budget) {
        stopT = h.tIn;
        impacts.push({ t: h.tIn, n: h.n, box: h.box });
        break;
      }
      used += thick;
      crossed.push(h);
      impacts.push({ t: h.tIn, n: h.n, box: h.box });
    }
    let hit = null;
    for (const c of this.combatants) {
      if (c === shooter || !c.alive) continue;
      const r = c.rayHit(o, d, stopT);
      if (r && (!hit || r.t < hit.t)) hit = { c, part: r.part, t: r.t };
    }
    if (!hit) return { endT: stopT, impacts, hit: null, mult: 1 };
    let through = 0;
    for (const h of crossed) if (h.tIn < hit.t) through += Math.min(h.tOut, hit.t) - h.tIn;
    const mult = through > 0 ? Math.max(0.3, 0.8 - 0.4 * through / budget) : 1;
    return { endT: hit.t, impacts: impacts.filter(i => i.t < hit.t), hit, mult };
  }

  damage(target, attacker, amount, info) {
    if (!target.alive || amount <= 0) return;
    const now = this.time;
    const dealt = target.takeDamage(amount, now);
    const s = attacker.stats;
    s.hits++;
    s[info.part]++;
    s.damage += dealt;
    const ra = attacker.reportFor(target), rt = target.reportFor(attacker);
    ra.dealt += dealt; ra.dealtHits++;
    rt.taken += dealt; rt.takenHits++;
    const far = info.def.pellets && info.dist > TAG.shotgunFarRange;
    target.tag(now, far ? TAG.shotgunFarSlow : TAG.slow);
    target.lastHitFrom = attacker.eye();
    target.lastHitTime = now;
    const killed = target.hp <= 0;
    this.emit('hit', { attacker, target, part: info.part, amount, dealt, point: info.point, killed, def: info.def, wallbang: info.wallbang });
    if (target.brain) target.brain.onDamaged(attacker, now);
    if (killed) this.kill(target, attacker, info);
  }

  kill(victim, killer, info) {
    victim.alive = false;
    victim.stats.deaths++;
    victim.respawnAt = this.time + MATCH.respawn;
    victim.killedBy = { killer, def: info.def, headshot: info.part === 'head', wallbang: info.wallbang };
    victim.vel = [0, 0, 0];
    if (killer !== victim) {
      killer.stats.kills++;
      if (MATCH.healOnKill && killer.alive) killer.heal();
    }
    this.emit('kill', { killer, victim, def: info.def, headshot: info.part === 'head', wallbang: info.wallbang });
    if (killer.stats.kills >= this.killLimit) this.end();
  }

  meleeHit(attacker, mode) {
    const o = attacker.eye();
    const range = WEAPONS.knife.melee.range;
    const offsets = [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.08], [0, -0.1]];
    for (const [dy, dp] of offsets) {
      const d = dirFromAngles(attacker.yaw + dy, attacker.pitch + dp);
      const wall = this.world.raycast(o, d, range);
      const maxT = wall ? wall.t : range;
      for (const c of this.combatants) {
        if (c === attacker || !c.alive) continue;
        const r = c.rayHit(o, d, maxT);
        if (!r) continue;
        const f = dirFromAngles(c.yaw, 0);
        const hx = c.pos[0] - attacker.pos[0], hz = c.pos[2] - attacker.pos[2];
        const hl = Math.hypot(hx, hz) || 1;
        const back = (f[0] * hx + f[2] * hz) / hl > 0.5;
        const point = [o[0] + d[0] * r.t, o[1] + d[1] * r.t, o[2] + d[2] * r.t];
        this.damage(c, attacker, back ? mode.back : mode.dmg, { part: 'body', def: WEAPONS.knife, dist: r.t, point, wallbang: false });
        return;
      }
      if (dy === 0 && dp === 0 && wall) {
        this.emit('impact', { who: attacker, point: [o[0] + d[0] * wall.t, o[1] + d[1] * wall.t, o[2] + d[2] * wall.t], normal: wall.n, box: wall.box, melee: true });
      }
    }
  }

  noise(source, radius) {
    for (const b of this.bots) {
      if (b === source || !b.alive) continue;
      const d = Math.hypot(b.pos[0] - source.pos[0], b.pos[2] - source.pos[2]);
      if (d < radius) b.brain.hear(source, this.time);
    }
  }
}
