import { transaction } from '../domain/board.mjs';
import { makeRecord } from '../domain/records.mjs';

export function run(board, input) {
  return transaction(board, 'add', draft => {
    const record = makeRecord(input, draft.nextId);
    draft.items.push(record);
    draft.nextId += 1;
    return record;
  });
}
