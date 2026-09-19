import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Candidate implementations ("approaches") and behavioral verifiers for the
 * arcade pressure test. Every approach is real game code. A verifier executes
 * the assembled game.js and probes it; nothing here is a coin flip.
 */

export type Game = 'breakout' | 'pong';
export type Check = [name: string, ok: boolean];
export interface Approach { id: string; code: string }

export const FAMILIES: Record<Game, string[]> = {
  breakout: ['movement', 'wall', 'paddle', 'round', 'brick'],
  pong: ['movement', 'wall', 'paddle', 'round', 'ai'],
};

// ---------- approach catalogue ----------

const MOVE: Approach[] = [
  { id: 'fixed per-frame increment', code: `function move(ball, dt) { ball.x += ball.vx / 60; ball.y += ball.vy / 60; }` },
  { id: 'delta-time on one axis', code: `function move(ball, dt) { ball.x += ball.vx * dt; ball.y += ball.vy; }` },
  { id: 'delta-time on both axes', code: `function move(ball, dt) { ball.x += ball.vx * dt; ball.y += ball.vy * dt; }` },
];

const WALL_BREAKOUT: Approach[] = [
  { id: 'negate velocity only', code: `function wall(ball, W, H) {
  if (ball.x - ball.r < 0 || ball.x + ball.r > W) ball.vx = -ball.vx;
  if (ball.y - ball.r < 0) ball.vy = -ball.vy;
}` },
  { id: 'clamp position only', code: `function wall(ball, W, H) {
  ball.x = Math.max(ball.r, Math.min(W - ball.r, ball.x));
  ball.y = Math.max(ball.r, ball.y);
}` },
  { id: 'clamp and reflect', code: `function wall(ball, W, H) {
  if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
  else if (ball.x + ball.r > W) { ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx); }
  if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); }
}` },
  { id: 'mirror overshoot', code: `function wall(ball, W, H) {
  if (ball.x - ball.r < 0) { ball.x = 2 * ball.r - ball.x; ball.vx = Math.abs(ball.vx); }
  else if (ball.x + ball.r > W) { ball.x = 2 * (W - ball.r) - ball.x; ball.vx = -Math.abs(ball.vx); }
  if (ball.y - ball.r < 0) { ball.y = 2 * ball.r - ball.y; ball.vy = Math.abs(ball.vy); }
}` },
];

const WALL_PONG: Approach[] = [
  { id: 'negate velocity only', code: `function wall(ball, W, H) {
  if (ball.y - ball.r < 0 || ball.y + ball.r > H) ball.vy = -ball.vy;
}` },
  { id: 'clamp position only', code: `function wall(ball, W, H) {
  ball.y = Math.max(ball.r, Math.min(H - ball.r, ball.y));
}` },
  { id: 'clamp and reflect', code: `function wall(ball, W, H) {
  if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); }
  else if (ball.y + ball.r > H) { ball.y = H - ball.r; ball.vy = -Math.abs(ball.vy); }
}` },
  { id: 'mirror overshoot', code: `function wall(ball, W, H) {
  if (ball.y - ball.r < 0) { ball.y = 2 * ball.r - ball.y; ball.vy = Math.abs(ball.vy); }
  else if (ball.y + ball.r > H) { ball.y = 2 * (H - ball.r) - ball.y; ball.vy = -Math.abs(ball.vy); }
}` },
];

