// Weapon table. Damage brackets are [maxRange m, head, body, leg]; the last bracket covers anything farther.
// spread (cone half-angles in degrees, the same layout as the VALORANT wiki's spread tables):
//   hip / ads        first-shot spread standing still
//   max / maxAds     spread once the firing error has fully built up (Ares: lower than the first shot)
//   crouch           multiplier on first-shot and max spread while crouched
//   crouchMove / walk / run / air   movement penalties added on top; they scale with speed above the
//                    deadzone (the share of run speed you can still move at and keep first-shot accuracy)
// fe: shots over which spread goes from first-shot to max.
// recoil follows Valorant's model (terms from patch 11.08):
//   v / tail      vertical (pitch) kick in degrees after each shot; `tail` once the table runs out.
//   hStep / hAmp  horizontal (yaw) drift per shot toward the current side (a fifth of it before shot
//                 `hStart`), then holding at +/- `hAmp` degrees.
//   protect       protected bullets: the side can't change before this many shots.
//   switchChance  chance per shot after that for the drift to flip to the other side.
//   switchTime    seconds the sweep to the other side takes.
// reload / reloadOne: full reload, and the shorter one when only one round is missing (Outlaw).
// recovery: seconds to settle back to first-shot accuracy after you stop firing.
// Sources and estimates are listed in the README; values marked "est." have no published number.

const RIFLE_MOVE = 5.4;
const LIGHT_MOVE = 5.73;
const HEAVY_MOVE = 5.13;

// Shared movement penalties from the wiki tables.
const RIFLE_PEN = { crouchMove: 0.8, walk: 3, run: 6, air: 10, deadzone: 0.27 };
const SNIPER_PEN = { crouchMove: 7.5, walk: 10, run: 15, air: 20, deadzone: 0.27 };
const SHOTGUN_PEN = { crouch: 0.85, crouchMove: 0.5, walk: 1, run: 2, air: 4, deadzone: 0.3 }; // standardized in 12.09
const HEAVY_PEN = { crouch: 0.6, crouchMove: 0.4, walk: 3, run: 6.5, air: 10, deadzone: 0.27 };
const PISTOL_PEN = { crouchMove: 0.5, walk: 1.1, run: 2.3, air: 7, deadzone: 0.3 }; // Classic's table

