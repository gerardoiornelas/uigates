#!/usr/bin/env node
// Reads results.jsonl and answers the two questions the A/B was built for, against criteria fixed in
// PLAN.md before any run. The constants below are those criteria; they are not tuned to a result.
//
//   overhead   ceremony - control   what UI-GATES costs (positive = it costs more)
//   learning   ceremony - learned   what the lessons save (positive = learned is cheaper)
//   net        control  - learned   what the user actually gains (positive = saved)
//
// The metric is weighted tokens (see `uigates cost`): fresh input, cache writes, cache re-reads and
// output at their relative prices. Counting only fresh tokens would hide the cost of the extra turns
// UI-GATES adds, so the control would be judged unfairly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from './run.mjs';

export const CRITERIA = Object.freeze({
  minPairs: 8,            // fewer complete, accepted pairs than this: no verdict either way
  winRate: 0.7,           // learned must be cheaper than ceremony in at least this share of pairs
  confidence: 0.95,       // paired bootstrap, percentile interval
  resamples: 10000,
  acceptanceGap: 1,       // arms may differ by at most this many accepted tasks before cost is not comparable
});

const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

/** Paired bootstrap of the mean difference. Seeded, so the same data gives the same interval. */
export function bootstrap(diffs, { seed = 20260921, resamples = CRITERIA.resamples, confidence = CRITERIA.confidence } = {}) {
  if (!diffs.length) return { lo: NaN, hi: NaN };
  const random = rng(seed);
  const means = [];
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < diffs.length; i++) s += diffs[Math.floor(random() * diffs.length)];
    means.push(s / diffs.length);
  }
  means.sort((a, b) => a - b);
  const tail = (1 - confidence) / 2;
  return { lo: means[Math.floor(tail * (resamples - 1))], hi: means[Math.ceil((1 - tail) * (resamples - 1))] };
}

function judge(name, diffs, n, confounded, winRate) {
  const ci = bootstrap(diffs);
  const m = mean(diffs);
  let verdict;
  // Unequal acceptance is a validity problem and is said first: it makes the costs incomparable however many pairs there are.
  if (confounded) verdict = 'no verdict: the arms differ in how many tasks they got right, so their costs are not comparable';
  else if (n < CRITERIA.minPairs) verdict = `no verdict: ${n} complete pairs, at least ${CRITERIA.minPairs} needed`;
  else if (ci.lo > 0 && winRate >= CRITERIA.winRate) verdict = 'SUPPORTED';
  else if (ci.hi < 0) verdict = 'CONTRADICTED: the second arm cost more';
  else verdict = 'NOT SUPPORTED (inconclusive)';
  return { name, mean: m, ci, winRate, verdict };
}

/**
 * `protocol`: 'itt' keeps every accepted run as randomized, whether or not the agent used UI-GATES;
 * 'per-protocol' keeps only ceremony and learned runs in which it did. The verdict is on 'itt'.
 */
