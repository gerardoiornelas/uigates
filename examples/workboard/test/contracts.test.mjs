import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoard,transaction,view} from '../domain/board.mjs';
import {makeRecord,day} from '../domain/records.mjs';
test('records normalize labels and dates are strict',()=>{assert.deepEqual(makeRecord({title:' One ',labels:['X',' x ','a']},1).labels,['a','x']);assert.throws(()=>day('2026-02-30'));});
test('transactions roll back failures and log changes',()=>{const b=createBoard();assert.throws(()=>transaction(b,'bad',d=>{d.items.push({});}));assert.equal(b.items.length,0);transaction(b,'add',d=>{d.items.push(makeRecord({title:'One'},d.nextId++));});assert.equal(b.events.length,1);const rows=view(b);rows[0].title='Changed';assert.equal(b.items[0].title,'One');});
