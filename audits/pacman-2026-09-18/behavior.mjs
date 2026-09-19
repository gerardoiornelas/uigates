import assert from 'node:assert/strict';
import { createGame, destination, queue, step, togglePause } from '../../examples/pacman-audit/engine.mjs';

export function verifyFamily(family, policy = {}, variant = 0) {
  const out = [];
  const check = (name, fn) => { try { fn(); out.push({ name, pass: true }); } catch (e) { out.push({ name, pass: false, error: e.message }); } };
  const w = 7 + variant * 2;
  function corridor() { return createGame({ map: ['#'.repeat(w), 'P'+'.'.repeat(w-1), '#'.repeat(w)], ghostCount: 0 }); }
  if (family === 'tunnel') {
    check('left tunnel wraps to opposite edge', () => { const s=corridor();queue(s,'left');step(s,policy);assert.equal(s.player.x,w-1); });
    check('right tunnel wraps to opposite edge', () => { const s=corridor();s.player.x=w-1;queue(s,'right');step(s,policy);assert.equal(s.player.x,0); });
    check('closed endpoint cannot wrap', () => { const s=corridor();s.grid[1][w-1]='#';queue(s,'left');step(s,policy);assert.equal(s.player.x,0); });
  }
  if (family === 'collision') {
    check('crossing player and ghost costs a life', () => { const s=corridor();s.player.x=2;s.ghosts=[{x:3,y:1,spawn:{x:w-1,y:1}}];queue(s,'right');step(s,{...policy,ghostMoves:['left']});assert.equal(s.lives,2); });
    check('same destination costs a life', () => { const s=corridor();s.player.x=2;s.ghosts=[{x:4,y:1,spawn:{x:w-1,y:1}}];queue(s,'right');step(s,{...policy,ghostMoves:['left']});assert.equal(s.lives,2); });
    check('power pellet protects at contact', () => { const s=corridor();s.grid[1][3]='o';s.player.x=2;s.ghosts=[{x:3,y:1,spawn:{x:w-1,y:1}}];queue(s,'right');step(s,{...policy,ghostMoves:[null]});assert.equal(s.lives,3);assert.equal(s.score,250); });
  }
  if (family === 'terminal') {
    check('last dot plus lethal contact is a loss', () => { const s=corridor();s.grid[1].fill(' ');s.grid[1][3]='.';s.remaining=1;s.player.x=2;s.lives=1;s.ghosts=[{x:3,y:1,spawn:{x:w-1,y:1}}];queue(s,'right');step(s,{...policy,ghostMoves:[null]});assert.equal(s.status,'lost'); });
    check('last safe dot wins', () => { const s=corridor();s.grid[1].fill(' ');s.grid[1][3]='.';s.remaining=1;s.player.x=2;queue(s,'right');step(s,policy);assert.equal(s.status,'won'); });
    check('finished game cannot keep scoring', () => { const s=corridor();s.status='won';const before=JSON.stringify(s);queue(s,'right');const queued=JSON.stringify(s);step(s,policy);assert.equal(JSON.stringify(s),queued);assert.equal(s.score,0); });
  }
  return out;
}
export function verifyGame() {
  const results = ['tunnel','collision','terminal'].flatMap(f => verifyFamily(f));
  const check=(name,fn)=>{try{fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}};
  check('every pellet is reachable from spawn',()=>{
    const s=createGame(), seen=new Set(), todo=[s.player];
    for(let i=0;i<todo.length;i++){const p=todo[i],key=`${p.x},${p.y}`;if(seen.has(key))continue;seen.add(key);for(const d of ['left','right','up','down']){const n=destination(s,p,d);if(n&&!seen.has(`${n.x},${n.y}`))todo.push(n);}}
    s.grid.forEach((row,y)=>row.forEach((v,x)=>{if(v==='.'||v==='o')assert(seen.has(`${x},${y}`),`unreachable dot ${x},${y}`);}));
  });
  check('wall blocks movement',()=>{const s=createGame();s.player={x:1,y:1};queue(s,'up');step(s,{ghostMoves:[]});assert.deepEqual(s.player,{x:1,y:1});});
  check('pellet scored once',()=>{const s=createGame({map:['#####','#P..#','#####'],ghostCount:0});queue(s,'right');step(s);assert.equal(s.score,10);queue(s,'left');step(s);queue(s,'right');step(s);assert.equal(s.score,10);});
  check('queued turn waits for intersection',()=>{const s=createGame({map:['#####','#P..#','###.#','#####'],ghostCount:0});queue(s,'right');step(s);queue(s,'down');step(s);assert.deepEqual(s.player,{x:3,y:1});step(s);assert.deepEqual(s.player,{x:3,y:2});});
  check('pause freezes simulation',()=>{const s=createGame();togglePause(s);const before=JSON.stringify(s);step(s);assert.equal(JSON.stringify(s),before);togglePause(s);assert.equal(s.status,'playing');});
  check('restart factory resets score, lives, dots',()=>{const s=createGame();s.score=500;s.lives=1;const fresh=createGame();assert.equal(fresh.score,0);assert.equal(fresh.lives,3);assert.equal(fresh.remaining,fresh.grid.flat().filter(c=>c==='.'||c==='o').length);});
  check('power expires after bounded ticks',()=>{const s=createGame({map:['#####','#Po.#','#####'],ghostCount:0});queue(s,'right');step(s);assert(s.power>0);s.direction=s.queued=null;for(let i=0;i<35;i++)step(s);assert.equal(s.power,0);});
  check('seeded ghost movement is reproducible',()=>{const a=createGame({seed:123}),b=createGame({seed:123});for(let i=0;i<100;i++){step(a);step(b);}assert.deepEqual(a,b);});
  check('10000 seeded ticks preserve traversable positions and dot count',()=>{for(let seed=1;seed<=20;seed++){const s=createGame({seed});let r=seed;for(let i=0;i<500;i++){r=(Math.imul(r,1664525)+1013904223)>>>0;queue(s,['up','down','left','right'][r%4]);step(s);for(const p of [s.player,...s.ghosts])assert.notEqual(s.grid[p.y]?.[p.x],'#');assert.equal(s.remaining,s.grid.flat().filter(c=>c==='.'||c==='o').length);assert(s.lives>=0);}}});
  check('full default maze can be cleared by legal movement',()=>{
    const s=createGame({ghostCount:0});let steps=0;
    while(s.status==='playing' && steps<10000){
      const todo=[{p:s.player,path:[]}],seen=new Set();let route;
      for(let i=0;i<todo.length;i++){const {p,path}=todo[i],key=`${p.x},${p.y}`;if(seen.has(key))continue;seen.add(key);if(['.','o'].includes(s.grid[p.y][p.x])&&path.length){route=path;break;}for(const d of Object.keys({left:0,right:0,up:0,down:0})){const n=destination(s,p,d);if(n&&!seen.has(`${n.x},${n.y}`))todo.push({p:n,path:[...path,d]});}}
      assert(route,'reachable next pellet');for(const d of route){queue(s,d);step(s);steps++;}
    }assert.equal(s.status,'won');assert.equal(s.remaining,0);
  });
  return results;
}
