import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/', '/login', '/signup', '/verify-email', '/jlpt'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');

  // Server-side requests (SSR, server actions) have no origin — allow
  if (!origin && !referer) return true;

  const allowed = host ? [
    `https://${host}`,
    `http://${host}`,
  ] : [];

  if (origin && allowed.some((a) => origin.startsWith(a))) return true;
  if (referer && allowed.some((a) => referer.startsWith(a))) return true;

  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API routes: block external origin requests
  if (pathname.startsWith('/api/')) {
    if (!isAllowedOrigin(request)) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
