import Image from 'next/image';
import Link from 'next/link';
import { BookOpen, Brain, Camera, Share2, Sparkles } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { btnCta } from '@/lib/styles';
import { cn } from '@/lib/utils';

const FEATURES = [
  { Icon: BookOpen, text: 'Jisho 사전으로 일본어 단어 검색 및 저장' },
  { Icon: Brain, text: 'FSRS 간격반복 플래시카드로 복습' },
  { Icon: Camera, text: '이미지에서 OCR/AI로 단어 자동 추출' },
  { Icon: Sparkles, text: '기기 내 LLM으로 단어 풀이·예문 생성' },
  { Icon: Share2, text: '단어장 공유 기능' },
] as const;

const BASE_URL = 'https://nivoca.jun-devlog.win';

const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${BASE_URL}/#website`,
      url: BASE_URL,
      name: 'NiVoca',
      inLanguage: 'ko-KR',
      description: 'JLPT N5~N1 일본어 단어장. 간격 반복(SRS) 퀴즈, 이미지 OCR 단어 추출, 기기 내 AI 어시스턴트, 단어장 공유.',
      publisher: { '@id': `${BASE_URL}/#org` },
    },
    {
      '@type': 'Organization',
      '@id': `${BASE_URL}/#org`,
      name: 'NiVoca',
      url: BASE_URL,
      logo: `${BASE_URL}/logo.png`,
    },
    {
      '@type': 'WebApplication',
      '@id': `${BASE_URL}/#app`,
      name: 'NiVoca',
      url: BASE_URL,
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'Web, iOS, Android',
      description:
        'JLPT N5부터 N1까지 일본어 단어를 SRS 간격 반복 퀴즈로 학습하고, 이미지 OCR로 단어를 자동 추출하며, 기기 내 LLM 어시스턴트로 단어 풀이·예문을 받고, 단어장을 공유할 수 있는 PWA.',
      inLanguage: 'ko-KR',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' },
    },
  ],
};

export default function LandingPage() {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-hidden px-8">
      {/* Structured data — static JSON, no user input. React text-escapes children
          which is safe for this JSON payload (no <, >, & in values). */}
      <script type="application/ld+json">{JSON.stringify(JSON_LD)}</script>

      {/* Top spacer */}
      <div className="h-20 shrink-0" />

      {/* Hero */}
      <header className="animate-fade-in flex w-full flex-col items-center gap-4 text-center">
        <h1 className="leading-none">
          <Image
            src="/main_logo.png"
            alt="NiVoca"
            width={260}
            height={64}
            priority
            className="h-auto w-[260px] dark:invert dark:brightness-200 dark:contrast-100"
          />
        </h1>
        <p className="w-[260px] whitespace-pre-line text-title-sm leading-[1.5] text-muted-foreground">
          {'일본어 단어\n학습 · 복습 · 공유'}
        </p>
        {/* SR-only secondary heading carries the JLPT keyword cluster */}
        <h2 className="sr-only">
          JLPT N5~N1 일본어 단어장 — 간격 반복 SRS 퀴즈, 이미지 OCR 단어 추출, 기기 내 AI 어시스턴트, 단어장 공유
        </h2>
      </header>

      <div className="h-12 shrink-0" />

      {/* Features */}
      <ul className="w-[300px]">
        {FEATURES.map(({ Icon, text }, i) => (
          <li
            key={text}
            className="animate-stagger flex items-center gap-4 py-4 text-reading leading-[1.5] text-muted-foreground"
            style={{ '--stagger': i + 3 } as React.CSSProperties}
          >
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary dark:bg-card">
              <Icon className="size-5 text-primary" />
            </div>
            <span>{text}</span>
          </li>
        ))}
      </ul>

      <div className="flex-1" />

      {/* CTA */}
      <div className="animate-slide-up w-full shrink-0 pb-12" style={{ animationDelay: '200ms' }}>
        <div className="flex flex-col gap-3">
          <Link href="/signup">
            <Button
              className={cn(btnCta, 'text-primary-foreground')}
              data-testid="landing-signup-button"
            >
              회원가입
            </Button>
          </Link>
          <Link href="/login">
            <Button
              variant="ghost"
              className={cn(btnCta, 'font-medium text-muted-foreground')}
              data-testid="landing-login-button"
            >
              로그인
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
