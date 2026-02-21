'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/lib/i18n';

interface WordbookFormValues {
  name: string;
  description: string | null;
  isShared?: boolean;
}

interface WordbookFormProps {
  initialValues?: { name: string; description: string | null; isShared?: boolean };
  onSubmit: (values: WordbookFormValues) => Promise<void>;
  submitLabel: string;
  showShareToggle?: boolean;
}

export function WordbookForm({ initialValues, onSubmit, submitLabel, showShareToggle }: WordbookFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialValues?.name ?? '');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [isShared, setIsShared] = useState(initialValues?.isShared ?? false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || null,
        ...(showShareToggle ? { isShared } : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="space-y-2">
          <Label htmlFor="wordbook-name">{t.wordbooks.name}</Label>
          <Input
            id="wordbook-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.wordbooks.namePlaceholder}
            required
            data-testid="wordbook-name-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wordbook-description">{t.wordbooks.description}</Label>
          <Input
            id="wordbook-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.wordbooks.descriptionPlaceholder}
            data-testid="wordbook-description-input"
          />
        </div>
        {showShareToggle && (
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="wordbook-shared"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
              data-testid="wordbook-share-toggle"
            />
            <Label htmlFor="wordbook-shared" className="cursor-pointer">
              {t.wordbooks.shareToggle}
            </Label>
          </div>
        )}
      </div>

      <div className="shrink-0 bg-background px-4 pb-3">
        <div className="mb-3 h-px bg-border" />
        <Button
          type="submit"
          className="w-full"
          disabled={saving || !name.trim()}
          data-testid="wordbook-form-submit"
        >
          {saving ? t.common.saving : submitLabel}
        </Button>
      </div>
    </form>
  );
}
