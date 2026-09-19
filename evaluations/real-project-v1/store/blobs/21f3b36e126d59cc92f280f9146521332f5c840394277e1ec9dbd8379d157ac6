import { transaction } from '../domain/board.mjs';
import { requireRecord } from '../domain/records.mjs';

export function run(board, { id }) {
  return transaction(board, 'complete', draft => {
    const record = requireRecord(draft, id);
    if (record.state === 'archived') throw Error('cannot complete archived item');
    if (record.state === 'open') {
      record.state = 'done';
      record.revision += 1;
    }
    return record;
  });
}
