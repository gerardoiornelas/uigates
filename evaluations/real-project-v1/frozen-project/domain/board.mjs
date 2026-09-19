import { plainObject, validateRecord } from './records.mjs';
export function createBoard() { return { version:1, nextId:1, items:[], events:[] }; }
export function validateBoard(board) {
  if(!plainObject(board)||board.version!==1||!Array.isArray(board.items)||!Array.isArray(board.events))throw Error('invalid board');
  const ids=new Set();for(const r of board.items){validateRecord(r);if(ids.has(r.id))throw Error('duplicate id');ids.add(r.id);}
  if(!Number.isSafeInteger(board.nextId)||board.nextId<1||board.items.some(r=>r.id>=board.nextId))throw Error('invalid next id');
  return board;
}
/** Commit only validated changes; failed operations cannot leave partially changed state. */
export function transaction(board, operation, fn) {
  validateBoard(board);const draft=structuredClone(board),before=JSON.stringify(draft.items);
  const value=fn(draft);validateBoard(draft);
  if(JSON.stringify(draft.items)!==before)draft.events.push({sequence:draft.events.length+1,operation});
  Object.assign(board,draft);return structuredClone(value);
}
export function view(board) { validateBoard(board);return structuredClone(board.items); }
