/**
 * Supabase Edge Function: send-quiz-reminders
 *
 * Invoked by cron (every hour). For each user whose notification_hour matches
 * the current UTC hour offset, query due word count and send push via Expo Push API.
 *
 * Requires env vars:
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 *   - EXPO_ACCESS_TOKEN (set in Supabase project settings)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface NotificationTarget {
  user_id: string;
  token: string;
  platform: string;
  notification_hour: number;
  notification_minute: number;
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  const currentHourUTC = new Date().getUTCHours();

  // Find users with notification_enabled and tokens, matching current UTC hour
  // Note: This is a simplified approach — in production, you'd want timezone-aware matching
  const { data: targets, error } = await supabase
    .from('quiz_settings')
    .select(`
      user_id,
      notification_hour,
      notification_minute,
      push_tokens!inner(token, platform)
    `)
    .eq('notification_enabled', true)
    .eq('notification_hour', currentHourUTC);

  if (error) {
    console.error('Failed to query targets:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!targets || targets.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }));
  }

  // Flatten targets with tokens
  const flatTargets: NotificationTarget[] = [];
  for (const row of targets) {
    const tokens = row.push_tokens as unknown as Array<{ token: string; platform: string }>;
    for (const t of tokens) {
      flatTargets.push({
        user_id: row.user_id,
        token: t.token,
        platform: t.platform,
        notification_hour: row.notification_hour,
        notification_minute: row.notification_minute,
      });
    }
  }

  // For each user, get due count
  const userDueCounts = new Map<string, number>();
  const uniqueUserIds = [...new Set(flatTargets.map((t) => t.user_id))];

  for (const userId of uniqueUserIds) {
    const { count } = await supabase
      .from('study_progress')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .lte('next_review', new Date().toISOString());
    userDueCounts.set(userId, count ?? 0);
  }

  // Build push messages (Expo format) — only for users with due words
  const messages = flatTargets
    .filter((t) => (userDueCounts.get(t.user_id) ?? 0) > 0)
    .map((t) => {
      const count = userDueCounts.get(t.user_id)!;
      return {
        to: t.token,
        title: 'NiVoca',
        body: `You have ${count} word${count !== 1 ? 's' : ''} to review today!`,
      };
    });

  if (messages.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no due words' }));
  }

  // Send via Expo Push API
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (expoAccessToken) {
    headers['Authorization'] = `Bearer ${expoAccessToken}`;
  }

  const pushResponse = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
  });

  const result = await pushResponse.json();
  console.log(`Sent ${messages.length} push notifications`, result);

  return new Response(JSON.stringify({ sent: messages.length }));
});