// One generic implementation per approach: paddle.axis / paddle.dir carry the orientation.
const PADDLE: Approach[] = [
  { id: 'flip velocity on overlap', code: `function paddleHit(ball, p, prev) {
  const a = axisInfo(p);
  if (overlaps(ball, p)) ball[a.nv] = -ball[a.nv];
}` },
  { id: 'flip and reposition', code: `function paddleHit(ball, p, prev) {
  const a = axisInfo(p);
  if (!overlaps(ball, p)) return;
  const face = p.dir < 0 ? p[a.n] : p[a.n] + p[a.ns];
  ball[a.nv] = p.dir * Math.abs(ball[a.nv]);
  ball[a.n] = face + p.dir * ball.r;
}` },
  { id: 'hit-offset angle', code: `function paddleHit(ball, p, prev) {
  const a = axisInfo(p);
  if (ball[a.nv] * p.dir >= 0 || !overlaps(ball, p)) return;
  const face = p.dir < 0 ? p[a.n] : p[a.n] + p[a.ns];
  const off = clamp((ball[a.t] - p[a.t]) / p[a.ts] * 2 - 1, -1, 1);
  const sp = Math.hypot(ball.vx, ball.vy), ang = off * Math.PI / 3;
  ball[a.n] = face + p.dir * ball.r;
  ball[a.tv] = sp * Math.sin(ang);
  ball[a.nv] = p.dir * sp * Math.cos(ang);
}` },
  { id: 'swept hit-offset angle', code: `function paddleHit(ball, p, prev) {
  const a = axisInfo(p);
  if (ball[a.nv] * p.dir >= 0) return;                 // only balls travelling toward the paddle
  const face = p.dir < 0 ? p[a.n] : p[a.n] + p[a.ns];
  const depth = pos => -p.dir * (pos - face);          // > 0 once the centre is past the face
  let hit = overlaps(ball, p) && depth(ball[a.n]) <= p[a.ns];
  if (!hit && prev) {
    const d0 = depth(prev[a.n]), d1 = depth(ball[a.n]);
    if (d0 <= -ball.r && d1 >= -ball.r) {              // crossed the face plane this frame
      const f = (-ball.r - d0) / (d1 - d0);
      const tan = prev[a.t] + f * (ball[a.t] - prev[a.t]);
      hit = tan >= p[a.t] - ball.r && tan <= p[a.t] + p[a.ts] + ball.r;
    }
  }
  if (!hit) return;
  const off = clamp((ball[a.t] - p[a.t]) / p[a.ts] * 2 - 1, -1, 1);
  const sp = Math.hypot(ball.vx, ball.vy), ang = off * Math.PI / 3;
  ball[a.n] = face + p.dir * ball.r;
  ball[a.tv] = sp * Math.sin(ang);
  ball[a.nv] = p.dir * sp * Math.cos(ang);
}` },
];

const ROUND_BREAKOUT: Approach[] = [
  { id: 'count every frame while out', code: `function roundCheck(state) {
  if (state.ball.y - state.ball.r > state.H) { state.lives--; if (state.lives <= 0) state.over = true; }
}` },
  { id: 'one-shot latch never cleared', code: `function roundCheck(state) {
  if (state.ball.y - state.ball.r > state.H && !state.lost) {
    state.lives--; state.lost = true; state.ball = serve(state);
    if (state.lives <= 0) state.over = true;
  }
}` },
  { id: 'respawn and count', code: `function roundCheck(state) {
  if (state.ball.y - state.ball.r > state.H) { state.lives--; state.ball = serve(state); }
}` },
  { id: 'respawn, count, end at limit', code: `function roundCheck(state) {
  if (state.over) return;
  if (state.ball.y - state.ball.r > state.H) {
    state.lives = Math.max(0, state.lives - 1);
    if (state.lives === 0) state.over = true; else state.ball = serve(state);
  }
}` },
];

const ROUND_PONG: Approach[] = [
  { id: 'count every frame while out', code: `function roundCheck(state) {
  const b = state.ball;
  if (b.x - b.r > W) state.scoreL++; else if (b.x + b.r < 0) state.scoreR++;
  if (state.scoreL >= WIN || state.scoreR >= WIN) state.over = true;
}` },
  { id: 'one-shot latch never cleared', code: `function roundCheck(state) {
  const b = state.ball;
  if (state.scored) return;
  if (b.x - b.r > W) { state.scoreL++; state.scored = true; state.ball = serve(state, -1); }
  else if (b.x + b.r < 0) { state.scoreR++; state.scored = true; state.ball = serve(state, 1); }
  if (state.scoreL >= WIN || state.scoreR >= WIN) state.over = true;
}` },
  { id: 'respawn and count', code: `function roundCheck(state) {
  const b = state.ball;
  if (b.x - b.r > W) { state.scoreL++; state.ball = serve(state, -1); }
  else if (b.x + b.r < 0) { state.scoreR++; state.ball = serve(state, 1); }
}` },
  { id: 'respawn, count, end at limit', code: `function roundCheck(state) {
  if (state.over) return;
  const b = state.ball;
  if (b.x - b.r > W) { state.scoreL++; state.ball = serve(state, -1); }
  else if (b.x + b.r < 0) { state.scoreR++; state.ball = serve(state, 1); }
  if (state.scoreL >= WIN || state.scoreR >= WIN) state.over = true;
}` },
];

