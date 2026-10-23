// Bot brain. Bots press the same inputs a player would, so their guns follow the same spread,
// recoil and movement-accuracy rules: they stop (or counter-strafe) to shoot, burst at range and spray up close.
import { dirFromAngles } from './entity.js';
import { PLAYER } from './config.js';

export const BOT_NAMES = ['Kestrel', 'Rook', 'Ember', 'Quill', 'Talon', 'Vesper', 'Drift', 'Nova', 'Hex', 'Moth'];

const DEG = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// react: seconds before the first shot at a new target. err: initial aim error (deg) that settles with time
// constant tau down to a wobble of about `floor` degrees. tol: how far off (in target widths) they'll still fire.
// comp: share of recoil they pull down. head: chance to aim for the head. stop: chance to stop before shooting.
export const DIFFICULTY = {
  easy: { react: [0.45, 0.65], err: 5, tau: 0.5, floor: 1.1, tol: 3, turn: 260, comp: 0.2, head: 0.15, stop: 0.4, fov: 55 },
  normal: { react: [0.3, 0.42], err: 3.5, tau: 0.35, floor: 0.75, tol: 2, turn: 450, comp: 0.5, head: 0.4, stop: 0.8, fov: 65 },
  hard: { react: [0.22, 0.3], err: 2.2, tau: 0.25, floor: 0.4, tol: 1.5, turn: 700, comp: 0.75, head: 0.7, stop: 1, fov: 75 },
  pro: { react: [0.17, 0.23], err: 1.5, tau: 0.18, floor: 0.15, tol: 1.2, turn: 1000, comp: 0.9, head: 0.9, stop: 1, fov: 80 },
};

export class Bot {
  constructor(me, game, difficulty, mode) {
    this.me = me;
    this.game = game;
    this.d = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.mode = mode; // 'fight' | 'passive' | 'static'
    this.reset(0);
  }

  reset(now) {
    this.target = null;
    this.lastSeen = -100;
    this.investigate = null; // { pos, until }: last place an enemy was seen, heard or shot from
    this.reactUntil = 0;
    this.errY = 0;
    this.errP = 0;
    this.wobY = 0;
    this.wobP = 0;
    this.aimHead = false;
    this.path = null;
    this.pathIdx = 0;
    this.nextSense = now;
    this.phase = 'shoot';
    this.phaseUntil = 0;
    this.strafeDir = 1;
    this.burstLeft = 0;
    this.lastShotSeen = -1;
    this.alertUntil = 0;
    this.lookAt = null;
    this.stuckCheck = { t: now + 1.5, pos: [...this.me.pos] };
    this.crouchSpray = false;
  }

  hear(source, now) {
    if (this.mode === 'static' || now - this.lastSeen < 1) return;
    this.alert(source.pos, now);
  }

  onDamaged(attacker, now) {
    if (this.mode === 'static' || now - this.lastSeen < 0.5) return;
    this.alert(attacker.pos, now);
  }

  alert(pos, now) {
    this.alertUntil = now + 2;
    this.lookAt = [...pos];
    this.investigate = { pos: [...pos], until: now + 5 };
    this.path = null;
  }

  think(now, dt) {
    const me = this.me, inp = me.input;
    inp.fwd = 0; inp.side = 0; inp.walk = false; inp.fire = false; inp.alt = false;
    inp.crouch = this.crouchSpray;

    if (this.mode === 'static') return;

    if (now >= this.nextSense) {
      this.nextSense = now + rand(0.07, 0.12);
      this.sense(now);
    }
    const t = this.target;
    if (t && t.alive && now - this.lastSeen < 0.2) {
      this.engage(now, dt);
      return;
    }
    if (t && !t.alive) this.target = null;
    this.crouchSpray = false;
    this.burstLeft = 0;

    if (me.gun.def.mag && me.gun.mag < me.gun.def.mag * 0.5 && !me.gun.reloading) inp.reload = true;

    const inv = this.investigate;
    if (inv && now < inv.until && Math.hypot(me.pos[0] - inv.pos[0], me.pos[2] - inv.pos[2]) > 1.5) {
      this.moveTo(inv.pos, now, dt);
      if (this.lookAt) this.turnToward(this.lookAt, PLAYER.standEye, dt, 0.5);
    } else {
      this.investigate = null;
      this.patrol(now, dt);
      if (this.lookAt && now < this.alertUntil) this.turnToward(this.lookAt, PLAYER.standEye, dt, 0.5);
    }
  }

