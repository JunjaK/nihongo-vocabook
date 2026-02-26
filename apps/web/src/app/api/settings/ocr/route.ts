import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { encrypt, decrypt } from '@/lib/crypto/aes';
import type { LlmProvider } from '@/lib/ocr/settings';

interface PutBody {
  llmProvider: LlmProvider;
  apiKey?: string;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('user_settings')
    .select('llm_provider, encrypted_api_key')
    .eq('user_id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ llmProvider: 'openai', apiKey: '', hasApiKey: false });
  }

  let apiKey = '';
  if (data.encrypted_api_key) {
    apiKey = decrypt(data.encrypted_api_key);
  }

  return NextResponse.json({
    llmProvider: data.llm_provider as LlmProvider,
    apiKey,
    hasApiKey: !!data.encrypted_api_key,
  });
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as PutBody;
  const { llmProvider, apiKey } = body;

  const validProviders: LlmProvider[] = ['openai', 'anthropic', 'gemini'];
  if (!validProviders.includes(llmProvider)) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }

  const encryptedApiKey = apiKey ? encrypt(apiKey) : null;

  const { error } = await supabase
    .from('user_settings')
    .upsert(
      {
        user_id: user.id,
        llm_provider: llmProvider,
        encrypted_api_key: encryptedApiKey,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