const BRICK: Approach[] = [
  { id: 'remove on overlap only', code: `function brickHit(ball, state) {
  for (const b of state.bricks) if (b.alive && overlaps(ball, b)) { b.alive = false; state.score += 10; return; }
}` },
  { id: 'always flip vertical', code: `function brickHit(ball, state) {
  for (const b of state.bricks) if (b.alive && overlaps(ball, b)) { b.alive = false; state.score += 10; ball.vy = -ball.vy; return; }
}` },
  { id: 'reflect on shallow axis, remove all overlaps', code: `function brickHit(ball, state) {
  let hit = null;
  for (const b of state.bricks) if (b.alive && overlaps(ball, b)) { b.alive = false; state.score += 10; hit = hit || b; }
  if (!hit) return;
  const dx = Math.min(ball.x + ball.r - hit.x, hit.x + hit.w - (ball.x - ball.r));
  const dy = Math.min(ball.y + ball.r - hit.y, hit.y + hit.h - (ball.y - ball.r));
  if (dx < dy) ball.vx = ball.x < hit.x + hit.w / 2 ? -Math.abs(ball.vx) : Math.abs(ball.vx);
  else ball.vy = ball.y < hit.y + hit.h / 2 ? -Math.abs(ball.vy) : Math.abs(ball.vy);
}` },
  { id: 'reflect on shallow axis, remove one', code: `function brickHit(ball, state) {
  for (const b of state.bricks) {
    if (!b.alive || !overlaps(ball, b)) continue;
    b.alive = false; state.score += 10;
    const dx = Math.min(ball.x + ball.r - b.x, b.x + b.w - (ball.x - ball.r));
    const dy = Math.min(ball.y + ball.r - b.y, b.y + b.h - (ball.y - ball.r));
    if (dx < dy) {
      const left = ball.x < b.x + b.w / 2;
      ball.vx = left ? -Math.abs(ball.vx) : Math.abs(ball.vx);
      ball.x = left ? b.x - ball.r - 0.01 : b.x + b.w + ball.r + 0.01;   // leave the brick so a neighbour is not hit twice
    } else {
      const above = ball.y < b.y + b.h / 2;
      ball.vy = above ? -Math.abs(ball.vy) : Math.abs(ball.vy);
      ball.y = above ? b.y - ball.r - 0.01 : b.y + b.h + ball.r + 0.01;
    }
    return;
  }
}` },
];

const AI: Approach[] = [
  { id: 'snap to ball', code: `function aiMove(p, ball, dt, H) { p.y = ball.y - p.h / 2; }` },
  { id: 'capped step without stopping', code: `function aiMove(p, ball, dt, H) {
  const d = ball.y - p.h / 2 - p.y;
  p.y += Math.sign(d) * AI_SPEED * dt;
  p.y = clamp(p.y, 0, H - p.h);
}` },
  { id: 'capped step, stop at target', code: `function aiMove(p, ball, dt, H) {
  const d = ball.y - p.h / 2 - p.y;
  p.y += Math.sign(d) * Math.min(Math.abs(d), AI_SPEED * dt);
}` },
  { id: 'capped step, stop at target, clamp to arena', code: `function aiMove(p, ball, dt, H) {
  const d = ball.y - p.h / 2 - p.y;
  p.y += Math.sign(d) * Math.min(Math.abs(d), AI_SPEED * dt);
  p.y = clamp(p.y, 0, H - p.h);
}` },
];

