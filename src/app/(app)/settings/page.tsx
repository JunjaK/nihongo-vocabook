'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAuthStore } from '@/stores/auth-store';
import { useRepository } from '@/lib/repository/provider';
import { createClient } from '@/lib/supabase/client';
import {
  getLocalWordCount,
  migrateToSupabase,
} from '@/lib/migration/migrate-to-supabase';
import { useTranslation, type Locale } from '@/lib/i18n';
import type { ImportData } from '@/types/word';

export default function SettingsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const repo = useRepository();
  const { t, locale, setLocale } = useTranslation();
  const { theme, setTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [migrating, setMigrating] = useState(false);

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

  const handleMigrate = async () => {
    const count = await getLocalWordCount();
    if (count === 0) {
      toast.info(t.settings.noLocalData);
      return;
    }

    const confirmed = window.confirm(
      t.auth.migrationPrompt(count),
    );
    if (!confirmed) return;

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
      <div className="space-y-6 p-4">
        {/* Account */}
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t.settings.account}</h2>
          {user ? (
            <div className="space-y-2">
              <div className="text-sm">
                {t.settings.signedInAs(user.email ?? '')}
              </div>
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
          <h2 className="text-sm font-medium text-muted-foreground">{t.settings.language}</h2>
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
          <h2 className="text-sm font-medium text-muted-foreground">{t.settings.theme}</h2>
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

        {/* Data Migration */}
        {user && (
          <>
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                {t.settings.migration}
              </h2>
              <div className="text-sm text-muted-foreground">
                {t.settings.migrationDesc}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleMigrate}
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
          <h2 className="text-sm font-medium text-muted-foreground">
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
      </div>
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
