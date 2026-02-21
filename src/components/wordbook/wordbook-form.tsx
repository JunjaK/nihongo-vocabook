'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/lib/i18n';

interface WordbookFormProps {
  initialValues?: { name: string; description: string | null };
  onSubmit: (values: { name: string; description: string | null }) => Promise<void>;
  submitLabel: string;
}

export function WordbookForm({ initialValues, onSubmit, submitLabel }: WordbookFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialValues?.name ?? '');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
      <Button type="submit" className="w-full" disabled={saving || !name.trim()}>
        {saving ? t.common.saving : submitLabel}
      </Button>
    </form>
  );
}
