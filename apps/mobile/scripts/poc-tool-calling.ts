/**
 * Phase 0 PoC runner — drives the scenario catalog against the on-device
 * Gemma 4 E2B engine via runTextInference, parses tool_call tags from the
 * raw model output, and scores each scenario against the gate criteria.
 *
 * Runs inside the app (not on the Node host) because LiteRT-LM requires the
 * device-resident engine. The dev-only `apps/mobile/src/app/_debug-poc.tsx`
 * screen drives this from a button tap.
 *
 * Gate criteria live in `_docs/ai-assistant-phase0-plan.md`.
 */

import type { AiToolDef } from '../modules/nivoca-ai/src/NivocaAi.types';
import { runTextInference } from '../src/lib/ai/inference-text';
import { SCENARIOS, type PocScenario } from './poc-scenarios';

// ---------------------------------------------------------------------------
// Tool catalog — mirrors Phase 1 Function Catalog in the spec.
// ---------------------------------------------------------------------------

const TOOL_CATALOG: AiToolDef[] = [
  {
    name: 'add_word',
    description:
      "Add a new Japanese vocabulary word to the user's personal list. Use when the user asks to add, save, register, or note a word.",
    parameters: {
      type: 'object',
      required: ['term', 'reading', 'meaning'],
      properties: {
        term: { type: 'string', maxLength: 10 },
        reading: { type: 'string' },
        meaning: { type: 'string' },
        jlptLevel: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
      },
    },
  },
  {
    name: 'edit_word',
    description: "Edit an existing word's reading, meaning, or JLPT level.",
    parameters: {
      type: 'object',
      required: ['wordId'],
      properties: {
        wordId: { type: 'string' },
        term: { type: 'string', maxLength: 10 },
        reading: { type: 'string' },
        meaning: { type: 'string' },
        jlptLevel: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
      },
    },
  },
  {
    name: 'delete_word',
    description: 'Permanently delete a word. Destructive — cannot be undone.',
    parameters: {
      type: 'object',
      required: ['wordId'],
      properties: { wordId: { type: 'string' } },
    },
  },
  {
    name: 'set_mastered',
    description:
      'Mark a word as mastered (true) or move it back to the active list (false).',
    parameters: {
      type: 'object',
      required: ['wordId', 'mastered'],
      properties: {
        wordId: { type: 'string' },
        mastered: { type: 'boolean' },
      },
    },
  },
  {
    name: 'create_wordbook',
    description: 'Create a new wordbook.',
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', maxLength: 50 },
        description: { type: 'string', maxLength: 200 },
      },
    },
  },
  {
    name: 'edit_wordbook',
    description: 'Rename or edit the description of a wordbook.',
    parameters: {
      type: 'object',
      required: ['wordbookId'],
      properties: {
        wordbookId: { type: 'string' },
        name: { type: 'string', maxLength: 50 },
        description: { type: 'string', maxLength: 200 },
      },
    },
  },
  {
    name: 'delete_wordbook',
    description:
      'Permanently delete a wordbook (does NOT delete the words). Destructive.',
    parameters: {
      type: 'object',
      required: ['wordbookId'],
      properties: { wordbookId: { type: 'string' } },
    },
  },
  {
    name: 'add_word_to_wordbook',
    description: 'Add an existing word to a wordbook.',
    parameters: {
      type: 'object',
      required: ['wordId', 'wordbookId'],
      properties: {
        wordId: { type: 'string' },
        wordbookId: { type: 'string' },
      },
    },
  },
  {
    name: 'remove_word_from_wordbook',
    description: 'Remove a word from a wordbook (does NOT delete the word).',
    parameters: {
      type: 'object',
      required: ['wordId', 'wordbookId'],
      properties: {
        wordId: { type: 'string' },
        wordbookId: { type: 'string' },
      },
    },
  },
  {
    name: 'search_words',
    description:
      "Search the user's vocabulary by term, reading, or meaning. Returns up to 20 matches.",
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', maximum: 20 },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool-call extraction + scoring
// ---------------------------------------------------------------------------

export interface ToolCallExtract {
  name: string;
  argsRaw: string;
  argsParsed: Record<string, unknown> | null;
  parseOk: boolean;
}

const TOOL_CALL_PATTERN = /<tool_call>([\s\S]*?)<\/tool_call>/g;

export function extractToolCalls(raw: string): ToolCallExtract[] {
  const out: ToolCallExtract[] = [];
  for (const match of raw.matchAll(TOOL_CALL_PATTERN)) {
    const body = match[1].trim();
    let parsed: Record<string, unknown> | null = null;
    let parseOk = false;
    try {
      const obj = JSON.parse(body) as Record<string, unknown>;
      parsed = obj;
      parseOk = typeof obj.name === 'string';
    } catch {
      // leave parseOk false
    }
    out.push({
      name:
        parsed && typeof parsed.name === 'string'
          ? (parsed.name as string)
          : '<unparsed>',
      argsRaw: body,
      argsParsed: parsed,
      parseOk,
    });
  }
  return out;
}

export interface ScenarioResult {
  scenarioId: string;
  ask: string;
  rawOutput: string;
  durationMs: number;
  toolCalls: ToolCallExtract[];
  passed: boolean;
  failureReason?: string;
}

export interface Summary {
  total: number;
  passed: number;
  failed: number;
  truePositive: { passed: number; total: number };
  falsePositive: { passed: number; total: number };
  multiTool: { passed: number; total: number };
  clarification: { passed: number; total: number };
  meanDurationMs: number;
  parseRate: number;
}

function score(
  scn: PocScenario,
  calls: ToolCallExtract[],
): { passed: boolean; reason?: string } {
  if (scn.expectNoTool) {
    if (calls.length === 0) return { passed: true };
    return {
      passed: false,
      reason: `expected no tool, got ${calls.map((c) => c.name).join(',')}`,
    };
  }
  if (scn.expectClarification) {
    if (calls.length === 0) return { passed: true };
    return {
      passed: false,
      reason: `expected clarification, got tool calls: ${calls
        .map((c) => c.name)
        .join(',')}`,
    };
  }
  if (scn.expectMultiToolMinCount !== undefined) {
    if (calls.length >= scn.expectMultiToolMinCount) return { passed: true };
    return {
      passed: false,
      reason: `expected >=${scn.expectMultiToolMinCount} calls, got ${calls.length}`,
    };
  }
  if (scn.expectTool) {
    if (
      calls.length === 1 &&
      calls[0].name === scn.expectTool &&
      calls[0].parseOk
    ) {
      return { passed: true };
    }
    return {
      passed: false,
      reason: `expected exactly one ${scn.expectTool}, got ${calls
        .map((c) => c.name)
        .join(',') || 'none'}`,
    };
  }
  return { passed: false, reason: 'no expectation set' };
}

function summarize(results: ScenarioResult[]): Summary {
  const tp = results.filter(
    (r) => SCENARIOS.find((s) => s.id === r.scenarioId)?.expectTool,
  );
  const fp = results.filter(
    (r) => SCENARIOS.find((s) => s.id === r.scenarioId)?.expectNoTool,
  );
  const mt = results.filter(
    (r) =>
      SCENARIOS.find((s) => s.id === r.scenarioId)?.expectMultiToolMinCount,
  );
  const cl = results.filter(
    (r) => SCENARIOS.find((s) => s.id === r.scenarioId)?.expectClarification,
  );
  const allCalls = results.flatMap((r) => r.toolCalls);
  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    truePositive: {
      passed: tp.filter((r) => r.passed).length,
      total: tp.length,
    },
    falsePositive: {
      passed: fp.filter((r) => r.passed).length,
      total: fp.length,
    },
    multiTool: {
      passed: mt.filter((r) => r.passed).length,
      total: mt.length,
    },
    clarification: {
      passed: cl.filter((r) => r.passed).length,
      total: cl.length,
    },
    meanDurationMs:
      results.reduce((acc, r) => acc + r.durationMs, 0) /
      Math.max(1, results.length),
    parseRate:
      allCalls.length === 0
        ? 1
        : allCalls.filter((c) => c.parseOk).length / allCalls.length,
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const SYSTEM_PREAMBLE = [
  "You are the user's Japanese vocabulary study assistant.",
  "You can use tools to interact with the user's words and wordbooks.",
  "Respond in the user's language (Korean unless the message is mostly Japanese).",
].join('\n');

export async function runPoc(): Promise<{
  results: ScenarioResult[];
  summary: Summary;
}> {
  const results: ScenarioResult[] = [];
  for (const scn of SCENARIOS) {
    const systemContent = [SYSTEM_PREAMBLE, scn.context ?? '']
      .filter(Boolean)
      .join('\n\n');

    const t0 = Date.now();
    let raw = '';
    try {
      raw = await runTextInference({
        messages: [
          {
            role: 'system',
            content: [{ type: 'text', text: systemContent }],
          },
          { role: 'user', content: [{ type: 'text', text: scn.ask }] },
        ],
        tools: TOOL_CATALOG,
      });
    } catch (e) {
      raw = `<error>${e instanceof Error ? e.message : String(e)}</error>`;
    }
    const elapsed = Date.now() - t0;
    const calls = extractToolCalls(raw);
    const { passed, reason } = score(scn, calls);
    results.push({
      scenarioId: scn.id,
      ask: scn.ask,
      rawOutput: raw,
      durationMs: elapsed,
      toolCalls: calls,
      passed,
      failureReason: reason,
    });
  }
  return { results, summary: summarize(results) };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function formatReport(
  summary: Summary,
  results: ScenarioResult[],
): string {
  const lines = [
    `Total: ${summary.passed}/${summary.total} passed (${summary.failed} failed)`,
    `True positive: ${summary.truePositive.passed}/${summary.truePositive.total}`,
    `False positive blocked: ${summary.falsePositive.passed}/${summary.falsePositive.total}`,
    `Multi-tool batched: ${summary.multiTool.passed}/${summary.multiTool.total}`,
    `Clarification: ${summary.clarification.passed}/${summary.clarification.total}`,
    `Mean duration: ${Math.round(summary.meanDurationMs)}ms`,
    `JSON parse rate: ${(summary.parseRate * 100).toFixed(0)}%`,
    '',
    '--- per scenario ---',
    ...results.map(
      (r) =>
        `[${r.passed ? 'PASS' : 'FAIL'}] ${r.scenarioId} (${r.durationMs}ms) — ${r.failureReason ?? 'ok'}`,
    ),
  ];
  return lines.join('\n');
}
