'use client';

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { Info } from '@/components/ui/icons';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import { useLoader } from '@/hooks/use-loader';
import { bottomBar, bottomSep } from '@/lib/styles';
import type { QuizSettings } from '@/types/quiz';
import { DEFAULT_QUIZ_SETTINGS } from '@/types/quiz';

const DAILY_GOAL_OPTIONS = [10, 15, 20, 30, 50, 100];
const EXAMPLE_RATIO_OPTIONS = [0, 20, 30, 50, 70, 100];
const LEECH_THRESHOLD_OPTIONS = [4, 6, 8, 10, 15];

const chipBase = 'text-muted-foreground';
const chipSelected = '!bg-foreground !text-background !border-foreground';

export default function QuizSettingsPage() {
  const repo = useRepository();
  const { t } = useTranslation();
  const [settings, setSettings] = useState<QuizSettings>(DEFAULT_QUIZ_SETTINGS);
  const [saving, setSaving] = useState(false);
  const initialSettingsRef = useRef<QuizSettings>(DEFAULT_QUIZ_SETTINGS);

  const [loading] = useLoader(async () => {
    const data = await repo.study.getQuizSettings();
    setSettings(data);
    initialSettingsRef.current = data;
  }, [repo]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await repo.study.updateQuizSettings(settings);
      initialSettingsRef.current = settings;
      toast.success(t.profile.saved);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <Header title={t.settings.quizSettings} showBack />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <LoadingSpinner className="size-8" />
          {t.common.loading}
        </div>
        <div className={bottomBar}>
          <div className={bottomSep} />
          <Button className="w-full" disabled>{t.common.save}</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title={t.settings.quizSettings} showBack />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-5 pt-2">
          {/* Daily goal */}
          <section className="space-y-2.5">
            <h2 className="text-body font-semibold">{t.settings.dailyGoal}</h2>
            <p className="text-xs text-muted-foreground">{t.settings.dailyGoalDesc}</p>
            <div className="flex flex-wrap gap-2">
              {DAILY_GOAL_OPTIONS.map((n) => (
                <Button
                  key={n}
                  variant="outline"
                  size="sm"
                  className={cn('!h-9 rounded-md text-caption', chipBase, settings.dailyGoal === n && chipSelected)}
                  onClick={() => setSettings((s) => ({ ...s, dailyGoal: n }))}
                >
                  {n}
                </Button>
              ))}
            </div>
          </section>

          {/* Example quiz ratio */}
          <section className="space-y-2.5">
            <h2 className="text-body font-semibold">{t.settings.exampleQuizRatio}</h2>
            <p className="text-xs text-muted-foreground">{t.settings.exampleQuizRatioDesc}</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_RATIO_OPTIONS.map((n) => (
                <Button
                  key={n}
                  variant="outline"
                  size="sm"
                  className={cn('!h-9 rounded-md text-caption', chipBase, settings.exampleQuizRatio === n && chipSelected)}
                  onClick={() => setSettings((s) => ({ ...s, exampleQuizRatio: n }))}
                >
                  {n}%
                </Button>
              ))}
            </div>
          </section>

          {/* JLPT filter */}
          <section className="space-y-2.5">
            <h2 className="text-body font-semibold">{t.settings.jlptFilter}</h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className={cn('!h-9 rounded-md text-caption', chipBase, settings.jlptFilter === null && chipSelected)}
                onClick={() => setSettings((s) => ({ ...s, jlptFilter: null }))}
              >
                {t.settings.allLevels}
              </Button>
              {[5, 4, 3, 2, 1].map((n) => (
                <Button
                  key={n}
                  variant="outline"
                  size="sm"
                  className={cn('!h-9 rounded-md text-caption', chipBase, settings.jlptFilter === n && chipSelected)}
                  onClick={() => setSettings((s) => ({ ...s, jlptFilter: n }))}
                >
                  N{n}
                </Button>
              ))}
            </div>
          </section>

          {/* Leech threshold */}
          <section className="space-y-2.5">
            <h2 className="text-body font-semibold">{t.settings.leechThreshold}</h2>
            <p className="text-xs text-muted-foreground">{t.settings.leechThresholdDesc}</p>
            <div className="flex flex-wrap gap-2">
              {LEECH_THRESHOLD_OPTIONS.map((n) => (
                <Button
                  key={n}
                  variant="outline"
                  size="sm"
                  className={cn('!h-9 rounded-md text-caption', chipBase, settings.leechThreshold === n && chipSelected)}
                  onClick={() => setSettings((s) => ({ ...s, leechThreshold: n }))}
                >
                  {n}
                </Button>
              ))}
            </div>
          </section>

          {/* Card direction */}
          <section className="space-y-2.5">
            <h2 className="text-body font-semibold">{t.settings.cardDirection}</h2>
            <div className="flex flex-wrap gap-2">
              {([
                { value: 'term_first' as const, label: t.settings.termFirst },
                { value: 'meaning_first' as const, label: t.settings.meaningFirst },
                { value: 'random' as const, label: t.settings.randomDirection },
              ]).map(({ value, label }) => (
                <Button
                  key={value}
                  variant="outline"
                  size="sm"
                  className={cn('!h-9 rounded-md text-caption', chipBase, settings.cardDirection === value && chipSelected)}
                  onClick={() => setSettings((s) => ({ ...s, cardDirection: value }))}
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>

          {/* Priority filter */}
          <section className="space-y-2.5">
            <h2 className="text-body font-semibold">{t.settings.priorityFilter}</h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className={cn('!h-9 rounded-md text-caption', chipBase, settings.priorityFilter === null && chipSelected)}
                onClick={() => setSettings((s) => ({ ...s, priorityFilter: null }))}
              >
                {t.settings.allPriorities}
              </Button>
              {[
                { value: 1, label: t.priority.high },
                { value: 2, label: t.priority.medium },
                { value: 3, label: t.priority.low },
              ].map(({ value, label }) => (
                <Button
                  key={value}
                  variant="outline"
                  size="sm"
                  className={cn('!h-9 rounded-md text-caption', chipBase, settings.priorityFilter === value && chipSelected)}
                  onClick={() => setSettings((s) => ({ ...s, priorityFilter: value }))}
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>

          {/* Rating guide */}
          <section className="rounded-lg bg-muted/50 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <Info className="size-4 text-muted-foreground" />
              {t.settings.ratingGuide}
            </div>
            <p className="text-sm text-muted-foreground">{t.settings.ratingGuideDesc}</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>{t.settings.ratingAgainDesc}</li>
              <li>{t.settings.ratingHardDesc}</li>
              <li>{t.settings.ratingGoodDesc}</li>
              <li>{t.settings.ratingEasyDesc}</li>
            </ul>
          </section>
        </div>

        <div className={bottomBar}>
          <div className={bottomSep} />
          <Button
            className="w-full"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? t.common.saving : t.common.save}
          </Button>
        </div>
      </div>
    </>
  );
}
