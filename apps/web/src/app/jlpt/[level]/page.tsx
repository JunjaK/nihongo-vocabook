import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { JlptWordList } from './word-list';

const JLPT_DATA = {
  n5: {
    label: 'N5',
    numLevel: 5,
    title: 'JLPT N5 일본어 단어장',
    headline: '일본어의 첫걸음',
    description: 'JLPT N5는 일본어 입문 수준입니다. 기초 한자와 히라가나·카타카나로 쓰인 일상 표현을 학습합니다.',
    wordCount: '약 700',
    kanjiCount: '약 100자',
  },
  n4: {
    label: 'N4',
    numLevel: 4,
    title: 'JLPT N4 일본어 단어장',
    headline: '기초 일본어 완성',
    description: 'JLPT N4는 기초 일본어 수준입니다. 일상적인 장면에서 사용되는 기본 어휘와 문법을 다룹니다.',
    wordCount: '약 700',
    kanjiCount: '약 300자',
  },
  n3: {
    label: 'N3',
    numLevel: 3,
    title: 'JLPT N3 일본어 단어장',
    headline: '중급으로 가는 관문',
    description: 'JLPT N3는 초급과 중급의 다리 역할입니다. 일상 회화와 간단한 글을 이해할 수 있는 수준입니다.',
    wordCount: '약 2,100',
    kanjiCount: '약 600자',
  },
  n2: {
    label: 'N2',
    numLevel: 2,
    title: 'JLPT N2 일본어 단어장',
    headline: '실전 일본어',
    description: 'JLPT N2는 폭넓은 장면에서 일본어를 이해할 수 있는 수준입니다. 취업, 유학에 필요한 레벨입니다.',
    wordCount: '약 1,800',
    kanjiCount: '약 1,000자',
  },
  n1: {
    label: 'N1',
    numLevel: 1,
    title: 'JLPT N1 일본어 단어장',
    headline: '최고 수준의 일본어',
    description: 'JLPT N1은 최상위 수준입니다. 논문, 비즈니스 문서 등 복잡한 일본어를 이해할 수 있습니다.',
    wordCount: '약 2,700',
    kanjiCount: '약 2,000자',
  },
} as const;

type Level = keyof typeof JLPT_DATA;
const LEVELS = Object.keys(JLPT_DATA) as Level[];

export interface JlptWord {
  term: string;
  reading: string;
  meanings: string[];
  meanings_ko: string[] | null;
}

export function generateStaticParams() {
  return LEVELS.map((level) => ({ level }));
}

export function generateMetadata({ params }: { params: Promise<{ level: string }> }): Promise<Metadata> {
  return params.then(({ level }) => {
    const data = JLPT_DATA[level as Level];
    if (!data) {
      return { title: 'JLPT 단어장' };
    }
    return {
      title: data.title,
      description: `${data.description} ${data.wordCount} 단어, ${data.kanjiCount} 한자 수록. 샘플 단어 목록을 확인해보세요.`,
      keywords: [`JLPT ${data.label}`, '일본어 단어장', `${data.label} 단어`, '일본어 공부', 'Japanese vocabulary'],
      openGraph: {
        title: `${data.title} — NiVoca`,
        description: `${data.headline}. ${data.wordCount} 단어를 SRS 퀴즈로 효율적으로 학습하세요.`,
        type: 'website',
        locale: 'ko_KR',
      },
      twitter: {
        card: 'summary',
        title: `${data.title} — NiVoca`,
        description: `${data.headline}. ${data.wordCount} 단어를 SRS 퀴즈로 효율적으로 학습하세요.`,
      },
      alternates: { canonical: `/jlpt/${level}` },
    };
  });
}

const SAMPLE_LIMIT = 30;

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

  const supabase = await createClient();
  const { data: words } = await supabase
    .from('dictionary_entries')
    .select('term, reading, meanings, meanings_ko')
    .eq('jlpt_level', data.numLevel)
    .limit(SAMPLE_LIMIT);

  const levelLinks = LEVELS.map((l) => ({
    key: l,
    label: JLPT_DATA[l].label,
    href: `/jlpt/${l}`,
    active: l === level,
  }));

  return (
    <JlptWordList
      level={data.label}
      title={data.title}
      headline={data.headline}
      wordCount={data.wordCount}
      words={(words as JlptWord[]) ?? []}
      levelLinks={levelLinks}
    />
  );
}
