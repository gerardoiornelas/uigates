import * as fs from 'fs';
import * as path from 'path';
import { KnowledgePack, loadKnowledge, locationOf } from './synthesizer';

/**
 * The brief: what an agent is told when it starts work, so it begins where earlier verified work
 * happened instead of searching for the place.
 *
 * Three properties matter, and each answers a way lesson stores fail:
 *  - It is selected by location. A lesson is only relevant to a task if the files overlap, so the
 *    agent is not handed the whole ledger (which grows with every task) or a keyword guess.
 *  - It is capped by a token budget. Its size does not depend on how many lessons exist, so the
 *    ledger can grow without the brief becoming the new thing that burns tokens.
 *  - It is honest about what it is. The receipt proves the action worked; the advice is the agent's
 *    own claim, and a lesson whose files have since moved is marked so instead of trusted.
 *
 * "Nothing yet for these files" is one short line, so an agent does not go looking in the ledger.
 */

export const DEFAULT_BRIEF_BUDGET = 400;
const tokens = (text: string) => Math.ceil(text.length / 3.5);
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** How closely two project-relative locations relate: 3 the same, 2 one contains the other, 1 the same directory, 0 unrelated. */
export function overlap(a: string, b: string): 0 | 1 | 2 | 3 {
  if (a === b) return 3;
  if (a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) return 2;
  return path.posix.dirname(a) === path.posix.dirname(b) ? 1 : 0;
}

export interface BriefEntry {
  file: string;
  action: string;
  level: KnowledgePack['level'];
  status: KnowledgePack['status'];
  paths: string[];
  lessons: string[];
  relevance: number;
  stale: boolean;
  line: string;
}

export interface Brief {
  text: string;
  tokens: number;
  budget: number;
  query: string[];
  /** Lessons on record, lessons whose files overlap the query, and how many made it into the text. */
  total: number;
  relevant: number;
  included: number;
  entries: BriefEntry[];
}

const LEVEL_WEIGHT = { canon: 30, knowledge: 20, task: 10 } as const;

function lineFor(p: KnowledgePack, stale: boolean): string {
  const tag = p.status === 'conflicted' ? 'DO NOT APPLY, a later attempt failed' : p.level === 'task' ? 'worked once' : p.level;
  const files = p.paths.slice(-3).join(', ');
  const advice = p.lessons.length ? ` | advice (the agent's claim): ${clip(p.lessons[p.lessons.length - 1], 220)}` : '';
  return `- [${tag}${stale ? '; its files have since changed, re-verify' : ''}] ${clip(p.action, 110)} | files: ${files}${advice}`;
}

export function buildBrief(root: string, query: string[], budget = DEFAULT_BRIEF_BUDGET): Brief {
  const wanted = [...new Set(query.map(q => locationOf(q)).filter((q): q is string => !!q))];
  const packs = loadKnowledge(root).filter(p => p.status !== 'retired');
  const scored: BriefEntry[] = [];
  for (const p of packs) {
    const relevance = Math.max(0, ...wanted.flatMap(q => p.paths.map(pp => overlap(q, pp))));
    // A lesson that failed is worth a warning, but only where it is close: two or more.
    if (relevance === 0 || (p.status === 'conflicted' && relevance < 2)) continue;
    const stale = p.paths.some(pp => !fs.existsSync(path.join(root, pp)));
    scored.push({ file: p.file, action: p.action, level: p.level, status: p.status, paths: p.paths, lessons: p.lessons, relevance, stale, line: lineFor(p, stale) });
  }
  const rank = (e: BriefEntry) =>
    e.relevance * 100 + LEVEL_WEIGHT[e.level] + (e.lessons.length ? 8 : 0) + (e.status === 'conflicted' ? 60 : 0) - (e.stale ? 50 : 0);
  scored.sort((a, b) => rank(b) - rank(a) || a.action.localeCompare(b.action));

  const where = wanted.length ? wanted.join(', ') : '(no files named)';
  if (!scored.length) {
    const text = `No verified lessons yet for ${where}${packs.length ? ` (${packs.length} elsewhere)` : ''}. Start from the task; do not search the ledger.`;
    return { text, tokens: tokens(text), budget, query: wanted, total: packs.length, relevant: 0, included: 0, entries: [] };
  }

  const header = `Earlier verified work near ${where}. A receipt proves the action worked, not that its advice is right:`;
  // Measure the text that will actually be sent, footer included, so the budget is a guarantee and not an estimate.
  const assemble = (entries: BriefEntry[]) => {
    const omitted = scored.length - entries.length;
    return [header, ...entries.map(e => e.line), omitted > 0 ? `(${omitted} more relevant; \`uigates knowledge\` lists all.)` : ''].filter(Boolean).join('\n');
  };
  const chosen: BriefEntry[] = [];
  for (const e of scored) {
    if (tokens(assemble([...chosen, e])) <= budget) { chosen.push(e); continue; }
    if (!chosen.length) {
      // Even one lesson does not fit whole: give the best one, shortened, rather than nothing.
      let line = e.line;
      while (line.length > 40 && tokens(assemble([{ ...e, line }])) > budget) line = clip(line, line.length - 8);
      chosen.push({ ...e, line });
    }
    break;
  }
  const text = assemble(chosen);
  return { text, tokens: tokens(text), budget, query: wanted, total: packs.length, relevant: scored.length, included: chosen.length, entries: chosen };
}
