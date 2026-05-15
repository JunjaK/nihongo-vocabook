#!/usr/bin/env bun
/**
 * Aggregate `poc-run-{1,2,3}.json` files into a single go/no-go report.
 * Usage: bun run scripts/poc-score.ts <dir>
 * Default dir: same dir as the script.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface ScenarioResult {
  scenarioId: string;
  ask: string;
  rawOutput: string;
  durationMs: number;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  passed: boolean;
  failureReason?: string;
}
interface SubBucket {
  passed: number;
  total: number;
}
interface Summary {
  total: number;
  passed: number;
  failed: number;
  truePositive?: SubBucket;
  falsePositive?: SubBucket;
  multiTool?: SubBucket;
  clarification?: SubBucket;
}
interface RunFile {
  runIndex: number;
  summary: Summary;
  results: ScenarioResult[];
  completedAt: string;
}

const dir = process.argv[2] ?? resolve(__dirname);
const runs: RunFile[] = [];
for (let i = 1; i <= 3; i++) {
  const p = resolve(dir, `poc-run-${i}.json`);
  if (!existsSync(p)) {
    console.error(`Missing: ${p}`);
    continue;
  }
  runs.push(JSON.parse(readFileSync(p, 'utf8')) as RunFile);
}

if (runs.length === 0) {
  console.error('No runs found.');
  process.exit(2);
}

const allScenarioIds = Array.from(
  new Set(runs.flatMap((r) => r.results.map((x) => x.scenarioId))),
).sort();

console.log(`# PoC Aggregate Report (${runs.length} run(s))`);
console.log('');
function avgMs(results: ScenarioResult[]): number {
  if (results.length === 0) return 0;
  return results.reduce((a, r) => a + r.durationMs, 0) / results.length;
}

console.log('## Per-run summary');
console.log('| Run | Total | Pass | Fail | Pass% | Avg ms |');
console.log('|-----|-------|------|------|-------|--------|');
for (const r of runs) {
  const rate = (r.summary.passed / r.summary.total) * 100;
  console.log(
    `| ${r.runIndex} | ${r.summary.total} | ${r.summary.passed} | ${r.summary.failed} | ${rate.toFixed(1)}% | ${avgMs(r.results).toFixed(0)} |`,
  );
}
const aggPass = runs.reduce((a, r) => a + r.summary.passed, 0);
const aggTotal = runs.reduce((a, r) => a + r.summary.total, 0);
console.log(`| **TOTAL** | ${aggTotal} | ${aggPass} | ${aggTotal - aggPass} | ${((aggPass / aggTotal) * 100).toFixed(1)}% | — |`);

console.log('');
console.log('## Per-scenario across runs');
console.log('| Scenario | Run1 | Run2 | Run3 | Consistency |');
console.log('|----------|------|------|------|-------------|');
for (const sid of allScenarioIds) {
  const cells = runs.map((r) => {
    const hit = r.results.find((x) => x.scenarioId === sid);
    return hit ? (hit.passed ? '✓' : '✗') : '—';
  });
  const passCount = cells.filter((c) => c === '✓').length;
  const consistency = passCount === runs.length ? 'stable' : passCount === 0 ? 'always-fail' : 'flaky';
  console.log(`| ${sid} | ${cells.join(' | ')} | ${consistency} |`);
}

console.log('');
const passRate = aggPass / aggTotal;
const verdict = passRate >= 0.9 ? '✅ GO' : '❌ NO-GO';
console.log(`## Verdict: **${verdict}** (${(passRate * 100).toFixed(1)}% across all runs; threshold 90%)`);
console.log('');
console.log('## Failure reasons');
for (const r of runs) {
  for (const result of r.results) {
    if (!result.passed) {
      console.log(`- Run ${r.runIndex} / ${result.scenarioId}: ${result.failureReason ?? '(no reason)'}`);
      console.log(`    raw head: ${result.rawOutput.slice(0, 200).replace(/\n/g, ' ⏎ ')}`);
    }
  }
}
