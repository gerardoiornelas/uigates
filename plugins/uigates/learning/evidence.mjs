import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ensure = (ok, message) => { if (!ok) throw Error(message); };
export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const digest = value => sha(JSON.stringify(canonical(value)));
export const validId = id => { ensure(typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{0,119}$/.test(id), 'Invalid record ID'); return id; };
export const text = value => typeof value === 'string' && value.trim().length >= 3;
export const protocolHashes = () => Object.fromEntries(['evidence.mjs','memory.mjs','runner.mjs','certify.mjs'].map(file => [file,sha(fs.readFileSync(new URL(file,import.meta.url)))]));

/** Immutable, content-addressed local audit records. Not an authenticated remote authority. */
export class EvidenceStore {
  constructor(directory) { this.directory = path.resolve(directory); fs.mkdirSync(this.directory, { recursive: true }); }
  put(kind, id, body) {
    const dir = path.join(this.directory, validId(kind)); fs.mkdirSync(dir, { recursive: true });
    const record = { body, sha256: digest(body) }, file = path.join(dir, validId(id) + '.json');
    fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    return record;
  }
  get(kind, id) {
    const r = JSON.parse(fs.readFileSync(path.join(this.directory, validId(kind), validId(id) + '.json'), 'utf8'));
    ensure(r.sha256 === digest(r.body), `Record integrity failure: ${kind}/${id}`);
    return r;
  }
  has(kind, id) { return fs.existsSync(path.join(this.directory, validId(kind), validId(id) + '.json')); }
  all(kind) { const dir = path.join(this.directory, validId(kind)); return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => this.get(kind, f.slice(0, -5))) : []; }
  blob(bytes) {
    const hash = sha(bytes), dir = path.join(this.directory, 'blobs'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, hash);
    try { fs.writeFileSync(file, bytes, { flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; ensure(sha(fs.readFileSync(file)) === hash, 'Blob tampered'); }
    return hash;
  }
  readBlob(hash) {
    ensure(/^[a-f0-9]{64}$/.test(hash), 'Invalid blob hash');
    const bytes = fs.readFileSync(path.join(this.directory, 'blobs', hash)); ensure(sha(bytes) === hash, 'Blob integrity failure'); return bytes;
  }
}

/** All completed turns, including retries. Cache is a subset of input, not additional tokens. */
export function telemetry(bytes) {
  const unavailable = reason => ({ complete: false, input: null, output: null, cached: null, total: null, reason });
  let events;
  try { events = bytes.toString().trim().split(/\r?\n/).filter(Boolean).map(s => JSON.parse(s)); } catch { return unavailable('Malformed JSONL'); }
  const starts = events.filter(e => e.type === 'turn.started'), ends = events.filter(e => e.type === 'turn.completed');
  if (!starts.length || starts.length !== ends.length || events.some(e => ['turn.failed', 'error'].includes(e.type)) || events.filter(e => e.type?.startsWith('turn.')).at(-1)?.type !== 'turn.completed') return unavailable('Missing, failed or unfinished turn');
  let active = false;
  for (const e of events) {
    if (e.type === 'turn.started') { if (active) return unavailable('Overlapping turns'); active = true; }
    if (e.type === 'turn.completed') { if (!active) return unavailable('Completion without start'); active = false; }
  }
  let input = 0, output = 0, cached = 0;
  for (const e of ends) {
    const u = e.usage;
    if (!u || ![u.input_tokens, u.output_tokens, u.cached_input_tokens].every(n => Number.isSafeInteger(n) && n >= 0) || u.cached_input_tokens > u.input_tokens) return unavailable('Invalid usage counters');
    input += u.input_tokens; output += u.output_tokens; cached += u.cached_input_tokens;
  }
  if (!Number.isSafeInteger(input + output)) return unavailable('Usage overflow');
  return { complete: true, input, output, cached, total: input + output, turns: ends.length };
}

export function authority(a, scope) {
  ensure(a && ['principal', 'source', 'scope'].every(k => text(a[k])), 'Explicit principal/source/scope required');
  ensure(Number.isFinite(Date.parse(a.expiresAt)) && Date.parse(a.expiresAt) > Date.now(), 'Approval expired or invalid');
  if (scope) ensure(a.scope === scope, 'Approval scope mismatch');
}

export function snapshot(root) {
  const result = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (['.git', 'node_modules', '.uigates-learning', '.uig-learning'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      ensure(!entry.isSymbolicLink(), `Symlinks are not permitted in a frozen project: ${file}`);
      if (entry.isDirectory()) visit(file); else if (entry.isFile()) result[path.relative(root, file).split(path.sep).join('/')] = sha(fs.readFileSync(file));
    }
  }
  visit(root); return result;
}

export function contained(root, relative) {
  ensure(typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative), 'Expected relative project path');
  const target = path.resolve(root, relative);
  ensure(target.startsWith(path.resolve(root) + path.sep), 'Path escapes workspace'); return target;
}
