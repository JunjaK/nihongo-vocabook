import { NextResponse, type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q');

  if (!query) {
    return NextResponse.json(
      { error: 'Missing query parameter "q"' },
      { status: 400 },
    );
  }

  const url = `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'nihongo-vocabook/1.0',
    },
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: 'Jisho API request failed' },
      { status: response.status },
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}
