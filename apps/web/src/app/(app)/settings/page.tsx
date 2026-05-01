'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ChevronRight, ExternalLink, Trophy, SlidersHorizontal, BarChart3, Trash2, AlertTriangle, LogOut } from '@/components/ui/icons';
import { useAuthStore } from '@/stores/auth-store';
import { useRepository } from '@/lib/repository/provider';
import { createClient } from '@/lib/supabase/client';
import { useTranslation, type Locale } from '@/lib/i18n';
import { useBottomNavLock } from '@/hooks/use-bottom-nav-lock';
import { invalidateListCache } from '@/lib/list-cache';
import { getLocalOcrMode } from '@/lib/ocr/settings';
import { clearSession } from '@/lib/quiz/session-store';
import { requestDueCountRefresh } from '@/lib/quiz/due-count-sync';
import { fetchProfile } from '@/lib/profile/fetch';
import { searchDictionary } from '@/lib/dictionary/jisho';
import {
  settingsScroll,
  settingsSection,
  settingsHeading,
  settingsNavLink,
  settingsRow,
} from '@/lib/styles';
import type { ImportData } from '@/types/word';

export default function SettingsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const repo = useRepository();
  const { t, locale, setLocale } = useTranslation();
  const { theme, setTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [ocrModeLabel, setOcrModeLabel] = useState('');
  const [profileNickname, setProfileNickname] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  useBottomNavLock(importing);

  useEffect(() => {
    const mode = getLocalOcrMode();
    setOcrModeLabel(
      mode === 'llm' ? t.settings.llmVision : mode === 'hybrid' ? t.settings.llmHybrid : t.settings.ocrFree,
    );
  }, [t]);

  useEffect(() => {
    if (!user) {
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    fetchProfile()
      .then((p) => setProfileNickname(p.nickname))
      .catch(() => {})
      .finally(() => setProfileLoading(false));
  }, [user]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    let imported = false;
    try {
      const text = await file.text();

      if (file.name.endsWith('.json')) {
        const data: ImportData = JSON.parse(text);
        if (data.version !== 1 && data.version !== 2) {
          toast.error(t.settings.unsupportedVersion);
          return;
        }
        await repo.importAll(data);
        imported = true;
        toast.success(t.settings.importSuccess(data.words.length));
      } else if (file.name.endsWith('.csv')) {
        const lines = text.trim().split('\n');
        const words = lines.slice(1).map((line) => {
          const cols = parseCSVLine(line);
          return {
            term: cols[0] ?? '',
            reading: cols[1] ?? '',
            meaning: cols[2] ?? '',
            tags: cols[3] ? cols[3].split(';').filter(Boolean) : [],
            jlptLevel: cols[4] ? Number(cols[4]) : null,
            notes: cols[5] || null,
          };
        });

        let csvSkipped = 0;
        for (const word of words) {
          // Resolve dict entry via search API (handles local cache → Jisho → LLM → upsert).
          const entries = await searchDictionary(word.term, locale).catch(() => []);
          const match = entries.find((e) => {
            const jp = e.japanese[0];
            return (jp?.word ?? jp?.reading ?? '') === word.term
              && (jp?.reading ?? '') === word.reading;
          }) ?? entries[0];
          if (!match?.id) {
            csvSkipped++;
            continue;
          }
          try {
            await repo.words.create({ ...word, dictionaryEntryId: match.id });
          } catch (err) {
            if (err instanceof Error && err.message === 'DUPLICATE_WORD') continue;
            throw err;
          }
        }
        imported = true;
        toast.success(t.settings.importSuccess(words.length - csvSkipped));
        if (csvSkipped > 0) {
          toast.warning(`${csvSkipped} rows skipped (no dictionary match).`);
        }
      } else {
        toast.error(t.settings.unsupportedFormat);
      }
    } catch {
      toast.error(t.settings.importError);
    } finally {
      if (imported) {
        invalidateListCache();
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
      setImporting(false);
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  };

  const handleResetStudyData = async () => {
    setShowResetConfirm(false);
    setResetting(true);
    try {
      await repo.study.resetStudyData();
      clearSession();
      requestDueCountRefresh();
      toast.success(t.settings.resetStudyDataSuccess);
    } catch {
      toast.error(t.common.error);
    } finally {
      setResetting(false);
    }
  };

  const languageOptions: { value: Locale; label: string }[] = [
    { value: 'ko', label: '한국어' },
    { value: 'en', label: 'English' },
  ];

  return (
    <>
      <Header title={t.settings.title} />
      <div className={settingsScroll}>
        {/* Account */}
        <section className={settingsSection}>
          <h2 className={settingsHeading}>{t.settings.account}</h2>
          {user ? (
            <Link
              href="/settings/profile"
              className="flex items-center gap-3 rounded-xl bg-secondary p-4 active:bg-accent/50"
              data-testid="settings-profile-link"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground">
                {(profileNickname?.[0] ?? user.email?.[0] ?? 'U').toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                {profileLoading ? (
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-36" />
                  </div>
                ) : (
                  <>
                    {profileNickname && (
                      <div className="truncate text-body font-semibold">{profileNickname}</div>
                    )}
                    <div className="truncate text-caption text-muted-foreground">
                      {user.email}
                    </div>
                  </>
                )}
              </div>
              <ChevronRight className="size-4 shrink-0 text-text-tertiary" />
            </Link>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                {t.settings.guestMode}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="!h-9 rounded-md"
                  onClick={() => router.push('/login')}
                >
                  {t.auth.signIn}
                </Button>
                <Button size="sm" className="!h-9 rounded-md" onClick={() => router.push('/signup')}>
                  {t.auth.signUp}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Language */}
        <section className={settingsSection}>
          <h2 className={settingsHeading}>{t.settings.language}</h2>
          <div className="flex gap-2">
            {languageOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setLocale(opt.value)}
                data-testid={`settings-lang-${opt.value}`}
                className={cn(
                  'flex !h-9 items-center justify-center rounded-md px-4 text-caption font-medium transition-colors border',
                  locale === opt.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Theme */}
        <section className={settingsSection}>
          <h2 className={settingsHeading}>{t.settings.theme}</h2>
          <div className="flex gap-2">
            {([
              { value: 'system', label: t.settings.themeSystem },
              { value: 'light', label: t.settings.themeLight },
              { value: 'dark', label: t.settings.themeDark },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                data-testid={`settings-theme-${opt.value}`}
                className={cn(
                  'flex !h-9 items-center justify-center rounded-md px-4 text-caption font-medium transition-colors border',
                  theme === opt.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Quiz */}
        <section className={settingsSection}>
          <h2 className={settingsHeading}>{t.nav.quiz}</h2>
          {user ? (
            <div>
              <Link
                href="/settings/quiz"
                className={settingsRow}
                data-testid="settings-quiz-link"
              >
                <div className="flex items-center gap-3">
                  <SlidersHorizontal className="size-[18px] text-muted-foreground" />
                  <span className="text-body font-medium">{t.settings.quizSettings}</span>
                </div>
                <ChevronRight className="size-4 shrink-0 text-text-tertiary" />
              </Link>
              <Link
                href="/settings/achievements"
                className={settingsRow}
                data-testid="settings-achievements-link"
              >
                <div className="flex items-center gap-3">
                  <Trophy className="size-[18px] text-muted-foreground" />
                  <span className="text-body font-medium">{t.settings.achievements}</span>
                </div>
                <ChevronRight className="size-4 shrink-0 text-text-tertiary" />
              </Link>
              <Link
                href="/settings/quiz-stats"
                className={settingsRow}
                data-testid="settings-quiz-stats-link"
              >
                <div className="flex items-center gap-3">
                  <BarChart3 className="size-[18px] text-muted-foreground" />
                  <span className="text-body font-medium">{t.settings.quizStats}</span>
                </div>
                <ChevronRight className="size-4 shrink-0 text-text-tertiary" />
              </Link>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t.settings.loginRequiredQuiz}
            </div>
          )}
        </section>

        {/* Reset Study Data */}
        {user && (
          <section className={settingsSection}>
            <p className="text-caption leading-relaxed text-muted-foreground">
              {t.settings.resetStudyDataDesc}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="!h-9 rounded-md border-0 bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={() => setShowResetConfirm(true)}
              disabled={resetting}
              data-testid="settings-reset-study-button"
            >
              {t.settings.resetStudyData}
            </Button>
          </section>
        )}

        <div className="h-px bg-border" />

        {/* OCR / AI */}
        <section className={settingsSection}>
          <h2 className={settingsHeading}>
            {t.settings.ocrTitle}
          </h2>
          {user ? (
            <div className="flex items-center justify-between">
              <div className="text-sm">{ocrModeLabel}</div>
              <Link href="/settings/ocr">
                <Button variant="outline" size="sm" className="!h-9 rounded-md" data-testid="settings-ocr-link">
                  {t.settings.goToSettings}
                </Button>
              </Link>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t.settings.loginRequiredOcr}
            </div>
          )}
        </section>

        <div className="h-px bg-border" />

        {/* Import — auth-only, since guests have no persistent storage to import into */}
        {user && (
          <section className={settingsSection}>
            <h2 className={settingsHeading}>{t.settings.migration}</h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="!h-9 rounded-md"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                data-testid="settings-import-button"
              >
                {t.settings.import}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.csv"
                onChange={handleImport}
                className="hidden"
              />
            </div>
          </section>
        )}

        {/* Logout */}
        {user && (
          <>
          <div className="h-px bg-border" />
          <button
            onClick={handleLogout}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-destructive/10 text-body font-semibold text-destructive transition-colors active:bg-destructive/20"
            data-testid="settings-logout-button"
          >
            <LogOut className="size-[18px]" />
            {t.settings.signOut}
          </button>
          </>
        )}

        <div className="h-px bg-border" />

        {/* Info */}
        <section className={settingsSection}>
          <h2 className={settingsHeading}>{t.settings.about}</h2>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t.settings.developer}</span>
              <a
                href="https://github.com/JunjaK"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary"
              >
                JunjaK
                <ExternalLink className="size-3.5" />
              </a>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t.settings.sourceCode}</span>
              <a
                href="https://github.com/JunjaK/nihongo-vocabook"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary"
              >
                GitHub
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>

          <Link
            href="/settings/licenses"
            className={settingsNavLink}
          >
            <span className="text-sm text-text-tertiary">{t.settings.openSource}</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </section>

        {/* Footer */}
        <div className="flex items-center justify-between px-0 py-2 text-[11px] text-text-tertiary">
          <span>v1.0.0</span>
          <span>© 2026 NiVoca. All rights reserved.</span>
        </div>
      </div>

      <ConfirmDialog
        open={showResetConfirm}
        icon={<AlertTriangle />}
        title={t.settings.resetStudyData}
        description={t.settings.resetStudyDataConfirm}
        confirmLabel={t.settings.resetStudyData}
        destructive
        onConfirm={handleResetStudyData}
        onCancel={() => setShowResetConfirm(false)}
      />
    </>
  );
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}
