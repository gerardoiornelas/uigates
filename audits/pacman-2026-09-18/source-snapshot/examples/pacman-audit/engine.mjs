// Deterministic simulation shared by the playable browser game and behavioral audit.
export const DEFAULT_MAP = [
  '###################',
  '#o.......#.......o#',
  '#.##.###.#.###.##.#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#...#...#....#',
  '####.###.#.###.####',
  '#....#.......#....#',
  '#.##.#.##.##.#.##.#',
  '...................',
  '#.##.#.#####.#.##.#',
  '#....#.......#....#',
  '####.#.#####.#.####',
  '#........#........#',
  '#.##.###.#.###.##.#',
  '#o.#.....P.....#.o#',
  '##.#.#.#####.#.#.##',
  '#....#...#...#....#',
  '#.######.#.######.#',
  '#.................#',
  '###################',
];
export const DIRECTIONS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
export function createGame({ map = DEFAULT_MAP, seed = 1, ghostCount = 4 } = {}) {
  const grid = map.map(row => [...row]);
  if (!grid.length || grid.some(row => row.length !== grid[0].length)) throw Error('Map must be rectangular');
  let start;
  grid.forEach((row, y) => row.forEach((v, x) => { if (v === 'P') { start = { x, y }; grid[y][x] = ' '; } }));
  if (!start) throw Error('Map needs player spawn');
  const cells = [];
  grid.forEach((row, y) => row.forEach((v, x) => { if (v !== '#') cells.push({ x, y }); }));
  const spawns = cells.sort((a, b) => Math.abs(b.x-start.x)+Math.abs(b.y-start.y)-Math.abs(a.x-start.x)-Math.abs(a.y-start.y)).slice(0, ghostCount);
  return { grid, width: grid[0].length, height: grid.length, start, player: { ...start }, direction: null,
    queued: null, ghosts: spawns.map(p => ({ ...p, spawn: { ...p } })), score: 0, lives: 3,
    remaining: grid.flat().filter(v => v === '.' || v === 'o').length, power: 0, tick: 0,
    status: 'playing', seed: seed >>> 0, initialMap: map.slice(), ghostCount };
}
export function destination(s, p, direction, tunnel = 'wrap') {
  if (!DIRECTIONS[direction]) return null;
  const [dx, dy] = DIRECTIONS[direction];
  let x = p.x + dx, y = p.y + dy;
  if (y < 0 || y >= s.height) return null;
  if (x < 0 || x >= s.width) {
    if (tunnel === 'blocked') return null;
    if (tunnel === 'wrap' && (s.grid[y][0] === '#' || s.grid[y][s.width-1] === '#')) return null;
    if (tunnel === 'right-only' && x < 0) return null;
    x = (x + s.width) % s.width;
  }
  return s.grid[y][x] === '#' ? null : { x, y };
}
const equal = (a, b) => a.x === b.x && a.y === b.y;
export function queue(s, direction) { if (DIRECTIONS[direction]) s.queued = direction; }
export function togglePause(s) { if (s.status === 'playing') s.status = 'paused'; else if (s.status === 'paused') s.status = 'playing'; }
function random(s) { s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0; return s.seed / 4294967296; }
export function step(s, { tunnel = 'wrap', collision = 'swept', terminal = 'loss-first', ghostMoves } = {}) {
  if (s.status !== 'playing') return s;
  const oldPlayer = { ...s.player }, oldGhosts = s.ghosts.map(g => ({ ...g }));
  s.tick++;
  if (s.power > 0) s.power--;
  if (destination(s, s.player, s.queued, tunnel)) s.direction = s.queued;
  s.player = destination(s, s.player, s.direction, tunnel) ?? s.player;
  const tile = s.grid[s.player.y][s.player.x];
  if (tile === '.' || tile === 'o') {
    s.score += tile === 'o' ? 50 : 10;
    if (tile === 'o') s.power = 35;
    s.grid[s.player.y][s.player.x] = ' ';
    s.remaining--;
  }
  s.ghosts.forEach((g, i) => {
    let next;
    if (ghostMoves) next = destination(s, g, ghostMoves[i], tunnel);
    else if (s.tick % 2 === 0) {
      const choices = Object.keys(DIRECTIONS).map(d => destination(s, g, d, tunnel)).filter(Boolean);
      choices.sort((a, b) => {
        const dist = p => Math.abs(p.x-s.player.x)+Math.abs(p.y-s.player.y);
        return (dist(a)-dist(b)) * (s.power ? -1 : 1);
      });
      next = random(s) < 0.22 ? choices[Math.floor(random(s)*choices.length)] : choices[0];
    }
    if (next) Object.assign(g, next);
  });
  const hits = s.ghosts.filter((g, i) => equal(s.player, g) || (collision === 'swept' &&
    (equal(oldPlayer, oldGhosts[i]) || (equal(s.player, oldGhosts[i]) && equal(g, oldPlayer)))));
  let dead = false;
  if (collision !== 'disabled' && hits.length) {
    if (s.power) { for (const g of hits) { s.score += 200; Object.assign(g, g.spawn); } }
    else {
      dead = true; s.lives--;
      if (!s.lives) s.status = 'lost';
      else { s.player = { ...s.start }; s.direction = s.queued = null; s.ghosts.forEach(g => Object.assign(g, g.spawn)); }
    }
  }
  if (s.remaining === 0 && (terminal === 'win-first' || (!dead && terminal === 'loss-first'))) s.status = 'won';
  return s;
}
