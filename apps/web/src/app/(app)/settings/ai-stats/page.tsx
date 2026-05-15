'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/components/layout/header';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/lib/i18n';
import { listMetrics, type AiMetric } from '@/lib/ai/chat/metrics';
import { pageWrapper, scrollArea, sectionLabel } from '@/lib/styles';

interface AggregateStats {
  messagesSent: number;
  totalInferenceMs: number;
  inferenceCount: number;
  outputTokens: number;
  errorCount: number;
  toolCalls: Record<string, number>;
  toolFailures: Record<string, number>;
  cancelled: number;
  feedbackBased: { up: number; down: number };
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function aggregate(metrics: AiMetric[]): AggregateStats {
  const out: AggregateStats = {
    messagesSent: 0,
    totalInferenceMs: 0,
    inferenceCount: 0,
    outputTokens: 0,
    errorCount: 0,
    toolCalls: {},
    toolFailures: {},
    cancelled: 0,
    feedbackBased: { up: 0, down: 0 },
  };
  for (const m of metrics) {
    switch (m.event) {
      case 'chat.message_sent':
        out.messagesSent++;
        break;
      case 'chat.inference_done': {
        const d = num(m.payload.durationMs);
        if (d !== undefined) {
          out.totalInferenceMs += d;
          out.inferenceCount++;
        }
        const t = num(m.payload.outputTokens);
        if (t !== undefined) out.outputTokens += t;
        break;
      }
      case 'chat.inference_error':
        out.errorCount++;
        break;
      case 'chat.cancelled_by_user':
        out.cancelled++;
        break;
      case 'chat.tool_call_executed': {
        const name = str(m.payload.toolName);
        if (name) out.toolCalls[name] = (out.toolCalls[name] ?? 0) + 1;
        break;
      }
      case 'chat.tool_call_failed': {
        const name = str(m.payload.toolName);
        if (name) out.toolFailures[name] = (out.toolFailures[name] ?? 0) + 1;
        break;
      }
    }
  }
  return out;
}

export default function AiStatsPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<AggregateStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMetrics({ limit: 10000 })
      .then((rows) => {
        if (!cancelled) setStats(aggregate(rows));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const avgMs =
    stats && stats.inferenceCount > 0
      ? Math.round(stats.totalInferenceMs / stats.inferenceCount)
      : 0;
  const topTools = stats
    ? Object.entries(stats.toolCalls).sort((a, b) => b[1] - a[1]).slice(0, 10)
    : [];

  return (
    <div className={pageWrapper}>
      <Header title={t.aiStats.title} showBack />
      <div className={`${scrollArea} px-5 py-4`}>
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : !stats ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <section>
              <div className={sectionLabel}>{t.aiStats.usageSection}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <StatCard label={t.aiStats.messagesSent} value={stats.messagesSent} />
                <StatCard label={t.aiStats.inferenceCount} value={stats.inferenceCount} />
                <StatCard label={t.aiStats.avgLatencyMs} value={avgMs} suffix="ms" />
                <StatCard label={t.aiStats.outputTokens} value={stats.outputTokens} />
              </div>
            </section>

            <section>
              <div className={sectionLabel}>{t.aiStats.healthSection}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <StatCard label={t.aiStats.errorCount} value={stats.errorCount} />
                <StatCard label={t.aiStats.cancelledCount} value={stats.cancelled} />
              </div>
            </section>

            <section>
              <div className={sectionLabel}>{t.aiStats.toolSection}</div>
              {topTools.length === 0 ? (
                <div className="mt-2 text-sm text-text-tertiary">{t.aiStats.noToolCalls}</div>
              ) : (
                <ul className="mt-2 divide-y divide-border rounded-lg border">
                  {topTools.map(([name, count]) => (
                    <li key={name} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="font-mono text-text-secondary">{name}</span>
                      <span className="font-semibold tabular-nums">
                        {count}
                        {stats.toolFailures[name] ? (
                          <span className="ml-1 text-xs text-destructive">
                            (−{stats.toolFailures[name]})
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="text-xs text-text-tertiary">{t.aiStats.localOnlyHint}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded-lg border bg-secondary/40 p-3">
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="mt-1 text-section font-semibold tabular-nums">
        {value.toLocaleString()}
        {suffix && <span className="ml-0.5 text-xs font-normal text-text-tertiary">{suffix}</span>}
      </div>
    </div>
  );
}
