'use client';

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { Info } from '@/components/ui/icons';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import { useLoader } from '@/hooks/use-loader';
import { bottomBar, bottomSep } from '@/lib/styles';
import { isNativeApp, scheduleNotification, cancelNotification } from '@/lib/native-bridge';
import type { QuizSettings } from '@/types/quiz';
import { DEFAULT_QUIZ_SETTINGS } from '@/types/quiz';

const NEW_PER_DAY_OPTIONS = [5, 10, 15, 20, 30, 50];
const MAX_REVIEWS_OPTIONS = [50, 100, 150, 200, 9999];
const SESSION_SIZE_OPTIONS = [10, 15, 20, 30, 50];
const LEECH_THRESHOLD_OPTIONS = [4, 6, 8, 10, 15];
const NOTIFICATION_HOUR_OPTIONS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
const NOTIFICATION_MINUTE_OPTIONS = [0, 15, 30, 45];

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

      // Sync notification schedule with native app
      if (isNativeApp()) {
        const prev = initialSettingsRef.current;
        const notifChanged =
          settings.notificationEnabled !== prev.notificationEnabled ||
          settings.notificationHour !== prev.notificationHour ||
          settings.notificationMinute !== prev.notificationMinute;

        if (notifChanged) {
          if (settings.notificationEnabled) {
            scheduleNotification(settings.notificationHour, settings.notificationMinute);
          } else {
            cancelNotification();
          }
        }
      }

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
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {/* New cards per day */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t.settings.newPerDay}</h2>
            <div className="flex flex-wrap gap-2">
              {NEW_PER_DAY_OPTIONS.map((n) => (
                <Button
                  key={n}
                  variant={settings.newPerDay === n ? 'secondary' : 'outline'}
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
                  variant={settings.maxReviewsPerDay === n ? 'secondary' : 'outline'}
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
                variant={settings.jlptFilter === null ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setSettings((s) => ({ ...s, jlptFilter: null }))}
              >
                {t.settings.allLevels}
              </Button>
              {[5, 4, 3, 2, 1].map((n) => (
                <Button
                  key={n}
                  variant={settings.jlptFilter === n ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setSettings((s) => ({ ...s, jlptFilter: n }))}
                >
                  N{n}
                </Button>
              ))}
            </div>
          </section>

          {/* Session size */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t.settings.sessionSize}</h2>
            <div className="flex flex-wrap gap-2">
              {SESSION_SIZE_OPTIONS.map((n) => (
                <Button
                  key={n}
                  variant={settings.sessionSize === n ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setSettings((s) => ({ ...s, sessionSize: n }))}
                >
                  {n}
                </Button>
              ))}
            </div>
          </section>

          {/* Leech threshold */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t.settings.leechThreshold}</h2>
            <p className="text-xs text-muted-foreground">{t.settings.leechThresholdDesc}</p>
            <div className="flex flex-wrap gap-2">
              {LEECH_THRESHOLD_OPTIONS.map((n) => (
                <Button
                  key={n}
                  variant={settings.leechThreshold === n ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setSettings((s) => ({ ...s, leechThreshold: n }))}
                >
                  {n}
                </Button>
              ))}
            </div>
          </section>

          {/* Card direction */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t.settings.cardDirection}</h2>
            <div className="flex flex-wrap gap-2">
              {([
                { value: 'term_first' as const, label: t.settings.termFirst },
                { value: 'meaning_first' as const, label: t.settings.meaningFirst },
                { value: 'random' as const, label: t.settings.randomDirection },
              ]).map(({ value, label }) => (
                <Button
                  key={value}
                  variant={settings.cardDirection === value ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setSettings((s) => ({ ...s, cardDirection: value }))}
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>

          {/* Priority filter */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t.settings.priorityFilter}</h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={settings.priorityFilter === null ? 'secondary' : 'outline'}
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
                  variant={settings.priorityFilter === value ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setSettings((s) => ({ ...s, priorityFilter: value }))}
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>

          {/* Notifications */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t.settings.notifications}</h2>
            <div
              role="checkbox"
              aria-checked={settings.notificationEnabled}
              tabIndex={0}
              className="flex cursor-pointer items-center justify-between rounded-lg border p-3"
              onClick={() => setSettings((s) => ({ ...s, notificationEnabled: !s.notificationEnabled }))}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  setSettings((s) => ({ ...s, notificationEnabled: !s.notificationEnabled }));
                }
              }}
            >
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{t.settings.notificationEnabled}</p>
                <p className="text-xs text-muted-foreground">{t.settings.notificationEnabledDesc}</p>
              </div>
              <div className={`relative h-5 w-9 rounded-full transition-colors ${settings.notificationEnabled ? 'bg-primary' : 'bg-muted'}`}>
                <div className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${settings.notificationEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </div>
            {settings.notificationEnabled && (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm font-medium">{t.settings.notificationTime}</p>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t.settings.notificationHour}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {NOTIFICATION_HOUR_OPTIONS.map((h) => (
                      <Button
                        key={h}
                        variant={settings.notificationHour === h ? 'secondary' : 'outline'}
                        size="sm"
                        className="min-w-[2.5rem]"
                        onClick={() => setSettings((s) => ({ ...s, notificationHour: h }))}
                      >
                        {h}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t.settings.notificationMinute}</p>
                  <div className="flex flex-wrap gap-2">
                    {NOTIFICATION_MINUTE_OPTIONS.map((m) => (
                      <Button
                        key={m}
                        variant={settings.notificationMinute === m ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => setSettings((s) => ({ ...s, notificationMinute: m }))}
                      >
                        {String(m).padStart(2, '0')}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Rating guide — informational block at bottom */}
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
