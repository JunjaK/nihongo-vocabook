'use client';

import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
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
import { ModelDownloadModal } from '@/components/ai/model-download-modal';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { bottomBar, bottomSep } from '@/lib/styles';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import { invalidateListCache } from '@/lib/list-cache';
import { useAuthStore } from '@/stores/auth-store';
import { useScanStore } from '@/stores/scan-store';
import { useBottomNavLock } from '@/hooks/use-bottom-nav-lock';
import {
  getModelStatus,
  isDownloadPromptDismissed,
  subscribeModelStatus,
} from '@/lib/ai/model-manager';
import { ensureGemmaReady } from '@/lib/ai/gemma-web';
import { getAiBlockedKey } from '@/lib/ai/runtime-gate';
import { fetchProfile } from '@/lib/profile/fetch';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';
import Link from 'next/link';

export default function ScanPage() {
  const router = useRouter();
  const repo = useRepository();
  const { t, locale } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const imageCaptureRef = useRef<ImageCaptureHandle>(null);

  const status = useScanStore((s) => s.status);
  const capturedImages = useScanStore((s) => s.capturedImages);
  const enrichedWords = useScanStore((s) => s.enrichedWords);
  const enrichProgress = useScanStore((s) => s.enrichProgress);
  const addedCount = useScanStore((s) => s.addedCount);
  const startExtraction = useScanStore((s) => s.startExtraction);
  const setDone = useScanStore((s) => s.setDone);
  const reset = useScanStore((s) => s.reset);

  const [userJlptLevel, setUserJlptLevel] = useState<number | null>(null);
  const [existingTerms, setExistingTerms] = useState<Set<string>>(new Set());
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [modelPromptOpen, setModelPromptOpen] = useState(false);
  const [blockedKey, setBlockedKey] = useState<string | null>(null);
  const autoPromptCheckedRef = useRef(false);

  // Runtime-gate check after mount (window-based detection isn't SSR-safe).
  // Mobile-browser + PWA can't run AI inference, so we render an explanation
  // instead of the camera UI to avoid letting the user start a flow that
  // can't complete.
  useEffect(() => {
    setBlockedKey(getAiBlockedKey());
  }, []);

  const modelStatusState = useSyncExternalStore(
    subscribeModelStatus,
    getModelStatus,
    () => ({ state: 'not_installed' as const }),
  );

  const isExtracting = status === 'extracting';
  const isEnriching = status === 'enriching';
  useBottomNavLock(isExtracting || isEnriching);

  useEffect(() => {
    // Auto-open the modal when (a) the user lands here without the model and
    // hasn't already dismissed the prompt, OR (b) a download/error is live —
    // so navigating back to /words/scan during download always shows progress.
    if (modelStatusState.state === 'downloading' || modelStatusState.state === 'error') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModelPromptOpen(true);
      autoPromptCheckedRef.current = true;
      return;
    }
    if (autoPromptCheckedRef.current) return;
    autoPromptCheckedRef.current = true;
    if (modelStatusState.state === 'not_installed' && !isDownloadPromptDismissed()) {
      setModelPromptOpen(true);
    }
  }, [modelStatusState.state]);

  useEffect(() => {
    if (modelStatusState.state !== 'installed' || !modelPromptOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModelPromptOpen(false);
    toast.success(t.aiModel.downloadComplete);
  }, [modelStatusState.state, modelPromptOpen, t.aiModel.downloadComplete]);

  useEffect(() => {
    if (!user) return;
    fetchProfile()
      .then((p) => setUserJlptLevel(p.jlptLevel))
      .catch(() => {});
  }, [user]);

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
      toast.error(message);
    }
  };

  const handleBulkAdd = async (words: ExtractedWord[]) => {
    let count = 0;
    let skipped = 0;
    for (const word of words) {
      if (!word.dictionaryEntryId) {
        skipped++;
        continue;
      }
      try {
        await repo.words.create({
          dictionaryEntryId: word.dictionaryEntryId,
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
    if (skipped > 0) {
      toast.warning(`${skipped} ${skipped === 1 ? 'word' : 'words'} skipped (no dictionary match).`);
    }
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

  const handleStartModelDownload = () => {
    ensureGemmaReady().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : t.aiModel.downloadFailed;
      toast.error(message);
    });
  };

  const handleModelPromptOpenChange = (open: boolean) => {
    setModelPromptOpen(open);
  };

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

  if (!user) {
    return (
      <>
        <Header title={t.scan.title} showBack onBack={() => router.back()} />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t.wordForm.loginRequiredTranslatedMeaning}
          </p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {t.auth.signIn}
          </Link>
        </div>
      </>
    );
  }

  // Mobile browser / PWA — block before the camera UI so the user doesn't
  // capture an image only to find inference can't run.
  if (blockedKey) {
    const table = t.aiModel as unknown as Record<string, string | undefined>;
    const blockedMessage = table[blockedKey] ?? blockedKey;
    return (
      <>
        <Header title={t.scan.title} showBack onBack={() => router.back()} />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            {blockedMessage}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title={t.scan.title}
        showBack
        onBack={handleHeaderBack}
        allowBackWhenLocked={isPreviewStep}
        actions={
          step === 'capture' ? (
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

      {isInProgress ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-3">
            {capturedImages.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {capturedImages.map((src, i) => (
                  <div key={i} className="relative overflow-hidden rounded-lg border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`Captured ${i + 1}`}
                      className="h-40 w-full object-cover"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="absolute inset-0 z-10 flex flex-col bg-background/60 backdrop-blur-[1px]">
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
            <div className={bottomBar}>
              <div className={bottomSep} />
              <div className="flex gap-3">
                <Button className="flex-1" variant="outline" onClick={handleCancelExtract}>
                  {t.common.cancel}
                </Button>
                <Button className="flex-1" onClick={handleBackgroundExtract}>
                  {t.scan.continueInBackground}
                </Button>
              </div>
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

      <ModelDownloadModal
        open={modelPromptOpen}
        onOpenChange={handleModelPromptOpenChange}
        onConfirmDownload={handleStartModelDownload}
      />

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
