import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/components/layout/auth-provider';
import { RepositoryProvider } from '@/lib/repository/provider';
import { I18nProvider } from '@/lib/i18n';
import { MobileShell } from '@/components/layout/mobile-shell';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://nivoca.jun-devlog.win'),
  title: {
    default: 'NiVoca — JLPT 일본어 단어 학습',
    template: '%s | NiVoca',
  },
  description: 'JLPT N5~N1 일본어 단어장. 간격 반복(SRS) 퀴즈, 이미지 OCR 단어 추출, 단어장 공유까지.',
  keywords: ['JLPT', '일본어', '단어장', '일본어 공부', 'Japanese vocabulary', 'SRS', 'spaced repetition', 'NiVoca'],
  authors: [{ name: 'jun-devlog' }],
  creator: 'jun-devlog',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'NiVoca',
  },
  openGraph: {
    title: 'NiVoca — JLPT 일본어 단어 학습',
    description: 'JLPT N5~N1 단어장, SRS 퀴즈, 이미지 OCR 단어 추출',
    images: [{ url: '/logo.png', width: 1280, height: 926 }],
    type: 'website',
    locale: 'ko_KR',
    siteName: 'NiVoca',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NiVoca — JLPT 일본어 단어 학습',
    description: 'JLPT N5~N1 단어장, SRS 퀴즈, 이미지 OCR 단어 추출',
    images: ['/logo.png'],
  },
  alternates: {
    canonical: '/',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#3eb8d4" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#1a1a2e" media="(prefers-color-scheme: dark)" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <I18nProvider>
            <AuthProvider>
              <RepositoryProvider>
                <MobileShell>
                  {children}
                </MobileShell>
              </RepositoryProvider>
            </AuthProvider>
          </I18nProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