export function analyze(records, { protocol = 'itt' } = {}) {
  const ev = records.filter(r => r.phase === 'evaluation');
  const learning = records.filter(r => r.phase === 'learning');
  const usable = r => r.cost && Number.isFinite(r.cost.weighted) && (protocol === 'itt' || r.arm === 'control' || r.compliance.uigatesCommands > 0);
  const acceptedBy = arm => ev.filter(r => r.arm === arm && r.accepted).length;
  const ranBy = arm => ev.filter(r => r.arm === arm).length;

  const tasks = [...new Set(ev.map(r => r.task))];
  const pairs = [];
  for (const t of tasks) {
    const get = arm => ev.find(r => r.task === t && r.arm === arm);
    const [c, e, l] = ['control', 'ceremony', 'learned'].map(get);
    if (c && e && l && [c, e, l].every(r => r.accepted && usable(r))) pairs.push({ task: t, control: c.cost, ceremony: e.cost, learned: l.cost });
  }

  const accepts = ['control', 'ceremony', 'learned'].map(acceptedBy);
  const confounded = Math.max(...accepts) - Math.min(...accepts) > CRITERIA.acceptanceGap;
  const w = key => pairs.map(p => p[key].weighted);
  const overheadSeries = pairs.map(p => p.ceremony.weighted - p.control.weighted);
  const learningSeries = pairs.map(p => p.ceremony.weighted - p.learned.weighted);
  const netSeries = pairs.map(p => p.control.weighted - p.learned.weighted);
  const share = (series) => (pairs.length ? series.filter(d => d > 0).length / pairs.length : 0);

  const learningOverhead = learning.reduce((a, r) => a + (r.cost?.weighted ?? 0), 0);
  const netTotal = netSeries.reduce((a, b) => a + b, 0);
  const meanNet = mean(netSeries);

  const overhead = { name: 'overhead (ceremony - control)', mean: mean(overheadSeries), ci: bootstrap(overheadSeries), pct: mean(w('control')) ? mean(overheadSeries) / mean(w('control')) : NaN };
  const learningJ = judge('learning (ceremony - learned)', learningSeries, pairs.length, confounded, share(learningSeries));
  const netJ = judge('net (control - learned)', netSeries, pairs.length, confounded, share(netSeries));
  const afterOverhead = { total: netTotal - learningOverhead, learningOverhead, breakEvenTasks: meanNet > 0 ? learningOverhead / meanNet : null };

  return {
    protocol, pairs: pairs.length, tasks: tasks.length,
    acceptance: Object.fromEntries(['control', 'ceremony', 'learned'].map((a, i) => [a, `${accepts[i]}/${ranBy(a)}`])),
    noncompliant: ev.filter(r => r.arm !== 'control' && r.compliance.uigatesCommands === 0).map(r => r.key),
    means: { control: mean(w('control')), ceremony: mean(w('ceremony')), learned: mean(w('learned')) },
    turns: { control: mean(pairs.map(p => p.control.modelCalls)), ceremony: mean(pairs.map(p => p.ceremony.modelCalls)), learned: mean(pairs.map(p => p.learned.modelCalls)) },
    overhead, learning: { ...learningJ, pct: mean(w('ceremony')) ? learningJ.mean / mean(w('ceremony')) : NaN },
    net: { ...netJ, pct: mean(w('control')) ? netJ.mean / mean(w('control')) : NaN, afterOverhead,
      afterOverheadVerdict: netJ.verdict.startsWith('no verdict') ? netJ.verdict : afterOverhead.total > 0 && netJ.verdict === 'SUPPORTED' ? 'SUPPORTED' : 'NOT SUPPORTED after the cost of learning' },
  };
}

const n = x => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : 'n/a');
const pct = x => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'n/a');

export function format(a) {
  const ci = c => `[${n(c.lo)}, ${n(c.hi)}]`;
  const lines = [
    `Token A/B, ${a.protocol} analysis: ${a.pairs} complete accepted pairs of ${a.tasks} tasks. Metric: weighted tokens per task.`,
    `Accepted by the independent verifier: control ${a.acceptance.control}, ceremony ${a.acceptance.ceremony}, learned ${a.acceptance.learned}`,
    a.noncompliant.length ? `Runs in which the agent never used UI-GATES (excluded from per-protocol): ${a.noncompliant.join(', ')}` : 'Every ceremony and learned run used UI-GATES.',
    '',
    `Mean per task   control ${n(a.means.control)}   ceremony ${n(a.means.ceremony)}   learned ${n(a.means.learned)}   (model calls ${a.turns.control.toFixed(1)} / ${a.turns.ceremony.toFixed(1)} / ${a.turns.learned.toFixed(1)})`,
    '',
    `1. What UI-GATES costs      ${n(a.overhead.mean)} (${pct(a.overhead.pct)} of control)   95% CI ${ci(a.overhead.ci)}`,
    `2. What learning saves      ${n(a.learning.mean)} (${pct(a.learning.pct)} of ceremony)   95% CI ${ci(a.learning.ci)}   learned cheaper in ${pct(a.learning.winRate)} of pairs`,
    `   verdict: ${a.learning.verdict}`,
    `3. Net for the user         ${n(a.net.mean)} (${pct(a.net.pct)} of control)   95% CI ${ci(a.net.ci)}   learned cheaper than control in ${pct(a.net.winRate)} of pairs`,
    `   verdict: ${a.net.verdict}`,
    `   after paying for the learning phase (${n(a.net.afterOverhead.learningOverhead)}): ${n(a.net.afterOverhead.total)} over ${a.pairs} tasks${a.net.afterOverhead.breakEvenTasks ? `; break-even at about ${Math.ceil(a.net.afterOverhead.breakEvenTasks)} tasks` : ''}`,
    `   verdict after learning cost: ${a.net.afterOverheadVerdict}`,
  ];
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, ...flags] = process.argv.slice(2);
  if (!file || !fs.existsSync(file)) { console.error('usage: node analyze.mjs <results.jsonl> [--json]'); process.exit(2); }
  const records = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const results = ['itt', 'per-protocol'].map(protocol => analyze(records, { protocol }));
  console.log(flags.includes('--json') ? JSON.stringify(results, null, 2) : results.map(format).join('\n\n---\n\n'));
}
