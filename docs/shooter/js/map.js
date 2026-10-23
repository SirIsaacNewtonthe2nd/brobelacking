// The one map. Each character is a 2 m cell; north is the top row.
//   #  wall (5 m)           c  crate (1 m, bullets go through)   C  tall crate (2 m, bullets go through)
//   h  half wall (1.2 m)    w  thin wooden panel (bullets go through)
//   P  platform (2 m)       1-4  stairs (0.4 m per step)          s  spawn point
import { CELL } from './config.js';

export const LAYOUT = [
  '####################################',
  '#PPP4321....#..........#....1234PPP#',
  '#PPP4321....#..s..s.s..#....1234PPP#',
  '#....s......#..........#......s....#',
  '#.....cc........s..s........cc.....#',
  '#..c....C..................C....c..#',
  '#........c..##........##..c........#',
  '#.hh........##........##........hh.#',
  '#....#########........#########....#',
  '#....#########..c.....#########....#',
  '#....#########...s....#########c...#',
  '#..cC#########.ww..c..#########C...#',
  '#....#########........#########....#',
  '#........c......CC....#########..hh#',
  '#......s..............#########....#',
  '#.s..#########.....hh.......s......#',
  '#....#########............c......s.#',
  '#...c#########.c......#########....#',
  '#....#########......c.#########.c..#',
  '#....#########....s...#########....#',
  '#....#########........#########....#',
  '#............C........C............#',
  '#....c........................c....#',
  '#..w.....##......##......##.....w..#',
  '#..w.....##..ww......ww..##.....w..#',
  '#.............c......c.............#',
  '#..c..............s.............c..#',
  '#.......s....s...s....s....s.......#',
  '#..................................#',
  '####################################',
];

const SOLID = {
  '#': { mat: 'wall', h: 5, pen: false },
  'c': { mat: 'crate', h: 1.0, pen: true },
  'C': { mat: 'crate', h: 2.0, pen: true },
  'h': { mat: 'half', h: 1.2, pen: false },
  'w': { mat: 'wood', h: 2.8, pen: true, thin: 0.3 },
  'P': { mat: 'stone', h: 2.0, pen: false },
  '1': { mat: 'stone', h: 0.4, pen: false },
  '2': { mat: 'stone', h: 0.8, pen: false },
  '3': { mat: 'stone', h: 1.2, pen: false },
  '4': { mat: 'stone', h: 1.6, pen: false },
};
const WALK_HEIGHT = { '.': 0, 's': 0, 'P': 2.0, '1': 0.4, '2': 0.8, '3': 1.2, '4': 1.6 };

export function buildMap() {
  const W = LAYOUT[0].length, H = LAYOUT.length;
  const ox = -W * CELL / 2, oz = -H * CELL / 2;
  const boxes = [];
  const used = LAYOUT.map(row => Array(row.length).fill(false));

  // Merge runs of the same tile into as few boxes as possible.
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const ch = LAYOUT[z][x];
      const def = SOLID[ch];
      if (!def || used[z][x]) continue;
      let x1 = x;
      while (x1 + 1 < W && LAYOUT[z][x1 + 1] === ch && !used[z][x1 + 1]) x1++;
      let z1 = z;
      grow: while (z1 + 1 < H) {
        for (let xx = x; xx <= x1; xx++) if (LAYOUT[z1 + 1][xx] !== ch || used[z1 + 1][xx]) break grow;
        z1++;
      }
      for (let zz = z; zz <= z1; zz++) for (let xx = x; xx <= x1; xx++) used[zz][xx] = true;
      let minx = ox + x * CELL, maxx = ox + (x1 + 1) * CELL;
      let minz = oz + z * CELL, maxz = oz + (z1 + 1) * CELL;
      if (def.thin) {
        const half = def.thin / 2;
        if (x1 - x >= z1 - z) { const c = (minz + maxz) / 2; minz = c - half; maxz = c + half; }
        else { const c = (minx + maxx) / 2; minx = c - half; maxx = c + half; }
      }
      boxes.push({ min: [minx, 0, minz], max: [maxx, def.h, maxz], mat: def.mat, pen: def.pen });
    }
  }
  boxes.push({ min: [ox, -1, oz], max: [ox + W * CELL, 0, oz + H * CELL], mat: 'floor', pen: false, floor: true });

  const heights = LAYOUT.map(row => [...row].map(ch => (ch in WALK_HEIGHT ? WALK_HEIGHT[ch] : null)));
  const cellCenter = (cx, cz) => ({ x: ox + (cx + 0.5) * CELL, z: oz + (cz + 0.5) * CELL });
  const cellOf = (x, z) => [Math.floor((x - ox) / CELL), Math.floor((z - oz) / CELL)];

  const spawns = [];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (LAYOUT[z][x] === 's') {
      const c = cellCenter(x, z);
      spawns.push({ x: c.x, y: 0, z: c.z, yaw: Math.atan2(c.x, c.z) }); // face the middle of the map
    }
  }
  const walkable = [];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (heights[z][x] !== null) walkable.push([x, z]);

  const labels = [
    { text: 'A', ...cellCenter(4, 4) },
    { text: 'B', ...cellCenter(31, 4) },
    { text: 'MID', ...cellCenter(18, 14) },
  ];

  // Standing beside a thin panel puts you in a cell the grid marks as blocked; path from the closest open one.
  const nearestWalkable = (cx, cz) => {
    let best = [cx, cz], bestD = Infinity;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= W || z >= H || heights[z][x] === null) continue;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = [x, z]; }
    }
    return best;
  };

  return { W, H, ox, oz, boxes, heights, spawns, walkable, labels, cellCenter, cellOf, nearestWalkable, findPath: (a, b) => findPath(heights, W, H, a, b) };
}

// A* over the grid. Steps up at most 0.45 m, drops any height. Diagonals only when both sides are open.
function findPath(heights, W, H, start, goal) {
  const key = (x, z) => z * W + x;
  const ok = (x, z) => x >= 0 && z >= 0 && x < W && z < H && heights[z][x] !== null;
  if (!ok(start[0], start[1]) || !ok(goal[0], goal[1])) return null;
  const canStep = (ax, az, bx, bz) => heights[bz][bx] - heights[az][ax] <= 0.45;
  const g = new Map([[key(...start), 0]]);
  const came = new Map();
  const open = [[start[0], start[1], 0]];
  const h = (x, z) => Math.hypot(x - goal[0], z - goal[1]);
  const closed = new Set();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][2] < open[bi][2]) bi = i;
    const [x, z] = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    const k = key(x, z);
    if (closed.has(k)) continue;
    closed.add(k);
    if (x === goal[0] && z === goal[1]) {
      const path = [[x, z]];
      let c = k;
      while (came.has(c)) { c = came.get(c); path.push([c % W, Math.floor(c / W)]); }
      return path.reverse();
    }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const nx = x + dx, nz = z + dz;
      if (!ok(nx, nz) || !canStep(x, z, nx, nz)) continue;
      if (dx && dz && (!ok(x + dx, z) || !ok(x, z + dz) || !canStep(x, z, x + dx, z) || !canStep(x, z, x, z + dz))) continue;
      const nk = key(nx, nz);
      if (closed.has(nk)) continue;
      const ng = g.get(k) + (dx && dz ? 1.414 : 1);
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, k);
        open.push([nx, nz, ng + h(nx, nz)]);
      }
    }
  }
  return null;
}
