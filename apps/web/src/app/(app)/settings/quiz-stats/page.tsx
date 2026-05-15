'use client';

import { useState } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { BookOpenCheck, Flame, Trophy, Target } from '@/components/ui/icons';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Header } from '@/components/layout/header';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import { useLoader } from '@/hooks/use-loader';
import { computeWeightedAccuracy } from '@/types/quiz';
import type { DailyStats } from '@/types/quiz';

function getDateRange30Days(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 29);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { startDate: fmt(start), endDate: fmt(end) };
}

function formatShortDate(dateStr: string): string {
  const parts = dateStr.split('-');
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

/** Shared tooltip styles — Recharts needs explicit styles for content, items, and labels */
const tooltipContent: React.CSSProperties = {
  backgroundColor: 'var(--popover)',
  color: 'var(--popover-foreground)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '12px',
};
const tooltipLabel: React.CSSProperties = { color: 'var(--popover-foreground)' };
const tooltipItem: React.CSSProperties = { color: 'var(--popover-foreground)', padding: '1px 0' };

/** Daily activity stack — two-tone slate ramp (theme-aware via CSS vars) */
const BAR_COLOR_NEW = 'var(--chart-bar-new)';
const BAR_COLOR_REVIEW = 'var(--chart-bar-review)';

/** Pie chart colors keyed by FSRS card state.
 *  Restrained palette tinted toward brand hue: cool slate → teal → sage,
 *  with a single warm amber for Relearning (the only state that asks for attention). */
const STATE_COLORS: Record<number, string> = {
  0: 'var(--chart-state-new)',
  1: 'var(--chart-state-learning)',
  2: 'var(--chart-state-review)',
  3: 'var(--chart-state-relearning)',
};
const STATE_COLOR_FALLBACK = 'var(--chart-3)';

function getStateColor(state: number): string {
  return STATE_COLORS[state] ?? STATE_COLOR_FALLBACK;
}

interface StatsData {
  dailyStats: DailyStats[];
  streak: number;
  masteredCount: number;
  totalReviewed: number;
  cardDistribution: { state: number; count: number }[];
  avgAccuracy7d: number;
}

export default function QuizStatsPage() {
  const repo = useRepository();
  const { t } = useTranslation();
  const [data, setData] = useState<StatsData | null>(null);

  const [loading] = useLoader(async () => {
    const { startDate, endDate } = getDateRange30Days();
    const [dailyStats, streak, masteredWords, totalReviewed, cardDistribution] =
      await Promise.all([
        repo.study.getDailyStatsRange(startDate, endDate),
        repo.study.getStreakDays(),
        repo.words.getMastered(),
        repo.study.getTotalReviewedAllTime(),
        repo.study.getCardStateDistribution(),
      ]);

    // Compute 7-day average accuracy
    const last7 = dailyStats.slice(-7);
    const avgAccuracy7d =
      last7.length > 0
        ? Math.round(
            last7.reduce((sum, s) => sum + computeWeightedAccuracy(s), 0) /
              last7.length,
          )
        : 0;

    setData({
      dailyStats,
      streak,
      masteredCount: masteredWords.length,
      totalReviewed,
      cardDistribution: [...cardDistribution].sort((a, b) => a.state - b.state),
      avgAccuracy7d,
    });
  }, [repo]);

  const stateLabels: Record<number, string> = {
    0: t.stats.stateNew,
    1: t.stats.stateLearning,
    2: t.stats.stateReview,
    3: t.stats.stateRelearning,
  };

  return (
    <>
      <Header title={t.stats.title} showBack />
      {loading || !data ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <LoadingSpinner className="size-8" />
          {t.common.loading}
        </div>
      ) : (
        <div className="animate-page flex-1 space-y-4 overflow-y-auto px-4 pt-2">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: BookOpenCheck, iconClass: 'text-primary', value: data.totalReviewed.toLocaleString(), label: t.stats.totalReviewed },
              { icon: Flame, iconClass: 'text-orange-500', value: `${data.streak} ${t.stats.days}`, label: t.stats.currentStreak },
              { icon: Trophy, iconClass: 'text-yellow-500', value: data.masteredCount.toLocaleString(), label: t.stats.totalMastered },
              { icon: Target, iconClass: 'text-green-500', value: `${data.avgAccuracy7d}%`, label: t.stats.avgAccuracy },
            ].map((card, i) => {
              const Icon = card.icon;
              return (
                <Card
                  key={card.label}
                  className="animate-stagger"
                  style={{ '--stagger': i } as React.CSSProperties}
                >
                  <CardContent className="flex items-center gap-3 p-4">
                    <Icon className={`size-5 shrink-0 ${card.iconClass}`} />
                    <div className="min-w-0">
                      <div className="text-lg font-bold tabular-nums">{card.value}</div>
                      <div className="break-keep text-xs text-muted-foreground">
                        {card.label}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Daily Activity */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                {t.stats.dailyActivity}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{t.stats.last30Days}</p>
            </CardHeader>
            <CardContent className="pb-4">
              {data.dailyStats.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                  {t.stats.noData}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={data.dailyStats.map((s) => ({
                      date: s.date,
                      newCount: s.newCount,
                      reviewOnly: Math.max(0, s.reviewCount - s.newCount),
                    }))}
                    barCategoryGap="20%"
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="var(--border)"
                      strokeOpacity={0.5}
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatShortDate}
                      tick={{ fontSize: 10 }}
                      interval="preserveStartEnd"
                      stroke="var(--muted-foreground)"
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      width={28}
                      stroke="var(--muted-foreground)"
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      labelFormatter={formatShortDate}
                      contentStyle={tooltipContent}
                      labelStyle={tooltipLabel}
                      itemStyle={tooltipItem}
                      cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
                    />
                    <Bar
                      dataKey="newCount"
                      name={t.stats.newCards}
                      stackId="a"
                      fill={BAR_COLOR_NEW}
                    />
                    <Bar
                      dataKey="reviewOnly"
                      name={t.stats.reviewCards}
                      stackId="a"
                      fill={BAR_COLOR_REVIEW}
                      radius={[3, 3, 0, 0]}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }}
                      iconSize={8}
                      iconType="circle"
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Accuracy Trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                {t.stats.accuracyTrend}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{t.stats.last30Days}</p>
            </CardHeader>
            <CardContent className="pb-4">
              {data.dailyStats.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                  {t.stats.noData}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart
                    data={data.dailyStats.map((s) => ({
                      date: s.date,
                      accuracy: computeWeightedAccuracy(s),
                    }))}
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="var(--border)"
                      strokeOpacity={0.5}
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatShortDate}
                      tick={{ fontSize: 10 }}
                      interval="preserveStartEnd"
                      stroke="var(--muted-foreground)"
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10 }}
                      width={32}
                      tickFormatter={(v: number) => `${v}%`}
                      stroke="var(--muted-foreground)"
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      labelFormatter={formatShortDate}
                      formatter={(v: number) => [`${v}%`, t.quiz.accuracy]}
                      contentStyle={tooltipContent}
                      labelStyle={tooltipLabel}
                      itemStyle={tooltipItem}
                    />
                    <Line
                      type="monotone"
                      dataKey="accuracy"
                      stroke="var(--chart-state-learning)"
                      strokeWidth={2}
                      dot={{ r: 3, strokeWidth: 0, fill: 'var(--chart-state-learning)' }}
                      activeDot={{ r: 5, strokeWidth: 0 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Card State Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                {t.stats.cardDistribution}
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              {data.cardDistribution.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                  {t.stats.noData}
                </div>
              ) : (
                <CardDistribution
                  distribution={data.cardDistribution}
                  stateLabels={stateLabels}
                  unitLabel={t.stats.cards}
                />
              )}
            </CardContent>
          </Card>

          {/* Rating Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                {t.stats.ratingDistribution}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{t.stats.last30Days}</p>
            </CardHeader>
            <CardContent className="pb-4">
              {data.dailyStats.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                  {t.stats.noData}
                </div>
              ) : (
                <RatingBars stats={data.dailyStats} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

function CardDistribution({
  distribution,
  stateLabels,
  unitLabel,
}: {
  distribution: { state: number; count: number }[];
  stateLabels: Record<number, string>;
  unitLabel: string;
}) {
  const total = distribution.reduce((sum, d) => sum + d.count, 0);
  const pieData = distribution.map((d) => ({
    name: stateLabels[d.state] ?? `State ${d.state}`,
    value: d.count,
  }));

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-full">
        <ResponsiveContainer width="100%" height={196}>
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius={56}
              outerRadius={86}
              dataKey="value"
              paddingAngle={1.5}
              stroke="none"
              startAngle={90}
              endAngle={-270}
            >
              {distribution.map((d) => (
                <Cell key={d.state} fill={getStateColor(d.state)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* Center label — turns empty negative space into a meaningful total */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-bold tabular-nums leading-none">
            {total.toLocaleString()}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            {unitLabel}
          </div>
        </div>
      </div>
      {/* Legend rows — each state on its own row with bar weight reflecting share.
          More informative than the original chip strip and aligns with Rating Distribution. */}
      <div className="w-full space-y-1.5">
        {distribution.map((d) => {
          const pct = total > 0 ? (d.count / total) * 100 : 0;
          return (
            <div key={d.state} className="flex items-center gap-2.5 text-xs">
              <span
                className="size-2 shrink-0 rounded-sm"
                style={{ backgroundColor: getStateColor(d.state) }}
                aria-hidden
              />
              <span className="w-14 shrink-0 text-muted-foreground">
                {stateLabels[d.state] ?? `State ${d.state}`}
              </span>
              <div className="flex-1">
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted/40">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: getStateColor(d.state),
                      opacity: 0.85,
                    }}
                  />
                </div>
              </div>
              <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums">
                {d.count}
              </span>
              <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                {Math.round(pct)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const RATING_COLORS = [
  'var(--chart-rating-again)',
  'var(--chart-rating-hard)',
  'var(--chart-rating-good)',
  'var(--chart-rating-easy)',
] as const;

function RatingBars({ stats }: { stats: DailyStats[] }) {
  const { t } = useTranslation();
  const totals = stats.reduce(
    (acc, s) => ({
      again: acc.again + s.againCount,
      hard: acc.hard + s.hardCount,
      good: acc.good + s.goodCount,
      easy: acc.easy + s.easyCount,
    }),
    { again: 0, hard: 0, good: 0, easy: 0 },
  );
  const totalSum = totals.again + totals.hard + totals.good + totals.easy;
  const max = Math.max(totals.again, totals.hard, totals.good, totals.easy, 1);
  const bars = [
    { label: t.quiz.again, value: totals.again, color: RATING_COLORS[0] },
    { label: t.quiz.hard, value: totals.hard, color: RATING_COLORS[1] },
    { label: t.quiz.good, value: totals.good, color: RATING_COLORS[2] },
    { label: t.quiz.easy, value: totals.easy, color: RATING_COLORS[3] },
  ];

  return (
    <div className="space-y-2.5">
      {bars.map((bar, i) => {
        const pct = totalSum > 0 ? (bar.value / totalSum) * 100 : 0;
        return (
          <div
            key={bar.label}
            className="animate-stagger flex items-center gap-3"
            style={{ '--stagger': i } as React.CSSProperties}
          >
            <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
              {bar.label}
            </span>
            <div className="flex-1">
              <div className="h-2.5 w-full overflow-hidden rounded-md bg-muted/40">
                <div
                  className="h-full rounded-md"
                  style={{
                    width: `${(bar.value / max) * 100}%`,
                    backgroundColor: bar.color,
                    animation: `bar-fill 0.6s ease-out ${150 + i * 80}ms both`,
                  }}
                />
              </div>
            </div>
            <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums">
              {bar.value}
            </span>
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
              {Math.round(pct)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
