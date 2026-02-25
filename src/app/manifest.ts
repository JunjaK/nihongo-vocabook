import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NiVoca - 일본어 단어 학습',
    short_name: 'NiVoca',
    description: 'Japanese vocabulary study app with spaced repetition',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#3eb8d4',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: '퀴즈 시작',
        short_name: '퀴즈',
        url: '/quiz',
        icons: [{ src: '/icon-192x192.png', sizes: '192x192' }],
      },
      {
        name: '단어 추가',
        short_name: '추가',
        url: '/words/create',
        icons: [{ src: '/icon-192x192.png', sizes: '192x192' }],
      },
      {
        name: '암기 완료',
        short_name: '암기',
        url: '/mastered',
        icons: [{ src: '/icon-192x192.png', sizes: '192x192' }],
      },
    ],
    share_target: {
      action: '/words/create',
      method: 'GET',
      params: {
        text: 'term',
      },
    },
  } as ReturnType<typeof manifest>;
}