export function approachesFor(game: Game, family: string): Approach[] {
  switch (family) {
    case 'movement': return MOVE;
    case 'wall': return game === 'breakout' ? WALL_BREAKOUT : WALL_PONG;
    case 'paddle': return PADDLE;
    case 'round': return game === 'breakout' ? ROUND_BREAKOUT : ROUND_PONG;
    case 'brick': return BRICK;
    case 'ai': return AI;
  }
  throw new Error(`unknown family ${family}`);
}

// ---------- assembly + execution ----------

const TEMPLATE_DIR = __dirname;
const templates: Partial<Record<Game, string>> = {};
function template(game: Game): string {
  return (templates[game] ??= fs.readFileSync(path.join(TEMPLATE_DIR, `${game}.template.js`), 'utf8'));
}

export function assemble(game: Game, chosen: Record<string, string>): string {
  const code = FAMILIES[game].filter(f => chosen[f]).map(f => `// --- ${f} ---\n${chosen[f]}`).join('\n\n');
  return template(game).replace('/*%%FAMILIES%%*/', code);
}

export function load(code: string): any {
  const sandbox: any = { module: { exports: {} }, console: { log() {}, warn() {} } };
  vm.runInNewContext(code, sandbox, { timeout: 2000 });
  return sandbox.module.exports;
}

// ---------- verifiers ----------

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const finite = (...xs: number[]) => xs.every(Number.isFinite);
const ball = (o: any = {}) => ({ x: 200, y: 300, vx: 0, vy: 0, r: 8, ...o });

function guarded(fn: () => Check[]): Check[] {
  try { return fn(); } catch (e) { return [[`threw: ${String(e).split('\n')[0].slice(0, 70)}`, false]]; }
}

function movementChecks(m: any): Check[] {
  return guarded(() => {
    const run = (n: number, dt: number) => { const b = ball({ x: 0, y: 0, vx: 300, vy: -200 }); for (let i = 0; i < n; i++) m.move(b, dt); return b; };
    const a = run(60, 1 / 60), b = run(30, 1 / 30);
    return [
      ['x advances by vx*dt', near(a.x, 300, 1e-6)],
      ['y advances by vy*dt', near(a.y, -200, 1e-6)],
      ['same result at 30fps and 60fps', near(a.x, b.x, 1e-6) && near(a.y, b.y, 1e-6)],
    ];
  });
}

function wallChecks(game: Game, m: any): Check[] {
  return guarded(() => {
    const { W, H } = m;
    const w = (b: any, times = 1) => { for (let i = 0; i < times; i++) m.wall(b, W, H); return b; };
    const checks: Check[] = [];
    if (game === 'breakout') {
      const L = w(ball({ x: -3, vx: -200, vy: 100 }), 2);
      checks.push(['left wall reflects and stays reflected', L.vx > 0 && L.x >= 8]);
      const Rr = w(ball({ x: W + 3, vx: 200 }), 2);
      checks.push(['right wall reflects and stays reflected', Rr.vx < 0 && Rr.x <= W - 8]);
      const T = w(ball({ y: -3, vy: -150 }), 2);
      checks.push(['top wall reflects and stays reflected', T.vy > 0 && T.y >= 8]);
      const D = w(ball({ x: -3, vx: 200 }));
      checks.push(['does not re-flip a ball already leaving the wall', D.vx > 0]);
      const B = w(ball({ y: H + 5, vy: 120 }));
      checks.push(['bottom stays open', B.vy === 120 && B.y === H + 5]);
    } else {
      const T = w(ball({ y: -3, vy: -150, vx: 100 }), 2);
      checks.push(['top wall reflects and stays reflected', T.vy > 0 && T.y >= 8]);
      const Bt = w(ball({ y: H + 3, vy: 150 }), 2);
      checks.push(['bottom wall reflects and stays reflected', Bt.vy < 0 && Bt.y <= H - 8]);
      const D = w(ball({ y: -3, vy: 200 }));
      checks.push(['does not re-flip a ball already leaving the wall', D.vy > 0]);
      const Lo = w(ball({ x: -3, vx: -200 }));
      checks.push(['left/right stay open for scoring', Lo.vx === -200 && Lo.x === -3]);
    }
    const mid = w(ball({ x: 200, y: 300, vx: 50, vy: 60 }));
    checks.push(['leaves interior balls untouched', mid.x === 200 && mid.y === 300 && mid.vx === 50 && mid.vy === 60]);
    return checks;
  });
}

