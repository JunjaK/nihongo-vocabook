import type { MetadataRoute } from 'next';

const BASE_URL = 'https://nivoca.jun-devlog.win';
const JLPT_LEVELS = ['n5', 'n4', 'n3', 'n2', 'n1'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'monthly', priority: 1.0 },
    { url: `${BASE_URL}/login`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/signup`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/privacy`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.2 },
  ];

  const jlptPages: MetadataRoute.Sitemap = JLPT_LEVELS.map((level) => ({
    url: `${BASE_URL}/jlpt/${level}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));

  return [...staticPages, ...jlptPages];
}
