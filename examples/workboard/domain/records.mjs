export const STATES = ['open', 'done', 'archived'];
export function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function canonicalLabels(labels = []) {
  if (!Array.isArray(labels) || labels.some(s => typeof s !== 'string')) throw Error('labels must be strings');
  return [...new Set(labels.map(s => s.trim().toLowerCase()).filter(Boolean))].sort();
}
export function day(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('date must be YYYY-MM-DD');
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw Error('invalid date');
  return value;
}
export function validateRecord(r) {
  if (!plainObject(r) || !Number.isSafeInteger(r.id) || r.id < 1) throw Error('invalid id');
  if (typeof r.title !== 'string' || !r.title.trim() || r.title !== r.title.trim()) throw Error('invalid title');
  if (!STATES.includes(r.state)) throw Error('invalid state');
  if (![1,2,3].includes(r.priority)) throw Error('priority must be 1, 2 or 3');
  if (JSON.stringify(canonicalLabels(r.labels)) !== JSON.stringify(r.labels)) throw Error('labels must be canonical');
  day(r.due);
  if (!Number.isSafeInteger(r.revision) || r.revision < 1) throw Error('invalid revision');
  return r;
}
export function makeRecord(input, id) {
  if (!plainObject(input)) throw Error('input must be an object');
  return validateRecord({ id, title:typeof input.title==='string'?input.title.trim():input.title,
    state:'open',priority:input.priority??2,labels:canonicalLabels(input.labels),due:day(input.due),revision:1 });
}
export function requireRecord(board, id) {
  if (!Number.isSafeInteger(id) || id < 1) throw Error('invalid id');
  const record=board.items.find(r=>r.id===id);if(!record)throw Error('item not found');return record;
}
