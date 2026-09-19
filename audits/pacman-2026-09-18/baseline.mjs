import vm from 'node:vm';
import fs from 'node:fs';
const source = fs.readFileSync('examples/pacman/game.js','utf8');
function run(body){const context=vm.createContext({document:{getElementById:()=>({getContext:()=>new Proxy({}, {get:()=>()=>{}})})},window:{addEventListener:()=>{}},requestAnimationFrame:()=>{}});vm.runInContext(source,context);return vm.runInContext(body,context);}
const results=[
  {name:'left tunnel wraps',expected:18,actual:run("pacman.x=0;pacman.y=9;pacman.dir=pacman.nextDir={x:-1,y:0};updatePacman();pacman.x")},
  {name:'crossing collision detected',expected:'lost',actual:run("pacman.x=2;pacman.y=1;ghost.x=3;ghost.y=1;pacman.dir=pacman.nextDir={x:1,y:0};ghost.dir={x:-1,y:0};Math.random=()=>0.9;updatePacman();updateGhost();checkGameState();gameStatus")},
  {name:'lethal collision on last dot remains loss',expected:'lost',actual:run("map.forEach(r=>r.forEach((v,x)=>{if(v===0)r[x]=2}));pacman.x=ghost.x=9;pacman.y=ghost.y=9;checkGameState();gameStatus")},
  {name:'normal dot adds 10 points',expected:10,actual:run("pacman.dir=pacman.nextDir={x:1,y:0};updatePacman();score")},
  {name:'wall blocks movement',expected:1,actual:run("pacman.dir=pacman.nextDir={x:0,y:-1};updatePacman();pacman.y")},
  {name:'all dots reachable',expected:0,actual:run("(()=>{const seen=new Set(),q=[[1,1]];for(let i=0;i<q.length;i++){const [x,y]=q[i],k=x+','+y;if(seen.has(k))continue;seen.add(k);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])if(map[y+dy]?.[x+dx]!==undefined&&map[y+dy][x+dx]!==1&&!seen.has((x+dx)+','+(y+dy)))q.push([x+dx,y+dy]);}return map.reduce((n,r,y)=>n+r.filter((v,x)=>v===0&&!seen.has(x+','+y)).length,0)})()")}
].map(r=>({...r,pass:r.actual===r.expected}));
fs.writeFileSync('audits/pacman-2026-09-18/baseline.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