export const WEAPONS = {
  knife: {
    name: 'Knife', cat: 'Melee', slot: 'melee', cost: 0, model: 'knife', move: 6.75, equip: 0.4,
    melee: { range: 2.0, primary: { dmg: 50, back: 100, cycle: 0.4 }, alt: { dmg: 75, back: 150, cycle: 1.0, windup: 0.18 } },
  },

  // Sidearms
  classic: {
    name: 'Classic', cat: 'Sidearm', slot: 'secondary', cost: 0, model: 'pistol', auto: false,
    rate: 6.75, mag: 12, reserve: 36, reload: 1.75, equip: 0.75, pen: 'low', move: LIGHT_MOVE,
    dmg: [[30, 78, 26, 22], [50, 66, 22, 18]],
    spread: { hip: 0.4, max: 1.8, crouch: 0.75, ...PISTOL_PEN },
    fe: { start: 1, end: 5 }, recovery: 0.22,
    recoil: { v: [0.6, 0.6, 0.55, 0.5, 0.45, 0.4], tail: 0.3, hStart: 2, hStep: 0.35, hAmp: 1.0, protect: 2, switchChance: 0.15, switchTime: 0.3 },
    // Right click: 3-round burst at 2.22 bursts/s with its own, wider spread table.
    alt: { type: 'burst', count: 3, interval: 0.05, cooldown: 0.35, label: '3-burst', spread: { hip: 1.9, max: 5.78, crouchMove: 0, walk: 0.6, run: 1.5, air: 2.25 } },
  },
  shorty: {
    name: 'Shorty', cat: 'Sidearm', slot: 'secondary', cost: 300, model: 'shotgun', auto: false,
    rate: 3.0, mag: 2, reserve: 6, reload: 1.75, equip: 0.75, pen: 'low', move: RIFLE_MOVE, pellets: 15,
    dmg: [[7, 36, 12, 10], [15, 24, 8, 6], [50, 9, 3, 2]],
    spread: { hip: 4.0, ...SHOTGUN_PEN },
    fe: { start: 0, end: 1 }, recovery: 0.3,
    recoil: { v: [2.5], tail: 2.0, hStart: 0, hStep: 0.3, hAmp: 0.5, protect: 0, switchChance: 0.5, switchTime: 0.2 },
  },
  frenzy: {
    name: 'Frenzy', cat: 'Sidearm', slot: 'secondary', cost: 450, model: 'pistol', auto: true,
    rate: 10, mag: 13, reserve: 39, reload: 1.5, equip: 1.0, pen: 'low', move: LIGHT_MOVE,
    dmg: [[20, 78, 26, 22], [50, 63, 21, 17]],
    spread: { hip: 0.45, max: 2.0, crouch: 0.75, ...PISTOL_PEN }, // max, crouch, movement: est.
    fe: { start: 2, end: 7 }, recovery: 0.25,
    recoil: { v: [0.45, 0.55, 0.6, 0.55, 0.5, 0.4], tail: 0.15, hStart: 3, hStep: 0.4, hAmp: 1.6, protect: 3, switchChance: 0.12, switchTime: 0.28 },
  },
  ghost: {
    name: 'Ghost', cat: 'Sidearm', slot: 'secondary', cost: 500, model: 'pistol', auto: false, suppressed: true,
    rate: 6.75, mag: 15, reserve: 45, reload: 1.5, equip: 0.75, pen: 'medium', move: LIGHT_MOVE,
    dmg: [[30, 105, 30, 25], [50, 87, 25, 21]],
    spread: { hip: 0.3, max: 1.65, crouch: 0.75, crouchMove: 0.5, walk: 1.2, run: 2.5, air: 7, deadzone: 0.3 }, // movement est.
    fe: { start: 1, end: 5 }, recovery: 0.22,
    recoil: { v: [0.5, 0.6, 0.6, 0.5, 0.4], tail: 0.25, hStart: 3, hStep: 0.25, hAmp: 0.8, protect: 3, switchChance: 0.12, switchTime: 0.3 },
  },
  bandit: {
    name: 'Bandit', cat: 'Sidearm', slot: 'secondary', cost: 600, model: 'pistol', auto: false,
    rate: 5.1, mag: 8, reserve: 24, reload: 1.5, equip: 0.75, pen: 'medium', move: LIGHT_MOVE,
    dmg: [[10, 152, 39, 33], [30, 128, 39, 33], [50, 112, 34, 28]],
    spread: { hip: 0.275, max: 2.0, crouch: 0.75, crouchMove: 0.5, walk: 1.2, run: 2.5, air: 7, deadzone: 0.3 }, // max, movement est.
    fe: { start: 1, end: 3 }, recovery: 0.32,
    recoil: { v: [1.6, 1.5, 1.3, 1.1, 0.9], tail: 0.8, hStart: 1, hStep: 0.4, hAmp: 1.0, protect: 1, switchChance: 0.2, switchTime: 0.3 },
  },
  sheriff: {
    name: 'Sheriff', cat: 'Sidearm', slot: 'secondary', cost: 800, model: 'revolver', auto: false,
    rate: 4, mag: 6, reserve: 24, reload: 2.25, equip: 1.0, pen: 'high', move: RIFLE_MOVE,
    dmg: [[30, 159, 55, 46], [50, 145, 50, 42]],
    spread: { hip: 0.25, max: 2.75, crouch: 0.75, crouchMove: 0.5, walk: 1.2, run: 3, air: 7, deadzone: 0.3 },
    fe: { start: 1, end: 3 }, recovery: 0.4,
    recoil: { v: [2.4, 2.2, 2.0, 1.6, 1.2], tail: 1.0, hStart: 1, hStep: 0.5, hAmp: 1.2, protect: 1, switchChance: 0.2, switchTime: 0.3 },
  },

  // SMGs
  stinger: {
    name: 'Stinger', cat: 'SMG', slot: 'primary', cost: 1100, model: 'smg', auto: true,
    rate: 16, mag: 20, reserve: 60, reload: 2.25, equip: 0.75, pen: 'low', move: LIGHT_MOVE,
    dmg: [[15, 67, 27, 22], [50, 57, 23, 19]],
    spread: { hip: 0.65, ads: 0.5, max: 2.0, maxAds: 1.5, crouch: 0.85, crouchMove: 0.15, walk: 1, run: 2.5, air: 10, deadzone: 0.3 }, // max, crouch est.
    fe: { start: 2, end: 8 }, recovery: 0.3,
    recoil: { v: [0.45, 0.6, 0.6, 0.5, 0.35, 0.25, 0.15, 0.1], tail: 0.05, hStart: 4, hStep: 0.45, hAmp: 2.2, protect: 4, switchChance: 0.1, switchTime: 0.28 },
    // ADS: 1.15x, 4-round bursts at 2.118 bursts/s.
    alt: { type: 'zoomBurst', zoom: 1.15, time: 0.2, moveMult: 0.76, count: 4, interval: 0.0625, cooldown: 0.285 },
  },
  spectre: {
    name: 'Spectre', cat: 'SMG', slot: 'primary', cost: 1600, model: 'smg', auto: true, suppressed: true,
    rate: 13.33, mag: 30, reserve: 90, reload: 2.25, equip: 0.75, pen: 'medium', move: LIGHT_MOVE,
    dmg: [[20, 78, 26, 22], [50, 66, 22, 18]],
    spread: { hip: 0.4, ads: 0.25, max: 1.4, maxAds: 1.25, crouch: 0.85, crouchMove: 0.15, walk: 1, run: 2.5, air: 10, deadzone: 0.3 },
    fe: { start: 3, end: 9 }, recovery: 0.3,
    recoil: { v: [0.15, 0.25, 0.3, 0.35, 0.35, 0.3, 0.25, 0.2, 0.15], tail: 0.05, hStart: 5, hStep: 0.3, hAmp: 1.6, protect: 5, switchChance: 0.1, switchTime: 0.28 },
    alt: { type: 'zoom', zoom: 1.15, time: 0.2, rateMult: 0.9, moveMult: 0.76 },
  },

  // Shotguns
  bucky: {
    name: 'Bucky', cat: 'Shotgun', slot: 'primary', cost: 850, model: 'shotgun', auto: false,
    rate: 1.1, mag: 5, reserve: 10, reload: 2.5, equip: 1.0, pen: 'low', move: RIFLE_MOVE, pellets: 15,
    dmg: [[8, 34, 17, 14], [12, 26, 13, 11], [50, 18, 9, 7]],
    spread: { hip: 3.0, ...SHOTGUN_PEN },
    fe: { start: 0, end: 1 }, recovery: 0.5,
    recoil: { v: [3.0], tail: 3.0, hStart: 0, hStep: 0.3, hAmp: 0.5, protect: 0, switchChance: 0.5, switchTime: 0.2 },
    // Right click: tighter pattern for medium range (est.).
    alt: { type: 'burst', count: 1, interval: 0, cooldown: 0.909, label: 'tight spread', spread: { hip: 1.2, max: 1.2 } },
  },
  judge: {
    name: 'Judge', cat: 'Shotgun', slot: 'primary', cost: 1850, model: 'shotgun', auto: true,
    rate: 3.5, mag: 5, reserve: 15, reload: 2.2, equip: 1.0, pen: 'low', move: RIFLE_MOVE, pellets: 12,
    dmg: [[10, 34, 17, 14], [15, 26, 13, 11], [50, 20, 10, 8]],
    spread: { hip: 2.5, max: 3.0, ...SHOTGUN_PEN },
    fe: { start: 1, end: 4 }, recovery: 0.4,
    recoil: { v: [1.8, 1.5, 1.2, 1.0], tail: 0.8, hStart: 1, hStep: 0.5, hAmp: 1.0, protect: 1, switchChance: 0.2, switchTime: 0.3 },
  },

  // Rifles
  bulldog: {
    name: 'Bulldog', cat: 'Rifle', slot: 'primary', cost: 2050, model: 'rifle', auto: true,
    rate: 9.15, mag: 24, reserve: 72, reload: 2.5, equip: 1.0, pen: 'medium', move: RIFLE_MOVE,
    dmg: [[50, 115, 35, 29]],
    spread: { hip: 0.3, ads: 0.1, max: 1.25, maxAds: 1.5, crouch: 0.85, ...RIFLE_PEN },
    fe: { start: 3, end: 8 }, recovery: 0.35,
    recoil: { v: [0.2, 0.4, 0.6, 0.7, 0.7, 0.6, 0.5, 0.4], tail: 0.08, hStart: 6, hStep: 0.35, hAmp: 2.0, protect: 6, switchChance: 0.1, switchTime: 0.6 },
    alt: { type: 'zoomBurst', zoom: 1.25, time: 0.2, moveMult: 0.76, count: 3, interval: 0.0625, cooldown: 0.18 },
  },
  guardian: {
    name: 'Guardian', cat: 'Rifle', slot: 'primary', cost: 2250, model: 'dmr', auto: false,
    rate: 5.25, mag: 12, reserve: 36, reload: 2.5, equip: 1.0, pen: 'high', move: RIFLE_MOVE,
    dmg: [[50, 195, 65, 49]],
    spread: { hip: 0.1, ads: 0, max: 1.58, maxAds: 1.48, crouch: 0.85, ...RIFLE_PEN },
    fe: { start: 1, end: 4 }, recovery: 0.3,
    recoil: { v: [1.1, 1.1, 1.0, 1.0, 0.9], tail: 0.6, hStart: 2, hStep: 0.3, hAmp: 1.0, protect: 2, switchChance: 0.15, switchTime: 0.4 },
    alt: { type: 'zoom', zoom: 1.5, time: 0.2, rateMult: 1, moveMult: 0.76 },
  },
  phantom: {
    name: 'Phantom', cat: 'Rifle', slot: 'primary', cost: 2900, model: 'rifle', auto: true, suppressed: true,
    rate: 11, mag: 30, reserve: 60, reload: 2.5, equip: 1.0, pen: 'medium', move: RIFLE_MOVE,
    dmg: [[15, 156, 39, 33], [30, 140, 35, 29], [50, 124, 31, 26]],
    spread: { hip: 0.2, ads: 0.11, max: 0.9, maxAds: 0.91, crouch: 0.85, ...RIFLE_PEN },
    fe: { start: 4, end: 10 }, recovery: 0.32,
    recoil: { v: [0.1, 0.2, 0.35, 0.5, 0.55, 0.55, 0.5, 0.45, 0.35, 0.25, 0.15, 0.1], tail: 0.04, hStart: 8, hStep: 0.3, hAmp: 1.8, protect: 8, switchChance: 0.1, switchTime: 0.6 },
    alt: { type: 'zoom', zoom: 1.25, time: 0.2, rateMult: 0.9, moveMult: 0.76 },
  },
  vandal: {
    name: 'Vandal', cat: 'Rifle', slot: 'primary', cost: 2900, model: 'rifle', auto: true,
    rate: 9.75, mag: 25, reserve: 50, reload: 2.5, equip: 1.0, pen: 'medium', move: RIFLE_MOVE,
    dmg: [[50, 160, 40, 34]],
    spread: { hip: 0.25, ads: 0.157, max: 1.0, maxAds: 1.02, crouch: 0.85, ...RIFLE_PEN },
    fe: { start: 3, end: 9 }, recovery: 0.375,
    recoil: { v: [0.1, 0.2, 0.5, 0.75, 0.85, 0.85, 0.8, 0.7, 0.55, 0.35, 0.2], tail: 0.05, hStart: 6, hStep: 0.4, hAmp: 2.4, protect: 6, switchChance: 0.1, switchTime: 0.6 },
    alt: { type: 'zoom', zoom: 1.25, time: 0.2, rateMult: 0.9, moveMult: 0.76 },
  },
  warden: {
    name: 'Warden', cat: 'Rifle', slot: 'primary', cost: 2900, model: 'dmr', auto: true,
    rate: 6.5, mag: 18, reserve: 36, reload: 2.5, equip: 1.0, pen: 'medium', move: RIFLE_MOVE,
    dmg: [[50, 200, 50, 42]],
    spread: { hip: 0.15, ads: 0.04, max: 1.0, maxAds: 0.9, crouch: 0.85, ...RIFLE_PEN }, // max est.
    fe: { start: 2, end: 6 }, recovery: 0.35,
    recoil: { v: [0.9, 1.0, 1.0, 0.9, 0.8, 0.6, 0.4], tail: 0.1, hStart: 4, hStep: 0.35, hAmp: 1.5, protect: 4, switchChance: 0.1, switchTime: 0.6 },
    alt: { type: 'zoom', zoom: 2.0, time: 0.25, rateMult: 1, moveMult: 0.76 },
  },

  // Snipers. `unscope`: the bolt cycle drops you out of the scope after each shot; hold right click to
  // scope back in the moment it's ready.
  marshal: {
    name: 'Marshal', cat: 'Sniper', slot: 'primary', cost: 950, model: 'sniper', auto: false,
    rate: 1.5, mag: 5, reserve: 10, reload: 2.5, equip: 1.25, pen: 'medium', move: RIFLE_MOVE,
    dmg: [[50, 202, 101, 85]],
    spread: { hip: 1.0, ads: 0, max: 1.0, maxAds: 0, crouch: 0.9, ...SNIPER_PEN },
    fe: { start: 0, end: 1 }, recovery: 0.5,
    recoil: { v: [3.5], tail: 3.5, hStart: 0, hStep: 0.3, hAmp: 0.5, protect: 0, switchChance: 0.5, switchTime: 0.2 },
    alt: { type: 'scope', levels: [3.5], time: 0.3, moveMult: 0.9, unscope: true },
  },
  outlaw: {
    name: 'Outlaw', cat: 'Sniper', slot: 'primary', cost: 2400, model: 'sniper', auto: false,
    rate: 2.75, mag: 2, reserve: 10, reload: 3.8, reloadOne: 2.3, equip: 1.25, pen: 'high', move: RIFLE_MOVE,
    dmg: [[50, 238, 140, 119]],
    // Patch 13.01: the follow-up scoped shot gets 2.25 spread and 4.0 recoil. Recovery is set so a
    // back-to-back second shot lands near the ~2.1 degrees measured in game.
    spread: { hip: 3.5, ads: 0, max: 3.5, maxAds: 2.25, crouch: 0.9, ...SNIPER_PEN },
    fe: { start: 0, end: 1 }, recovery: 1.5,
    recoil: { v: [4.0, 4.0], tail: 4.0, hStart: 0, hStep: 0.3, hAmp: 0.5, protect: 0, switchChance: 0.5, switchTime: 0.2 },
    alt: { type: 'scope', levels: [3.5], time: 0.3, moveMult: 0.8 },
  },
  operator: {
    name: 'Operator', cat: 'Sniper', slot: 'primary', cost: 4700, model: 'sniper', auto: false,
    rate: 0.6, mag: 5, reserve: 10, reload: 3.7, equip: 1.5, pen: 'high', move: HEAVY_MOVE,
    dmg: [[50, 255, 150, 127]],
    spread: { hip: 5.0, ads: 0, max: 5.0, maxAds: 0, crouch: 0.9, ...SNIPER_PEN, air: 15 },
    fe: { start: 0, end: 1 }, recovery: 0.6,
    recoil: { v: [5.0], tail: 5.0, hStart: 0, hStep: 0.3, hAmp: 0.5, protect: 0, switchChance: 0.5, switchTime: 0.2 },
    alt: { type: 'scope', levels: [2.5, 5], time: 0.35, moveMult: 0.72, unscope: true },
  },

  // Heavies
  ares: {
    name: 'Ares', cat: 'Heavy', slot: 'primary', cost: 1600, model: 'heavy', auto: true,
    rate: 13, mag: 50, reserve: 100, reload: 3.25, equip: 1.25, pen: 'high', move: HEAVY_MOVE,
    dmg: [[30, 72, 30, 25], [50, 67, 28, 23]],
    // Reverse accuracy: spread tightens from 1.0 to 0.7 over the first 13 shots.
    spread: { hip: 1.0, ads: 0.9, max: 0.7, maxAds: 0.6, ...HEAVY_PEN },
    fe: { start: 0, end: 13 }, recovery: 0.4,
    recoil: { v: [0.15, 0.2, 0.25, 0.3, 0.3, 0.3, 0.25, 0.2, 0.2, 0.15, 0.1], tail: 0.04, hStart: 8, hStep: 0.25, hAmp: 1.5, protect: 8, switchChance: 0.08, switchTime: 0.6 },
    alt: { type: 'zoom', zoom: 1.15, time: 0.25, rateMult: 1, moveMult: 0.76 },
  },
  odin: {
    name: 'Odin', cat: 'Heavy', slot: 'primary', cost: 3200, model: 'heavy', auto: true,
    rate: 12, spin: { to: 15.6, time: 1.0, adsInstant: true }, mag: 100, reserve: 200, reload: 5.0, equip: 1.25, pen: 'high', move: HEAVY_MOVE,
    dmg: [[30, 95, 38, 32], [50, 77, 31, 26]],
    spread: { hip: 0.8, ads: 0.79, max: 1.3, maxAds: 1.3, ...HEAVY_PEN },
    fe: { start: 5, end: 16 }, recovery: 0.4,
    recoil: { v: [0.2, 0.3, 0.35, 0.4, 0.4, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1], tail: 0.05, hStart: 10, hStep: 0.3, hAmp: 2.2, protect: 10, switchChance: 0.08, switchTime: 0.6 },
    alt: { type: 'zoom', zoom: 1.15, time: 0.25, rateMult: 1, moveMult: 0.76 },
  },
};

for (const [id, w] of Object.entries(WEAPONS)) w.id = id;

export const BUY_GROUPS = [
  ['Sidearms', ['classic', 'shorty', 'frenzy', 'ghost', 'bandit', 'sheriff']],
  ['SMGs', ['stinger', 'spectre']],
  ['Shotguns', ['bucky', 'judge']],
  ['Rifles', ['bulldog', 'guardian', 'phantom', 'vandal', 'warden']],
  ['Snipers', ['marshal', 'outlaw', 'operator']],
  ['Heavies', ['ares', 'odin']],
];

export function damageAt(def, dist) {
  for (const b of def.dmg) if (dist <= b[0]) return b;
  return def.dmg[def.dmg.length - 1];
}
