import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '개인정보 처리방침',
  description: 'NiVoca 개인정보 처리방침. 수집 항목, 이용 목적, 보유 기간, LLM API Key 처리 등을 안내합니다.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