  sense(now) {
    const me = this.me, g = this.game;
    const eye = me.eye();
    const fwd = dirFromAngles(me.yaw, 0);
    const cosFov = Math.cos((now < this.alertUntil ? 110 : this.d.fov) * DEG);
    let best = null, bestScore = Infinity, bestHead = false;
    for (const o of g.combatants) {
      if (o === me || !o.alive) continue;
      const dx = o.pos[0] - me.pos[0], dz = o.pos[2] - me.pos[2];
      const dist = Math.hypot(dx, dz);
      if (dist > 90) continue;
      if (dist > 2 && (fwd[0] * dx + fwd[2] * dz) / dist < cosFov) continue;
      const hb = o.hitboxes();
      const head = center(hb[0]), body = center(hb[1]);
      const seesHead = g.world.lineOfSight(eye, head);
      const seesBody = g.world.lineOfSight(eye, body);
      if (!seesHead && !seesBody) continue;
      const score = dist - (o === this.target ? 8 : 0);
      if (score < bestScore) { bestScore = score; best = o; bestHead = seesHead; }
    }
    if (!best) return;
    if (best !== this.target || now - this.lastSeen > 1.0) {
      // New sighting: reaction time, fresh aim error, decide where to aim.
      this.reactUntil = now + rand(this.d.react[0], this.d.react[1]);
      const e = this.d.err * DEG * rand(0.6, 1.2), th = Math.random() * Math.PI * 2;
      this.errY = Math.cos(th) * e;
      this.errP = Math.sin(th) * e;
      this.aimHead = Math.random() < this.d.head;
      this.phase = 'shoot';
      this.burstLeft = 0;
    }
    this.target = best;
    this.headVisible = bestHead;
    this.lastSeen = now;
    this.investigate = { pos: [...best.pos], until: now + 6 };
    this.lookAt = [...best.pos];
  }

  engage(now, dt) {
    const me = this.me, t = this.target, inp = me.input, gun = me.gun, def = gun.def;
    const hb = t.hitboxes();
    const useHead = this.aimHead && this.headVisible !== false;
    const aim = useHead ? center(hb[0]) : center(hb[1]);
    if (!useHead) aim[1] += 0.1; // upper chest
    const eye = me.eye();
    const dx = aim[0] - eye[0], dy = aim[1] - eye[1], dz = aim[2] - eye[2];
    const dist = Math.hypot(dx, dz, dy);

    // Aim error shrinks while tracking, as a player settles their crosshair, but never fully: a small
    // wandering offset (mean-reverting random walk) stays on top.
    const k = Math.exp(-dt / this.d.tau);
    this.errY *= k;
    this.errP *= k;
    const amp = 3.5 * this.d.floor * DEG * Math.sqrt(dt);
    this.wobY += -this.wobY * 2 * dt + (Math.random() * 2 - 1) * amp;
    this.wobP += -this.wobP * 2 * dt + (Math.random() * 2 - 1) * amp;
    const wantYaw = Math.atan2(-dx, -dz) + this.errY + this.wobY - gun.offY * this.d.comp;
    const wantPitch = Math.atan2(dy, Math.hypot(dx, dz)) + this.errP + this.wobP - gun.offP * this.d.comp;
    this.turnTo(wantYaw, wantPitch, dt, 1);

    if (this.mode === 'passive') { this.strafe(now); return; }
    if (def.melee) { // knife only: run at them
      this.moveDir(dx, dz);
      if (dist < 2) inp.fire = true;
      return;
    }
    if (gun.mag === 0 && gun.reserve === 0 && me.inv.secondary && me.slot !== 'secondary') me.equip('secondary', now);

    // Error between where the bullets will go and the aim point, against the size of what we're aiming at.
    const aimYaw = me.yaw + gun.offY, aimPitch = me.pitch + gun.offP;
    const tYaw = Math.atan2(-dx, -dz), tPitch = Math.atan2(dy, Math.hypot(dx, dz));
    const off = Math.hypot(wrap(aimYaw - tYaw) * Math.cos(tPitch), aimPitch - tPitch);
    const size = Math.atan((useHead ? 0.11 : 0.2) / Math.max(dist, 0.5));
    const onTarget = off < size * this.d.tol;

    if (now < this.reactUntil) { this.strafe(now); return; }

    if (this.phase === 'strafe') {
      this.strafe(now);
      if (now >= this.phaseUntil) { this.phase = 'shoot'; this.burstLeft = 0; }
      return;
    }

    // Shoot phase: stop moving (releasing keys brakes hard), then fire once slow enough.
    const altType = def.alt && def.alt.type;
    if (altType === 'scope' && dist > 8 && gun.zoomLevel === 0 && !gun.reloading) inp.altPressed = true;
    if (altType === 'zoom' && dist > 20) inp.alt = true;
    if (this.burstLeft === 0) {
      if (gun.heat > (dist > 20 ? 0.3 : 1.5)) return; // let spread recover between bursts
      this.burstLeft = !def.auto ? 1 : dist > 25 ? 1 : dist > 14 ? 2 + (Math.random() < 0.5 ? 1 : 0) : Math.round(rand(4, 9));
      this.crouchSpray = this.burstLeft >= 5 && Math.random() < 0.25;
      this.ignoreStop = Math.random() > this.d.stop; // weaker bots sometimes shoot on the move
      this.lastShotSeen = gun.lastShot;
    }
    const slowEnough = this.ignoreStop || me.horizSpeed() <= def.move * def.spread.deadzone;

    if (gun.lastShot !== this.lastShotSeen) {
      this.lastShotSeen = gun.lastShot;
      this.burstLeft--;
      if (this.burstLeft <= 0) {
        this.burstLeft = 0;
        // Re-peek: strafe a bit before the next burst.
        if (Math.random() < 0.6) {
          this.phase = 'strafe';
          this.phaseUntil = now + rand(0.18, 0.45);
          this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        }
        return;
      }
    }
    if (slowEnough && onTarget) {
      if (def.auto) inp.fire = true;
      else if (now >= gun.nextFire) inp.firePressed = true;
    }
  }

