'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';

interface ImageCaptureProps {
  onExtract: (imageDataUrl: string) => void;
  extracting: boolean;
}

export function ImageCapture({ onExtract, extracting }: ImageCaptureProps) {
  const { t } = useTranslation();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleExtract = () => {
    if (preview) onExtract(preview);
  };

  return (
    <div className="animate-page space-y-4 p-4">
      <h2 className="text-lg font-semibold">{t.scan.captureTitle}</h2>

      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => cameraRef.current?.click()}
          disabled={extracting}
          data-testid="scan-take-photo"
        >
          {t.scan.takePhoto}
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => galleryRef.current?.click()}
          disabled={extracting}
          data-testid="scan-choose-gallery"
        >
          {t.scan.chooseFromGallery}
        </Button>
      </div>

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
        onChange={handleFileSelect}
        className="hidden"
      />

      {preview && (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Selected"
              className="max-h-64 w-full object-contain"
            />
          </div>
        </div>
      )}

      {/* Extract button — fixed bottom */}
      {preview && (
        <div className="shrink-0 pt-2">
          <Button
            className="w-full"
            onClick={handleExtract}
            disabled={extracting}
            data-testid="scan-extract-button"
          >
            {extracting ? t.scan.extracting : t.scan.extract}
          </Button>
        </div>
      )}
    </div>
  );
}
