import { createGame, queue, step, togglePause } from './engine.mjs';
const canvas = document.querySelector('#game'), ctx = canvas.getContext('2d');
let state = createGame(), last = 0;
const colors = ['#ff526d','#68dbff','#ffac53','#da9dff'];
function restart() { state = createGame(); last = performance.now(); draw(); }
document.querySelector('#restart').onclick = restart;
document.querySelector('#pause').onclick = () => { togglePause(state); draw(); };
document.querySelectorAll('[data-dir]').forEach(b => b.onclick = () => queue(state, b.dataset.dir));
const keys = { ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right',ArrowUp:'up',w:'up',ArrowDown:'down',s:'down' };
window.addEventListener('keydown', e => {
  if (keys[e.key] || e.code === 'Space') e.preventDefault();
  if (keys[e.key]) queue(state, keys[e.key]);
  if (e.code === 'Space') togglePause(state);
  if (e.key.toLowerCase() === 'r') restart();
});
function draw() {
  const t = canvas.width/state.width;
  ctx.fillStyle='#060c18';ctx.fillRect(0,0,canvas.width,canvas.height);
  state.grid.forEach((row,y)=>row.forEach((tile,x)=>{
    if(tile==='#'){ctx.fillStyle='#102b55';ctx.strokeStyle='#2462a6';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(x*t+2,y*t+2,t-4,t-4,5);ctx.fill();ctx.stroke();}
    else if(tile==='.'||tile==='o'){ctx.fillStyle='#f8dcad';ctx.beginPath();ctx.arc((x+.5)*t,(y+.5)*t,tile==='o'?5:2,0,Math.PI*2);ctx.fill();}
  }));
  const angle={right:0,down:Math.PI/2,left:Math.PI,up:-Math.PI/2}[state.direction]??0;
  ctx.save();ctx.translate((state.player.x+.5)*t,(state.player.y+.5)*t);ctx.rotate(angle);
  ctx.fillStyle='#ffe35d';ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,t*.4,.23,Math.PI*2-.23);ctx.closePath();ctx.fill();ctx.restore();
  state.ghosts.forEach((g,i)=>{const x=(g.x+.5)*t,y=(g.y+.5)*t;ctx.fillStyle=state.power?'#436bff':colors[i%4];ctx.beginPath();ctx.arc(x,y,t*.36,Math.PI,0);ctx.lineTo(x+t*.36,y+t*.35);ctx.lineTo(x-t*.36,y+t*.35);ctx.closePath();ctx.fill();ctx.fillStyle='white';for(const dx of [-3.5,3.5]){ctx.beginPath();ctx.arc(x+dx,y-1,2.5,0,Math.PI*2);ctx.fill();}});
  document.querySelector('#score').textContent=state.score;document.querySelector('#lives').textContent=state.lives;document.querySelector('#dots').textContent=state.remaining;
  document.querySelector('#status').textContent=({won:'YOU WIN! All dots collected. Start a new game to play again.',lost:'GAME OVER. Start a new game to try again.',paused:'PAUSED — press Space to resume.'})[state.status]??(state.power?'POWER UP — ghosts are vulnerable!':'Collect every dot. Power pellets let you eat ghosts.');
  document.querySelector('#pause').setAttribute('aria-label', state.status==='paused'?'Resume game':'Pause game');
  if(state.status!=='playing'){ctx.fillStyle='#060c18bb';ctx.fillRect(0,canvas.height/2-30,canvas.width,60);ctx.fillStyle='#ffe35d';ctx.textAlign='center';ctx.font='bold 25px system-ui';ctx.fillText(state.status.toUpperCase(),canvas.width/2,canvas.height/2+9);}
}
function frame(now){if(now-last>=150){step(state);last=now;}draw();requestAnimationFrame(frame);}
requestAnimationFrame(frame);
