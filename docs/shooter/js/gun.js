// Per-weapon state machine shared by the player and bots: fire cadence, spread, recoil, recovery,
// ADS/scopes, bursts, spin-up, reload and equip.
import { DT, CROUCH_SPREAD, PLAYER } from './config.js';
import { dirFromAngles } from './entity.js';

const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  if (b <= a) return x >= b ? 1 : 0;
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class Gun {
  constructor(def) {
    this.def = def;
    this.mag = def.mag ?? 0;
    this.reserve = def.reserve ?? 0;
    this.heat = 0; // shots in the current spray, decays during recovery
    this.offP = 0; // recoil offset (radians) the bullets get; the camera shows VIEW_RECOIL of it
    this.offY = 0;
    this.hDir = 1;
    this.nextFire = 0;
    this.lastShot = -10;
    this.recovering = true;
    this.recRate = 0;
    this.reloading = false;
    this.reloadEnd = 0;
    this.equipEnd = 0;
    this.adsT = 0;
    this.adsWant = false;
    this.zoomLevel = 0;
    this.burstLeft = 0;
    this.burst = null;
    this.spinT = 0;
    this.triggerDown = false;
    this.meleePending = null;
    this.lastSpread = 0;
  }

  get alt() { return this.def.alt || { type: 'none' }; }

  // Zoom factor of the current ADS/scope state, ignoring the transition.
  targetZoom() {
    const a = this.alt;
    if (a.type === 'scope') return this.zoomLevel ? a.levels[this.zoomLevel - 1] : 1;
    if (a.type === 'zoom' || a.type === 'zoomBurst') return a.zoom;
    return 1;
  }

  scoped() { return this.alt.type === 'scope' && this.zoomLevel > 0 && this.adsT > 0.85; }

  rate() {
    const d = this.def, a = this.alt;
    let r = d.rate;
    if (d.spin) {
      const t = d.spin.adsInstant && this.adsT > 0.5 ? 1 : this.spinT / d.spin.time;
      r = lerp(d.rate, d.spin.to, clamp(t, 0, 1));
    }
    if (a.type === 'zoom' && a.rateMult && this.adsT > 0.5) r *= a.rateMult;
    return r;
  }

  onEquip(now) {
    this.equipEnd = now + this.def.equip;
    this.nextFire = Math.max(this.nextFire, this.equipEnd);
    this.reloading = false;
    this.adsT = 0;
    this.adsWant = false;
    this.zoomLevel = 0;
    this.burstLeft = 0;
    this.heat = 0;
    this.offP = 0;
    this.offY = 0;
    this.spinT = 0;
    this.meleePending = null;
  }

  onHolster() {
    this.reloading = false;
    this.burstLeft = 0;
    this.adsWant = false;
    this.zoomLevel = 0;
  }

  startReload(owner, now) {
    const d = this.def;
    if (this.reloading || !d.mag || this.mag >= d.mag || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadEnd = now + d.reload;
    this.burstLeft = 0;
    this.adsWant = false;
    this.zoomLevel = 0;
    owner.game.emit('reload', { who: owner, gun: this });
  }

  // Spread cone half-angle in degrees for the next shot.
  spread(owner, burst = null) {
    const d = this.def, s = d.spread;
    const base = burst && burst.spread != null ? burst.spread : lerp(s.hip, s.ads, this.adsT);
    const frac = owner.horizSpeed() / d.move;
    const wk = PLAYER.walkMult;
    let move = 0;
    if (frac > s.deadzone) {
      move = frac <= wk
        ? s.walk * (frac - s.deadzone) / (wk - s.deadzone)
        : s.walk + (s.run - s.walk) * Math.min(1, (frac - wk) / (1 - wk));
    }
    const air = owner.grounded ? 0 : s.air;
    const fe = d.fe.max * smoothstep(d.fe.start, d.fe.end, this.heat);
    let total = base + move + air + fe;
    if (owner.crouched && owner.grounded) total *= CROUCH_SPREAD;
    return total;
  }

  tick(owner, now, dt) {
    if (this.def.melee) return this.tickMelee(owner, now);
    const d = this.def, a = this.alt, inp = owner.input;

    if (this.reloading) {
      if (inp.firePressed && this.mag > 0) this.reloading = false; // shooting cancels a reload
      else if (now >= this.reloadEnd) {
        const take = Math.min(d.mag - this.mag, this.reserve);
        this.mag += take;
        this.reserve -= take;
        this.reloading = false;
      }
    }
    if (inp.reload && this.burstLeft === 0) this.startReload(owner, now);

    const ready = now >= this.equipEnd && !this.reloading;

    // Aim down sights / scope
    if (a.type === 'zoom' || a.type === 'zoomBurst') {
      if (owner.adsHold) this.adsWant = inp.alt;
      else if (inp.altPressed) this.adsWant = !this.adsWant;
    } else if (a.type === 'scope' && inp.altPressed && ready) {
      this.zoomLevel = (this.zoomLevel + 1) % (a.levels.length + 1);
      this.adsWant = this.zoomLevel > 0;
    }
    if (!ready) { this.adsWant = false; this.zoomLevel = 0; }
    const step = dt / (a.time || 0.2);
    this.adsT = clamp(this.adsT + clamp((this.adsWant ? 1 : 0) - this.adsT, -step, step), 0, 1);

    if (d.spin) {
      if (this.triggerDown) this.spinT = Math.min(d.spin.time, this.spinT + dt);
      else this.spinT = Math.max(0, this.spinT - dt * 2);
    }

    // Fire
    this.triggerDown = false;
    if (this.burstLeft > 0) {
      this.continueBurst(owner, now);
    } else if (ready) {
      let burst = null;
      if (a.type === 'burst' && inp.altPressed) burst = a;
      else if (a.type === 'zoomBurst' && this.adsT > 0.5 && inp.firePressed) burst = a;
      if (burst) {
        if (this.mag <= 0) this.dryFire(owner, now);
        else if (now >= this.nextFire) {
          this.burst = burst;
          this.burstLeft = burst.count;
          this.nextFire = now;
          this.continueBurst(owner, now);
        }
      } else if (!(a.type === 'zoomBurst' && this.adsT > 0.5)) {
        const want = d.auto ? inp.fire : inp.firePressed;
        if (want) {
          if (this.mag <= 0) this.dryFire(owner, now);
          else if (now >= this.nextFire) {
            const interval = 1 / this.rate();
            if (now - this.nextFire > interval) this.nextFire = now; // trigger was idle: restart the cadence
            this.shoot(owner, now, null);
            this.nextFire += interval;
            this.triggerDown = d.auto;
          } else this.triggerDown = d.auto;
        }
      }
    }

    // Recovery: once the trigger has been idle a moment, spread and recoil settle back to zero.
    const delay = Math.min(1 / this.rate(), 0.15) + DT;
    if (this.burstLeft === 0 && now - this.lastShot > delay) {
      if (!this.recovering) {
        this.recovering = true;
        this.recRate = Math.max(1, this.heat) / d.recovery;
      }
      if (this.heat > 0) {
        const nh = Math.max(0, this.heat - this.recRate * dt);
        const k = nh / this.heat;
        this.offP *= k;
        this.offY *= k;
        this.heat = nh;
      } else { this.offP = 0; this.offY = 0; }
    }
    this.lastSpread = this.spread(owner);
  }

  continueBurst(owner, now) {
    const b = this.burst;
    while (this.burstLeft > 0 && now >= this.nextFire) {
      if (this.mag <= 0) { this.burstLeft = 0; break; }
      this.shoot(owner, now, b.spread != null ? b : null);
      this.burstLeft--;
      this.nextFire += this.burstLeft > 0 ? b.interval : b.cooldown;
    }
  }

  dryFire(owner, now) {
    if (this.reserve > 0) this.startReload(owner, now);
    else if (now >= this.nextFire) {
      this.nextFire = now + 0.25;
      owner.game.emit('dry', { who: owner });
    }
  }

  shoot(owner, now, burst) {
    const d = this.def, r = d.recoil;
    const spread = this.spread(owner, burst);
    const yaw = owner.yaw + this.offY, pitch = owner.pitch + this.offP;
    const dirs = [];
    for (let i = 0; i < (d.pellets || 1); i++) dirs.push(coneDir(yaw, pitch, spread));
    this.mag--;
    owner.stats.shots++;
    owner.game.fireBullets(owner, this, dirs);

    // Recoil: climb along the pattern, then wander sideways once the climb plateaus.
    if (this.heat < 0.5) this.hDir = Math.random() < 0.5 ? -1 : 1;
    const idx = Math.floor(this.heat);
    const up = (idx < r.v.length ? r.v[idx] : r.tail) * (0.9 + 0.2 * Math.random());
    let side;
    if (idx >= r.hStart) {
      if (Math.random() < 0.15) this.hDir *= -1;
      side = this.hDir * r.hStep * (0.6 + 0.8 * Math.random());
      if (Math.abs(this.offY / DEG + side) > r.hAmp) { this.hDir *= -1; side = -side; }
    } else {
      side = (Math.random() - 0.5) * r.hStep * 0.3;
    }
    this.offP += up * DEG;
    this.offY += side * DEG;
    this.heat += 1;
    this.lastShot = now;
    this.recovering = false;
    owner.game.emit('shot', { who: owner, gun: this });
  }

  tickMelee(owner, now) {
    const m = this.def.melee, inp = owner.input;
    if (this.meleePending && now >= this.meleePending.at) {
      owner.game.meleeHit(owner, this.meleePending.mode);
      this.meleePending = null;
    }
    if (now < this.equipEnd || now < this.nextFire || this.meleePending) return;
    if (inp.fire) {
      this.meleePending = { at: now + 0.06, mode: m.primary };
      this.nextFire = now + m.primary.cycle;
      owner.game.emit('swing', { who: owner, heavy: false });
    } else if (inp.alt) {
      this.meleePending = { at: now + m.alt.windup, mode: m.alt };
      this.nextFire = now + m.alt.cycle;
      owner.game.emit('swing', { who: owner, heavy: true });
    }
  }
}

// Random direction inside a cone of `deg` degrees around (yaw, pitch), uniform over the disk.
export function coneDir(yaw, pitch, deg) {
  const f = dirFromAngles(yaw, pitch);
  if (deg <= 0) return f;
  const rx = Math.cos(yaw), rz = -Math.sin(yaw); // right vector (horizontal)
  // up = right x forward
  const ux = -rz * f[1], uy = rz * f[0] - rx * f[2], uz = rx * f[1];
  const a = Math.tan(deg * DEG) * Math.sqrt(Math.random());
  const th = Math.random() * Math.PI * 2;
  const ca = a * Math.cos(th), sa = a * Math.sin(th);
  const x = f[0] + rx * ca + ux * sa, y = f[1] + uy * sa, z = f[2] + rz * ca + uz * sa;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}
