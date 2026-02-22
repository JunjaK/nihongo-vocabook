'use client';

import { useState, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from '@/lib/i18n';

interface WordbookFormValues {
  name: string;
  description: string | null;
  isShared?: boolean;
  tags?: string[];
}

interface WordbookFormProps {
  initialValues?: { name: string; description: string | null; isShared?: boolean; tags?: string[] };
  onSubmit: (values: WordbookFormValues) => Promise<void>;
  submitLabel: string;
  showShareToggle?: boolean;
}

export function WordbookForm({ initialValues, onSubmit, submitLabel, showShareToggle }: WordbookFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialValues?.name ?? '');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [isShared, setIsShared] = useState(initialValues?.isShared ?? false);
  const [tags, setTags] = useState<string[]>(initialValues?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const addTag = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setTagInput('');
  };

  const removeTag = (index: number) => {
    setTags((prev) => prev.filter((_, i) => i !== index));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (tagInput.trim()) addTag(tagInput);
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const finalTags = tagInput.trim()
        ? [...tags, tagInput.trim()].filter((v, i, arr) => arr.indexOf(v) === i)
        : tags;
      await onSubmit({
        name: name.trim(),
        description: description.trim() || null,
        tags: finalTags,
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
        <div className="space-y-2">
          <Label>{t.wordbooks.tags}</Label>
          <div
            className="border-input focus-within:border-ring focus-within:ring-ring/50 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border px-3 py-1.5 focus-within:ring-[3px]"
            onClick={() => tagInputRef.current?.focus()}
          >
            {tags.map((tag, i) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              >
                {tag}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeTag(i); }}
                  className="rounded-sm text-primary/60 hover:text-primary"
                  data-testid={`wordbook-tag-remove-${i}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              ref={tagInputRef}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={() => { if (tagInput.trim()) addTag(tagInput); }}
              placeholder={tags.length === 0 ? t.wordbooks.tagsPlaceholder : ''}
              className="min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              data-testid="wordbook-tags-input"
            />
          </div>
        </div>
        {showShareToggle && (
          <div className="flex items-center gap-3">
            <Switch
              id="wordbook-shared"
              checked={isShared}
              onCheckedChange={setIsShared}
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
