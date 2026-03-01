import { parseRuby } from '@/lib/ruby';
import { cn } from '@/lib/utils';

interface RubyTextProps {
  term: string;
  reading: string;
  className?: string;
}

export function RubyText({ term, reading, className }: RubyTextProps) {
  const segments = parseRuby(term, reading);

  return (
    <span className={cn('ruby-text', className)}>
      {segments.map((seg, i) =>
        seg.type === 'ruby' ? (
          <ruby key={i}>
            {seg.base}
            <rt>{seg.annotation}</rt>
          </ruby>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}
