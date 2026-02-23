'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import type { QuizSettings } from '@/types/quiz';
import { DEFAULT_QUIZ_SETTINGS } from '@/types/quiz';

const NEW_PER_DAY_OPTIONS = [5, 10, 15, 20, 30, 50];
const MAX_REVIEWS_OPTIONS = [50, 100, 150, 200, 9999];

export default function QuizSettingsPage() {
  const repo = useRepository();
  const { t } = useTranslation();
  const [settings, setSettings] = useState<QuizSettings>(DEFAULT_QUIZ_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const loadStart = useRef(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    loadStart.current = Date.now();
    try {
      const data = await repo.study.getQuizSettings();
      setSettings(data);
    } finally {
      const remaining = 300 - (Date.now() - loadStart.current);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      setLoading(false);
    }
  }, [repo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await repo.study.updateQuizSettings(settings);
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
      </>
    );
  }

  return (
    <>
      <Header title={t.settings.quizSettings} showBack />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {/* New cards per day */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t.settings.newPerDay}</h2>
            <div className="flex flex-wrap gap-2">
              {NEW_PER_DAY_OPTIONS.map((n) => (
                <Button
                  key={n}
                  variant={settings.newPerDay === n ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettings((s) => ({ ...s, newPerDay: n }))}
                >
                  {n}
                </Button>
              ))}
            </div>
          </section>

          {/* Max reviews per day */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t.settings.maxReviewsPerDay}</h2>
            <div className="flex flex-wrap gap-2">
              {MAX_REVIEWS_OPTIONS.map((n) => (
                <Button
                  key={n}
                  variant={settings.maxReviewsPerDay === n ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettings((s) => ({ ...s, maxReviewsPerDay: n }))}
                >
                  {n === 9999 ? '∞' : n}
                </Button>
              ))}
            </div>
          </section>

          {/* JLPT filter */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t.settings.jlptFilter}</h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={settings.jlptFilter === null ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSettings((s) => ({ ...s, jlptFilter: null }))}
              >
                {t.settings.allLevels}
              </Button>
              {[5, 4, 3, 2, 1].map((n) => (
                <Button
                  key={n}
                  variant={settings.jlptFilter === n ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettings((s) => ({ ...s, jlptFilter: n }))}
                >
                  N{n}
                </Button>
              ))}
            </div>
          </section>

          {/* Priority filter */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t.settings.priorityFilter}</h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={settings.priorityFilter === null ? 'default' : 'outline'}
                size="sm"
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
                  variant={settings.priorityFilter === value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettings((s) => ({ ...s, priorityFilter: value }))}
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>

          {/* New card order */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t.settings.newCardOrder}</h2>
            <div className="flex flex-wrap gap-2">
              {([
                { value: 'recent' as const, label: t.settings.orderRecent },
                { value: 'priority' as const, label: t.settings.orderPriority },
                { value: 'jlpt' as const, label: t.settings.orderJlpt },
              ]).map(({ value, label }) => (
                <Button
                  key={value}
                  variant={settings.newCardOrder === value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettings((s) => ({ ...s, newCardOrder: value }))}
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>
        </div>

        <div className="shrink-0 bg-background px-4 pb-3">
          <div className="mb-3 h-px bg-border" />
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