function paddleChecksFor(m: any, p: any, label: string): Check[] {
  const A = p.axis === 'y' ? { n: 'y', t: 'x', nv: 'vy', tv: 'vx', ns: 'h', ts: 'w' } : { n: 'x', t: 'y', nv: 'vx', tv: 'vy', ns: 'w', ts: 'h' };
  const face = p.dir < 0 ? p[A.n] : p[A.n] + p[A.ns];
  const mk = (nOff: number, f: number, sp: number, toward = true) => {
    const b: any = { r: 8, vx: 0, vy: 0 };
    b[A.n] = face + p.dir * nOff;
    b[A.t] = p[A.t] + f * p[A.ts];
    b[A.nv] = (toward ? -p.dir : p.dir) * sp;
    return b;
  };
  const prevOf = (b: any, dt = 1 / 60) => ({ x: b.x - b.vx * dt, y: b.y - b.vy * dt });
  const hit = (b: any, prev = prevOf(b)) => { m.paddleHit(b, p, prev); return b; };
  const away = (b: any) => b[A.nv] * p.dir > 0;
  const speed = (b: any) => Math.hypot(b.vx, b.vy);
  const c: Check[] = [];

  const center = hit(mk(6, 0.5, 320));
  c.push([`${label}: centre hit returns the ball`, away(center) && Math.abs(center[A.tv]) < 0.1 * 320]);
  const leftEdge = hit(mk(6, 0.1, 320));
  c.push([`${label}: near-end hit deflects toward that end`, leftEdge[A.tv] < -0.5 * 320]);
  const rightEdge = hit(mk(6, 0.9, 320));
  c.push([`${label}: far-end hit deflects toward the other end`, rightEdge[A.tv] > 0.5 * 320]);
  const sp = hit(mk(6, 0.7, 320));
  c.push([`${label}: speed is preserved`, Math.abs(speed(sp) - 320) < 3.2]);
  const twice = mk(6, 0.5, 320); hit(twice); hit(twice);
  c.push([`${label}: repeated overlap frames do not re-flip`, away(twice)]);
  const tunnelPrev = mk(40, 0.5, 2000);
  const tunnelNow = mk(-(p[A.ns] + 30), 0.5, 2000);
  m.paddleHit(tunnelNow, p, { x: tunnelPrev.x, y: tunnelPrev.y });
  c.push([`${label}: fast ball cannot tunnel through`, away(tunnelNow) && p.dir * (tunnelNow[A.n] - face) >= 0]);
  const miss = mk(6, -1.5, 320); const missV = [miss.vx, miss.vy]; hit(miss);
  c.push([`${label}: a miss is left alone`, miss.vx === missV[0] && miss.vy === missV[1]]);
  const leaving = mk(6, 0.5, 320, false); const lv = [leaving.vx, leaving.vy]; hit(leaving);
  c.push([`${label}: does not grab a departing ball`, leaving.vx === lv[0] && leaving.vy === lv[1]]);
  return c;
}

function paddleChecks(game: Game, m: any): Check[] {
  return guarded(() => {
    if (game === 'breakout') return paddleChecksFor(m, { x: 200, y: 600, w: 80, h: 12, axis: 'y', dir: -1 }, 'paddle');
    return [
      ...paddleChecksFor(m, { x: 20, y: 150, w: 12, h: 70, axis: 'x', dir: 1 }, 'left'),
      ...paddleChecksFor(m, { x: 608, y: 150, w: 12, h: 70, axis: 'x', dir: -1 }, 'right'),
    ];
  });
}

