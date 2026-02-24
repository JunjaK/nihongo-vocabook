import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '회원가입',
  description: '日本語 VocaBook 계정을 만들고 JLPT 단어장, SRS 퀴즈, 이미지 OCR 기능을 이용하세요.',
  alternates: { canonical: '/signup' },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
