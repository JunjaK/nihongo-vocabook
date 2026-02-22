import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nihongo VocaBook',
    short_name: 'VocaBook',
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
  };
}
