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

/** Stacked bar chart — must be perceptually distinct across light/dark */
const BAR_COLOR_NEW = 'oklch(0.72 0.17 162)';     /* teal — new cards */
const BAR_COLOR_REVIEW = 'oklch(0.60 0.14 250)';  /* blue — review cards */

/** Pie chart colors keyed by FSRS card state — consistent regardless of data order */
const STATE_COLORS: Record<number, string> = {
  0: 'oklch(0.65 0.19 250)',   /* blue — New */
  1: 'oklch(0.75 0.17 55)',    /* amber — Learning */
  2: 'oklch(0.72 0.17 152)',   /* green — Review */
  3: 'oklch(0.65 0.22 25)',    /* red-orange — Relearning */
};
const STATE_COLOR_FALLBACK = 'oklch(0.70 0.17 310)';

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
        <div className="animate-page flex-1 space-y-4 overflow-y-auto p-4">
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
                    <div>
                      <div className="text-lg font-bold tabular-nums">{card.value}</div>
                      <div className="text-xs text-muted-foreground">{card.label}</div>
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
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatShortDate}
                      tick={{ fontSize: 10 }}
                      interval="preserveStartEnd"
                      stroke="var(--muted-foreground)"
                    />
                    <YAxis tick={{ fontSize: 10 }} width={35} stroke="var(--muted-foreground)" />
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
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="reviewOnly"
                      name={t.stats.reviewCards}
                      stackId="a"
                      fill={BAR_COLOR_REVIEW}
                      radius={[2, 2, 0, 0]}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', color: 'var(--muted-foreground)' }} />
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
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatShortDate}
                      tick={{ fontSize: 10 }}
                      interval="preserveStartEnd"
                      stroke="var(--muted-foreground)"
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10 }}
                      width={40}
                      tickFormatter={(v: number) => `${v}%`}
                      stroke="var(--muted-foreground)"
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
                      stroke="var(--chart-4)"
                      strokeWidth={2}
                      dot={{ r: 3 }}
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
                <div className="flex flex-col items-center gap-3">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={data.cardDistribution.map((d) => ({
                          name: stateLabels[d.state] ?? `State ${d.state}`,
                          value: d.count,
                        }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={75}
                        dataKey="value"
                        paddingAngle={3}
                      >
                        {data.cardDistribution.map((d) => (
                          <Cell
                            key={d.state}
                            fill={getStateColor(d.state)}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs">
                    {data.cardDistribution.map((d) => (
                      <div key={d.state} className="flex items-center gap-1.5">
                        <div
                          className="size-2.5 rounded-full"
                          style={{
                            backgroundColor: getStateColor(d.state),
                          }}
                        />
                        <span className="text-muted-foreground">
                          {stateLabels[d.state] ?? `State ${d.state}`}
                        </span>
                        <span className="font-medium tabular-nums">{d.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
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
  const max = Math.max(totals.again, totals.hard, totals.good, totals.easy, 1);
  const bars = [
    { label: t.quiz.again, value: totals.again, color: 'bg-red-500' },
    { label: t.quiz.hard, value: totals.hard, color: 'bg-orange-500' },
    { label: t.quiz.good, value: totals.good, color: 'bg-blue-500' },
    { label: t.quiz.easy, value: totals.easy, color: 'bg-green-500' },
  ];

  return (
    <div className="space-y-3">
      {bars.map((bar, i) => (
        <div
          key={bar.label}
          className="animate-stagger flex items-center gap-3"
          style={{ '--stagger': i } as React.CSSProperties}
        >
          <span className="w-12 text-right text-xs text-muted-foreground">
            {bar.label}
          </span>
          <div className="flex-1">
            <div className="h-5 w-full overflow-hidden rounded-full bg-muted/50">
              <div
                className={`h-full rounded-full ${bar.color}`}
                style={{
                  width: `${(bar.value / max) * 100}%`,
                  animation: `bar-fill 0.6s ease-out ${150 + i * 80}ms both`,
                }}
              />
            </div>
          </div>
          <span className="w-10 text-right text-xs font-medium tabular-nums">
            {bar.value}
          </span>
        </div>
      ))}
    </div>
  );
}
