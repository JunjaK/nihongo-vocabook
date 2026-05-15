import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/profile');

const MAX_NICKNAME_LEN = 50;
const MAX_AVATAR_URL_LEN = 500;
const MAX_STUDY_PURPOSE_LEN = 500;

interface PutBody {
  nickname?: string;
  avatarUrl?: string | null;
  jlptLevel?: number | null;
  studyPurpose?: string | null;
}

/**
 * Reject HTTP(S)-only URLs. javascript:, data:, blob: schemes are forbidden
 * because the value is later rendered as an <img src=…> / <Avatar/> source.
 */
function isSafeAvatarUrl(url: string): boolean {
  if (url.length > MAX_AVATAR_URL_LEN) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('user_settings')
    .select('nickname, avatar_url, jlpt_level, study_purpose')
    .eq('user_id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('user_settings select failed', error.message);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }

  return NextResponse.json({
    nickname: data?.nickname ?? null,
    avatarUrl: data?.avatar_url ?? null,
    jlptLevel: data?.jlpt_level ?? null,
    studyPurpose: data?.study_purpose ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  };

  if (body.nickname !== undefined) {
    if (typeof body.nickname !== 'string') {
      return NextResponse.json({ error: 'Invalid nickname' }, { status: 400 });
    }
    const trimmed = body.nickname.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_NICKNAME_LEN) {
      return NextResponse.json(
        { error: `Nickname must be 1–${MAX_NICKNAME_LEN} chars` },
        { status: 400 },
      );
    }
    updates.nickname = trimmed;
  }
  if (body.avatarUrl !== undefined) {
    if (body.avatarUrl !== null) {
      if (typeof body.avatarUrl !== 'string' || !isSafeAvatarUrl(body.avatarUrl)) {
        return NextResponse.json({ error: 'Invalid avatar URL' }, { status: 400 });
      }
    }
    updates.avatar_url = body.avatarUrl;
  }
  if (body.jlptLevel !== undefined) {
    if (
      body.jlptLevel !== null &&
      (!Number.isInteger(body.jlptLevel) || body.jlptLevel < 1 || body.jlptLevel > 5)
    ) {
      return NextResponse.json({ error: 'Invalid JLPT level' }, { status: 400 });
    }
    updates.jlpt_level = body.jlptLevel;
  }
  if (body.studyPurpose !== undefined) {
    if (body.studyPurpose !== null) {
      if (
        typeof body.studyPurpose !== 'string' ||
        body.studyPurpose.length > MAX_STUDY_PURPOSE_LEN
      ) {
        return NextResponse.json(
          { error: `Study purpose must be ≤ ${MAX_STUDY_PURPOSE_LEN} chars` },
          { status: 400 },
        );
      }
    }
    updates.study_purpose = body.studyPurpose;
  }

  const { error } = await supabase
    .from('user_settings')
    .upsert(updates, { onConflict: 'user_id' });

  if (error) {
    logger.error('user_settings upsert failed', error.message);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
