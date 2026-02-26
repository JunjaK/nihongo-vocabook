'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Camera } from '@/components/ui/icons';
import { Header } from '@/components/layout/header';
import { ImageCapture, type ImageCaptureHandle } from '@/components/scan/image-capture';
import { WordPreview } from '@/components/scan/word-preview';
import { ScanComplete } from '@/components/scan/scan-complete';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import { invalidateListCache } from '@/lib/list-cache';
import { useAuthStore } from '@/stores/auth-store';
import { useScanStore } from '@/stores/scan-store';
import { useBottomNavLock } from '@/hooks/use-bottom-nav-lock';
import { getLocalOcrMode, fetchOcrSettings } from '@/lib/ocr/settings';
import { fetchProfile } from '@/lib/profile/fetch';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';
import Link from 'next/link';

export default function ScanPage() {
  const router = useRouter();
  const repo = useRepository();
  const { t, locale } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const imageCaptureRef = useRef<ImageCaptureHandle>(null);

  // Scan store state
  const status = useScanStore((s) => s.status);
  const capturedImages = useScanStore((s) => s.capturedImages);
  const enrichedWords = useScanStore((s) => s.enrichedWords);
  const enrichProgress = useScanStore((s) => s.enrichProgress);
  const addedCount = useScanStore((s) => s.addedCount);
  const startExtraction = useScanStore((s) => s.startExtraction);
  const setDone = useScanStore((s) => s.setDone);
  const reset = useScanStore((s) => s.reset);

  // User JLPT level for filtering
  const [userJlptLevel, setUserJlptLevel] = useState<number | null>(null);
  // Terms already in user's word list
  const [existingTerms, setExistingTerms] = useState<Set<string>>(new Set());

  // Guard: LLM mode needs API key configured on server
  const mode = getLocalOcrMode();
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [guardLoading, setGuardLoading] = useState(mode === 'llm' || mode === 'hybrid');
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  const isExtracting = status === 'extracting';
  const isEnriching = status === 'enriching';
  useBottomNavLock(isExtracting || isEnriching);

  useEffect(() => {
    if ((mode !== 'llm' && mode !== 'hybrid') || !user) {
      setGuardLoading(false);
      return;
    }

    fetchOcrSettings()
      .then((settings) => {
        setNeedsApiKey(!settings.hasApiKey);
      })
      .catch(() => {
        setNeedsApiKey(true);
      })
      .finally(() => setGuardLoading(false));
  }, [mode, user]);

  useEffect(() => {
    if (!user) return;
    fetchProfile()
      .then((p) => setUserJlptLevel(p.jlptLevel))
      .catch(() => {});
  }, [user]);

  // Check existing terms when preview starts
  useEffect(() => {
    if (status !== 'preview' || enrichedWords.length === 0) return;
    repo.words
      .getExistingTerms(enrichedWords.map((w) => w.term))
      .then(setExistingTerms)
      .catch(() => setExistingTerms(new Set()));
  }, [status, enrichedWords, repo]);

  const handleExtract = async (imageDataUrls: string[]) => {
    try {
      await startExtraction(imageDataUrls, locale, {
        resolveExistingTerms: (terms) => repo.words.getExistingTerms(terms),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Extraction failed';
      toast.error(message === 'API_KEY_REQUIRED' ? t.scan.apiKeyRequired : message);
    }
  };

  const handleBulkAdd = async (words: ExtractedWord[]) => {
    let count = 0;
    for (const word of words) {
      try {
        await repo.words.create({
          term: word.term,
          reading: word.reading,
          meaning: word.meaning,
          jlptLevel: word.jlptLevel,
          priority: 2,
        });
        count++;
      } catch (err) {
        if (err instanceof Error && err.message === 'DUPLICATE_WORD') {
          // Skip duplicates silently
        } else {
          throw err;
        }
      }
    }
    if (count > 0) invalidateListCache('words');
    setDone(count);
    toast.success(t.scan.wordsAdded(count));
  };

  const handleEditAndAdd = (words: ExtractedWord[]) => {
    sessionStorage.setItem('scan-edit-words', JSON.stringify(words));
    router.push('/words/create-by-image');
  };

  const handleReset = () => {
    reset();
  };

  const handleCancelExtract = () => {
    reset();
  };

  const handleBackgroundExtract = () => {
    router.push('/words');
  };

  // Derive the visual step from store status
  const isInProgress = isExtracting || isEnriching;
  const step = status === 'idle' ? 'capture' : status;
  const isPreviewStep = step === 'preview';
  const needsLeaveConfirm = isPreviewStep || (step as string) === 'confirm';

  const handleHeaderBack = () => {
    if (needsLeaveConfirm) {
      setLeaveConfirmOpen(true);
      return;
    }
    router.back();
  };

  const handleConfirmLeave = () => {
    setLeaveConfirmOpen(false);
    reset();
    router.push('/words');
  };

  return (
    <>
      <Header
        title={t.scan.title}
        showBack
        onBack={handleHeaderBack}
        allowBackWhenLocked={isPreviewStep}
        actions={
          step === 'capture' && !guardLoading && !needsApiKey ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t.scan.takePhoto}
              onClick={() => imageCaptureRef.current?.openCamera()}
            >
              <Camera className="size-5" />
            </Button>
          ) : undefined
        }
      />

      {guardLoading ? (
        <div className="animate-page p-4 text-center text-sm text-muted-foreground">
          {t.common.loading}
        </div>
      ) : needsApiKey && step === 'capture' ? (
        <div className="animate-page space-y-4 p-4 text-center">
          <div className="py-8 text-sm text-muted-foreground">
            {t.settings.configureRequired}
          </div>
          <Link href="/settings/ocr">
            <Button variant="outline">{t.settings.goToSettings}</Button>
          </Link>
        </div>
      ) : isInProgress ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Image thumbnails */}
          {capturedImages.length > 0 && (
            <div className="flex gap-2 overflow-x-auto px-4 pt-4">
              {capturedImages.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt={`Captured ${i + 1}`}
                  className="h-20 w-20 shrink-0 rounded-lg border object-cover"
                />
              ))}
            </div>
          )}
          {/* Centered status */}
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
            <LoadingSpinner className="size-8" />
            <div className="text-sm text-muted-foreground">
              {isEnriching ? t.scan.enrichingWords : t.scan.extracting}
            </div>
            {isEnriching && enrichProgress.total > 1 && (
              <div className="w-full max-w-xs space-y-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                    style={{
                      width: `${(enrichProgress.current / enrichProgress.total) * 100}%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="tabular-nums text-muted-foreground">
                    {enrichProgress.current} / {enrichProgress.total}
                  </span>
                  <span className="tabular-nums font-medium text-foreground">
                    {Math.round((enrichProgress.current / enrichProgress.total) * 100)}%
                  </span>
                </div>
              </div>
            )}
          </div>
          {/* Bottom actions */}
          <div className="sticky bottom-0 bg-background px-4 pb-6 pt-2">
            <div className="mb-3 h-px bg-border" />
            <div className="flex gap-2">
              <Button className="flex-1" variant="outline" onClick={handleCancelExtract}>
                {t.common.cancel}
              </Button>
              <Button className="flex-1" onClick={handleBackgroundExtract}>
                {t.scan.continueInBackground}
              </Button>
            </div>
          </div>
        </div>
      ) : step === 'capture' ? (
        <ImageCapture
          ref={imageCaptureRef}
          onExtract={handleExtract}
        />
      ) : step === 'preview' ? (
        <WordPreview
          words={enrichedWords}
          userJlptLevel={userJlptLevel}
          existingTerms={existingTerms}
          onConfirm={handleBulkAdd}
          onEditAndAdd={handleEditAndAdd}
          onRetry={handleReset}
        />
      ) : step === 'done' ? (
        <ScanComplete addedCount={addedCount} onAddMore={handleReset} />
      ) : null}

      <AlertDialog open={leaveConfirmOpen} onOpenChange={setLeaveConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.common.unsavedChangesTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.common.unsavedChangesDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmLeave}>
              {t.common.leave}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
