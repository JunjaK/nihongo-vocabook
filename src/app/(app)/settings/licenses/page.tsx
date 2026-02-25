'use client';

import { ExternalLink } from '@/components/ui/icons';
import { Header } from '@/components/layout/header';
import { useTranslation } from '@/lib/i18n';

const OPEN_SOURCE_LIBS = [
  { name: 'Next.js', url: 'https://github.com/vercel/next.js', license: 'MIT', description: 'React framework for production' },
  { name: 'React', url: 'https://github.com/facebook/react', license: 'MIT', description: 'UI component library' },
  { name: 'Tailwind CSS', url: 'https://github.com/tailwindlabs/tailwindcss', license: 'MIT', description: 'Utility-first CSS framework' },
  { name: 'Radix UI', url: 'https://github.com/radix-ui/primitives', license: 'MIT', description: 'Unstyled accessible UI primitives' },
  { name: 'Supabase', url: 'https://github.com/supabase/supabase', license: 'Apache-2.0', description: 'Open source Firebase alternative' },
  { name: 'Zustand', url: 'https://github.com/pmndrs/zustand', license: 'MIT', description: 'Lightweight state management' },
  { name: 'TanStack Virtual', url: 'https://github.com/TanStack/virtual', license: 'MIT', description: 'Headless virtual scrolling' },
  { name: 'Dexie.js', url: 'https://github.com/dexie/Dexie.js', license: 'Apache-2.0', description: 'IndexedDB wrapper' },
  { name: 'Tesseract.js', url: 'https://github.com/naptha/tesseract.js', license: 'Apache-2.0', description: 'OCR engine for the browser' },
  { name: 'Tabler Icons', url: 'https://github.com/tabler/tabler-icons', license: 'MIT', description: 'Icon library' },
  { name: 'shadcn/ui', url: 'https://github.com/shadcn-ui/ui', license: 'MIT', description: 'Beautifully designed components' },
  { name: 'Sonner', url: 'https://github.com/emilkowalski/sonner', license: 'MIT', description: 'Toast notification library' },
  { name: 'WanaKana', url: 'https://github.com/WaniKani/WanaKana', license: 'MIT', description: 'Japanese input helper' },
];

export default function LicensesPage() {
  const { t } = useTranslation();

  return (
    <>
      <Header title={t.settings.openSource} showBack />
      <div className="animate-page flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {OPEN_SOURCE_LIBS.map((lib, i) => (
            <a
              key={lib.name}
              href={lib.url}
              target="_blank"
              rel="noopener noreferrer"
              className="animate-stagger flex items-center justify-between rounded-lg border p-3 active:bg-accent/50"
              style={{ '--stagger': Math.min(i, 15) } as React.CSSProperties}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{lib.name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {lib.license}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {lib.description}
                </div>
              </div>
              <ExternalLink className="ml-3 size-4 shrink-0 text-muted-foreground" />
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
