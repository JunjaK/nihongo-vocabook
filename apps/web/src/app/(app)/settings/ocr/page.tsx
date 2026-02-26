'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import {
  getLocalOcrMode,
  setLocalOcrMode,
  fetchOcrSettings,
  saveOcrSettings,
  type OcrMode,
  type LlmProvider,
} from '@/lib/ocr/settings';

const PROVIDERS: { value: LlmProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Gemini' },
];

export default function OcrSettingsPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [mode, setMode] = useState<OcrMode>('ocr');
  const [provider, setProvider] = useState<LlmProvider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMode(getLocalOcrMode());

    if (!user) {
      setLoading(false);
      return;
    }

    fetchOcrSettings()
      .then((settings) => {
        setProvider(settings.llmProvider);
        setApiKey(settings.apiKey);
      })
      .catch(() => {
        // Use defaults on error
      })
      .finally(() => setLoading(false));
  }, [user]);

  const handleModeChange = (newMode: OcrMode) => {
    setMode(newMode);
    setLocalOcrMode(newMode);
  };

  const handleProviderChange = (newProvider: LlmProvider) => {
    setProvider(newProvider);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveOcrSettings({ llmProvider: provider, apiKey: apiKey || undefined });
      toast.success(t.settings.apiKeySaved);
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Header title={t.settings.ocrSettings} showBack />
      <div className="animate-page space-y-6 p-4">
        {/* Mode selector */}
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t.settings.ocrMode}
          </h2>
          <div className="flex gap-2">
            {([
              { value: 'ocr' as const, label: t.settings.ocrFree },
              { value: 'llm' as const, label: t.settings.llmVision },
              { value: 'hybrid' as const, label: t.settings.llmHybrid },
            ]).map((opt) => (
              <Button
                key={opt.value}
                variant={mode === opt.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleModeChange(opt.value)}
                data-testid={`ocr-mode-${opt.value}`}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </section>

        {(mode === 'llm' || mode === 'hybrid') && user && !loading && (
          <>
            <Separator />

            {/* Provider selector */}
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                {t.settings.llmProvider}
              </h2>
              <div className="flex gap-2">
                {PROVIDERS.map((opt) => (
                  <Button
                    key={opt.value}
                    variant={provider === opt.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleProviderChange(opt.value)}
                    data-testid={`ocr-provider-${opt.value}`}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </section>

            <Separator />

            {/* API key */}
            <section className="space-y-2">
              <Label htmlFor="api-key">{t.settings.apiKey}</Label>
              <div className="flex gap-2">
                <Input
                  id="api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t.settings.apiKeyPlaceholder}
                  data-testid="ocr-api-key-input"
                />
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                  data-testid="ocr-api-key-save"
                >
                  {saving ? t.common.saving : t.common.save}
                </Button>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}
