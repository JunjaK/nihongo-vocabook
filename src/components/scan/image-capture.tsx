'use client';

import { useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { ImagePlus, X } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useTranslation } from '@/lib/i18n';
import { bottomBar, bottomSep } from '@/lib/styles';
import { normalizeImage } from '@/lib/image/normalize';

interface ImageCaptureProps {
  onExtract: (imageDataUrls: string[]) => void;
  extracting: boolean;
  onCancelExtract?: () => void;
  onBackgroundExtract?: () => void;
}

export interface ImageCaptureHandle {
  openCamera: () => void;
}

interface ImageEntry {
  key: string;
  dataUrl: string;
}

function fileKey(file: File): string {
  return `${file.name}|${file.size}|${file.type}`;
}

export const ImageCapture = forwardRef<ImageCaptureHandle, ImageCaptureProps>(
  function ImageCapture({ onExtract, extracting, onCancelExtract, onBackgroundExtract }, ref) {
    const { t } = useTranslation();
    const cameraRef = useRef<HTMLInputElement>(null);
    const galleryRef = useRef<HTMLInputElement>(null);
    const [images, setImages] = useState<ImageEntry[]>([]);
    const [converting, setConverting] = useState(false);
    const [convertProgress, setConvertProgress] = useState({ current: 0, total: 0 });
    const convertCancelRef = useRef(false);

    useImperativeHandle(ref, () => ({
      openCamera: () => cameraRef.current?.click(),
    }));

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const fileList = Array.from(files);
      e.target.value = '';

      convertCancelRef.current = false;
      setConverting(true);
      setConvertProgress({ current: 0, total: fileList.length });

      try {
        const results: ImageEntry[] = [];
        for (let i = 0; i < fileList.length; i++) {
          if (convertCancelRef.current) return;
          const file = fileList[i];
          const key = fileKey(file);
          const dataUrl = await normalizeImage(file);
          results.push({ key, dataUrl });
          setConvertProgress({ current: i + 1, total: fileList.length });
        }

        if (!convertCancelRef.current) {
          setImages((prev) => {
            const existing = new Set(prev.map((img) => img.key));
            const newEntries = results.filter((r) => !existing.has(r.key));
            return newEntries.length > 0 ? [...prev, ...newEntries] : prev;
          });
        }
      } finally {
        setConverting(false);
      }
    };

    const handleCancelConvert = () => {
      convertCancelRef.current = true;
    };

    const removeImage = (index: number) => {
      setImages((prev) => prev.filter((_, i) => i !== index));
    };

    const handleExtract = () => {
      if (images.length > 0) onExtract(images.map((img) => img.dataUrl));
    };

    return (
      <div className="animate-page relative flex min-h-0 flex-1 flex-col">
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Scrollable image area — fills remaining space */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
          {images.length === 0 && !converting ? (
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              disabled={extracting}
              className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
              data-testid="scan-choose-gallery"
            >
              <ImagePlus className="size-10" />
              <span className="text-sm">{t.scan.chooseFromGallery}</span>
            </button>
          ) : images.length === 0 ? (
            <div className="flex-1" />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {images.map((img, i) => (
                <div key={img.key} className="relative overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.dataUrl}
                    alt={`Selected ${i + 1}`}
                    className="h-40 w-full object-cover"
                  />
                  {!extracting && (
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white transition-colors hover:bg-black/80"
                      data-testid={`scan-remove-image-${i}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => galleryRef.current?.click()}
                disabled={extracting || converting}
                className="flex h-40 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
              >
                <ImagePlus className="size-6" />
                <span className="text-xs">{t.common.add}</span>
              </button>
            </div>
          )}
        </div>

        <div className={bottomBar}>
          <div className={bottomSep} />
          <Button
            className="w-full"
            onClick={handleExtract}
            disabled={images.length === 0 || extracting || converting}
            data-testid="scan-extract-button"
          >
            {t.scan.extract}
          </Button>
        </div>

        {(extracting || converting) && (
          <div className="absolute inset-0 z-10 flex flex-col bg-background/60 backdrop-blur-[1px]">
            {/* Centered content */}
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-sm">
              <LoadingSpinner className="size-8" />
              <span>{converting ? t.scan.convertingImage : t.scan.extracting}</span>
              {converting && convertProgress.total > 1 && (
                <div className="w-full max-w-xs space-y-1.5 px-6">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                      style={{
                        width: `${(convertProgress.current / convertProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="tabular-nums text-muted-foreground">
                      {convertProgress.current} / {convertProgress.total}
                    </span>
                    <span className="tabular-nums font-medium">
                      {Math.round((convertProgress.current / convertProgress.total) * 100)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
            {/* Bottom actions */}
            <div className="bg-background px-4 pb-6 pt-2">
              <div className="mb-3 h-px bg-border" />
              <div className="flex gap-2">
                {converting && (
                  <Button className="flex-1" variant="outline" onClick={handleCancelConvert}>
                    {t.common.cancel}
                  </Button>
                )}
                {extracting && onCancelExtract && (
                  <Button className="flex-1" variant="outline" onClick={onCancelExtract}>
                    {t.common.cancel}
                  </Button>
                )}
                {extracting && onBackgroundExtract && (
                  <Button className="flex-1" onClick={onBackgroundExtract}>
                    {t.scan.continueInBackground}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);
