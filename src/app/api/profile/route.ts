import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface PutBody {
  nickname?: string;
  avatarUrl?: string | null;
  jlptLevel?: number | null;
  studyPurpose?: string | null;
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
    return NextResponse.json({ error: error.message }, { status: 500 });
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

  const body = (await req.json()) as PutBody;

  const updates: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  };

  if (body.nickname !== undefined) updates.nickname = body.nickname;
  if (body.avatarUrl !== undefined) updates.avatar_url = body.avatarUrl;
  if (body.jlptLevel !== undefined) {
    if (body.jlptLevel !== null && (body.jlptLevel < 1 || body.jlptLevel > 5)) {
      return NextResponse.json({ error: 'Invalid JLPT level' }, { status: 400 });
    }
    updates.jlpt_level = body.jlptLevel;
  }
  if (body.studyPurpose !== undefined) updates.study_purpose = body.studyPurpose;

  const { error } = await supabase
    .from('user_settings')
    .upsert(updates, { onConflict: 'user_id' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
