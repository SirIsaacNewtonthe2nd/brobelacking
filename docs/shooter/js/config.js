// Global tuning. Distances in meters, angles in degrees, time in seconds.

export const TICK_RATE = 128;
export const DT = 1 / TICK_RATE;
export const CELL = 2; // map grid cell size

// Body size. Riot hasn't published hitbox dimensions; these follow the community figures: every agent
// shares one hitbox at a reported 1.96 m in-game height, and the head is about 13% of that (~0.25 m).
const STAND_H = 1.96;
const CROUCH_H = 1.4;
const HEAD_H = 0.255;
const HEAD_HALF_W = 0.12;

export const PLAYER = {
  radius: 0.32,
  standHeight: STAND_H,
  crouchHeight: CROUCH_H,
  standEye: 1.82, // inside the head box, a little above its middle
  crouchEye: 1.27,
  stepHeight: 0.45,
  jumpVelocity: 6.95, // ~1.1 m apex
  gravity: 22,
  accel: 52, // ground acceleration toward wish velocity
  decel: 44, // braking with no input
  airAccel: 9,
  walkMult: 0.6,
  crouchMult: 0.5,
  knifeSpeed: 6.75,
  hp: 100,
};

// Shields. Light and Heavy take 66% of each hit until they've absorbed 25 / 50; the rest goes to health.
// Regen takes 100% of hits into a 25 shield, then refills it from a 50 pool 3 s after it breaks.
export const SHIELDS = {
  heavy: { name: 'Heavy', amount: 50, absorb: 0.66 },
  light: { name: 'Light', amount: 25, absorb: 0.66 },
  regen: { name: 'Regen', amount: 25, absorb: 1, pool: 50, delay: 3, rate: 25 }, // refill rate est.
  none: { name: 'None', amount: 0, absorb: 0 },
};

// Landing after being airborne adds 7 degrees of spread for 0.225 s.
export const LANDING = { spread: 7, time: 0.225 };

// Getting hit slows movement. Values from the 3.0 patch (72.5%); shotgun pellets past 10 m only slow 30%.
export const TAG = { slow: 0.725, hold: 0.25, fade: 0.25, shotgunFarSlow: 0.3, shotgunFarRange: 10 };

export const CROUCH_SPREAD = 0.85; // default crouch spread multiplier when a weapon doesn't set its own
export const VIEW_RECOIL = 0.5; // share of bullet recoil that moves the camera; bullets land above the crosshair
export const PEN_DEPTH = { low: 1.0, medium: 2.2, high: 4.4 }; // meters of penetrable material a bullet can cross
export const MAX_RANGE = 250;

// Hitboxes relative to feet, for standing and fully crouched. [yMin, yMax, halfWidth]
export const HITBOX = {
  stand: { legs: [0, 0.94, 0.19], body: [0.94, STAND_H - HEAD_H, 0.23], head: [STAND_H - HEAD_H, STAND_H, HEAD_HALF_W] },
  crouch: { legs: [0, 0.6, 0.21], body: [0.6, CROUCH_H - HEAD_H, 0.23], head: [CROUCH_H - HEAD_H, CROUCH_H, HEAD_HALF_W] },
};
// Where a third-person gun sits (chest height), standing and crouched.
export const GUN_HEIGHT = [STAND_H - HEAD_H - 0.2, CROUCH_H - HEAD_H - 0.1];

export const HFOV = 103; // horizontal FOV at 16:9
export const YAW_PER_COUNT = 0.07; // degrees per mouse count at sensitivity 1.0 (same scale as Valorant)

export const MATCH = { respawn: 3, healOnKill: true };