  strafe(now) {
    if (now >= this.phaseUntil && this.phase !== 'strafe') {
      this.phaseUntil = now + rand(0.25, 0.6);
      this.strafeDir *= -1;
    }
    this.me.input.side = this.strafeDir;
  }

  patrol(now, dt) {
    const me = this.me, map = this.game.map;
    if (!this.path || this.pathIdx >= this.path.length) {
      const here = map.nearestWalkable(...map.cellOf(me.pos[0], me.pos[2]));
      for (let tries = 0; tries < 10 && !this.path; tries++) {
        const goal = map.walkable[Math.floor(Math.random() * map.walkable.length)];
        if (Math.hypot(goal[0] - here[0], goal[1] - here[1]) < 6) continue;
        this.path = map.findPath(here, goal);
        this.pathIdx = 1;
      }
      if (!this.path) return;
    }
    this.followPath(now, dt);
  }

  moveTo(pos, now, dt) {
    const map = this.game.map;
    const goal = map.cellOf(pos[0], pos[2]);
    if (!this.path || !this.pathGoal || this.pathGoal[0] !== goal[0] || this.pathGoal[1] !== goal[1]) {
      this.path = map.findPath(map.nearestWalkable(...map.cellOf(this.me.pos[0], this.me.pos[2])), map.nearestWalkable(...goal));
      this.pathIdx = 1;
      this.pathGoal = goal;
      if (!this.path) { this.investigate = null; return; }
    }
    this.followPath(now, dt);
  }

  followPath(now, dt) {
    const me = this.me, map = this.game.map;
    if (this.pathIdx >= this.path.length) { this.path = null; return; }
    const [cx, cz] = this.path[this.pathIdx];
    const c = map.cellCenter(cx, cz);
    const dx = c.x - me.pos[0], dz = c.z - me.pos[2];
    if (Math.hypot(dx, dz) < 0.8) { this.pathIdx++; return; }
    this.moveDir(dx, dz);
    // Look where we're going, keeping the crosshair at head height.
    this.turnTo(Math.atan2(-dx, -dz), 0, dt, 0.35);

    if (now >= this.stuckCheck.t) {
      const moved = Math.hypot(me.pos[0] - this.stuckCheck.pos[0], me.pos[2] - this.stuckCheck.pos[2]);
      if (moved < 0.5) { this.path = null; this.investigate = null; }
      this.stuckCheck = { t: now + 1.5, pos: [...me.pos] };
    }
  }

  // Convert a world-space direction to forward/side input relative to where the bot faces.
  moveDir(dx, dz) {
    const me = this.me, l = Math.hypot(dx, dz) || 1;
    const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
    const fx = -sy, fz = -cy, rx = cy, rz = -sy;
    me.input.fwd = (dx * fx + dz * fz) / l;
    me.input.side = (dx * rx + dz * rz) / l;
  }

  turnToward(p, eyeH, dt, speed) {
    const e = this.me.eye();
    const dx = p[0] - e[0], dy = p[1] + eyeH - e[1], dz = p[2] - e[2];
    this.turnTo(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)), dt, speed);
  }

  // Ease toward the wanted angles with a capped turn rate, like a flick that settles.
  turnTo(yaw, pitch, dt, speed) {
    const me = this.me;
    const maxStep = this.d.turn * DEG * dt * speed;
    const f = 1 - Math.exp(-dt * 18 * speed);
    let dy = wrap(yaw - me.yaw) * f, dp = (pitch - me.pitch) * f;
    const m = Math.hypot(dy, dp);
    if (m > maxStep) { dy *= maxStep / m; dp *= maxStep / m; }
    me.yaw = wrap(me.yaw + dy);
    me.pitch = Math.max(-1.4, Math.min(1.4, me.pitch + dp));
  }
}

function center(hb) {
  return [(hb.min[0] + hb.max[0]) / 2, (hb.min[1] + hb.max[1]) / 2, (hb.min[2] + hb.max[2]) / 2];
}