function roundChecks(game: Game, m: any): Check[] {
  return guarded(() => {
    const c: Check[] = [];
    if (game === 'breakout') {
      const s = m.createGame(1);
      const out = () => { s.ball.y = m.H + m.R + 5; };
      m.roundCheck(s);
      c.push(['in-bounds ball costs nothing', s.lives === 3]);
      out(); for (let i = 0; i < 5; i++) m.roundCheck(s);
      c.push(['a lost ball costs exactly one life', s.lives === 2]);
      c.push(['ball is back in play after a loss', s.ball.y < m.H]);
      out(); m.roundCheck(s);
      c.push(['a second loss also counts', s.lives === 1]);
      out(); m.roundCheck(s);
      c.push(['game ends at zero lives', s.lives === 0 && s.over === true]);
      for (let i = 0; i < 3; i++) { out(); m.roundCheck(s); }
      c.push(['lives never go negative', s.lives === 0]);
    } else {
      const s = m.createGame(1);
      const goalL = () => { s.ball.x = m.W + m.R + 5; };
      const goalR = () => { s.ball.x = -m.R - 5; };
      m.roundCheck(s);
      c.push(['in-bounds ball scores nothing', s.scoreL === 0 && s.scoreR === 0]);
      goalL(); for (let i = 0; i < 5; i++) m.roundCheck(s);
      c.push(['a goal counts exactly once', s.scoreL === 1 && s.scoreR === 0]);
      c.push(['ball is back in play after a goal', s.ball.x >= 0 && s.ball.x <= m.W]);
      goalL(); m.roundCheck(s);
      c.push(['a second goal also counts', s.scoreL === 2]);
      goalR(); m.roundCheck(s);
      c.push(['goals on the other side count for the other player', s.scoreR === 1]);
      for (let i = 0; i < 3; i++) { goalL(); m.roundCheck(s); }
      c.push(['game ends at the win score', s.scoreL === m.WIN && s.over === true]);
      goalL(); m.roundCheck(s);
      c.push(['no scoring after game over', s.scoreL === m.WIN]);
    }
    return c;
  });
}

function brickChecks(m: any): Check[] {
  return guarded(() => {
    const R = m.R;
    const fresh = (bricks: any[]) => { const s = m.createGame(1); s.bricks = bricks; s.score = 0; return s; };
    const B = (x: number) => ({ x, y: 100, w: 40, h: 20, alive: true, row: 0 });
    const c: Check[] = [];
    const s1 = fresh([B(100)]); const b1 = ball({ x: 120, y: 120 + R - 2, vx: 50, vy: -300, r: R });
    m.brickHit(b1, s1);
    c.push(['hit from below removes the brick and scores', !s1.bricks[0].alive && s1.score === 10]);
    c.push(['hit from below reflects vertically', b1.vy > 0 && b1.vx === 50]);
    const s2 = fresh([B(100)]); const b2 = ball({ x: 100 - R + 2, y: 110, vx: 300, vy: 20, r: R });
    m.brickHit(b2, s2);
    c.push(['side hit reflects horizontally and keeps vertical', b2.vx < 0 && b2.vy === 20]);
    const s3 = fresh([B(100), B(144)]); const b3 = ball({ x: 142, y: 120 + R - 2, vx: 0, vy: -300, r: R });
    m.brickHit(b3, s3);
    c.push(['corner between two bricks removes exactly one', s3.bricks.filter((k: any) => !k.alive).length === 1]);
    const before = s3.score; m.brickHit(b3, s3);
    c.push(['next frame does not double count', s3.score === before]);
    const s5 = fresh([B(100)]); const b5 = ball({ x: 300, y: 300, vy: -300, r: R }); m.brickHit(b5, s5);
    c.push(['no overlap changes nothing', s5.bricks[0].alive && b5.vy === -300 && s5.score === 0]);
    return c;
  });
}

