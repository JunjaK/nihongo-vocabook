import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, Brain, GraduationCap, Sparkles, Trophy } from 'lucide-react';

const JLPT_DATA = {
  n5: {
    label: 'N5',
    title: 'JLPT N5 일본어 단어장',
    headline: '일본어의 첫걸음',
    description: 'JLPT N5는 일본어 입문 수준입니다. 기초 한자와 히라가나·카타카나로 쓰인 일상 표현을 학습합니다.',
    wordCount: '약 800개',
    kanjiCount: '약 100자',
    level: '초급 (입문)',
    icon: BookOpen,
  },
  n4: {
    label: 'N4',
    title: 'JLPT N4 일본어 단어장',
    headline: '기초 일본어 완성',
    description: 'JLPT N4는 기초 일본어 수준입니다. 일상적인 장면에서 사용되는 기본 어휘와 문법을 다룹니다.',
    wordCount: '약 1,500개',
    kanjiCount: '약 300자',
    level: '초급 (기초)',
    icon: Brain,
  },
  n3: {
    label: 'N3',
    title: 'JLPT N3 일본어 단어장',
    headline: '중급으로 가는 관문',
    description: 'JLPT N3는 초급과 중급의 다리 역할입니다. 일상 회화와 간단한 글을 이해할 수 있는 수준입니다.',
    wordCount: '약 3,750개',
    kanjiCount: '약 600자',
    level: '중급 (초중급)',
    icon: GraduationCap,
  },
  n2: {
    label: 'N2',
    title: 'JLPT N2 일본어 단어장',
    headline: '실전 일본어',
    description: 'JLPT N2는 폭넓은 장면에서 일본어를 이해할 수 있는 수준입니다. 취업, 유학에 필요한 레벨입니다.',
    wordCount: '약 6,000개',
    kanjiCount: '약 1,000자',
    level: '중상급',
    icon: Sparkles,
  },
  n1: {
    label: 'N1',
    title: 'JLPT N1 일본어 단어장',
    headline: '최고 수준의 일본어',
    description: 'JLPT N1은 최상위 수준입니다. 논문, 비즈니스 문서 등 복잡한 일본어를 이해할 수 있습니다.',
    wordCount: '약 10,000개',
    kanjiCount: '약 2,000자',
    level: '상급',
    icon: Trophy,
  },
} as const;

type Level = keyof typeof JLPT_DATA;
const LEVELS = Object.keys(JLPT_DATA) as Level[];

export function generateStaticParams() {
  return LEVELS.map((level) => ({ level }));
}

export function generateMetadata({ params }: { params: Promise<{ level: string }> }): Promise<Metadata> {
  // generateMetadata in Next.js 16 receives params as a Promise
  return params.then(({ level }) => {
    const data = JLPT_DATA[level as Level];
    if (!data) {
      return { title: 'JLPT 단어장' };
    }
    return {
      title: data.title,
      description: `${data.description} ${data.wordCount} 단어, ${data.kanjiCount} 한자 수록.`,
      keywords: [`JLPT ${data.label}`, '일본어 단어장', `${data.label} 단어`, '일본어 공부', 'Japanese vocabulary'],
      openGraph: {
        title: `${data.title} — 日本語 VocaBook`,
        description: `${data.headline}. ${data.wordCount} 단어를 SRS 퀴즈로 효율적으로 학습하세요.`,
        type: 'website',
        locale: 'ko_KR',
      },
      twitter: {
        card: 'summary',
        title: `${data.title} — 日本語 VocaBook`,
        description: `${data.headline}. ${data.wordCount} 단어를 SRS 퀴즈로 효율적으로 학습하세요.`,
      },
      alternates: { canonical: `/jlpt/${level}` },
    };
  });
}

export default async function JlptLevelPage({ params }: { params: Promise<{ level: string }> }) {
  const { level } = await params;
  const data = JLPT_DATA[level as Level];

  if (!data) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p>존재하지 않는 JLPT 레벨입니다.</p>
      </div>
    );
  }

  const Icon = data.icon;

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-6 py-12">
      {/* Header */}
      <div className="text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary/10">
          <Icon className="size-8 text-primary" />
        </div>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">{data.title}</h1>
        <p className="mt-2 text-lg text-muted-foreground">{data.headline}</p>
      </div>

      {/* Description */}
      <p className="mt-8 leading-relaxed text-muted-foreground">{data.description}</p>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-3 gap-4">
        <div className="rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-primary">{data.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">{data.level}</div>
        </div>
        <div className="rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold">{data.wordCount.replace('약 ', '')}</div>
          <div className="mt-1 text-xs text-muted-foreground">단어</div>
        </div>
        <div className="rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold">{data.kanjiCount.replace('약 ', '')}</div>
          <div className="mt-1 text-xs text-muted-foreground">한자</div>
        </div>
      </div>

      {/* Features */}
      <div className="mt-8 space-y-3">
        <h2 className="font-semibold">VocaBook으로 학습하면</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-primary">&#x2713;</span>
            <span>FSRS 알고리즘 기반 간격 반복 퀴즈로 효율적 암기</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-primary">&#x2713;</span>
            <span>이미지 OCR로 교재·시험지에서 바로 단어 추출</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-primary">&#x2713;</span>
            <span>우선순위 설정으로 어려운 단어 집중 학습</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-primary">&#x2713;</span>
            <span>단어장 공유로 함께 공부하기</span>
          </li>
        </ul>
      </div>

      {/* Other Levels */}
      <div className="mt-10">
        <h2 className="mb-3 font-semibold">다른 JLPT 레벨</h2>
        <div className="flex gap-2">
          {LEVELS.map((l) => (
            <Link
              key={l}
              href={`/jlpt/${l}`}
              className={`flex-1 rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors hover:bg-accent ${l === level ? 'border-primary bg-primary/5 text-primary' : 'text-muted-foreground'}`}
            >
              {JLPT_DATA[l].label}
            </Link>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="mt-10 flex flex-col gap-3">
        <Link
          href="/words"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          무료로 시작하기
        </Link>
        <Link
          href="/login"
          className="inline-flex items-center justify-center rounded-lg border px-6 py-3 text-sm font-medium transition-colors hover:bg-accent"
        >
          로그인
        </Link>
      </div>

      {/* Footer */}
      <footer className="mt-16 border-t pt-6 text-center text-xs text-muted-foreground">
        <p>&copy; 2025 日本語 VocaBook. JLPT 일본어 단어 학습 앱.</p>
      </footer>
    </div>
  );
}
