import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '로그인',
  description: 'NiVoca에 로그인하여 JLPT 단어장과 SRS 퀴즈를 시작하세요.',
  alternates: { canonical: '/login' },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
