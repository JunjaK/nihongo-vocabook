'use client';

import { useTranslation } from '@/lib/i18n';
import type { Kanji } from '@/types/kanji';
import { sectionLabel, textKanji, textCaption } from '@/lib/styles';

interface KanjiCardContentProps {
  character: string;
  data: Kanji | null | undefined;
  loading: boolean;
}

export function KanjiCardContent({ character, data, loading }: KanjiCardContentProps) {
  const { t, locale } = useTranslation();

  const onReadings = data?.readings.filter((r) => r.type === 'on') ?? [];
  const kunReadings = data?.readings.filter((r) => r.type === 'kun') ?? [];

  function renderMeanings(meanings: string[], meaningsKo?: string[]): string {
    const primary = locale === 'ko' && meaningsKo && meaningsKo.length > 0 ? meaningsKo : meanings;
    return primary.join(', ');
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <div className={textKanji}>{character}</div>
        {data && (data.jlptLevel || data.strokeCount) && (
          <div className={`${textCaption} text-text-tertiary`}>
            {data.jlptLevel ? `JLPT N${data.jlptLevel}` : ''}
            {data.jlptLevel && data.strokeCount ? ' · ' : ''}
            {data.strokeCount ? t.kanji.strokes(data.strokeCount) : ''}
          </div>
        )}
      </div>

      {loading && <div className={`${textCaption} text-text-tertiary`}>{t.kanji.loading}</div>}

      {!loading && !data && (
        <div className={`${textCaption} text-text-tertiary`}>{t.kanji.noData}</div>
      )}

      {data && onReadings.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className={sectionLabel}>{t.kanji.onReading}</div>
          <ul className="flex flex-col gap-1">
            {onReadings.map((r) => (
              <li key={`on-${r.reading}`} className="flex flex-wrap items-baseline gap-2">
                <span className="font-ja text-body font-medium">{r.reading}</span>
                <span className={`${textCaption} text-text-secondary`}>
                  {renderMeanings(r.meanings, r.meaningsKo)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && kunReadings.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className={sectionLabel}>{t.kanji.kunReading}</div>
          <ul className="flex flex-col gap-1">
            {kunReadings.map((r) => (
              <li key={`kun-${r.reading}`} className="flex flex-wrap items-baseline gap-2">
                <span className="font-ja text-body font-medium">{r.reading}</span>
                <span className={`${textCaption} text-text-secondary`}>
                  {renderMeanings(r.meanings, r.meaningsKo)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
