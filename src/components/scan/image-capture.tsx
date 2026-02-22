'use client';

import { useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';

interface ImageCaptureProps {
  onExtract: (imageDataUrls: string[]) => void;
  extracting: boolean;
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
  function ImageCapture({ onExtract, extracting }, ref) {
    const { t } = useTranslation();
    const cameraRef = useRef<HTMLInputElement>(null);
    const galleryRef = useRef<HTMLInputElement>(null);
    const [images, setImages] = useState<ImageEntry[]>([]);

    useImperativeHandle(ref, () => ({
      openCamera: () => cameraRef.current?.click(),
    }));

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      Array.from(files).forEach((file) => {
        const key = fileKey(file);

        const reader = new FileReader();
        reader.onload = () => {
          setImages((prev) => {
            if (prev.some((img) => img.key === key)) return prev;
            return [...prev, { key, dataUrl: reader.result as string }];
          });
        };
        reader.readAsDataURL(file);
      });

      e.target.value = '';
    };

    const removeImage = (index: number) => {
      setImages((prev) => prev.filter((_, i) => i !== index));
    };

    const handleExtract = () => {
      if (images.length > 0) onExtract(images.map((img) => img.dataUrl));
    };

    return (
      <div className="animate-page flex min-h-0 flex-1 flex-col">
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
          {images.length === 0 ? (
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
                disabled={extracting}
                className="flex h-40 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
              >
                <ImagePlus className="size-6" />
                <span className="text-xs">{t.common.add}</span>
              </button>
            </div>
          )}
        </div>

        <div className="shrink-0 bg-background px-4 pb-3">
          <div className="mb-3 h-px bg-border" />
          <Button
            className="w-full"
            onClick={handleExtract}
            disabled={images.length === 0 || extracting}
            data-testid="scan-extract-button"
          >
            {extracting ? t.scan.extracting : t.scan.extract}
          </Button>
        </div>
      </div>
    );
  },
);
