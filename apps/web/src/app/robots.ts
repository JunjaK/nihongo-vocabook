import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/login', '/signup', '/jlpt/', '/privacy'],
        disallow: ['/words/', '/wordbooks/', '/quiz/', '/mastered/', '/settings/', '/api/'],
      },
    ],
    sitemap: 'https://nivoca.jun-devlog.win/sitemap.xml',
  };
}
