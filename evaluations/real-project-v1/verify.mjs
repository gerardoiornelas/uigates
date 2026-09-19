// External verifier: never copied into worker workspaces and frozen by SHA-256.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [task,root]=process.argv.slice(2),load=f=>import(pathToFileURL(path.join(root,f)));
const {run}=await load(`features/${task}.mjs`),{createBoard,validateBoard}=await load('domain/board.mjs'),{makeRecord}=await load('domain/records.mjs');
let n=0;
const check=(name,fn)=>{fn();n++;console.log(`PASS ${name}`);};
function board(){const b=createBoard();b.items=[
 {title:'Fix parser',state:'open',labels:['core','urgent'],due:'2026-09-17'},
 {title:'Write docs',state:'done',labels:['docs'],due:'2026-09-18'},
 {title:'Ship CLI',state:'open',labels:['core'],due:'2026-09-19'},
 {title:'Old task',state:'archived',labels:['core'],due:'2026-09-16'},
 {title:'Fix tests',state:'open',labels:[],due:null},
].map((r,i)=>({...makeRecord(r,i+1),state:r.state}));b.nextId=6;return b;}
const ids=rows=>rows.map(r=>r.id),same=(a,b)=>assert.deepEqual(a,b);
function rejects(input){const b=board(),before=structuredClone(b);assert.throws(()=>run(b,input));same(b,before);}
function detached(input){const b=board(),out=run(b,input),before=structuredClone(b);if(Array.isArray(out)&&out[0])out[0].title='not stored';else if(out&&typeof out==='object')out.title='not stored';same(b,before);}
if(task==='add'){
 check('new record and next id',()=>{const b=board(),r=run(b,{title:' New ',labels:['X','x'],due:'2026-09-20'});assert.equal(r.id,6);assert.equal(r.title,'New');same(r.labels,['x']);assert.equal(b.nextId,7);assert.equal(b.events.length,1);validateBoard(b);r.title='alias';assert.equal(b.items.at(-1).title,'New');});
 for(const input of [{title:''},{title:2},{title:'x',priority:0},{title:'x',due:'2026-02-30'},{title:'x',labels:[4]}])check('invalid add rollback',()=>rejects(input));
}else if(task==='complete'||task==='reopen'||task==='archive'){
 const from=task==='complete'?1:2,state=task==='complete'?'done':task==='reopen'?'open':'archived';
 check('transition, revision and audit',()=>{const b=board(),r=run(b,{id:from});assert.equal(r.state,state);assert.equal(r.revision,2);assert.equal(b.events.length,1);validateBoard(b);r.title='alias';assert.notEqual(b.items[from-1].title,'alias');});
 check('idempotent',()=>{const b=board();run(b,{id:from});const before=structuredClone(b);run(b,{id:from});same(b,before);});
 for(const id of [99,'1',-1,task==='archive'?1:4])check('invalid transition rollback',()=>rejects({id}));
}else if(['rename','priority','label','schedule'].includes(task)){
 const good={rename:{id:1,title:' Changed '},priority:{id:1,priority:3},label:{id:1,add:[' Z ','CORE'],remove:['URGENT','z']},schedule:{id:1,due:'2026-10-01'}}[task];
 check('update follows invariants',()=>{const b=board(),r=run(b,good);assert.equal(r.revision,2);assert.equal(b.events.length,1);validateBoard(b);if(task==='rename')assert.equal(r.title,'Changed');if(task==='priority')assert.equal(r.priority,3);if(task==='label')same(r.labels,['core']);if(task==='schedule')assert.equal(r.due,'2026-10-01');r.title='alias';assert.notEqual(b.items[0].title,'alias');});
 check('same value is no-op',()=>{const b=board();run(b,good);const before=structuredClone(b);run(b,good);same(b,before);});
 for(const id of [99,'1',4])check('invalid target rollback',()=>rejects({...good,id}));
 const bad={rename:[{title:''},{title:7}],priority:[{priority:0},{priority:'1'}],label:[{add:[4]},{remove:'x'}],schedule:[{due:'2026-02-30'},{due:''},{}, {due:undefined}]}[task];
 for(const input of bad)check('invalid value rollback',()=>rejects({id:1,...input}));
 if(task==='schedule')check('clear date',()=>assert.equal(run(board(),{id:1,due:null}).due,null));
}else if(task==='remove'){
 check('removes archived without reusing id',()=>{const b=board(),r=run(b,{id:4});assert.equal(r.id,4);assert.equal(b.nextId,6);same(ids(b.items),[1,2,3,5]);assert.equal(b.events.length,1);validateBoard(b);});
 for(const id of [1,2,99,'4'])check('bad remove rolls back',()=>rejects({id}));
}else if(task==='batch-complete'){
 check('deduplicates preserves order and logs once',()=>{const b=board(),r=run(b,{ids:[3,1,3,2]});same(ids(r),[3,1,2]);same(r.map(x=>x.state),['done','done','done']);same(r.map(x=>x.revision),[2,2,1]);assert.equal(b.events.length,1);validateBoard(b);r[0].title='alias';assert.equal(b.items[2].title,'Ship CLI');});
 check('empty batch noop',()=>{const b=board(),before=structuredClone(b);same(run(b,{ids:[]}),[]);same(b,before);});
 for(const input of [{ids:[1,4]},{ids:[1,99]},{ids:[1,'2']},{ids:'1'},{}])check('whole batch rollback',()=>rejects(input));
}else{
 check('query does not mutate',()=>{const b=board(),before=structuredClone(b);run(b,{today:'2026-09-18',days:2,query:'fix'});same(b,before);});
 if(task==='list'){
  check('default excludes archive',()=>same(ids(run(board(),{})),[1,2,3,5]));check('state filter',()=>same(ids(run(board(),{state:'open'})),[1,3,5]));check('normalized label',()=>same(ids(run(board(),{label:' CORE '})),[1,3]));check('all includes archive',()=>same(ids(run(board(),{state:'all'})),[1,2,3,4,5]));check('bad filters',()=>{rejects({state:'bad'});rejects({label:3});});check('detached results',()=>detached({}));
 }else if(task==='search'){
  check('case insensitive',()=>same(ids(run(board(),{query:' FIX '})),[1,5]));check('empty result',()=>same(run(board(),{query:'not here'}),[]));check('invalid query',()=>{rejects({query:''});rejects({query:3});});check('detached',()=>detached({query:'fix'}));
 }else if(task==='overdue'||task==='due-soon'){
  const input={today:'2026-09-18',days:2};check('date range and states',()=>same(ids(run(board(),input)),task==='overdue'?[1]:[3]));check('strict date',()=>{rejects({today:'2026-02-30',days:2});rejects({today:'',days:2});});check('detached',()=>detached(input));
  if(task==='due-soon'){check('invalid days',()=>{rejects({today:'2026-09-18',days:-1});rejects({today:'2026-09-18',days:1.5});});check('inclusive same day',()=>same(ids(run(board(),{today:'2026-09-17',days:0})),[1]));check('year rollover',()=>{const b=board();b.items[0].due='2027-01-01';same(ids(run(b,{today:'2026-12-31',days:1})),[1]);});}
 }else if(task==='summary'){
  check('counts',()=>same(run(board(),{today:'2026-09-18'}),{total:5,open:3,done:1,archived:1,overdue:1}));check('empty',()=>same(run(createBoard(),{today:'2026-09-18'}),{total:0,open:0,done:0,archived:0,overdue:0}));check('strict date',()=>{rejects({today:''});rejects({today:'2026-02-30'});});
 }else if(task==='by-label'){
  check('label rollup',()=>same(run(board(),{}),[{label:'core',open:2,done:0,total:2},{label:'docs',open:0,done:1,total:1},{label:'urgent',open:1,done:0,total:1}]));check('empty',()=>same(run(createBoard(),{}),[]));
 }else if(task==='csv'){
  check('exact serialization',()=>{const b=createBoard();b.items=[makeRecord({title:'one,"two"\nthree',labels:['a','b']},1)];b.nextId=2;assert.equal(run(b,{}),'id,title,state,priority,labels,due,revision\r\n1,"one,""two""\nthree",open,2,a|b,,1\r\n');});check('includes archive',()=>assert(run(board(),{}).includes('4,Old task,archived')));check('empty header',()=>assert.equal(run(createBoard(),{}),'id,title,state,priority,labels,due,revision\r\n'));
 }else if(task==='markdown'){
  check('exact output and escaping',()=>{const b=createBoard();b.items=[makeRecord({title:'a_[b]*`\\\nc'},1)];b.nextId=2;assert.equal(run(b,{}),'- [ ] a\\_\\[b\\]\\*\\`\\\\ c (#1)\n');});check('done checked archive absent',()=>{const s=run(board(),{});assert(s.includes('- [x] Write docs (#2)'));assert(!s.includes('Old task'));});check('empty',()=>assert.equal(run(createBoard(),{}),''));
 }else throw Error('Unknown task');
}
console.log(`${n} independent behavioral checks passed for ${task}`);
