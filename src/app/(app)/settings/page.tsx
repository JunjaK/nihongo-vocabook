'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ChevronRight, ArrowRightLeft, ExternalLink, Trophy, SlidersHorizontal } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useRepository } from '@/lib/repository/provider';
import { createClient } from '@/lib/supabase/client';
import {
  getLocalWordCount,
  migrateToSupabase,
} from '@/lib/migration/migrate-to-supabase';
import { useTranslation, type Locale } from '@/lib/i18n';
import { getLocalOcrMode } from '@/lib/ocr/settings';
import { fetchProfile } from '@/lib/profile/fetch';
import type { ImportData } from '@/types/word';

export default function SettingsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const repo = useRepository();
  const { t, locale, setLocale } = useTranslation();
  const { theme, setTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateCount, setMigrateCount] = useState(0);
  const [showMigrateConfirm, setShowMigrateConfirm] = useState(false);
  const [ocrModeLabel, setOcrModeLabel] = useState('');
  const [profileNickname, setProfileNickname] = useState<string | null>(null);

  useEffect(() => {
    const mode = getLocalOcrMode();
    setOcrModeLabel(mode === 'llm' ? t.settings.llmVision : t.settings.ocrFree);
  }, [t]);

  useEffect(() => {
    if (!user) return;
    fetchProfile()
      .then((p) => setProfileNickname(p.nickname))
      .catch(() => {});
  }, [user]);

  const handleExportJSON = async () => {
    const data = await repo.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    downloadBlob(blob, 'nihongo-vocabook-export.json');
    toast.success(t.settings.exportSuccess);
  };

  const handleExportCSV = async () => {
    const data = await repo.exportAll();
    const header = 'term,reading,meaning,tags,jlptLevel,notes';
    const rows = data.words.map((w) =>
      [
        csvEscape(w.term),
        csvEscape(w.reading),
        csvEscape(w.meaning),
        csvEscape(w.tags.join(';')),
        w.jlptLevel ?? '',
        csvEscape(w.notes ?? ''),
      ].join(','),
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    downloadBlob(blob, 'nihongo-vocabook-export.csv');
    toast.success(t.settings.exportSuccess);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();

      if (file.name.endsWith('.json')) {
        const data: ImportData = JSON.parse(text);
        if (data.version !== 1 && data.version !== 2) {
          toast.error(t.settings.unsupportedVersion);
          return;
        }
        await repo.importAll(data);
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

        for (const word of words) {
          await repo.words.create(word);
        }
        toast.success(t.settings.importSuccess(words.length));
      } else {
        toast.error(t.settings.unsupportedFormat);
      }
    } catch {
      toast.error(t.settings.importError);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleMigrateRequest = async () => {
    const count = await getLocalWordCount();
    if (count === 0) {
      toast.info(t.settings.noLocalData);
      return;
    }
    setMigrateCount(count);
    setShowMigrateConfirm(true);
  };

  const handleMigrateConfirm = async () => {
    setShowMigrateConfirm(false);
    setMigrating(true);
    try {
      const supabase = createClient();
      const result = await migrateToSupabase(supabase);
      toast.success(
        t.settings.migrationSuccess(result.wordCount, result.progressCount),
      );
    } catch {
      toast.error(t.settings.migrationFailed);
    } finally {
      setMigrating(false);
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  };

  const languageOptions: { value: Locale; label: string }[] = [
    { value: 'ko', label: '한국어' },
    { value: 'en', label: 'English' },
  ];

  return (
    <>
      <Header title={t.settings.title} />
      <div className="animate-page flex-1 space-y-6 overflow-y-auto p-4">
        {/* Account */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">{t.settings.account}</h2>
          {user ? (
            <div className="space-y-3">
              <Link
                href="/settings/profile"
                className="flex items-center justify-between rounded-lg border p-3 active:bg-accent/50"
                data-testid="settings-profile-link"
              >
                <div>
                  {profileNickname && (
                    <div className="text-sm font-medium">{profileNickname}</div>
                  )}
                  <div className={profileNickname ? 'text-xs text-muted-foreground' : 'text-sm'}>
                    {user.email}
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                data-testid="settings-logout-button"
              >
                {t.settings.signOut}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                {t.settings.guestMode}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push('/login')}
                >
                  {t.auth.signIn}
                </Button>
                <Button size="sm" onClick={() => router.push('/signup')}>
                  {t.auth.signUp}
                </Button>
              </div>
            </div>
          )}
        </section>

        <Separator />

        {/* Language */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">{t.settings.language}</h2>
          <div className="flex gap-2">
            {languageOptions.map((opt) => (
              <Button
                key={opt.value}
                variant={locale === opt.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLocale(opt.value)}
                data-testid={`settings-lang-${opt.value}`}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </section>

        <Separator />

        {/* Theme */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">{t.settings.theme}</h2>
          <div className="flex gap-2">
            {([
              { value: 'system', label: t.settings.themeSystem },
              { value: 'light', label: t.settings.themeLight },
              { value: 'dark', label: t.settings.themeDark },
            ] as const).map((opt) => (
              <Button
                key={opt.value}
                variant={theme === opt.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme(opt.value)}
                data-testid={`settings-theme-${opt.value}`}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </section>

        <Separator />

        {/* Quiz & Achievements */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">{t.nav.quiz}</h2>
          <Link
            href="/settings/quiz"
            className="flex items-center justify-between rounded-lg border p-3 active:bg-accent/50"
            data-testid="settings-quiz-link"
          >
            <div className="flex items-center gap-3">
              <SlidersHorizontal className="size-4 text-muted-foreground" />
              <span className="text-sm">{t.settings.quizSettings}</span>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
          <Link
            href="/settings/achievements"
            className="flex items-center justify-between rounded-lg border p-3 active:bg-accent/50"
            data-testid="settings-achievements-link"
          >
            <div className="flex items-center gap-3">
              <Trophy className="size-4 text-muted-foreground" />
              <span className="text-sm">{t.settings.achievements}</span>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </section>

        <Separator />

        {/* OCR / AI */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">
            {t.settings.ocrTitle}
          </h2>
          {user ? (
            <div className="flex items-center justify-between">
              <div className="text-sm">{ocrModeLabel}</div>
              <Link href="/settings/ocr">
                <Button variant="outline" size="sm" data-testid="settings-ocr-link">
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

        <Separator />

        {/* Data Migration */}
        {user && (
          <>
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">
                {t.settings.migration}
              </h2>
              <div className="text-sm text-muted-foreground">
                {t.settings.migrationDesc}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleMigrateRequest}
                disabled={migrating}
                data-testid="settings-migrate-button"
              >
                {migrating ? t.settings.migrating : t.settings.migrateLocalData}
              </Button>
            </section>
            <Separator />
          </>
        )}

        {/* Import/Export */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">
            {t.settings.importExport}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportJSON}
              data-testid="settings-export-json"
            >
              {t.settings.exportJSON}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              data-testid="settings-export-csv"
            >
              {t.settings.exportCSV}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
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

        <Separator />

        {/* About */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">{t.settings.about}</h2>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t.settings.developer}</span>
              <a
                href="https://github.com/JunjaK"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                JunjaK
                <ExternalLink className="size-3" />
              </a>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t.settings.sourceCode}</span>
              <a
                href="https://github.com/JunjaK/nihongo-vocabook"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                GitHub
                <ExternalLink className="size-3" />
              </a>
            </div>
          </div>

          <Link
            href="/settings/licenses"
            className="flex items-center justify-between rounded-lg border p-3 active:bg-accent/50"
          >
            <span className="text-sm">{t.settings.openSource}</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>

          <div className="pt-1 text-center text-xs text-muted-foreground/60">
            v0.1.0
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={showMigrateConfirm}
        icon={<ArrowRightLeft />}
        title={t.settings.migration}
        description={t.auth.migrationPrompt(migrateCount)}
        confirmLabel={t.settings.migrateLocalData}
        onConfirm={handleMigrateConfirm}
        onCancel={() => setShowMigrateConfirm(false)}
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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
