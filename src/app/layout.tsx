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
  title: 'Nihongo VocaBook',
  description: 'Japanese vocabulary study app with spaced repetition',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'VocaBook',
  },
  openGraph: {
    title: '日本語 VocaBook',
    description: 'Learn · Review · Share Japanese words',
    images: [{ url: '/logo.png', width: 1280, height: 926 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '日本語 VocaBook',
    description: 'Learn · Review · Share Japanese words',
    images: ['/logo.png'],
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