function aiChecks(m: any): Check[] {
  return guarded(() => {
    const H = m.H, cap = m.AI_SPEED;
    const P = () => ({ x: 608, y: 100, w: 12, h: 70, axis: 'x', dir: -1 });
    const c: Check[] = [];
    const p1 = P(); m.aiMove(p1, ball({ x: 300, y: 350 }), 1 / 60, H);
    c.push(['moves no faster than its speed cap', Math.abs(p1.y - 100) <= cap / 60 + 1e-6]);
    const p2 = P(); const target = ball({ x: 300, y: 200 });
    for (let i = 0; i < 200; i++) m.aiMove(p2, target, 1 / 60, H);
    c.push(['converges on the ball', Math.abs(p2.y + p2.h / 2 - 200) < 1]);
    let jitter = 0;
    for (let i = 0; i < 20; i++) { const y0 = p2.y; m.aiMove(p2, target, 1 / 60, H); jitter = Math.max(jitter, Math.abs(p2.y - y0)); }
    c.push(['holds steady once on target', jitter < 0.5]);
    const p3 = P(); for (let i = 0; i < 300; i++) m.aiMove(p3, ball({ x: 300, y: -100 }), 1 / 60, H);
    const p4 = P(); for (let i = 0; i < 300; i++) m.aiMove(p4, ball({ x: 300, y: H + 100 }), 1 / 60, H);
    c.push(['stays inside the arena', p3.y >= 0 && p4.y + p4.h <= H]);
    return c;
  });
}

export function verifyFamily(game: Game, family: string, code: string): Check[] {
  let m: any;
  try { m = load(code); } catch (e) { return [[`does not load: ${String(e).split('\n')[0].slice(0, 70)}`, false]]; }
  switch (family) {
    case 'movement': return movementChecks(m);
    case 'wall': return wallChecks(game, m);
    case 'paddle': return paddleChecks(game, m);
    case 'round': return roundChecks(game, m);
    case 'brick': return brickChecks(m);
    case 'ai': return aiChecks(m);
  }
  throw new Error(`no verifier for ${family}`);
}

/** Ship gate: play the fully assembled game headlessly and check invariants. */
export function verifyGame(game: Game, code: string): Check[] {
  let m: any;
  try { m = load(code); } catch (e) { return [[`does not load: ${String(e).split('\n')[0].slice(0, 70)}`, false]]; }
  return guarded(() => {
    const s = m.createGame(42);
    let sane = true, bounded = true, monotone = true, lastScore = 0, bounces = 0, lastSign = 0;
    const dts = [1 / 60, 1 / 60, 1 / 30, 1 / 60, 0.09];
    const horizon = game === 'breakout' ? 240 : 400;
    let t = 0;
    for (let i = 0; t < horizon && !s.over; i++) {
      const dt = dts[i % dts.length]; t += dt;
      const b = s.ball;
      if (game === 'breakout') {
        m.step(s, dt, { paddleX: b.x + Math.sin(t * 1.3) * 30 });
      } else {
        m.step(s, dt, { paddleY: b.y + Math.sin(t * 1.7) * 32 });
        const sign = Math.sign(s.ball.vx);
        if (sign && lastSign && sign !== lastSign) bounces++;
        if (sign) lastSign = sign;
      }
      const nb = s.ball;
      if (!finite(nb.x, nb.y, nb.vx, nb.vy)) sane = false;
      if (game === 'breakout') {
        if (nb.x < -1 || nb.x > m.W + 1 || nb.y < -1) bounded = false;
        if (s.score < lastScore || s.lives < 0) monotone = false;
        lastScore = s.score;
      } else if (nb.y < -1 || nb.y > m.H + 1) bounded = false;
    }
    const c: Check[] = [
      ['every value stays finite', sane],
      ['ball stays inside the arena', bounded],
    ];
    if (game === 'breakout') {
      c.push(['score never drops and lives never go negative', monotone]);
      c.push(['bricks actually get broken', s.bricks.filter((k: any) => !k.alive).length >= 10]);
    } else {
      c.push(['rallies happen (ball changes horizontal direction)', bounces >= 3]);
      c.push(['a round is scored', s.scoreL + s.scoreR >= 1]);
    }
    return c;
  });
}
