import type { NextConfig } from 'next';

/**
 * Response headers applied to every route. These guard against the most
 * common cross-origin / content-sniffing / clickjacking attacks. CSP is
 * intentionally permissive for the `*` script-src clause because the app
 * runs Next.js with inline runtime scripts + Supabase + Tailwind generated
 * styles — a strict policy would need nonces wired through every <Script>.
 * The current policy still blocks the most dangerous vector (third-party
 * script injection from unknown origins).
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next.js needs 'unsafe-inline' for its bootstrap script; 'unsafe-eval'
      // is required by some Recharts / esbuild-wasm paths used here.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Tailwind/Shadcn inject inline styles; we also use CSS-var <style> tags.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // Supabase REST/realtime + jisho.org dictionary fallback + Anthropic/OpenAI
      // when the client routes through us (it doesn't today but leaving room).
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://jisho.org",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['esbuild-wasm'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
